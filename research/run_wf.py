"""Walk-forward + holdout evaluation of every config on every timeframe. Writes results/windows_<tf>.parquet-like CSV."""
import sys, json, time, numpy as np, pandas as pd; sys.path.insert(0, ".")
from multiprocessing import Pool
from data import series, bars as B, funding_hourly
from strategies import gen, Cache
from engine import run, metrics
from grids import grids, caps, CURRENT

DAY = 86400
WF = {60: (12, 6, 6), 300: (60, 30, 30), 900: (120, 45, 45), 1800: (120, 45, 45), 3600: (180, 60, 60), 14400: (180, 60, 60)}  # IS, OOS, step (days)
HOLDOUT_DAYS = {60: 10}

def windows(t, tf):
    end = int(t[-1]) + tf; hd = HOLDOUT_DAYS.get(tf, 42)
    ho_start = end - hd * DAY
    IS, OOS, STEP = WF[tf]
    t0 = int(t[0]) + 5 * DAY  # small warm-up
    w = []; k = 0
    while True:
        a = t0 + k * STEP * DAY; b = a + IS * DAY; e = b + OOS * DAY
        if e > ho_start: break
        w.append((k, a, b, e)); k += 1
    return w, ho_start, end, t0

def slice_run(b, sig, fund, tf, lo, hi, fam):
    i0, i1 = np.searchsorted(b["t"], lo), np.searchsorted(b["t"], hi)
    bs = {k: v[i0:i1] for k, v in b.items()}
    ss = {k: (v[i0:i1] if isinstance(v, np.ndarray) else v) for k, v in sig.items()}
    r, lev = caps(fam)
    tr, eq, h = run(bs, ss, tf, risk_pct=r, max_lev=lev, fund=fund[i0:i1])
    m = metrics(tr, eq, bars_per_day=max(1, DAY // tf)); m["halts"] = int(h); m["days"] = (hi - lo) / DAY
    return m, tr, bs

def work(tf):
    t0 = time.time()
    df = series(tf); b = B(df); fund = funding_hourly(b["t"])
    C = Cache(b)
    wins, ho_start, end, tstart = windows(b["t"], tf)
    rows = []
    cfgs = [(fam, p) for fam, ps in grids(tf).items() for p in ps]
    cfgs += [("CURRENT:" + name, p) for name, (fam, ftf, p) in CURRENT.items() if ftf == tf]
    for ci, (fam0, p) in enumerate(cfgs):
        fam = fam0.split(":")[0] if not fam0.startswith("CURRENT") else CURRENT[fam0[8:]][0]
        sig = gen(fam, C, p, tf)
        base = dict(tf=tf, family=fam0 if fam0.startswith("CURRENT") else fam, cfg=json.dumps(p, sort_keys=True))
        for (k, a, bb, e) in wins:
            m, _, _ = slice_run(b, sig, fund, tf, a, bb, fam); rows.append({**base, "fold": k, "seg": "IS", **m})
            m, _, _ = slice_run(b, sig, fund, tf, bb, e, fam); rows.append({**base, "fold": k, "seg": "OOS", **m})
        m, _, _ = slice_run(b, sig, fund, tf, tstart, ho_start, fam); rows.append({**base, "fold": -1, "seg": "PRE", **m})
        m, _, _ = slice_run(b, sig, fund, tf, ho_start, end, fam); rows.append({**base, "fold": -1, "seg": "HOLDOUT", **m})
        # no-cost variant on the pre-holdout period (is there an edge before costs?)
        r, lev = caps(fam)
        i0, i1 = np.searchsorted(b["t"], tstart), np.searchsorted(b["t"], ho_start)
        tr, eq, h = run({kk: v[i0:i1] for kk, v in b.items()}, {kk: (v[i0:i1] if isinstance(v, np.ndarray) else v) for kk, v in sig.items()}, tf, risk_pct=r, max_lev=lev, fee_bps=0, slip_bps=0, fund=np.zeros(i1 - i0))
        mm = metrics(tr, eq, bars_per_day=max(1, DAY // tf)); rows.append({**base, "fold": -1, "seg": "PRE_NOCOST", **mm, "halts": int(h)})
    out = pd.DataFrame(rows)
    out.to_csv(f"../results/windows_{tf}.csv", index=False)
    meta = dict(tf=tf, bars=len(b["c"]), first=int(b["t"][0]), last=int(b["t"][-1]), holdout_start=ho_start, folds=[(k, a, bb, e) for (k, a, bb, e) in wins], configs=len(cfgs), sec=round(time.time() - t0, 1))
    return meta

if __name__ == "__main__":
    tfs = [int(x) for x in sys.argv[1:]] or [60, 300, 900, 1800, 3600, 14400]
    with Pool(len(tfs)) as pool:
        metas = pool.map(work, tfs)
    json.dump(metas, open("../results/wf_meta.json", "w"), indent=1)
    for m in metas: print(m["tf"], m["bars"], m["configs"], "configs", len(m["folds"]), "folds", m["sec"], "s")
