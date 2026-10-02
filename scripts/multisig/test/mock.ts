// Mock RPC / Horizon for offline tests (throwaway keys only).
import { Account, Address, Keypair, Networks, SorobanDataBuilder, rpc, xdr, nativeToScVal } from "@stellar/stellar-sdk";
import type { AdminRpc } from "../lib/build.ts";
import type { AccountState } from "../lib/multisig.ts";

export const PASS = Networks.TESTNET;
export const randomContract = () => Address.contract(Keypair.random().rawPublicKey()).toString();

export interface MockOpts {
  passphrase?: string;
  auth?: "source" | "address" | "none";
  error?: string;
  retval?: xdr.ScVal;
  views?: Record<string, unknown>;
  wasm?: Buffer;
}

function authEntry(kind: "source" | "address", contractId: string, fn: string): string {
  const credentials =
    kind === "source"
      ? xdr.SorobanCredentials.sorobanCredentialsSourceAccount()
      : xdr.SorobanCredentials.sorobanCredentialsAddress(
          new xdr.SorobanAddressCredentials({
            address: Address.fromString(Keypair.random().publicKey()).toScAddress(),
            nonce: xdr.Int64.fromString("1"),
            signatureExpirationLedger: 100,
            signature: xdr.ScVal.scvVoid(),
          }),
        );
  return new xdr.SorobanAuthorizationEntry({
    credentials,
    rootInvocation: new xdr.SorobanAuthorizedInvocation({
      function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
        new xdr.InvokeContractArgs({ contractAddress: Address.fromString(contractId).toScAddress(), functionName: fn, args: [] }),
      ),
      subInvocations: [],
    }),
  }).toXDR("base64");
}

export function mockRpc(o: MockOpts = {}): AdminRpc & { calls: string[] } {
  const seqs = new Map<string, string>();
  const calls: string[] = [];
  return {
    calls,
    async getNetwork() {
      return { passphrase: o.passphrase ?? PASS };
    },
    async getAccount(id: string) {
      if (!seqs.has(id)) seqs.set(id, "4294967296");
      return new Account(id, seqs.get(id)!);
    },
    async getContractWasmByContractId() {
      if (!o.wasm) throw new Error("no wasm in mock");
      return o.wasm;
    },
    async simulateTransaction(tx: any) {
      const op = JSON.parse(JSON.stringify(tx.toEnvelope())).tx.tx.operations[0];
      const ic = op.body.invoke_host_function.host_function.invoke_contract;
      calls.push(ic.function_name);
      if (o.views && ic.function_name in o.views) {
        const v = o.views[ic.function_name];
        return rpc.parseRawSimulation({
          id: "1", latestLedger: 10, minResourceFee: "100",
          transactionData: new SorobanDataBuilder().build().toXDR("base64"),
          results: [{ auth: [], xdr: (v === null ? xdr.ScVal.scvVoid() : nativeToScVal(v)).toXDR("base64") }],
        } as any);
      }
      if (o.error) return rpc.parseRawSimulation({ id: "1", latestLedger: 10, error: o.error } as any);
      const data = new SorobanDataBuilder().setResourceFee(12345).setResources(1000, 200, 100).build();
      return rpc.parseRawSimulation({
        id: "1",
        latestLedger: 10,
        minResourceFee: "12345",
        transactionData: data.toXDR("base64"),
        results: [{ auth: o.auth === "none" ? [] : [authEntry(o.auth ?? "source", ic.contract_address, ic.function_name)], xdr: (o.retval ?? xdr.ScVal.scvVoid()).toXDR("base64") }],
      } as any);
    },
  };
}

export function freshState(id: string, over: Partial<AccountState> = {}): AccountState {
  return { id, balanceStroops: 100_000_000n, subentries: 0, numSponsoring: 0, numSponsored: 0, masterWeight: 1, signers: [], thresholds: { low: 0, med: 0, high: 0 }, ...over };
}

export function mockHorizon(states: Record<string, AccountState>, seq = "100") {
  return {
    async account(id: string) {
      return states[id] ? { sequence: seq, state: states[id] } : null;
    },
    async baseReserveStroops() {
      return 5_000_000n;
    },
  };
}
