# Quasaria fee distribution (daily job, NOT scheduled)

`distribute.mjs` splits the fee wallet's balance per `split.json` (70% reward reserve / 20% referral payer, both in GLACIERQ bought on the SDEX with a slippage-bounded path payment, 10% treasury in the received asset; XLM buffer kept off the top). Dry-run by default.

    NODE_PATH=frontend/node_modules node scripts/fees/distribute.mjs --network mainnet            # dry-run
    QUASARIA_MAINNET_GO=yes NODE_PATH=frontend/node_modules node scripts/fees/distribute.mjs --network mainnet --send

Testnet sends need `QUASARIA_TESTNET_SEND=yes` + `--send` + a testnet keys file (`--keys`) and `--asset CODE:ISSUER`.
The script refuses to run if any split value is missing or the percentages don't sum to 100.
