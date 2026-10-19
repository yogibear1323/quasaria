# Mainnet switch checklist

Nothing in this list has been done. The app is testnet-only: `MAINNET_SIGNING` is `false` (`frontend/src/lib/nativePools.ts`), the rewards script has its own `MAINNET_SIGNING = false`, and `frontend/src/lib/config.ts` throws if anything other than testnet is configured. Flip things in this order, in separate reviewed PRs, each with a backup branch.

## 0. Decisions that gate everything
- [ ] Legal review done (see `docs/legal-review.md`) and its blocking items closed.
- [ ] Audit route chosen (see `docs/audit-options.md`). Native pools, swaps and market orders are Stellar protocol features with no Quasaria contract; the Soroban contracts (QFX, leverage vault, lending, staking) are **not** part of the site and stay out of scope.
- [ ] Robert's explicit go, written down in the PR that flips the first flag.

## 1. GLACIERQ on mainnet (do before the app changes)
- [ ] Create issuer, distribution, reward-reserve and referral-payer accounts on a clean machine. Keys go to a 0600 file or hardware/multisig per `docs/multisig-runbook.md`; never into git, chat or logs.
- [ ] Mint 100,000,000,000 GLACIERQ once: 50B to the reward reserve, 50B to the treasury; 30M float from the reserve to the referral payer.
- [ ] Lock the issuer (master weight 0, thresholds 255). Verify on StellarChain that no signer can mint.
- [ ] Publish `stellar.toml` and set the home domain; verify the asset page.
- [ ] Seed XLM/GLACIERQ liquidity from the treasury; check both the pool and the order book.
- [ ] Set `VITE_REWARD_ISSUER_MAINNET` and `VITE_REWARD_RESERVE_MAINNET` (and publish `src/config/rewards.mainnet.json`).

## 2. Rewards script
- [ ] Take daily snapshots for at least two consecutive days (the lower-of-two rule needs both). Review a **dry-run** manifest (`npm run rewards -- daily --net mainnet`): holders, total, cap scaling, sha256.
- [ ] Flip `MAINNET_SIGNING` in `scripts/rewards/rewards.mjs` in a reviewed commit; first real run with `QUASARIA_MAINNET_GO=yes`, watched by a human. Keep the `PAUSE` file procedure at hand.
- [ ] Referral: only after the first holder-reward run has completed cleanly. Then set `REFERRAL_LIVE = true` in `src/lib/rewards.ts` and remove the "Coming after launch" notices.

## 3. App changes
- [ ] Replace the per-page `const NET = "testnet"` with one network config (pages: Wallet, Account, Activity, Swap, Trade, Pools, Earn, Holders, Buy, Referral) so every StellarChain link, Horizon call and passphrase follows it. `explorerTxUrl(hash, net)` already switches host (`stellarchain.io` vs `testnet.stellarchain.io`).
- [ ] Relax the testnet hard stop in `config.ts` deliberately; set `NETWORK_PASSPHRASE`, `HORIZON_URL`.
- [ ] Flip `MAINNET_SIGNING`; keep `MAINNET_BROWSE` available as a read-only fallback.
- [ ] `networkStatus()` (About page line) follows the flag: check it reads "running on mainnet".
- [ ] Buy page: remove the "test network" heads-up, re-verify the three provider URLs and the Circle USDC issuer.
- [ ] Remove the "Testnet · unaudited" pills only after the audit decision.
- [ ] **Revisit the market-order confirm design** (see `docs/market-orders.md`): show the worst-case price and the protection band, consider a user slippage control; the shipped design is testnet-only.
- [ ] Swap/Pools: confirm default slippage (0.5% swap, 1% pools) and the issuer-verified list are right for mainnet assets.
- [ ] USD values: switch on only with a reviewed price source; they are dashes on testnet by design.

## 4. Verification before announcing
- [ ] Small real transactions by the team: send, swap, market buy/sell, pool deposit/withdraw, trustline add; every result links to `https://stellarchain.io/transactions/<hash>`.
- [ ] Full UI pass at 1440 and 390; run `scripts/rewards` dry-run on the live issuer; check Activity shows reward rows.
- [ ] Monitoring: reserve balance and runway, daily payout count and total vs the 10M cap, payer float.

## 5. Rollback
- Every PR has a `backup/2026-10-18-*` branch. A bad deploy is reverted by reverting the merge on `main` (Pages redeploys). Rewards: create the `PAUSE` file, then investigate; payments already made cannot be undone, which is why the first runs are watched.
