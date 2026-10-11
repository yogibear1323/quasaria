# Back Office fleet (`bot/src/office/`, TESTNET only)

Six automated desks trade the XLM perp on the perps-v1 leverage vault (market key `Stellar(XLM SAC)` from `deployments/testnet.json` → `vault.marketAsset`). Test funds only; unaudited; no expected or guaranteed returns.

| Desk | Strategy | Bars | Risk/trade | Max lev |
|---|---|---|---|---|
| Vega | Supertrend ATR(10)×3 flip, stop = the line (trailed), exit on the opposite flip; liquidity-pocket entry filter (sweep ≤ 24 bars) | 1h | 1.0% | 5× |
| Regal | trend (Donchian-20 breakout with EMA20/50 filter, 2×ATR stop, 3×ATR trail); liquidity-pocket entry filter (≤ 12 bars) | 4h | 1.0% | 5× |
| Lyra | **Experimental · liquidity pockets · simulated/testnet**: sweep + reclaim of equal highs/lows (pivot k=2, 50-bar memory), stop 0.25×ATR beyond the sweep, 3R target, EMA50 alignment, 48-bar time stop | 1h | 0.75% | 3× |
| Nova | funding capture (≥ 0.03%/h) — **paused in config** (net negative out-of-sample) | hourly checks | 0.75% | 3× |
| Echo | mean reversion (BB 20/2.2 + RSI 28/72, ADX < 20) — **paused in config** (15m was net negative out-of-sample) | 15m | 1.0% | 4× |
| Halo | mean reversion (BB 20/2.2 + RSI 28/72, ADX < 20, target mid band, 1.5×ATR stop, 12-bar time stop); liquidity-pocket entry filter (≤ 12 bars) | 1h | 1.0% | 4× |

Liquidity pockets (`liquidity.ts`, exact port of `research/liquidity.py`; no historical order-book depth exists in public APIs, so resting liquidity is inferred from swing/equal highs-lows and prior-day high/low). The entry filter and Lyra are **testnet experiments**: in the walk-forward + holdout study (fees included) the filter did **not** raise the out-of-sample win rate or net result of the slower desks (Vega: lower net and win rate; Regal: about the same net, half the trades and drawdown; Halo: still negative), and standalone liquidity-pocket strategies were net negative out-of-sample. They are enabled on testnet to observe live behaviour, not because they were shown to work. Config pauses (`"paused": "reason"`) stop new entries but still manage and close open positions; `resume` does not override them.

Funding capture is directional: a single oracle-priced vault has no second venue to hedge on, and the fleet's own OI is excluded when judging skew.

- **Sizing:** notional = equity × risk% ÷ (stop distance + 0.25% buffer); margin ≤ 25% and notional ≤ 1.5× desk equity; leverage ≤ desk cap and low enough that the stop sits inside half the liquidation distance; hard max 2% risk. Every position gets an on-chain SL/TP (`set_triggers`); if that fails twice the position is closed.
- **Desk limits:** daily loss 3% → entries stop until 00:00 UTC; drawdown 10% → halt + close positions (manual `reset`); 5 losses in a row → 4 h pause; ≤ 2 open; ≤ 6 entries/day.
- **Floor-wide limits (all desks trade XLM):** open risk ≤ 5% of fleet equity, same-direction ≤ 3.5%, net notional ≤ 1.5×, gross ≤ 2× equity and ≤ 50% of the vault reserve, ≤ 24 entries/day; fleet daily loss 4% → pause all; fleet drawdown 12% → global kill.
- **Drift stop:** D-1 win-rate z, D-2 KS test on R, D-3 bootstrap cumulative R (vs `office.baselines.json` backtests), D-4 slippage/failed txs, D-5 trade frequency, D-8 strategy metric → score 0–100 (amber = half size, red = halt + close). Strict thresholds until `strictUntil` (14 days). Hard triggers: independent oracle check vs Coinbase/Kraken (deviation > 1.5%, age > 90 s (the vault's `max_price_age`; the oracle feed pushes XLM every ~20 s), flat while reference moves) blocks entries fleet-wide and triggers the global kill after 30 min; journal-vs-chain reconciliation mismatch halts the desk.
- **Keys:** `~/.quasaria-office/keys.json` (0600, outside the repo, never committed). Owner accounts hold the test QUSD; the runner only loads the operator keys (`set_operator`: can trade, can never withdraw).

```bash
npm run office -- setup                        # idempotent: friendbot, QUSD trustline, 500 test QUSD, deposit, set_operator
npm run office -- backtest --days 120 --save   # refresh drift baselines (illustrative, past data)
npm run office -- run --dry-run --once         # plan only (separate state dir, no transactions)
npm run office -- run --paper                  # paper fills on live testnet prices
scripts/back-office.sh start|stop|status|logs  # supervised live runner: auto-restart, heartbeat watchdog, crash-loop -> kill
npm run office -- status
npm run office -- pause|resume|flatten|halt|reset <desk|all>
npm run office -- kill "reason"                # global kill: closes every fleet position, blocks entries
npm run office -- unkill
npm run office -- revoke all                   # owners revoke the bot keys on-chain (emergency)
```

Local admin page: `http://127.0.0.1:52610/` (127.0.0.1 only). The public Back Office page is read-only: positions/trades come from chain reads; bot state from `back-office/status.json` on the `bot-status` branch, pushed every 5 min with the box's existing git credentials. Pages builds only from `main`, so status commits never trigger a site build.

## Stale-data circuit breaker (testnet)

`src/office/staleBreaker.ts`, wired into `src/office/fleet.ts` and `src/lending/cli.ts` / `src/lending/keeper.ts`.

* Sources: the on-chain oracle timestamp (`lastprice`, what the vault checks; it rejects prices older than 90 s) and the
  feed heartbeat file `bot/state/oracle-feed.heartbeat` (written by the oracle feed after every successful XLM push;
  `staleBreaker.heartbeatFile` in `office.config.json`, override with `OFFICE_FEED_HEARTBEAT`, `""` = chain only).
* Age = the older of the two. `>= 60 s` BLOCK, `>= 90 s` TRIP (hard), latched until 3 consecutive fresh reads,
  escalates to the existing global kill after 600 s tripped. A wall-clock jump > 180 s between reads (VM resume) trips
  the breaker and restarts both the fresh-read count and the escalation timer.
* Read on every fleet tick (`Fleet.step` -> `breakerRead`) AND immediately before every risk-increasing order is signed
  (`Fleet.preOrder("entry")`, a fresh `venue.oracleTs()` read): fleet desk entries (`processDesk`) and Orion's live
  entries (`stepCalibratedLive`). There are no resting entry orders (vault opens are atomic market orders), so a
  stale pre-order read cancels the entry outright; nothing is queued.
* Tripped: new entries and size increases refused; closes, stop/target execution, time exits, kill/halt flattens and
  protective trigger updates still run. Status: `staleBreaker` in status.json; Back Office banner
  "STALE DATA · entries halted". Orion's paper/live decisions log `veto: STALE DATA · entries halted`.
* Lending keeper: liquidations act on oracle prices, so each one is re-checked right before signing (fast-path XLM
  timestamp + heartbeat, same thresholds); while tripped the liquidation is skipped and retried next sweep.
* The Autopay keepers do not read oracle prices (agreement sweeps, TTL extension, demo autopilot only): not gated.

## Orion live testnet slice (issue #30)

`liveOverride: "testnet-tiny"` lets the calibrated desk send real TESTNET orders although its model failed the gate.
Refused in code on any network other than testnet. Slice: 100 test QUSD, 0.25 % risk per trade, max 2x, 1 open,
$2 daily loss cap, $5 slice drawdown -> flatten + pause, 4 trades/day; vault minimum margin used when the risk-based
size is smaller. `office setup --only orion` funds its accounts. Raising the slice above $100 or unpausing Echo/Nova is
refused unless `--ack-issue-30` is passed (https://github.com/yogibear1323/quasaria/issues/30).
