> [!NOTE]
> **Live demo (testnet):** <https://yogibear1323.github.io/quasaria/> · **Repo:** <https://github.com/yogibear1323/quasaria>
> Stellar **testnet** only, unaudited. Do not use real funds. The site is built and deployed to
> GitHub Pages by [`.github/workflows/pages.yml`](.github/workflows/pages.yml) on every push to `main`.

<p align="center">
  <img src="docs/brand/banner.png" alt="Quasaria — trade at the speed of light on Stellar" width="100%" />
</p>

<p align="center">
  <img src="frontend/public/brand/logo.svg" alt="Quasaria logo" width="96" />
</p>

# Quasaria

**A quasar-bright decentralized exchange scaffold for the Stellar network.**
SDEX order books + Soroban AMM pools, staking orbits, the QFX token (**1 QFX = 1 XLM,
fully backed**, with holder yield paid from a pre-funded reserve),
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
| **QFX Mint & Rewards — Supernova** | **Referrals — Constellations** | **Bots & Leverage — Warp Speed** |
| ![Rewards](screenshots/04-rewards.png) | ![Referrals](screenshots/05-referrals.png) | ![Bots](screenshots/06-bots.png) |
| **Markets (stellarchain.io)** | **Create account** (secret blurred) | **Backup check** (secret blurred) |
| ![Markets](screenshots/07-markets.png) | ![Create account](screenshots/09-create-account-secret-blurred.png) | ![Backup](screenshots/10-backup-check-blurred.png) |

---

## Features at a glance

| # | Feature | On-chain (Soroban / Stellar) | Off-chain |
|---|---|---|---|
| 1 | **Core DEX** | Stellar **SDEX** (manage buy/sell offers, strict-send path payments, automatic trustlines) + `amm-pool` / `router` contracts | Horizon order books, trade aggregations, path finding; Freighter signing |
| 2 | **QFX: 1 QFX = 1 XLM, fully backed** | `reward-token`: SEP-41 wrapper around native XLM (via the XLM SAC). `deposit` mints 1:1, `redeem`/`burn` returns XLM 1:1, `reserves()` proves XLM held = supply, no admin mint. Holder yield (capped APR) is paid from a pre-funded reserve, never minted | QFX page: Mint/Redeem panel with live reserve + supply, holder-yield stats, calculator |
| 3 | **Liquidity providing** | `amm-pool`: x·y=k, SEP-41 **QLP** share token, 0.30% fee accrues to LPs | Pools page: deposit/withdraw, fee APR estimate |
| 4 | **Staking** | `staking`: admin-whitelisted pools, per-pool reward rate, funded reserves, optional lock | Stake page |
| 5 | **Referrals** | `referral`: set-once, no self-referral, no cycles; pools & vault pay referrers a share of fees | Referral dashboard, `?ref=` shareable link |
| 6 | **Bot leverage trading** | `leverage-vault`: collateral, positions with max-leverage cap, health-factor liquidation, operator delegation, on-chain SL/TP; `mock-oracle` with a Reflector-compatible interface | `bot/`: grid / DCA / momentum strategies, risk manager, paper vault, liquidation + SL/TP keeper |
| 7 | **Earn calculators** | Reads staking pools (rate, lock, reserve), QFX `yield_info`/`reserves`, pool `info` (fee) and recent `swap` events | `/earn` hub + `/calculators` (staking, holder yield, LP fees + impermanent loss); pure math in `src/lib/calc.ts` |

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
      QFX["reward-token<br/>QFX (SEP-41, 1:1 XLM-backed)"]
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
  QFX -- deposit / redeem XLM --> SAC
  STAKE -. QFX rewards from funded reserve .-> QFX
  VAULT -- lastprice --> ORACLE
  VAULT -. set_oracle .-> REFLECTOR
  ENGINE --> RISK --> VAULT
  KEEPER --> VAULT
```

### Repository layout

```
contracts/            Cargo workspace (soroban-sdk 28), one crate per contract
  reward-token/       QFX: 1:1 XLM-backed SEP-41 wrapper + reserve-funded holder yield
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
config/               stablecoins.json: allowlist / denylist / thresholds; assets.mainnet.json: curated asset list (verified mainnet issuers)
deployments/          testnet.json, testnet-assets.json (v3 asset pools), testnet-stablecoins.json (retired v2 pools)
scripts/              build.sh, deploy-testnet.sh, seed-testnet.sh,
                      gen-stablecoin-pairs.ts, seed-stablecoin-pools.{sh,ts} (retired),
                      verify-mainnet-assets.ts, deploy-asset-pools-v3.ts, smoke-asset-pools.ts,
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

### GitHub Pages build

The live demo is served from a subpath (`/quasaria/`). The Vite `base` comes from
`VITE_BASE` (default `/`, so local builds are unchanged) and the router uses
`import.meta.env.BASE_URL` as its basename:

```bash
cd frontend && VITE_BASE=/quasaria/ npm run build   # what the Pages workflow runs
```

GitHub Pages has no SPA rewrites, so the build also writes `<route>.html` copies of
`index.html` (deep links such as `/quasaria/markets` return 200) plus a `404.html`
fallback. `public/_redirects` stays for Netlify.

**Market-data snapshot for GitHub Pages:** the stellarchain.io API only sends CORS
headers for allow-listed origins, and `yogibear1323.github.io` is not on that list. So
the Pages workflow runs `node scripts/fetch-market-snapshot.mjs` (in `frontend/`) right
before `vite build`. It fetches what the Markets page, the landing market cards and the
XLM/USD ticker need (the mainnet overview plus the top 50 assets on testnet and on
mainnet, trimmed to the fields the app reads) and writes
`frontend/public/data/stellarchain-snapshot.json`, which Vite copies into the build.
Every deploy therefore ships fresh data. In the browser the client tries the live API
first and falls back to the snapshot (or to a newer expired browser cache, if one
exists), labelled **"snapshot, updated &lt;time&gt;"**. If the fetch fails during the
build, the script keeps the last committed snapshot section by section and exits 0
(the step is also `continue-on-error`), so the deploy never breaks over market data.
Refresh the committed copy locally with `cd frontend && npm run snapshot`.
Horizon/Soroban testnet data (order books, pools, contracts) is read live as before.

### Run the bot

```bash
cd bot
npm run paper                        # simulated vault + deterministic random walk
npm start -- --config quasaria-bot.config.example.json --mode paper --ticks 1000
cp .env.example .env                 # then fill in testnet IDs + operator key
npm run keeper                       # live liquidation / SL-TP keeper (testnet)
npm run oracle-feed -- --identity quasaria-admin --interval 300      # mock SEP-40 oracle ← live mainnet prices (testnet tx only)
npm run lending-keeper -- --identity <liquidator> --interval 60     # lending liquidations (add --dry-run to simulate)
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
| `referral` | Referral registry | [`CCLJVQ3MOWHELK4NGKDAQSKOLPXIECADTGIVQVSSSKLRJ7JOSXOZ2WCB`](https://stellar.expert/explorer/testnet/contract/CCLJVQ3MOWHELK4NGKDAQSKOLPXIECADTGIVQVSSSKLRJ7JOSXOZ2WCB) |
| `qfx` | QFX: 1 QFX = 1 XLM, fully backed | [`CDL5JSVI4O4HGUCITMOBBKAMHNAUY6OE4K54A5DJY2PTXSHFJG5XKJ4D`](https://stellar.expert/explorer/testnet/contract/CDL5JSVI4O4HGUCITMOBBKAMHNAUY6OE4K54A5DJY2PTXSHFJG5XKJ4D) |
| `poolXlmQusd` | AMM pool XLM/QUSD | [`CBBUQW2VGV5ZH2NPLSVZF5BQM7PPKAWTKDZVK2AVO4DV4KYIS7FSXHB5`](https://stellar.expert/explorer/testnet/contract/CBBUQW2VGV5ZH2NPLSVZF5BQM7PPKAWTKDZVK2AVO4DV4KYIS7FSXHB5) |
| `poolQfxQusd` | AMM pool QFX/QUSD | [`CBPJ5AXOBTN37PALD62OVPHIJ3BLCFX6XLSCMS3ICX6F6GUVNNM4WFLK`](https://stellar.expert/explorer/testnet/contract/CBPJ5AXOBTN37PALD62OVPHIJ3BLCFX6XLSCMS3ICX6F6GUVNNM4WFLK) |
| `router` | Router | [`CDSGPKLVVSCZDXPI2NNZRYY23UCQS3TXQWBCFIKINFIBJDCD57TQRWFB`](https://stellar.expert/explorer/testnet/contract/CDSGPKLVVSCZDXPI2NNZRYY23UCQS3TXQWBCFIKINFIBJDCD57TQRWFB) |
| `staking` | Staking | [`CBB6WT3KRJDNKKJPDKLPEPVCZC63DYPVBRXCR72HPTL6PQL54P7VB63K`](https://stellar.expert/explorer/testnet/contract/CBB6WT3KRJDNKKJPDKLPEPVCZC63DYPVBRXCR72HPTL6PQL54P7VB63K) |
| `oracle` | Mock oracle | [`CBHMDDCD5NDZKQIGP4VKBTQOQ4OQMK75CYAGHBXY2JT7WGBB774NO2DY`](https://stellar.expert/explorer/testnet/contract/CBHMDDCD5NDZKQIGP4VKBTQOQ4OQMK75CYAGHBXY2JT7WGBB774NO2DY) |
| `vault` | Leverage vault | [`CAKUVSFDQXQGGBO2ZYQEQH6HMRMMDV6DDF4HMGRKK4Y3O2TGFWDAM55V`](https://stellar.expert/explorer/testnet/contract/CAKUVSFDQXQGGBO2ZYQEQH6HMRMMDV6DDF4HMGRKK4Y3O2TGFWDAM55V) |

- Admin / LP: [`GDAEZGA66NUQZKMHFMIUI42S6FKGFERY3UHANE43ZM3RGL3FB3VBNKCY`](https://stellar.expert/explorer/testnet/account/GDAEZGA66NUQZKMHFMIUI42S6FKGFERY3UHANE43ZM3RGL3FB3VBNKCY)
- Demo trader: [`GBSMEW3XCI3YNPD4U5VYEHLALFWKOX634XZIHQXAXAWLBXTG36OLOP56`](https://stellar.expert/explorer/testnet/account/GBSMEW3XCI3YNPD4U5VYEHLALFWKOX634XZIHQXAXAWLBXTG36OLOP56)
- Keys live only in the local Stellar CLI keystore (`~/.config/stellar/identity`). They are never in the repo.

**Hardened redeploy, generation v3 (2026-09-28).** All contracts except the SACs were
redeployed with the fixes from the internal review (`docs/mainnet-readiness-checklist.md`
§0.7: F-01…F-05, F-07, F-08, F-13, F-18, F-21). Status: **fixed on testnet, still
unaudited.** They were re-seeded exactly like the previous deploy (`seed-testnet.sh`) and
checked with `scripts/smoke-testnet.sh`. The previous generation is listed under
`legacy.v2` in `deployments/testnet.json`. The 21 XLM/stablecoin pools ran the older pool
wasm and were **retired on 2026-09-29**, replaced by 52 v3 asset pools (see
[Curated asset list & v3 asset pools](#curated-asset-list--v3-asset-pools-stablecoins--popular-assets)).
- **Governance on every contract with an admin** (shared crate `contracts/gov`):
  - two-step admin (`propose_admin`, then `accept_admin` signed by the nominee), so the admin can move to a multisig;
  - guardian `pause(caller)` / admin `unpause()`. Pausing blocks new risk (deposits, swaps, stakes, opens) but **never exits**: redeem, withdraw, unstake, claim and close keep working;
  - a timelock for dangerous admin actions: `propose_action(action)`, wait `timelock_delay()` (300 s on testnet; the contracts refuse < 48 h on mainnet), then `execute_action(action)` within 14 days. `cancel_action` is open to the admin or guardian;
  - timelocked WASM upgrades (`{"Upgrade":"<wasm hash>"}`).
- Timelocked actions: vault `SetConfig` / `SetOracle` / `WithdrawLiquidity`; pool `SetFeeBps` / `SetReferral`; QFX `SetAprBps` / `SetMaxEligible`; referral `SetShareBps`; plus `Upgrade` / `SetDelay` everywhere.
- Limits: vault min margin 10 QUSD, ≤ 10 open positions per wallet, ≤ 1,000 open overall, oracle prices ≤ 15 min old and never more than 60 s in the future; staking min stake 1 token; QFX yield accrues per second (time-weighted) on up to 1,000,000 eligible QFX (above that it is shared pro rata); referral payouts are capped at 50% of a fee.

**QFX peg migration (2026-09-26, `scripts/migrate-qfx-peg-testnet.sh`).** `qfx`,
`staking` and `poolQfxQusd` were redeployed because the staking pools and the QFX/QUSD
pool reference the token address. Everything QFX-related is funded with testnet XLM:
- **Holder-yield reserve:** 2,500 XLM → `fund_yield` (2,500 QFX in the reserve; 12% APR on
  non-exempt holders, about 0.1 QFX/day at today's eligible supply).
- **Staking reserves:** 3,000 XLM deposited → 3,000 QFX, 1,500 QFX funded into each staking
  pool (QFX→QFX, 7-day lock, 0.0001 QFX/s; QLP(XLM/QUSD)→QFX, flexible, 0.0002 QFX/s).
- **QFX/QUSD pool re-seeded** at the XLM/QUSD pool price (QFX = XLM): 2,500 QFX (from 2,500
  deposited XLM) + 277.41 QUSD.
- The admin staked 100 QLP (XLM/QUSD) in the new pool 1. The demo trader deposited 500 XLM →
  500 QFX and staked 200 QFX in pool 0.
- The staking contract and the QFX/QUSD pool are `yield_exempt` (their internal accounting
  can't absorb holder yield).
- Proof of reserves right after the migration: `xlm_reserve = total_supply = 8,500 QFX`,
  `fully_backed: true`, `surplus: 0`.
- **Legacy (unbacked) contracts, retired:** old QFX
  [`CDUMMYBM…774HZ`](https://stellar.expert/explorer/testnet/contract/CDUMMYBMXILXLPFI5ZI534W6NGUILN2WSMXWKX2HAMT5BWCHN2E774HZ)
  (had an admin `mint` and minted its holder interest) now has APR 0; old staking
  `CCT3POPX…AYZB` has both pools deactivated (users can still exit); old QFX/QUSD pool
  `CABGFGIJ…F36Q` is no longer a referral fee source. They are listed under `legacy` in
  `deployments/testnet.json`. Nothing in the app uses them.

**What the original seed created** (non-QFX parts, still live):
- XLM/QUSD pool: 5,000 XLM + 600 QUSD.
- 200k QUSD of vault liquidity, and oracle price XLM = 0.1234 QUSD.
- The demo trader:
  - set the admin as referrer
  - swapped 200 XLM → 23.01 QUSD through the router, which paid a 0.12 XLM referral fee on-chain
  - deposited 1,000 QUSD into the vault
  - opened a 5× long (#1) and a 3× short (#2) with SL/TP

**Live vs demo in the UI:**
- **Live from Soroban testnet** (tagged "● live"):
  - Pools: reserves, LP share, 24h volume from swap events.
  - Stake: pools, stake and pending rewards.
  - QFX: `reserves()` (XLM reserve vs supply), `yield_info()`, balances; Mint/Redeem signs `deposit` / `redeem`.
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
./scripts/seed-testnet.sh               # QUSD to demo accounts; XLM -> QFX deposits; liquidity; reserves
cd frontend && npm run dev              # uses frontend/src/config/testnet.json written by deploy
```

What `deploy-testnet.sh` does:

1. Adds the `testnet` network, creates + friendbot-funds identity `quasaria-admin`.
2. Resolves the native XLM SAC and deploys a SAC for demo stablecoin `QUSD:<admin>`.
3. Deploys `referral` (20% fee share), `reward-token` (QFX backed 1:1 by the native
   XLM SAC, 12% holder APR paid from a reserve; no max-supply knob and no admin mint),
   two `amm-pool`s (XLM/QUSD, QFX/QUSD, 0.30% fee), `router`, `staking`,
   `mock-oracle` (14 decimals) and `leverage-vault` (10× max, 5% maintenance,
   5% liquidation bonus, 0.10% open fee, 15-min max price age) using constructor
   arguments.
4. Wires permissions: pools + vault as referral fee sources, XLM market enabled,
   initial oracle price, two staking pools (QFX 7-day lock; XLM/QUSD QLP flexible),
   staking + QFX/QUSD pool marked `yield_exempt` on QFX.
5. Writes `deployments/testnet.json` (copied to `frontend/src/config/testnet.json`) and `bot/.env`.

`seed-testnet.sh` then funds the QFX holder-yield reserve with 2,500 XLM (`fund_yield`),
deposits 5,500 XLM for 5,500 QFX (staking reserves + QFX/QUSD liquidity at the XLM price),
and has the demo trader wrap 500 of its own XLM. **Upgrading an older deployment** that
still has the unbacked QFX: `./scripts/migrate-qfx-peg-testnet.sh` (`DRY_RUN=1` to preview).

**Using Reflector instead of the mock oracle:** the vault only needs
`lastprice(Asset) -> Option<PriceData>` and `decimals()`, with the same XDR
shapes as Reflector (`Asset::Stellar(Address) | Asset::Other(Symbol)`,
`PriceData { price: i128, timestamp: u64 }`). Look up the current Reflector
testnet contract for the feed you want at reflector.network, then
`stellar contract invoke --id <vault> ... -- propose_action --action '{"SetOracle":"<reflector_id>"}'`,
wait out the timelock, then run the same with `execute_action`,
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
  - the XLM/USD ticker and markets preview (stellarchain.io live, or the build-time snapshot labelled "snapshot, updated <time>", with "as of" and stale flags)
  - the live SDEX XLM/USDC book (Horizon testnet)
  - the XLM/QUSD swap quote and pool list (Soroban reserves)
  - the latest ledger number and close gap
  - live staking pools, QFX proof of reserves (`reserves()`: XLM held vs supply) and `yield_info`, and the demo referrer's on-chain earnings
  - the stablecoin logo grid and world map, built from `docs/stablecoin-pairs.json`. The badge says **Verified by issuer** when the issuer's stellar.toml confirmed the coin, and **Allowlisted issuer** for Circle's USDC and EURC, whose toml returns 404.
  - contract links to stellar.expert from the deployed IDs
- **Labelled as example, estimate or simulation:**
  - the LP fee estimator (an estimate that depends on the user's volume assumption)
  - the staking lock slider (made-up example rates)
  - the QFX yield chart (example numbers at the current APR, assuming the reserve lasts)
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
- **Caching + snapshot.** Responses are cached for 5 minutes in memory and in localStorage.
  If the live API fails (e.g. the CORS block on github.io), the client serves the newer of
  the last good (expired) cache and the build-time snapshot
  (`public/data/stellarchain-snapshot.json`, see *GitHub Pages build*), and the UI says
  "snapshot, updated &lt;time&gt;" (or "cached, updated &lt;time&gt;"). Requests time out.
- **Staleness.** Every row shows its "as of" time and a stale flag.
  - When this was built, the mainnet asset snapshots were dated **2026-09-11**, about 2 weeks old. The overview XLM price was fresh.
  - Testnet feed prices are null, so testnet prices are filled in from the Horizon testnet order book against XLM.
  - The XLM/USD ticker falls back to the Horizon testnet XLM/USDC mid when the feed is more than 2 h old.
- **Mainnet is reference only.** The Mainnet tab is read-only. Its Trade buttons open testnet pairs only.

### Markets page: live Stellar mainnet feed (Horizon)

The Markets page's default **Mainnet · live data** tab reads Stellar **mainnet** straight
from public Horizon (`https://horizon.stellar.org`, which sends CORS headers for github.io),
read-only, in the browser: `frontend/src/lib/liveMarkets.ts`. It covers the same 25 assets as
the snapshot's mainnet top 25, in the same order.

- **Every ~30 s** while the tab is visible (paused when hidden): one network-wide `/trades`
  poll (cursor-paged) gives the latest trade price of each asset vs XLM, and XLM/USD from
  the Circle USDC (`GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN`) / XLM trades.
- **`/trade_aggregations`** (hourly candles over 7 days, asset vs XLM) gives the 1h / 24h / 7d
  change, 24h volume and trades, and the 24h sparkline. Horizon caps this endpoint at
  100 requests per 5 min per IP, and its 429s carry no CORS headers, so candles are
  refreshed per asset every 10 min, staggered, cached in localStorage, and paused on failure.
  **`/assets`** gives holders and supply (every 30 min). **`/order_book`** gives a mid price for
  assets with no trade in 24h.
- The page shows **Live · Stellar mainnet** and **Updated HH:MM:SS**. When Horizon fails or
  times out (8 s), the whole table falls back to the saved snapshot, labelled
  **Snapshot from &lt;time&gt;**, with a *Live feed unavailable, showing saved copy* note. It
  retries in the background (30 s, 60 s, then every 120 s) and switches back to live data
  by itself. A single asset with no live data falls back to its snapshot row, marked
  *snapshot*. Trading on Quasaria stays testnet-only. The testnet tab and the snapshot
  script are unchanged.

## Non-custodial by design

Create or import a Stellar account in the browser. Click **Create account** in the header.

- Keys are generated locally with `Keypair.random()` (Web Crypto). They are **never sent to any server**.
- The secret is shown once, with copy/download options and warnings. A backup check (re-type characters of the secret) is required before you continue.
- **Remember on this device** is optional. It encrypts the secret with a password: PBKDF2-SHA256 (600k iterations) → AES-256-GCM, with the public key as additional data. The result is stored in localStorage (`quasaria.keystore.v1`), and **Forget this device** wipes it.
- On testnet the account is funded by Friendbot. On mainnet a new account needs a minimum XLM balance (base reserve) from somewhere else.
- In-app keys and Freighter share one `Signer` interface (`src/lib/signer.ts`), so every transaction path works with either.
- Losing the secret (and password) means losing the account. Nobody can recover it.

## XLM/stablecoin pairs (auto-discovered; pools retired — see the curated asset list below)

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

## Curated asset list & v3 asset pools (stablecoins + popular assets)

The liquidity program lets users pick **either side of a pool from the full list**: every notable
Stellar stablecoin plus popular assets such as SHX (Stronghold), AQUA, yXLM, BTC/ETH anchor
tokens and VELO, so they can build a self-banking setup. **Testnet only.**

1. **Mainnet reference list, verified read-only.** `node scripts/verify-mainnet-assets.ts` loads each
   candidate issuer from public mainnet Horizon (home_domain, holders, supply, live price vs XLM) and
   checks that the home domain's `stellar.toml` `CURRENCIES` lists exactly that code + issuer. Where no
   toml is reachable the issuer's official docs are fetched and grepped instead (Circle's USDC/EURC
   contract-address pages, SG-FORGE's EURCV MiCA white paper, Blend's deployment docs). Output:
   [`config/assets.mainnet.json`](config/assets.mainnet.json) — codes, issuers, domains, proof URL,
   price and an off-peg flag for future mainnet use. Candidates that failed (VEUR, MXNe not listed in
   their toml; BRLT, BRZ, MXN, NGN, KES toml unreachable) are recorded with `verified: false` and not used.
   Note: the most-held "EURCV" on Stellar (`GAUQKYP3…`) is **not** SG-FORGE's; the real issuer is `GCEYGIVO…XW3G`.
2. **Testnet assets.** Most real assets don't exist on testnet. Circle's testnet USDC (`GBBD47…FLA5`,
   published by Circle) is used as the **real** testnet asset. Everything else is a clearly labelled
   **testnet mirror**: code `mk<CODE>` issued by `quasaria-mock-stables` (home_domain
   `mock-stables.quasaria.invalid`) or `quasaria-mock-assets` (`mock-assets.quasaria.invalid`), with a
   Stellar Asset Contract. Circle's testnet EURC exists but can't be obtained (faucet is a manual web
   form, no testnet SDEX asks), so EURC is a mirror too. The UI badges each asset **REAL testnet** or
   **testnet mirror of &lt;asset&gt;** and links to the real mainnet asset on stellar.expert.
3. **v3 pools.** `node scripts/deploy-asset-pools-v3.ts` deploys one hardened v3 `amm-pool` (same wasm
   hash as the core v3 pools: pause, 300 s timelock, two-step admin; referral fee source) per pair and
   seeds modest friendbot-funded liquidity at the live mainnet price ratio: **52 pools** — every
   stablecoin vs XLM (25), EURC/USDC, SHX/XLM, AQUA/XLM, yXLM/XLM, 13 more popular assets vs XLM,
   7 on-peg USD stables vs USDC, EURCV/EURC, yUSDC/USDC and QUSD/USDC. The v3 router is stateless (no
   on-chain registry): "registered" means listed in
   [`deployments/testnet-assets.json`](deployments/testnet-assets.json) (copied to the frontend), which
   the Pools and Trade pages route over; every pool passed a `router.get_amounts_out` check.
4. **Retired.** The 21 v2-era XLM/stablecoin pools (pre-hardening wasm) are removed from the UI and
   routing; their IDs stay in `deployments/testnet-stablecoins.json` (`status: retired`) and
   `legacy.v2StablecoinPools` in `deployments/testnet.json`. Their LPs can still withdraw.
5. **Smoke test.** `node scripts/smoke-asset-pools.ts` — a fresh friendbot account adds liquidity,
   swaps through the router and removes liquidity (all with real minimums) in USDC/XLM, EURC/USDC and
   SHX/XLM, plus a 2-hop EURC→USDC→XLM route and a rejected impossible `min_out`.

UI: the Pools page has an asset picker for each side (search, logos, **Stablecoins** / **Popular
assets** categories, real/mirror badge), supplies liquidity to any existing pool with real
slippage minimums (F-10), and warns that stable-vs-volatile pairs carry more impermanent loss. The
LP calculator lists all asset pools; the Trade page pickers include the assets and swap through the
router (direct or via XLM/USDC).

| Asset | Category | Mainnet issuer | Home domain | Verification | Testnet |
| --- | --- | --- | --- | --- | --- |
| USDC | Stablecoin (USD) | `GA5ZSE…KZVN` | circle.com | issuer-doc-verified | **real** testnet |
| EURC | Stablecoin (EUR) | `GDHU6W…NPP2` | circle.com | issuer-doc-verified | mirror `mkEURC` |
| PYUSD | Stablecoin (USD) | `GDQE7I…U2V5` | token-metadata.paxos.com | toml-verified | mirror `mkPYUSD` |
| USDGLO | Stablecoin (USD) | `GBBS25…S6XV` | app.glodollar.org | toml-verified | mirror `mkUSDGLO` |
| EURCV | Stablecoin (EUR) | `GCEYGI…XW3G` | — | issuer-doc-verified | mirror `mkEURCV` |
| USDT0 | Stablecoin (USD) | `GATISX…HN6Q` | — | toml-verified(domain) | mirror `mkUSDT0` |
| GYEN | Stablecoin (JPY) | `GDF6VO…5TOB` | stablecoin.z.com | toml-verified | mirror `mkGYEN` |
| ZUSD | Stablecoin (USD) | `GDF6VO…5TOB` | stablecoin.z.com | toml-verified | mirror `mkZUSD` |
| AUDD | Stablecoin (AUD) | `GDC7X2…2EEU` | audd.digital | toml-verified | mirror `mkAUDD` |
| VCHF | Stablecoin (CHF) | `GDXLSL…XIZN` | vnx.io | toml-verified | mirror `mkVCHF` |
| USDx | Stablecoin (USD) | `GAVH5Z…KDMN` | assets.fxdao.io | toml-verified | mirror `mkUSDx` |
| USD | Stablecoin (USD) | `GDUKMG…YLEX` | stablecoin.anchorusd.com | toml-verified | mirror `mkUSD` |
| ARST | Stablecoin (ARS) | `GCSAZV…I3DG` | pubnet-sep.latamex.com | toml-verified | mirror `mkARST` |
| ARS | Stablecoin (ARS) | `GCYE7C…DARS` | api.anclap.com | toml-verified | mirror `mkARS` |
| BRL | Stablecoin (BRL) | `GDVKY2…VVSP` | ntokens.com | toml-verified | mirror `mkBRL` |
| NGNC | Stablecoin (NGN) | `GASBV6…XZY6` | ngnc.online | toml-verified | mirror `mkNGNC` |
| NGNT | Stablecoin (NGN) | `GAWODA…CCPD` | cowrie.exchange | toml-verified | mirror `mkNGNT` |
| PEN | Stablecoin (PEN) | `GA4TDP…BPEN` | api.anclap.com | toml-verified | mirror `mkPEN` |
| CLPX | Stablecoin (CLP) | `GDYSPB…UX5G` | clpx.finance | toml-verified | mirror `mkCLPX` |
| USDZ | Stablecoin (USD) | `GAKTLP…6XPR` | zeam.money | toml-verified | mirror `mkUSDZ` |
| ZARZ | Stablecoin (ZAR) | `GAROH4…BB3U` | zeam.money | toml-verified | mirror `mkZARZ` |
| IDRT | Stablecoin (IDR) | `GDPKQ2…VBVT` | kbtrading.org | toml-verified | mirror `mkIDRT` |
| XCHF | Stablecoin (CHF) | `GDPKQ2…VBVT` | kbtrading.org | toml-verified | mirror `mkXCHF` |
| EURMTL | Stablecoin (EUR) | `GACKTN…UK7V` | mtl.montelibero.org | toml-verified | mirror `mkEURMTL` |
| USDM | Stablecoin (USD) | `GDHDC4…USDM` | mtl.montelibero.org | toml-verified | mirror `mkUSDM` |
| SHX | Popular | `GDSTRS…J6JH` | stronghold.co | toml-verified | mirror `mkSHX` |
| AQUA | Popular | `GBNZIL…AQUA` | aqua.network | toml-verified | mirror `mkAQUA` |
| yXLM | Popular | `GARDNV…5T55` | ultracapital.xyz | toml-verified | mirror `mkyXLM` |
| yUSDC | Popular | `GDGTVW…TTFF` | ultracapital.xyz | toml-verified | mirror `mkyUSDC` |
| yBTC | Popular | `GBUVRN…L6NW` | ultracapital.xyz | toml-verified | mirror `mkyBTC` |
| BTC | Popular | `GDPJAL…2MZM` | ultracapital.xyz | toml-verified | mirror `mkBTC` |
| ETH | Popular | `GBFXOH…SOCC` | ultracapital.xyz | toml-verified | mirror `mkETH` |
| VELO | Popular | `GDM4RQ…2M5M` | — | toml-verified(domain) | mirror `mkVELO` |
| BLND | Popular | `GDJEHT…EZYY` | — | issuer-doc-verified | mirror `mkBLND` |
| XRP | Popular | `GBXRPL…DTD5` | fchain.io | toml-verified | mirror `mkXRP` |
| SCOP | Popular | `GC6OYQ…H3VQ` | scopuly.com | toml-verified | mirror `mkSCOP` |
| AFR | Popular | `GBX6YI…N54W` | afreum.com | toml-verified | mirror `mkAFR` |
| TFT | Popular | `GBOVQK…AC47` | threefold.io | toml-verified | mirror `mkTFT` |
| GOLD | Popular | `GBC5ZG…GOLD` | mintx.co | toml-verified | mirror `mkGOLD` |
| SLVR | Popular | `GBZVEL…SLVR` | mintx.co | toml-verified | mirror `mkSLVR` |
| LSP | Popular | `GAB7ST…24WK` | lumenswap.io | toml-verified | mirror `mkLSP` |

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

### 2. QFX — 1 QFX = 1 XLM, fully backed, with reserve-funded holder yield

*On-chain* (`contracts/reward-token`):
- SEP-41 `TokenInterface` (balance, transfer, approve/allowance, burn, metadata). Name
  "Quasaria Flux", symbol QFX. **Decimals are read from the XLM SAC at construction and
  must be 7**, so 1 stroop of QFX = 1 stroop of XLM.
- **Peg.** The constructor takes the native XLM Stellar Asset Contract.
  - `deposit(from, amount)` pulls `amount` XLM from `from` through the SAC and mints the
    same amount of QFX.
  - `redeem(from, amount)` burns QFX and sends the same amount of XLM back. It fails with
    `InsufficientBalance` if `from` holds less. SEP-41 `burn` / `burn_from` behave like
    `redeem` (XLM goes to the owner), so burning can't strand collateral.
  - **There is no admin mint.** The admin can only set the holder APR (capped) and the eligible
    cap (both timelocked), mark contracts `yield_exempt`, pause deposits, and hand over admin
    in two steps; none of these change supply.
  - `reserves()` returns `xlm_reserve` (the contract's live SAC balance), `total_supply`,
    `surplus`, `fully_backed`, `reward_reserve` and `circulating`. `deposit`, `redeem` and
    `fund_yield` also assert `xlm_reserve ≥ total_supply` on-chain. XLM sent straight to the
    contract (a donation) shows up as `surplus`; the permissionless `sweep_surplus()` mints
    exactly that amount into the yield reserve.
- **Holder yield, paid from a pre-funded reserve (never minted).**
  - `fund_yield(from, amount)` pulls XLM and mints the same amount of QFX *into the
    reserve*, just like a deposit. `fund_yield_qfx(from, amount)` moves existing QFX
    (e.g. protocol fees) into it.
  - Yield accrues **per second, time-weighted**: `min(eligible × APR × seconds / 365 d, reserve)`
    moves from the reserve to holders through a MasterChef-style accumulator (O(1) per holder),
    updated on every balance change, so a deposit earns only for the time it is held. Only
    `max_eligible` QFX (1,000,000 on testnet) earns the full APR; above it the capped emission
    is shared pro rata, which bounds the reserve commitment.
    Paying yield moves existing QFX, so **total supply and backing are unchanged**. When
    the reserve is empty, yield stops.
  - `balance()` includes accrued yield right away. It is credited to the stored balance
    (and starts compounding) whenever the holder's balance moves or anyone calls
    `settle(holder)`. `yield_info()` shows the APR, reserve, eligible supply and daily
    payout.
  - Contracts that can't account for yield are `yield_exempt` (the staking contract and
    the QFX/QUSD pool on testnet). This replaces the old "pools earn and `sync()`" rule,
    which also let a router `swap_prepaid` caller take the pool's accrued yield.
  - The APR is capped at `MAX_APR_BPS = 2500`. Rounding favours the reserve, so a few
    stroops of dust stay in it.

*Off-chain.* The QFX page (`/rewards`) has the **Mint / Redeem** panel (XLM in, QFX out
and back, labelled "1 QFX = 1 XLM, fully backed", live XLM reserve and QFX supply from
`reserves()`), holder-yield stats (balance, accrued, per-second rate, eligible cap and effective APR, reserve runway) and
a yield calculator.

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
when it runs out. Staking never mints: the QFX reward reserves on testnet were created
by depositing testnet XLM into QFX (1:1) and funding the pools, and anyone (e.g. a fee
collector) can top them up the same way. Each stake sets `unlock_at = max(unlock_at, now + lock)`.
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
- **Keeper:** `runKeeperOnce` pages through `open_position_ids_page()` (count from `open_position_count()`), liquidates HF < 1
  positions and executes crossed triggers. Races with other keepers are
  tolerated because the contract re-checks everything.
- **UI:** the Bots page has a prominent risk banner, a required risk
  acknowledgement, a leverage slider with estimated liquidation price, health
  gauges and config export.

### 7. Earn calculators

`/earn` (in the nav) links the three ways to earn, each with its live panel and a
calculator; `/calculators` shows all three (`?c=staking|holder|lp` focuses one,
`?pool=` preselects a pool). The Stake, QFX and Pools panels link straight to the
matching calculator, and the QFX page embeds the holder-yield one.

* **Staking**: pool/lock picker, amount, duration. Rate, lock, total staked and
  remaining reward reserve come from `staking.pool(i)`. Rewards = rate × your share ×
  time, capped where the reserve runs dry, with warnings when the reserve depletes
  within the horizon or your payout alone exceeds it. The chart shows capped vs
  uncapped rewards, the unlock day and the depletion day.
* **Holder yield**: QFX amount, duration, simple (default, matches the contract)
  vs settled-weekly / settled-daily compounding, a what-if APR slider (≤ the 25% cap).
  Shows the unallocated reserve and its runway at the current earning supply, with
  your amount added, and if all circulating QFX earned; the estimate stops at your
  share of the reserve.
* **Liquidity**: any live pool (core + XLM/stablecoin), deposit, duration, daily
  volume (defaults to the on-chain 7-day average from `swap` events; 24h or custom),
  the referred-volume share (observed from `referral_fee`), fee rate from `info()`.
  Shows fee earnings, pool share, fee APR, and an impermanent-loss simulator
  (−90% … +400%) with IL vs holding, fees-adjusted result and break-even days.

Values are shown in tokens and ≈ USD (the existing XLM/USD ticker price; QFX = 1 XLM,
other tokens valued through pool spot prices). All math is in pure functions
(`frontend/src/lib/calc.ts`, tested in `frontend/test/calc.test.ts`). Estimates only.

---

### 8. Lending market (testnet only, unaudited)

`/lending`: supply 42 testnet assets (XLM, Circle testnet USDC and Quasaria mirrors) to earn a variable rate, or borrow against collateral. Liquidation uses a 50% close factor with a 5–8% per-asset bonus. Prices come from the SEP-40 mock oracle fed with live mainnet prices. The page also has a Txrep-style (SEP-11) signing preview and an optional SEP-10/SEP-24 deposit panel for the SDF test anchor. Design, parameters and the **Standards used** section are in [`docs/lending.md`](docs/lending.md). Contract: `contracts/lending`. Deploy and smoke scripts: `scripts/deploy-lending.ts` and `scripts/smoke-lending.ts`.

## Tests

| Suite | Command | Count |
|---|---|---|
| Contracts (unit + cross-contract, soroban testutils) | `cd contracts && cargo test` | 119 tests across 9 crates (Sep 30: +33 lending, +6 mock-oracle SEP-40); previously 85 tests across 8 crates, including regression tests for F-02/F-03/F-04/F-05/F-07/F-08/F-13 plus pause, timelock, two-step admin and hostile-registry tests (Sep 28); originally 41 tests, incl. 14 QFX peg tests (reserve == supply after deposits, redeems, yield and mixed activity; over-redeem fails; no `mint` entry point; yield stops when the reserve is empty) and a staking ↔ QFX test (rewards from an XLM-funded reserve, peg holds) |
| Wasm build | `cd contracts && stellar contract build` | 7 `.wasm` (wasm32v1-none) |
| Bot | `cd bot && npm run typecheck && npm test` | 32 vitest tests (incl. 12 lending keeper / price-feed tests) |
| Frontend unit | `cd frontend && npm test` | 155 vitest tests (Sep 30: incl. 16 lending, Txrep, SEP-1/10/38 anchor tests): calculator math (staking stream + reserve cap, simple vs daily/weekly compounding, reserve runway, LP fees, impermanent loss, swap-event summaries, pool-price valuation) plus stellarchain client + build-time snapshot fallback (live first, snapshot, newer-of cache/snapshot, search/paging) and the snapshot script (trimming; keeps the old file and exits 0 when the API is down), exact Mint/Redeem amount parsing, keys/signer, stablecoin filter + verification, landing copy |
| Frontend | `cd frontend && npm run build` | tsc + vite build |
| Screenshots | `cd frontend && npx vite preview & node ../scripts/screenshots.mjs` | landing (desktop + mobile), 7 app pages, account flow (secrets blurred); `ONLY=landing` for just the landing |
| Live site check | `ROUNDTRIP=1 node scripts/verify-live.mjs` | headless Chromium on the Pages site: Markets rows, Mint/Redeem reserve + supply, optional real testnet mint → redeem with a throwaway friendbot key; writes `screenshots/live-markets.png`, `screenshots/live-mint-redeem.png` |
| Calculators check | `node scripts/verify-calculators.mjs` | headless Chromium: each calculator loads live rates and produces numbers, IL at +200%/−50% matches the formula, panel links, no mobile overflow; writes `screenshots/calc-*.png` + `calc-verify.json` |

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
- a real QFX mint → redeem round trip through the live Pages UI (throwaway friendbot key; see `scripts/verify-live.mjs`):
  25 XLM → 25 QFX ([`d2ef64d2…1abf`](https://stellar.expert/explorer/testnet/tx/d2ef64d2240a7db0de7f10d6dc32ff3d9577f8284c5ce08dca83609605291abf)),
  25 QFX → 25 XLM ([`b4ab35d7…f253`](https://stellar.expert/explorer/testnet/tx/b4ab35d7c3ad53d005e429a07a28295a72c5736e68ad691cf4eefd45f560f253)).
  `reserves()` read 8,500 = 8,500 before, 8,525 = 8,525 after the mint, and 8,500 = 8,500 after the redeem.
  Screenshots: `screenshots/live-markets.png` (snapshot fallback on github.io), `screenshots/live-mint-redeem.png`.
- the 21 XLM/stablecoin Soroban + native pools

**Not exercised end-to-end:** Freighter-signed transactions (they use the same `Signer` path as in-app keys) and the bot's live strategy mode.

**Simplifications / known limitations:**
- Without a connected wallet, panels show the demo trader / admin accounts as a read-only viewer.
- Mock testnet stablecoins (`mk*`) are worthless test tokens priced at mainnet reference rates.
- The AMM swap panel quotes from the first pool. There is no automatic best-route
  search across AMM pools and SDEX.
- Vault: single collateral token, no funding rates, no borrow interest, no
  open-interest caps, no partial closes. The reserve is the only counterparty.
  Open positions use a bounded, paginated index (`open_position_count`,
  `open_position_ids_page`) with per-wallet and global caps.
- QFX holder yield is simple interest between credits; it compounds only when a holder's balance is touched or `settle` is called. The exempt list is admin-managed.
- The legacy (pre-peg) QFX contract can't be upgraded or removed. It is retired (APR 0) and unused, but its old admin `mint` still exists on that old contract.
- The referral cycle check is bounded to 32 hops (deeper chains are rejected conservatively).
- The mock oracle is admin-pushed. Real deployments need Reflector (or similar)
  and careful asset-key and decimals configuration.
- Pause, timelock, two-step admin and timelocked upgrades exist on testnet (v3), but the admin is still a single account (no multisig yet), and the guardian = admin.
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
