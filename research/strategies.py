"""Indicators + signal generators. Every signal at bar i uses only data up to the CLOSE of bar i (no look-ahead).
Each generator returns dict(side, stop, tp, exl, exs, trl, trs, time_stop) aligned to the bars it was given.
Own variants of the fleet strategies plus publicly documented strategies REIMPLEMENTED from published rules
(no third-party code copied; sources + licenses in SOURCES below)."""
import numpy as np
from numba import njit

SOURCES = {
    "trend": ("Quasaria fleet trend (bot/src/office/strategies.ts): Donchian breakout + EMA filter, ATR stop/trail, EMA exit", "in-repo", "repo license"),
    "bbmr": ("Quasaria fleet mean-rev (Bollinger 20/2.2 + RSI extreme + ADX<20, target mid band); Bollinger 'Bollinger on Bollinger Bands' (2001)", "in-repo / book", "repo license; reimplemented"),
    "skewproxy": ("Quasaria Active skew proxy (candle pressure mapped onto funding strategy)", "frontend/src/lib/demo/engine.ts", "repo license"),
    "turtle": ("Turtle Trading rules (Dennis/Eckhardt; C. Faith 'Way of the Turtle' 2007; public 'Original Turtle Trading Rules' PDF): 20/55-bar Donchian entry, 10/20-bar exit, 2N stop", "https://oxfordstrat.com/coasdfASD32/uploads/2016/01/turtle-rules.pdf", "rules (pseudocode) only; reimplemented"),
    "tsmom": ("Time-series momentum (Moskowitz, Ooi, Pedersen 2012 JFE 'Time series momentum'; crypto: Liu & Tsyvinski 2021 RFS 'Risks and returns of cryptocurrency')", "https://doi.org/10.1016/j.jfineco.2011.11.003", "paper; reimplemented"),
    "macross": ("Dual moving-average crossover / Faber 'A Quantitative Approach to Tactical Asset Allocation' (2007) SMA trend filter", "https://papers.ssrn.com/sol3/papers.cfm?abstract_id=962461", "paper; reimplemented"),
    "rsi2": ("Connors RSI(2) (Connors & Alvarez 'Short Term Trading Strategies That Work' 2008): RSI2 extreme with 200-SMA filter, exit on 5-SMA cross", "book", "rules only; reimplemented"),
    "keltner": ("Keltner/ATR channel breakout (Chester Keltner 1960; L. Raschke ATR variant)", "https://school.stockcharts.com/doku.php?id=technical_indicators:keltner_channels", "public description; reimplemented"),
    "orb": ("Opening-range breakout (Toby Crabel 'Day Trading with Short Term Price Patterns and Opening Range Breakout' 1990) adapted to the 00:00 UTC session of 24h crypto", "book", "rules only; reimplemented"),
    "macd": ("MACD 12/26/9 signal cross (Gerald Appel) with 200-EMA trend filter", "https://school.stockcharts.com/doku.php?id=technical_indicators:moving_average_convergence_divergence_macd", "public description; reimplemented"),
    "supertrend": ("Supertrend (Olivier Seban) ATR(10)x3 flip with line as trailing stop", "https://www.tradingview.com/support/solutions/43000634738-supertrend/", "public description; reimplemented (TradingView built-in, not copied)"),
    "chandelier": ("Chandelier exit (Chuck LeBeau): highest high(22) - 3*ATR(22) trail, used as an exit option on breakouts", "https://school.stockcharts.com/doku.php?id=technical_indicators:chandelier_exit", "public description; reimplemented"),
    "lpsweep": ("Liquidity sweep + reclaim of swing / equal highs-lows and prior-day high-low (stop-hunt reversal; ICT/'smart money' liquidity concepts, Wyckoff spring/upthrust)", "https://school.stockcharts.com/doku.php?id=market_analysis:the_wyckoff_method", "public descriptions; reimplemented"),
    "vpnode": ("Volume-profile value-area re-entry toward the POC ('80 % rule', J. Dalton 'Mind over Markets' 1990)", "book", "rules only; reimplemented"),
    "random": ("Random-entry control: random time + side with each config's own exits/stops/costs", "this study", "-"),
}
LIB_LICENSES = {  # checked 2026-10-04 via raw LICENSE files; NO code from these repos is included here
    "freqtrade/freqtrade-strategies": "GPL-3.0 (not used: incompatible to copy; concepts only)",
    "mementum/backtrader": "GPL-3.0 (not used)",
    "kernc/backtesting.py": "AGPL-3.0 (not used)",
    "jesse-ai/jesse": "MIT (permissive; not needed, rules reimplemented)",
    "QuantConnect/Lean": "Apache-2.0 (permissive; not needed, rules reimplemented)",
}

@njit(cache=True)
def ema(v, n):
    out = np.full(len(v), np.nan); k = 2.0 / (n + 1); e = np.nan
    for i in range(len(v)):
        if i == n - 1:
            e = v[:n].mean()
        elif i >= n:
            e = v[i] * k + e * (1 - k)
        if i >= n - 1: out[i] = e
    return out

def sma(v, n):
    out = np.full(len(v), np.nan); cs = np.cumsum(np.insert(v, 0, 0.0)); out[n - 1:] = (cs[n:] - cs[:-n]) / n; return out

def rstd(v, n):
    m = sma(v, n); m2 = sma(v * v, n); return np.sqrt(np.maximum(m2 - m * m, 0))

@njit(cache=True)
def _tr(h, l, c):
    n = len(c); tr = np.empty(n); tr[0] = h[0] - l[0]
    for i in range(1, n): tr[i] = max(h[i] - l[i], abs(h[i] - c[i - 1]), abs(l[i] - c[i - 1]))
    return tr

@njit(cache=True)
def atr(h, l, c, n):
    tr = _tr(h, l, c); out = np.full(len(c), np.nan)
    if len(c) <= n: return out
    a = tr[1:n + 1].mean(); out[n] = a
    for i in range(n + 1, len(c)):
        a = (a * (n - 1) + tr[i]) / n; out[i] = a
    return out

@njit(cache=True)
def rsi(v, n):
    out = np.full(len(v), np.nan)
    if len(v) <= n: return out
    g = 0.0; ls = 0.0
    for i in range(1, n + 1):
        d = v[i] - v[i - 1]
        if d > 0: g += d
        else: ls -= d
    g /= n; ls /= n
    out[n] = 100 if ls == 0 and g > 0 else (50 if ls == 0 else 100 - 100 / (1 + g / ls))
    for i in range(n + 1, len(v)):
        d = v[i] - v[i - 1]
        g = (g * (n - 1) + max(d, 0.0)) / n; ls = (ls * (n - 1) + max(-d, 0.0)) / n
        out[i] = (100.0 if g > 0 else 50.0) if ls == 0 else 100 - 100 / (1 + g / ls)
    return out

@njit(cache=True)
def adx(h, l, c, n):
    m = len(c); out = np.full(m, np.nan)
    trS = 0.0; pS = 0.0; mS = 0.0; dxs = np.zeros(m); k = 0; a = 0.0
    for i in range(1, m):
        up = h[i] - h[i - 1]; dn = l[i - 1] - l[i]
        p = up if (up > dn and up > 0) else 0.0
        mm = dn if (dn > up and dn > 0) else 0.0
        t = max(h[i] - l[i], abs(h[i] - c[i - 1]), abs(l[i] - c[i - 1]))
        if i <= n:
            trS += t; pS += p; mS += mm
            if i < n: continue
        else:
            trS = trS - trS / n + t; pS = pS - pS / n + p; mS = mS - mS / n + mm
        pdi = 100 * pS / trS if trS else 0.0; mdi = 100 * mS / trS if trS else 0.0
        dx = 100 * abs(pdi - mdi) / (pdi + mdi) if (pdi + mdi) else 0.0
        dxs[k] = dx; k += 1
        if k == n:
            a = dxs[:n].mean(); out[i] = a
        elif k > n:
            a = (a * (n - 1) + dx) / n; out[i] = a
    return out

def roll_max_prev(x, n):
    """max of the n values BEFORE i (excludes i)."""
    from numpy.lib.stride_tricks import sliding_window_view as sw
    out = np.full(len(x), np.nan)
    if len(x) > n: out[n:] = sw(x, n).max(axis=1)[:-1]
    return out

def roll_min_prev(x, n):
    from numpy.lib.stride_tricks import sliding_window_view as sw
    out = np.full(len(x), np.nan)
    if len(x) > n: out[n:] = sw(x, n).min(axis=1)[:-1]
    return out

def _empty(n):
    return dict(side=np.zeros(n, np.int8), stop=np.full(n, np.nan), tp=np.zeros(n), exl=np.zeros(n, bool), exs=np.zeros(n, bool),
                trl=np.full(n, np.nan), trs=np.full(n, np.nan), time_stop=0.0)

class Cache:
    """per-series indicator cache (indicators are recomputed per series, not per config)."""
    def __init__(self, b): self.b = b; self.d = {}
    def get(self, key, fn):
        if key not in self.d: self.d[key] = fn()
        return self.d[key]
    def ema(self, n): return self.get(("ema", n), lambda: ema(self.b["c"], n))
    def sma(self, n): return self.get(("sma", n), lambda: sma(self.b["c"], n))
    def atr(self, n): return self.get(("atr", n), lambda: atr(self.b["h"], self.b["l"], self.b["c"], n))
    def rsi(self, n): return self.get(("rsi", n), lambda: rsi(self.b["c"], n))
    def adx(self, n): return self.get(("adx", n), lambda: adx(self.b["h"], self.b["l"], self.b["c"], n))
    def hh(self, n): return self.get(("hh", n), lambda: roll_max_prev(self.b["h"], n))
    def ll(self, n): return self.get(("ll", n), lambda: roll_min_prev(self.b["l"], n))
    def std(self, n): return self.get(("std", n), lambda: rstd(self.b["c"], n))
    def hh_incl(self, n): return self.get(("hhi", n), lambda: np.concatenate([roll_max_prev(self.b["h"], n)[1:], [np.nan]]) if False else np.maximum(roll_max_prev(self.b["h"], n - 1), self.b["h"]))
    def ll_incl(self, n): return self.get(("lli", n), lambda: np.minimum(roll_min_prev(self.b["l"], n - 1), self.b["l"]))

def _lp(C, k=3, L=100, src=3):
    from liquidity import sweep_scan
    b = C.b
    return C.get(("lp", k, L, src), lambda: sweep_scan(b["h"], b["l"], b["c"], b["t"], C.atr(14), k, L, src, 0.1))

def _lp_filter(C, p, side):
    """liquidity-pocket entry filter: ('sweep', M) = a sweep+reclaim of resting liquidity on the OPPOSITE side within the
    last M bars (longs after sell-side stops were taken); ('room', d) = no unswept liquidity level within d ATR in the
    trade direction (don't enter straight into a stop cluster)."""
    f = p.get("lpf")
    if not f: return side
    kind, x = f
    ls, ss, ext, up, dn, since_sell, since_buy = _lp(C)
    c = C.b["c"]; a = C.atr(14)
    if kind == "sweep":
        okL = since_sell <= x; okS = since_buy <= x
    else:
        okL = np.isnan(up) | ((up - c) > x * a); okS = np.isnan(dn) | ((c - dn) > x * a)
    side[(side > 0) & ~okL] = 0; side[(side < 0) & ~okS] = 0
    return side

def _filters(C, p, side):
    side = _lp_filter(C, p, side)
    """optional regime filters shared by directional families: adx_min (trend strength), sess (UTC hours), long_only."""
    b = C.b
    if p.get("adx_min", 0) > 0:
        side[~(C.adx(14) >= p["adx_min"])] = 0
    if p.get("adx_max", 0) > 0:
        side[~(C.adx(14) < p["adx_max"])] = 0
    if p.get("sess"):
        hr = (b["t"] // 3600) % 24
        lo, hi = p["sess"]
        side[~((hr >= lo) & (hr < hi))] = 0
    if p.get("long_only"):
        side[side < 0] = 0
    return side

def _trail(C, p, s):
    c = C.b["c"]
    mode = p.get("trail", "atr")
    if mode == "chandelier":
        a = C.atr(22); s["trl"] = C.hh_incl(22) - 3 * a; s["trs"] = C.ll_incl(22) + 3 * a
    elif mode == "atr" and p.get("trailAtr", 0) > 0:
        a = C.atr(14); s["trl"] = c - p["trailAtr"] * a; s["trs"] = c + p["trailAtr"] * a

def _tp(C, p, s, side_arr, stop):
    if p.get("tpR", 0) > 0:
        c = C.b["c"]; dist = np.abs(c - stop)
        dist = np.maximum(dist, 0.008 * c)  # clamp like minStopPct
        s["tp"] = np.where(side_arr > 0, c + p["tpR"] * dist, np.where(side_arr < 0, c - p["tpR"] * dist, 0))

def gen(name, C, p, tf_sec):
    b = C.b; c = b["c"]; n = len(c); s = _empty(n)
    side = np.zeros(n, np.int8)
    if name == "trend":
        ef, es = C.ema(p["fast"]), C.ema(p["slow"]); hi, lo = C.hh(p["breakout"]), C.ll(p["breakout"]); a = C.atr(14)
        side[(c > hi) & (ef > es)] = 1; side[(c < lo) & (ef < es)] = -1
        stop = np.where(side > 0, c - p["stopAtr"] * a, c + p["stopAtr"] * a)
        if p.get("emaExit", 1): s["exl"] = c < ef; s["exs"] = c > ef
        _trail(C, p, s)
    elif name == "turtle":
        hi, lo = C.hh(p["n_in"]), C.ll(p["n_in"]); xh, xl = C.hh(p["n_out"]), C.ll(p["n_out"]); a = C.atr(20)
        side[c > hi] = 1; side[c < lo] = -1
        stop = np.where(side > 0, c - p["stopN"] * a, c + p["stopN"] * a)
        s["exl"] = c < xl; s["exs"] = c > xh
        _trail(C, {**p, "trail": p.get("trail", "none")}, s)
    elif name == "tsmom":
        L, H = p["L"], p["H"]
        r = np.full(n, np.nan); r[L:] = c[L:] / c[:-L] - 1
        reb = (np.arange(n) % H) == 0
        sig = np.sign(np.nan_to_num(r)).astype(np.int8)
        side[reb] = sig[reb]
        s["exl"] = reb & (sig <= 0); s["exs"] = reb & (sig >= 0)
        a = C.atr(14); stop = np.where(side > 0, c - p["stopAtr"] * a, c + p["stopAtr"] * a)
        _trail(C, p, s)
    elif name == "macross":
        f, sl = C.sma(p["fast"]), C.sma(p["slow"]); a = C.atr(14)
        up = f > sl; prev = np.concatenate([[False], up[:-1]])
        valid = ~np.isnan(sl)
        side[valid & up & ~prev] = 1; side[valid & ~up & prev] = -1
        stop = np.where(side > 0, c - p["stopAtr"] * a, c + p["stopAtr"] * a)
        s["exl"] = valid & ~up; s["exs"] = valid & up
        _trail(C, p, s)
    elif name == "bbmr":
        mid = C.sma(p["n"]); sd = C.std(p["n"]); r = C.rsi(14); x = C.adx(14); a = C.atr(14)
        ok = x < p["maxAdx"]
        side[ok & (c < mid - p["k"] * sd) & (r < p["rsiLo"])] = 1; side[ok & (c > mid + p["k"] * sd) & (r > 100 - p["rsiLo"])] = -1
        stop = np.where(side > 0, c - p["stopAtr"] * a, c + p["stopAtr"] * a)
        s["tp"] = np.where(side != 0, mid, 0)
        s["time_stop"] = p["timeBars"] * tf_sec
    elif name == "rsi2":
        r = C.rsi(2); m200 = C.sma(p["trendN"]); m5 = C.sma(5); a = C.atr(14)
        side[(r < p["lo"]) & (c > m200)] = 1; side[(r > 100 - p["lo"]) & (c < m200)] = -1
        stop = np.where(side > 0, c - p["stopAtr"] * a, c + p["stopAtr"] * a)
        s["exl"] = c > m5; s["exs"] = c < m5
        s["time_stop"] = p.get("timeBars", 10) * tf_sec
    elif name == "keltner":
        e = C.ema(p["n"]); a = C.atr(p["n"])
        side[c > e + p["m"] * a] = 1; side[c < e - p["m"] * a] = -1
        stop = np.where(side > 0, c - p["stopAtr"] * a, c + p["stopAtr"] * a)
        s["exl"] = c < e; s["exs"] = c > e
        _trail(C, p, s)
    elif name == "orb":
        t = b["t"]; day = t // 86400; secs = t - day * 86400  # bar open seconds into UTC day
        R = p["rangeH"] * 3600
        in_rng = secs + tf_sec <= R
        import pandas as pd
        df = pd.DataFrame({"d": day, "h": np.where(in_rng, b["h"], np.nan), "l": np.where(in_rng, b["l"], np.nan)})
        rh = df.groupby("d")["h"].transform("max").values; rl = df.groupby("d")["l"].transform("min").values
        after = (~in_rng) & (secs + tf_sec < 86400 - 3600)
        up = after & (c > rh); dn = after & (c < rl)
        # first breakout of the day only
        first = np.zeros(n, bool); seen = {}
        for i in np.nonzero(up | dn)[0]:
            if day[i] not in seen: seen[day[i]] = 1; first[i] = True
        side[first & up] = 1; side[first & dn] = -1
        if p.get("stopMode", "range") == "range":
            stop = np.where(side > 0, rl, rh)
        else:
            stop = np.where(side > 0, (rh + rl) / 2, (rh + rl) / 2)
        eod = (secs + tf_sec) >= 86400 - tf_sec
        s["exl"] = eod; s["exs"] = eod
    elif name == "macd":
        m = C.ema(12) - C.ema(26)
        sig = ema(np.nan_to_num(m), 9); trendf = C.ema(p["trendN"]); a = C.atr(14)
        up = m > sig; prev = np.concatenate([[False], up[:-1]])
        valid = ~np.isnan(trendf) & ~np.isnan(m)
        side[valid & up & ~prev & (c > trendf)] = 1; side[valid & ~up & prev & (c < trendf)] = -1
        stop = np.where(side > 0, c - p["stopAtr"] * a, c + p["stopAtr"] * a)
        s["exl"] = valid & ~up; s["exs"] = valid & up
        _trail(C, p, s)
    elif name == "supertrend":
        line, dirn = supertrend(b["h"], b["l"], c, C.atr(p["n"]), p["m"])
        prev = np.concatenate([[0], dirn[:-1]])
        side[(dirn == 1) & (prev == -1)] = 1; side[(dirn == -1) & (prev == 1)] = -1
        stop = line.copy()
        s["exl"] = dirn == -1; s["exs"] = dirn == 1
        s["trl"] = np.where(dirn == 1, line, np.nan); s["trs"] = np.where(dirn == -1, line, np.nan)
    elif name == "lpsweep":
        ls, ss, ext, up, dn, _, _ = _lp(C, p["k"], p["L"], p["src"])
        a = C.atr(14)
        side[ls] = 1; side[ss] = -1
        if p.get("align"):
            e = C.ema(50); side[(side > 0) & ~(c > e)] = 0; side[(side < 0) & ~(c < e)] = 0
        stop = np.where(side > 0, ext - p["buf"] * a, ext + p["buf"] * a)
        dist = np.maximum(np.abs(c - stop), 0.008 * c)
        if p["tgt"] == "opp":
            tp = np.where(side > 0, np.where(up - c >= dist, up, c + 2 * dist), np.where(c - dn >= dist, dn, c - 2 * dist))
            tp = np.where(np.isnan(tp), np.where(side > 0, c + 2 * dist, c - 2 * dist), tp)
        else:
            R = float(p["tgt"][:-1]); tp = np.where(side > 0, c + R * dist, c - R * dist)
        s["tp"] = np.where(side != 0, tp, 0)
        s["time_stop"] = p.get("timeBars", 48) * tf_sec
    elif name == "vpnode":
        from liquidity import value_area
        poc, vah, val = C.get(("va", p["N"]), lambda: value_area(b["h"], b["l"], c, b.get("v", np.ones(n)), p["N"], 30))
        a = C.atr(14); pc = np.concatenate([[np.nan], c[:-1]]); pvah = np.concatenate([[np.nan], vah[:-1]]); pval = np.concatenate([[np.nan], val[:-1]])
        hi2 = np.maximum(b["h"], np.concatenate([[np.nan], b["h"][:-1]])); lo2 = np.minimum(b["l"], np.concatenate([[np.nan], b["l"][:-1]]))
        side[(pc < pval) & (c > val) & (c < poc)] = 1   # re-entry into value from below -> rotate toward POC
        side[(pc > pvah) & (c < vah) & (c > poc)] = -1
        stop = np.where(side > 0, lo2 - p["buf"] * a, hi2 + p["buf"] * a)
        dist = np.maximum(np.abs(c - stop), 0.008 * c)
        tp = poc if p["tgt"] == "poc" else np.where(side > 0, c + 2 * dist, c - 2 * dist)
        s["tp"] = np.where(side != 0, tp, 0)
        s["time_stop"] = p["timeBars"] * tf_sec
    elif name == "skewproxy":
        N = p["N"]; rng = b["h"] - b["l"]
        pr = np.where(rng > 0, (c - b["o"]) / np.where(rng > 0, rng, 1), 0)
        press = sma(pr, N)
        rate = np.clip(press * 0.0005, -0.0005, 0.0005); prev = np.concatenate([[0], rate[:-1]])
        ret = np.concatenate([[0], c[1:] / c[:-1] - 1])
        ok = (np.sign(prev) == np.sign(rate)) & (np.minimum(np.abs(prev), np.abs(rate)) >= p["minRate"]) & (np.abs(press * 1e5) >= p["minSkew"]) & (np.abs(ret) < p["maxRet"] / 100)
        d = p.get("dir", -1)  # -1 contrarian (as deployed), +1 with-flow
        side[ok & (rate > 0)] = d; side[ok & (rate < 0)] = -d
        stop = np.where(side > 0, c * (1 - p["stopPct"] / 100), c * (1 + p["stopPct"] / 100))
        s["tp"] = np.where(side > 0, c * (1 + p["tpPct"] / 100), np.where(side < 0, c * (1 - p["tpPct"] / 100), 0))
        # exit when the proxy rate no longer "pays" the position (contrarian: short pays when rate > exit)
        recv_short = rate * (-d); recv_long = -rate * (-d)
        s["exl"] = recv_long < p["exitRate"]; s["exs"] = recv_short < p["exitRate"]
        s["time_stop"] = p["maxHoldBars"] * tf_sec
    else:
        raise ValueError(name)
    side = _filters(C, p, side)
    stop = np.where(side != 0, stop, np.nan)
    s["side"] = side; s["stop"] = np.nan_to_num(stop, nan=0.0)
    if name not in ("bbmr", "skewproxy", "lpsweep", "vpnode"):
        _tp(C, p, s, side, s["stop"])
    s["side"][np.isnan(c)] = 0
    return s

@njit(cache=True)
def supertrend(h, l, c, a, m):
    n = len(c); line = np.full(n, np.nan); d = np.zeros(n, np.int8)
    ub = np.nan; lb = np.nan; cur = 1
    for i in range(n):
        if np.isnan(a[i]): continue
        mid = (h[i] + l[i]) / 2; bu = mid + m * a[i]; bl = mid - m * a[i]
        if np.isnan(ub):
            ub = bu; lb = bl
        else:
            ub = bu if (bu < ub or c[i - 1] > ub) else ub
            lb = bl if (bl > lb or c[i - 1] < lb) else lb
        if cur == 1 and c[i] < lb: cur = -1
        elif cur == -1 and c[i] > ub: cur = 1
        d[i] = cur; line[i] = lb if cur == 1 else ub
    return line, d

def random_entries(sig, n_entries, rng, stop_dist_pct, c, mask=None):
    """random control: same exit arrays, random entry bars + sides, stop at the config's median stop distance."""
    n = len(c); s = dict(sig)
    idx = np.arange(n) if mask is None else np.nonzero(mask)[0]
    pick = rng.choice(idx, size=min(n_entries, len(idx)), replace=False)
    side = np.zeros(n, np.int8); side[pick] = rng.choice(np.array([-1, 1], np.int8), size=len(pick))
    s["side"] = side
    s["stop"] = np.where(side > 0, c * (1 - stop_dist_pct), np.where(side < 0, c * (1 + stop_dist_pct), 0.0))
    if np.any(sig["tp"] > 0):  # keep the R multiple of the take-profit if the strategy uses one
        tpd = np.nanmedian(np.abs(sig["tp"][sig["side"] != 0] - c[sig["side"] != 0]) / c[sig["side"] != 0]) if np.any(sig["side"] != 0) else 0
        s["tp"] = np.where(side > 0, c * (1 + tpd), np.where(side < 0, c * (1 - tpd), 0.0))
    return s
