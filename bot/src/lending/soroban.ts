/** Soroban RPC adapter for the lending pool + mock oracle (TESTNET ONLY). */
import { Account, Address, BASE_FEE, Contract, Keypair, Networks, TransactionBuilder, nativeToScVal, rpc, scValToNative, xdr } from "@stellar/stellar-sdk";
import { assertSourceOnlyAuth } from "../authGuard.js";
import type { Account as Acct, LendingVenue, LiquidationPlan, Position, ReserveInfo } from "./keeper.js";

export const assetStellar = (sac: string) => xdr.ScVal.scvVec([nativeToScVal("Stellar", { type: "symbol" }), new Address(sac).toScVal()]);
const i128 = (v: bigint) => nativeToScVal(v, { type: "i128" });
const u32 = (v: number) => nativeToScVal(v, { type: "u32" });

export class SorobanClient {
  readonly server: rpc.Server;
  constructor(readonly rpcUrl: string, readonly kp: Keypair) {
    this.server = new rpc.Server(rpcUrl);
  }
  async assertTestnet() {
    const n = await this.server.getNetwork();
    if (n.passphrase !== Networks.TESTNET) throw new Error(`RPC is not TESTNET (${n.passphrase}); refusing to run`);
    return true;
  }
  async read<T>(contractId: string, method: string, args: xdr.ScVal[] = []): Promise<T> {
    const tx = new TransactionBuilder(new Account(this.kp.publicKey(), "0"), { fee: BASE_FEE, networkPassphrase: Networks.TESTNET })
      .addOperation(new Contract(contractId).call(method, ...args))
      .setTimeout(30)
      .build();
    const sim = await this.server.simulateTransaction(tx);
    if (!rpc.Api.isSimulationSuccess(sim) || !sim.result) throw new Error(`simulate ${method} failed${"error" in sim ? `: ${String(sim.error).split("\n")[0]}` : ""}`);
    return scValToNative(sim.result.retval) as T;
  }
  async write<T>(contractId: string, method: string, args: xdr.ScVal[]): Promise<T> {
    const source = await this.server.getAccount(this.kp.publicKey());
    const tx = new TransactionBuilder(source, { fee: String(Number(BASE_FEE) * 10), networkPassphrase: Networks.TESTNET })
      .addOperation(new Contract(contractId).call(method, ...args))
      .setTimeout(120)
      .build();
    const sim = await this.server.simulateTransaction(tx);
    if (!rpc.Api.isSimulationSuccess(sim)) throw new Error(`${method}: simulation failed${"error" in sim ? ` (${String(sim.error).split("\n")[0]})` : ""}`);
    assertSourceOnlyAuth(method, sim.result?.auth);
    const prepared = rpc.assembleTransaction(tx, sim).build();
    prepared.sign(this.kp);
    const sent = await this.server.sendTransaction(prepared);
    if (sent.status === "ERROR") throw new Error(`${method}: rejected by RPC`);
    const res = await this.server.pollTransaction(sent.hash, { attempts: 40 });
    if (res.status !== rpc.Api.GetTransactionStatus.SUCCESS) throw new Error(`${method}: ${res.status} (${sent.hash})`);
    return (res.returnValue ? scValToNative(res.returnValue) : null) as T;
  }
}

/** Push a batch of USD prices (oracle integers) to the mock oracle (admin key). */
export async function pushPrices(c: SorobanClient, oracleId: string, prices: Array<{ sac: string; price: bigint }>, batch = 25) {
  for (let i = 0; i < prices.length; i += batch) {
    const chunk = prices.slice(i, i + batch);
    const vec = xdr.ScVal.scvVec(chunk.map((p) => xdr.ScVal.scvVec([assetStellar(p.sac), i128(p.price)])));
    await c.write(oracleId, "set_prices", [vec, nativeToScVal(0n, { type: "u64" })]);
  }
}

type RawReserve = { asset: string; config: { decimals: number; collateral_enabled: boolean }; state: { cash: bigint } };

export class SorobanLending implements LendingVenue {
  private codes = new Map<string, string>();
  constructor(readonly c: SorobanClient, readonly poolId: string, readonly oracleId: string, codes: Record<string, string> = {}) {
    for (const [sac, code] of Object.entries(codes)) this.codes.set(sac, code);
  }
  borrowerCount() {
    return this.c.read<number>(this.poolId, "borrower_count").then(Number);
  }
  borrowersPage(start: number, limit: number) {
    return this.c.read<string[]>(this.poolId, "borrowers_page", [u32(start), u32(limit)]);
  }
  async account(user: string): Promise<Acct> {
    const a = await this.c.read<{ health_factor: bigint; debt_usd: bigint; collateral_usd: bigint }>(this.poolId, "account", [new Address(user).toScVal()]);
    return { healthFactor: BigInt(a.health_factor), debtUsd: BigInt(a.debt_usd), collateralUsd: BigInt(a.collateral_usd) };
  }
  async positions(user: string): Promise<Position[]> {
    const ps = await this.c.read<Array<{ asset: string; supplied: bigint; borrowed: bigint; collateral: boolean }>>(this.poolId, "user_positions", [new Address(user).toScVal()]);
    return ps.map((p) => ({ asset: p.asset, supplied: BigInt(p.supplied), borrowed: BigInt(p.borrowed), collateral: p.collateral }));
  }
  async reserves(): Promise<Map<string, ReserveInfo>> {
    const out = new Map<string, ReserveInfo>();
    for (let s = 0; ; s += 20) {
      const page = await this.c.read<RawReserve[]>(this.poolId, "reserves_page", [u32(s), u32(20)]);
      for (const r of page) {
        let price = 0n;
        try {
          const pd = await this.c.read<{ price: bigint } | null>(this.oracleId, "lastprice", [assetStellar(r.asset)]);
          price = pd ? BigInt(pd.price) : 0n;
        } catch {
          /* unpriced */
        }
        out.set(r.asset, { asset: r.asset, code: this.codes.get(r.asset) ?? r.asset.slice(0, 6), price, decimals: Number(r.config.decimals), cash: BigInt(r.state.cash), collateralEnabled: r.config.collateral_enabled });
      }
      if (page.length < 20) break;
    }
    return out;
  }
  async closeFactorBps() {
    const c = await this.c.read<{ close_factor_bps: number }>(this.poolId, "pool_config");
    return Number(c.close_factor_bps);
  }
  async balances(assets: string[]) {
    const out = new Map<string, bigint>();
    for (const a of assets) {
      try {
        out.set(a, BigInt(await this.c.read<bigint>(a, "balance", [new Address(this.c.kp.publicKey()).toScVal()])));
      } catch {
        out.set(a, 0n);
      }
    }
    return out;
  }
  async liquidate(p: LiquidationPlan): Promise<[bigint, bigint]> {
    const r = await this.c.write<[bigint, bigint]>(this.poolId, "liquidate", [
      new Address(this.c.kp.publicKey()).toScVal(), new Address(p.borrower).toScVal(), new Address(p.debtAsset).toScVal(),
      new Address(p.collateralAsset).toScVal(), i128(p.repay), nativeToScVal(p.receiveShares),
    ]);
    return [BigInt(r[0]), BigInt(r[1])];
  }
}
