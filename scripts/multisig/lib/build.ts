// Build an UNSIGNED Soroban admin transaction whose source is the multisig
// admin account (source-account auth flow, plan §1.2): the contract's
// `admin.require_auth()` is satisfied by the envelope signatures of the
// account's signers, so co-signers just add signatures to the same XDR in
// Stellar Lab. Nothing in this module can sign or submit.
import {
  Account,
  Operation,
  StrKey,
  TransactionBuilder,
  contract,
  rpc,
  scValToNative,
  xdr,
} from "@stellar/stellar-sdk";
import { readFileSync } from "node:fs";
import { assertRpcNetwork, type NetworkCfg } from "./network.ts";
import { summarize, toTxrep } from "./txrep.ts";
import { allHashes } from "./hash.ts";

/** The subset of rpc.Server used here (mockable). */
export interface AdminRpc {
  getNetwork(): Promise<{ passphrase: string }>;
  getAccount(id: string): Promise<Account>;
  simulateTransaction(tx: any): Promise<rpc.Api.SimulateTransactionResponse>;
  getContractWasmByContractId?(id: string): Promise<Uint8Array>;
}

export interface BuildRequest {
  server: AdminRpc;
  net: NetworkCfg;
  /** Multisig admin account (G...), used as the transaction source. */
  source: string;
  contractId: string;
  method: string;
  args: xdr.ScVal[];
  /** Inclusion fee in stroops (resource fee is added from simulation). */
  fee?: string;
  /** Validity window: signers must finish within this many seconds. */
  timeoutSeconds?: number;
  /** Allow auth entries other than source-account credentials (default: refuse). */
  allowAddressAuth?: boolean;
  /**
   * Build for sequence (current + 1 + seqOffset) so several transactions for
   * the same source can be signed in parallel; they must then be submitted
   * in order.
   */
  seqOffset?: number;
}

export interface BuildResult {
  xdr: string;
  hash: string;
  hashes: ReturnType<typeof allHashes>;
  txrep: string;
  summary: string;
  minResourceFee: string;
  retval: unknown;
  authKinds: string[];
}

const jsonOf = (x: unknown) => JSON.parse(JSON.stringify(x));
export const toNative = (v: xdr.ScVal) =>
  JSON.parse(JSON.stringify(scValToNative(v), (_k, x) => (typeof x === "bigint" ? x.toString() : x)));

export function validateIds(source: string, contractId: string) {
  if (!StrKey.isValidEd25519PublicKey(source)) throw new Error(`--source must be a G... account id (got ${source})`);
  if (!StrKey.isValidContract(contractId)) throw new Error(`--contract must be a C... contract id (got ${contractId})`);
}

function baseTx(acct: Account, req: BuildRequest, method: string, args: xdr.ScVal[]) {
  return new TransactionBuilder(acct, { fee: req.fee ?? "10000", networkPassphrase: req.net.passphrase })
    .addOperation(Operation.invokeContractFunction({ contract: req.contractId, function: method, args }))
    .setTimeout(req.timeoutSeconds ?? 86_400)
    .build();
}

export async function buildAdminTx(req: BuildRequest): Promise<BuildResult> {
  validateIds(req.source, req.contractId);
  await assertRpcNetwork(req.server, req.net);
  const acct = await req.server.getAccount(req.source);
  if (acct.accountId() !== req.source) throw new Error("RPC returned a different account");
  const off = req.seqOffset ?? 0;
  if (!Number.isInteger(off) || off < 0 || off > 1000) throw new Error("seqOffset must be 0..1000");
  for (let i = 0; i < off; i++) acct.incrementSequenceNumber();
  const tx = baseTx(acct, req, req.method, req.args);
  const sim = await req.server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) throw new Error(`simulation failed: ${sim.error}`);
  if (rpc.Api.isSimulationRestore(sim)) throw new Error("simulation needs a ledger-entry restore first (expired state); restore, then rebuild");
  if (!rpc.Api.isSimulationSuccess(sim)) throw new Error("unexpected simulation response");

  const authKinds = (sim.result?.auth ?? []).map((e) => {
    const c = jsonOf(e).credentials;
    return typeof c === "string" ? c : Object.keys(c)[0];
  });
  const foreign = authKinds.filter((k) => k !== "source_account");
  if (foreign.length && !req.allowAddressAuth) {
    throw new Error(
      `simulation needs ${foreign.length} non-source-account auth entr${foreign.length === 1 ? "y" : "ies"} (${foreign.join(", ")}). ` +
        "The multisig flow only supports source-account auth: make the authorizing account the transaction --source.",
    );
  }
  const prepared = rpc.assembleTransaction(tx, sim).build();
  const out = prepared.toXDR();

  // Post-conditions: unsigned, same source / call as requested.
  const j = jsonOf(xdr.TransactionEnvelope.fromXDR(out, "base64"));
  const t = j.tx?.tx;
  if (!t) throw new Error("assembled envelope is not a v1 transaction");
  if (j.tx.signatures.length !== 0) throw new Error("internal error: envelope is not unsigned");
  if (t.source_account !== req.source) throw new Error("internal error: source changed");
  if (t.operations.length !== 1) throw new Error("internal error: expected exactly one operation");
  const ic = t.operations[0].body.invoke_host_function?.host_function?.invoke_contract;
  if (!ic || ic.contract_address !== req.contractId || ic.function_name !== req.method) {
    throw new Error("internal error: operation does not match the request");
  }

  const hashes = allHashes(out, req.net.passphrase, false);
  if (!hashes.agree) throw new Error(`internal error: hash methods disagree ${JSON.stringify(hashes)}`);
  return {
    xdr: out,
    hash: hashes.sdk,
    hashes,
    txrep: toTxrep(out),
    summary: summarize(out, req.net.passphrase, hashes.sdk),
    minResourceFee: sim.minResourceFee,
    retval: sim.result?.retval ? toNative(sim.result.retval) : null,
    authKinds,
  };
}

/** Read-only call (simulation only) returning the decoded return value. */
export async function readOnly(
  server: AdminRpc,
  net: NetworkCfg,
  source: string,
  contractId: string,
  method: string,
  args: xdr.ScVal[] = [],
): Promise<unknown> {
  const acct = await server.getAccount(source);
  const tx = new TransactionBuilder(acct, { fee: "100", networkPassphrase: net.passphrase })
    .addOperation(Operation.invokeContractFunction({ contract: contractId, function: method, args }))
    .setTimeout(300)
    .build();
  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) throw new Error(`${method}: ${sim.error}`);
  if (!rpc.Api.isSimulationSuccess(sim) || !sim.result) throw new Error(`${method}: no result`);
  return toNative(sim.result.retval);
}

/** Contract spec from a local wasm file or from the network. */
export async function loadSpec(server: AdminRpc, contractId: string, wasmPath?: string): Promise<contract.Spec> {
  if (wasmPath) return contract.Spec.fromWasm(readFileSync(wasmPath));
  if (!server.getContractWasmByContractId) throw new Error("RPC cannot fetch contract wasm; pass --wasm");
  return contract.Spec.fromWasm(Buffer.from(await server.getContractWasmByContractId(contractId)));
}

/**
 * Convert JSON args (an object keyed by parameter name) to ScVals using the
 * contract spec, e.g. for `propose_action`:
 *   {"action": {"tag": "SetGuardian", "values": ["G..."]}}
 */
export function argsFromJson(spec: contract.Spec, method: string, json: string): xdr.ScVal[] {
  const fn = spec.getFunc(method); // throws if unknown
  const obj = json.trim() ? JSON.parse(json) : {};
  if (typeof obj !== "object" || Array.isArray(obj)) throw new Error("--args must be a JSON object keyed by parameter name");
  const names: string[] = jsonOf(fn).inputs.map((i: { name: string }) => i.name);
  for (const k of Object.keys(obj)) if (!names.includes(k)) throw new Error(`unknown parameter "${k}" for ${method}(${names.join(", ")})`);
  for (const n of names) if (!(n in obj)) throw new Error(`missing parameter "${n}" for ${method}(${names.join(", ")})`);
  return spec.funcArgsToScVals(method, obj);
}
