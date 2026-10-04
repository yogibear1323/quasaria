import json, numpy as np, pandas as pd, datetime as dt, markdown, os
R = "../results"
S = pd.read_csv(f"{R}/summary_family_tf.csv"); M = pd.read_csv(f"{R}/summary_meta.csv"); CUR = pd.read_csv(f"{R}/summary_current.csv")
ROB = pd.read_csv(f"{R}/robustness_top.csv"); FIX = pd.read_csv(f"{R}/fixed_defaults.csv"); MC = pd.read_csv(f"{R}/move_vs_cost.csv")
OL = pd.read_csv(f"{R}/oracle_lag_test.csv"); PAR = json.load(open(f"{R}/parity.json")); T = json.load(open(f"{R}/tally.json"))
META = json.load(open(f"{R}/wf_meta.json")); RM = json.load(open(f"{R}/robust_meta.json"))
from strategies import SOURCES, LIB_LICENSES
utc = lambda s: dt.datetime.utcfromtimestamp(s).strftime("%Y-%m-%d")
def md(df, fl=1): return df.to_markdown(index=False, floatfmt=f".{fl}f")
m = {x["tf"]: x for x in META}
ho_start = utc(m[3600]["holdout_start"]); end = utc(m[3600]["last"])
wf = S[S["mode"] == "WF"].copy(); hold = S[S["mode"] == "HOLDOUT(best-PRE)"].copy()
n_wf_pos = int((wf.net > 0).sum()); n_ho_pos = int((hold.net > 0).sum())

wf_tab = wf.sort_values("net", ascending=False)[["tf_label", "family", "trades", "win_rate", "avg_r", "net", "pf", "max_dd_pct", "pos_folds", "folds", "halts", "is_net_sum"]]
wf_tab = wf_tab.rename(columns={"tf_label": "frame", "win_rate": "win", "avg_r": "avg R", "net": "OOS net $", "pf": "PF", "max_dd_pct": "max DD %", "pos_folds": "+windows", "folds": "windows", "is_net_sum": "IS net $ (selected)"})
wf_tab["win"] = (wf_tab["win"] * 100).round(0)
top = ROB.copy()
top_tab = top[["tf", "family", "oos_net", "pos_folds", "oos_net_ex_best_fold", "p_value_vs_random", "random_median", "daily_sharpe_ann", "deflated_sharpe_prob", "oos_net_slip10", "oos_net_nocost", "holdout_trades", "holdout_net", "holdout_win", "holdout_dd", "holdout_cfg"]]
top_tab = top_tab.rename(columns={"oos_net": "WF OOS $", "pos_folds": "+windows", "oos_net_ex_best_fold": "OOS $ w/o best window", "p_value_vs_random": "p vs random", "random_median": "random median $",
                                  "daily_sharpe_ann": "Sharpe (ann.)", "deflated_sharpe_prob": "DSR prob", "oos_net_slip10": "OOS $ @10bp slip", "oos_net_nocost": "OOS $ no costs",
                                  "holdout_trades": "HO trades", "holdout_net": "HO net $", "holdout_win": "HO win", "holdout_dd": "HO DD %", "holdout_cfg": "config used on holdout"})
top_tab["HO win"] = (top_tab["HO win"] * 100).round(0)
cur = CUR.copy(); cur["oos_win"] = (cur.oos_win * 100).round(0); cur["holdout_win"] = (cur.holdout_win * 100).round(0)
cur = cur.rename(columns={"config": "desk config", "oos_trades": "OOS trades", "oos_net": "OOS net $", "oos_win": "OOS win %", "pre_trades": "pre-HO trades", "pre_net": "pre-HO net $", "pre_pf": "pre-HO PF", "pre_dd": "pre-HO DD %", "pre_halts": "10% halts",
                          "pre_nocost_net": "pre-HO net $ before costs", "holdout_trades": "HO trades", "holdout_net": "HO net $", "holdout_win": "HO win %", "holdout_dd": "HO DD %"})
fix = FIX.drop(columns=["family"]).sort_values(["tf", "oos_net"], ascending=[True, False])
fix["oos_win"] = (fix.oos_win * 100).round(0); fix["ho_win"] = (fix.ho_win * 100).round(0)
fix = fix.rename(columns={"oos_days": "days", "oos_trades": "trades", "oos_win": "win %", "oos_avg_r": "avg R", "oos_net": "net $", "oos_pf": "PF", "oos_dd": "DD %", "oos_sharpe": "Sharpe", "oos_cost_share": "cost share",
                          "pos_windows": "+windows", "ex_best_window": "net w/o best window", "p_vs_random": "p vs random", "ho_trades": "HO trades", "ho_win": "HO win %", "ho_net": "HO net $", "ho_pf": "HO PF", "ho_dd": "HO DD %"})
meta = M[M["mode"] == "META-WF"][["tf_label", "trades", "net", "pf", "pos_folds", "folds", "picked"]].rename(columns={"tf_label": "frame", "net": "OOS net $", "pf": "PF", "pos_folds": "+windows", "folds": "windows", "picked": "family picked each window"})
hold_tab = hold.sort_values("pre_net", ascending=False)[["tf_label", "family", "pre_trades", "pre_net", "pre_pf", "trades", "net", "win_rate", "max_dd_pct"]].rename(columns={"tf_label": "frame", "pre_trades": "pre-HO trades", "pre_net": "pre-HO net $ (in-sample!)", "pre_pf": "pre-HO PF", "trades": "HO trades", "net": "HO net $", "win_rate": "HO win", "max_dd_pct": "HO DD %"})
hold_tab["HO win"] = (hold_tab["HO win"] * 100).round(0)
src = pd.DataFrame([dict(family=k, source=v[0], url=v[1], license=v[2]) for k, v in SOURCES.items()])
lib = pd.DataFrame([dict(repo=k, license=v) for k, v in LIB_LICENSES.items()])
mc = MC.rename(columns={"median_atr_pct": "median ATR(14) %", "round_trip_cost_pct": "round-trip cost %", "cost_in_atr": "cost / ATR", "min_stop_in_atr": "min stop (0.8%) / ATR"})
ol = OL[OL.trades > 0].rename(columns={"update_min": "oracle update every (min)", "thr_pct": "entry when |market-oracle| > %", "win_rate": "win", "avg_net_bps": "avg net (bps, after 20 bps costs)"})
par = pd.DataFrame([dict(desk=k, **v) for k, v in PAR.items()])
folds_txt = "; ".join(f"{TF}: IS {a} d / OOS {b} d / step {c} d, {len(m[tf]['folds'])} windows" for tf, TF, (a, b, c) in [(60, "1m", (12, 6, 6)), (300, "5m", (60, 30, 30)), (900, "15m/30m", (120, 45, 45)), (3600, "1h/4h", (180, 60, 60))])
data_txt = ", ".join(f"{ {60:'1m',300:'5m',900:'15m',3600:'1h',1800:'30m',14400:'4h'}[x['tf']]}: {x['bars']:,} bars {utc(x['first'])} → {utc(x['last'])}" for x in META)

st = FIX[(FIX.strategy == "Supertrend 10x3") & (FIX.tf == "1h")].iloc[0]
rg = FIX[(FIX.strategy.str.startswith("trend (fleet")) & (FIX.tf == "4h")].iloc[0]

text = f"""# Quasaria perps desks — strategy research (backtest / simulated only)

*Prepared for Robert Walker, {dt.date(2026,10,4):%b %d, %Y}. Branch `strat/research` (research only; nothing deployed, live site / demo defaults / testnet fleet untouched). All figures are **simulated backtests on historical XLM-USD prices**; they are not forecasts and imply no future returns.*

## 1. Headline

**No configuration we tested is robustly net-profitable out-of-sample after realistic vault costs.** We evaluated **{T['configs_total']:,} parameter configurations** (11 strategy families × 6 timeframes, 1m → 4h) plus the 10 current demo/fleet desk configs and 36 published-default checks, on up to 2 years of real XLM-USD data, using walk-forward optimisation and a final untouched holdout ({ho_start} → {end}, 42 days).

* **Sub-30-minute frames (where the Active demo desks run) are structurally unprofitable:** only {T['pre_positive_frac']['1m']*100:.0f}% (1m), {T['pre_positive_frac']['5m']*100:.1f}% (5m) and {T['pre_positive_frac']['15m']*100:.1f}% (15m) of configs made money after costs, while ~35–55% were positive *before* costs — i.e. roughly coin-flip signals, and the ~0.2% round-trip cost (10 bps open fee + 2 × 5 bps slippage; the vault has no close fee) is 1.6× a typical 1-minute bar range and ~3× a 15-second bar range.
* **All six current Active desk configs lose money out-of-sample and in the holdout** (in 22 of 23 OOS windows; the exception is one +$14 Regal window) (e.g. Vega 5m trend −$239 over 90 OOS days and −$168 in the 42-day holdout on a $500 desk).
* **Positive walk-forward results are almost all 30m–4h trend/momentum** ({n_wf_pos} of 65 family×frame combos positive OOS; the sizeable ones are 1h/4h Turtle, TSMOM, Supertrend and trend), but for **all eight top candidates** the profit comes from one or two trending windows (Jul-2025 and May-2026 XLM rallies): removing the single best window turns all of them negative, none survives a multiple-testing correction (deflated-Sharpe probability ≈ 0), and **all eight top walk-forward candidates lost money on the untouched holdout** (−$1 to −$77).
* Closest-to-viable, *unconfirmed*: the textbook **Supertrend 10×3 on 1h** (no optimisation): +${st['net $'] if 'net $' in st else st['oos_net']:.0f} over 480 OOS days (238 trades, PF {st['oos_pf']:.2f}, p = {st['p_vs_random']:.3f} vs random entries) but **−${-st['ho_net']:.1f} on the holdout** (21 trades); and the **existing fleet 4h trend default** (+${rg['oos_net']:.0f} OOS, −${-rg['ho_net']:.0f} holdout, 9 trades / 0 wins). These are candidates for forward paper-trading, not for claims of profitability.
* **Security finding (not a strategy):** because the vault fills at the oracle price, if the oracle updates only every ≥2 minutes anyone watching the live market can open when the market is >0.25% away from the stale oracle and close at the next update: simulated +12–16 bps per trade net of all costs with a 64–77% win rate (+39–59 bps at a 0.5% gap). This is an **oracle-latency vulnerability** of the vault and should be fixed, not exploited (§8).

**Recommendation:** do not present any desk as profitable. If the demo should lose less, move desks to 1h/4h frames (cost drag ~0.1–0.2 ATR instead of 1.6–3 ATR) and retire the skew proxy; see §9 for proposed per-desk settings (research proposal only — not applied).

## 2. Data

* **Coinbase Exchange public candles, XLM-USD** (cached under `data/`): {data_txt}. Missing minutes (no trades) forward-filled.
* **Funding:** Kraken Futures PF_XLMUSD hourly funding history ({utc(1759305600)} → {end}, 8,840 hours) applied to open positions, capped at the vault's 0.05 %/h. Mean −0.0002 %/h, 95th percentile |0.004 %/h| — economically negligible, so there is no funding carry to harvest and the "skew proxy" desks are not funding strategies. Binance and Bybit public APIs are geo-blocked from the research box; OKX (8-hourly) was reachable but not needed.
* **15s / 30s frames:** no sub-minute history is cached (Coinbase only gives sub-minute data via raw trades, ~hours deep). Echo/Halo (15s/30s mean-rev) are therefore evaluated at 1m with their Active parameters. Costs relative to bar size are 2–3× *worse* at 15s/30s than at 1m (table in §7), so 1m results are an optimistic bound.

## 3. Backtester and parity with the fleet

`research/engine.py` is a numba event-driven single-desk simulator that mirrors `frontend/src/lib/demo/engine.ts` and `bot/src/office/{{sizing,risk}}.ts`: decisions on closed bars at the close (= oracle price); entry fill = price ± 5 bps; 10 bps open fee on notional; **no close fee** (verified in `contracts/leverage-vault`: only `open_fee_bps`); exits ± 5 bps, take-profit exact; stop first if stop and target are hit in the same bar; gap through a stop fills at the bar open (more conservative than the demo); stop clamped to 0.8–7.5 %; stop-distance sizing with 0.25 % fee buffer, 1–2 % risk (fleet: trend/mean-rev 1 %, funding desks 0.75 %), 1.5× equity notional cap, 25 % margin cap, desk leverage caps (5×/4×/3×), half-liquidation-distance rule, 10-unit minimum margin; desk gates kept: 3 % daily loss, 10 % drawdown halt (+flatten), 5-loss 4 h pause, 6 entries/desk/24 h, max 2 open. Research-only modelling choice: after a 10 % drawdown halt the desk is reset by an "operator" after 7 days (halts are counted in the tables). Not modelled: fleet-wide caps (a single desk at 1 % risk does not bind them), drift halts, oracle-stale entry blocks.

**Parity vs the real TypeScript demo engine** (same cached 3-day window, 1m stepping, $500 single desk; `frontend/scripts/parity-backtest.ts` drives the actual `step()`):

{md(par, 2)}

Lyra and Nova match exactly (same 18 entries, identical P&L). Vega has identical entries; the P&L gap most likely comes from the fleet-level gross-notional cap that trims the second concurrent position in the TS engine (not modelled for a single desk). Regal differs on 4 entries because the TS indicators are recomputed on a 300-bar rolling window (EMA/ATR seeding) while the Python engine uses the full series. Conclusion: same signals, same costs, same sizing; differences are second-order and do not change any conclusion. (The original `active-backtest.ts` runs all six desks on a $500 *total* demo, i.e. ~$83/desk; this study uses **$500 per desk** as requested.)

## 4. Method (and how we limited over-fitting)

1. **Walk-forward:** {folds_txt}. In each window the config with the best in-sample net P&L (≥ 8 trades) is chosen and then run on the next, unseen window. The stitched out-of-sample (OOS) result is the headline; in-sample numbers are shown only for contrast.
2. **Untouched holdout:** the last 42 days ({ho_start} → {end}; 10 days for 1m) were never used for selection. For each family×frame we picked the best config on all pre-holdout data and ran it once on the holdout; for the top candidates we also ran the config chosen in the most recent walk-forward window.
3. **Multiple testing:** {T['configs_total']:,} grid configs + 10 baselines (grids fixed before looking at results; every one counted). Checks: (a) **random-entry control** — same exits, stops, sizing and costs, random entry times and sides, same trade count, 300 runs per candidate → p-value; (b) **deflated Sharpe ratio** (Bailey & López de Prado) with N = {RM['n_trials_wf']} walk-forward trials; (c) **window concentration** — OOS P&L with the single best window removed; (d) **cost stress** — slippage 10 bps instead of 5.
4. **Zero-degree-of-freedom check:** published default parameters (Turtle 20/10, Supertrend 10×3, MACD 12/26/9, etc.) run unchanged — no optimisation, so no selection bias for those specific rules.
5. Families explored: the fleet trend, mean-reversion and skew-proxy strategies (with wider stops, R-multiple targets, ADX trend/range regime filters, trailing exits, fewer trades), plus the sourced strategies in §6. Maker-style fills are **not** assumed (the vault is a taker at oracle price).

## 5. Results

### 5.1 Current demo / fleet desk configs (no optimisation)

{md(cur, 1)}

Every Active (15s–30m) config loses in OOS (22 of 23 windows) and in the holdout; most lose even before costs or barely break even before costs. The fleet's own 4h trend default was positive pre-holdout (driven by the Nov-2024 and Jul-2025 rallies) but lost in the holdout.

![positive share](results/fig/positive_share.png)

### 5.2 Walk-forward OOS, every family × frame (best IS config re-selected each window)

{md(wf_tab, 1)}

**"Pick the best of everything" walk-forward** (each window the optimiser may choose any family on that frame — the most honest summary of the whole search):

{md(meta, 1)}

### 5.3 Robustness of the top walk-forward candidates

{md(top_tab, 2)}

Reading: "OOS $ w/o best window" is negative for all eight; "p vs random" ≤ 0.05 only for 30m TSMOM (one positive window out of five), 1h Supertrend and the 15m with-flow skew-proxy variant (random 15m entries bleed costs, so beating them is easy; the variant itself is only +$27 and turns negative at 10 bps slippage) — none of which survives a correction for ~65 trials (Bonferroni threshold ≈ 0.0008); deflated-Sharpe probability ≈ 0 for all (the expected best Sharpe from {RM['n_trials_wf']} no-skill trials is ≈ {top['sr0_ann'].iloc[0]:.1f} annualised on this sample, far above any candidate's). **All eight lost money on the holdout.**

### 5.4 Holdout: best pre-holdout config per family × frame, run once on the last 42 days

{md(hold_tab, 1)}

{n_ho_pos} of 65 were positive on the holdout, all by ≤ $20 on ≤ 42 trades — consistent with noise. The configs with the largest in-sample profits (+$1,000–1,750 pre-holdout) all lost on the holdout.

![windows](results/fig/xlm_windows.png)

## 6. Sourced / published strategies

No third-party code was copied; every strategy was reimplemented from the published rules. Claimed track records (futures in the 1980s–2000s, equities, BTC) were treated as hypotheses and re-tested on XLM with vault costs.

{md(src, 0)}

Open-source libraries checked (LICENSE files read 2026-10-04): {md(lib, 0)}

**Published defaults, unchanged (zero degrees of freedom), OOS period = all walk-forward OOS windows (contiguous), then holdout:**

{md(fix, 2)}

On 15m every published rule loses except TSMOM (+$54, 2/5 windows positive, holdout −$102). On 1h/4h several are positive OOS, but most lose once the best window is removed, and **none is positive on the holdout except Faber-style 50/200 long-only (3 trades, +$1.8) and Bollinger 4h (+$12)**. Connors RSI(2), Bollinger, MACD, Keltner and opening-range breakout are negative on most frames. Supertrend 10×3 on 1h is the strongest (still positive without its best window, p = {st['p_vs_random']:.3f}), but 36 default checks were run, so p ≈ {st['p_vs_random']:.3f} is not significant after correction, and it lost on the holdout.

## 7. Why the short frames cannot work with these costs

{md(mc, 2)}

With a 0.8 % minimum stop and 0.2 % round-trip cost, a 1m desk needs a move of ~6 ATR just to reach a 1R target, and costs eat ~1.6 ATR per trade (≈ 20 % of the 1R risk at the 0.8 % minimum stop plus 0.25 % fee buffer). At 1h/4h the cost is 0.1–0.2 ATR — only there can a modest edge survive, and the evidence for one is weak.

## 8. Oracle-latency check (vulnerability, not a strategy)

The vault fills at the oracle price and accepts prices up to `max_price_age` (hard cap 3,600 s). Simulation on 45 days of 1m Coinbase data: oracle = market price published every U minutes; a trader opens in the direction of the live market when |market − oracle| exceeds a threshold and closes at the next oracle update.

{md(ol, 1)}

Above a ~0.25 % gap this is profitable after all costs for any update interval ≥ 2 minutes — i.e. a near-free option against vault LPs. The fleet's `oracleGuard` only stops the fleet's own entries; it does not protect the vault. Suggested mitigations (for the contracts/keeper owners): push prices on deviation (e.g. > 0.1 %) and at least every 30–60 s; reduce `max_price_age` well below the 3,600 s cap; reject opens/closes when the oracle is older than N seconds or deviates from a second source; or use delayed / two-step execution or an oracle-age-scaled fee. **None of the strategies in this report uses oracle lag.** Note also that the backtests assume a fresh oracle; a stale oracle would make breakout entries look better than they really are.

## 9. Recommendation

1. **No config is robustly net-positive out-of-sample.** Do not describe any desk as profitable; keep "simulated / illustrative" labelling.
2. **What to deploy to the demo — if anything (proposal only, not applied):** the goal can only be "lose less and look realistic", not "make money".

| desk | now (Active) | proposed (research only) | evidence (simulated, $500 desk) |
|---|---|---|---|
| Vega | 5m trend 9/21/10 | **1h Supertrend 10×3** | OOS +${st['oos_net']:.0f}/480 d, 238 trades, PF {st['oos_pf']:.2f}; holdout −${-st['ho_net']:.1f} (21 trades) |
| Regal | 15m trend 9/21/10 | **4h trend, fleet default 20/50/20, 2 ATR stop, 3 ATR trail** | OOS +${rg['oos_net']:.0f}/480 d, 120 trades, PF {rg['oos_pf']:.2f}; holdout −${-rg['ho_net']:.0f} (9 trades) |
| Echo | 15s mean-rev | **15m mean-rev, strict: BB 20/2.5, RSI 28/72, ADX < 20, 3 ATR stop** (trades ~1×/week) or pause | pre-HO ≈ $0 (48 trades), holdout +$6.7 (4 trades); OOS negative |
| Halo | 30s mean-rev | **1h mean-rev, fleet default (BB 20/2.2, RSI 28/72, ADX<20)** or pause | OOS −$53 (22 trades), holdout +$0.7 (1 trade) — near-idle |
| Lyra | 1m skew proxy | **retire skew proxy**; idle, or 1h TSMOM (L 168, H 48, 6 ATR stop) as a labelled experiment | skew proxy (as deployed, contrarian) loses on every frame; only a reversed with-flow 15m variant was positive OOS (+$27) and it fails the 10 bps slippage stress and the holdout; TSMOM 1h OOS +$36, holdout −$20 |
| Nova | 30m skew proxy | **retire skew proxy**; idle, or 4h Turtle 20/10 + Chandelier exit as a labelled experiment | Nova now: OOS −$522; Turtle-Chandelier 4h OOS +$33, holdout −$24 |

   Trade-off: the 1h/4h desks trade ~0.2–1 times per day, so a fresh demo will look much quieter.
3. **Before any live use:** forward paper-trade the two or three candidates (1h Supertrend, 4h trend, 1h Turtle) for 8–12 weeks with pass/fail rules written down in advance (e.g. net > 0 after costs, PF > 1.2, ≥ 40 trades, beating the random-entry 95th percentile). Fix the oracle-latency issue first.

## 10. Reproduce

```
cd /workspace/quasaria-strat && python3 -m venv .venv && .venv/bin/pip install numpy pandas numba matplotlib markdown weasyprint tabulate
cd research
../.venv/bin/python fetch_data.py 3600 730   # also: 900 400, 300 200, 60 45  (+ Kraken funding JSON, see report §2)
../.venv/bin/python parity_dump.py 3 && (cd ../bot && npx tsx ../frontend/scripts/parity-backtest.ts vega) && ../.venv/bin/python parity.py
../.venv/bin/python run_wf.py && ../.venv/bin/python analyze.py && ../.venv/bin/python robust.py && ../.venv/bin/python fixed_defaults.py
../.venv/bin/python charts.py && ../.venv/bin/python build_report.py
```

Outputs in `results/`: `windows_<tf>.csv` (every config × every window), `summary_family_tf.csv`, `summary_meta.csv`, `summary_current.csv`, `wf_folds_selected.csv`, `robustness_top.csv`, `fixed_defaults.csv`, `move_vs_cost.csv`, `oracle_lag_test.csv`, `parity.json`, `tally.json`, `results.json`.

*Limitations:* one asset and one venue's price history; Coinbase prices stand in for the vault oracle; the 2-year window contains a few very large trend moves that dominate trend results; 1m history is only 45 days; sub-minute frames are approximated; fleet-level caps and drift halts not modelled; the 10 % halt is modelled as a 7-day operator reset. All results are simulated.
"""
open("../report.md", "w").write(text)
html = markdown.markdown(text, extensions=["tables", "fenced_code"])
css = """<style>@page{size:A4 landscape;margin:12mm} body{font-family:'DejaVu Sans',Arial,sans-serif;font-size:9.5px;line-height:1.35}
h1{font-size:18px} h2{font-size:14px;border-bottom:1px solid #999;margin-top:14px} h3{font-size:12px}
table{border-collapse:collapse;margin:6px 0;font-size:7.6px} th,td{border:1px solid #bbb;padding:2px 4px;vertical-align:top} th{background:#eee}
img{max-width:70%} code,pre{font-size:8px;background:#f4f4f4}</style>"""
open("../report.html", "w").write("<html><head><meta charset='utf-8'>" + css + "</head><body>" + html + "</body></html>")
from weasyprint import HTML
HTML("../report.html", base_url="..").write_pdf("../report.pdf")
res = dict(generated=str(dt.datetime.now()), headline="No configuration robustly net-positive out-of-sample after costs (simulated).", tally=T, top_candidates=ROB.to_dict("records"),
           current=CUR.to_dict("records"), fixed_defaults=FIX.to_dict("records"), meta_wf=M.to_dict("records"), parity=PAR, oracle_lag=OL.to_dict("records"))
json.dump(res, open(f"{R}/results.json", "w"), indent=1, default=str)
print("ok")
