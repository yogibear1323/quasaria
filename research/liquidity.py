"""Liquidity-pocket / liquidity-zone signals (candle + volume proxies; no historical order-book depth is available from
public APIs — Coinbase/Kraken only serve the CURRENT book — so 'pockets' are inferred from price structure and traded volume).

  * swing liquidity: confirmed pivot highs/lows (k bars each side) not yet traded through = resting stops above/below
  * equal highs/lows: two pivots within 0.1 ATR = a stop cluster
  * prior-day (UTC) high/low
  * sweep + reclaim: a bar trades through an unswept level and CLOSES back on the other side
  * volume profile (rolling N bars): POC / value area (70 %); value-area re-entry ("80 % rule", Dalton, Mind over Markets)
Everything at bar i uses data up to the close of bar i only (pivots are only usable k bars after they form)."""
import numpy as np
from numba import njit

@njit(cache=True)
def sweep_scan(h, l, c, t, atr, k, L, src, eq_tol):
    """src: 0 pivots, 1 equal highs/lows only, 2 prior-day high/low only, 3 any.
    Returns per bar: long_sweep, short_sweep, sweep extreme, nearest unswept level above/below close (nan if none),
    bars since last sell-side / buy-side sweep."""
    n = len(c)
    ls = np.zeros(n, np.bool_); ss = np.zeros(n, np.bool_); ext = np.full(n, np.nan)
    up = np.full(n, np.nan); dn = np.full(n, np.nan)
    since_sell = np.full(n, 1e9); since_buy = np.full(n, 1e9)
    MAXL = 256
    hl = np.zeros(MAXL); hb = np.zeros(MAXL, np.int64); hon = np.zeros(MAXL, np.bool_); heq = np.zeros(MAXL, np.bool_)
    ll = np.zeros(MAXL); lb = np.zeros(MAXL, np.int64); lon = np.zeros(MAXL, np.bool_); leq = np.zeros(MAXL, np.bool_)
    nh = 0; nl = 0
    day = -1; pdh = np.nan; pdl = np.nan; dh = -1e18; dl = 1e18; pd_h_used = False; pd_l_used = False
    last_sell = -10**9; last_buy = -10**9
    for i in range(n):
        d = t[i] // 86400
        if d != day:
            if day >= 0: pdh = dh; pdl = dl
            day = d; dh = -1e18; dl = 1e18; pd_h_used = False; pd_l_used = False
        # pivot confirmed at i: bar j = i-k is a pivot if extreme over [j-k, j+k]
        j = i - k
        if j - k >= 0:
            isH = True; isL = True
            for q in range(j - k, j + k + 1):
                if h[q] > h[j]: isH = False
                if l[q] < l[j]: isL = False
            if isH:
                slot = nh % MAXL; hl[slot] = h[j]; hb[slot] = j; hon[slot] = True; heq[slot] = False
                tol = eq_tol * (atr[i] if atr[i] == atr[i] else 0.0)
                for q in range(min(nh, MAXL)):
                    if q != slot and hon[q] and i - hb[q] <= L and abs(hl[q] - h[j]) <= tol:
                        heq[q] = True; heq[slot] = True
                nh += 1
            if isL:
                slot = nl % MAXL; ll[slot] = l[j]; lb[slot] = j; lon[slot] = True; leq[slot] = False
                tol = eq_tol * (atr[i] if atr[i] == atr[i] else 0.0)
                for q in range(min(nl, MAXL)):
                    if q != slot and lon[q] and i - lb[q] <= L and abs(ll[q] - l[j]) <= tol:
                        leq[q] = True; leq[slot] = True
                nl += 1
        # sweeps of resting levels on bar i
        swept_low = False; swept_high = False
        if src != 2:
            for q in range(min(nl, MAXL)):
                if lon[q] and i - lb[q] <= L and lb[q] < i - k:
                    if l[i] < ll[q]:
                        if (src == 0 or src == 3 or leq[q]) and c[i] > ll[q]: swept_low = True
                        lon[q] = False
            for q in range(min(nh, MAXL)):
                if hon[q] and i - hb[q] <= L and hb[q] < i - k:
                    if h[i] > hl[q]:
                        if (src == 0 or src == 3 or heq[q]) and c[i] < hl[q]: swept_high = True
                        hon[q] = False
        if src >= 2 and pdl == pdl:
            if not pd_l_used and l[i] < pdl:
                pd_l_used = True
                if c[i] > pdl: swept_low = True
            if not pd_h_used and h[i] > pdh:
                pd_h_used = True
                if c[i] < pdh: swept_high = True
        dh = max(dh, h[i]); dl = min(dl, l[i])
        if swept_low and not swept_high:
            ls[i] = True; ext[i] = l[i]; last_sell = i
        elif swept_high and not swept_low:
            ss[i] = True; ext[i] = h[i]; last_buy = i
        since_sell[i] = i - last_sell; since_buy[i] = i - last_buy
        # nearest resting liquidity above / below the close (for targets and 'room' filters)
        bu = np.inf; bd = -np.inf
        for q in range(min(nh, MAXL)):
            if hon[q] and i - hb[q] <= L and hl[q] > c[i] and hl[q] < bu: bu = hl[q]
        for q in range(min(nl, MAXL)):
            if lon[q] and i - lb[q] <= L and ll[q] < c[i] and ll[q] > bd: bd = ll[q]
        if pdh == pdh and not pd_h_used and pdh > c[i] and pdh < bu: bu = pdh
        if pdl == pdl and not pd_l_used and pdl < c[i] and pdl > bd: bd = pdl
        if bu < np.inf: up[i] = bu
        if bd > -np.inf: dn[i] = bd
    return ls, ss, ext, up, dn, since_sell, since_buy

@njit(cache=True)
def value_area(h, l, c, v, N, bins):
    """rolling volume profile over the N bars BEFORE i: POC, VAH, VAL (70 % of volume)."""
    n = len(c); poc = np.full(n, np.nan); vah = np.full(n, np.nan); val = np.full(n, np.nan)
    for i in range(N, n):
        lo = l[i - N:i].min(); hi = h[i - N:i].max()
        if hi <= lo: continue
        hist = np.zeros(bins); w = (hi - lo) / bins
        for j in range(i - N, i):
            # spread each bar's volume uniformly over its range
            a = int((l[j] - lo) / w); b = int((h[j] - lo) / w)
            if b >= bins: b = bins - 1
            if a >= bins: a = bins - 1
            vol = v[j] if v[j] > 0 else 1e-9
            for q in range(a, b + 1): hist[q] += vol / (b - a + 1)
        p = np.argmax(hist); tot = hist.sum(); acc = hist[p]; a = p; b = p
        while acc < 0.7 * tot:
            na = hist[a - 1] if a > 0 else -1.0; nb = hist[b + 1] if b < bins - 1 else -1.0
            if na < 0 and nb < 0: break
            if nb >= na: b += 1; acc += nb
            else: a -= 1; acc += na
        poc[i] = lo + (p + 0.5) * w; val[i] = lo + a * w; vah[i] = lo + (b + 1) * w
    return poc, vah, val
