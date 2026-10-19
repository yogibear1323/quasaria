# Buy page (/buy)

A no-signup guide: copy your address (with QR), buy XLM at a third-party provider and withdraw to it, optionally add the verified USDC trustline.

- Providers are plain outbound links (`src/lib/buyProviders.ts`), checked 2026-10-18: Coinbase `/price/stellar`, Kraken `/buy/xlm`, MoonPay `/buy/xlm`. New tab, `rel="noopener noreferrer"`. No embeds, widgets, keys, affiliate or referral parameters, or backend.
- The tab never mentions GLACIERQ rewards or the referral program.
- USDC issuers (matched on code AND issuer): mainnet Circle `GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN`; testnet `GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5`. The trustline button uses the active network's issuer (testnet today).
- While the app runs on testnet the page says so: XLM bought from providers is real mainnet XLM on the same address and will not show in the app until mainnet is switched on.

## Lawyer-review checklist (before mainnet)
- [ ] Is linking to exchanges/on-ramps (with the neutral "not affiliated" note) acceptable in the launch jurisdictions? Any licensing or financial-promotion rules for pointing users at them?
- [ ] Wording review: "Buy XLM" heading, "XLM is the coin that pays network fees", no price/return language, no "investment" framing.
- [ ] Provider availability and ID checks are described as theirs, not ours; confirm the disclaimer text.
- [ ] Re-verify the three URLs and the Circle USDC issuer immediately before launch.
- [ ] Review any "Stellar" slogans (Buy tab copy and merch) for trademark use.
