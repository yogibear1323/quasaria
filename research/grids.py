"""Parameter grids (pre-declared before any results were looked at; every config is counted in the multiple-testing tally)."""
from itertools import product

def P(**kw):
    keys = list(kw); return [dict(zip(keys, v)) for v in product(*kw.values())]

def grids(tf):
    g = {}
    g["trend"] = [dict(fast=f, slow=s, breakout=b, stopAtr=sa, trailAtr=ta, adx_min=ad, tpR=tp)
                  for (f, s) in [(9, 21), (20, 50), (50, 200)] for b in [10, 20, 55] for sa in [2, 3, 4] for ta in [0, 3] for ad in [0, 25] for tp in [0, 3]]
    g["turtle"] = [dict(n_in=a, n_out=b, stopN=s, trail=t) for (a, b) in [(20, 10), (55, 20), (100, 50)] for s in [2, 3] for t in ["none", "chandelier"]]
    g["tsmom"] = P(L=[12, 48, 168, 500], H=[12, 48], stopAtr=[3, 6], trailAtr=[0, 4])
    g["macross"] = [dict(fast=f, slow=s, stopAtr=sa, trail=t, long_only=lo) for (f, s) in [(10, 30), (20, 100), (50, 200)] for sa in [3, 5] for t in ["none", "chandelier"] for lo in [0, 1]]
    g["bbmr"] = P(n=[20], k=[1.5, 2.0, 2.5], rsiLo=[28, 35, 40], maxAdx=[20, 30, 100], stopAtr=[1.5, 3], timeBars=[12, 48])
    g["rsi2"] = P(lo=[5, 10, 20], trendN=[100, 200], stopAtr=[2, 3, 5], timeBars=[5, 10, 20])
    g["keltner"] = P(n=[20, 50], m=[1.5, 2, 3], stopAtr=[2, 3], trailAtr=[0, 3], adx_min=[0, 25], tpR=[0, 3])
    if tf <= 3600:
        g["orb"] = P(rangeH=[1, 2, 4, 8], stopMode=["range", "mid"], tpR=[0, 2])
    g["macd"] = P(trendN=[50, 200], stopAtr=[2, 3, 5], trail=["none", "chandelier"], tpR=[0, 3])
    g["supertrend"] = P(n=[10, 20], m=[2, 3, 4], adx_min=[0, 25])
    g["skewproxy"] = P(N=[4, 10, 20], dir=[-1, 1], stopPct=[0.8, 1.5, 3], tpPct=[1, 2, 4], maxHoldBars=[8, 30], minRate=[0.0001], minSkew=[10000], exitRate=[0.00002], maxRet=[1.2])
    return g

DESK_CAPS = {  # risk % / max leverage per family, matching the fleet desk that runs that style
    "bbmr": (1.0, 4), "rsi2": (1.0, 4), "skewproxy": (0.75, 3),
}
def caps(fam): return DESK_CAPS.get(fam, (1.0, 5))

# current demo Active desk configs (baseline) and fleet (strict) configs
CURRENT = {
    "echo (Active 15s mean-rev, evaluated at 1m)": ("bbmr", 60, dict(n=20, k=1.5, rsiLo=40, maxAdx=35, stopAtr=1.5, timeBars=20)),
    "halo (Active 30s mean-rev, evaluated at 1m)": ("bbmr", 60, dict(n=20, k=1.6, rsiLo=38, maxAdx=32, stopAtr=1.5, timeBars=16)),
    "lyra (Active 1m skew proxy)": ("skewproxy", 60, dict(N=10, dir=-1, minRate=0.0001, exitRate=0.00002, minSkew=10000, maxRet=0.6, stopPct=0.8, tpPct=1.0, maxHoldBars=30)),
    "vega (Active 5m trend)": ("trend", 300, dict(fast=9, slow=21, breakout=10, stopAtr=2, trailAtr=3)),
    "regal (Active 15m trend)": ("trend", 900, dict(fast=9, slow=21, breakout=10, stopAtr=2, trailAtr=3)),
    "nova (Active 30m skew proxy)": ("skewproxy", 1800, dict(N=4, dir=-1, minRate=0.00009, exitRate=0.00002, minSkew=9000, maxRet=1.2, stopPct=1.0, tpPct=1.5, maxHoldBars=8)),
    "vega (fleet 1h trend)": ("trend", 3600, dict(fast=20, slow=50, breakout=20, stopAtr=2, trailAtr=3)),
    "regal (fleet 4h trend)": ("trend", 14400, dict(fast=20, slow=50, breakout=20, stopAtr=2, trailAtr=3)),
    "echo (fleet 15m mean-rev)": ("bbmr", 900, dict(n=20, k=2.2, rsiLo=28, maxAdx=20, stopAtr=1.5, timeBars=12)),
    "halo (fleet 1h mean-rev)": ("bbmr", 3600, dict(n=20, k=2.2, rsiLo=28, maxAdx=20, stopAtr=1.5, timeBars=12)),
}
