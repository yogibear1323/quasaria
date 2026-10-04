"""Robustness: random-entry controls, fold concentration, deflated Sharpe, cost sensitivity, oracle-lag vulnerability, move/cost ratio."""
import sys, json, numpy as np, pandas as pd; sys.path.insert(0, ".")
from math import erf, sqrt, log, e as E
from statistics import NormalDist
from data import series, bars as B, funding_hourly, load
from strategies import gen, Cache, random_entries
from engine import run, metrics
from grids import caps
from run_wf import windows
DAY = 86400; ND = NormalDist()
TFL = {60: "1m", 300: "5m", 900: "15m", 1800: "30m", 3600: "1h", 14400: "4h"}
folds = pd.read_csv("../results/wf_folds_selected.csv")
rng = np.random.default_rng(20261004)
CACHE = {}
def ctx(tf):
    if tf not in CACHE:
        b = B(series(tf)); CACHE[tf] = (b, Cache(b), funding_hourly(b["t"]), windows(b["t"], tf))
    return CACHE[tf]

def run_slice(b, sig, fund, tf, lo, hi, fam, fee=10, slip=5):
    i0, i1 = np.searchsorted(b["t"], lo), np.searchsorted(b["t"], hi)
    bs = {k: v[i0:i1] for k, v in b.items()}; ss = {k: (v[i0:i1] if isinstance(v, np.ndarray) else v) for k, v in sig.items()}
    r, lev = caps(fam)
    tr, eq, h = run(bs, ss, tf, risk_pct=r, max_lev=lev, fund=fund[i0:i1], fee_bps=fee, slip_bps=slip)
    return tr, eq, bs

def wf_stitch(tf, fam, fee=10, slip=5, n_random=0):
    b, C, fund, (wins, ho, end, t0) = ctx(tf)
    sel = folds[(folds.tf == tf) & (folds.family == fam)]
    net = 0.0; daily = []; rand = np.zeros(n_random); per_fold = []
    for _, r in sel.iterrows():
        k, a, bb, e = wins[int(r.fold)]
        p = json.loads(r.cfg); sig = gen(fam, C, p, tf)
        tr, eq, bs = run_slice(b, sig, fund, tf, bb, e, fam, fee, slip)
        net += tr[:, 7].sum() if len(tr) else 0; per_fold.append(float(tr[:, 7].sum()) if len(tr) else 0.0)
        step = max(1, DAY // tf); ee = eq[::step]; daily += list(np.diff(ee) / ee[:-1]) if len(ee) > 1 else []
        if n_random:
            i0, i1 = np.searchsorted(b["t"], bb), np.searchsorted(b["t"], e)
            c = bs["c"]; ss = {kk: (v[i0:i1] if isinstance(v, np.ndarray) else v) for kk, v in sig.items()}
            ntr = max(len(tr), 1)
            m = ss["side"] != 0
            sd = float(np.median(np.abs(c[m] - ss["stop"][m]) / c[m])) if m.any() else 0.02
            sd = min(max(sd, 0.008), 0.075)
            rr, lev = caps(fam)
            for j in range(n_random):
                rs = random_entries(ss, ntr, rng, sd, c)
                trr, _, _ = run(bs, rs, tf, risk_pct=rr, max_lev=lev, fund=fund[i0:i1])
                rand[j] += trr[:, 7].sum() if len(trr) else 0
    return net, np.array(daily), rand, per_fold

def sharpe_stats(r):
    if len(r) < 10 or r.std() == 0: return np.nan, 0, 3, len(r)
    sr = r.mean() / r.std(); z = (r - r.mean()) / r.std()
    return sr, float((z ** 3).mean()), float((z ** 4).mean()), len(r)

def dsr(sr, skew, kurt, T, var_sr, N):
    g = 0.5772156649
    sr0 = sqrt(var_sr) * ((1 - g) * ND.inv_cdf(1 - 1 / N) + g * ND.inv_cdf(1 - 1 / (N * E)))
    den = sqrt(max(1e-12, 1 - skew * sr + (kurt - 1) / 4 * sr * sr))
    return ND.cdf((sr - sr0) * sqrt(T - 1) / den), sr0

if __name__ == "__main__":
    out = {}
    combos = folds[["tf", "family"]].drop_duplicates().values.tolist()
    allsr = {}
    for tf, fam in combos:
        net, daily, _, pf = wf_stitch(int(tf), fam)
        allsr[(int(tf), fam)] = (net, sharpe_stats(daily), pf)
    # trial Sharpe dispersion: only combos with >= 60 OOS days of daily returns (tiny samples give meaningless Sharpes)
    srs = np.array([v[1][0] for v in allsr.values() if v[1][0] == v[1][0] and v[1][3] >= 60])
    var_sr = float(srs.var()); N = len(allsr)
    cand = sorted(allsr, key=lambda k: -allsr[k][0])[:8]
    rows = []
    for tf, fam in cand:
        net, daily, rand, pf = wf_stitch(tf, fam, n_random=300)
        sr, sk, ku, T = sharpe_stats(daily)
        d, sr0 = dsr(sr, sk, ku, T, var_sr, N)
        net_hi, _, _, _ = wf_stitch(tf, fam, slip=10)
        net_nc, _, _, _ = wf_stitch(tf, fam, fee=0, slip=0)
        b_, C_, fund_, (w_, ho_, end_, _) = ctx(tf)
        lastcfg = json.loads(folds[(folds.tf == tf) & (folds.family == fam)].sort_values("fold").cfg.iloc[-1])
        trh, eqh, _ = run_slice(b_, gen(fam, C_, lastcfg, tf), fund_, tf, ho_, end_, fam)
        mh = metrics(trh, eqh, bars_per_day=max(1, DAY // tf))
        rows.append(dict(tf=TFL[tf], family=fam, holdout_cfg=json.dumps(lastcfg), holdout_trades=mh["trades"], holdout_net=round(mh["net"], 1), holdout_win=mh["win_rate"], holdout_dd=round(mh["max_dd_pct"], 1), oos_net=round(net, 1), oos_net_ex_best_fold=round(net - max(pf), 1), best_fold_share=round(max(pf) / net, 2) if net > 0 else None,
                         pos_folds=f"{sum(x > 0 for x in pf)}/{len(pf)}", random_median=round(float(np.median(rand)), 1), random_p95=round(float(np.percentile(rand, 95)), 1),
                         p_value_vs_random=round(float((rand >= net).mean()), 3), daily_sharpe_ann=round(sr * sqrt(365), 2) if sr == sr else None,
                         deflated_sharpe_prob=round(d, 3), sr0_ann=round(sr0 * sqrt(365), 2), oos_net_slip10=round(net_hi, 1), oos_net_nocost=round(net_nc, 1)))
        print(rows[-1], flush=True)
    pd.DataFrame(rows).to_csv("../results/robustness_top.csv", index=False)
    out["var_sr_daily"] = var_sr; out["n_trials_wf"] = N; out["n_sr_used"] = int(len(srs))

    # move / cost ratio per timeframe (last 6 months)
    mc = []
    for tf in [60, 300, 900, 1800, 3600, 14400]:
        b, C, _, _ = ctx(tf); a = C.atr(14) / b["c"]; m = b["t"] > b["t"][-1] - 180 * DAY
        if tf == 60: m = np.ones(len(a), bool)
        mc.append(dict(tf=TFL[tf], median_atr_pct=round(float(np.nanmedian(a[m]) * 100), 3), round_trip_cost_pct=0.2, cost_in_atr=round(0.2 / float(np.nanmedian(a[m]) * 100), 2),
                       min_stop_in_atr=round(0.8 / float(np.nanmedian(a[m]) * 100), 2)))
    # 15s / 30s: estimate from 1m via sqrt-time scaling (no sub-minute history cached)
    a1 = mc[0]["median_atr_pct"]
    for s in (15, 30):
        v = a1 * sqrt(s / 60); mc.insert(0, dict(tf=f"{s}s (est.)", median_atr_pct=round(v, 3), round_trip_cost_pct=0.2, cost_in_atr=round(0.2 / v, 2), min_stop_in_atr=round(0.8 / v, 2)))
    pd.DataFrame(mc).to_csv("../results/move_vs_cost.csv", index=False); print(pd.DataFrame(mc))

    # oracle-lag vulnerability (NOT a strategy): oracle publishes the market price every U minutes; a trader who sees the
    # live market can open at the stale oracle price when |market - oracle| > thr and close at the next update.
    m1 = load(60); c = m1.c.to_numpy(); ol = []
    for U in (1, 2, 5, 10, 15):
        idx = np.arange(len(c)); upd = (idx // U) * U  # last update index
        orc = c[upd]
        for thr in (0.1, 0.25, 0.5):
            dev = c / orc - 1
            # one trade per update interval: first minute in the interval where |dev| > thr
            first = {}
            for i in np.nonzero(np.abs(dev) > thr / 100)[0]:
                if i % U == 0: continue
                k = i // U
                if k not in first: first[k] = i
            if not first: ol.append(dict(update_min=U, thr_pct=thr, trades=0)); continue
            ii = np.array(list(first.values())); s = np.sign(dev[ii]); nxt = np.minimum((ii // U + 1) * U, len(c) - 1)
            ret = s * (c[nxt] / orc[ii] - 1) - 0.002  # fee 10 bps + slippage 5+5 bps
            ol.append(dict(update_min=U, thr_pct=thr, trades=len(ii), win_rate=round(float((ret > 0).mean()), 3), avg_net_bps=round(float(ret.mean() * 1e4), 1), days=round(len(c) / 1440, 1)))
    pd.DataFrame(ol).to_csv("../results/oracle_lag_test.csv", index=False); print(pd.DataFrame(ol))
    json.dump(out, open("../results/robust_meta.json", "w"), indent=1)
