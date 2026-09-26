/**
 * Live venue: talks to the deployed Quasaria leverage vault + oracle on
 * Stellar TESTNET via Soroban RPC. The bot signs with an *operator* key that
 * the owner delegated with `vault.set_operator` (it can trade, not withdraw).
 */
import { Account, Address, BASE_FEE, Contract, Keypair, Networks, TransactionBuilder, nativeToScVal, rpc, scValToNative, xdr } from "@stellar/stellar-sdk";
import type { KeeperVault, OpenRequest, TradingVenue } from "./exchange.js";
import type { Position } from "./types.js";

const UNIT = 10_000_000; // 7-decimal collateral token
const toI128 = (v: number) => nativeToScVal(BigInt(Math.round(v * UNIT)), { type: "i128" });
const assetOther = (code: string) => xdr.ScVal.scvVec([nativeToScVal("Other", { type: "symbol" }), nativeToScVal(code, { type: "symbol" })]);

export interface LiveOptions {
  rpcUrl: string;
  vaultId: string;
  oracleId: string;
  secret: string;
  owner?: string;
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
    const prepared = await this.server.prepareTransaction(tx);
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
    const pd = await this.read<{ price: bigint; timestamp: bigint } | null>(this.o.oracleId, "lastprice", [assetOther(asset)]);
    if (!pd) throw new Error(`oracle has no price for ${asset}`);
    return Number(pd.price) / 10 ** this.oracleDecimals;
  }

  async maintenanceMarginBps() {
    const c = await this.read<{ maintenance_margin_bps: number }>(this.o.vaultId, "config");
    return c.maintenance_margin_bps;
  }

  async open(req: OpenRequest): Promise<Position> {
    const id = await this.write<bigint>("open_position", [
      new Address(this.kp.publicKey()).toScVal(), new Address(req.owner).toScVal(), assetOther(req.asset),
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

  async openPositionIds() {
    return (await this.read<bigint[]>(this.o.vaultId, "open_position_ids")).map(Number);
  }

  async position(id: number): Promise<Position> {
    const p = await this.read<{
      id: bigint; owner: string; asset: [string, string]; is_long: boolean; margin: bigint; size: bigint;
      entry_price: bigint; opened_at: bigint; stop_loss: bigint; take_profit: bigint;
    }>(this.o.vaultId, "position", [nativeToScVal(BigInt(id), { type: "u64" })]);
    const d = 10 ** (this.oracleDecimals ?? 14);
    return {
      id: Number(p.id), owner: p.owner, asset: String(p.asset[1]), side: p.is_long ? "long" : "short",
      margin: Number(p.margin) / UNIT, size: Number(p.size) / UNIT, entryPrice: Number(p.entry_price) / d,
      openedAt: Number(p.opened_at), stopLoss: Number(p.stop_loss) / d, takeProfit: Number(p.take_profit) / d,
    };
  }

  async liquidate(id: number) {
    return Number(await this.write<bigint>("liquidate", [new Address(this.kp.publicKey()).toScVal(), nativeToScVal(BigInt(id), { type: "u64" })])) / UNIT;
  }

  async executeTrigger(id: number) {
    return Number(await this.write<bigint>("execute_trigger", [nativeToScVal(BigInt(id), { type: "u64" })])) / UNIT;
  }
}
