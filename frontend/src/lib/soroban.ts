/**
 * Soroban helpers: read-only simulation and signed invocation of the
 * Quasaria contracts on TESTNET.
 */
import { Account, Address, BASE_FEE, Contract, Keypair, TransactionBuilder, nativeToScVal, rpc, scValToNative, xdr } from "@stellar/stellar-sdk";
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

/** Read-only call via simulation (no wallet needed). */
export async function readContract<T = unknown>(contractId: string, method: string, args: xdr.ScVal[] = []): Promise<T> {
  if (OFFLINE_DEMO || !contractId) throw new Error("contract not configured");
  const src = new Account(Keypair.random().publicKey(), "0");
  const tx = new TransactionBuilder(src, { fee: BASE_FEE, networkPassphrase: NETWORK_PASSPHRASE })
    .addOperation(new Contract(contractId).call(method, ...args))
    .setTimeout(30)
    .build();
  const sim = await soroban.simulateTransaction(tx);
  if (!rpc.Api.isSimulationSuccess(sim) || !sim.result) throw new Error(`simulation failed: ${method}`);
  return scValToNative(sim.result.retval) as T;
}

/** Build, simulate/prepare, sign (wallet) and submit a contract call. */
export async function invokeContract(
  pubkey: string,
  sign: (xdr: string) => Promise<string>,
  contractId: string,
  method: string,
  args: xdr.ScVal[],
) {
  const source = await soroban.getAccount(pubkey);
  const tx = new TransactionBuilder(source, { fee: BASE_FEE, networkPassphrase: NETWORK_PASSPHRASE })
    .addOperation(new Contract(contractId).call(method, ...args))
    .setTimeout(180)
    .build();
  const prepared = await soroban.prepareTransaction(tx);
  const signed = await sign(prepared.toXDR());
  const sent = await soroban.sendTransaction(TransactionBuilder.fromXDR(signed, NETWORK_PASSPHRASE));
  if (sent.status === "ERROR") throw new Error("transaction rejected by RPC");
  for (let i = 0; i < 30; i++) {
    const r = await soroban.getTransaction(sent.hash);
    if (r.status === rpc.Api.GetTransactionStatus.SUCCESS) return { hash: sent.hash, result: r.returnValue ? scValToNative(r.returnValue) : null };
    if (r.status === rpc.Api.GetTransactionStatus.FAILED) throw new Error(`transaction failed: ${sent.hash}`);
    await new Promise((res) => setTimeout(res, 1000));
  }
  throw new Error(`timed out waiting for ${sent.hash}`);
}
