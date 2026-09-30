# Quasaria lending market (TESTNET ONLY, UNAUDITED)

> **Testnet-only, unaudited.** This contract has not been audited. It runs on Stellar **testnet** only. Every asset except native XLM and Circle's testnet USDC is a Quasaria testnet **mirror** with no value. Nothing here is financial advice. Do not use real funds.

- Contract: `contracts/lending` (Soroban, Rust, soroban-sdk; about 1,400 lines plus about 1,000 lines of tests)
- Pool (testnet): `CDCT3D7CMUB72CB7P7U2GNPP32UZCNXWO663GTA6EEUP552LMZAARE46`
- Oracle (testnet mock, SEP-40 interface): `CBHMDDCD5NDZKQIGP4VKBTQOQ4OQMK75CYAGHBXY2JT7WGBB774NO2DY`
- Admin / oracle admin: `GDAEZGA66NUQZKMHFMIUI42S6FKGFERY3UHANE43ZM3RGL3FB3VBNKCY` (testnet key; mainnet needs a multisig, see the readiness checklist)
- Parameters: `config/lending-params.json`. Deploy output: `deployments/testnet-lending.json`, `frontend/src/config/lending.json`
- Scripts: `scripts/deploy-lending.ts` (idempotent deploy, list and seed), `scripts/smoke-lending.ts` (end-to-end smoke test)
- Keeper and oracle feed: `bot/src/lending/` (`npm run lending-keeper`, `npm run oracle-feed`)
- UI: `/lending` (`frontend/src/pages/Lending.tsx`, `frontend/src/lib/lending.ts`, `frontend/src/components/AnchorPanel.tsx`, `frontend/src/lib/anchor.ts`)

## 1. Design

This is a single multi-reserve pool in the style of Aave v2 / Blend. It has one **reserve** per asset, keyed by that asset's **Stellar Asset Contract (SAC)** address.

- **Supply** moves tokens into the pool, and the user receives scaled supply shares: `balance = shares × supply_index / 1e12`. The first supply of a collateral-eligible asset turns it on as collateral automatically. `set_collateral` toggles it, and turning collateral off is refused if the resulting health factor would drop below 1.
- **Borrow** requires the borrow limit `Σ(collateral value × LTV) ≥ debt` after the borrow, and HF ≥ 1. Debt is tracked in scaled debt shares against `borrow_index`.
- **Repay** works for yourself or anyone else (`repay(payer, user, asset, amount)`). `i128::MAX` means "all". Repay is never paused.
- **Withdraw** also accepts `i128::MAX` for everything. It is allowed while paused as long as the account stays healthy.
- **Interest** uses a kinked (two-slope) variable rate: `rate = base + slope1·u/opt` below the kink and `base + slope1 + slope2·(u−opt)/(1−opt)` above it. The index accrues linearly per second on every interaction, which compounds across interactions. A **reserve factor** share of the interest goes to the treasury.
- **Tracked cash:** the pool accounts only for tokens moved in through its own functions. A direct transfer (donation) to the contract does not change prices, rates, or share values (tested).
- **Limits:** at most 64 reserves, at most `max_user_reserves` (8, hard cap 10) reserves per user to keep the HF computation bounded, `max_borrowers` (10,000) active borrowers, per-asset supply and borrow caps, a minimum supply and a minimum borrow (dust), and paged views (`reserves_page`, `borrowers_page`, at most 100 per page).
- **Health factor:** `HF = Σ(collateral value × liquidation threshold) / Σ(debt value)`, with a scale of 1e7 = 1.0. It is infinite when there is no debt.

### Rounding (always in the protocol's favor)

| Operation | Rounding |
|---|---|
| supply → shares | down |
| withdraw amount → shares burned | up |
| borrow → debt shares | up |
| repay amount → debt shares burned | down |
| collateral value | down |
| debt value | up |
| seized collateral in liquidation | down |

Tests `rounding_tiny_supply_withdraw_cannot_extract` and `rounding_tiny_borrow_repay_cannot_shrink_debt` show that repeated 1-stroop operations cannot extract value or shrink debt.

## 2. Liquidation

`liquidate(liquidator, borrower, debt_asset, collateral_asset, repay_amount, receive_shares)`

- The call is only allowed when **HF < 1** (otherwise `#20 Healthy`).
- **Close factor 50%:** each call repays at most 50% of the borrower's debt in `debt_asset`. Liquidations therefore happen in chunks, and a keeper calls again if HF is still below 1.
- **Full close only for dust:** the whole debt in that asset can be repaid in one call only when that debt is worth ≤ `close_dust_usd` ($10), or when a 50% chunk would leave a remainder below the asset's `min_borrow`. Test `full_close_only_below_dust_threshold` covers both sides.
- **Bonus 5–8% per asset** (hard cap 10% in the config bounds, and `threshold × (1 + bonus) < 1` is enforced). The liquidator receives collateral worth `repay × (1 + bonus of the collateral asset)`. The bonus is 5% for major stables, 6% for mid stables and XLM, 7% for small stables and major volatile assets, and 8% for small caps and off-peg assets. Tests `liquidation_close_factor_and_bonus` and `liquidation_bonus_per_asset` check the exact amounts.
- If the collateral is insufficient, the seize amount is capped at the borrower's balance and the repay amount is reduced to match.
- `receive_shares = true` lets the liquidator take supply shares instead of tokens, which is useful when pool cash is utilized.
- **Bad debt:** if the borrower has no collateral left but still has debt, the debt is written off. The treasury's accrued reserve covers it first, and any remainder is recorded in `bad_debt` for that reserve. `resolve_bad_debt` performs the write-off and `cover_bad_debt` lets anyone pay recorded bad debt back in. Test: `bad_debt_recorded_and_covered`.

Live smoke result on testnet (`deployments/smoke-lending.json`): moving mock XLM +15% took HF from 1.085 to 0.944. The keeper then repaid exactly 50% of the XLM debt (51.74 XLM) and seized 14.188 USDC, an implied **5.000% bonus**. HF afterwards was 0.995, so a follow-up chunk is allowed.

## 3. Risk parameters (`config/lending-params.json`)

Pool: `max_price_age` 900 s, `close_factor` 50%, `close_dust` $10, `max_user_reserves` 8, `max_borrowers` 10,000, timelock 300 s (testnet; mainnet should be ≥ 24 h). Minimum supply is $1 and minimum borrow is $2, converted at the listing price.

| Tier | LTV / liq. threshold | Bonus | Reserve factor | Rate: base / slope1 / kink / slope2 | Supply / borrow cap | Assets |
|---|---|---|---|---|---|---|
| Major stable | 80 / 85% | 5% | 10% | 0 / 4% / 90% / 60% | $2M / $1.6M | USDC, EURC, PYUSD, USDGLO, EURCV, USDT0 |
| Mid stable | 70 / 77% | 6% | 15% | 0 / 5% / 85% / 80% | $250k / $150k | ZUSD, AUDD, VCHF, USDx, USDZ, USDM, EURMTL |
| Small stable | 50 / 65% | 7% | 20% | 1% / 7% / 80% / 100% | $50k / $25k | GYEN, ARST, BRL, ZARZ, IDRT |
| Borrow-only stable | 0 / 0 (no collateral) | 7% | 20% | 1% / 7% / 80% / 100% | $25k / $10k | ARS, NGNC |
| Off-peg (market-priced) | 0 / 0 (collateral disabled) | 8% | 25% | 2% / 10% / 70% / 200% | $10k / $5k | USD, NGNT, PEN, CLPX, XCHF |
| XLM / liquid XLM | 65 / 75% | 6% | 20% | 0 / 7% / 75% / 300% | $1M / $600k | XLM, yXLM |
| Major volatile | 60 / 70% | 7% | 20% | 0 / 5% / 80% / 300% | $250k / $100k | yUSDC, BTC, yBTC, ETH |
| Small cap | 35 / 45% | 8% | 25% | 2% / 10% / 60% / 300% | $20k / $5k | SHX, AQUA, VELO, BLND, XRP, GOLD, SLVR |
| Micro cap | 0 / 0 (no collateral) | 8% | 25% | 2% / 10% / 60% / 300% | $10k / $2.5k | SCOP, AFR, TFT, LSP |

QUSD (Quasaria's demo stablecoin) is **not listed**, because it is protocol-issued and has no independent market.

**Contract-enforced bounds:** LTV ≤ threshold ≤ 94.99%, bonus ≤ 10%, threshold × (1 + bonus) < 100%, reserve factor ≤ 50%, base ≤ 20%, slope1 ≤ 50%, slope2 ≤ 500%, kink 10–95%, close factor 10–50%, max price age ≤ 1 h, and minimums ≥ 1,000 raw units. On mainnet (network id check), `add_reserve` cannot list an asset with collateral enabled directly (`#27`); collateral must be enabled later through the timelock.

## 4. Oracle

- The pool reads prices through the **SEP-40** interface (`lastprice(Asset::Stellar(sac))`, `decimals()`, `resolution()`), with Reflector's `Asset` / `PriceData` types. A **Reflector** feed can therefore replace the mock on mainnet with only a timelocked `SetOracle` action.
- Checks on every price: the price must exist (`#17 NoPrice`), be no older than `max_price_age` (`#18 StalePrice`), be no more than 60 s in the future (`#19 FuturePrice`), and be > 0.
- On testnet, the **mock oracle** (`contracts/mock-oracle`) implements the same SEP-40 surface (`lastprice`, `price`, `prices`, `assets`, `last_timestamp`, `decimals` = 14, `resolution`) plus an admin-only batched `set_prices`. The bot's `oracle-feed` refreshes it every 5 minutes from **live Stellar mainnet** Horizon quotes (SDEX mid, then the native AMM, then the 1 h candle). Weak stablecoin quotes fall back to an FX reference, and off-peg assets are priced at market.
- **SEP-38 is NOT used for collateral pricing.** SEP-38 quotes are anchor RFQ quotes: firm or indicative prices from a single counterparty for its own trade, not market prices. They can be moved by whoever runs the anchor, so using them would make collateral valuation manipulable. In the UI, SEP-38 appears only as an *indicative* quote inside the optional anchor deposit panel.
- **Mainnet requirement:** Reflector (or an equivalent multi-source SEP-40 feed), with coverage for every listed asset, deviation and heartbeat monitoring, and a circuit breaker. See `docs/mainnet-readiness-checklist.md`.

## 5. Governance

- Two-step admin transfer. There is a **pause** (new supply and new borrows are rejected with `#900`). Repay, safe withdraw, collateral toggles that keep HF ≥ 1, and liquidations keep working, so a pause never traps users or blocks deleveraging.
- **Timelocked actions** (`LendingAction`): `SetOracle`, `SetPoolConfig`, `SetReserveConfig`, `WithdrawTreasury`, `Upgrade`, `SetDelay`. Each is queued, then executed after the delay (300 s on testnet).
- `tighten_reserve` is immediate but only accepts **risk-reducing** changes: lower LTV, threshold or caps, or turning collateral or borrowing off. It rejects anything else (`#24`).
- `add_reserve` is admin-only and immediate (a new listing cannot affect existing users). Its parameters are bounds-checked.

## 6. Keeper

`bot/src/lending/keeper.ts` walks the paged borrower index, simulates `account` for each borrower, picks the largest debt and the best collateral, sizes the repay at the close factor (or a full close for dust), and calls `liquidate`. It sends transactions only when the RPC is testnet; otherwise it runs dry. Keys come from the environment or from `--identity <name>` in the stellar CLI keystore and are never printed. On the box it runs every 60 s as `quasaria-liquidator`, and the oracle feed runs every 300 s as the oracle admin.

## 7. Assets, canonical ids and SACs

Every asset is identified as **`CODE:ISSUER`**, following the SEP-1 `[[CURRENCIES]]` / SEP-11 Txrep convention (`XLM:native` for lumens), plus its **SAC contract id**. The first column below is the mainnet reference asset. The second column is the testnet asset the pool actually holds (a Quasaria mirror such as `mkEURC` unless marked otherwise). The UI shows both on hover, along with the issuer's home domain. All token movement goes through each asset's SAC using the SEP-41 `token::Client` interface. There are no custom wrappers.

| Id | Canonical (mainnet reference) | Testnet asset used | SAC (testnet) | Home domain | Tier | LTV/thr | Bonus | Collateral |
|---|---|---|---|---|---|---|---|---|
| XLM | `XLM:native` | `XLM:native` (native) | `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC` | — | XLM / liquid XLM | 65/75% | 6% | yes |
| USDC | `USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN` | `USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5` (real testnet asset) | `CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA` | circle.com | Major fiat-backed stablecoin | 80/85% | 5% | yes |
| EURC | `EURC:GDHU6WRG4IEQXM5NZ4BMPKOXHW76MZM4Y2IEMFDVXBSDP6SJY4ITNPP2` | `mkEURC:GCHXGEAEFD6H4FRP3L3VXB4E6RHHMY3Q72O76QD4IOOLJIRQPAWZW2ZO` (Quasaria testnet mirror) | `CABYRSHVCLKKGYAEJEPEX47CC47RA54YNANJV4LGRCL7C6DUPW63TNRX` | circle.com | Major fiat-backed stablecoin | 80/85% | 5% | yes |
| PYUSD | `PYUSD:GDQE7IXJ4HUHV6RQHIUPRJSEZE4DRS5WY577O2FY6YQ5LVWZ7JZTU2V5` | `mkPYUSD:GCHXGEAEFD6H4FRP3L3VXB4E6RHHMY3Q72O76QD4IOOLJIRQPAWZW2ZO` (Quasaria testnet mirror) | `CDBU2AQQNNQGAR4KGMSNABEKMSJV6Y2DM5PPEGB3RR3VBEJXBCEVNZLJ` | token-metadata.paxos.com | Major fiat-backed stablecoin | 80/85% | 5% | yes |
| USDGLO | `USDGLO:GBBS25EGYQPGEZCGCFBKG4OAGFXU6DSOQBGTHELLJT3HZXZJ34HWS6XV` | `mkUSDGLO:GCHXGEAEFD6H4FRP3L3VXB4E6RHHMY3Q72O76QD4IOOLJIRQPAWZW2ZO` (Quasaria testnet mirror) | `CARQD2SZV34W5NQDBT454SVDMTL4HPBCZY4MMWDE5Q3RHNQYDPUTEAWC` | app.glodollar.org | Major fiat-backed stablecoin | 80/85% | 5% | yes |
| EURCV | `EURCV:GCEYGIVOLAVBF2TG2RUSGTUJCIN75KEX3NGLMY4VPL4GFE5L355AXW3G` | `mkEURCV:GCHXGEAEFD6H4FRP3L3VXB4E6RHHMY3Q72O76QD4IOOLJIRQPAWZW2ZO` (Quasaria testnet mirror) | `CC3R5F6RTRFZB5OZJLV6DO6NZGHVFM2PJDNO36V3AW26TO22BENQAJFR` | — | Major fiat-backed stablecoin | 80/85% | 5% | yes |
| USDT0 | `USDT0:GATISXX6BZ6NC7IKQBY37CJD4SOZL3CYZJWXEDG6JVIY4WBS6KXJHN6Q` | `mkUSDT0:GCHXGEAEFD6H4FRP3L3VXB4E6RHHMY3Q72O76QD4IOOLJIRQPAWZW2ZO` (Quasaria testnet mirror) | `CCQLHWJ2UK4K3IQFQKLEDGSK3372L6W7IUUMFTILXTFA7SG6ZH7CF4TX` | — | Major fiat-backed stablecoin | 80/85% | 5% | yes |
| GYEN | `GYEN:GDF6VOEGRWLOZ64PQQGKD2IYWA22RLT37GJKS2EJXZHT2VLAGWLC5TOB` | `mkGYEN:GCHXGEAEFD6H4FRP3L3VXB4E6RHHMY3Q72O76QD4IOOLJIRQPAWZW2ZO` (Quasaria testnet mirror) | `CDDJVZBNTZHKDD3QQAEVUMT6PF5KBSARDAW42WQC54ON77JW6VGYEVZ6` | stablecoin.z.com | Less liquid stablecoin | 50/65% | 7% | yes |
| ZUSD | `ZUSD:GDF6VOEGRWLOZ64PQQGKD2IYWA22RLT37GJKS2EJXZHT2VLAGWLC5TOB` | `mkZUSD:GCHXGEAEFD6H4FRP3L3VXB4E6RHHMY3Q72O76QD4IOOLJIRQPAWZW2ZO` (Quasaria testnet mirror) | `CAQ22H6GFEKG2YQH73QJXJGASJR4YIZHE4G7BUEBJXGR2Q4UH4XHUNGF` | stablecoin.z.com | Smaller stablecoin | 70/77% | 6% | yes |
| AUDD | `AUDD:GDC7X2MXTYSAKUUGAIQ7J7RPEIM7GXSAIWFYWWH4GLNFECQVJJLB2EEU` | `mkAUDD:GCHXGEAEFD6H4FRP3L3VXB4E6RHHMY3Q72O76QD4IOOLJIRQPAWZW2ZO` (Quasaria testnet mirror) | `CBMNT2CNEVUPKTXLRXKNTXNAA2674M5C5WYH4VYLDCVJM5TLPVMPY6BQ` | audd.digital | Smaller stablecoin | 70/77% | 6% | yes |
| VCHF | `VCHF:GDXLSLCOPPHTWOQXLLKSVN4VN3G67WD2ENU7UMVAROEYVJLSPSEWXIZN` | `mkVCHF:GCHXGEAEFD6H4FRP3L3VXB4E6RHHMY3Q72O76QD4IOOLJIRQPAWZW2ZO` (Quasaria testnet mirror) | `CA5IAMPXTIH23OWOJWZAF6ZV6YMEFJASITOWNKSGNZPY6CFKIWXKICUU` | vnx.io | Smaller stablecoin | 70/77% | 6% | yes |
| USDx | `USDx:GAVH5ZWACAY2PHPUG4FL3LHHJIYIHOFPSIUGM2KHK25CJWXHAV6QKDMN` | `mkUSDx:GCHXGEAEFD6H4FRP3L3VXB4E6RHHMY3Q72O76QD4IOOLJIRQPAWZW2ZO` (Quasaria testnet mirror) | `CC2Z7JO6WQU47MKSFAM5BHSZL5RHH2SB4UDFWGW2MCTBLL3IHDLKXR4I` | assets.fxdao.io | Smaller stablecoin | 70/77% | 6% | yes |
| USD | `USD:GDUKMGUGDZQK6YHYA5Z6AY2G4XDSZPSZ3SW5UN3ARVMO6QSRDWP5YLEX` | `mkUSD:GCHXGEAEFD6H4FRP3L3VXB4E6RHHMY3Q72O76QD4IOOLJIRQPAWZW2ZO` (Quasaria testnet mirror) | `CC22PPH4DPUZZMONNPETGTCBGQZ52M63MVWSUUQ7M4CD6SVFRF47TILH` | stablecoin.anchorusd.com | Flagged off-peg (no collateral) | 0/0% | 8% | no |
| ARST | `ARST:GCSAZVWXZKWS4XS223M5F54H2B6XPIIXZZGP7KEAIU6YSL5HDRGCI3DG` | `mkARST:GCHXGEAEFD6H4FRP3L3VXB4E6RHHMY3Q72O76QD4IOOLJIRQPAWZW2ZO` (Quasaria testnet mirror) | `CBL4UOALXYKSU6EYB7AUCOC763EPFFPEJDNYQPRM4I45547WWDXDT74H` | pubnet-sep.latamex.com | Less liquid stablecoin | 50/65% | 7% | yes |
| ARS | `ARS:GCYE7C77EB5AWAA25R5XMWNI2EDOKTTFTTPZKM2SR5DI4B4WFD52DARS` | `mkARS:GCHXGEAEFD6H4FRP3L3VXB4E6RHHMY3Q72O76QD4IOOLJIRQPAWZW2ZO` (Quasaria testnet mirror) | `CD7H23GTDKSRTAEAJZNPTSBXQQWK6JQAGXVFXHTDLP5DQWXXOHTZGXCA` | api.anclap.com | Illiquid stablecoin (borrow-only) | 0/0% | 7% | no |
| BRL | `BRL:GDVKY2GU2DRXWTBEYJJWSFXIGBZV6AZNBVVSUHEPZI54LIS6BA7DVVSP` | `mkBRL:GCHXGEAEFD6H4FRP3L3VXB4E6RHHMY3Q72O76QD4IOOLJIRQPAWZW2ZO` (Quasaria testnet mirror) | `CAISCQN23ITIK5SDH4JP7DORQ6INZRWWVRGU4VN3S2RFGPXYA4K7F5WC` | ntokens.com | Less liquid stablecoin | 50/65% | 7% | yes |
| NGNC | `NGNC:GASBV6W7GGED66MXEVC7YZHTWWYMSVYEY35USF2HJZBLABLYIFQGXZY6` | `mkNGNC:GCHXGEAEFD6H4FRP3L3VXB4E6RHHMY3Q72O76QD4IOOLJIRQPAWZW2ZO` (Quasaria testnet mirror) | `CBKNH6KROUSQMAMES333XZ4RNNV6MMQTD7NOV2IRFD6OPX3DSIYC62FP` | ngnc.online | Illiquid stablecoin (borrow-only) | 0/0% | 7% | no |
| NGNT | `NGNT:GAWODAROMJ33V5YDFY3NPYTHVYQG7MJXVJ2ND3AOGIHYRWINES6ACCPD` | `mkNGNT:GCHXGEAEFD6H4FRP3L3VXB4E6RHHMY3Q72O76QD4IOOLJIRQPAWZW2ZO` (Quasaria testnet mirror) | `CAM6PTKPXYP72TEFANEEKCQFV3HTH3COMPDP6KBX5SXR2NBZC74B63T2` | cowrie.exchange | Flagged off-peg (no collateral) | 0/0% | 8% | no |
| PEN | `PEN:GA4TDPNUCZPTOHB3TKUYMDCRVATXKEADH7ZEYEBWJKQKE2UBFCYNBPEN` | `mkPEN:GCHXGEAEFD6H4FRP3L3VXB4E6RHHMY3Q72O76QD4IOOLJIRQPAWZW2ZO` (Quasaria testnet mirror) | `CDOZLOK454NGH27KR2ZSGWXNO5MD6IGVKGWQXX6RFM6PZXA6CSU2PPVM` | api.anclap.com | Flagged off-peg (no collateral) | 0/0% | 8% | no |
| CLPX | `CLPX:GDYSPBVZHPQTYMGSYNOHRZQNLB3ZWFVQ2F7EP7YBOLRGD42XIC3QUX5G` | `mkCLPX:GCHXGEAEFD6H4FRP3L3VXB4E6RHHMY3Q72O76QD4IOOLJIRQPAWZW2ZO` (Quasaria testnet mirror) | `CDQONPSYMCVJ3OUS246ORMCKEBRR26JOMSVMYEE4DJA7KPBUI3H4HIBB` | clpx.finance | Flagged off-peg (no collateral) | 0/0% | 8% | no |
| USDZ | `USDZ:GAKTLPC4ZV37SSCITQ5IS5AQ4WPF4CF4VZJQPPAROSGXMYOATF5U6XPR` | `mkUSDZ:GCHXGEAEFD6H4FRP3L3VXB4E6RHHMY3Q72O76QD4IOOLJIRQPAWZW2ZO` (Quasaria testnet mirror) | `CB3WT4FHEGTEW4CFH4KFFL4KSCMF3IOELVI5357C3LS3YY6KMTBZH2Y7` | zeam.money | Smaller stablecoin | 70/77% | 6% | yes |
| ZARZ | `ZARZ:GAROH4EV3WVVTRQKEY43GZK3XSRBEYETRVZ7SVG5LHWOAANSMCTJBB3U` | `mkZARZ:GCHXGEAEFD6H4FRP3L3VXB4E6RHHMY3Q72O76QD4IOOLJIRQPAWZW2ZO` (Quasaria testnet mirror) | `CABBQINICYAPLZUGIW56OGZ7NRSHSALOTU3FRUF7ADP4X4XWAQN7RHNW` | zeam.money | Less liquid stablecoin | 50/65% | 7% | yes |
| IDRT | `IDRT:GDPKQ2TSNJOFSEE7XSUXPWRP27H6GFGLWD7JCHNEYYWQVGFA543EVBVT` | `mkIDRT:GCHXGEAEFD6H4FRP3L3VXB4E6RHHMY3Q72O76QD4IOOLJIRQPAWZW2ZO` (Quasaria testnet mirror) | `CA3DBIU3UVZQT5737UVPEVZ2OS4DLQG53RYFH7Z2XVNDLZDZ4H5EVBW2` | kbtrading.org | Less liquid stablecoin | 50/65% | 7% | yes |
| XCHF | `XCHF:GDPKQ2TSNJOFSEE7XSUXPWRP27H6GFGLWD7JCHNEYYWQVGFA543EVBVT` | `mkXCHF:GCHXGEAEFD6H4FRP3L3VXB4E6RHHMY3Q72O76QD4IOOLJIRQPAWZW2ZO` (Quasaria testnet mirror) | `CCA2EGCFYA3MFQXGMEPS6UWPB4P223PAVXNEXV5PMTWKYCILTARL5BVQ` | kbtrading.org | Flagged off-peg (no collateral) | 0/0% | 8% | no |
| EURMTL | `EURMTL:GACKTN5DAZGWXRWB2WLM6OPBDHAMT6SJNGLJZPQMEZBUR4JUGBX2UK7V` | `mkEURMTL:GCHXGEAEFD6H4FRP3L3VXB4E6RHHMY3Q72O76QD4IOOLJIRQPAWZW2ZO` (Quasaria testnet mirror) | `CCAWPUCEXULVVG3DRKBJSYAPDXAS62XFU45J2SCDA6ITT4F7H4UCTTYN` | mtl.montelibero.org | Smaller stablecoin | 70/77% | 6% | yes |
| USDM | `USDM:GDHDC4GBNPMENZAOBB4NCQ25TGZPDRK6ZGWUGSI22TVFATOLRPSUUSDM` | `mkUSDM:GCHXGEAEFD6H4FRP3L3VXB4E6RHHMY3Q72O76QD4IOOLJIRQPAWZW2ZO` (Quasaria testnet mirror) | `CCLPZWH6RTWH7H25PMY6ZNWDMSOEGPC7PJT5II6P7JNAVBT77QTPSHG5` | mtl.montelibero.org | Smaller stablecoin | 70/77% | 6% | yes |
| SHX | `SHX:GDSTRSHXHGJ7ZIVRBXEYE5Q74XUVCUSEKEBR7UCHEUUEK72N7I7KJ6JH` | `mkSHX:GCOLXYFNACOB3INECMZSTSBZCV7WVPW6KM7VP6DYAYPTXWCSKJKAHNIV` (Quasaria testnet mirror) | `CD4WDMAGZSBAA6KLJN22X65TQG25WK5FFQP6NALN2IYWYBX34VME7W47` | stronghold.co | Small cap | 35/45% | 8% | yes |
| AQUA | `AQUA:GBNZILSTVQZ4R7IKQDGHYGY2QXL5QOFJYQMXPKWRRM5PAV7Y4M67AQUA` | `mkAQUA:GCOLXYFNACOB3INECMZSTSBZCV7WVPW6KM7VP6DYAYPTXWCSKJKAHNIV` (Quasaria testnet mirror) | `CDT2S2NZRNOKX5WNU7BX6IQAF3W4TSTPMT7NM3AIIFTTXH4N6NKDDMRL` | aqua.network | Small cap | 35/45% | 8% | yes |
| yXLM | `yXLM:GARDNV3Q7YGT4AKSDF25LT32YSCCW4EV22Y2TV3I2PU2MMXJTEDL5T55` | `mkyXLM:GCOLXYFNACOB3INECMZSTSBZCV7WVPW6KM7VP6DYAYPTXWCSKJKAHNIV` (Quasaria testnet mirror) | `CDUAOPX27VN4B2L3B75QTCPNXW2PAIBUSW7V44SPLKTO3OKAIP5Q2JJF` | ultracapital.xyz | XLM / liquid XLM | 65/75% | 6% | yes |
| yUSDC | `yUSDC:GDGTVWSM4MGS4T7Z6W4RPWOCHE2I6RDFCIFZGS3DOA63LWQTRNZNTTFF` | `mkyUSDC:GCOLXYFNACOB3INECMZSTSBZCV7WVPW6KM7VP6DYAYPTXWCSKJKAHNIV` (Quasaria testnet mirror) | `CB27FV3DDMN67ROGX7TOW7NBFWO7XE3O6Y7ZNCUNX63OVAOTVLWJI7EZ` | ultracapital.xyz | Anchored major (BTC/ETH/yield USDC) | 60/70% | 7% | yes |
| yBTC | `yBTC:GBUVRNH4RW4VLHP4C5MOF46RRIRZLAVHYGX45MVSTKA2F6TMR7E7L6NW` | `mkyBTC:GCOLXYFNACOB3INECMZSTSBZCV7WVPW6KM7VP6DYAYPTXWCSKJKAHNIV` (Quasaria testnet mirror) | `CCYMO2JZXWFRRDGOADAP66JDZKQKORH4CFMOEVLHLY6PE5FLV37YSUDB` | ultracapital.xyz | Anchored major (BTC/ETH/yield USDC) | 60/70% | 7% | yes |
| BTC | `BTC:GDPJALI4AZKUU2W426U5WKMAT6CN3AJRPIIRYR2YM54TL2GDWO5O2MZM` | `mkBTC:GCOLXYFNACOB3INECMZSTSBZCV7WVPW6KM7VP6DYAYPTXWCSKJKAHNIV` (Quasaria testnet mirror) | `CDZYSWHCDVFRHH2VMGT7TXS3I6V7QYFQDE3JQKVRYUQJVLBUILLMH47L` | ultracapital.xyz | Anchored major (BTC/ETH/yield USDC) | 60/70% | 7% | yes |
| ETH | `ETH:GBFXOHVAS43OIWNIO7XLRJAHT3BICFEIKOJLZVXNT572MISM4CMGSOCC` | `mkETH:GCOLXYFNACOB3INECMZSTSBZCV7WVPW6KM7VP6DYAYPTXWCSKJKAHNIV` (Quasaria testnet mirror) | `CCROVETFBLX6VFNOMT2FO7XUT732NZBDQ5OXQB4VTV3JV44TNXDJVNWZ` | ultracapital.xyz | Anchored major (BTC/ETH/yield USDC) | 60/70% | 7% | yes |
| VELO | `VELO:GDM4RQUQQUVSKQA7S6EM7XBZP3FCGH4Q7CL6TABQ7B2BEJ5ERARM2M5M` | `mkVELO:GCOLXYFNACOB3INECMZSTSBZCV7WVPW6KM7VP6DYAYPTXWCSKJKAHNIV` (Quasaria testnet mirror) | `CACSLEMIYPYNMJYE5DR6NOTCSTKTHGDRAYZ3TBODTJU3Q4PRMJJEURFU` | — | Small cap | 35/45% | 8% | yes |
| BLND | `BLND:GDJEHTBE6ZHUXSWFI642DCGLUOECLHPF3KSXHPXTSTJ7E3JF6MQ5EZYY` | `mkBLND:GCOLXYFNACOB3INECMZSTSBZCV7WVPW6KM7VP6DYAYPTXWCSKJKAHNIV` (Quasaria testnet mirror) | `CBWNP73744VJFM525RPMJ4QZ757T7YSC6TTANYQURGI3CBRULGTUUXD2` | — | Small cap | 35/45% | 8% | yes |
| XRP | `XRP:GBXRPL45NPHCVMFFAYZVUVFFVKSIZ362ZXFP7I2ETNQ3QKZMFLPRDTD5` | `mkXRP:GCOLXYFNACOB3INECMZSTSBZCV7WVPW6KM7VP6DYAYPTXWCSKJKAHNIV` (Quasaria testnet mirror) | `CDRO3DJ7RZTC6GS5CM3S4C6M24CZRY4TIMS6F7IODHZ64VUM6PDCLHAD` | fchain.io | Small cap | 35/45% | 8% | yes |
| SCOP | `SCOP:GC6OYQJIZF3HFXCYPFCBXYXNGIBQ4TNSFUBUXQJOZWIP6F3YZK4QH3VQ` | `mkSCOP:GCOLXYFNACOB3INECMZSTSBZCV7WVPW6KM7VP6DYAYPTXWCSKJKAHNIV` (Quasaria testnet mirror) | `CBVCOYDNTPHMMHAE3SO3RUQ7I55DWLJJ7XHSHKXWV42FHYGPVBWQPV6W` | scopuly.com | Micro cap (no collateral) | 0/0% | 8% | no |
| AFR | `AFR:GBX6YI45VU7WNAAKA3RBFDR3I3UKNFHTJPQ5F6KOOKSGYIAM4TRQN54W` | `mkAFR:GCOLXYFNACOB3INECMZSTSBZCV7WVPW6KM7VP6DYAYPTXWCSKJKAHNIV` (Quasaria testnet mirror) | `CBUPACOH73PF4UFJ7BNYFPK345EAPTUP3SQVMPEUUBY4UBHKME6R6NWC` | afreum.com | Micro cap (no collateral) | 0/0% | 8% | no |
| TFT | `TFT:GBOVQKJYHXRR3DX6NOX2RRYFRCUMSADGDESTDNBDS6CDVLGVESRTAC47` | `mkTFT:GCOLXYFNACOB3INECMZSTSBZCV7WVPW6KM7VP6DYAYPTXWCSKJKAHNIV` (Quasaria testnet mirror) | `CBVFALCN2AWBM4UFWF4WPRNXGF3S2HG5EQN23J4N5HM54QZUXECFFYIO` | threefold.io | Micro cap (no collateral) | 0/0% | 8% | no |
| GOLD | `GOLD:GBC5ZGK6MQU3XG5Y72SXPA7P5R5NHYT2475SNEJB2U3EQ6J56QLVGOLD` | `mkGOLD:GCOLXYFNACOB3INECMZSTSBZCV7WVPW6KM7VP6DYAYPTXWCSKJKAHNIV` (Quasaria testnet mirror) | `CBTABFH4M2MTNXTI6A7ER57TNOOJ6SAXS2VQBS7URQXIBO7DOYRZOKGV` | mintx.co | Small cap | 35/45% | 8% | yes |
| SLVR | `SLVR:GBZVELEQD3WBN3R3VAG64HVBDOZ76ZL6QPLSFGKWPFED33Q3234NSLVR` | `mkSLVR:GCOLXYFNACOB3INECMZSTSBZCV7WVPW6KM7VP6DYAYPTXWCSKJKAHNIV` (Quasaria testnet mirror) | `CCBKQJOYKICAR6DHUX265DJ3VBLSMNOMHGN6MWXE2ZGBHIXRHZ3BO26F` | mintx.co | Small cap | 35/45% | 8% | yes |
| LSP | `LSP:GAB7STHVD5BDH3EEYXPI3OM7PCS4V443PYB5FNT6CFGJVPDLMKDM24WK` | `mkLSP:GCOLXYFNACOB3INECMZSTSBZCV7WVPW6KM7VP6DYAYPTXWCSKJKAHNIV` (Quasaria testnet mirror) | `CBDBE42GBRNTE5D2CQSCPDVYCSWUNL7NBAZXTBFIE5KDVOKTPZ3PF6IU` | lumenswap.io | Micro cap (no collateral) | 0/0% | 8% | no |

## 8. Standards used

| Standard | Status | Where |
|---|---|---|
| **SEP-41 token interface + Stellar Asset Contracts** | Implemented | All transfers in `contracts/lending` go through `soroban_sdk::token::Client` on each asset's SAC. The SAC for each asset is listed in §7 and in `frontend/src/config/lending.json`. |
| **SEP-40 oracle interface** | Implemented | The pool consumes `lastprice` / `decimals` / `resolution` with `Asset::Stellar(address)`. `contracts/mock-oracle` implements `lastprice`, `price`, `prices`, `assets`, `last_timestamp`, `decimals` and `resolution`, so Reflector can drop in on mainnet. |
| **CODE:ISSUER ids (SEP-1 `[[CURRENCIES]]`, SEP-11 convention)** | Implemented | `canonical` and `testnetCanonical` are stored in the config per asset. The UI shows the id, home domain and SAC on hover in the markets table, and the id and SAC on the action card. |
| **SEP-11 Txrep** | Implemented (preview) | Before signing, the review modal shows a Txrep-style listing (`tx.sourceAccount`, `tx.fee`, `tx.seqNum`, time bounds, `invokeContract.contractAddress`/`functionName`/`args[n]`) annotated with CODE:ISSUER labels and token amounts (`frontend/src/lib/lending.ts: txrep`). It is a human-readable preview, not a full round-trippable Txrep encoder. |
| **SEP-1 stellar.toml** | Draft only | `docs/stellar.toml.draft` lists the org, the contracts (QFX, LP pools, router, staking, lending, oracle) and the assets. **It needs the owner's own domain** to be served at `https://<domain>/.well-known/stellar.toml`. GitHub Pages under `/quasaria` cannot serve the domain root. |
| **SEP-10 web auth** | Implemented (anchor sessions only) | `frontend/src/lib/anchor.ts: verifyChallenge, sep10Token`. The challenge is verified before the connected wallet signs it (seq 0, anchor `SIGNING_KEY`, `<domain> auth` manageData sourced from the user, time bounds). It is used **only** for the anchor session. The lending contract itself uses Soroban `require_auth`, and there is no backend. |
| **SEP-24 interactive deposit/withdraw** | Implemented (optional panel) | `AnchorPanel` on `/lending` works against `testanchor.stellar.org` for USDC and SRT only. It checks `/info`, opens the interactive popup, and polls `/transaction` until a terminal status. Mirror assets show "no anchor, testnet mirror". If the anchor or the asset is unavailable, the panel shows a degraded notice. |
| **SEP-12 KYC** | Via SEP-24 | Handled by the anchor inside the interactive popup. Quasaria does not collect or store KYC data. |
| **SEP-38 quotes** | Indicative only | The anchor panel shows `GET /prices` from the test anchor's `ANCHOR_QUOTE_SERVER` as an *indicative* quote. It is **never** used for collateral pricing (see §4). If the anchor has no quote server, this part is skipped. |
| SEP-6 | Out of scope | Non-interactive deposit/withdraw is redundant with SEP-24 for a wallet UI, and it would require Quasaria to collect SEP-12 KYC fields itself. |
| SEP-31 | Out of scope | Cross-border payments between anchors (sending anchor role) are unrelated to a lending pool. |
| SEP-30 | Out of scope | Account recovery servers are a wallet-custody feature. Quasaria's in-app keys and Freighter handle their own recovery. |
| SEP-7 | Out of scope | `web+stellar:` URIs could hand a transaction to an external wallet. Freighter is already integrated directly, so it isn't needed now; it could be added later for mobile wallets. |

Live check of the test anchor (2026-09-30, MST): `testanchor.stellar.org` stellar.toml, SEP-10, SEP-24 `/info` (USDC and SRT enabled for deposit and withdraw, limits 1–10 for USDC) and SEP-38 `/prices` (e.g. USDC ≈ 1.02 / USD) all responded.

## 9. Tests

- Rust: `cd contracts && cargo test -p quasaria-lending` runs 33 tests covering supply/withdraw, rates, interest to suppliers and the treasury, HF math, the borrow limit, collateral toggles, flags, caps, the per-user reserve cap and paging, the borrower cap, third-party repay, dust, oracle stale/future/missing, the liquidation close factor and per-asset bonus, full close only below dust, bad debt, pause, timelock, treasury withdrawal, two-step admin, config bounds, mainnet listing rules, rounding, donations, and same-asset liquidation. Line coverage on `lending/src/lib.rs` is about 95% (cargo-llvm-cov). Clippy is clean with `-D warnings`, including the strict arithmetic, cast and unwrap lints.
- Bot: `bot/test/lending.test.ts` covers price conversion, liquidation planning (close factor, dust full close, collateral choice) and borrower paging.
- Frontend: `frontend/test/lending.test.ts` covers the config (canonical ids, SACs, bounds), rate math, HF/limit/liquidation price, action previews, Txrep, SEP-1 parsing, SEP-10 challenge verification (including rejection cases), SEP-10 token flow with a mocked fetch, SEP-38 degradation, and the quest hook.
- Live: `node scripts/smoke-lending.ts` runs supply → borrow → accrue → repay → withdraw, then a price shock, a keeper liquidation, and the pause checks.

## 10. Known limitations

- Unaudited, testnet only, with a single admin key on testnet.
- The mock oracle is admin-set. Its prices copy mainnet but can be moved by the oracle admin (the smoke test does this deliberately).
- Interest is linear per interaction, not continuous compounding. APY in the UI assumes daily compounding.
- No isolation mode or e-mode. No flash loans.
- A borrower index with 10,000 entries is fine for a keeper using paged reads, but mainnet needs an indexer (events) rather than chain scans.
