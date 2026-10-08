"""State engine (research mirror of bot/src/office/calibrated/snapshot.ts).

One compact, deterministic snapshot per closed candle. The snapshot for a decision at time T is computed ONLY from
bars whose close time (t + gran) is <= T, i.e. every input is timestamped strictly before the decision. The function
takes a fixed window of the last W closed bars so the TypeScript port reproduces it exactly (parity test fixture).

Fields that have no history (live L2 spread, order-book imbalance, live funding) are logged by the live desk but are
NOT model inputs, because they cannot be backtested.
"""
import math
import numpy as np

W = 200  # bars in the snapshot window
FEATURES = ["r1z", "r3z", "r12z", "r48z", "volr", "trend1", "trend2", "er24", "rpos48", "bp6", "bp24", "volz", "rsi", "hlr"]


def ema_last(v, n):
    """Same definition as indicators.ts emaSeries: SMA seed at index n-1, then k = 2/(n+1)."""
    k = 2.0 / (n + 1)
    e = sum(v[:n]) / n
    for x in v[n:]:
        e = x * k + e * (1 - k)
    return e


def atr_last(h, l, c, n=14):
    """Wilder ATR, same as indicators.ts atr()."""
    tr = lambda i: (h[i] - l[i]) if i == 0 else max(h[i] - l[i], abs(h[i] - c[i - 1]), abs(l[i] - c[i - 1]))
    a = sum(tr(i) for i in range(1, n + 1)) / n
    for i in range(n + 1, len(c)):
        a = (a * (n - 1) + tr(i)) / n
    return a


def rsi_last(v, n=14):
    g = l = 0.0
    for i in range(1, n + 1):
        d = v[i] - v[i - 1]
        if d > 0: g += d
        else: l -= d
    g /= n; l /= n
    for i in range(n + 1, len(v)):
        d = v[i] - v[i - 1]
        g = (g * (n - 1) + max(d, 0)) / n
        l = (l * (n - 1) + max(-d, 0)) / n
    if l == 0: return 100.0
    return 100 - 100 / (1 + g / l)


def pstd(x):
    m = sum(x) / len(x)
    return math.sqrt(sum((a - m) ** 2 for a in x) / len(x))


def snapshot(o, h, l, c, v):
    """o,h,l,c,v: python lists (oldest -> newest), length W, last element = the decision bar (closed)."""
    assert len(c) == W
    lr = [math.log(c[i] / c[i - 1]) for i in range(1, W)]
    rv24, rv96 = pstd(lr[-24:]), pstd(lr[-96:])
    rv96 = rv96 if rv96 > 0 else 1e-9
    a = atr_last(h, l, c, 14)
    a = a if a > 0 else 1e-12
    e20, e50, e100 = ema_last(c, 20), ema_last(c, 50), ema_last(c, 100)
    path = sum(abs(c[i] - c[i - 1]) for i in range(W - 24, W))
    hi48, lo48 = max(h[-48:]), min(l[-48:])
    clv = [((c[i] - l[i]) - (h[i] - c[i])) / (h[i] - l[i]) if h[i] > l[i] else 0.0 for i in range(W)]
    def bp(k):
        sv = sum(v[-k:])
        return sum(clv[i] * v[i] for i in range(W - k, W)) / sv if sv > 0 else 0.0
    mv6, mv96 = sum(v[-6:]) / 6, sum(v[-96:]) / 96
    hl6 = sum(math.log(h[i] / l[i]) for i in range(W - 6, W)) / 6
    return {
        "r1z": lr[-1] / rv96,
        "r3z": math.log(c[-1] / c[-4]) / (rv96 * math.sqrt(3)),
        "r12z": math.log(c[-1] / c[-13]) / (rv96 * math.sqrt(12)),
        "r48z": math.log(c[-1] / c[-49]) / (rv96 * math.sqrt(48)),
        "volr": rv24 / rv96,
        "trend1": (c[-1] - e50) / a,
        "trend2": (e20 - e100) / a,
        "er24": abs(c[-1] - c[-25]) / path if path > 0 else 0.0,
        "rpos48": (c[-1] - lo48) / (hi48 - lo48) if hi48 > lo48 else 0.5,
        "bp6": bp(6),
        "bp24": bp(24),
        "volz": math.log(mv6 / mv96) if mv6 > 0 and mv96 > 0 else 0.0,
        "rsi": (rsi_last(c, 14) - 50) / 50,
        "hlr": hl6 / (a / c[-1]),
        # not features, carried for sizing / geometry
        "_atr": a, "_close": c[-1], "_rv96": rv96,
    }


def snapshot_matrix(df, gran):
    """Snapshot for every bar i >= W-1 of a contiguous bar frame (columns t,o,h,l,c,v).
    Row i is the decision at T_i = t_i + gran and uses rows i-W+1..i only (all closed by T_i)."""
    o, h, l, c, v = (df[k].astype(float).tolist() for k in "ohlcv")
    n = len(c)
    rows = []
    for i in range(W - 1, n):
        s = i - W + 1
        rows.append(snapshot(o[s:i + 1], h[s:i + 1], l[s:i + 1], c[s:i + 1], v[s:i + 1]))
    X = np.full((n, len(FEATURES)), np.nan)
    atr = np.full(n, np.nan)
    X[W - 1:] = np.array([[r[f] for f in FEATURES] for r in rows])
    atr[W - 1:] = [r["_atr"] for r in rows]
    return X, atr
