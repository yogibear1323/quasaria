"""Strategy gate for the calibrated desk: DSR across trials, random-entry control, holdout, regimes, calibration, model export.
Reads results/quant/wf_results.pkl (run_gate.py) and writes results/quant/{configs.csv,gate.json,reliability_*.csv,*.png},
bot/office.calibrated.model.json and strategy.md."""
import json, math, os, pickle, sys
for _v in ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS"): os.environ.setdefault(_v, "1")
import numpy as np, pandas as pd
sys.path.insert(0, os.path.dirname(__file__))
import run_gate as R
from common import simulate, metrics, deflated_sharpe, brier, QUESTIONS
from snapshot import FEATURES, W

ROOT = os.path.join(os.path.dirname(__file__), "..", "..")
OUT = R.OUT
res = pickle.load(open(os.path.join(OUT, "wf_results.pkl"), "rb"))
N_TRIALS = len(res) + R.PRIOR_TRIALS
sr_var = float(np.var([r["fixed"]["sr_daily"] for r in res], ddof=1))

rows = []
for r in res:
    m = r["fixed"]
    dsr, sr0 = deflated_sharpe(m["sr_daily"], m["n_days"], m["skew"], m["kurt"], N_TRIALS, sr_var)
    r["dsr"], r["sr0"] = dsr, sr0
    c = r["calibration"]
    rows.append(dict(tf=r["tf_label"], tp_atr=r["tp"], sl_atr=r["sl"], model=r["model"], folds=r["folds"],
                     oos_from=pd.Timestamp(r["oos_from"], unit="s").date(), oos_to=pd.Timestamp(r["oos_to"], unit="s").date(),
                     trades=m["trades"], net_usd=round(m["net"], 1), hit=round(m["hit"], 3), sharpe=round(m["sharpe"], 2), max_dd=round(m["max_dd"], 3),
                     tstat=round(m["tstat"], 2), pf=round(m["pf"], 2), dsr=round(dsr, 3), halts=m["halts"],
                     kelly_trades=r["kelly"]["trades"], kelly_net=round(r["kelly"]["net"], 1), kelly_sharpe=round(r["kelly"]["sharpe"], 2),
                     brier_setup=round(np.nanmean([c["setup_long"]["brier"], c["setup_short"]["brier"]]), 4),
                     bss_setup=round(np.nanmean([c["setup_long"]["bss"], c["setup_short"]["bss"]]), 4),
                     bss_direction=round(c["direction"]["bss"], 4), ece_setup=round(np.nanmean([c["setup_long"]["ece"], c["setup_short"]["ece"]]), 4)))
cfg = pd.DataFrame(rows).sort_values("sharpe", ascending=False)
cfg.to_csv(os.path.join(OUT, "configs.csv"), index=False)
best = max(res, key=lambda r: r["fixed"]["sharpe"])
bi = res.index(best)
tf = best["tf"]; geom = (best["tp"], best["sl"]); kind = best["model"]
print("best", best["tf_label"], geom, kind, best["fixed"])

# ---- data for the best config
R.DATA[tf] = R.prep(tf)
df, X, atr, lab, bt = R.DATA[tf]
g = R.GEOMS.index(geom); T = R.TF[tf]["T"]
t = df.t.to_numpy(); tc = t + tf
valid = np.isfinite(X).all(1)
L = R.label_matrix(lab, bt, g)
a = int(np.searchsorted(tc, best["oos_from"], side="right")); b = int(np.searchsorted(tc, R.HOLDOUT_START, side="right"))
m_best = best["fixed"]

# ---- random-entry control: same exits/sizing/costs, random entry bars + sides at the same rate
rng = np.random.default_rng(7)
rate = m_best["trades"] / max(1, (b - a)) * 1.6
rand = []
for _ in range(300):
    sides = np.zeros(len(t), int)
    pick = rng.random(len(t)) < rate
    sides[pick] = rng.choice([-1, 1], pick.sum())
    tr, cv = simulate(df, tf, (a, b), sides, np.full(len(t), R.FIXED_RISK), bt[g])
    rand.append(metrics(tr, cv, t[a:b] + tf))
rand_net = np.array([x["net"] for x in rand]); rand_sh = np.array([x["sharpe"] for x in rand])
p_random = float((rand_sh >= m_best["sharpe"]).mean())

# ---- regimes over the OOS span (trailing 30 d XLM return and volatility at trade open)
daily = df.assign(d=pd.to_datetime(tc, unit="s")).set_index("d").c.resample("1D").last().ffill()
r30 = daily.pct_change(30); v30 = np.log(daily).diff().rolling(30).std()
vmed = v30[(v30.index >= pd.Timestamp(best["oos_from"], unit="s"))].median()
def regime(ts):
    d = pd.Timestamp(ts, unit="s").normalize()
    rr, vv = r30.asof(d), v30.asof(d)
    base = "bull" if rr > 0.15 else "bear" if rr < -0.15 else "range"
    return base + ("/high-vol" if vv > vmed else "/low-vol")
reg = {}
for tr_ in best["trades"]:
    k = regime(tr_["t_open"]); reg.setdefault(k, []).append(tr_["pnl"])
regimes = {k: dict(trades=len(v), net=round(float(np.sum(v)), 1), hit=round(float(np.mean(np.array(v) > 0)), 3)) for k, v in sorted(reg.items())}

# ---- holdout: retrain on the window ending at the holdout start, thresholds from its calibration slice, run once
P, th, info = R.fit_fold(X, L, valid, tc, R.HOLDOUT_START, R.NOW, T, kind, df, tf, bt, geom)
ho = (tc > R.HOLDOUT_START) & valid
sides, p_setup, _ = R.decide(P, th)
sides = np.where(ho, sides, 0)
ha = int(np.searchsorted(tc, R.HOLDOUT_START, side="right")); hb = len(t) - T  # leave the last T bars to resolve
trh, cvh = simulate(df, tf, (ha, hb), sides, np.full(len(t), R.FIXED_RISK), bt[g])
m_ho = metrics(trh, cvh, t[ha:hb] + tf)
cal_ho = {q: brier(P[q][ha:hb], L[q][ha:hb]) for q in QUESTIONS}

# ---- calibration verdict on the walk-forward OOS predictions of the best config
cal = best["calibration"]
def verified(c):
    return c["bss"] > 0 and c["ece"] < 0.03
cal_ok = verified(cal["setup_long"]) and verified(cal["setup_short"])
for q in QUESTIONS:
    pd.DataFrame(cal[q]["reliability"]).to_csv(os.path.join(OUT, f"reliability_{q}.csv"), index=False)
try:
    import matplotlib; matplotlib.use("Agg"); import matplotlib.pyplot as plt
    fig, axs = plt.subplots(2, 3, figsize=(11, 7), facecolor="#0b0a12")
    for ax, q in zip(axs.flat, QUESTIONS):
        rel = pd.DataFrame(cal[q]["reliability"])
        ax.set_facecolor("#0b0a12"); ax.plot([0, 1], [0, 1], color="#555", lw=1)
        if len(rel): ax.plot(rel.p_mean, rel.y_rate, "o-", color="#38e1ff")
        ax.set_title(f"{q}  Brier {cal[q]['brier']:.3f} (clim {cal[q]['brier_climatology']:.3f})", color="#ddd", fontsize=9)
        ax.tick_params(colors="#aaa"); ax.set_xlim(0, 1); ax.set_ylim(0, 1)
    fig.suptitle(f"Reliability, walk-forward OOS ({best['tf_label']} TP{geom[0]}/SL{geom[1]} {kind}) - simulated", color="#ddd")
    fig.tight_layout(); fig.savefig(os.path.join(OUT, "reliability.png"), dpi=110, facecolor="#0b0a12")
except Exception as e:
    print("plot skipped", e)

G = R.GATE
checks = dict(sharpe=m_best["sharpe"] > G["sharpe"], max_dd=m_best["max_dd"] < G["max_dd"], hit=m_best["hit"] > G["hit"], tstat=m_best["tstat"] > G["tstat"],
              dsr=best["dsr"] >= G["dsr"], random_control=p_random < G["random_p"], holdout_positive=m_ho["net"] > 0)
passed = all(checks.values())
gate = dict(passed=passed, checks=checks, n_trials=N_TRIALS, sr_var_daily=sr_var,
            best=dict(tf=best["tf_label"], tp_atr=geom[0], sl_atr=geom[1], model=kind, oos_from=str(pd.Timestamp(best["oos_from"], unit="s").date()), oos_to=str(pd.Timestamp(best["oos_to"], unit="s").date()),
                      folds=best["folds"], **{k: m_best[k] for k in ("trades", "net", "hit", "sharpe", "max_dd", "tstat", "pf", "halts", "avg_r")}, dsr=best["dsr"], sr0_daily=best["sr0"],
                      kelly=dict(trades=best["kelly"]["trades"], net=best["kelly"]["net"], sharpe=best["kelly"]["sharpe"], max_dd=best["kelly"]["max_dd"]),
                      thresholds_by_fold=[{k: v for k, v in fr.items() if k in ("start", "setup", "dir", "reg", "sel_sharpe", "sel_trades")} for fr in best["fold_rows"]]),
            random_control=dict(runs=300, p_sharpe=p_random, net_median=float(np.median(rand_net)), net_p95=float(np.percentile(rand_net, 95)), sharpe_median=float(np.median(rand_sh)), trades_median=float(np.median([x["trades"] for x in rand]))),
            holdout=dict(start=str(pd.Timestamp(R.HOLDOUT_START, unit="s").date()), end=str(pd.Timestamp(int(tc[hb - 1]), unit="s").date()), thresholds=th, **{k: m_ho[k] for k in ("trades", "net", "hit", "sharpe", "max_dd", "tstat")},
                         brier={q: cal_ho[q].get("brier") for q in QUESTIONS}),
            regimes=regimes,
            calibration=dict(verified=cal_ok, rule="Brier skill > 0 and ECE < 0.03 on both setup questions (walk-forward OOS)",
                             per_question={q: {k: cal[q][k] for k in ("n", "brier", "brier_climatology", "bss", "ece", "base_rate")} for q in QUESTIONS}),
            costs="10 bps open fee + 5 bps slippage on every fill (entry, stop, target, time exit) + funding (Kraken PF_XLMUSD hourly, capped 0.05 %/h; 0.001 %/h adverse before Oct 2025)",
            sizing="fixed 0.5 % equity at risk per trade (Kelly variant reported separately); $500 start; fleet risk rules (3 % daily loss stop, 10 % drawdown halt with 7-day reset, 5-loss 4 h pause, 6 entries/day, 1 open)")
json.dump(gate, open(os.path.join(OUT, "gate.json"), "w"), indent=1, default=float)
print(json.dumps({k: gate[k] for k in ("passed", "checks")}, default=str))

# ---- export the best candidate's model for the shadow desk: same kind/geometry/timeframe, trained on the latest window
exp_kind = kind
P2, th2, info2 = R.fit_fold(X, L, valid, tc, int(tc[-1]) + tf, int(tc[-1]) + tf, T, exp_kind, df, tf, bt, geom)
qs = {}
for q in QUESTIONS:
    mdl = R.MODELS_LAST[q]
    base = dict(mean=mdl.sc.mean_.tolist(), scale=mdl.sc.scale_.tolist(), iso=dict(x=mdl.iso.X_thresholds_.tolist(), y=mdl.iso.y_thresholds_.tolist()))
    if exp_kind == "logit":
        qs[q] = dict(kind="logit", coef=mdl.m.coef_[0].tolist(), intercept=float(mdl.m.intercept_[0]), **base)
    else:
        trees = []
        for it in mdl.m._predictors:
            nd = it[0].nodes
            trees.append(dict(f=nd["feature_idx"].tolist(), t=[round(float(x), 10) for x in nd["num_threshold"]], l=nd["left"].tolist(), r=nd["right"].tolist(),
                              v=[round(float(x), 10) for x in nd["value"]], leaf=nd["is_leaf"].astype(int).tolist(), ml=nd["missing_go_to_left"].astype(int).tolist()))
        qs[q] = dict(kind="gbt", baseline=float(np.ravel(mdl.m._baseline_prediction)[0]), trees=trees, **base)
lo = pd.Timestamp(int(tc[-1]) + tf - R.TF[tf]["train_days"] * 86400, unit="s")
model = dict(schema="quasaria-calibrated-model@1", trainedAt=pd.Timestamp.now(tz="UTC").isoformat(), trainWindow=dict(**{"from": str(lo)}, to=str(pd.Timestamp(int(tc[-1]) - T * tf, unit="s"))),
             timeframeSec=tf, horizonBars=T, geometry=dict(tpAtr=geom[0], slAtr=geom[1]), features=FEATURES, questions=qs,
             thresholds=dict(setup=th2["setup"], direction=th2["dir"], regime=th2["reg"], pressure=R.TH_BP, risk=R.TH_RISK), weights=R.WEIGHTS,
             sizing=dict(fixedRiskPct=R.FIXED_RISK * 100, kellyFraction=R.KELLY_FRAC, kellyCapPct=R.KELLY_CAP * 100),
             calibration=dict(verified=bool(cal_ok), note=("verified" if cal_ok else "NOT verified on walk-forward OOS -> fixed 0.5 % risk, Kelly disabled") + "; must be re-verified on the desk's own fills",
                              brier={q: round(cal[q]["brier"], 4) for q in QUESTIONS}),
             gate=dict(passed=bool(passed), summary=("PASSED" if passed else "FAILED GATE") + f": OOS Sharpe {m_best['sharpe']:.2f}, max DD {m_best['max_dd']*100:.1f}%, hit {m_best['hit']*100:.1f}%, t {m_best['tstat']:.2f}, DSR {best['dsr']:.2f}, random p {p_random:.2f}, holdout {m_ho['net']:+.1f} USD"))
MODEL_OUT = os.environ.get("QUANT_MODEL_OUT") or os.path.join(ROOT, "bot", "office.calibrated.model.json")
json.dump(model, open(MODEL_OUT, "w"), separators=(",", ":"))

# ---- parity fixture for the TypeScript port (last bars + expected features + probabilities)
from snapshot import snapshot
fx = []
n = len(df)
for i in range(n - 6, n):
    s_ = i - W + 1
    win = df.iloc[s_:i + 1]
    snap = snapshot(*(win[k].astype(float).tolist() for k in "ohlcv"))
    feats = np.array([[snap[f] for f in FEATURES]])
    probs = {q: float(np.clip(R.MODELS_LAST[q](feats)[0], 0.001, 0.999)) for q in QUESTIONS}
    fx.append(dict(decisionTs=int(df.t.iloc[i]) + tf, features={f: snap[f] for f in FEATURES}, atr=snap["_atr"], probs=probs))
bars = df.iloc[n - 6 - W:].copy()
json.dump(dict(gran=tf, bars=[dict(t=int(r.t), o=r.o, h=r.h, l=r.l, c=r.c, v=r.v) for r in bars.itertuples()], cases=fx),
          open(os.environ.get("QUANT_FIXTURE_OUT") or os.path.join(ROOT, "bot", "test", "fixtures", "calibrated-parity.json"), "w"))
pickle.dump(dict(gate=gate, cfg=cfg, model_th=th2, ho_trades=trh), open(os.path.join(OUT, "gate.pkl"), "wb"))
print("exported model + fixture")
