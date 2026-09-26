<p align="center">
  <img src="docs/brand/banner.png" alt="Quasaria — trade at the speed of light on Stellar" width="100%" />
</p>

<p align="center">
  <img src="frontend/public/brand/logo.svg" alt="Quasaria logo" width="96" />
</p>

# Quasaria

**A quasar-bright decentralized exchange scaffold for the Stellar network.**
SDEX order books + Soroban AMM pools, staking orbits, the QFX holder-reward token,
an on-chain referral constellation, and leveraged trading bots with a liquidation
keeper. **Everything defaults to Stellar TESTNET.**

> [!CAUTION]
> **Unaudited · testnet only · not financial advice.** This repository is an
> educational scaffold. The smart contracts have **not** been audited and must not
> be deployed to mainnet or used with real funds. Leveraged trading and
> yield-bearing tokens carry a high risk of loss (including total loss of margin)
> and may be subject to securities, derivatives, consumer-protection, tax and
> licensing regulation in your jurisdiction. Nothing here is investment, legal or
> tax advice. Automated bots can malfunction, act on stale prices or trade into
> losses. Use at your own risk.

---

## Name & theme

**Quasaria** (one word) comes from *quasar* — the brightest objects in the
universe, where a black hole's accretion disk fires relativistic jets across
space. It fits an exchange where liquidity spirals in and trades shoot out at the
speed of light. A quick web search found no well-known crypto project with this
name (only an unrelated automation consultancy and a game setting), and it is
distinct from "Stellar" itself.

**Theme — deep space + quasar plasma.** Near-black `#05030f` void, indigo glass
cards with gradient hairlines, and neon accents: quasar cyan `#38f3ff`, plasma
magenta `#ff3dcb`, nebula violet `#9b5cff`, solar gold `#ffd166`. Typography is
Orbitron (display), Space Grotesk (body) and JetBrains Mono (numbers), all
self-hosted. Every page gets its own animated cosmic scene: **Quasar Core**
(Trade), **Nebula Drift** (Pools), **Orbital Rings** (Stake), **Supernova**
(Rewards), **Constellations** (Referrals), **Warp Speed** (Bots). The illustrative
logo is a Q built from a quasar: the tilted accretion disk forms the bowl and the
relativistic jet is the tail. Full brand guide: [`docs/THEME.md`](docs/THEME.md).

**Landing page** (`/`): [desktop, full page](screenshots/00-landing-desktop.png) · [mobile, full page](screenshots/00-landing-mobile.png)

<p align="center"><img src="screenshots/00-landing-mobile-hero.png" alt="Landing page on mobile" width="260" /></p>

| Trade — Quasar Core | Pools — Nebula Drift | Stake — Orbital Rings |
|---|---|---|
| ![Trade](screenshots/01-trade.png) | ![Pools](screenshots/02-pools.png) | ![Stake](screenshots/03-stake.png) |
| **QFX Rewards — Supernova** | **Referrals — Constellations** | **Bots & Leverage — Warp Speed** |
| ![Rewards](screenshots/04-rewards.png) | ![Referrals](screenshots/05-referrals.png) | ![Bots](screenshots/06-bots.png) |
| **Markets (stellarchain.io)** | **Create account** (secret blurred) | **Backup check** (secret blurred) |
| ![Markets](screenshots/07-markets.png) | ![Create account](screenshots/09-create-account-secret-blurred.png) | ![Backup](screenshots/10-backup-check-blurred.png) |

---

## Features at a glance

| # | Feature | On-chain (Soroban / Stellar) | Off-chain |
|---|---|---|---|
| 1 | **Core DEX** | Stellar **SDEX** (manage buy/sell offers, strict-send path payments, automatic trustlines) + `amm-pool` / `router` contracts | Horizon order books, trade aggregations, path finding; Freighter signing |
| 2 | **QFX holder-reward token** | `reward-token`: SEP-41 token, balances stored as shares, global index compounds daily, capped APR, max-supply-bounded emission | Rewards page: countdown to next compounding, calculator |
| 3 | **Liquidity providing** | `amm-pool`: x·y=k, SEP-41 **QLP** share token, 0.30% fee accrues to LPs | Pools page: deposit/withdraw, fee APR estimate |
| 4 | **Staking** | `staking`: admin-whitelisted pools, per-pool reward rate, funded reserves, optional lock | Stake page |
| 5 | **Referrals** | `referral`: set-once, no self-referral, no cycles; pools & vault pay referrers a share of fees | Referral dashboard, `?ref=` shareable link |
| 6 | **Bot leverage trading** | `leverage-vault`: collateral, positions with max-leverage cap, health-factor liquidation, operator delegation, on-chain SL/TP; `mock-oracle` with a Reflector-compatible interface | `bot/`: grid / DCA / momentum strategies, risk manager, paper vault, liquidation + SL/TP keeper |

---

## Architecture

```mermaid
flowchart LR
  subgraph Browser["Frontend (React + Vite + TS)"]
    UI["Pages: Trade · Pools · Stake · Rewards · Referrals · Bots"]
    FW["Freighter wallet<br/>@stellar/freighter-api"]
    SDK["@stellar/stellar-sdk<br/>Horizon + Soroban RPC"]
    UI --> SDK
    UI -- sign XDR --> FW
  end

  subgraph Stellar["Stellar TESTNET"]
    SDEX[("SDEX order books<br/>offers / path payments")]
    subgraph Soroban["Soroban contracts (contracts/)"]
      ROUTER["router"]
      POOL["amm-pool ×N<br/>(QLP SEP-41 shares)"]
      QFX["reward-token<br/>QFX (SEP-41, daily index)"]
      STAKE["staking"]
      REF["referral registry"]
      VAULT["leverage-vault"]
      ORACLE["mock-oracle<br/>(Reflector interface)"]
      SAC["Stellar Asset Contracts<br/>XLM / QUSD / USDC"]
    end
    REFLECTOR["Reflector oracle<br/>(optional, real feeds)"]
  end

  subgraph Bot["bot/ (Node + TypeScript)"]
    ENGINE["BotEngine<br/>grid · DCA · momentum"]
    RISK["RiskManager<br/>lev cap · max positions · daily loss"]
    KEEPER["Keeper<br/>liquidate · execute_trigger"]
  end

  SDK -- Horizon --> SDEX
  SDK -- RPC simulate/send --> ROUTER & POOL & QFX & STAKE & REF & VAULT
  ROUTER --> POOL
  POOL -- fee share --> REF
  VAULT -- fee share --> REF
  POOL & STAKE & VAULT --> SAC
  POOL -.QFX pairs.-> QFX
  VAULT -- lastprice --> ORACLE
  VAULT -. set_oracle .-> REFLECTOR
  ENGINE --> RISK --> VAULT
  KEEPER --> VAULT
```

### Repository layout

```
contracts/            Cargo workspace (soroban-sdk 28), one crate per contract
  reward-token/       QFX: SEP-41 holder-reward token (index/shares)
  amm-pool/           constant-product pool + QLP SEP-41 LP token
  router/             multi-hop exact-in swap router
  staking/            whitelisted multi-pool staking with locks
  referral/           referral registry (set once, no self, no cycles)
  leverage-vault/     margin/leverage vault, health-factor liquidation
  mock-oracle/        Reflector-compatible price oracle for tests/testnet
frontend/             React + Vite + TS dApp (Freighter, stellar-sdk)
  public/brand/       logo.svg (illustrative master), favicon.svg (small variant)
  src/components/     CosmicBackground (6 animated scenes), Layout, OrderBook, ...
  src/pages/          Landing, Trade, Pools, Stake, Rewards, Referrals, Bots, Markets
bot/                  TypeScript bot + keeper service (vitest tests)
shared/               stablecoins.ts: stablecoin discovery (frontend + scripts)
config/               stablecoins.json: allowlist / denylist / thresholds
deployments/          testnet.json, testnet-stablecoins.json (live IDs)
scripts/              build.sh, deploy-testnet.sh, seed-testnet.sh,
                      gen-stablecoin-pairs.ts, seed-stablecoin-pools.{sh,ts},
                      render-brand.mjs, screenshots.mjs
docs/                 THEME.md brand guide, brand renders, stablecoin-pairs.json
screenshots/          headless-Chromium captures of every page
```

---

## Setup

Prerequisites (versions used to build this scaffold):

| Tool | Version | Install |
|---|---|---|
| Rust | ≥ 1.91 (soroban-sdk 28 MSRV); tested 1.98 | `rustup` |
| Wasm target | `wasm32v1-none` | `rustup target add wasm32v1-none` |
| Stellar CLI | 28.0.0 | [releases](https://github.com/stellar/stellar-cli/releases) or `cargo install --locked stellar-cli` |
| Node.js | ≥ 22.12 (stellar-sdk 17 / vitest 5) | nodejs.org |
| Freighter | latest, set to **Testnet** | freighter.app |

```bash
# everything: contract tests + wasm, bot typecheck + tests, frontend build
./scripts/build.sh

# or piecemeal
(cd contracts && cargo test && stellar contract build)
(cd bot && npm ci && npm run typecheck && npm test)
(cd frontend && npm ci && npm run build)
```

### Run the frontend

```bash
cd frontend && npm run dev          # http://127.0.0.1:5173
```

Without a wallet or deployed contracts the app runs in **read-only demo mode**:
the SDEX order book is fetched live from Horizon testnet (falling back to demo
data if unreachable/empty), and Soroban-backed panels show demo numbers. Set
`VITE_OFFLINE_DEMO=1` to avoid all network calls.

### Run the bot

```bash
cd bot
npm run paper                        # simulated vault + deterministic random walk
npm start -- --config quasaria-bot.config.example.json --mode paper --ticks 1000
cp .env.example .env                 # then fill in testnet IDs + operator key
npm run keeper                       # live liquidation / SL-TP keeper (testnet)
npm start -- --config my-bot.json --mode live
```

The Bots page can export a config (`quasaria-bot.config.json`) that `parseConfig`
validates (testnet only, leverage ≤ risk cap ≤ 20×).

---

## Testnet deployment (live)

Quasaria is **deployed on Stellar testnet** and the frontend reads it by default.
Its config is committed in [`deployments/testnet.json`](deployments/testnet.json)
and copied to `frontend/src/config/testnet.json`. Any `VITE_*` env var overrides it.

| Key | Contract | ID (stellar.expert) |
|---|---|---|
| `xlmSac` | Native XLM Stellar Asset Contract | [`CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC`](https://stellar.expert/explorer/testnet/contract/CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC) |
| `qusdSac` | QUSD demo stablecoin SAC | [`CD4BXA4OL37HBNWDLTBYQK32HEHUZPMVV4F272F7YKOZM2MIB5HDNLUZ`](https://stellar.expert/explorer/testnet/contract/CD4BXA4OL37HBNWDLTBYQK32HEHUZPMVV4F272F7YKOZM2MIB5HDNLUZ) |
| `referral` | Referral registry | [`CBUKO4MSYOFSDKEDK6WZRXCFXLS3Q4OM5ZMF4PURQCHUNF3AAH76OUJ3`](https://stellar.expert/explorer/testnet/contract/CBUKO4MSYOFSDKEDK6WZRXCFXLS3Q4OM5ZMF4PURQCHUNF3AAH76OUJ3) |
| `qfx` | QFX reward token | [`CDUMMYBMXILXLPFI5ZI534W6NGUILN2WSMXWKX2HAMT5BWCHN2E774HZ`](https://stellar.expert/explorer/testnet/contract/CDUMMYBMXILXLPFI5ZI534W6NGUILN2WSMXWKX2HAMT5BWCHN2E774HZ) |
| `poolXlmQusd` | AMM pool XLM/QUSD | [`CB4HOL3DI3C2YE5M3HERSGKHOIOMFPZXT27TDHHMQJZRPTIHEP7QOV7F`](https://stellar.expert/explorer/testnet/contract/CB4HOL3DI3C2YE5M3HERSGKHOIOMFPZXT27TDHHMQJZRPTIHEP7QOV7F) |
| `poolQfxQusd` | AMM pool QFX/QUSD | [`CABGFGIJSWCZVVKLFGJUYWZJC3L3Y2OV5J7Z6DX3TZ2VO7B2RBW4F36Q`](https://stellar.expert/explorer/testnet/contract/CABGFGIJSWCZVVKLFGJUYWZJC3L3Y2OV5J7Z6DX3TZ2VO7B2RBW4F36Q) |
| `router` | Router | [`CDVMF4C3MH7VQSHDKWOPEYTH7TRNZCDHREWO2JJ2C4OD57AAIRGXRCIK`](https://stellar.expert/explorer/testnet/contract/CDVMF4C3MH7VQSHDKWOPEYTH7TRNZCDHREWO2JJ2C4OD57AAIRGXRCIK) |
| `staking` | Staking | [`CCT3POPX42HVLHC2CWZ3NYMGM4QK7ENUWHOM2UJGENVP663I7O2PAYZB`](https://stellar.expert/explorer/testnet/contract/CCT3POPX42HVLHC2CWZ3NYMGM4QK7ENUWHOM2UJGENVP663I7O2PAYZB) |
| `oracle` | Mock oracle | [`CBE3RO7HTU766G3RHQYBBUNQY3WJLY7C5JRKYGTELIHHVI26HSEVJMPK`](https://stellar.expert/explorer/testnet/contract/CBE3RO7HTU766G3RHQYBBUNQY3WJLY7C5JRKYGTELIHHVI26HSEVJMPK) |
| `vault` | Leverage vault | [`CDBGDS5KB6QJ3E5GQH7T66C6CED576ZCIQAJXEYDWRV27OJLTICNKZNF`](https://stellar.expert/explorer/testnet/contract/CDBGDS5KB6QJ3E5GQH7T66C6CED576ZCIQAJXEYDWRV27OJLTICNKZNF) |

- Admin / LP: [`GDAEZGA66NUQZKMHFMIUI42S6FKGFERY3UHANE43ZM3RGL3FB3VBNKCY`](https://stellar.expert/explorer/testnet/account/GDAEZGA66NUQZKMHFMIUI42S6FKGFERY3UHANE43ZM3RGL3FB3VBNKCY)
- Demo trader: [`GBSMEW3XCI3YNPD4U5VYEHLALFWKOX634XZIHQXAXAWLBXTG36OLOP56`](https://stellar.expert/explorer/testnet/account/GBSMEW3XCI3YNPD4U5VYEHLALFWKOX634XZIHQXAXAWLBXTG36OLOP56)
- Keys live only in the local Stellar CLI keystore (`~/.config/stellar/identity`). They are never in the repo.

**What the seed created:**
- 5M QFX minted.
- XLM/QUSD pool: 5,000 XLM + 600 QUSD. QFX/QUSD pool: 200k + 100k.
- Two staking pools, each funded with 500k QFX: QFX→QFX with a 7-day lock, and QLP(XLM/QUSD)→QFX flexible.
- 200k QUSD of vault liquidity, and oracle price XLM = 0.1234 QUSD.
- The admin staked 100 QLP.
- The demo trader:
  - set the admin as referrer
  - swapped 200 XLM → 23.01 QUSD through the router, which paid a 0.12 XLM referral fee on-chain
  - staked 10k QFX
  - deposited 1,000 QUSD into the vault
  - opened a 5× long (#1) and a 3× short (#2) with SL/TP

**Live vs demo in the UI:**
- **Live from Soroban testnet** (tagged "● live"):
  - Pools: reserves, LP share, 24h volume from swap events.
  - Stake: pools, stake and pending rewards.
  - QFX Rewards: `reward_info` and balances.
  - Referrals: count, earnings and payout history from `referral_paid` events.
  - Bots: on-chain positions, health, vault liquidity, oracle mark and staleness.
  - Trade: the AMM quote.
  - The SDEX order book comes live from Horizon.
  - Pages without a connected wallet show the demo trader / admin (read-only viewer).
- **Still demo:**
  - The candle chart falls back to a demo series when Horizon has no history for the pair.
  - The bot strategy builder is config only; the bots run from `bot/`.
- The mock oracle price goes stale after 15 minutes. After that the vault refuses opens and liquidations until someone pushes a fresh price with `set_price`.

**Keeper:**

```bash
cd bot
npm run keeper -- --dry-run                                   # no key needed, simulates only
QUASARIA_SECRET="$(stellar keys show quasaria-admin)" npm run keeper -- --once
```

**Re-running** `deploy-testnet.sh` / `seed-testnet.sh` is idempotent. Existing aliases are reused unless `FRESH=1`, and staking pools are added only once.

### Deploying from scratch

```bash
cd contracts && stellar contract build && cd ..
DRY_RUN=1 ./scripts/deploy-testnet.sh   # preview every CLI command
./scripts/deploy-testnet.sh             # deploy (refuses anything but NETWORK=testnet)
./scripts/seed-testnet.sh               # mint demo QUSD/QFX, add liquidity, fund rewards
cd frontend && npm run dev              # uses frontend/src/config/testnet.json written by deploy
```

What `deploy-testnet.sh` does:

1. Adds the `testnet` network, creates + friendbot-funds identity `quasaria-admin`.
2. Resolves the native XLM SAC and deploys a SAC for demo stablecoin `QUSD:<admin>`.
3. Deploys `referral` (20% fee share), `reward-token` (QFX, 12% APR, 1B cap),
   two `amm-pool`s (XLM/QUSD, QFX/QUSD, 0.30% fee), `router`, `staking`,
   `mock-oracle` (14 decimals) and `leverage-vault` (10× max, 5% maintenance,
   5% liquidation bonus, 0.10% open fee, 15-min max price age) using constructor
   arguments.
4. Wires permissions: pools + vault as referral fee sources, XLM market enabled,
   initial oracle price, two staking pools (QFX 7-day lock; XLM/QUSD QLP flexible).
5. Writes `deployments/testnet.json` (copied to `frontend/src/config/testnet.json`) and `bot/.env`.

**Using Reflector instead of the mock oracle:** the vault only needs
`lastprice(Asset) -> Option<PriceData>` and `decimals()`, with the same XDR
shapes as Reflector (`Asset::Stellar(Address) | Asset::Other(Symbol)`,
`PriceData { price: i128, timestamp: u64 }`). Look up the current Reflector
testnet contract for the feed you want at reflector.network, then
`stellar contract invoke --id <vault> ... -- set_oracle --oracle <reflector_id>`
and enable markets whose `Asset` key matches that feed. Verify the asset symbols
and decimals of the feed before trusting it.

## Landing page

`/` is the public landing page (`frontend/src/pages/Landing.tsx`). The app keeps its
existing top-level routes (`/trade`, `/pools`, `/markets`, …), and `/app` is an alias for Trade.
We kept the routes rather than moving them under `/app` so that shared links
(`/trade?base=…`, `?ref=G…`) and the Markets "Trade" buttons keep working.

- **Copy.** The copy is parsed at build time from
  [`docs/landing-outline.md`](docs/landing-outline.md), so all 14 headlines and pitches are the approved
  text verbatim. `test/landing.test.ts` checks that the outline has all 14 sections.
- **Buttons.** **Launch app** → `/trade`. **Create a wallet** opens the non-custodial account modal
  straight at the freshly generated key (`openModal("create")`).
- **Real data:**
  - the XLM/USD ticker and markets preview (stellarchain.io, with "as of" and stale flags)
  - the live SDEX XLM/USDC book (Horizon testnet)
  - the XLM/QUSD swap quote and pool list (Soroban reserves)
  - the latest ledger number and close gap
  - live staking pools, QFX `reward_info`, and the demo referrer's on-chain earnings
  - the stablecoin logo grid and world map, built from `docs/stablecoin-pairs.json`. The badge says **Verified by issuer** when the issuer's stellar.toml confirmed the coin, and **Allowlisted issuer** for Circle's USDC and EURC, whose toml returns 404.
  - contract links to stellar.expert from the deployed IDs
- **Labelled as example, estimate or simulation:**
  - the LP fee estimator (an estimate that depends on the user's volume assumption)
  - the staking lock slider (made-up example rates)
  - the QFX compounding chart (example numbers at the current APR)
  - the bot performance preview (a synthetic random walk)
  - the order-settling animation
- **Footer.** It carries the risk disclosure and "Audit status: not yet audited".
- **Background.** The background scene switches as you scroll (quasar → constellations → nebula → orbits → supernova → warp).
- **Responsive.** The layout adapts down to 390 px. The screenshot script asserts there's no horizontal overflow on mobile.

---

## Data sources: stellarchain.io market data

The **Markets** page (`/markets`), the header XLM/USD ticker and the Trade page's
asset pickers use the public [stellarchain.io](https://stellarchain.io) API
(`https://api.stellarchain.io/v1`). The client is `frontend/src/lib/stellarchain.ts`.
Data from stellarchain.io is attributed on the page.

- **Display only.** Prices never feed the oracle, the vault or any swap math.
  Trading always uses on-chain testnet reserves and Horizon order books.
- **Caching.** Responses are cached for 5 minutes in memory and in localStorage.
  If the API fails, the last good (expired) cache is served and marked stale.
  Requests time out.
- **Staleness.** Every row shows its "as of" time and a stale flag.
  - When this was built, the mainnet asset snapshots were dated **2026-09-11**, about 2 weeks old. The overview XLM price was fresh.
  - Testnet feed prices are null, so testnet prices are filled in from the Horizon testnet order book against XLM.
  - The XLM/USD ticker falls back to the Horizon testnet XLM/USDC mid when the feed is more than 2 h old.
- **Mainnet is reference only.** The Mainnet tab is read-only. Its Trade buttons open testnet pairs only.

## Non-custodial by design

Create or import a Stellar account in the browser. Click **Create account** in the header.

- Keys are generated locally with `Keypair.random()` (Web Crypto). They are **never sent to any server**.
- The secret is shown once, with copy/download options and warnings. A backup check (re-type characters of the secret) is required before you continue.
- **Remember on this device** is optional. It encrypts the secret with a password: PBKDF2-SHA256 (600k iterations) → AES-256-GCM, with the public key as additional data. The result is stored in localStorage (`quasaria.keystore.v1`), and **Forget this device** wipes it.
- On testnet the account is funded by Friendbot. On mainnet a new account needs a minimum XLM balance (base reserve) from somewhere else.
- In-app keys and Freighter share one `Signer` interface (`src/lib/signer.ts`), so every transaction path works with either.
- Losing the secret (and password) means losing the account. Nobody can recover it.

## XLM/stablecoin pairs (auto-discovered)

Quasaria doesn't hard-code a stablecoin list. `shared/stablecoins.ts` is
dependency-free TypeScript used by the frontend and by Node scripts. It builds
**one XLM/stablecoin pair per stablecoin** from the stellarchain.io asset feed:

1. **Page through** `/v1/market/assets?network=…` (998 mainnet assets at generation time).
2. **Select fiat-anchored assets.** An asset qualifies if its stellar.toml says
   `anchor_asset_type = "fiat"`, its `anchor_asset` is an ISO fiat currency, or it is a
   major stablecoin code (USDC / USDT / EURC / PYUSD / USDT0). A crypto-anchored token must also
   carry its peg in the code.
3. **Drop yield-bearing or wrapped variants** (yUSDC, USDY, allbridge a*USDC, sUSD, axlUSDC …),
   unless the toml clearly says they are fiat-anchored.
4. **Safety filters** (configurable):
   - at least 1,000 trustlines
   - at least 10 trades in 24h
   - a denylist
   - suspicious domain patterns (`qfs`, `maga`, `new-stellar`, `usd1-stellar`)
   - brand-domain rules: USDC only from circle.com, PYUSD only from paxos.com, USDT0 only from usdt0.to, EURC only from circle.com or mykobo.co. USDT has **no** official Stellar issuer.
5. **Issuer verification.** Fetch `https://<home_domain>/.well-known/stellar.toml` and require a
   `[[CURRENCIES]]` entry with the same code **and** issuer. Results are cached in
   `.cache/`. If the fetch fails or returns an HTML bot wall, the asset stays **unverified**,
   unless it's allowlisted in config.
6. **Duplicates.** Repeated codes are flagged. The most-held verified issuer becomes `primary`.
7. **Overrides.** `config/stablecoins.json` has `allowlist` / `denylist` entries and
   `minHolders` / `minTrades24h`. Circle's USDC and EURC are allowlisted because
   `circle.com/.well-known/stellar.toml` returns 404.

Output: [`docs/stablecoin-pairs.json`](docs/stablecoin-pairs.json). Each pair has
code, issuer, domain, peg currency, holders, a verified flag, the verification method,
duplicate/primary flags and the data `asOf` time. It also includes a read-only snapshot of
the mainnet native liquidity pool and SDEX best bid/ask for the pair. Every rejected
stablecoin-like asset is listed with its reasons.

```bash
node scripts/gen-stablecoin-pairs.ts            # regenerate docs/stablecoin-pairs.json (reads mainnet data only)
./scripts/seed-stablecoin-pools.sh              # create + seed the TESTNET pools (idempotent, resumable)
```

**Result (feed as of 2026-09-11T02:50Z):**
- 21 verified primary pairs: USDC (circle, allowlisted), ARST, ZARZ, USDZ, PEN, USD (anchorusd), ARS, EURC (circle, allowlisted), USDT0 (usdt0.to), PYUSD (paxos), IDRT, NGNT, BRL, NGNC, CLPX, XCHF, EURMTL, USDM, GYEN, ZUSD, AUDD.
- 1 unverified pair: EURC from mykobo.co. It's a duplicate code and its toml sits behind a bot wall.
- 60 stablecoin-like assets rejected. Examples:
  - PYUSD from pyusd-qfs.com, USDT0 from stellarusdtzero.com, aeUSDC from stellarallbridge.io, OUSD from q-maga.com, MGUSD: impostors or denylisted.
  - USDT from dead.apay.io, and USDT with no home domain: no official USDT issuer.
  - yUSDC: yield-bearing.
  - USDGLO: 625 holders. USDV: 18 holders.
  - CHF / USD from swisscustody: fewer than 10 trades.

**Pools page.** The pools table lists the pairs.
- Verified pairs are shown by default. Unverified ones sit behind a **Show unverified**
  toggle with a risk warning.
- Each row shows the issuer domain, holder count, verification badge, duplicate/primary flags and the
  mainnet native LP + SDEX snapshot.
- On testnet, rows also show live Soroban AMM reserves and live native (protocol-level) liquidity-pool reserves.
- From a row you can deposit into the Soroban pool, deposit into the native pool (**Native LP** tab), or open the SDEX order book on the Trade page.

**Testnet pools.** Mainnet issuers don't exist on testnet, so the seed script works like this:
- It uses a real testnet stablecoin from the feed's `network=testnet` listing where one is tradeable.
  Only **Circle testnet USDC** (`GBBD47…FLA5`) qualified. It was bought on the testnet SDEX.
- For every other code it issues a clearly labelled **mock**: code `mk<CODE>` from
  issuer `quasaria-mock-stables` with home_domain `mock-stables.quasaria.invalid`,
  shown with a MOCK badge.
- EURC fell back to a mock because the testnet EURC order book has no asks.
- Pools are priced at the mainnet reference price for the pair (SDEX mid, else the native LP ratio).
  The testnet USDC native pool already existed, so the script joined it at its own price.
- For each pair it creates:
  - a Soroban `amm-pool` (alias `quasaria-stable-<code>`, referral fee source)
  - a native liquidity-pool deposit
  - for mocks, two-sided SDEX offers
- State lives in `deployments/testnet-stablecoins.json`, which is copied to the frontend.

**Created on testnet (21 pools):**

| Pair | Kind | Soroban AMM pool | Soroban seed | Native LP (pool id) |
|---|---|---|---|---|
| XLM/USDC | REAL (Circle testnet) | [`CCM32L…GUT2`](https://stellar.expert/explorer/testnet/contract/CCM32LPLLJTJZG2NRC4B34Y4EQTABG4EFGMUWCZ2E5LU4O6G5ZAJGUT2) | 500 XLM / 110.59 | [`4cd1f6defb…`](https://stellar.expert/explorer/testnet/liquidity-pool/4cd1f6defba237eecbc5fefe259f89ebc4b5edd49116beb5536c4034fc48d63f) |
| XLM/mkARST | MOCK of ARST | [`CDQFJB…X6X3`](https://stellar.expert/explorer/testnet/contract/CDQFJBOBXBZUOUY4I7U36HHNGC7UHLQN7M5IWVO3YN3M4JDCTC6FX6X3) | 500 XLM / 170,616.86 | [`c712e7b77a…`](https://stellar.expert/explorer/testnet/liquidity-pool/c712e7b77ac27b6b2889b28526080a70d0572cb8f491b07d2ca0f36172e772c9) |
| XLM/mkZARZ | MOCK of ZARZ | [`CC6IPS…JSMS`](https://stellar.expert/explorer/testnet/contract/CC6IPS3Y2EHRJDDBXJDVVXUZ2QFK3W5HB5KTECFAOQPIETJKVHY7JSMS) | 500 XLM / 1,791.18 | [`baa9847a26…`](https://stellar.expert/explorer/testnet/liquidity-pool/baa9847a26f77b0213ec60c94245a48c0a993dffef0d73b78fad989cad6a9e82) |
| XLM/mkUSDZ | MOCK of USDZ | [`CDHCMK…TPT3`](https://stellar.expert/explorer/testnet/contract/CDHCMKQJK7FDOQR7HCE2HSJO4ESQGFF3N3BPA5K4K3OXFPTBG4D6TPT3) | 500 XLM / 109.94 | [`f543e7040b…`](https://stellar.expert/explorer/testnet/liquidity-pool/f543e7040b91fcc84b77b8c985688db235f2e3b2a1b57c529c7fc9ebffa35273) |
| XLM/mkPEN | MOCK of PEN | [`CDISZK…FK3G`](https://stellar.expert/explorer/testnet/contract/CDISZK3CXUHBEWIKHHMOABN73HLBK4PKOKBDGH47GAGQ3NXHTE62FK3G) | 500 XLM / 207.02 | [`97aca7fb7d…`](https://stellar.expert/explorer/testnet/liquidity-pool/97aca7fb7d5eceec4c637e37654134ad2b0154d3b7e21a8ebed8b8cbe073f105) |
| XLM/mkUSD | MOCK of USD | [`CBFDNU…CB3U`](https://stellar.expert/explorer/testnet/contract/CBFDNU4FRQAW56XFQZQV7LBL5ZRM4P2P4ACA2TUEGDGVLV47W3GFCB3U) | 500 XLM / 441.11 | [`eaab013ff5…`](https://stellar.expert/explorer/testnet/liquidity-pool/eaab013ff5216db94fa0cec03a31fe31b7e778a13ca7ea42ab95c29319906410) |
| XLM/mkARS | MOCK of ARS | [`CD3AOG…MWCY`](https://stellar.expert/explorer/testnet/contract/CD3AOG47NMQOMTPA2FC354I3DK5CT2RF3XB2NX6CCJ3JIGXJT566MWCY) | 500 XLM / 171,661.71 | [`14e0c56e74…`](https://stellar.expert/explorer/testnet/liquidity-pool/14e0c56e74cca083885e37b67648beacf2ab974b2d68c2896acf59673c7eb444) |
| XLM/mkEURC | MOCK of EURC | [`CACKFT…NF6A`](https://stellar.expert/explorer/testnet/contract/CACKFTCMSW3FBMHGU3QS6DFVP4JIES7ZZDYHFT6XMXI6ZR22SLXENF6A) | 500 XLM / 97.25 | [`d91001dad5…`](https://stellar.expert/explorer/testnet/liquidity-pool/d91001dad5c9db2ff84f615cf35d1f54e5b26ceb2072fa067fc0b250cfb8b279) |
| XLM/mkUSDT0 | MOCK of USDT0 | [`CAYG7V…2DXW`](https://stellar.expert/explorer/testnet/contract/CAYG7VZL7YYWBGUYTCKN3UDP5Q4ZQJU3RZE6EJMLEBLRLMV5CJX42DXW) | 500 XLM / 109.84 | [`21b092d1ab…`](https://stellar.expert/explorer/testnet/liquidity-pool/21b092d1ab4495060cdaa8b9c37243ddfadc9e043d0541dd38a1113e09f37d41) |
| XLM/mkPYUSD | MOCK of PYUSD | [`CCKDHO…6FJK`](https://stellar.expert/explorer/testnet/contract/CCKDHOHB6KKJUFZAAAUU3SBRY32IBAJBTNHW4MBYIOB2HYP2XQQJ6FJK) | 500 XLM / 110.49 | [`e23e0e8b7b…`](https://stellar.expert/explorer/testnet/liquidity-pool/e23e0e8b7b9794947b29dae85d8a429582854b09e55a65b3fb0b1ace587b17a0) |
| XLM/mkIDRT | MOCK of IDRT | [`CAE63P…OFL3`](https://stellar.expert/explorer/testnet/contract/CAE63PELZCITNF2VVCPJCSDFNQR2L2XGYGZSGJ3GJUXFOGBGJFOQOFL3) | 500 XLM / 2,208,514.50 | [`4e19329bb8…`](https://stellar.expert/explorer/testnet/liquidity-pool/4e19329bb8291b395baa1c5d9656e7526df98c848b7711de83ca507dd2ad815c) |
| XLM/mkNGNT | MOCK of NGNT | [`CAXGLG…WXCF`](https://stellar.expert/explorer/testnet/contract/CAXGLGIRGJ5EUM6UCKJEZH7HFCMUPYDKOZBXPYIDP26HVZ5KGDGOWXCF) | 500 XLM / 876,769.52 | [`be648a26fb…`](https://stellar.expert/explorer/testnet/liquidity-pool/be648a26fba4b8a5b4cfc5cf4a8851a23c3edc76880adf4015e2bc5a26c7aeeb) |
| XLM/mkBRL | MOCK of BRL | [`CAS6WK…RZDR`](https://stellar.expert/explorer/testnet/contract/CAS6WKHQJAC2NAIRNX33WGT3D7D2CFUUR4ALAC2RJGP435XRGB6QRZDR) | 500 XLM / 649.68 | [`5bf0591288…`](https://stellar.expert/explorer/testnet/liquidity-pool/5bf059128837192b19b792cecd17b0c80e1dde8830419b0e96750dfe357da374) |
| XLM/mkNGNC | MOCK of NGNC | [`CB4A4U…NPTV`](https://stellar.expert/explorer/testnet/contract/CB4A4UKLYHJZPHRVK4BEAHQZMUYLNFUHEFC3OHWXSOT36BN3NGJZNPTV) | 500 XLM / 118,451.32 | [`84835e835e…`](https://stellar.expert/explorer/testnet/liquidity-pool/84835e835e95b55cac87029905b65c75ff3150df5954078c19733f84da6ce104) |
| XLM/mkCLPX | MOCK of CLPX | [`CBIQW7…BDBM`](https://stellar.expert/explorer/testnet/contract/CBIQW7U5SUYIGMDXEJ56V4QABKR3P32TWBWEDNTCO5WNPSR23UJZBDBM) | 500 XLM / 35,566.13 | [`11eddefba7…`](https://stellar.expert/explorer/testnet/liquidity-pool/11eddefba78f58e25ad84458d729396de7a65fb7258437c3a090775b3fb01cb1) |
| XLM/mkXCHF | MOCK of XCHF | [`CA7Z6A…3LNQ`](https://stellar.expert/explorer/testnet/contract/CA7Z6AK7XAYFBFFTPPDSDXUWIFZRIXTLUUJ6PJT4ETMUE5M3USI43LNQ) | 500 XLM / 113.67 | [`2fe327b3dd…`](https://stellar.expert/explorer/testnet/liquidity-pool/2fe327b3ddaf497667ba334ff70a91dd541572ccee901bf6a372ad8da5c6661b) |
| XLM/mkEURMTL | MOCK of EURMTL | [`CDPWNQ…HNYZ`](https://stellar.expert/explorer/testnet/contract/CDPWNQWHHL77RM3PO5LIGEESCUE6GPMBXNANPACY5OBCLVFEXI3VHNYZ) | 500 XLM / 94.28 | [`24d8c7b3c8…`](https://stellar.expert/explorer/testnet/liquidity-pool/24d8c7b3c879ba3bfab5f9e1920ba8f01ee8e44a829e9d3530bb8490012940fa) |
| XLM/mkUSDM | MOCK of USDM | [`CB36KJ…S3QZ`](https://stellar.expert/explorer/testnet/contract/CB36KJ7GDB4XHFM36JEFFIHDZBTWERWGKXYUMUQOJ6FM5VFIYZ7QS3QZ) | 500 XLM / 113.03 | [`17ab5d68e5…`](https://stellar.expert/explorer/testnet/liquidity-pool/17ab5d68e5835bbdf07163bc8edf2ee3ca7284cc0b7e5504770b5482b7f09e26) |
| XLM/mkGYEN | MOCK of GYEN | [`CBULII…YWJS`](https://stellar.expert/explorer/testnet/contract/CBULIIONYC5LW2CBYMNZP36IZIDE6EUU6DUGHBIHUU7ZN4MDUFFEYWJS) | 500 XLM / 15,040.07 | [`53413b1a01…`](https://stellar.expert/explorer/testnet/liquidity-pool/53413b1a01be83d3b73bb05e664b0c968e6efc8c379493d1d67653ae4879c341) |
| XLM/mkZUSD | MOCK of ZUSD | [`CA5UHW…FRZD`](https://stellar.expert/explorer/testnet/contract/CA5UHWWQXXFMZNBLVGHIQCBBEQAVHKWVWCCJP77QLHGQB5BQ43R6FRZD) | 500 XLM / 109.72 | [`9ed98e78ff…`](https://stellar.expert/explorer/testnet/liquidity-pool/9ed98e78ff21abcbf3ef024eef2ff3af87f2503fec273eca76bce02e912a606c) |
| XLM/mkAUDD | MOCK of AUDD | [`CDMBAS…JQOJ`](https://stellar.expert/explorer/testnet/contract/CDMBASDQ7TZNQ2EJYYALTZKL6DJUEMY5RAXVMA2GYCF3HU6D4WYVJQOJ) | 500 XLM / 155.53 | [`ae0a4a74e9…`](https://stellar.expert/explorer/testnet/liquidity-pool/ae0a4a74e99f123ccaf3f6ce5eb8d37cc37cfbd61187327321501b867d56088d) |

Mock issuer: `GCHXGEAEFD6H4FRP3L3VXB4E6RHHMY3Q72O76QD4IOOLJIRQPAWZW2ZO`. Full IDs: [`deployments/testnet-stablecoins.json`](deployments/testnet-stablecoins.json).


---

## How each feature works

### 1. Core DEX — SDEX order book + Soroban AMM

*On-chain.* Classic Stellar operations do the order-book trading: limit orders
are `manageBuyOffer` / `manageSellOffer`; market-style swaps use
`pathPaymentStrictSend` over paths returned by Horizon (the SDEX and Stellar's
built-in liquidity pools). Missing trustlines are added with `changeTrust` in the
same transaction. For Soroban pools, `router.swap_exact_in(user, pools[], token_in,
amount_in, min_out, deadline)` pulls input from the user into the first pool and
sends each intermediate output **straight to the next pool**, which swaps the
pre-paid surplus (`swap_prepaid`). The router never holds funds, and it enforces
slippage (`min_out`) and a deadline.

*Off-chain.* `frontend/src/lib/stellar.ts` loads order books, trade aggregations
and paths from Horizon and builds the XDR. `soroban.ts` simulates and prepares
contract calls. Freighter signs.

### 2. QFX — holder reward token with daily compounding

*On-chain* (`contracts/reward-token`):
- The token implements the SEP-41 `TokenInterface` from soroban-sdk (balance,
  transfer, approve/allowance, burn, metadata). Name "Quasaria Flux", symbol QFX, 7 decimals.
- Balances are stored as **shares**: `balance = shares × index / 1e18`.
- `index` starts at 1.0. For each full UTC day since `genesis` it is multiplied by
  `(1 + APR/365)`. The update is lazy: exponentiation-by-squaring covers all
  elapsed days in O(log n), and it runs before any transfer, mint or burn (or
  anyone can call `accrue`). All holders compound together, with no loop over holders.
- **Rate governance:** the admin sets `apr_bps`, which is hard-capped at
  `MAX_APR_BPS = 2500` (25% APR ≈ 28.4% APY). A rate change accrues at the old
  rate first. `current_apy_bps` returns the effective compounded APY.
- **Funding / emission model:** interest is **minted**, so it's inflationary
  and is never taken from other holders. It's bounded by `max_supply`: if
  compounding would push supply past the cap, the index is clamped to land
  exactly on it and rewards stop. The cap can only be lowered, never raised.
  Rounding favours the protocol (floor on credit, ceil on debit).
- Contracts that hold QFX, like AMM pools, also earn. `amm-pool.sync()`
  absorbs that growth into reserves, which benefits LPs.

*Off-chain.* The Rewards page shows the balance, a countdown to the next
compounding tick, the index, emission usage and a compounding calculator.

### 3. Liquidity providing

*On-chain* (`contracts/amm-pool`): constant-product `x·y=k` pools between any two
SEP-41 tokens (SACs for classic assets). `deposit` mints **QLP** shares:
√(a·b) on the first deposit (1,000 units are locked permanently to block
share-inflation attacks), then pro-rata at the optimal ratio with min-amount
slippage guards. `withdraw` burns shares for the pro-rata reserves. The pool
contract is itself a SEP-41 token for QLP, so QLP can be transferred or staked.
A swap fee (default 30 bps, max 100) is taken on input and stays in the reserves,
so **fees accrue to LPs** through a growing `k`. The exception is the referral
cut (below).

### 4. Staking

*On-chain* (`contracts/staking`): the admin whitelists pools
`(stake_token, reward_token, reward_rate/sec, lock_seconds)`. Rewards stream
MasterChef-style through an accumulated reward-per-share, which is O(1) per user.
**Only funded rewards are paid**: `fund` tops up a reserve, and emission pauses
when it runs out. Each stake sets `unlock_at = max(unlock_at, now + lock)`.
`unstake` reverts before that time, while `claim` always works. The admin can
change rates or deactivate a pool, and users can still exit.

### 5. Referral program

*On-chain* (`contracts/referral`): `set_referrer(user, referrer)` can be called
once per user. Self-referral is rejected, and cycles are rejected by walking the
referrer's ancestor chain (up to 32 hops). Pools and the vault are admin-approved
**fee sources**. On every swap, the pool looks up the trader's referrer and pays
them `share_bps` (default 20%) of the swap fee in the input token. The vault
credits the same share of its opening fee. The fee source then calls
`record_reward` so earnings can be tracked per referrer and token.

*Off-chain.* The Referrals page shows your shareable link
`https://…/?ref=G…`. The app captures `?ref=` into localStorage and asks the
invitee to confirm it on-chain. It also shows referral count, earnings and activity.

### 6. Bot leverage trading

*On-chain* (`contracts/leverage-vault`):
- Users `deposit` a collateral token (QUSD on testnet) and then call
  `open_position(caller, owner, asset, is_long, margin, leverage_bps)`.
  Leverage is capped by the admin config, which is itself capped at 20×.
  Notional = margin × leverage, and entry is the oracle price.
- PnL: `size × (price − entry) / entry` (negated for shorts).
  **Health factor** = equity ÷ (notional × maintenance margin). When HF < 1.0,
  **anyone** can `liquidate`. The liquidator receives a bonus (5% of margin,
  capped by the remaining equity), losses go to the reserve, and any leftover
  equity goes back to the owner.
- Counterparty: a **liquidity reserve** (`fund_liquidity`) pays profits and
  absorbs losses. Payouts are capped by the reserve, so the vault never pays
  unbacked PnL.
- **Operator delegation:** `set_operator(user, bot)` lets a bot key open and
  close positions and set triggers, but it can **never withdraw**.
- **On-chain SL/TP:** `set_triggers(id, stop_loss, take_profit)`. Any keeper can
  call `execute_trigger(id)` once a trigger price is crossed.
- **Oracle:** Reflector-compatible `lastprice`, with a staleness bound
  (`max_price_age`). `mock-oracle` implements the same interface for tests and demos.

*Off-chain* (`bot/`):
- **Strategies:** `GridStrategy` (levels across a price band, opens on level
  crossings and exits one grid step later), `DcaStrategy` (fixed margin every
  N seconds, up to a max) and `MomentumStrategy` (EMA fast/slow crossover). Each
  one takes a leverage, stop-loss % and take-profit %.
- **BotEngine:** strategy actions → `RiskManager` (leverage cap, max open
  positions, daily-loss kill switch) → venue. After a fill, it attaches the
  on-chain SL/TP triggers and also enforces SL/TP off-chain as a backup.
- **Venues:** `PaperVault` mirrors the vault math exactly and is used for paper
  trading and tests. `SorobanVault` runs live on testnet with the operator key and
  refuses to start unless the RPC passphrase is TESTNET.
- **Keeper:** `runKeeperOnce` scans `open_position_ids()`, liquidates HF < 1
  positions and executes crossed triggers. Races with other keepers are
  tolerated because the contract re-checks everything.
- **UI:** the Bots page has a prominent risk banner, a required risk
  acknowledgement, a leverage slider with estimated liquidation price, health
  gauges and config export.

---

## Tests

| Suite | Command | Count |
|---|---|---|
| Contracts (unit + cross-contract, soroban testutils) | `cd contracts && cargo test` | 34 tests across 7 crates |
| Wasm build | `cd contracts && stellar contract build` | 7 `.wasm` (wasm32v1-none) |
| Bot | `cd bot && npm run typecheck && npm test` | 20 vitest tests |
| Frontend unit | `cd frontend && npm test` | 50 vitest tests: stellarchain client, keys/signer, stablecoin filter + verification (fixtures include the impostors), landing copy |
| Frontend | `cd frontend && npm run build` | tsc + vite build |
| Screenshots | `cd frontend && npx vite preview & node ../scripts/screenshots.mjs` | landing (desktop + mobile), 7 app pages, account flow (secrets blurred); `ONLY=landing` for just the landing |

## What is real vs. simplified

**Works and is tested:** all contract logic listed above (unit tests plus
cross-contract tests covering pool ↔ referral, router ↔ pools ↔ referral and
vault ↔ oracle ↔ referral). Wasm builds for all contracts. Bot strategies, risk,
paper vault, keeper and config validation. The frontend builds, renders every
page without a wallet, and reads the live SDEX order book from Horizon testnet.

**Exercised end-to-end on testnet:**
- the full deploy + seed
- router swaps with referral payout
- staking, vault deposits and positions with SL/TP
- the keeper (`--once`, 0 actions needed)
- an in-app (browser-generated) account signing a real `set_referrer`
- the 21 XLM/stablecoin Soroban + native pools

**Not exercised end-to-end:** Freighter-signed transactions (they use the same `Signer` path as in-app keys) and the bot's live strategy mode.

**Simplifications / known limitations:**
- Without a connected wallet, panels show the demo trader / admin accounts as a read-only viewer.
- Mock testnet stablecoins (`mk*`) are worthless test tokens priced at mainnet reference rates.
- The AMM swap panel quotes from the first pool. There is no automatic best-route
  search across AMM pools and SDEX.
- Vault: single collateral token, no funding rates, no borrow interest, no
  open-interest caps, no partial closes. The reserve is the only counterparty.
  `open_position_ids` is an unbounded on-chain list (fine for a scaffold, but an
  indexer is needed at scale).
- The QFX emission cap is global. There's no exclusion list for contract holders.
- The referral cycle check is bounded to 32 hops (deeper chains are rejected conservatively).
- The mock oracle is admin-pushed. Real deployments need Reflector (or similar)
  and careful asset-key and decimals configuration.
- No governance/timelock or multisig: admin keys are single accounts.
- Not audited. There is no formal verification or fuzzing.

## Disclaimer

Quasaria is **experimental, unaudited software for Stellar TESTNET only**. It is
not an offer or solicitation of any financial product, and nothing in this
repository is financial, investment, legal or tax advice. Leveraged trading can
result in rapid, total loss. "Holder rewards" and staking yields are variable,
can be changed or stopped, and may be treated as securities or regulated
products in some jurisdictions. Operating an exchange, a derivatives venue or a
referral program may require licences (e.g. money-transmission, MiCA, CFTC/SEC
or equivalent) and KYC/AML controls. You are solely responsible for compliance
and for any use of this code.

License: Apache-2.0.
