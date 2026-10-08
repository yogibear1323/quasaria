"""Calibrated three-layer desk: walk-forward research + strategy gate (simulated; nothing here places orders).

Layers (as built in the bot): research/review (this file + nightly.py) -> fast calibrated scorer (logistic / gradient
boosting + isotonic calibration, one probability per fixed-outcome question per candle) -> deterministic code
(thresholds, weights, sizing, risk vetoes). This script measures whether that stack has an out-of-sample edge on XLM
after costs and writes results/quant/*.

Usage: python3 research/quant/run_gate.py [--fast]
"""
import itertools, json, math, os, sys, time
for _v in ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS"): os.environ.setdefault(_v, "1")
from multiprocessing import Pool
import numpy as np, pandas as pd
sys.path.insert(0, os.path.dirname(__file__))
from common import *  # noqa
from snapshot import snapshot_matrix, FEATURES, W
from sklearn.linear_model import LogisticRegression
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.isotonic import IsotonicRegression
from sklearn.preprocessing import StandardScaler

OUT = os.environ.get("QUANT_OUT") or os.path.join(os.path.dirname(__file__), "..", "..", "results", "quant")
os.makedirs(OUT, exist_ok=True)
# evaluation "now": fixed for the published study (reproducible), overridable for the nightly re-run
NOW = int(os.environ.get("QUANT_NOW") or pd.Timestamp("2026-10-08 13:00", tz="UTC").timestamp())
HOLDOUT_DAYS = 60
HOLDOUT_START = NOW - HOLDOUT_DAYS * 86400
TF = {900: dict(T=24, train_days=274, label="15m"), 3600: dict(T=24, train_days=548, label="1h"), 14400: dict(T=12, train_days=548, label="4h")}
TEST_DAYS = 61
GEOMS = [(1.0, 1.0), (1.0, 1.5), (1.5, 1.0), (2.0, 1.0)]   # (TP, SL) in ATR; SL clamped to the fleet 0.8–7.5 % band
MODELS = ["logit", "hgb"]
TH_SETUP = [0.50, 0.55, 0.60, 0.65]; TH_DIR = [0.50, 0.55]; TH_REG = [0.0, 0.30]
TH_BP, TH_RISK = 0.50, 0.60
WEIGHTS = dict(setup=0.40, direction=0.25, pressure=0.15, regime=0.10, risk=0.10)
FIXED_RISK = 0.005           # 0.5 % per trade when Kelly is not verified
KELLY_FRAC, KELLY_CAP = 0.25, 0.01   # quarter Kelly, capped at the 1 % target (2 % hard cap enforced in simulate)
PRIOR_TRIALS = 65            # walk-forward trials in the Oct 4 study (strat/research), counted for the DSR
GATE = dict(sharpe=1.5, max_dd=0.15, hit=0.55, tstat=2.0, dsr=0.95, random_p=0.05)


def make_model(kind):
    if kind == "logit":
        return LogisticRegression(C=0.1, max_iter=2000)
    return HistGradientBoostingClassifier(max_depth=3, max_iter=150, learning_rate=0.05, l2_regularization=1.0, min_samples_leaf=100, random_state=0)


class Calibrated:
    """model fit on the fit slice, isotonic calibration fit on a later, disjoint calibration slice."""
    def __init__(self, kind):
        self.kind = kind; self.sc = StandardScaler(); self.m = make_model(kind); self.iso = IsotonicRegression(out_of_bounds="clip", y_min=0.001, y_max=0.999)
    def fit(self, Xf, yf, Xc, yc):
        self.m.fit(self.sc.fit_transform(Xf), yf)
        self.iso.fit(self.raw(Xc), yc); return self
    def raw(self, X): return self.m.predict_proba(self.sc.transform(X))[:, 1]
    def __call__(self, X): return self.iso.predict(self.raw(X))


def label_matrix(lab, bt_by_geom, g):
    L = {k: lab[k] for k in ("regime", "direction", "pressure", "risk")}
    for side in ("long", "short"):
        r = bt_by_geom[g][side][1]
        L[f"setup_{side}"] = np.where(np.isfinite(r), (r > 0).astype(float), np.nan)
    return L


def decide(P, th):
    """Deterministic policy: side from the direction question, then EVERY probability must clear its threshold."""
    up = P["direction"]
    side = np.where(up >= 0.5, 1, -1)
    p_dir = np.where(side > 0, up, 1 - up)
    p_bp = np.where(side > 0, P["pressure"], 1 - P["pressure"])
    p_setup = np.where(side > 0, P["setup_long"], P["setup_short"])
    ok = (p_setup >= th["setup"]) & (p_dir >= th["dir"]) & (P["regime"] >= th["reg"]) & (p_bp >= TH_BP) & (P["risk"] >= TH_RISK)
    score = WEIGHTS["setup"] * p_setup + WEIGHTS["direction"] * p_dir + WEIGHTS["pressure"] * p_bp + WEIGHTS["regime"] * P["regime"] + WEIGHTS["risk"] * P["risk"]
    return np.where(ok, side, 0), p_setup, score


def kelly_risk(p, tp_atr, sl_atr, cutoff):
    """capped fractional Kelly on the calibrated win probability; payoff ratio from the geometry net of ~costs."""
    b = (tp_atr / sl_atr) * 0.85   # costs eat ~15 % of the target at typical 1h stop sizes (conservative)
    f = p - (1 - p) / b
    return np.where((p >= cutoff) & (f > 0), np.minimum(KELLY_FRAC * f, KELLY_CAP), 0.0)


def run_config(args):
    tf, geom, kind = args
    cfg = TF[tf]; T = cfg["T"]
    df, X, atr, lab, bt = DATA[tf]
    g = GEOMS.index(geom)
    L = label_matrix(lab, bt, g)
    t = df.t.to_numpy(); tc = t + tf
    valid = np.isfinite(X).all(1)
    first_test = int(tc[W - 1]) + cfg["train_days"] * 86400
    folds = []
    s = first_test
    while s + 86400 < HOLDOUT_START:
        folds.append((s, min(s + TEST_DAYS * 86400, HOLDOUT_START))); s += TEST_DAYS * 86400
    oos_sides = np.zeros(len(t), int); oos_risk = np.zeros(len(t)); oos_kelly = np.zeros(len(t))
    oos_P = {q: np.full(len(t), np.nan) for q in QUESTIONS}
    fold_rows = []
    for (a_t, b_t) in folds:
        P, th, fit_info = fit_fold(X, L, valid, tc, a_t, b_t, T, kind, df, tf, bt, geom)
        te = (tc > a_t) & (tc <= b_t) & valid
        for q in QUESTIONS: oos_P[q][te] = P[q][te]
        sides, p_setup, score = decide({q: P[q] for q in QUESTIONS}, th)
        oos_sides[te] = sides[te]; oos_risk[te] = FIXED_RISK
        oos_kelly[te] = kelly_risk(p_setup, *geom, th["setup"])[te]
        fold_rows.append(dict(start=a_t, end=b_t, **th, **fit_info))
    a = int(np.searchsorted(tc, folds[0][0], side="right")); b = int(np.searchsorted(tc, HOLDOUT_START, side="right"))
    tr, cv = simulate(df, tf, (a, b), oos_sides, oos_risk, bt[g])
    m = metrics(tr, cv, t[a:b] + tf)
    trk, cvk = simulate(df, tf, (a, b), oos_sides, oos_kelly, bt[g])
    mk = metrics(trk, cvk, t[a:b] + tf)
    cal = {q: brier(oos_P[q][a:b], L[q][a:b]) for q in QUESTIONS}
    # setup calibration on the trades actually taken (own fills, simulated)
    print(f"  done {cfg['label']} TP{geom[0]}/SL{geom[1]} {kind}: OOS trades {m['trades']} net {m['net']:.1f} hit {m['hit']:.3f} sharpe {m['sharpe']:.2f}", flush=True)
    return dict(tf=tf, tf_label=cfg["label"], tp=geom[0], sl=geom[1], model=kind, oos_from=int(folds[0][0]), oos_to=int(HOLDOUT_START), folds=len(folds),
                fixed=m, kelly=mk, calibration=cal, fold_rows=fold_rows, trades=tr)


def fit_fold(X, L, valid, tc, a_t, b_t, T, kind, df, tf, bt, geom, select=True):
    """train on [a_t - train_days, a_t) with a T-bar purge; fit 70 % / calibrate+select on the last 30 %."""
    cfg = TF[tf]
    tr_lo = a_t - cfg["train_days"] * 86400
    purge = T * tf
    idx = np.where((tc > tr_lo) & (tc <= a_t - purge) & valid)[0]
    cut = idx[int(len(idx) * 0.7)]
    fit = idx[tc[idx] <= tc[cut] - purge]; cal = idx[tc[idx] > tc[cut]]
    P = {}
    for q in QUESTIONS:
        y = L[q]
        f = fit[np.isfinite(y[fit])]; c = cal[np.isfinite(y[cal])]
        mdl = Calibrated(kind).fit(X[f], y[f], X[c], y[c])
        P[q] = np.full(len(tc), np.nan)
        P[q][valid] = mdl(X[valid])
        MODELS_LAST[q] = mdl
    th = dict(setup=TH_SETUP[0], dir=TH_DIR[0], reg=TH_REG[0])
    info = dict(n_fit=len(fit), n_cal=len(cal), sel_sharpe=None, sel_trades=None)
    if select:
        best = None
        a = int(cal[0]); b = int(cal[-1]) + 1
        g = GEOMS.index(geom)
        for s_, d_, r_ in itertools.product(TH_SETUP, TH_DIR, TH_REG):
            cand = dict(setup=s_, dir=d_, reg=r_)
            sides, _, _ = decide(P, cand)
            tr, cv = simulate(df, tf, (a, b), sides, np.full(len(tc), FIXED_RISK), bt[g])
            if len(tr) < 15: continue
            mm = metrics(tr, cv, df.t.to_numpy()[a:b] + tf)
            if best is None or mm["sharpe"] > best[0]: best = (mm["sharpe"], cand, len(tr))
        if best: th = best[1]; info.update(sel_sharpe=best[0], sel_trades=best[2])
    return P, th, info


MODELS_LAST = {}
DATA = {}


def prep(tf):
    df = series(tf)
    df = df[df.t + tf <= NOW].reset_index(drop=True)
    X, atr = snapshot_matrix(df, tf)
    lab = question_labels(df, TF[tf]["T"])
    bt = [barrier_trades(df, atr, tf, tp, sl, TF[tf]["T"]) for tp, sl in GEOMS]
    return df, X, atr, lab, bt


def init_worker(data):
    DATA.update(data)


if __name__ == "__main__":
    t0 = time.time()
    tfs = [3600] if "--fast" in sys.argv else [900, 3600, 14400]
    data = {}
    for tf in tfs:
        data[tf] = prep(tf); print(f"prepared {TF[tf]['label']}: {len(data[tf][0])} bars, {time.time() - t0:.0f}s", flush=True)
    DATA.update(data)
    jobs = [(tf, g, k) for tf in tfs for g in GEOMS for k in MODELS]
    import multiprocessing as mp
    with mp.get_context("fork").Pool(min(7, len(jobs))) as pool:
        res = pool.map(run_config, jobs, chunksize=1)
    print(f"walk-forward done {time.time() - t0:.0f}s", flush=True)
    import pickle
    pickle.dump(res, open(os.path.join(OUT, "wf_results.pkl"), "wb"))
    pickle.dump({tf: (data[tf][0].t.iloc[0], data[tf][0].t.iloc[-1]) for tf in tfs}, open(os.path.join(OUT, "data_span.pkl"), "wb"))
