import { test } from "node:test";
import assert from "node:assert/strict";
import { Account, Keypair, Networks, TransactionBuilder } from "@stellar/stellar-sdk";
import { buildSetOptionsTx, checkPlan, describeConfig, evaluateSignatures, parseSignerArg, resultingConfig, type MultisigPlan } from "../lib/multisig.ts";
import { parseHorizonAccount } from "../lib/horizon.ts";
import { main as setupMain, defaultDenyList } from "../setup-multisig-account.ts";
import { freshState, mockHorizon } from "./mock.ts";

const P = Networks.TESTNET;
const keys = (n: number) => Array.from({ length: n }, () => Keypair.random());
const plan = (over: Partial<MultisigPlan> = {}): MultisigPlan => ({
  account: Keypair.random().publicKey(),
  signers: keys(3).map((k) => ({ key: k.publicKey(), weight: 1 })),
  low: 2, med: 2, high: 2, masterWeight: 0,
  ...over,
});
const errs = (p: MultisigPlan, st?: any, o: any = { profile: "admin" }) => checkPlan(p, st, o).errors.join(" | ");

test("checkPlan: the 2-of-3 admin layout passes with no errors", () => {
  const p = plan();
  const r = checkPlan(p, freshState(p.account), { profile: "admin" });
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.warnings, []);
});

test("checkPlan refusals: lockout, duplicates, invalid/self/deny-listed keys, weights, thresholds, master", () => {
  const p = plan();
  assert.match(errs({ ...p, high: 4 }), /LOCKOUT: total signer weight 3 < high threshold 4/);
  assert.match(errs({ ...p, med: 4, high: 4 }), /< medium threshold 4/);
  assert.match(errs({ ...p, signers: [p.signers[0], p.signers[0], p.signers[1]] }), /duplicate signer/);
  assert.match(errs({ ...p, signers: [...p.signers, { key: "GNOTAKEY", weight: 1 }] }), /not a valid ed25519/);
  assert.match(errs({ ...p, signers: [...p.signers, { key: p.account, weight: 1 }] }), /own master key/);
  assert.match(errs(p, undefined, { profile: "admin", denySigners: [p.signers[1].key] }), /deny list/);
  assert.match(errs({ ...p, signers: [...p.signers.slice(0, 2), { key: p.signers[2].key, weight: 0 }] }), /weight 0 must be 1..255/);
  assert.match(errs({ ...p, signers: [...p.signers.slice(0, 2), { key: p.signers[2].key, weight: 256 }] }), /must be 1..255/);
  assert.match(errs({ ...p, low: 3, med: 2, high: 2 }), /low <= med <= high/);
  assert.match(errs({ ...p, low: 0 }), /thresholds must be >= 1/);
  assert.match(errs({ ...p, masterWeight: 1 }), /master weight must be 0/);
  assert.match(errs({ ...p, signers: keys(21).map((k) => ({ key: k.publicKey(), weight: 1 })), low: 2, med: 2, high: 2 }), /too many signers/);
  assert.match(errs({ ...p, signers: [] }), /no signers/);
});

test("checkPlan: single-key control and one-lost-device lockout refused for admin/treasury, warned for guardian", () => {
  const p = plan({ signers: [{ key: Keypair.random().publicKey(), weight: 2 }, { key: Keypair.random().publicKey(), weight: 1 }] });
  assert.match(errs(p), /single signer reaches the medium threshold/);
  assert.match(errs(p, undefined, { profile: "treasury" }), /single signer/);
  const twoOfTwo = plan({ signers: keys(2).map((k) => ({ key: k.publicKey(), weight: 1 })) });
  assert.match(errs(twoOfTwo), /one lost device locks admin calls/);
  const g = plan({ signers: keys(2).map((k) => ({ key: k.publicKey(), weight: 1 })), low: 1, med: 1, high: 2 });
  const r = checkPlan(g, undefined, { profile: "guardian" });
  assert.deepEqual(r.errors, []);
  assert.ok(r.warnings.some((w) => /single signature reaches/.test(w)));
  assert.ok(r.warnings.some((w) => /high threshold/.test(w)));
});

test("checkPlan: refuses accounts that are already configured or underfunded", () => {
  const p = plan();
  assert.match(errs(p, freshState(p.account, { masterWeight: 0 })), /master key is already disabled/);
  assert.match(errs(p, freshState(p.account, { signers: [{ key: Keypair.random().publicKey(), weight: 1 }] })), /already has 1 extra signer/);
  assert.match(errs(p, freshState(p.account, { thresholds: { low: 2, med: 2, high: 2 } })), /already has thresholds/);
  assert.match(errs(p, freshState(p.account, { balanceStroops: 30_000_000n })), /balance 3.0000000 XLM < new minimum balance 2.5000000 XLM/);
});

test("buildSetOptionsTx + resultingConfig: one tx, signers first, master 0 + thresholds last", () => {
  const p = plan({ homeDomain: "quasaria.xyz" });
  const tx = buildSetOptionsTx(p, new Account(p.account, "10"), P);
  assert.equal(tx.operations.length, 3);
  const x = tx.toEnvelope().toXDR("base64");
  const after = resultingConfig(x, freshState(p.account));
  assert.equal(after.masterWeight, 0);
  assert.deepEqual(after.thresholds, { low: 2, med: 2, high: 2 });
  assert.deepEqual(after.signers.map((s) => s.key).sort(), p.signers.map((s) => s.key).sort());
  assert.equal(after.homeDomain, "quasaria.xyz");
  const d = describeConfig(after);
  assert.match(d, /Medium-threshold ops .*: any 2 of 3 signers/);
  assert.match(d, /After losing any one signer: medium still possible, high still possible/);
  assert.match(d, /DISABLED/);
});

test("setup-multisig-account CLI: dry run builds unsigned XDR; refusals return ok=false", async () => {
  const p = plan();
  const hz = mockHorizon({ [p.account]: freshState(p.account) });
  const sig = p.signers.flatMap((s, i) => ["--signer", `A${i + 1}=${s.key}:1`]);
  const r = await setupMain(["--account", p.account, "--profile", "admin", ...sig, "--dry-run", "--quiet"], hz);
  assert.equal(r.ok, true);
  const tx = TransactionBuilder.fromXDR(r.xdr!, P) as any;
  assert.equal(tx.signatures.length, 0);
  assert.equal(tx.source, p.account);
  assert.equal(tx.sequence, "101");
  const e = console.error;
  console.error = () => {};
  try {
    const dup = await setupMain(["--account", p.account, "--profile", "admin", "--signer", `${p.signers[0].key}:1`, "--signer", `${p.signers[0].key}:1`, "--signer", `${p.signers[1].key}:1`, "--quiet"], hz);
    assert.equal(dup.ok, false);
    const lock = await setupMain(["--account", p.account, "--profile", "custom", "--low", "1", "--med", "2", "--high", "5", ...sig, "--quiet"], hz);
    assert.match(lock.errors.join(), /LOCKOUT/);
    const missing = await setupMain(["--account", Keypair.random().publicKey(), "--profile", "admin", ...sig, "--quiet"], hz);
    assert.match(missing.errors.join(), /does not exist/);
    const deny = defaultDenyList();
    if (deny.length) {
      const hot = await setupMain(["--account", p.account, "--profile", "admin", ...sig, "--signer", `${deny[0]}:1`, "--quiet"], hz);
      assert.match(hot.errors.join(), /deny list/);
    }
    await assert.rejects(setupMain(["--account", p.account, ...sig, "--network", "mainnet"], hz), /i-understand/);
  } finally {
    console.error = e;
  }
});

test("evaluateSignatures: 2-of-3 → 1 sig fails (bad_auth), 2 pass, 3 extra, foreign sig extra", () => {
  const p = plan();
  const ks = keys(3);
  const signers = ks.map((k) => ({ key: k.publicKey(), weight: 1 }));
  const tx = buildSetOptionsTx({ ...p, signers }, new Account(p.account, "1"), P);
  const at = (n: number, extra?: Keypair) => {
    const t = TransactionBuilder.fromXDR(tx.toEnvelope().toXDR("base64"), P);
    ks.slice(0, n).forEach((k) => t.sign(k));
    if (extra) t.sign(extra);
    return t.toEnvelope().toXDR("base64");
  };
  assert.equal(evaluateSignatures(at(0), P, signers, 2).predicted, "FAIL");
  const one = evaluateSignatures(at(1), P, signers, 2);
  assert.equal(one.predicted, "FAIL");
  assert.match(one.reason, /txBAD_AUTH: signature weight 1 < threshold 2/);
  const two = evaluateSignatures(at(2), P, signers, 2);
  assert.equal(two.predicted, "PASS");
  assert.equal(two.weight, 2);
  assert.match(evaluateSignatures(at(3), P, signers, 2).reason, /BAD_AUTH_EXTRA/);
  const foreign = evaluateSignatures(at(2, Keypair.random()), P, signers, 2);
  assert.equal(foreign.unknownSignatures, 1);
  assert.equal(foreign.predicted, "FAIL");
  // a signature over the wrong network's hash does not count
  const t = TransactionBuilder.fromXDR(tx.toEnvelope().toXDR("base64"), Networks.PUBLIC);
  ks.slice(0, 2).forEach((k) => t.sign(k));
  assert.equal(evaluateSignatures(t.toEnvelope().toXDR("base64"), P, signers, 2).weight, 0);
});

test("parseSignerArg / parseHorizonAccount", () => {
  const k = Keypair.random().publicKey();
  assert.deepEqual(parseSignerArg(`A1=${k}:1`), { key: k, weight: 1, label: "A1" });
  assert.deepEqual(parseSignerArg(`${k}:3:G1`), { key: k, weight: 3, label: "G1" });
  const id = Keypair.random().publicKey();
  const h = parseHorizonAccount({
    account_id: id, sequence: "77", subentry_count: 1, num_sponsoring: 0, num_sponsored: 0,
    balances: [{ asset_type: "native", balance: "12.5000000" }],
    signers: [{ key: k, weight: 1 }, { key: id, weight: 0 }],
    thresholds: { low_threshold: 2, med_threshold: 2, high_threshold: 2 },
  });
  assert.equal(h.state.balanceStroops, 125_000_000n);
  assert.equal(h.state.masterWeight, 0);
  assert.deepEqual(h.state.signers, [{ key: k, weight: 1 }]);
});
