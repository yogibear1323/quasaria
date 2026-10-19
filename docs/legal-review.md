# Legal-review note (for counsel, before any mainnet launch)

Quasaria is a non-custodial interface: keys are generated and kept in the user's browser, and transactions are signed there. This note lists what to ask a lawyer. It is not legal advice and nothing here has been reviewed.

## Questions by area
1. **Buy page** (`/buy`). It links to Coinbase, Kraken and MoonPay with a "third-party, not affiliated" note and no affiliate codes. Ask: is pointing users at licensed on-ramps acceptable in the launch jurisdictions; is any financial-promotion rule triggered; is the neutral wording enough; does the "XLM pays network fees" explainer count as advice. Re-verify the URLs and the Circle USDC issuer at launch. Details: `docs/buy-page.md`.
2. **Merch slogans using "Stellar"**: "Self-Banking on Stellar", "Level Up on Stellar", "Born on Stellar" (`frontend/src/merch/catalog.ts`), plus "Swap at Light Speed". The Merch page says Quasaria is not affiliated with or endorsed by the Stellar Development Foundation and uses "Stellar" only to describe the network. Ask: trademark/nominative-use position for "Stellar" on apparel, whether a license or different wording is needed, and whether "Self-Banking" or the yeti mascot has conflicts. Merch is a preview with no checkout.
3. **GLACIERQ holder rewards**: 5% a year from 1M, 7% a year from 10M, paid daily from a finite pre-funded reserve, not guaranteed. Ask: securities/commodity/yield-product analysis, whether "rewards for holding" is a promise of return, geographic exclusions, tax reporting, marketing wording (the site never says APY or guarantees).
4. **Referral program**: 10% of a friend's daily reward for 365 days, +10% for 180 days to the friend, caps. Ask: MLM/affiliate rules, consumer-protection disclosures, whether it must be geo-limited.
5. **Liquidity pools and swaps**: native Stellar protocol features; risks (impermanent loss) are disclosed. Ask: whether providing an interface needs registration anywhere.
6. **Market orders**: the confirm step shows an estimate, the 5% protection band is hidden by design; ask whether mainnet needs worst-case price disclosure (also an engineering item).
7. **Custody and keys**: "your keys, your XLM"; we cannot recover keys. Ask about wording of the backup/loss warnings and terms of use.
8. **Privacy**: no accounts or backend; Horizon calls are made from the browser. Ask whether a privacy notice is needed.
9. **Testnet disclaimers** in the footer and pills must be replaced with mainnet risk disclosures at launch.

## Documents to prepare
Terms of use, risk disclosure, privacy notice, rewards terms (the confirmed numbers in `docs/tokenomics.md`), referral terms (`/referral`), trademark position for merch.
