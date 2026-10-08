"""Shared research pieces: data, labels (fixed-outcome questions), trade simulator with the fleet's risk rules, metrics."""
import json, math, os
import numpy as np, pandas as pd

D = os.path.join(os.path.dirname(__file__), "..", "..", "data")
OPEN_FEE = 0.0010   # 10 bps on notional at open (vault open_fee_bps); vault has no close fee
SLIP = 0.0005       # 5 bps slippage each way
FEE_BUFFER = 0.0025 # fleet sizing fee buffer (sizing.ts feeBufferPct 0.25)
MIN_STOP, MAX_STOP = 0.008, 0.075   # fleet clampStop band
MAX_NOTIONAL_X = 1.25               # min(maxNotionalX 1.5, maxMarginPct 25% x maxLeverage 5)
PRE_HISTORY_FUNDING = 0.00001       # 0.001 %/h adverse charge before Kraken history starts (conservative)
QUESTIONS = ["regime", "direction", "pressure", "setup_long", "setup_short", "risk"]


def load(gran):
    df = pd.read_csv(os.path.join(D, f"coinbase_XLM-USD_{gran}.csv")).drop_duplicates("t").sort_values("t")
    full = pd.DataFrame({"t": np.arange(df.t.iloc[0], df.t.iloc[-1] + 1, gran)})
    df = full.merge(df, on="t", how="left")
    df["c"] = df["c"].ffill()
    for k in "ohl": df[k] = df[k].fillna(df["c"])
    df["v"] = df["v"].fillna(0)
    return df.reset_index(drop=True)


def aggregate(df, gran, k):
    size = gran * k
    g = df.assign(b=df.t // size * size).groupby("b")
    out = pd.DataFrame({"t": g.t.first().index, "o": g.o.first().values, "h": g.h.max().values, "l": g.l.min().values, "c": g.c.last().values, "v": g.v.sum().values, "n": g.t.count().values})
    return out[out.n == k].drop(columns="n").reset_index(drop=True)


def series(tf):
    if tf in (900, 3600): return load(tf)
    if tf == 14400: return aggregate(load(3600), 3600, 4)
    raise ValueError(tf)


def funding_per_bar(t, gran):
    """Hourly funding (fraction/h, >0 longs pay) applicable to each bar, scaled to the bar length; capped at the vault's 0.05 %/h."""
    d = json.load(open(os.path.join(D, "kraken_PF_XLMUSD_funding.json")))["rates"]
    ts = np.array([pd.Timestamp(x["timestamp"]).timestamp() for x in d]); r = np.array([x["relativeFundingRate"] for x in d])
    idx = np.searchsorted(ts, t, side="right") - 1
    hourly = np.where(idx >= 0, np.clip(r[np.clip(idx, 0, None)], -0.0005, 0.0005), np.nan)
    return hourly * gran / 3600.0  # nan = before history


def stop_dist(atr, close, sl_atr):
    return np.clip(sl_atr * atr / close, MIN_STOP, MAX_STOP)


def barrier_trades(df, atr, gran, tp_atr, sl_atr, T):
    """For every decision bar i (entry at close i): exit index and net return per unit notional for long and short,
    with stop-first, gap-through fills at the open, 5 bps slippage on every fill, 10 bps open fee and funding."""
    o, h, l, c = (df[k].to_numpy(float) for k in "ohlc")
    n = len(c)
    fpb = funding_per_bar(df.t.to_numpy(), gran)
    out = {s: (np.full(n, -1, np.int64), np.full(n, np.nan), np.full(n, np.nan)) for s in ("long", "short")}  # exit idx, ret, stop dist
    dsl = stop_dist(atr, c, sl_atr)
    for i in range(n - 1):
        if not np.isfinite(atr[i]): continue
        last = min(n - 1, i + T)
        if last <= i: continue
        d_sl = dsl[i]; d_tp = d_sl * tp_atr / sl_atr
        for side, sg in (("long", 1), ("short", -1)):
            entry = c[i] * (1 + sg * SLIP)
            stop = c[i] * (1 - sg * d_sl); tp = c[i] * (1 + sg * d_tp)
            ex, px = last, c[last] * (1 - sg * SLIP)
            for j in range(i + 1, last + 1):
                if sg == 1:
                    if l[j] <= stop: ex, px = j, min(stop, o[j]) * (1 - SLIP); break
                    if h[j] >= tp: ex, px = j, max(tp, o[j]) * (1 - SLIP); break
                else:
                    if h[j] >= stop: ex, px = j, max(stop, o[j]) * (1 + SLIP); break
                    if l[j] <= tp: ex, px = j, min(tp, o[j]) * (1 + SLIP); break
            fund = fpb[i + 1:ex + 1]
            fund = np.where(np.isnan(fund), PRE_HISTORY_FUNDING * gran / 3600 * sg, fund).sum()
            ret = sg * (px / entry - 1) - OPEN_FEE - sg * fund
            out[side][0][i], out[side][1][i], out[side][2][i] = ex, ret, d_sl
    return out


def question_labels(df, T):
    """Fixed-outcome questions resolved on bars i+1..i+T (research labels; never available at decision time)."""
    h, l, c, v = (df[k].to_numpy(float) for k in "hlcv")
    n = len(c)
    lr = np.r_[0, np.diff(np.log(c))]
    clv = np.where(h > l, ((c - l) - (h - c)) / np.where(h > l, h - l, 1), 0.0)
    cs_abs = np.r_[0, np.cumsum(np.abs(np.diff(c)))]
    cs_bp = np.r_[0, np.cumsum(clv * v)]
    cs_lr2 = np.r_[0, np.cumsum(lr ** 2)]; cs_lr = np.r_[0, np.cumsum(lr)]
    lab = {k: np.full(n, np.nan) for k in ("regime", "direction", "pressure", "risk")}
    i = np.arange(n - T)
    path = cs_abs[i + T] - cs_abs[i]
    lab["direction"][i] = (c[i + T] > c[i]).astype(float)
    lab["regime"][i] = (np.where(path > 0, np.abs(c[i + T] - c[i]) / np.where(path > 0, path, 1), 0) >= 0.30).astype(float)
    half = max(1, T // 2)
    lab["pressure"][i] = ((cs_bp[i + 1 + half] - cs_bp[i + 1]) > 0).astype(float)
    # realised vol of the next T bars vs trailing 96-bar vol at i
    fwd_var = (cs_lr2[i + 1 + T] - cs_lr2[i + 1]) / T - ((cs_lr[i + 1 + T] - cs_lr[i + 1]) / T) ** 2 if False else None
    s = pd.Series(lr)
    trail = s.rolling(96).std(ddof=0).to_numpy()
    fwd = s[::-1].rolling(T).std(ddof=0).to_numpy()[::-1]  # std of lr[k..k+T-1]
    fwd_next = np.r_[fwd[1:], np.nan]                       # std of lr[i+1..i+T]
    lab["risk"][i] = (fwd_next[i] <= 1.25 * trail[i]).astype(float)  # 1 = calm (no vol expansion)
    lab["risk"][~np.isfinite(trail)] = np.nan
    return lab


# ---------------- simulator with the fleet's deterministic risk rules ----------------
RISK = dict(daily_loss=0.03, dd_halt=0.10, halt_reset_days=7, loss_streak=5, streak_pause=4 * 3600, entries_day=6)


def simulate(df, gran, idx_range, sides, risk_pct, bt, equity0=500.0, rules=RISK):
    """sides[i] in {+1,-1,0}: decision at close of bar i. risk_pct[i]: fraction of equity at risk (0 = skip).
    Returns trades list and a bar-close mark-to-market equity series over idx_range."""
    t = df.t.to_numpy(); c = df.c.to_numpy(float)
    a, b = idx_range
    eq = equity0; peak = equity0
    trades = []; curve = np.empty(b - a); k = a
    day = None; day_eq = eq; streak = 0; paused_until = 0; halted_until = 0; entries = []
    while k < b:
        curve[k - a] = eq
        tk = t[k] + gran
        d = tk // 86400
        if d != day: day, day_eq = d, eq
        s = sides[k]
        if s != 0 and risk_pct[k] > 0 and tk >= paused_until and tk >= halted_until:
            if eq <= day_eq * (1 - rules["daily_loss"]): pass
            elif sum(1 for x in entries if x > tk - 86400) >= rules["entries_day"]: pass
            else:
                side = "long" if s > 0 else "short"
                ex, ret, dsl = bt[side][0][k], bt[side][1][k], bt[side][2][k]
                if ex > k and np.isfinite(ret):
                    risk = eq * min(risk_pct[k], 0.02)                     # hard cap 2 %
                    notional = min(risk / (dsl + FEE_BUFFER), MAX_NOTIONAL_X * eq)
                    entry = c[k]
                    stop_k = min(ex, b - 1)
                    for j in range(k + 1, stop_k + 1):                     # MTM at bar closes while open
                        if j - a < len(curve): curve[j - a] = eq + notional * (s * (c[j] / entry - 1) - OPEN_FEE)
                    pnl = notional * ret
                    eq += pnl; entries.append(tk)
                    trades.append(dict(t_open=int(tk), t_close=int(t[ex] + gran), side=side, ret=ret, pnl=pnl, risk=risk, r=pnl / risk if risk else 0, eq=eq))
                    streak = streak + 1 if pnl <= 0 else 0
                    if streak >= rules["loss_streak"]: paused_until = int(t[ex] + gran) + rules["streak_pause"]; streak = 0
                    peak = max(peak, eq)
                    if eq <= peak * (1 - rules["dd_halt"]):
                        halted_until = int(t[ex] + gran) + rules["halt_reset_days"] * 86400; peak = eq
                        trades[-1]["halt"] = True
                    k = ex
                    if k - a < len(curve): curve[k - a] = eq
                    continue
        k += 1
    return trades, curve


def metrics(trades, curve, t_curve, equity0=500.0):
    n = len(trades)
    eq = pd.Series(curve, index=pd.to_datetime(t_curve, unit="s"))
    daily = eq.resample("1D").last().ffill()
    dr = daily.pct_change().dropna()
    sharpe = float(dr.mean() / dr.std() * math.sqrt(365)) if len(dr) > 2 and dr.std() > 0 else 0.0
    peak = np.maximum.accumulate(curve); dd = float(np.max((peak - curve) / peak)) if len(curve) else 0.0
    pnl = np.array([x["pnl"] for x in trades]); rets = np.array([x["r"] for x in trades])
    tstat = float(rets.mean() / rets.std(ddof=1) * math.sqrt(n)) if n > 2 and rets.std(ddof=1) > 0 else 0.0
    from scipy.stats import skew, kurtosis
    return dict(trades=n, net=float(pnl.sum()) if n else 0.0, hit=float((pnl > 0).mean()) if n else 0.0, sharpe=sharpe, max_dd=dd, tstat=tstat,
                avg_r=float(rets.mean()) if n else 0.0, pf=float(pnl[pnl > 0].sum() / -pnl[pnl < 0].sum()) if (pnl < 0).any() else float("inf"),
                halts=int(sum(1 for x in trades if x.get("halt"))), days=len(daily), sr_daily=float(dr.mean() / dr.std()) if len(dr) > 2 and dr.std() > 0 else 0.0,
                skew=float(skew(dr)) if len(dr) > 3 else 0.0, kurt=float(kurtosis(dr, fisher=False)) if len(dr) > 3 else 3.0, n_days=len(dr))


def deflated_sharpe(sr, n_obs, skew, kurt, n_trials, sr_var):
    """Bailey & Lopez de Prado DSR (per-period Sharpe). Returns probability the true SR > the expected max of n_trials null SRs."""
    from scipy.stats import norm
    g = 0.5772156649
    sr0 = math.sqrt(max(sr_var, 1e-12)) * ((1 - g) * norm.ppf(1 - 1 / n_trials) + g * norm.ppf(1 - 1 / (n_trials * math.e)))
    den = math.sqrt(max(1e-12, 1 - skew * sr + (kurt - 1) / 4 * sr ** 2))
    return float(norm.cdf((sr - sr0) * math.sqrt(max(1, n_obs - 1)) / den)), sr0


def brier(p, y):
    p, y = np.asarray(p, float), np.asarray(y, float)
    m = np.isfinite(p) & np.isfinite(y)
    p, y = p[m], y[m]
    if not len(p): return dict(n=0)
    base = y.mean()
    bs = float(np.mean((p - y) ** 2)); bs0 = float(np.mean((base - y) ** 2))
    bins = np.clip((p * 10).astype(int), 0, 9)
    rel = []; ece = 0.0
    for b in range(10):
        mm = bins == b
        if mm.sum():
            rel.append(dict(bin=b, n=int(mm.sum()), p_mean=float(p[mm].mean()), y_rate=float(y[mm].mean())))
            ece += mm.sum() / len(p) * abs(p[mm].mean() - y[mm].mean())
    return dict(n=int(len(p)), brier=bs, brier_climatology=bs0, bss=1 - bs / bs0 if bs0 > 0 else 0.0, ece=float(ece), base_rate=float(base), reliability=rel)
