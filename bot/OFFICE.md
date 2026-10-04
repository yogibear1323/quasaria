# Back Office fleet (`bot/src/office/`, TESTNET only)

Six automated desks trade the XLM perp on the perps-v1 leverage vault (market key `Stellar(XLM SAC)` from `deployments/testnet.json` → `vault.marketAsset`). Test funds only; unaudited; no expected or guaranteed returns.

| Desk | Strategy | Bars | Risk/trade | Max lev |
|---|---|---|---|---|
| Vega | trend (Donchian-20 breakout with EMA20/50 filter, 2×ATR stop, 3×ATR trail) | 1h | 1.0% | 5× |
| Regal | trend | 4h | 1.0% | 5× |
| Lyra | funding capture (receiving side of external skew ≥ 0.02%/h for 2 samples; 1.25% stop) | hourly checks | 0.75% | 3× |
| Nova | funding capture (stricter: ≥ 0.03%/h) | hourly checks | 0.75% | 3× |
| Echo | mean reversion (BB 20/2.2 + RSI 28/72, ADX < 20, target mid band, 1.5×ATR stop, 12-bar time stop) | 15m | 1.0% | 4× |
| Halo | mean reversion | 1h | 1.0% | 4× |

Funding capture is directional: a single oracle-priced vault has no second venue to hedge on, and the fleet's own OI is excluded when judging skew.

- **Sizing:** notional = equity × risk% ÷ (stop distance + 0.25% buffer); margin ≤ 25% and notional ≤ 1.5× desk equity; leverage ≤ desk cap and low enough that the stop sits inside half the liquidation distance; hard max 2% risk. Every position gets an on-chain SL/TP (`set_triggers`); if that fails twice the position is closed.
- **Desk limits:** daily loss 3% → entries stop until 00:00 UTC; drawdown 10% → halt + close positions (manual `reset`); 5 losses in a row → 4 h pause; ≤ 2 open; ≤ 6 entries/day.
- **Floor-wide limits (all desks trade XLM):** open risk ≤ 5% of fleet equity, same-direction ≤ 3.5%, net notional ≤ 1.5×, gross ≤ 2× equity and ≤ 50% of the vault reserve, ≤ 24 entries/day; fleet daily loss 4% → pause all; fleet drawdown 12% → global kill.
- **Drift stop:** D-1 win-rate z, D-2 KS test on R, D-3 bootstrap cumulative R (vs `office.baselines.json` backtests), D-4 slippage/failed txs, D-5 trade frequency, D-8 strategy metric → score 0–100 (amber = half size, red = halt + close). Strict thresholds until `strictUntil` (14 days). Hard triggers: independent oracle check vs Coinbase/Kraken (deviation > 1.5%, age > 900 s, flat while reference moves) blocks entries fleet-wide and triggers the global kill after 30 min; journal-vs-chain reconciliation mismatch halts the desk.
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
