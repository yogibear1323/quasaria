# Orion — calibrated XLM-perp desk · strategy.md

**Status: FAILED GATE — not deployed as a trading desk.** Orion runs in **paper mode** ("paper · failed gate") on the
testnet fleet: it scores every 15-minute candle, logs every decision and outcome, and records simulated fills (fees,
slippage, funding) at a fixed 0.5 % risk. It places **no on-chain orders**. Paper mode was enabled on Oct 8, 2026 at
Robert's request after the oracle feed was restored; before that it ran in shadow mode (score and log only). The code
refuses live-order ("desk") mode unless the model file records a passed gate.

*All figures are simulated backtests on historical Coinbase XLM-USD prices with fees, slippage and funding. They are not
forecasts and imply no future returns. Testnet / simulated only; no mainnet, no real funds.*
*Generated Oct 08, 2026 07:25 AM MST from `results/quant/gate.json` (reproduce: see the end).*

## 1. Best candidate (documented as FAILED GATE)

| | |
|---|---|
| Market / venue | XLM perp on the Quasaria testnet leverage vault (fills at the oracle price); signals on Coinbase XLM-USD candles |
| Timeframe | **15m** candles; decision at each candle close; outcome horizon T = 24 bars (6 h) |
| Scorer | gradient-boosted trees (sklearn HistGradientBoosting, depth 3, 150 rounds) per question, **isotonic calibration** fit on a later, disjoint slice |
| Entry | at the candle close, side = the direction question's side, **only if every probability clears its threshold**: P(setup, side) ≥ 0.5, P(direction, side) ≥ 0.5, P(trend) ≥ 0.0, P(buying pressure, side) ≥ 0.5, P(calm) ≥ 0.6 (thresholds re-selected per walk-forward fold on the calibration slice; the shipped values are from the latest window) |
| Stop | entry ∓ clamp(1.0 × ATR14, 0.8 %, 7.5 %) — on 15m the 0.8 % floor binds ~87 % of the time (median 15m ATR ≈ 0.48 %) |
| Take profit | 2 × the stop distance (2R before costs) |
| Exit | stop checked first (gaps fill at the open), then target, else time exit at the close of bar 24 (6 h) |
| Sizing | fixed **0.5 %** of equity at risk (calibration NOT verified → Kelly disabled). Quarter-Kelly path exists in code, capped at the 1 % target; 2 % hard cap enforced twice (policy + sizing.ts) |
| Invalidation | (a) any threshold fails → no trade; (b) stop or 6 h time stop; (c) risk vetoes: global kill (flatten + halt), desk drawdown 10 % (flatten + halt), daily loss 3 %, 5-loss 4 h pause, 6 entries/day, 1 open position; (d) fewer than 200 closed bars → no snapshot, no decision; (e) retire the candidate if live Brier on its own decisions is worse than climatology after ≥ 200 resolved candles, or paper drawdown exceeds 5 % |

Weights for the confidence score (display/ranking only; firing needs every threshold): setup 0.4, direction 0.25, pressure 0.15, regime 0.1, risk 0.1.

## 2. Strategy gate (out-of-sample)

Gate (owner spec): OOS Sharpe > 1.5, max drawdown < 15 %, hit rate > 55 %, t-stat > 2.0, plus our multiple-testing
correction (deflated Sharpe ≥ 0.95 with N = 89 trials = 24 configs here + 65 walk-forward trials in the Oct 4 study),
a random-entry control (p < 0.05) and a positive untouched holdout.

| check | best candidate (15m · TP 2 / SL 1 ATR · GBT) | gate | result |
|---|---|---|---|
| OOS Sharpe (daily, annualised) | 1.80 | > 1.5 | PASS |
| Max drawdown | 3.8 % | < 15 % | PASS |
| Hit rate | 54.3 % (92 trades) | > 55 % | FAIL |
| t-stat (mean R per trade) | 1.99 | > 2.0 | FAIL |
| Deflated Sharpe probability | 0.013 | ≥ 0.95 | FAIL |
| Random-entry control (300 runs, Sharpe) | p = 0.000; random median net $-62.1 | p < 0.05 | PASS |
| Untouched holdout 2026-08-09 → 2026-10-08 | 3 trades, $-1.43 | > 0 | FAIL |
| OOS net P&L on $500 (fixed 0.5 % risk) | $+51.50 over 2025-07-10 → 2026-08-09 | — | — |
| Same, quarter-Kelly variant (not enabled) | $+106.74, max DD 7.5 % | — | — |

**Verdict: FAILED** (hit rate, t-stat, deflated Sharpe and holdout). Caveats that make it weaker still: the 15m OOS span is
only 13 months (Coinbase 15m history fetched covers 2 years; 9 months go to training), so it does not meet the
"≥ 2 years" requirement on its own; **84 of its 92 trades are shorts** taken during the Q3-2025 → Q1-2026 XLM decline,
and it has taken only 7 trades since April 2026. It looks like a regime bet, not a durable edge.

### All configurations (walk-forward OOS, $500 per desk, fixed 0.5 % risk, fees + slippage + funding)

1h and 4h: 2022-01 → 2026-10 data, 18-month rolling train, 61-day test folds, OOS from Jul/Aug 2023 (≈ 3.1 years,
bull, bear, range and high/low-vol regimes). 15m: Oct 2024 → Oct 2026 data, 9-month train, OOS from Jul 2025.
Holdout 2026-08-09 → 2026-10-08 never used for selection.

| tf | TP/SL (ATR) | model | OOS from | trades | net $ | hit | Sharpe | max DD | t | DSR | setup Brier (skill) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 15m | 2/1 | hgb | 2025-07-10 | 92 | +51.5 | 54.3% | 1.80 | 3.8% | 1.99 | 0.01 | 0.2286 (-0.0017) |
| 4h | 2/1 | hgb | 2023-08-05 | 148 | +47.4 | 48.6% | 0.77 | 3.8% | 1.30 | 0.00 | 0.2348 (-0.0197) |
| 4h | 1.5/1 | hgb | 2023-08-05 | 200 | -0.3 | 45.5% | 0.02 | 5.9% | 0.03 | 0.00 | 0.2450 (-0.0202) |
| 4h | 2/1 | logit | 2023-08-05 | 137 | -12.5 | 39.4% | -0.18 | 10.0% | -0.34 | 0.00 | 0.2369 (-0.0289) |
| 1h | 2/1 | logit | 2023-07-11 | 32 | -8.7 | 37.5% | -0.27 | 3.5% | -0.53 | 0.00 | 0.2259 (-0.0067) |
| 4h | 1.5/1 | logit | 2023-08-05 | 239 | -24.5 | 42.7% | -0.34 | 9.0% | -0.57 | 0.00 | 0.2458 (-0.0235) |
| 4h | 1/1.5 | hgb | 2023-08-05 | 508 | -31.2 | 62.2% | -0.43 | 15.5% | -0.74 | 0.00 | 0.2478 (-0.0223) |
| 1h | 1.5/1 | hgb | 2023-07-11 | 99 | -26.4 | 42.4% | -0.57 | 7.7% | -1.06 | 0.00 | 0.2403 (-0.0037) |
| 4h | 1/1 | hgb | 2023-08-05 | 320 | -41.4 | 52.5% | -0.61 | 11.6% | -1.06 | 0.00 | 0.2525 (-0.0163) |
| 1h | 1.5/1 | logit | 2023-07-11 | 39 | -24.1 | 35.9% | -0.83 | 5.5% | -1.61 | 0.00 | 0.2412 (-0.0073) |
| 15m | 1.5/1 | hgb | 2025-07-10 | 88 | -18.3 | 44.3% | -0.88 | 7.9% | -0.87 | 0.00 | 0.2389 (-0.0020) |
| 1h | 2/1 | hgb | 2023-07-11 | 51 | -38.5 | 27.5% | -1.05 | 9.3% | -2.09 | 0.00 | 0.2255 (-0.0045) |
| 4h | 1/1.5 | logit | 2023-08-05 | 431 | -75.6 | 58.9% | -1.19 | 17.9% | -2.12 | 0.00 | 0.2473 (-0.0202) |
| 15m | 2/1 | logit | 2025-07-10 | 13 | -13.1 | 23.1% | -1.25 | 3.2% | -1.64 | 0.00 | 0.2291 (-0.0040) |
| 4h | 1/1 | logit | 2023-08-05 | 418 | -95.0 | 49.8% | -1.31 | 21.4% | -2.28 | 0.00 | 0.2547 (-0.0249) |
| 1h | 1/1.5 | hgb | 2023-07-11 | 1059 | -189.4 | 61.2% | -2.34 | 38.0% | -4.10 | 0.00 | 0.2415 (-0.0037) |
| 1h | 1/1 | hgb | 2023-07-11 | 1137 | -227.3 | 52.2% | -2.43 | 47.3% | -4.27 | 0.00 | 0.2505 (-0.0039) |
| 15m | 1/1.5 | logit | 2025-07-10 | 205 | -70.7 | 60.5% | -2.82 | 14.3% | -3.35 | 0.00 | 0.2427 (-0.0025) |
| 15m | 1.5/1 | logit | 2025-07-10 | 40 | -53.1 | 20.0% | -2.86 | 11.3% | -4.96 | 0.00 | 0.2394 (-0.0040) |
| 1h | 1/1.5 | logit | 2023-07-11 | 1003 | -212.1 | 60.8% | -2.95 | 43.9% | -5.01 | 0.00 | 0.2420 (-0.0057) |
| 15m | 1/1 | logit | 2025-07-10 | 215 | -89.1 | 48.4% | -3.04 | 18.1% | -3.51 | 0.00 | 0.2499 (-0.0021) |
| 1h | 1/1 | logit | 2023-07-11 | 931 | -239.1 | 51.5% | -3.04 | 48.7% | -5.26 | 0.00 | 0.2509 (-0.0055) |
| 15m | 1/1 | hgb | 2025-07-10 | 575 | -138.1 | 53.2% | -3.19 | 29.6% | -3.54 | 0.00 | 0.2497 (-0.0014) |
| 15m | 1/1.5 | hgb | 2025-07-10 | 764 | -202.0 | 61.8% | -5.22 | 41.6% | -5.89 | 0.00 | 0.2425 (-0.0019) |

### Regimes (best candidate, trailing 30-day XLM return ±15 % and volatility vs median at entry)

| regime | trades | net $ | hit |
|---|---|---|---|
| bear/high-vol | 24 | +25.2 | 62% |
| bear/low-vol | 15 | +16.5 | 60% |
| bull/high-vol | 3 | +4.6 | 67% |
| range/high-vol | 7 | +1.7 | 43% |
| range/low-vol | 43 | +3.5 | 49% |

### Calibration (best candidate, walk-forward OOS, every 15m candle)

| question | n | base rate | Brier | climatology | Brier skill | ECE |
|---|---|---|---|---|---|---|
| regime | 37908 | 0.233 | 0.1789 | 0.1786 | -0.0014 | 0.0052 |
| direction | 37908 | 0.467 | 0.2493 | 0.2489 | -0.0018 | 0.0133 |
| pressure | 37908 | 0.458 | 0.2495 | 0.2482 | -0.0050 | 0.0175 |
| setup_long | 37908 | 0.328 | 0.2207 | 0.2205 | -0.0011 | 0.0080 |
| setup_short | 37908 | 0.381 | 0.2364 | 0.2358 | -0.0024 | 0.0124 |
| risk | 37908 | 0.818 | 0.1456 | 0.1492 | +0.0241 | 0.0160 |

The probabilities are well calibrated *to the base rate* (ECE ≤ 0.02) but have **no skill** on direction, pressure,
regime or setup (Brier skill ≤ 0); only the risk (calm vs volatility-expansion) question beats climatology (+2.4 %).
Verification rule (Brier skill > 0 and ECE < 0.03 on both setup questions) **fails**, so Kelly sizing stays off.
Reliability curves: `results/quant/reliability.png`, `results/quant/reliability_*.csv`.

## 3. Architecture (as built)

1. **Slow layer — research & review** (`research/quant/`): state engine mirror, fixed-outcome labels, walk-forward
   training with purge, isotonic calibration, threshold selection on the calibration slice, the gate, DSR, random-entry
   control, holdout, regime and calibration reports, model + parity-fixture export. `nightly.py` reviews the desk's own
   decisions (live Brier per question, root cause per paper loss), re-runs the full study on fresh data and writes a
   proposal; it replaces the model file **only** if the proposal re-clears the same gate (`bot/scripts/calibrated-nightly.sh`).
2. **Fast layer — calibrated scorer** (`bot/src/office/calibrated/model.ts`): one probability per question per candle
   (regime choice, direction choice, buying-pressure yes/no, setup-quality score long/short, risk-state choice). Pure; no
   access to state, limits or orders.
3. **Deterministic code** (`snapshot.ts`, `policy.ts`, `outcomes.ts`, `shadowDesk.ts`, plus the fleet's `risk.ts` /
   `sizing.ts`): owns state, thresholds, weights, sizing, risk vetoes and (paper) orders. The model advises; code decides.

State engine: a compact snapshot per closed candle from the last 200 bars closed **at or before** the decision time
(price, ATR, realised vol, trend, efficiency ratio, range position, CLV-volume buying pressure, volume z, RSI, range
ratio). Live L2 spread, order-book imbalance and vault funding are logged with every decision but are not model inputs
(no history to backtest them). Tests: no-lookahead (future bars tampered → identical snapshot; in-progress bar excluded)
in both Python and TypeScript, and an exact TS↔Python parity fixture (features to 1e-9, probabilities to 1e-6).

Calibration logging: every decision (snapshot, probabilities, decision, veto, action) and every resolved outcome go to
`~/.quasaria-office/state/calibration.jsonl`; the Back Office shows the signal log live (testnet / simulated).

## 4. Jev and AgenKit

* **Jev** (TypeSafe AI) — real: a hosted, closed-weight "typed, calibrated decision model" (choice / score / yes-no
  with probabilities, ~70–500 ms), called via the Vercel AI SDK (`@ai-sdk/typesafe-ai`, model `jev-latest`) or a POST.
  Needs a paid `jv_live_` API key (`TYPESAFE_AI_API_KEY`, ≈ $0.001 per decision). Its calibration is generic, not
  measured on our venue. **Not used**: the fast layer is our own model, which we can backtest and verify. A Jev adapter
  could be benchmarked in shadow later behind the same `score()` interface and would have to clear the same gate.
* **AgenKit** (agenkit.xyz) — real: a paid ($3.49/mo license key) developer-workflow kit that installs agents/skills into
  coding tools (Claude Code, Cursor, Codex…) and runs brainstorm → architecture → plan → test-first build → review →
  ship. It is a build-time harness, not a runtime component; not needed here.

## 5. WHAT COULD BLOW UP THIS ACCOUNT?

* **Does paper match the backtest?** Unknown — paper trading started Oct 8, 2026 with zero paper fills so far. The
  backtest's own untouched holdout already disagrees with the walk-forward result (3 trades, $-1.43).
  Not clean.
* **Did the kill switch fire in testing?** Yes. Unit tests: the kill switch flattens the open paper position and halts
  the desk, later signals are vetoed, and it stays halted after the kill clears until a manual reset; a fleet-level
  test sets the KILL file and checks Orion halts without touching the venue. The drawdown limit (flatten + halt), daily
  loss block and max-open veto are tested too. In production the fleet's own kill switch actually fired on Oct 4, 2026
  (oracle stale > 30 min) and has blocked all entries since. Clean.
* **Is any hard limit delegated to a model?** No. Models output probabilities only. Thresholds, the 1 % target / 2 %
  hard risk cap (enforced in `policy.ts` and again in `sizing.ts`), max position, daily loss, drawdown halt and the kill
  switch are code; a test feeds a model file with absurd sizing (10 % fixed, 50 % Kelly cap) and the desk still
  risks ≤ 1 %. Config validation rejects a calibrated desk with riskPct > 1. Clean.
* **Is the confidence calibrated on our own fills?** No. There are no own fills yet; walk-forward calibration is good
  to the base rate but has no skill, so Kelly stays disabled and sizing is a fixed 0.5 %. Not clean.
* **What market regime would break it?** A trending bull market or a quiet range: the OOS profit came almost entirely
  from shorts during the 2025–26 decline (bear regimes +$41.7 of +$51.5; range/low-vol 43 trades, +$3.5, 49 % hit), and it
  went nearly silent after April 2026. Fast volatility spikes gap through the 0.8 % stop (fills at the open). Venue
  risks: if the oracle feed stops, the vault refuses trades (max price age 90 s) and the fleet kills itself, which is
  exactly what has happened since Oct 4; the vault's finite reserve caps payouts. Not clean.

**Refusing to go live.** Two of five answers are not clean and the gate failed. Orion stays in paper mode (simulated fills,
no on-chain orders) until a model clears the gate and paper results on its own fills agree with the backtest.

## 6. Reproduce

```
python3 research/quant/fetch.py          # Coinbase XLM-USD 1h (2022→) + 15m (2 y), Kraken PF_XLMUSD funding (cached in data/)
python3 research/quant/test_snapshot.py  # no-lookahead test (Python state engine)
python3 research/quant/run_gate.py       # 24 configs walk-forward (≈ 2 min on 7 cores)
python3 research/quant/analyze_gate.py   # gate, DSR, random control, holdout, calibration, model + fixture export
# strategy.md is then updated from results/quant/gate.json + configs.csv
cd bot && npx vitest run test/calibrated.test.ts
```
