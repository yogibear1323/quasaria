# Exchange: limit and market orders

Quasaria's Exchange trades on Stellar's own order book (the SDEX). There is no Quasaria contract in between: the page builds a normal Stellar transaction, you sign it in your browser with your own key, and it goes to Horizon.

## Limit orders
`manage_buy_offer` / `manage_sell_offer` at the price you type. The offer rests on the book until it fills or you cancel it ("Your open offers" lists them, each with a Cancel button). A missing trustline is added in the same transaction.

## Market orders (instant buy / sell)
Tapping **Buy** or **Sell** in the Market tab opens a confirm step showing the side, pair, amount, an approximate average price and total taken from the live book, the network fee, and the reserve effect of a new trustline. Nothing is signed before **Confirm**.

How it executes:

1. The order is one `manage_buy_offer` (buy) or `manage_sell_offer` (sell) that crosses the book immediately, priced at a **price-protection band**, which is the best opposing price at tap time plus (buy) or minus (sell) 5%. A thin book therefore cannot fill at an absurd price: levels outside the band are never touched.
2. The transaction result is read: what was received, what was paid, the average price, and whether an offer was left resting.
3. **Any unfilled remainder is cancelled**, always, in a second transaction (`manage_sell_offer` with amount 0 on the exact offer id). If the result can't be read, any new offer on that pair is found from the account's open offers and cancelled instead. If a cancel still fails, the page says so and points at "Your open offers". Nothing is left resting by accident.
4. The result line says **Bought X at avg price Y**, **Partially filled** or **Couldn't fill (thin book)**, with a StellarChain link to the transaction.

Plain errors appear right away, before the confirm step: no trustline or balance for the asset you are paying with, not enough free XLM after the reserve, no offers on the book, account not on the network yet.

### The protection band
* Fixed at 5% (`PROTECTION_BAND` in `src/lib/market.ts`). It is **not user-configurable and not shown before the tap**; the confirm step shows only the estimated average price and total.
* It is a ceiling on how far from the best price the order may reach, not a promise about the price you get. The estimate comes from the book at tap time and can differ if the book moves before the order lands.
* Market orders use the order book only (not the liquidity pools). Swaps (path payments) use both and have a user-set slippage limit on the Swap page.

### Before mainnet signing is enabled
**History:** the instant, no-confirm version was built first (Robert's request), then Robert reversed it and asked for the confirm step back; the code and tests follow the confirm version. The no-confirm behaviour must not return without a fresh decision and a re-check of the mainnet risks below.

Revisit the confirm-step design: this version asks for one confirm but gives the user no slippage control and does not show the band. For mainnet it should at least disclose the worst-case price and total before signing. `MAINNET_SIGNING` stays false until that is decided.

## Tests
`test/market.test.ts` covers the plan maths (band, thin books), transaction construction, parsing of real testnet results, the funds checks and plain error mapping, and that a partial fill, an unreadable result and a failed cancel all end with the remainder cancelled or a visible warning. A manual testnet run (full buy, full sell, partial fill on a thin book, empty side, missing funds) is recorded in the PR.
