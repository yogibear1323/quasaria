/**
 * Live venue: talks to the deployed Quasaria leverage vault + oracle on
 * Stellar TESTNET via Soroban RPC. The bot signs with an *operator* key that
 * the owner delegated with `vault.set_operator` (it can trade, not withdraw).
 */
import { Account, Address, BASE_FEE, Contract, Keypair, Networks, TransactionBuilder, nativeToScVal, rpc, scValToNative, xdr } from "@stellar/stellar-sdk";
import { assertSourceOnlyAuth } from "./authGuard.js";
import type { KeeperVault, OpenRequest, TradingVenue } from "./exchange.js";
import type { Position } from "./types.js";

const UNIT = 10_000_000; // 7-decimal collateral token
const toI128 = (v: number) => nativeToScVal(BigInt(Math.round(v * UNIT)), { type: "i128" });
const assetOther = (code: string) => xdr.ScVal.scvVec([nativeToScVal("Other", { type: "symbol" }), nativeToScVal(code, { type: "symbol" })]);

/** Vault/oracle market key: `{ Stellar: "C…token" }` (perps-v1 XLM market) or `{ Other: "XLM" }` (legacy). */
export type MarketAsset = { Stellar: string } | { Other: string };
export function assetScVal(a: MarketAsset): xdr.ScVal {
  return "Stellar" in a
    ? xdr.ScVal.scvVec([nativeToScVal("Stellar", { type: "symbol" }), new Address(a.Stellar).toScVal()])
    : assetOther(a.Other);
}
/** Market key for a ticker: an explicit mapping (e.g. XLM -> deployments vault.marketAsset) wins over the legacy Other(code). */
export const marketKeyFor = (code: string, markets: Record<string, MarketAsset> = {}) => assetScVal(markets[code] ?? { Other: code });

export interface LiveOptions {
  rpcUrl: string;
  vaultId: string;
  oracleId: string;
  secret: string;
  owner?: string;
  /** ticker -> on-chain market key; perps-v1 keys XLM by its token address (deployments vault.marketAsset). */
  markets?: Record<string, MarketAsset>;
}

export class SorobanVault implements TradingVenue, KeeperVault {
  private readonly server: rpc.Server;
  private readonly kp: Keypair;
  private oracleDecimals: number | null = null;

  constructor(private readonly o: LiveOptions) {
    this.server = new rpc.Server(o.rpcUrl);
    this.kp = Keypair.fromSecret(o.secret);
  }

  /** Refuse to run unless the RPC is actually testnet. */
  async assertTestnet() {
    const n = await this.server.getNetwork();
    if (n.passphrase !== Networks.TESTNET) throw new Error(`RPC is not TESTNET (${n.passphrase}); refusing to run`);
  }

  private async read<T>(contractId: string, method: string, args: xdr.ScVal[] = []): Promise<T> {
    const tx = new TransactionBuilder(new Account(this.kp.publicKey(), "0"), { fee: BASE_FEE, networkPassphrase: Networks.TESTNET })
      .addOperation(new Contract(contractId).call(method, ...args))
      .setTimeout(30)
      .build();
    const sim = await this.server.simulateTransaction(tx);
    if (!rpc.Api.isSimulationSuccess(sim) || !sim.result) throw new Error(`simulate ${method} failed`);
    return scValToNative(sim.result.retval) as T;
  }

  private async write<T>(method: string, args: xdr.ScVal[]): Promise<T> {
    const source = await this.server.getAccount(this.kp.publicKey());
    const tx = new TransactionBuilder(source, { fee: BASE_FEE, networkPassphrase: Networks.TESTNET })
      .addOperation(new Contract(this.o.vaultId).call(method, ...args))
      .setTimeout(120)
      .build();
    // Instruction leeway: time-dependent contract math can cost slightly more on-chain than simulated.
    const sim = await this.server.simulateTransaction(tx, { cpuInstructions: 1_000_000 });
    if (!rpc.Api.isSimulationSuccess(sim)) throw new Error(`${method}: simulation failed${"error" in sim ? ` (${sim.error})` : ""}`);
    assertSourceOnlyAuth(method, sim.result?.auth);
    const prepared = rpc.assembleTransaction(tx, sim).build();
    prepared.sign(this.kp);
    const sent = await this.server.sendTransaction(prepared);
    if (sent.status === "ERROR") throw new Error(`${method}: rejected by RPC`);
    const res = await this.server.pollTransaction(sent.hash, { attempts: 30 });
    if (res.status !== rpc.Api.GetTransactionStatus.SUCCESS) throw new Error(`${method}: ${res.status} (${sent.hash})`);
    return (res.returnValue ? scValToNative(res.returnValue) : null) as T;
  }

  private get owner() {
    return this.o.owner ?? this.kp.publicKey();
  }

  async price(asset: string) {
    if (this.oracleDecimals === null) this.oracleDecimals = await this.read<number>(this.o.oracleId, "decimals");
    const pd = await this.read<{ price: bigint; timestamp: bigint } | null>(this.o.oracleId, "lastprice", [marketKeyFor(asset, this.o.markets)]);
    if (!pd) throw new Error(`oracle has no price for ${asset}`);
    return Number(pd.price) / 10 ** this.oracleDecimals;
  }

  async maintenanceMarginBps() {
    const c = await this.read<{ maintenance_margin_bps: number }>(this.o.vaultId, "config");
    return c.maintenance_margin_bps;
  }

  async open(req: OpenRequest): Promise<Position> {
    const id = await this.write<bigint>("open_position", [
      new Address(this.kp.publicKey()).toScVal(), new Address(req.owner).toScVal(), marketKeyFor(req.asset, this.o.markets),
      nativeToScVal(req.side === "long"), toI128(req.margin), nativeToScVal(Math.round(req.leverage * 10_000), { type: "u32" }),
    ]);
    return { ...(await this.position(Number(id))), strategyId: req.strategyId };
  }

  async setTriggers(id: number, stopLoss: number, takeProfit: number) {
    const d = 10 ** (this.oracleDecimals ?? 14);
    await this.write("set_triggers", [
      new Address(this.kp.publicKey()).toScVal(), nativeToScVal(BigInt(id), { type: "u64" }),
      nativeToScVal(BigInt(Math.round(stopLoss * d)), { type: "i128" }), nativeToScVal(BigInt(Math.round(takeProfit * d)), { type: "i128" }),
    ]);
  }

  async close(id: number) {
    const before = await this.position(id);
    const payout = Number(await this.write<bigint>("close_position", [new Address(this.kp.publicKey()).toScVal(), nativeToScVal(BigInt(id), { type: "u64" })])) / UNIT;
    return { payout, pnl: payout - before.margin };
  }

  async positions(owner: string) {
    const ids = await this.read<bigint[]>(this.o.vaultId, "user_positions", [new Address(owner || this.owner).toScVal()]);
    return Promise.all(ids.map((i) => this.position(Number(i))));
  }

  /** All open position ids, paged (the vault keeps a bounded, paginated index). */
  async openPositionIds() {
    const PAGE = 100; // vault MAX_PAGE
    const count = Number(await this.read<number>(this.o.vaultId, "open_position_count"));
    const ids: number[] = [];
    for (let start = 0; start < count; start += PAGE) {
      const page = await this.read<bigint[]>(this.o.vaultId, "open_position_ids_page", [
        nativeToScVal(start, { type: "u32" }), nativeToScVal(PAGE, { type: "u32" }),
      ]);
      ids.push(...page.map(Number));
      if (page.length < PAGE) break;
    }
    return ids;
  }

  async position(id: number): Promise<Position> {
    const p = await this.read<{
      id: bigint; owner: string; asset: [string, string]; is_long: boolean; margin: bigint; size: bigint;
      entry_price: bigint; opened_at: bigint; stop_loss: bigint; take_profit: bigint;
    }>(this.o.vaultId, "position", [nativeToScVal(BigInt(id), { type: "u64" })]);
    const d = 10 ** (this.oracleDecimals ?? 14);
    return {
      id: Number(p.id), owner: p.owner, asset: this.tickerOf(p.asset), side: p.is_long ? "long" : "short",
      margin: Number(p.margin) / UNIT, size: Number(p.size) / UNIT, entryPrice: Number(p.entry_price) / d,
      openedAt: Number(p.opened_at), stopLoss: Number(p.stop_loss) / d, takeProfit: Number(p.take_profit) / d,
    };
  }

  /** Decoded Asset enum (["Stellar", "C…"] | ["Other", "XLM"]) -> ticker used by strategies. */
  private tickerOf(a: [string, string]) {
    if (a[0] === "Stellar") {
      const hit = Object.entries(this.o.markets ?? {}).find(([, m]) => "Stellar" in m && m.Stellar === String(a[1]));
      return hit ? hit[0] : String(a[1]);
    }
    return String(a[1]);
  }

  async liquidate(id: number) {
    return Number(await this.write<bigint>("liquidate", [new Address(this.kp.publicKey()).toScVal(), nativeToScVal(BigInt(id), { type: "u64" })])) / UNIT;
  }

  async executeTrigger(id: number) {
    return Number(await this.write<bigint>("execute_trigger", [nativeToScVal(BigInt(id), { type: "u64" })])) / UNIT;
  }
}
