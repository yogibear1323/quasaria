"""Liquidity-pocket study: standalone (lpsweep, vpnode) on 15m/1h/4h and as an entry filter on the three recommended
slower desks. Same walk-forward windows, untouched holdout, costs, 300-run random-entry control and config tally as the
main study (run_wf.py / robust.py)."""
import sys, json, numpy as np, pandas as pd; sys.path.insert(0, ".")
from itertools import product
from data import series, bars as B, funding_hourly
from strategies import gen, Cache, random_entries
from engine import run, metrics
from grids import caps
from run_wf import windows
DAY = 86400; TFL = {900: "15m", 3600: "1h", 14400: "4h"}
rng = np.random.default_rng(42)
STAND = {
    "lpsweep": [dict(k=k, src=s, L=L, buf=b, tgt=t, align=a, timeBars=48) for k, s, L, b, t, a in product([2, 3, 5], [0, 1, 2, 3], [50, 150], [0.25, 0.5], ["2R", "3R", "opp"], [0, 1])],
    "vpnode": [dict(N=N, buf=b, tgt=t, timeBars=tb) for N, b, t, tb in product([48, 96, 192], [0.25, 0.5], ["poc", "2R"], [12, 48])],
}
FILTERS = [None, ("sweep", 6), ("sweep", 12), ("sweep", 24), ("room", 1), ("room", 2), ("room", 3)]
DESKS = {  # recommended slower desks (as deployed)
    "Vega 1h Supertrend 10x3": ("supertrend", 3600, dict(n=10, m=3, adx_min=0)),
    "Regal 4h trend (fleet 20/50/20)": ("trend", 14400, dict(fast=20, slow=50, breakout=20, stopAtr=2, trailAtr=3)),
    "Halo 1h mean-rev (fleet BB20/2.2)": ("bbmr", 3600, dict(n=20, k=2.2, rsiLo=28, maxAdx=20, stopAtr=1.5, timeBars=12)),
}
CTX = {}
def ctx(tf):
    if tf not in CTX:
        b = B(series(tf)); CTX[tf] = (b, Cache(b), funding_hourly(b["t"]), windows(b["t"], tf))
    return CTX[tf]
def sl(b, sig, fund, tf, lo, hi, fam, rand=None):
    i0, i1 = np.searchsorted(b["t"], lo), np.searchsorted(b["t"], hi)
    bs = {k: v[i0:i1] for k, v in b.items()}; ss = {k: (v[i0:i1] if isinstance(v, np.ndarray) else v) for k, v in sig.items()}
    r, lev = caps(fam)
    tr, eq, h = run(bs, ss, tf, risk_pct=r, max_lev=lev, fund=fund[i0:i1])
    m = metrics(tr, eq, bars_per_day=max(1, DAY // tf)); m["halts"] = int(h)
    out = [m]
    if rand:
        c = bs["c"]; mk = ss["side"] != 0
        sd = min(max(float(np.median(np.abs(c[mk] - ss["stop"][mk]) / c[mk])) if mk.any() else 0.02, 0.008), 0.075)
        nets = np.zeros(rand)
        for j in range(rand):
            rs = random_entries(ss, max(m["trades"], 1), rng, sd, c)
            trr, _, _ = run(bs, rs, tf, risk_pct=r, max_lev=lev, fund=fund[i0:i1]); nets[j] = trr[:, 7].sum() if len(trr) else 0
        out.append(nets)
    return out

def pooled(ms):
    t = sum(m["trades"] for m in ms)
    if not t: return dict(trades=0, net=0.0)
    W = sum(m["avg_win"] * round(m["win_rate"] * m["trades"]) for m in ms if m["trades"])
    nw = sum(round(m["win_rate"] * m["trades"]) for m in ms if m["trades"])
    Lo = sum(m["avg_loss"] * (m["trades"] - round(m["win_rate"] * m["trades"])) for m in ms if m["trades"])
    nl = t - nw
    return dict(trades=t, win_rate=nw / t, net=sum(m["net"] for m in ms), avg_win=W / nw if nw else 0, avg_loss=Lo / nl if nl else 0,
                pf=W / -Lo if Lo < 0 else np.inf, max_dd_pct=max(m["max_dd_pct"] for m in ms))

rows = []; summary = []; n_cfg = 0
# ---------- standalone, walk-forward
for tf in (900, 3600, 14400):
    b, C, fund, (wins, ho, end, t0) = ctx(tf)
    for fam, grid in STAND.items():
        res = []
        for p in grid:
            n_cfg += 1
            sig = gen(fam, C, p, tf)
            per = {}
            for (k, a, bb, e) in wins:
                per[("IS", k)] = sl(b, sig, fund, tf, a, bb, fam)[0]; per[("OOS", k)] = sl(b, sig, fund, tf, bb, e, fam)[0]
            per[("PRE", -1)] = sl(b, sig, fund, tf, t0, ho, fam)[0]; per[("HO", -1)] = sl(b, sig, fund, tf, ho, end, fam)[0]
            res.append((p, sig, per))
            for (seg, k), m in per.items(): rows.append(dict(tf=tf, family=fam, cfg=json.dumps(p), seg=seg, fold=k, **m))
        # WF selection by IS net (>= 8 trades)
        sel_ms = []; rand_tot = np.zeros(300); picks = []
        for (k, a, bb, e) in wins:
            cand = [(r[2][("IS", k)]["net"], i) for i, r in enumerate(res) if r[2][("IS", k)]["trades"] >= 8]
            if not cand: continue
            i = max(cand)[1]; picks.append(json.dumps(res[i][0]))
            m, rn = sl(b, res[i][1], fund, tf, bb, e, fam, rand=300); sel_ms.append(m); rand_tot += rn
        P = pooled(sel_ms); netv = P["net"]
        best_pre = max(res, key=lambda r: r[2][("PRE", -1)]["net"] if r[2][("PRE", -1)]["trades"] >= 20 else -1e9)
        hom = best_pre[2][("HO", -1)]
        summary.append(dict(kind="standalone", name=f"{fam} {TFL[tf]}", **{f"oos_{k}": v for k, v in P.items()},
                            oos_pos_windows=f"{sum(m['net'] > 0 for m in sel_ms)}/{len(sel_ms)}", p_vs_random=float((rand_tot >= netv).mean()), random_median=float(np.median(rand_tot)),
                            ho_cfg=json.dumps(best_pre[0]), ho_trades=hom["trades"], ho_win_rate=hom["win_rate"], ho_net=hom["net"], ho_pf=hom["pf"], ho_avg_win=hom["avg_win"], ho_avg_loss=hom["avg_loss"], ho_dd=hom["max_dd_pct"],
                            pre_net_of_ho_cfg=best_pre[2][("PRE", -1)]["net"], configs=len(grid)))
        print(summary[-1]["name"], round(netv, 1), P.get("win_rate"), "HO", round(hom["net"], 1), flush=True)
# ---------- filters on the recommended desks: each filter fixed over all OOS windows (contiguous) + holdout; and WF-selected filter
for name, (fam, tf, p0) in DESKS.items():
    b, C, fund, (wins, ho, end, t0) = ctx(tf)
    lo, hi = wins[0][2], wins[-1][3]
    sigs = {}
    for f in FILTERS:
        if f is not None: n_cfg += 1
        p = dict(p0, lpf=f) if f else dict(p0)
        sig = gen(fam, C, p, tf); sigs[f] = sig
        m, rn = sl(b, sig, fund, tf, lo, hi, fam, rand=300)
        hm = sl(b, sig, fund, tf, ho, end, fam)[0]
        per = [sl(b, sig, fund, tf, bb, e, fam)[0]["net"] for (k, a, bb, e) in wins]
        summary.append(dict(kind="filter", name=f"{name} + {('none (baseline)' if f is None else f'{f[0]} {f[1]}')}", oos_trades=m["trades"], oos_win_rate=m["win_rate"], oos_net=m["net"],
                            oos_avg_win=m["avg_win"], oos_avg_loss=m["avg_loss"], oos_pf=m["pf"], oos_max_dd_pct=m["max_dd_pct"], oos_pos_windows=f"{sum(x > 0 for x in per)}/{len(per)}",
                            p_vs_random=float((rn >= m["net"]).mean()), random_median=float(np.median(rn)),
                            ho_trades=hm["trades"], ho_win_rate=hm["win_rate"], ho_net=hm["net"], ho_pf=hm["pf"], ho_avg_win=hm["avg_win"], ho_avg_loss=hm["avg_loss"], ho_dd=hm["max_dd_pct"], configs=1))
        print(summary[-1]["name"], round(m["net"], 1), m["win_rate"], "HO", round(hm["net"], 1), flush=True)
    # WF: choose the filter (incl. none) with the best IS net each window
    ms = []; picks = []
    for (k, a, bb, e) in wins:
        isr = [(sl(b, sigs[f], fund, tf, a, bb, fam)[0]["net"], i) for i, f in enumerate(FILTERS)]
        f = FILTERS[max(isr)[1]]; picks.append(str(f)); ms.append(sl(b, sigs[f], fund, tf, bb, e, fam)[0])
    P = pooled(ms)
    summary.append(dict(kind="filter-WF", name=f"{name} + WF-selected filter", **{f"oos_{k}": v for k, v in P.items()}, oos_pos_windows=f"{sum(m['net'] > 0 for m in ms)}/{len(ms)}", picks="; ".join(picks), configs=0))
S = pd.DataFrame(summary); S.to_csv("../results/lp_summary.csv", index=False)
pd.DataFrame(rows).to_csv("../results/lp_windows.csv", index=False)
json.dump(dict(new_configs=n_cfg, previous_configs=4196 + 10, total=n_cfg + 4206, bonferroni_alpha_total=0.05 / (n_cfg + 4206), bonferroni_alpha_lp=0.05 / n_cfg), open("../results/lp_tally.json", "w"), indent=1)
print("configs", n_cfg)
