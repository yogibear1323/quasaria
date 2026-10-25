/**
 * Soroban helpers: read-only simulation and signed invocation of the
 * Quasaria contracts on TESTNET.
 */
import { Account, Address, BASE_FEE, Contract, Keypair, TransactionBuilder, nativeToScVal, rpc, scValToNative, xdr } from "@stellar/stellar-sdk";
import { assertSourceOnlyAuth } from "./xdrDescribe";
import { NETWORK_PASSPHRASE, OFFLINE_DEMO, RPC_URL } from "./config";

export const soroban = new rpc.Server(RPC_URL);

export const addr = (a: string) => new Address(a).toScVal();
export const i128 = (v: bigint) => nativeToScVal(v, { type: "i128" });
export const u32 = (v: number) => nativeToScVal(v, { type: "u32" });
export const u64 = (v: bigint | number) => nativeToScVal(BigInt(v), { type: "u64" });
export const bool = (v: boolean) => nativeToScVal(v, { type: "bool" });
export const sym = (s: string) => nativeToScVal(s, { type: "symbol" });
export const vecAddr = (xs: string[]) => xdr.ScVal.scvVec(xs.map(addr));
/** Reflector / vault `Asset::Other(Symbol)` */
export const assetOther = (code: string) => xdr.ScVal.scvVec([sym("Other"), sym(code)]);

/**
 * Compact, stable detail for a failed simulation: the contract error code
 * (`Error(Contract, #7)`) or "non-existent contract function" when the
 * deployed wasm lacks the method (used for feature detection, e.g. Perps).
 */
export function simErrorDetail(sim: unknown): string {
  const raw = sim && typeof sim === "object" && "error" in sim ? String((sim as { error: unknown }).error) : "";
  if (!raw) return "";
  if (/non-existent contract function/.test(raw)) return " (non-existent contract function)";
  const code = raw.match(/Error\(Contract, #\d+\)/)?.[0];
  return code ? ` (${code})` : "";
}

/** Read-only call via simulation (no wallet needed). */
export async function readContract<T = unknown>(contractId: string, method: string, args: xdr.ScVal[] = []): Promise<T> {
  if (OFFLINE_DEMO || !contractId) throw new Error("contract not configured");
  const src = new Account(Keypair.random().publicKey(), "0");
  const tx = new TransactionBuilder(src, { fee: BASE_FEE, networkPassphrase: NETWORK_PASSPHRASE })
    .addOperation(new Contract(contractId).call(method, ...args))
    .setTimeout(30)
    .build();
  const sim = await soroban.simulateTransaction(tx);
  if (!rpc.Api.isSimulationSuccess(sim) || !sim.result) throw new Error(`simulation failed: ${method}${simErrorDetail(sim)}`);
  return scValToNative(sim.result.retval) as T;
}

/** Extra CPU instructions budgeted on top of the simulation. */
export const INSTRUCTION_LEEWAY = 1_000_000;

/** Build, simulate/prepare, sign (wallet) and submit a contract call. */
export async function invokeContract(
  pubkey: string,
  sign: (xdr: string) => Promise<string>,
  contractId: string,
  method: string,
  args: xdr.ScVal[],
) {
  const source = await soroban.getAccount(pubkey);
  const inclusionFee = await competitiveInclusionFee();
  const tx = new TransactionBuilder(source, { fee: String(inclusionFee), networkPassphrase: NETWORK_PASSPHRASE })
    .addOperation(new Contract(contractId).call(method, ...args))
    .setTimeout(TX_TIMEOUT_SECONDS)
    .build();
  // Simulate with an instruction leeway: time-dependent contract math (e.g. QFX's
  // per-second yield accrual) can cost a few more instructions on-chain than in
  // the simulation a few seconds earlier.
  const sim = await soroban.simulateTransaction(tx, { cpuInstructions: INSTRUCTION_LEEWAY });
  if (!rpc.Api.isSimulationSuccess(sim)) throw new Error(`simulation failed: ${method}${"error" in sim ? ` (${sim.error})` : ""}`);
  assertSourceOnlyAuth(method, sim.result?.auth);
  const prepared = rpc.assembleTransaction(tx, sim).build();
  const signed = await sign(prepared.toXDR());
  const signedTx = TransactionBuilder.fromXDR(signed, NETWORK_PASSPHRASE);
  const maxTime = Number((signedTx as { timeBounds?: { maxTime?: string } }).timeBounds?.maxTime ?? 0);
  const deadline = maxTime > 0 ? maxTime * 1000 + 15_000 : Date.now() + (TX_TIMEOUT_SECONDS + 15) * 1000;

  // Submit; retry TRY_AGAIN_LATER (RPC/core queue full) a few times before giving up.
  let sent = await soroban.sendTransaction(signedTx);
  for (let i = 0; sent.status === "TRY_AGAIN_LATER" && i < 5 && Date.now() < deadline; i++) {
    await sleep(3000);
    sent = await soroban.sendTransaction(signedTx);
  }
  if (sent.status === "ERROR") throw new Error(`transaction rejected by RPC${rejectReason(sent, BigInt(prepared.fee))}`);
  if (sent.status === "TRY_AGAIN_LATER") throw new Error("the network is busy and didn't accept the transaction. No funds moved; please try again in a minute.");

  // PENDING or DUPLICATE: poll until the transaction lands or its time bounds expire.
  while (Date.now() < deadline) {
    try {
      const r = await soroban.getTransaction(sent.hash);
      if (r.status === rpc.Api.GetTransactionStatus.SUCCESS) return { hash: sent.hash, result: r.returnValue ? scValToNative(r.returnValue) : null };
      if (r.status === rpc.Api.GetTransactionStatus.FAILED) throw new Error(`transaction failed on-chain: ${sent.hash}`);
    } catch (e) {
      if (e instanceof Error && e.message.startsWith("transaction failed")) throw e;
      // transient RPC error: keep polling
    }
    await sleep(2000);
  }
  throw new Error(`the network didn't include the transaction before it expired (${sent.hash}). No funds moved; please try again.`);
}

const TX_TIMEOUT_SECONDS = 300;
/** Inclusion-fee bounds in stroops (on top of the Soroban resource fee). */
const MIN_INCLUSION_FEE = 1_000; // 0.0001 XLM
const MAX_INCLUSION_FEE = 100_000; // 0.01 XLM

const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

/**
 * Competitive Soroban inclusion fee: 2x the recent p90 from getFeeStats, clamped.
 * The old flat BASE_FEE (100) sat below what nearly every included Soroban tx paid
 * (p10 = 200), so under any surge the tx was accepted as PENDING but never included.
 */
async function competitiveInclusionFee(): Promise<number> {
  try {
    const stats = await soroban.getFeeStats();
    const p90 = Number(stats.sorobanInclusionFee.p90);
    if (Number.isFinite(p90) && p90 > 0) return Math.min(MAX_INCLUSION_FEE, Math.max(MIN_INCLUSION_FEE, p90 * 2));
  } catch { /* fall through */ }
  return 10_000;
}

/** Human-readable reason for a sendTransaction ERROR (e.g. not enough spendable XLM for the fee). */
function rejectReason(sent: { errorResult?: unknown }, feeStroops: bigint): string {
  let code = "";
  try {
    // SDK returns either a plain object ({ result: "tx_insufficient_balance" }) or a legacy XDR object.
    const r = (sent.errorResult as { result?: unknown } | undefined)?.result;
    if (typeof r === "string") code = r;
    else if (typeof r === "function") code = (r as () => { switch: () => { name: string } })().switch().name;
    else if (r && typeof r === "object") code = String((r as { type?: string; name?: string }).type ?? (r as { name?: string }).name ?? "");
    code = code.replace(/^tx/, "").replace(/_/g, "").toLowerCase();
  } catch { /* ignore */ }
  const fee = (Number(feeStroops) / 1e7).toFixed(4);
  if (code === "insufficientbalance")
    return `: not enough spendable XLM left for the ~${fee} XLM network fee after the amount and your account's reserve (0.5 XLM per trustline/offer). Try a smaller amount.`;
  if (code === "insufficientfee") return ": network busy (fee too low), please try again.";
  if (code === "badseq") return ": account sequence changed, please try again.";
  if (code === "toolate") return ": signing took too long, please try again.";
  return code ? ` (${code})` : "";
}
