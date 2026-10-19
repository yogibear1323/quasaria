# GLACIERQ rewards scripts (dry-run only)

Location: `frontend/scripts/rewards/` (`npm run rewards -- <command> --net testnet`). Plain Stellar payments from ordinary accounts, no smart contract.

| Command | What it does |
|---|---|
| `snapshot --day D` | Reads every GLACIERQ holder from Horizon and stores balances (and `quasaria:ref` data entries) in `state/snapshots/D.json`. |
| `daily --day D` | Effective balance = lower of snapshots D and D-1. 5%/yr from 1M, 7%/yr from 10M, flat on the whole balance, /365. Excludes issuer, reserve, treasury, payer, pools. Scales pro rata if the total would pass the 10M/day cap. Writes a manifest + sha256. |
| `referral --day D` | Bonuses for reward day D-7: 10% of the referee's reward for 365 days to the referrer, +10% for 180 days to the referee, 100k cap per referral each side, 25k/day per referrer, 1M/day sub-budget inside the cap (never crowds out holders). |
| `status` | Balances of issuer, reserve, treasury, payer and PAUSE/snapshot state. |

## Safety
- **Dry-run is the default and the only mode in this build.** `--send` is refused unless `--net testnet` AND `QUASARIA_TESTNET_SEND=yes` (rehearsals with throwaway accounts). Mainnet is blocked by `MAINNET_SIGNING = false`, by `QUASARIA_MAINNET_GO`, and by a `PAUSE` file.
- Idempotency: memo `GLACIERQ:YYYY-MM-DD` (rewards), `GLACIERQ-REF:` / `GLACIERQ-BOOST:` (referral), a local paid-ledger per memo AND an on-chain check of what the payer already paid with that memo/day. 100 payments per transaction; unpayable recipients are dropped and logged, not retried forever.
- Each batch commits `manifest-day` and `manifest-sha256` as data entries on the payer, so the published manifest can be verified.
- Secrets are read from a mode-600 keys file outside the repo (`~/.quasaria-<net>-glacierq/`) only at signing time and are never printed. Tests assert no secret-shaped strings in the scripts.
- `testnet-setup.mjs` / `testnet-seed-testers.mjs`: TESTNET ONLY rehearsal of issuance (100B: 50B reserve, 50B treasury, 30M referral float, XLM/GLACIERQ pool, issuer locked).

Rehearsal result (testnet, throwaway accounts, 2026-10-18): 8 holders, 4 qualifying (500k holder excluded; 6M pool account counted after the lower-of-two rule), total 3,808.21 GLACIERQ, manifest sha256 printed; `--send` refused without the opt-in.
