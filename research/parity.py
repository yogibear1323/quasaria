"""Parity: python engine vs real TS demo engine on the same 3-day cached window (1m stepping, $500 single desk, funding 0)."""
import sys, json, numpy as np; sys.path.insert(0, ".")
from data import load, aggregate, bars as B
from strategies import gen, Cache
from engine import run, DEFAULT_G

J = json.load(open("/tmp/parity_bars.json")); start, end = J["start"], J["end"]
m1 = load(60); m1 = m1[(m1.t >= start - 300 * 60) & (m1.t + 60 <= end)].reset_index(drop=True)
frames = {300: load(300), 900: load(900)}; frames[1800] = aggregate(frames[900], 900, 2); frames[60] = m1
desks = {
  "vega": ("trend", 300, dict(fast=9, slow=21, breakout=10, stopAtr=2, trailAtr=3), 1.0, 5),
  "rigel": ("trend", 900, dict(fast=9, slow=21, breakout=10, stopAtr=2, trailAtr=3), 1.0, 5),
  "lyra": ("skewproxy", 60, dict(N=10, minRate=0.0001, exitRate=0.00002, minSkew=10000, maxRet=0.6, stopPct=0.8, tpPct=1.0, maxHoldBars=30), 0.75, 3),
  "nova": ("skewproxy", 1800, dict(N=4, minRate=0.00009, exitRate=0.00002, minSkew=9000, maxRet=1.2, stopPct=1.0, tpPct=1.5, maxHoldBars=8), 0.75, 3),
}
res = {}
for d, (fam, tf, p, risk, lev) in desks.items():
    tfb = frames[tf]; tfb = tfb[tfb.t + tf <= end].reset_index(drop=True); tfb = tfb[tfb.t >= start - 400 * tf].reset_index(drop=True)
    sig = gen(fam, Cache(B(tfb)), p, tf)
    # map TF-close signals onto the 1m bar whose close equals the TF close
    b1 = B(m1); n = len(b1["c"]); idx = np.searchsorted(b1["t"] + 60, tfb.t.values + tf)
    ok = (idx < n) & (b1["t"][np.clip(idx, 0, n - 1)] + 60 == tfb.t.values + tf)
    s1 = dict(side=np.zeros(n, np.int8), stop=np.zeros(n), tp=np.zeros(n), exl=np.zeros(n, bool), exs=np.zeros(n, bool), trl=np.full(n, np.nan), trs=np.full(n, np.nan), time_stop=sig["time_stop"])
    for k in ["side", "stop", "tp", "exl", "exs", "trl", "trs"]: s1[k][idx[ok]] = sig[k][ok]
    s1["side"][b1["t"] + 60 <= start] = 0
    G = DEFAULT_G.copy(); G[9] = 0  # demo replay fills stops at the stop price
    tr, eq, h = run(b1, s1, 60, risk_pct=risk, max_lev=lev, G=G)
    w = b1["t"][tr[:, 0].astype(int)] + 60 > start
    tr = tr[w]
    ts = json.load(open(f"/tmp/parity_{d}.json"))
    ts_open = [x["at"] for x in ts["trades"] if x["k"] == "open"]
    py_open = list((b1["t"][tr[:, 0].astype(int)] + 60).astype(int))
    match = len(set(ts_open) & set(py_open))
    res[d] = dict(ts_trades=len(ts_open), py_trades=len(py_open), same_entry_time=match, ts_net=round(ts["net"], 2), py_net=round(float(tr[:, 7].sum()), 2))
    print(d, res[d])
json.dump(res, open("../results/parity.json", "w"), indent=1)
