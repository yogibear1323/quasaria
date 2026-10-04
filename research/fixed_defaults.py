"""Zero-degree-of-freedom check: published/default parameters evaluated unchanged on every OOS window + holdout
(no optimisation => no selection bias for these specific configs), with random-entry p-values."""
import sys, json, numpy as np, pandas as pd; sys.path.insert(0, ".")
from robust import ctx, run_slice, TFL, DAY, rng
from strategies import gen, random_entries
from engine import run, metrics
from grids import caps
DEF = {
  "trend (fleet default 20/50/20, 2ATR, 3ATR trail)": ("trend", dict(fast=20, slow=50, breakout=20, stopAtr=2, trailAtr=3)),
  "turtle S1 (20/10, 2N)": ("turtle", dict(n_in=20, n_out=10, stopN=2, trail="none")),
  "turtle S2 (55/20, 2N)": ("turtle", dict(n_in=55, n_out=20, stopN=2, trail="none")),
  "turtle 20/10 + chandelier": ("turtle", dict(n_in=20, n_out=10, stopN=3, trail="chandelier")),
  "tsmom (L=168 bars, H=48)": ("tsmom", dict(L=168, H=48, stopAtr=6, trailAtr=0)),
  "MA cross 50/200 long-only (Faber-style)": ("macross", dict(fast=50, slow=200, stopAtr=5, trail="none", long_only=1)),
  "MACD 12/26/9 + EMA200": ("macd", dict(trendN=200, stopAtr=3, trail="none", tpR=0)),
  "Supertrend 10x3": ("supertrend", dict(n=10, m=3, adx_min=0)),
  "Keltner 20, 2ATR breakout": ("keltner", dict(n=20, m=2, stopAtr=2, trailAtr=0, adx_min=0, tpR=0)),
  "Connors RSI(2) <10 / SMA200": ("rsi2", dict(lo=10, trendN=200, stopAtr=3, timeBars=10)),
  "Bollinger 20/2 + RSI35, no ADX": ("bbmr", dict(n=20, k=2.0, rsiLo=35, maxAdx=100, stopAtr=1.5, timeBars=12)),
  "ORB first 2h UTC": ("orb", dict(rangeH=2, stopMode="range", tpR=0)),
}
rows = []
for tf in [900, 3600, 14400]:
    b, C, fund, (wins, ho, end, t0) = ctx(tf)
    for name, (fam, p) in DEF.items():
        if fam == "orb" and tf > 3600: continue
        sig = gen(fam, C, p, tf)
        per = []; tot = 0; rand = np.zeros(200); ntr = 0
        lo, hi = wins[0][2], wins[-1][3]  # first OOS start .. last OOS end (contiguous)
        tr, eq, bs = run_slice(b, sig, fund, tf, lo, hi, fam)
        m = metrics(tr, eq, bars_per_day=max(1, DAY // tf))
        for (k, a, bb, e) in wins:
            sel = (bs["t"][tr[:, 0].astype(int)] >= bb) & (bs["t"][tr[:, 0].astype(int)] < e) if len(tr) else np.array([], bool)
            per.append(float(tr[sel, 7].sum()) if len(tr) else 0.0)
        i0, i1 = np.searchsorted(b["t"], lo), np.searchsorted(b["t"], hi)
        ss = {kk: (v[i0:i1] if isinstance(v, np.ndarray) else v) for kk, v in sig.items()}
        c = bs["c"]; mk = ss["side"] != 0
        sd = min(max(float(np.median(np.abs(c[mk] - ss["stop"][mk]) / c[mk])) if mk.any() else 0.02, 0.008), 0.075)
        r_, lev = caps(fam)
        for j in range(200):
            rs = random_entries(ss, max(len(tr), 1), rng, sd, c)
            trr, _, _ = run(bs, rs, tf, risk_pct=r_, max_lev=lev, fund=fund[i0:i1]); rand[j] = trr[:, 7].sum() if len(trr) else 0
        trh, eqh, _ = run_slice(b, sig, fund, tf, ho, end, fam); mh = metrics(trh, eqh, bars_per_day=max(1, DAY // tf))
        net = m["net"]
        rows.append(dict(strategy=name, family=fam, tf=TFL[tf], oos_days=round((hi - lo) / DAY), oos_trades=m["trades"], oos_win=round(m["win_rate"], 3) if m["trades"] else None,
                         oos_avg_r=round(m["avg_r"], 3) if m["trades"] else None, oos_net=round(net, 1), oos_pf=round(m["pf"], 2) if m["trades"] else None, oos_dd=round(m["max_dd_pct"], 1),
                         oos_sharpe=round(m["sharpe"], 2) if m["sharpe"] == m["sharpe"] else None, oos_cost_share=round(m["cost_share"], 2) if m["trades"] else None,
                         pos_windows=f"{sum(x > 0 for x in per)}/{len(per)}", ex_best_window=round(net - max(per), 1), p_vs_random=round(float((rand >= net).mean()), 3),
                         ho_trades=mh["trades"], ho_win=round(mh["win_rate"], 3) if mh["trades"] else None, ho_net=round(mh["net"], 1), ho_pf=round(mh["pf"], 2) if mh["trades"] else None, ho_dd=round(mh["max_dd_pct"], 1)))
        print(rows[-1], flush=True)
pd.DataFrame(rows).to_csv("../results/fixed_defaults.csv", index=False)
