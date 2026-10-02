// TESTNET ONLY: protocol-28 smoke test of a THROWAWAY contract copy.
//
// Deploys a fresh copy of the mock oracle built from this branch (new random
// keys, funded by friendbot), then exercises the protocol 27/28 surface our
// apps touch:
//   1. upload + deploy with constructor (CREATE_CONTRACT_V2, CONTRACT_EXECUTABLE_WASM)
//   2. a call needing *non-source* address auth, signed with the legacy
//      SOROBAN_CREDENTIALS_ADDRESS (v1) payload
//   3. the same with CAP-71 SOROBAN_CREDENTIALS_ADDRESS_V2 (the stellar-sdk v17 default)
//   4. a source-account-auth call, a read-back, and event decoding
// Never touches the live Quasaria contracts or any mainnet endpoint. Keys live in
// memory only and are never printed. Writes deployments/smoke-p28.json.
//
//   node scripts/smoke-p28.ts            (after `cd contracts && stellar contract build`)
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import {
  Address, BASE_FEE, Contract, Keypair, Networks, Operation, TransactionBuilder, authorizeEntry, inspectAuthEntry,
  nativeToScVal, rpc, scValToNative, xdr,
} from "../frontend/node_modules/@stellar/stellar-sdk/lib/esm/index.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const RPC = process.env.SOROBAN_RPC_URL ?? "https://soroban-testnet.stellar.org";
const server = new rpc.Server(RPC);
const log = (...a: unknown[]) => console.log(...a);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const sym = (s: string) => xdr.ScVal.scvSymbol(s);
const assetOther = (code: string) => xdr.ScVal.scvVec([sym("Other"), sym(code)]);

async function fund(pk: string) {
  for (let i = 0; i < 5; i++) {
    const r = await fetch(`https://friendbot.stellar.org/?addr=${pk}`);
    if (r.ok) return;
    await sleep(2000);
  }
  throw new Error(`friendbot failed for ${pk}`);
}

async function send(tx: ReturnType<TransactionBuilder["build"]>, signer: Keypair) {
  tx.sign(signer);
  const sent = await server.sendTransaction(tx);
  if (sent.status === "ERROR") return { ok: false as const, hash: sent.hash, error: `sendTransaction ERROR: ${JSON.stringify(sent.errorResult?.toXdrObject?.() ?? sent.errorResult, (_k, v) => (typeof v === "bigint" ? v.toString() : v))}` };
  const res = await server.pollTransaction(sent.hash, { attempts: 40 });
  if (res.status !== rpc.Api.GetTransactionStatus.SUCCESS) return { ok: false as const, hash: sent.hash, error: String(res.status) };
  return { ok: true as const, hash: sent.hash, res };
}

async function main() {
  const net = await server.getNetwork();
  if (net.passphrase !== Networks.TESTNET) throw new Error(`refusing: RPC is not TESTNET (${net.passphrase})`);
  const ver = await server.getVersionInfo();
  log(`testnet RPC ${ver.version}, protocol ${net.protocolVersion}`);

  const src = Keypair.random(); // tx source
  const admin = Keypair.random(); // oracle admin: signs auth entries, never the envelope
  await fund(src.publicKey());
  await fund(admin.publicKey());
  log(`funded throwaway source ${src.publicKey()} and admin ${admin.publicKey()}`);

  const builder = async () => new TransactionBuilder(await server.getAccount(src.publicKey()), { fee: String(Number(BASE_FEE) * 10), networkPassphrase: Networks.TESTNET }).setTimeout(120);
  const simAndSend = async (op: xdr.Operation, useV2 = true) => {
    const tx = (await builder()).addOperation(op).build();
    const sim = await server.simulateTransaction(tx, undefined, undefined, useV2);
    if (!rpc.Api.isSimulationSuccess(sim)) throw new Error(`simulation failed: ${"error" in sim ? sim.error : "?"}`);
    return send(rpc.assembleTransaction(tx, sim).build(), src);
  };

  // 1) upload + deploy
  const wasm = readFileSync(resolve(root, "contracts/target/wasm32v1-none/release/quasaria_mock_oracle.wasm"));
  const up = await simAndSend(Operation.uploadContractWasm({ wasm }));
  if (!up.ok) throw new Error(`upload failed: ${up.error}`);
  const wasmHash = scValToNative(up.res.returnValue!) as Uint8Array;
  const salt = randomBytes(32);
  const dep = await simAndSend(
    Operation.createCustomContract({ address: new Address(src.publicKey()), wasmHash, salt, constructorArgs: [new Address(admin.publicKey()).toScVal(), nativeToScVal(14, { type: "u32" }), nativeToScVal(300n, { type: "u64" })] }),
  );
  if (!dep.ok) throw new Error(`deploy failed: ${dep.error}`);
  const contractId = Address.fromScVal(dep.res.returnValue!).toString();
  log(`deployed throwaway mock oracle ${contractId} (wasm ${Buffer.from(wasmHash).toString("hex")})`);
  const oracle = new Contract(contractId);

  // 2/3) admin-authorized call from a different source, v1 vs v2 credentials
  const setPrice = (code: string, price: bigint) => oracle.call("set_price", assetOther(code), nativeToScVal(price, { type: "i128" }), nativeToScVal(0n, { type: "u64" }));
  const adminCall = async (op: xdr.Operation, useV2: boolean) => {
    const tx = (await builder()).addOperation(op).build();
    const sim = await server.simulateTransaction(tx, undefined, undefined, useV2);
    if (!rpc.Api.isSimulationSuccess(sim)) return { kind: "?", ok: false, error: `simulation: ${"error" in sim ? sim.error : "?"}` };
    const entries = sim.result?.auth ?? [];
    const kind = entries.map((e) => inspectAuthEntry(e).credentialType).join(",");
    const latest = (await server.getLatestLedger()).sequence;
    const signed = await Promise.all(entries.map((e) => authorizeEntry(e, admin, latest + 60, Networks.TESTNET)));
    const tx2 = (await builder()).addOperation(Operation.invokeHostFunction({ func: (tx.operations[0] as { func: xdr.HostFunction }).func, auth: signed })).build();
    const sim2 = await server.simulateTransaction(tx2, { cpuInstructions: 500_000 }, undefined, useV2);
    if (!rpc.Api.isSimulationSuccess(sim2)) return { kind, ok: false, error: `enforcing simulation: ${"error" in sim2 ? String(sim2.error).split("\n")[0] : "?"}` };
    const r = await send(rpc.assembleTransaction(tx2, sim2).build(), src);
    return { kind, ok: r.ok, hash: r.hash, error: r.ok ? undefined : r.error };
  };
  const v1 = await adminCall(setPrice("P28V1", 111n), false);
  log(`legacy ADDRESS (v1) auth: credentials=[${v1.kind}] -> ${v1.ok ? "ACCEPTED" : `REJECTED (${v1.error})`} ${v1.hash ?? ""}`);
  const v2 = await adminCall(setPrice("P28V2", 222n), true);
  log(`CAP-71 ADDRESS_V2 auth:   credentials=[${v2.kind}] -> ${v2.ok ? "ACCEPTED" : `REJECTED (${v2.error})`} ${v2.hash ?? ""}`);

  // 4) read back + events
  const readTx = (await builder()).addOperation(oracle.call("lastprice", assetOther("P28V2"))).build();
  const rs = await server.simulateTransaction(readTx);
  const back = rpc.Api.isSimulationSuccess(rs) ? (scValToNative(rs.result!.retval) as { price: bigint } | null) : null;
  log(`read-back lastprice(P28V2) = ${back?.price ?? "none"}`);
  // 5) an event-emitting call (gov `propose_admin` -> map-format `admin_proposed` event with topics only)
  const prop = await adminCall(oracle.call("propose_admin", new Address(src.publicKey()).toScVal()), true);
  const tr = prop.hash ? ((await server.getTransaction(prop.hash)) as rpc.Api.GetSuccessfulTransactionResponse) : null;
  const evs = (tr?.events?.contractEventsXdr ?? []).flat();
  const decoded = evs.map((e) => {
    const body = e.body.v0;
    return { topics: body.topics.map((t) => { const v = scValToNative(t); return typeof v === "string" ? v : String(v); }), data: scValToNative(body.data) as unknown };
  });
  log(`propose_admin: ${prop.ok ? "ok" : `FAILED (${prop.error})`}; contract events: ${JSON.stringify(decoded)}`);

  const out = {
    _comment: "Throwaway protocol-28 smoke test (scripts/smoke-p28.ts). TESTNET ONLY; not a Quasaria deployment; nothing here is used by the app.",
    ranAt: new Date().toISOString(),
    rpc: RPC, rpcVersion: ver.version, protocolVersion: net.protocolVersion,
    contractId, wasmSha256: Buffer.from(wasmHash).toString("hex"),
    upload: up.hash, deploy: dep.hash,
    legacyAddressV1: v1, addressV2: v2,
    readBackPriceV2: back?.price?.toString() ?? null,
    proposeAdmin: prop,
    proposeAdminEvents: decoded,
  };
  writeFileSync(resolve(root, "deployments/smoke-p28.json"), JSON.stringify(out, null, 2) + "\n");
  if (!v2.ok || back?.price !== 222n || !prop.ok || !decoded.length) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exit(1); });
