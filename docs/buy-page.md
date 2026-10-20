# Buy page (/buy)

A no-signup guide: copy your address (with QR), buy with a card through the Coindisco aggregator widget (when a key is configured) or at an exchange, optionally add the verified USDC trustline.

- **Card purchase (step 2), primary: StellarTerm outbound link** (`src/components/StellarTermBuy.tsx`), checked 2026-10-19: `https://stellarterm.com/buy-crypto?crypto=xlm&network=stellar` (USDC: `crypto=usdc`). New tab, nothing embedded, no key. StellarTerm's URL takes only `crypto` and `network`; it pre-fills an address only for a wallet signed in to StellarTerm, so we show the user's full address with Copy + QR and 3 steps (copy, buy on StellarTerm, paste the Quasaria address). Verified live: logged out, StellarTerm's Coindisco form asks "Enter your Stellar wallet address", so no StellarTerm account is needed. The provider (e.g. MoonPay, chosen inside their widget) does payment and KYC.
- **Coindisco widget (hidden):** the code remains, but the panel renders only when `VITE_COINDISCO_PUBLIC_KEY` is set.
- Coindisco widget details (`src/components/BuyWidget.tsx`, `src/lib/coindisco.ts`), the approach StellarTerm ships. Coindisco aggregates several card providers; the provider does payment, KYC and delivery. No Quasaria backend, no signing, no secret.
  - Needs a publishable key `VITE_COINDISCO_PUBLIC_KEY` (`pk_test_…` sandbox / `pk_prod_…` live) from Quasaria's own Coindisco business dashboard, with `https://yogibear1323.github.io` on its allowed origins. The Pages build reads it from the repo Variable `COINDISCO_PUBLIC_KEY`. Without a valid key the panel shows a "Coming soon" badge and the exchange links. Never copy another site's key (e.g. StellarTerm's).
  - URL: `https://widget.coindisco.com/?publicKey=…&operationMode=buy&defaultAsset=xlm|usdc&defaultNetwork=stellar&defaultFiat=USD` plus frost theme colours; `wallets=stellar:<G…>` is added **only on mainnet** (testnet shows a "mainnet assets only" note and does not pre-fill).
  - iframe: lazy (IntersectionObserver + `loading="lazy"`), `sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-top-navigation-by-user-activation"`, `allow="clipboard-write; payment; camera"`. No CSP meta on the site today; if one is added it needs `frame-src https://widget.coindisco.com`.
  - Production key requires Coindisco KYB (Sumsub) and a signed service agreement; fees/revenue share are not published (ask Coindisco).
- Exchange links are plain outbound links (`src/lib/buyProviders.ts`), checked 2026-10-18: Coinbase `/price/stellar`, Kraken `/buy/xlm`. New tab, `rel="noopener noreferrer"`. No affiliate or referral parameters. MoonPay was removed (2026-10-19).
- The tab never mentions GLACIERQ rewards or the referral program.
- USDC issuers (matched on code AND issuer): mainnet Circle `GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN`; testnet `GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5`. The trustline button uses the active network's issuer (testnet today).
- While the app runs on testnet the page says so: XLM bought from providers is real mainnet XLM on the same address and will not show in the app until mainnet is switched on.

## Lawyer-review checklist (before mainnet)
- [ ] Is linking to exchanges/on-ramps (with the neutral "not affiliated" note) acceptable in the launch jurisdictions? Any licensing or financial-promotion rules for pointing users at them?
- [ ] Wording review: "Buy XLM" heading, "XLM is the coin that pays network fees", no price/return language, no "investment" framing.
- [ ] Provider availability and ID checks are described as theirs, not ours; confirm the disclaimer text.
- [ ] Re-verify the two exchange URLs, the Coindisco widget origin/key and the Circle USDC issuer immediately before launch.
- [ ] Coindisco service agreement (read before signing): liability split, KYB obligations, fees/revenue share, data processing, allowed jurisdictions.
- [ ] Review any "Stellar" slogans (Buy tab copy and merch) for trademark use.
