# scripts/multisig — admin multisig tooling (launch plan Step 1)

Builds **unsigned** admin transactions for the hardware-wallet multisig and
verifies them. Full procedure: [`docs/multisig-runbook.md`](../../docs/multisig-runbook.md).

```bash
cd scripts/multisig && npm ci     # Node >= 22.18 (runs .ts directly)
npm test                          # offline unit tests (throwaway keys, mocked RPC/Horizon)
npm run typecheck
```

| Script | What it does | Signs / submits? |
|---|---|---|
| `build-admin-tx.ts` | Unsigned Soroban admin call with the multisig account as **tx source** (source-account auth); simulates, assembles, writes `.xdr` / `.txrep` (SEP-11 style) / `.summary.txt` / `.hash` / `.json`; shows timelock delay + ETA for `propose/execute/cancel_action`. | Never |
| `verify-hash.ts` | Second-machine check: recomputes the tx hash via stellar-sdk, raw XDR bytes + SHA-256, and the Stellar CLI; compares decodes; `--expect <hash>` must match. | Never |
| `setup-multisig-account.ts` | Unsigned single tx of `set_options` ops: add signers, thresholds, master weight 0; heavy safety checks (lockout, duplicates, single-key control, funding, …) and a dry-run decode of the resulting signer set. | Never |
| `rehearsal-testnet.ts` | **Testnet only.** Creates A/G (friendbot, throwaway master keys disabled by the setup tx), builds `propose_admin` / `accept_admin` / threshold test / timelocked `SetGuardian` txs as unsigned XDR, `check`s roles + account config, predicts signature sufficiency (`check-sigs`) and submits signed testnet txs with an expected outcome (`submit-expect`). | Only testnet: its own throwaway A/G master keys, and submitting txs you signed |

Network: default **testnet**. Mainnet requires `--network mainnet --i-understand`
and the tools still only output unsigned XDR. Any argument that looks like a
secret key (`S…`) is refused. Outputs go to `out/` (gitignored).

Examples:

```bash
# queue a timelocked SetGuardian on the staking contract (testnet)
node build-admin-tx.ts --source GA…A --contract CBB6… --fn propose_action \
  --args '{"action":{"tag":"SetGuardian","values":["GG…G"]}}'

# second machine
node verify-hash.ts --xdr out/<name>.xdr --expect <hash from machine 1>

# dry-run the admin multisig layout
node setup-multisig-account.ts --account GA…A --profile admin \
  --signer A1=G…:1 --signer A2=G…:1 --signer A3=G…:1 --dry-run
```

Use `--wasm <file>` with `build-admin-tx.ts` to take the argument spec from a
local wasm instead of the on-chain contract, and `--seq-offset n` to build
several transactions for the same source to be submitted in order.
