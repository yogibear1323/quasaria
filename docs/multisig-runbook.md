# Quasaria admin multisig: signing runbook

Status: **draft for auditor review** (launch plan Step 1, §1.8). Applies to the
protocol admin account **A** (2-of-3), the guardian **G** (1-of-2, high 2) and
the treasury **T** (2-of-3). All times in this document are MST
(America/Phoenix, UTC−7, no DST).

Tools live in `scripts/multisig/` (see its README). They **only build unsigned
transactions and verify them**: nothing in `build-admin-tx.ts`,
`verify-hash.ts` or `setup-multisig-account.ts` can sign or submit, and they
refuse any argument that looks like a secret key. Mainnet needs
`--network mainnet --i-understand` and still produces only unsigned XDR.

```
 build ─▶ Txrep review ─▶ simulate ─▶ two-machine hash check ─▶ sign (device 1)
   ─▶ co-sign (device 2) ─▶ submit ─▶ verify on-chain ─▶ log
```

---

## 0. Roles and rules

| Role | Who | Holds |
|---|---|---|
| **Builder** | dev on machine **M1** (repo checkout at a reviewed commit) | nothing secret |
| **Verifier** | a second person on machine **M2** (different OS/network if possible) | nothing secret |
| **Signer 1 / 2** | owner / co-signer | A1–A3, G1–G2, T1–T3 hardware devices |

Hard rules:

1. **No key ever touches a computer.** Seeds exist only on the device and on steel.
2. **Never sign a hash you have not seen match on M1, M2 and the device screen.**
   On Ledger, Soroban calls are **blind** ("hash signing"); the hash is the
   only thing you can check. Classic ops (`set_options`, payments) are shown in clear.
3. **Every admin change except pause / tighten_reserve / set_active(false) is
   timelocked** (48 h parameters, 72 h upgrade / oracle / treasury / delay on
   mainnet). A change is always two signing sessions: `propose_action`, then
   after the delay `execute_action`. Anything urgent is a **pause**, not a change.
4. Use the **source-account flow**: the multisig account is the transaction
   source, so its signatures authorise the contract call (medium threshold).
   Never sign separate Soroban auth entries for admin work.
5. Exactly **2** admin signatures. A third signature makes the transaction fail
   (`tx_bad_auth_extra`, verified in the testnet dry run).
6. One action per transaction; one transaction per session unless the batch
   was built with consecutive `--seq-offset`s (then submit strictly in order).

---

## 1. Build (machine M1)

```bash
cd scripts/multisig && npm ci          # pinned @stellar/stellar-sdk 17.2.1
git log -1 --format=%H                 # record the commit in the log
node build-admin-tx.ts \
  --network mainnet --i-understand \
  --source <A G-address> \
  --contract <contract C-address> \
  --fn propose_action \
  --args '{"action":{"tag":"SetFeeBps","values":[25]}}' \
  --timeout 86400 --name 2026-11-02-pool-fee
```

Outputs `out/<name>.{xdr,txrep,summary.txt,hash,json}`, prints the decoded
summary, the timelock delay that will apply (`action_delay`) and whether the
action is already queued (`action_eta`).

* `--timeout` sets the validity window (default 24 h, max 7 days). All
  signatures must be collected and the tx submitted inside it, otherwise rebuild.
* The script refuses if the simulation fails, if it would need non-source
  auth entries, if a ledger restore is required, or if the RPC serves a
  different network than requested.
* To build the matching `execute_action` later, run the same command with
  `--fn execute_action` and the identical `--args`.

## 2. Txrep review (M1, both signers watching)

Read `out/<name>.summary.txt` and `out/<name>.txrep` (SEP-11 style). Check, line by line:

- [ ] `tx.sourceAccount` is **A** (or G / T as intended), nothing else.
- [ ] Network passphrase is the intended one (`Public Global Stellar Network ; September 2015` for mainnet).
- [ ] Exactly **one** operation, `invokeHostFunction` → the right **contract id** and **function**.
- [ ] Arguments decode to exactly the intended values (fee bps, address, wasm hash…). For
      `Upgrade(hash)` compare the hash with the audited, allow-listed hash in
      `config/wasm-allowlist.mainnet.json`.
- [ ] Auth: `source_account` only. Fee and resource fee are sane (inclusion fee 10 000 stroops by default).
- [ ] Validity window (`maxTime`) shown in MST is what you expect.
- [ ] Signatures: **0 (UNSIGNED)**.

## 3. Simulate

`build-admin-tx.ts` already simulated the call against the live ledger and
printed the return value. For a timelocked `execute_action`, the simulation
also proves the ETA has passed. If anything changed on chain since the build
(e.g. a sequence number moved because another tx was submitted from A),
rebuild instead of signing an old XDR.

## 4. Two-machine hash check (M1 + M2)

Copy **only the XDR** (`out/<name>.xdr`) to M2 (QR, USB stick, or paste).
M2 has its own checkout of the same commit (or just the `scripts/multisig/` folder) and runs:

```bash
node verify-hash.ts --network mainnet --xdr <file-or-base64> \
  --expect <hash read aloud / typed from M1>
```

`verify-hash.ts` recomputes the hash three independent ways (stellar-sdk,
raw XDR bytes + SHA-256 per the protocol, and `stellar tx hash` from the
Stellar CLI if installed), checks the SDK decode equals `stellar tx decode`,
prints the Txrep again, and fails on any mismatch with `--expect`.
The Verifier re-reads the Txrep on M2 (step 2 checklist) independently.

Both machines print the hash in groups of 4 (`e6af a38a …`). Write it on the
signing log sheet.

## 5. Sign in Stellar Lab with a hardware wallet (Signer 1)

1. On a clean browser profile open **https://lab.stellar.org** (type the URL; check TLS).
2. Select network **Mainnet** (top right). Go to *Transactions → Sign transaction*.
3. Paste the XDR. Lab shows the decoded transaction and **its hash**: it must
   match M1/M2.
4. *Sign with wallet* → **Ledger** (WebHID) or **Trezor** (Trezor Connect).
   - **Ledger** (Stellar app ≥ the version tested in the rehearsal): enable
     *Settings → Hash signing* **only for this session**; the device shows
     the transaction hash. Compare **all 64 hex characters** with the log
     sheet. Approve only on a full match. Disable hash signing afterwards.
     For `set_options` (classic) the Ledger shows the operations in clear:
     check each signer key and weight, thresholds and master weight 0.
   - **Trezor** (firmware ≥ 2.12.4): confirm the screens; Soroban support for
     Protocol 27+ credential types is still an open issue (#7311): test on
     testnet with the same firmware before relying on it, otherwise use the Ledger devices.
   - Use derivation path index 0 (`44'/148'/0'`) unless the device inventory says otherwise.
5. Lab appends the signature. Copy the **signed XDR** (it now has 1 signature).

## 6. Co-sign (Signer 2)

Signer 2 receives the 1-signature XDR, pastes it in Lab (or re-runs
`verify-hash.ts --expect <hash>` first: signatures do not change the hash),
checks the hash on their own device and signs. Optional sanity check before submitting:

```bash
node rehearsal-testnet.ts check-sigs --xdr signed.xdr   # testnet accounts only
```

(It looks up the account's signers on Horizon and predicts PASS/FAIL,
including `tx_bad_auth` / `tx_bad_auth_extra`.)

## 7. Submit and verify

- Submit from Lab (*Submit transaction*) or `stellar tx send`. Anyone can
  submit: submission needs no key.
- Look the hash up on stellar.expert / Lab and confirm `SUCCESS`.
- For `propose_action`: note the ETA (event `tl_queued`), post it to the
  public channel (Step 5 watcher bot), and schedule the `execute_action`
  session after the ETA and **before ETA + 14 days** (grace window).
- For `execute_action`: read back the changed value (`action_eta` must now be `None`).

## 8. Signing log (keep forever)

| Date/time (MST) | Commit | Contract | Function + args | Hash | Built by | Verified by | Signers (device ids) | Result / ledger |
|---|---|---|---|---|---|---|---|---|

---

## 9. Device setup checklist (per device)

- [ ] Bought **only** from the official shop (ledger.com / trezor.io); sealed
      packaging intact; device shows "new / not initialised" on first boot.
- [ ] Latest firmware installed via Ledger Live / Trezor Suite downloaded from the vendor site.
- [ ] **New** seed generated **on the device** (24 words). Never use a seed card that came in the box.
- [ ] Seed written by hand on the paper card, then stamped on **steel**; paper destroyed after the steel backup is verified.
- [ ] Optional BIP-39 passphrase: stored separately from the seed (different location); if used, document *that* it is used (never the passphrase) in the device inventory.
- [ ] Strong PIN (≥ 8 digits on Ledger, ≥ 6 on Trezor); wipe-after-N-wrong-PINs enabled.
- [ ] Stellar app installed (Ledger) / Stellar enabled (Trezor).
- [ ] Public key read **from the device screen** for account index 0, written on the inventory and cross-checked in Lab ("Connect wallet → show address on device").
- [ ] Label the device (A1, A2, A3, G1, G2, T1, T2, T3) with a sticker that does not reveal the role publicly.
- [ ] Testnet: sign one rehearsal transaction with it (rehearsal §11).
- [ ] Device inventory updated: id, model, firmware, public key, holder, storage location, backup location, date.

Layout (plan §1.4): A1 owner Ledger Flex (home), A2 owner Trezor Safe 5 (off-site), A3 co-signer Ledger Nano S Plus; G1 owner Nano S Plus, G2 on-call dev; T1–T3 same people as A on **separate seeds/accounts**. Two vendors so one firmware bug can't reach the threshold.

## 10. Seed and backup procedures

- One seed per device. **Never** photograph, type, print, cloud-sync or speak a seed.
- Steel backups in **three separate places**: home safe, bank safe-deposit box, co-signer's location. No place holds enough seeds to reach a threshold (e.g. A1 + A2 backups never together).
- Tamper-evident bags with serial numbers; check the serials at every drill.
- If a backup location may be compromised: treat those seeds as lost → rotate (see §12, "lost device").
- Succession: a sealed letter with the lawyer/custodian explaining where the backups are and that 2 of 3 are needed (no seed words in the letter).

## 11. Testnet rehearsal (plan §1.6.1)

Run once the five device public keys exist (A1–A3, G1–G2). Testnet only.

```bash
cd scripts/multisig
node rehearsal-testnet.ts create-accounts --a1 G… --a2 G… --a3 G… --g1 G… --g2 G…
#   creates A and G with friendbot; one set_options each (2/2/2 and 1/1/2, master 0)
node rehearsal-testnet.ts build-propose        # propose_admin(A) by the hot testnet admin
#   sign each out/rehearsal/NN-propose-*.xdr with the hot key:
#   stellar tx sign --sign-with-key <testnet-admin-identity> --network testnet < file.xdr > signed.xdr
node rehearsal-testnet.ts submit-expect --xdr signed.xdr --expect success
node rehearsal-testnet.ts build-accept         # accept_admin by A → sign in Lab with 2 devices
node rehearsal-testnet.ts build-threshold-test --contracts staking
#   sign with ONE device → submit-expect --expect fail   (tx_bad_auth)
#   add a SECOND device  → submit-expect --expect success
node rehearsal-testnet.ts build-guardian       # propose_action(SetGuardian(G)), 300 s testnet timelock
node rehearsal-testnet.ts build-guardian-execute   # after the ETA
node rehearsal-testnet.ts check                # admin()=A, guardian()=G, no pending admin, A/G config
```

Add `--asset-pools` to include the 52 v3 asset pools. The live v3 testnet
contracts run the **pre-Step-1** wasm: `build-guardian` then falls back to the
old instant `set_guardian` (with a warning). Upgrade the testnet contracts to
the Step-1 wasm first to rehearse the timelocked path. Log every tx hash in §8.

A throwaway dry run of this flow (fresh referral copy, throwaway keys) was run
on 2026-10-01 and confirmed: 1 of 3 signatures → `tx_bad_auth`, 3 of 3 →
`tx_bad_auth_extra`, 2 of 3 → success; timelocked SetGuardian; guardian
cancels a queued action with 1 of 2 signatures; instant `set_guardian` gone.

## 12. Recovery drill (every 6 months, plan §1.4)

1. Pick one device at random (rotate through all of them over time).
2. Retrieve its steel backup; check the tamper-bag serial.
3. On a **spare** device (factory reset), restore from the steel backup (+ passphrase if used).
4. Confirm the public key on screen equals the inventory entry.
5. Sign a testnet transaction for the rehearsal A/G account (e.g. `build-threshold-test`) with the restored device plus one other device and submit it.
6. Wipe the spare device; reseal the backup in a new numbered bag; record the drill in the log.

Failure → treat that backup as lost: rotate the signer (below) within one week.

### Rotating a signer (lost/stolen/compromised device)

High threshold on A is 2, so the two remaining devices can always rotate:

1. Build a classic `set_options` with source A: add the new device key (weight 1)
   and, in the same tx, remove the lost key (weight 0). Review it in Lab (clear-signed on Ledger).
2. Sign with the two remaining devices; submit; check signers on Horizon.
3. A compromised **admin** device is not enough to act alone (needs 2), but rotate immediately and watch for `tl_queued` events.

## 13. Incident path

**Something is wrong (exploit, bad oracle, unexpected queued action):**

1. **Pause** (any guardian device alone, 1-of-2): build `pause` with
   `--source <G> --fn pause --args '{"caller":"<G>"}'` per contract (pools,
   lending, staking, QFX). On lending also `tighten_reserve` (admin, instant)
   if a single reserve is the problem. Exits (withdraw, redeem, unstake, repay)
   keep working by design.
2. **Cancel** a malicious or mistaken queued action: guardian (1 signature) or
   admin: `--source <G> --fn cancel_action --args '{"caller":"<G>","action":{…exact queued action…}}'`.
   The action args must match the queued action exactly (it is identified by its hash).
3. Announce on the public channel with the tx hashes.
4. Fix: any remedy is a normal timelocked admin change (48/72 h), so the
   protocol stays paused until it executes; `unpause` needs the admin (2 of 3).

Pre-built `pause` transactions expire (max `--timeout` 7 days, and the
sequence number moves), so don't rely on a stash of signed pauses. Keep the
commands above ready, and rehearse the pause/cancel path on testnet every quarter.

**Known trade-off:** a compromised guardian can pause and cancel (a liveness
attack: it can block changes) but cannot change parameters, move funds or
upgrade. The admin can replace the guardian, but `SetGuardian` itself is
timelocked and a malicious guardian could keep cancelling it. Mitigation:
G1/G2 are hardware keys held by different people; if both guardian keys are
compromised, the guardian account's own signers can be rotated by G's high
threshold (2 = both devices), so keep G's devices separate. If the guardian is
lost entirely, the contracts keep working; only fast pausing is lost until a
new guardian executes.

## 14. Setting up a mainnet multisig account (plan §1.6.2)

```bash
node setup-multisig-account.ts --network mainnet --i-understand \
  --account <A> --profile admin \
  --signer A1=G…:1 --signer A2=G…:1 --signer A3=G…:1 --dry-run
```

The tool refuses (never builds) if: total signer weight < high or medium
threshold, duplicate / invalid / own-master / deny-listed (testnet hot) keys,
weights outside 1–255, more than 20 signers, thresholds not low ≤ med ≤ high,
master weight ≠ 0, one key reaching the medium threshold on admin/treasury,
losing one signer locking admin calls, the account already has extra signers
or thresholds or a disabled master, or the balance is below the new minimum
(2 + subentries + signers) × base reserve + 1 XLM. The dry run re-derives the
resulting signer set **from the XDR** and prints "any 2 of 3 signers" style
statements. Run without `--dry-run` to write the files, then take the XDR
through steps 2–7 (signed once by the account's current master key, clear-signed on the device:
check every signer key against the device inventory before approving).
