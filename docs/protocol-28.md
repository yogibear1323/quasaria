# Stellar Protocol 28 ("Adapter"), and the protocol 29 upgrade that followed

Status: written Oct 1, 2026 on branch `protocol-28`; merged to `main` on Oct 2, 2026 (PR #2, after PR #1). Testnet only. No mainnet transactions were made, and the live testnet contracts were not touched.

## TL;DR

- **Protocol 28 ("Adapter")** contains three CAPs: **CAP-83**, **CAP-85** and **CAP-86**. Testnet activated it on Aug 27, 2026 and mainnet on Sep 16, 2026, both at 17:00 UTC.
- **Both networks are already past protocol 28.** On-chain reads show **protocol 29** on testnet since **Sep 29, 2026 17:00 UTC** and on mainnet since **Oct 1, 2026 17:00 UTC** (10:00 AM MST). There was no public announcement or upgrade guide for p29. The release notes describe a fix-style upgrade (details in §2).
- **Quasaria was already on the p28 stack at Rust level.** `soroban-sdk 28.0.0` was in place, the build target was `wasm32v1-none`, and the build used stellar-cli 28.0.0. The 8 live testnet contracts were built with SDK 28.0.0, rustc 1.98.1 and CLI 28.0.0. No soroban-sdk 29 exists yet.
- **This branch** does the following:
  - bumps the JS SDK to 17.2.1
  - pins rustc
  - makes the signing previews and the bot/frontend aware of every p27/p28 XDR arm
  - adds a testnet smoke test, which passed on protocol 29
  - documents what we did not adopt.

## 1. What protocol 28 contains (official sources)

| CAP | What it does | Breaking for | Impact on Quasaria |
|---|---|---|---|
| [CAP-83](https://github.com/stellar/stellar-protocol/blob/master/core/cap-0083.md): validators may vote to drop the tx set of the current ledger | Adds a new `StellarValue` type `STELLAR_VALUE_EMPTY_TX_SET` (txSetHash = 0). Consensus can proceed before the tx set arrives. | Raw ledger consumers (`LedgerCloseMeta` / `StellarValue`: indexers, Galexie pipelines) | **None.** We only use Horizon and RPC through the SDK. |
| [CAP-85](https://github.com/stellar/stellar-protocol/blob/master/core/cap-0085.md): externally managed contract executables | Adds `CONTRACT_EXECUTABLE_EXTERNAL_REF` (owner contract + tag) and `SCV_EXECUTABLE_TAG`. Contracts that point at the same reference upgrade together, atomically. | Custom accounts that parse the `__check_auth` context and don't know the new arm. They can't authorize external-ref deploys. | **None today.** We have no custom accounts and deploy no external-ref contracts. Decoders now handle the new arms (§4). Adoption is an option (§5). |
| [CAP-86](https://github.com/stellar/stellar-protocol/blob/master/core/cap-0086.md): sparse Symbol-keyed map host functions | Adds `sparse_map_new_from_linear_memory` / `sparse_map_unpack_to_linear_memory`. | Nothing at protocol level | SDK 28 uses them. Reading a `#[contracttype]` struct now tolerates missing `Option` fields and extra fields (easier storage migrations). Map-format events **omit** `None`/void fields. We audited every `#[contractevent]`: none has an `Option` or void data field, so our event payloads don't change. |

There are **no** fee-model, TTL/archival or event-format changes at protocol level in p28. The upgrade guide says "Adapter is not expected to introduce backwards incompatibility in Stellar Core itself."

**Credential types (CAP-71, protocol 27, not 28).** `SOROBAN_CREDENTIALS_ADDRESS_V2` and `SOROBAN_CREDENTIALS_ADDRESS_WITH_DELEGATES` came in **protocol 27** (Jul 8, 2026 mainnet). [CAP-71-02](https://github.com/stellar/stellar-protocol/blob/master/core/cap-0071-02.md) explicitly does *not* deprecate the legacy `SOROBAN_CREDENTIALS_ADDRESS`, and says deprecation "may" come in "protocol 28 or later". **No p28 CAP deprecates it.** The js-stellar-sdk 17.0.0 notes call V2 "mandatory in protocol 28", and the Trezor proto comments call v1 "due to be deprecated in Protocol 28". Neither matches the CAPs. On-chain the legacy v1 credential still works: our smoke test had **legacy v1 ACCEPTED** on testnet at **protocol 29** (§3).

### Minimum versions for protocol 28 (official software-versions page)

| Component | p28 minimum (testnet) | p28 recommended (mainnet) | Ours before | Ours after |
|---|---|---|---|---|
| soroban-sdk (Rust) | 28.0.0 | 28.0.0 | **28.0.0** | 28.0.0 (latest on crates.io) |
| soroban-env-host / stellar-xdr (via SDK) | 28.0.1 / 28.0.0 | 28.0.2 / 28.0.0 | 28.0.2 / 28.0.0 | unchanged |
| stellar-cli | 28.0.0 | 28.1.0 | 28.0.0 | **28.0.0, kept on purpose** (§5) |
| @stellar/stellar-sdk (JS) | 17.0.0 (16.3.x also has p28 XDR) | 17.1.0 | ^17.1.0 (lock 17.1.0) | **^17.2.1** (lock 17.2.1) |
| scripts/multisig (PR #1) | | | 17.2.1 (pinned) | unchanged |
| Rust toolchain | rustc ≥ 1.91 (SDK MSRV), target `wasm32v1-none` | | stable 1.99.0, unpinned | **pinned 1.99.0** via `contracts/rust-toolchain.toml` |

`scripts/*.ts` import the SDK from `frontend/node_modules`, so they get 17.2.1 too.

## 2. Protocol 29 (live on both networks since this week)

Observed on-chain (Horizon `/ledgers/{seq}` bisection; RPC `getNetwork` / `getVersionInfo`; Oct 1, 2026 6:06 PM MST):

| Network | p27→p28 first ledger | p28→p29 first ledger | Now |
|---|---|---|---|
| Testnet | 4,365,284 (Aug 27, 2026 17:00:07 UTC) | 4,935,524 (Sep 29, 2026 17:00:07 UTC) | ledger 4,975,921, protocol 29, core 29.0.0, RPC 29.0.0 |
| Mainnet | 64,458,446 (Sep 16, 2026 17:00:06 UTC) | 64,717,645 (Oct 1, 2026 17:00:07 UTC = 10:00 AM MST) | ledger 64,723,482, protocol 29, core 29.0.0, RPC 29.0.0 (SDF Horizon, `mainnet.sorobanrpc.com`, gateway.fm) |

**I found no official announcement, upgrade guide, software-versions entry or CAP for protocol 29.** The only sources are release notes:

- [stellar-core `v29.0.0-internal`](https://github.com/stellar/stellar-core/releases/tag/v29.0.0-internal), published Oct 1, 2026 17:22 UTC, after mainnet had already upgraded. Contents:
  - "Improve DEX offer crossing accuracy" (classic order book; also filters offers that clear for 0)
  - "Don't count pool hops against limit" (liquidity-pool hops are exempt from the offer-crossing limit)
  - p29 Wasm cost inputs: custom sections now count toward the module's data-segment cost inputs, and BrTable targets toward instructions. This **raises contract-code rent**.
  - lower max overlay message (5 MB) and tx-set (4 MB) sizes
  - overlay hardening.
- [rs-soroban-env v29.0.0](https://github.com/stellar/rs-soroban-env/releases/tag/v29.0.0): "Start protocol 29", an `extend_ttl` clamp fix and a wasmi bump.
- [stellar-rpc v29.0.0](https://github.com/stellar/stellar-rpc/releases/tag/v29.0.0): "Support for Protocol 29".

stellar-xdr has no v29 tag. No soroban-sdk 29, stellar-cli 29 or js-stellar-sdk p29 release exists. The SDK 28 / CLI 28 / JS 17.2.1 stack works on p29: the smoke test passed on p29 testnet.

What p29 means for us:

1. **Rent.** Contract-code rent now includes custom sections (`contractspecv0`, `contractmetav0`). Fees come from simulation, so nothing breaks. Bigger specs cost a little more, though (option §5.4).
2. **Classic DEX path payments** may fill slightly differently (more accurate crossing). We only build classic LP deposits; swaps go through our Soroban router.
3. Everything else is consensus or overlay internals.

## 3. Testnet smoke test (throwaway copy, protocol 29)

`node scripts/smoke-p28.ts` (results in `deployments/smoke-p28.json`; fresh friendbot keys, never printed). The run on Oct 1, 2026 ~6:19 PM MST did the following:

- built the mock oracle from this branch (wasm `9ba468f3…f96da`), uploaded it and deployed it with a constructor (`CREATE_CONTRACT_V2`): **ok**
- `set_price` from a different tx source, admin auth signed with **legacy `SOROBAN_CREDENTIALS_ADDRESS` (v1)**: **ACCEPTED**
- the same with **CAP-71 `ADDRESS_V2`** (the stellar-sdk 17 default): **ACCEPTED**; read-back price matches
- gov `propose_admin` emitted an `admin_proposed` event. It decoded as topics `[admin_proposed, G…, G…]` and data `{}` (the CAP-86 sparse map: no data fields).

The live Quasaria testnet contracts were not redeployed or upgraded.

## 4. What changed on this branch

1. **JS SDK `^17.1.0` → `^17.2.1`** (frontend, bot). This brings:
   - CAP-71 delegate-auth fixes in `authorizeEntry` / `needsNonInvokerSigningBy`
   - `scvSortedMap()` / `nativeToScVal()` sorting map keys in host order (previously some maps were rejected by the host)
   - `Asset.compare()` ordering by issuer key bytes, which fixes valid pool pairs being rejected by `getLiquidityPoolId` / `LiquidityPoolAsset`. We use both in `frontend/src/lib/stellar.ts`.
2. **`frontend/src/lib/xdrDescribe.ts`** (new, total functions, 9 tests). It describes:
   - every `SorobanCredentials` arm: `SOURCE_ACCOUNT`, legacy `ADDRESS`, `ADDRESS_V2`, `ADDRESS_WITH_DELEGATES` with delegate list, and `UNKNOWN(...)` with a do-not-sign warning
   - every `ContractExecutable`, including CAP-85 `EXTERNAL_REF` (owner + tag)
   - `SCV_EXECUTABLE_TAG`
   - bytes and non-UTF-8 strings, which stellar-sdk 17 returns as `Uint8Array`. Before this, they rendered as `{"0":…}`.
3. **Lending Txrep preview** (`frontend/src/lib/lending.ts`): it now lists each auth entry (credential type, address, nonce, expiry, root call) instead of only `auth.len`. Deploys and uploads (including external-ref) are shown and flagged instead of silently stopping the preview.
4. **Source-only auth guards.** The frontend wallets and the bot/keeper only sign the envelope. If simulation needs any non-source credential (v1, v2, delegates or a future arm), they now stop **before** the wallet prompt or submission, with a named error, instead of submitting a transaction that must fail and paying its fee. Code: `frontend/src/lib/xdrDescribe.ts` (`assertSourceOnlyAuth`), used in `soroban.ts` and `lending.ts`; `bot/src/authGuard.ts`, used in both bot write paths (3 tests).
5. **`contracts/rust-toolchain.toml`** pins rustc 1.99.0 + `wasm32v1-none` + clippy. `scripts/build.sh` warns when the stellar CLI differs from the pinned 28.0.0 (§5).
6. **`scripts/smoke-p28.ts`**: the testnet-only smoke test from §3. It refuses any RPC whose passphrase isn't testnet.
7. **`docs/patches/pr1-multisig-p28-credentials.patch`**: a follow-up for PR #1 (see "PR #1 compatibility" below).

No contract (Rust) source changed: SDK 28 was already in use and nothing was deprecated in our code. `deploy_v2` / `update_current_contract_wasm` were already migrated, and `gov` uses `update_current_contract(ContractExecutable::Wasm(..))`. Test results:

- Rust: **119/119** tests pass
- clippy `--workspace --all-targets -D warnings`: clean
- strict clippy (`--lib -D warnings` + `arithmetic_side_effects`, `integer_division`, `unwrap_used`, `cast_possible_truncation`, `cast_sign_loss`, `cast_possible_wrap`): clean
- frontend **164/164** (155 + 9 new), `tsc -b` and `vite build` pass
- bot **35/35** (32 + 3 new) plus `tsc`

## 5. Not adopted (options for the owner)

1. **stellar-cli 28.1.0** (the docs' recommended p28 version). I verified it (tarball sha256 matches the release digest; installed side by side at `~/.local/stellar-cli-28.1.0/`). It changes **every wasm hash**, because the CLI writes `cliver` into `contractmetav0`; the code is byte-identical apart from that string. PR #1's wasm blocklist records the mock-oracle hash built with **rustc 1.99.0 + CLI 28.0.0**, and the combined merge reproduces it exactly. 28.1.0 adds nothing protocol-related (token commands, bindings, `contract build archive`). Recommendation: stay on 28.0.0 until the audit freezes the toolchain, then bump once and re-record the hashes.
2. **CAP-85 external executable refs for the AMM pool fleet.** We run 52 v3 pools from one wasm, and a single tag would upgrade all of them atomically. It's useful, but it changes the trust model: whoever controls the owner contract's tag controls every pool's code. It would need to sit behind the PR #1 timelock and multisig, plus an audit. Trezor cannot display external-ref deploys yet, and neither can the Ledger app source we checked. Not adopted.
3. **Deliberate CAP-86 migrations** (adding `Option` fields to stored structs without a migration). This is available now with SDK 28, but no storage change is planned. If we ever add `Option` fields to a `#[contractevent]`, off-chain consumers must handle absent keys, or use `#[contractevent(sparse = false)]`.
4. **p29 rent:** trim `contractmetav0` (we embed `desc` / `network` / `project` meta) to cut the custom-section bytes that p29 now charges rent on. The saving is small; measure before acting.
5. **Rebuild and redeploy the live testnet contracts** on the pinned toolchain. Out of scope here (they already run SDK 28).

## 6. Hardware signing (re-checked Oct 1, 2026)

- **Trezor.** [#7311 "Stellar: Support Protocol 27"](https://github.com/trezor/trezor-firmware/issues/7311) is **closed** (Sep 9, 2026), fixed by [PR #7751](https://github.com/trezor/trezor-firmware/pull/7751) ("support authentication delegation (CAP 71-01)", merged Sep 9).
  - Released firmware **2.12.4** (Aug 19) and **2.12.5** (Sep 16) already support `SOURCE_ACCOUNT` and **`ADDRESS_V2`**. Their `messages-stellar.proto` at tags `core/v2.12.4` and `core/v2.12.5` reserves value 1 and **refuses legacy `SOROBAN_CREDENTIALS_ADDRESS`**.
  - **`ADDRESS_WITH_DELEGATES` is only on `main`.** Its changelog entry `core/.changelog.d/7311.added` is not in the 2.12.5 notes, so it's unreleased.
  - **`CONTRACT_EXECUTABLE_EXTERNAL_REF` (CAP-85) is "not supported yet"** (reserved 2 in the proto on `main`).
  - Our launch plan's caveat ("ADDRESS_V2 is still an open issue … mainnet runs protocol 28") is out of date on both points.
- **Ledger.** [LedgerHQ/app-stellar](https://github.com/LedgerHQ/app-stellar) `master` is v6.1.0 (merged from lightsail-network on Sep 23–24, 2026). Its parser handles all four credential arms (`Address`, `AddressV2`, `AddressWithDelegates`; test vectors `op_invoke_host_function_with_auth_address_v2` / `_delegates`). It has **no** `EXTERNAL_REF` executable or `SCV_EXECUTABLE_TAG`. I did not verify whether 6.1.0 has reached Ledger Live; the last GitHub *release* on the lightsail repo is v5.4.1 (2024).
- **For us:** the PR #1 admin multisig flow only builds `SOURCE_ACCOUNT`-auth transactions (it refuses anything else), so it works on both devices. The frontend/bot guards above enforce source-only auth everywhere else. Avoid flows that need legacy v1 entries signed on a Trezor. The JS SDK 17 default (V2) is the right one.

## PR #1 compatibility (`mainnet-step1-multisig` @ 659a094)

I merged `protocol-28` into PR #1 in a scratch worktree (local branch `scratch/p28-plus-pr1`, not pushed). Merging in the reverse order is also clean (`git merge-tree`).

- **Conflicts: none.** The only file both branches touch is `docs/mainnet-readiness-checklist.md`, and it auto-merged (different sections: PR #1 §5.1 table note; this branch §5.2 and §8.1).
- **Combined results:**
  - Rust **149/149** tests
  - clippy `--all-targets -D warnings` clean; strict clippy clean
  - frontend **164/164**, `tsc` and build pass
  - bot **35/35**
  - `scripts/multisig` **31/31** + `tsc` (32/32 with the follow-up below)
  - wasm build reproduces PR #1's blocklisted mock-oracle hash `231c1238…192e` byte for byte; `wasm-guard --network mainnet` still refuses it on all five rules.
- **Follow-up for PR #1** (`docs/patches/pr1-multisig-p28-credentials.patch`; applies cleanly to 659a094; applied on `main` as commit `ecc01c4` after both PRs merged): `scripts/multisig/lib/txrep.ts` `summarize()` only printed the address for legacy `address` credentials. It now does the following, with one new test:
  - names `address_v2` / `address_with_delegates` with their address
  - lists delegates
  - marks legacy v1 ("Trezor refuses")
  - warns on unknown arms

  No dep bump is needed: PR #1 already pins `@stellar/stellar-sdk` 17.2.1.
- **Recommended merge order:** PR #1 first, then this PR. This PR has no contract changes and merges cleanly either way. Landing PR #1 first lets the follow-up patch go onto the PR #1 branch, or straight onto main right after it.

## Sources

- Protocol 28 announcement: https://stellar.org/blog/developers/introducing-adapter-protocol-28-on-stellar
- Protocol 28 upgrade guide (dates, breaking changes): https://stellar.org/blog/developers/adapter-protocol-28-upgrade-guide
- Software versions (p28 / p27 minimums; no p29 entry): https://developers.stellar.org/docs/networks/software-versions
- CAP index (CAP-83/85/86 = protocol 28, Final; CAP-71 = 27): https://github.com/stellar/stellar-protocol/blob/master/core/README.md
- CAP-83: https://github.com/stellar/stellar-protocol/blob/master/core/cap-0083.md
- CAP-85: https://github.com/stellar/stellar-protocol/blob/master/core/cap-0085.md
- CAP-86: https://github.com/stellar/stellar-protocol/blob/master/core/cap-0086.md
- CAP-71: https://github.com/stellar/stellar-protocol/blob/master/core/cap-0071.md
- CAP-71-02: https://github.com/stellar/stellar-protocol/blob/master/core/cap-0071-02.md
- stellar-core v28.0.0 (bumps to p28: CAP-83/85/86): https://github.com/stellar/stellar-core/releases/tag/v28.0.0
- stellar-core v28.0.1: https://github.com/stellar/stellar-core/releases/tag/v28.0.1
- stellar-core v29.0.0-internal: https://github.com/stellar/stellar-core/releases/tag/v29.0.0-internal
- p29 commit list: https://github.com/stellar/stellar-core/compare/v28.0.1...v29.0.0-internal
- rs-soroban-sdk 28.0.0 (p28 support, breaking changes, CAP-85/86 APIs): https://github.com/stellar/rs-soroban-sdk/releases/tag/v28.0.0
- SDK migration guide: https://docs.rs/soroban-sdk/28.0.0/soroban_sdk/_migrating/index.html
- rs-soroban-env v28.0.2: https://github.com/stellar/rs-soroban-env/releases/tag/v28.0.2
- rs-soroban-env v29.0.0: https://github.com/stellar/rs-soroban-env/releases/tag/v29.0.0
- stellar-rpc v29.0.0: https://github.com/stellar/stellar-rpc/releases/tag/v29.0.0
- js-stellar-sdk v17.0.0 (protocol 28; V2 credentials default): https://github.com/stellar/js-stellar-sdk/releases/tag/v17.0.0
- js-stellar-sdk v17.1.0: https://github.com/stellar/js-stellar-sdk/releases/tag/v17.1.0
- js-stellar-sdk v17.2.0: https://github.com/stellar/js-stellar-sdk/releases/tag/v17.2.0
- js-stellar-sdk v17.2.1: https://github.com/stellar/js-stellar-sdk/releases/tag/v17.2.1
- js-stellar-sdk v16.3.0 (p28 XDR backport): https://github.com/stellar/js-stellar-sdk/releases/tag/v16.3.0
- js-stellar-sdk v16.0.0 (p27/CAP-71): https://github.com/stellar/js-stellar-sdk/releases/tag/v16.0.0
- stellar-cli v28.0.0 ("Protocol 28 support"): https://github.com/stellar/stellar-cli/releases/tag/v28.0.0
- stellar-cli v28.1.0: https://github.com/stellar/stellar-cli/releases/tag/v28.1.0
- stellar-xdr v28.0: https://github.com/stellar/stellar-xdr/releases/tag/v28.0
- On-chain:
  - https://horizon-testnet.stellar.org and https://horizon.stellar.org (root + `/ledgers/{seq}`)
  - https://soroban-testnet.stellar.org and https://mainnet.sorobanrpc.com (`getNetwork`, `getVersionInfo`)
- Trezor:
  - issue #7311: https://github.com/trezor/trezor-firmware/issues/7311
  - PR #7751: https://github.com/trezor/trezor-firmware/pull/7751
  - changelog: https://github.com/trezor/trezor-firmware/blob/main/core/CHANGELOG.md
  - proto (main): https://github.com/trezor/trezor-firmware/blob/main/common/protob/messages-stellar.proto
  - proto (2.12.5): https://github.com/trezor/trezor-firmware/blob/core/v2.12.5/common/protob/messages-stellar.proto
- Ledger:
  - app repo: https://github.com/LedgerHQ/app-stellar
  - parser: https://github.com/LedgerHQ/app-stellar/blob/master/stellarlib/src/parser.rs
