import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Keypair, Networks, TransactionBuilder } from "@stellar/stellar-sdk";
import { main } from "../rehearsal-testnet.ts";
import { rehearsalContracts, validateDevices, compareRoles, checkAccountConfig } from "../lib/rehearsal.ts";
import { resultingConfig } from "../lib/multisig.ts";
import { freshState, mockRpc } from "./mock.ts";
import type { AccountState } from "../lib/multisig.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "../../..");
const STAKING = join(REPO, "contracts/target/wasm32v1-none/release/quasaria_staking.wasm");
const devKeys = () => Array.from({ length: 5 }, () => Keypair.random());
const quiet = { log: () => {} };
const fnName = (x: string) => JSON.parse(JSON.stringify(TransactionBuilder.fromXDR(x, Networks.TESTNET).toEnvelope())).tx.tx.operations[0].body.invoke_host_function.host_function.invoke_contract.function_name;

/** Mock Horizon that applies submitted set_options txs to its state. */
function liveHorizon() {
  const st: Record<string, { seq: string; state: AccountState }> = {};
  return {
    st,
    horizon: {
      async account(id: string) { return st[id] ? { sequence: st[id].seq, state: st[id].state } : null; },
      async baseReserveStroops() { return 5_000_000n; },
    },
    friendbot: async (id: string) => { st[id] = { seq: "1000", state: freshState(id, { balanceStroops: 100_000_000_000n }) }; },
    submitClassic: async (x: string) => {
      const tx: any = TransactionBuilder.fromXDR(x, Networks.TESTNET);
      const s = st[tx.source];
      assert.equal(tx.signatures.length, 1, "signed by the throwaway master");
      assert.ok(Keypair.fromPublicKey(tx.source).verify(tx.hash(), Buffer.from(JSON.parse(JSON.stringify(tx.toEnvelope())).tx.signatures[0].signature, "hex")), "master signature valid");
      const after = resultingConfig(x, s.state);
      s.state = { ...s.state, masterWeight: after.masterWeight, signers: after.signers, thresholds: after.thresholds };
      s.seq = (BigInt(s.seq) + 1n).toString();
    },
  };
}

test("rehearsal: testnet only — any other network is refused", async () => {
  await assert.rejects(main(["check", "--network", "mainnet"]), /TESTNET ONLY/);
});

test("rehearsal: device key validation", () => {
  const k = devKeys().map((x) => x.publicKey());
  assert.deepEqual(validateDevices({ A1: k[0], A2: k[1], A3: k[2], G1: k[3], G2: k[4] }), []);
  assert.match(validateDevices({ A1: k[0], A2: k[0], A3: k[2], G1: k[3], G2: k[4] }).join(), /duplicates A1/);
  assert.match(validateDevices({ A1: k[0], A2: k[1], A3: k[2], G1: k[3] }).join(), /--g2 is required/);
  assert.match(validateDevices({ A1: k[0], A2: k[1], A3: k[2], G1: k[3], G2: k[4] }, [k[4]]).join(), /hot\/dev key/);
});

test("rehearsal: contract list from deployments (SACs skipped, lending deduped, asset pools optional)", () => {
  const dep = JSON.parse(readFileSync(join(REPO, "deployments/testnet.json"), "utf8"));
  const assets = JSON.parse(readFileSync(join(REPO, "deployments/testnet-assets.json"), "utf8"));
  const core = rehearsalContracts(dep, assets);
  assert.ok(!core.some((c) => c.name.endsWith("Sac")));
  assert.equal(core.filter((c) => c.id === dep.lending.pool).length, 1);
  assert.ok(rehearsalContracts(dep, assets, { includeAssetPools: true }).length > core.length);
  assert.deepEqual(rehearsalContracts(dep, assets, { only: ["staking"] }).map((c) => c.name), ["staking"]);
  assert.throws(() => rehearsalContracts(dep, assets, { only: ["nope"] }), /unknown contract/);
});

test("rehearsal create-accounts (mocked friendbot/Horizon): A 2-of-3, G 1-of-2 high 2, masters disabled, state has no secrets", async () => {
  const dir = mkdtempSync(join(tmpdir(), "reh-"));
  const k = devKeys().map((x) => x.publicKey());
  const L = liveHorizon();
  const r: any = await main(["create-accounts", "--a1", k[0], "--a2", k[1], "--a3", k[2], "--g1", k[3], "--g2", k[4], "--out-dir", dir], { ...quiet, horizon: L.horizon, friendbot: L.friendbot, submitClassic: L.submitClassic, server: mockRpc() });
  assert.equal(r.submitted, true);
  assert.deepEqual(checkAccountConfig("A", L.st[r.A].state, k.slice(0, 3), { low: 2, med: 2, high: 2 }), []);
  assert.deepEqual(checkAccountConfig("G", L.st[r.G].state, k.slice(3), { low: 1, med: 1, high: 2 }), []);
  const raw = readFileSync(join(dir, "state.json"), "utf8");
  assert.doesNotMatch(raw, /S[A-Z2-7]{55}/);
  assert.equal(JSON.parse(raw).A, r.A);
  await assert.rejects(main(["create-accounts", "--a1", k[0], "--a2", k[1], "--a3", k[2], "--g1", k[3], "--g2", k[4], "--out-dir", dir], { ...quiet, horizon: L.horizon, server: mockRpc() }), /exists/);
});

test("rehearsal builders + check (mocked RPC, real Step-1 staking spec)", { skip: !existsSync(STAKING) }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "reh-"));
  const k = devKeys().map((x) => x.publicKey());
  const A = Keypair.random().publicKey();
  const G = Keypair.random().publicKey();
  const hot = Keypair.random().publicKey();
  writeFileSync(join(dir, "state.json"), JSON.stringify({ network: "testnet", A, G, devices: { A1: k[0], A2: k[1], A3: k[2], G1: k[3], G2: k[4] }, createdAt: "x" }));
  const wasm = readFileSync(STAKING);
  const base = ["--out-dir", dir, "--contracts", "staking"];

  // propose: source = current hot admin
  let srv = mockRpc({ wasm, views: { admin: hot, pending_admin: null } });
  let built: any = await main(["build-propose", ...base], { ...quiet, server: srv });
  assert.equal(built.length, 1);
  let tx: any = TransactionBuilder.fromXDR(built[0].xdr, Networks.TESTNET);
  assert.equal(tx.source, hot);
  assert.equal(tx.signatures.length, 0);
  assert.ok(readdirSync(dir).some((f) => /^\d\d-propose-staking\.xdr$/.test(f)));

  // accept: source = A, only once pending_admin == A
  srv = mockRpc({ wasm, views: { admin: hot, pending_admin: A } });
  built = await main(["build-accept", ...base], { ...quiet, server: srv });
  tx = TransactionBuilder.fromXDR(built[0].xdr, Networks.TESTNET);
  assert.equal(tx.source, A);
  assert.equal(fnName(tx.toEnvelope().toXDR("base64")), "accept_admin");
  built = await main(["build-accept", ...base], { ...quiet, server: mockRpc({ wasm, views: { admin: hot, pending_admin: null } }) });
  assert.equal(built.length, 0, "skipped until propose is on chain");

  // threshold test + guardian (Step-1 wasm → timelocked SetGuardian)
  srv = mockRpc({ wasm, views: { admin: A, pending_admin: null, action_eta: null } });
  built = await main(["build-threshold-test", ...base], { ...quiet, server: srv });
  assert.equal((TransactionBuilder.fromXDR(built[0].xdr, Networks.TESTNET) as any).source, A);
  built = await main(["build-guardian", ...base], { ...quiet, server: srv });
  tx = TransactionBuilder.fromXDR(built[0].xdr, Networks.TESTNET);
  assert.equal(fnName(tx.toEnvelope().toXDR("base64")), "propose_action");
  built = await main(["build-guardian-execute", ...base], { ...quiet, server: mockRpc({ wasm, views: { admin: A, action_eta: 1 } }) });
  assert.equal(fnName(built[0].xdr), "execute_action");

  // check: contract roles + A/G account config
  const hz = {
    async account(id: string) {
      if (id === A) return { sequence: "1", state: freshState(A, { masterWeight: 0, signers: k.slice(0, 3).map((key) => ({ key, weight: 1 })), thresholds: { low: 2, med: 2, high: 2 } }) };
      if (id === G) return { sequence: "1", state: freshState(G, { masterWeight: 0, signers: k.slice(3).map((key) => ({ key, weight: 1 })), thresholds: { low: 1, med: 1, high: 2 } }) };
      return null;
    },
    async baseReserveStroops() { return 5_000_000n; },
  };
  let r: any = await main(["check", ...base], { ...quiet, horizon: hz, server: mockRpc({ wasm, views: { admin: A, guardian: G, pending_admin: null } }) });
  assert.equal(r.ok, true);
  r = await main(["check", ...base], { ...quiet, horizon: hz, server: mockRpc({ wasm, views: { admin: hot, guardian: hot, pending_admin: A } }) });
  assert.equal(r.ok, false);
  assert.match(r.rows[0].problems.join(), /admin .* != A/);
  process.exitCode = 0;
});

test("rehearsal check-sigs: 1 A-device signature predicted to fail, 2 to pass", async () => {
  const dev = devKeys().slice(0, 3);
  const A = Keypair.random().publicKey();
  const { buildAdminTx } = await import("../lib/build.ts");
  const { resolveNetwork } = await import("../lib/network.ts");
  const { randomContract } = await import("./mock.ts");
  const r = await buildAdminTx({ server: mockRpc(), net: resolveNetwork({}), source: A, contractId: randomContract(), method: "unpause", args: [] });
  const hz = { async account() { return { sequence: "1", state: freshState(A, { masterWeight: 0, signers: dev.map((d) => ({ key: d.publicKey(), weight: 1 })), thresholds: { low: 2, med: 2, high: 2 } }) }; }, async baseReserveStroops() { return 5_000_000n; } };
  const signed = (n: number) => {
    const t = TransactionBuilder.fromXDR(r.xdr, Networks.TESTNET);
    dev.slice(0, n).forEach((d) => t.sign(d));
    return t.toEnvelope().toXDR("base64");
  };
  const one: any = await main(["check-sigs", "--xdr", signed(1)], { ...quiet, horizon: hz, server: mockRpc() });
  assert.equal(one.predicted, "FAIL");
  const two: any = await main(["check-sigs", "--xdr", signed(2)], { ...quiet, horizon: hz, server: mockRpc() });
  assert.equal(two.predicted, "PASS");
});

test("compareRoles flags pending admin", () => {
  const A = "GA", G = "GG";
  assert.equal(compareRoles([{ name: "x", admin: A, guardian: G, pending: A }], A, G)[0].ok, false);
});
