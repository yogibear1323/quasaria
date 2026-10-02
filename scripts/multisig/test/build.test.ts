import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Keypair, Networks, contract, xdr } from "@stellar/stellar-sdk";
import { buildAdminTx, argsFromJson } from "../lib/build.ts";
import { resolveNetwork } from "../lib/network.ts";
import { sdkHash, rawHash } from "../lib/hash.ts";
import { verify } from "../verify-hash.ts";
import { main as buildMain } from "../build-admin-tx.ts";
import { mockRpc, randomContract } from "./mock.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const WASM = resolve(HERE, "../../../contracts/target/wasm32v1-none/release");
const net = resolveNetwork({});
const A = () => Keypair.random().publicKey();

test("buildAdminTx: unsigned, source = multisig account, footprint assembled, hashes agree", async () => {
  const src = A();
  const c = randomContract();
  const r = await buildAdminTx({ server: mockRpc(), net, source: src, contractId: c, method: "unpause", args: [] });
  const env = JSON.parse(JSON.stringify(xdr.TransactionEnvelope.fromXDR(r.xdr, "base64")));
  assert.equal(env.tx.signatures.length, 0);
  assert.equal(env.tx.tx.source_account, src);
  assert.equal(env.tx.tx.operations.length, 1);
  assert.equal(env.tx.tx.operations[0].body.invoke_host_function.host_function.invoke_contract.function_name, "unpause");
  assert.ok(env.tx.tx.ext.v1, "soroban data attached");
  assert.equal(r.authKinds.join(), "source_account");
  assert.equal(r.hash, sdkHash(r.xdr, Networks.TESTNET));
  assert.equal(r.hash, rawHash(r.xdr, Networks.TESTNET));
  assert.ok(verify(r.xdr, Networks.TESTNET, r.hash, true).ok, "verify-hash agrees (incl. stellar CLI when installed)");
  assert.match(r.txrep, /invokeHostFunction/);
  assert.match(r.summary, /UNSIGNED/);
});

test("buildAdminTx: address-credential auth refused (multisig flow needs source-account auth)", async () => {
  await assert.rejects(
    buildAdminTx({ server: mockRpc({ auth: "address" }), net, source: A(), contractId: randomContract(), method: "unpause", args: [] }),
    /source-account auth/,
  );
  const ok = await buildAdminTx({ server: mockRpc({ auth: "address" }), net, source: A(), contractId: randomContract(), method: "unpause", args: [], allowAddressAuth: true });
  assert.equal(ok.authKinds.join(), "address");
});

test("buildAdminTx: simulation error surfaced; wrong RPC network refused; bad ids refused", async () => {
  await assert.rejects(
    buildAdminTx({ server: mockRpc({ error: "HostError: Error(Contract, #908)" }), net, source: A(), contractId: randomContract(), method: "set_guardian", args: [] }),
    /simulation failed: .*#908/,
  );
  await assert.rejects(
    buildAdminTx({ server: mockRpc({ passphrase: Networks.PUBLIC }), net, source: A(), contractId: randomContract(), method: "unpause", args: [] }),
    /mismatch/,
  );
  await assert.rejects(buildAdminTx({ server: mockRpc(), net, source: "GBAD", contractId: randomContract(), method: "x", args: [] }), /--source/);
});

test("buildAdminTx: seqOffset builds consecutive sequence numbers", async () => {
  const src = A();
  const c = randomContract();
  const srv = mockRpc();
  const seqs: bigint[] = [];
  for (const off of [0, 1, 2]) {
    const r = await buildAdminTx({ server: srv, net, source: src, contractId: c, method: "accept_admin", args: [], seqOffset: off });
    seqs.push(BigInt(JSON.parse(JSON.stringify(xdr.TransactionEnvelope.fromXDR(r.xdr, "base64"))).tx.tx.seq_num));
  }
  assert.deepEqual(seqs.map((s) => s - seqs[0]), [0n, 1n, 2n]);
});

test("argsFromJson: Step-1 action enums from the real staking wasm; unknown params refused", { skip: !existsSync(join(WASM, "quasaria_staking.wasm")) }, () => {
  const spec = contract.Spec.fromWasm(readFileSync(join(WASM, "quasaria_staking.wasm")));
  const g = A();
  const v = argsFromJson(spec, "propose_action", JSON.stringify({ action: { tag: "SetGuardian", values: [g] } }));
  assert.equal(v.length, 1);
  assert.throws(() => argsFromJson(spec, "propose_action", JSON.stringify({ act: 1 })), /unknown parameter/);
  assert.throws(() => argsFromJson(spec, "propose_action", "{}"), /missing parameter/);
  assert.throws(() => spec.getFunc("set_guardian"), "instant set_guardian is gone from the Step-1 wasm");
  assert.throws(() => spec.getFunc("add_pool"), "instant add_pool is gone");
});

test("build-admin-tx CLI: writes unsigned files; mainnet needs --i-understand; secrets refused", { skip: !existsSync(join(WASM, "quasaria_staking.wasm")) }, async () => {
  const out = mkdtempSync(join(tmpdir(), "msig-"));
  const src = A();
  const c = randomContract();
  const args = ["--source", src, "--contract", c, "--fn", "propose_action", "--wasm", join(WASM, "quasaria_staking.wasm"), "--args", JSON.stringify({ action: { tag: "SetGuardian", values: [A()] } }), "--out-dir", out, "--name", "t"];
  const srv = mockRpc({ views: { action_delay: 300, action_eta: null } });
  const origLog = console.log;
  console.log = () => {};
  try {
    const r = await buildMain(args, srv);
    const meta = JSON.parse(readFileSync(join(out, "t.json"), "utf8"));
    assert.equal(meta.unsigned, true);
    assert.equal(meta.network, "testnet");
    assert.equal(readFileSync(join(out, "t.hash"), "utf8").trim(), r.hash);
    assert.match(readFileSync(join(out, "t.summary.txt"), "utf8"), /Timelock delay for this action: 300 s/);
    assert.ok(verify(readFileSync(join(out, "t.xdr"), "utf8").trim(), Networks.TESTNET, r.hash, false).ok);
    await assert.rejects(buildMain([...args, "--network", "mainnet"], srv), /i-understand/);
    // mainnet + --i-understand still only builds unsigned XDR (mock reports mainnet)
    const m = await buildMain([...args, "--network", "mainnet", "--i-understand", "--name", "m"], mockRpc({ passphrase: Networks.PUBLIC, views: { action_delay: 172800, action_eta: null } }));
    assert.equal(JSON.parse(JSON.stringify(xdr.TransactionEnvelope.fromXDR(m.xdr, "base64"))).tx.signatures.length, 0);
    assert.equal(m.hash, sdkHash(m.xdr, Networks.PUBLIC));
    await assert.rejects(buildMain([...args, "--fee", Keypair.random().secret()], srv), /SECRET/);
  } finally {
    console.log = origLog;
  }
});
