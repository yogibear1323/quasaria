"""Walk-forward selection, holdout and summary tables from results/windows_*.csv."""
import sys, json, glob, numpy as np, pandas as pd
d = pd.concat([pd.read_csv(f) for f in sorted(glob.glob("../results/windows_*.csv"))], ignore_index=True)
grid = d[~d.family.str.startswith("CURRENT")]
MIN_IS = 8
TFL = {60: "1m", 300: "5m", 900: "15m", 1800: "30m", 3600: "1h", 14400: "4h"}

def agg(df):
    """stitch a set of window results: sum P&L, pooled trade stats."""
    t = df.trades.sum()
    pfv = df.pf.replace([np.inf], np.nan)
    L = np.where(df.trades == 0, 0, np.where(df.net < 0, np.where(pfv.isna() | (pfv == 1), 0, df.net / (pfv - 1)) * -1 * -1, np.where(pfv.isna(), 0, df.net / (pfv - 1))))
    L = np.abs(np.nan_to_num(L)); W = L + df.net.values
    W = np.where(df.pf.values == np.inf, df.net.values, W)
    return pd.Series(dict(pf=W.sum() / L.sum() if L.sum() > 0 else np.nan, trades=int(t), net=df.net.sum(), gross=df.gross.sum(), fees=df.fees.sum(), win_rate=(df.win_rate * df.trades).sum() / t if t else np.nan,
                          avg_r=(df.avg_r * df.trades).sum() / t if t else np.nan, max_dd_pct=df.max_dd_pct.max(), pos_folds=int((df.net > 0).sum()), folds=len(df),
                          halts=int(df.halts.sum())))

def wf_select(sub, sitout=False):
    rows = []
    for k, g in sub[sub.seg == "IS"].groupby("fold"):
        g = g[g.trades >= MIN_IS]
        if g.empty: continue
        best = g.loc[g.net.idxmax()]
        o = sub[(sub.seg == "OOS") & (sub.fold == k) & (sub.cfg == best.cfg) & (sub.family == best.family) & (sub.tf == best.tf)].iloc[0].copy()
        o["is_net"] = best.net; o["is_trades"] = best.trades
        if sitout and best.net <= 0:
            for c in ["trades", "net", "gross", "fees", "max_dd_pct", "halts"]: o[c] = 0
            o["win_rate"] = np.nan; o["avg_r"] = np.nan
        rows.append(o)
    return pd.DataFrame(rows)

out = []; folds_detail = []
for (tf, fam), sub in grid.groupby(["tf", "family"]):
    for sit in (False, True):
        sel = wf_select(sub, sit)
        if sel.empty: continue
        a = agg(sel); a["tf"] = tf; a["family"] = fam; a["mode"] = "WF-sitout" if sit else "WF"
        a["is_net_sum"] = sel.is_net.sum(); a["cfgs_selected"] = sel.cfg.nunique()
        out.append(a)
        if not sit:
            for _, r in sel.iterrows(): folds_detail.append(dict(tf=tf, family=fam, fold=r.fold, cfg=r.cfg, is_net=r.is_net, is_trades=r.is_trades, oos_trades=r.trades, oos_net=r.net, oos_win=r.win_rate, oos_pf=r.pf))
    # holdout: best on the full pre-holdout period (>= 20 trades), evaluated once on the untouched holdout
    pre = sub[(sub.seg == "PRE") & (sub.trades >= 20)]
    if len(pre):
        best = pre.loc[pre.net.idxmax()]
        ho = sub[(sub.seg == "HOLDOUT") & (sub.cfg == best.cfg)].iloc[0]
        out.append(pd.Series(dict(tf=tf, family=fam, mode="HOLDOUT(best-PRE)", trades=ho.trades, net=ho.net, gross=ho.gross, fees=ho.fees, win_rate=ho.win_rate, avg_r=ho.avg_r, max_dd_pct=ho.max_dd_pct, pf=ho.pf, sharpe=ho.sharpe,
                                    pre_net=best.net, pre_trades=best.trades, pre_pf=best.pf, cfg=best.cfg, halts=ho.halts)))
S = pd.DataFrame(out)
S["tf_label"] = S.tf.map(TFL)
S.to_csv("../results/summary_family_tf.csv", index=False)
pd.DataFrame(folds_detail).to_csv("../results/wf_folds_selected.csv", index=False)

# meta: per timeframe, let the optimizer pick across ALL families each fold (the honest "search everything" result)
meta = []
for tf, sub in grid.groupby("tf"):
    sub2 = sub.assign(family="ALL")
    for sit in (False, True):
        sel = wf_select(sub2.assign(cfg=sub.family + "|" + sub.cfg), sit)
        a = agg(sel); a["tf"] = tf; a["mode"] = "META-WF-sitout" if sit else "META-WF"; a["picked"] = "; ".join(sel.cfg.str.split("|").str[0]); meta.append(a)
M = pd.DataFrame(meta); M["tf_label"] = M.tf.map(TFL); M.to_csv("../results/summary_meta.csv", index=False)

# baseline configs (current demo / fleet)
cur = d[d.family.str.startswith("CURRENT")]
B = []
for fam, sub in cur.groupby("family"):
    oos = agg(sub[sub.seg == "OOS"]); pre = sub[sub.seg == "PRE"].iloc[0]; ho = sub[sub.seg == "HOLDOUT"].iloc[0]; nc = sub[sub.seg == "PRE_NOCOST"].iloc[0]
    B.append(dict(config=fam[8:], tf=TFL[sub.tf.iloc[0]], oos_trades=oos.trades, oos_net=oos.net, oos_win=oos.win_rate, pre_trades=pre.trades, pre_net=pre.net, pre_pf=pre.pf, pre_dd=pre.max_dd_pct, pre_halts=pre.halts,
                  pre_nocost_net=nc.net, holdout_trades=ho.trades, holdout_net=ho.net, holdout_win=ho.win_rate, holdout_dd=ho.max_dd_pct))
pd.DataFrame(B).to_csv("../results/summary_current.csv", index=False)

# multiple-testing tallies
pre = grid[grid.seg == "PRE"]; nc = grid[grid.seg == "PRE_NOCOST"]
tally = dict(configs_total=int(len(pre)), by_tf={TFL[k]: int(v) for k, v in pre.groupby("tf").size().items()},
             pre_positive_frac={TFL[k]: round(float(v), 3) for k, v in pre.groupby("tf").net.apply(lambda x: (x > 0).mean()).items()},
             pre_nocost_positive_frac={TFL[k]: round(float(v), 3) for k, v in nc.groupby("tf").net.apply(lambda x: (x > 0).mean()).items()})
json.dump(tally, open("../results/tally.json", "w"), indent=1)
pd.set_option("display.width", 250); pd.set_option("display.max_columns", 30)
print(json.dumps(tally))
w = S[S["mode"] == "WF"].sort_values("net", ascending=False)
print(w[["tf_label", "family", "trades", "net", "win_rate", "avg_r", "pos_folds", "folds", "max_dd_pct", "is_net_sum", "cfgs_selected"]].head(25).to_string())
print(S[S["mode"] == "WF-sitout"].sort_values("net", ascending=False)[["tf_label", "family", "trades", "net", "pos_folds", "folds"]].head(10).to_string())
h = S[S["mode"].str.startswith("HOLDOUT")].sort_values("pre_net", ascending=False)
print(h[["tf_label", "family", "pre_trades", "pre_net", "pre_pf", "trades", "net", "win_rate", "pf", "max_dd_pct", "cfg"]].head(25).to_string())
print(M[["tf_label", "mode", "trades", "net", "pos_folds", "folds", "picked"]].to_string())
