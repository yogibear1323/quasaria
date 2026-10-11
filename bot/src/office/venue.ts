/** Venue abstraction for the fleet: live Soroban testnet (per-desk operator keys) or an in-memory paper venue. */
import { Account, Address, BASE_FEE, Contract, Keypair, Networks, TransactionBuilder, nativeToScVal, rpc, scValToNative, xdr } from "@stellar/stellar-sdk";
import { assertSourceOnlyAuth } from "../authGuard.js";
import { assetScVal, type MarketAsset } from "../soroban.js";
import type { ChainPosition, Side } from "./types.js";

export const UNIT = 10_000_000;
export const RATE_SCALE = 1e12;

export interface DeskKeys {
  owner: string; // G… (holds collateral, never used by the runner to sign)
  operatorSecret: string; // S… delegated via set_operator (can trade, cannot withdraw)
}
export interface VaultMarket {
  oraclePrice: number;
  oracleTs: number;
  reserve: number;
  longOi: number;
  shortOi: number;
  mmBps: number;
  minMargin: number;
  openFeeBps: number;
  funding: { k: number; skewScale: number; maxPremium: number; capPerHour: number; interestPerInterval: number; interval: number; premiumTwap: number; premium: number };
  paused?: boolean;
}
export interface CloseEvent {
  id: number;
  exitPrice: number;
  pnl: number;
  payout: number;
  reason: string;
  txHash: string;
  ledger: number;
}
export interface TxResult<T> {
  value: T;
  hash: string;
}
export interface OfficeVenue {
  readonly kind: "live" | "paper";
  market(): Promise<VaultMarket>;
  desk(owner: string): Promise<{ free: number; positions: ChainPosition[] }>;
  open(k: DeskKeys, side: Side, margin: number, leverageBps: number): Promise<TxResult<{ id: number; entry: number }>>;
  setTriggers(k: DeskKeys, id: number, stopLoss: number, takeProfit: number): Promise<TxResult<null>>;
  close(k: DeskKeys, id: number): Promise<TxResult<{ payout: number }>>;
  executeTrigger(k: DeskKeys, id: number): Promise<TxResult<{ payout: number }>>;
  closeEvents(owner: string): Promise<CloseEvent[]>;
  /** fresh on-chain oracle timestamp (stale-data breaker pre-order check); cheaper than market() */
  oracleTs?(): Promise<number>;
}

const u64 = (n: number) => nativeToScVal(BigInt(n), { type: "u64" });
const i128 = (n: bigint) => nativeToScVal(n, { type: "i128" });

export class SorobanOfficeVenue implements OfficeVenue {
  readonly kind = "live" as const;
  private readonly server: rpc.Server;
  private readonly market_: xdr.ScVal;
  private readonly readSource = Keypair.random().publicKey();
  private decimals = 14;
  private readonly eventCursor = new Map<string, { startLedger: number }>();

  constructor(private readonly o: { rpcUrl: string; vaultId: string; oracleId: string; marketAsset: MarketAsset }) {
    this.server = new rpc.Server(o.rpcUrl);
    this.market_ = assetScVal(o.marketAsset);
  }

  async assertTestnet() {
    const n = await this.server.getNetwork();
    if (n.passphrase !== Networks.TESTNET) throw new Error(`RPC is not TESTNET (${n.passphrase}); refusing to run`);
    this.decimals = Number(await this.read(this.o.oracleId, "decimals"));
  }

  async read<T = unknown>(contractId: string, method: string, args: xdr.ScVal[] = []): Promise<T> {
    const tx = new TransactionBuilder(new Account(this.readSource, "0"), { fee: BASE_FEE, networkPassphrase: Networks.TESTNET })
      .addOperation(new Contract(contractId).call(method, ...args))
      .setTimeout(30)
      .build();
    const sim = await this.server.simulateTransaction(tx);
    if (!rpc.Api.isSimulationSuccess(sim) || !sim.result) throw new Error(`simulate ${method} failed${"error" in sim ? `: ${String(sim.error).slice(0, 160)}` : ""}`);
    return scValToNative(sim.result.retval) as T;
  }

  private async write<T>(secret: string, method: string, args: xdr.ScVal[]): Promise<TxResult<T>> {
    const kp = Keypair.fromSecret(secret);
    const source = await this.server.getAccount(kp.publicKey());
    const tx = new TransactionBuilder(source, { fee: "10000", networkPassphrase: Networks.TESTNET })
      .addOperation(new Contract(this.o.vaultId).call(method, ...args))
      .setTimeout(120)
      .build();
    const sim = await this.server.simulateTransaction(tx, { cpuInstructions: 1_000_000 });
    if (!rpc.Api.isSimulationSuccess(sim)) throw new Error(`${method}: simulation failed${"error" in sim ? ` (${String(sim.error).slice(0, 200)})` : ""}`);
    assertSourceOnlyAuth(method, sim.result?.auth);
    const prepared = rpc.assembleTransaction(tx, sim).build();
    prepared.sign(kp);
    const sent = await this.server.sendTransaction(prepared);
    if (sent.status === "ERROR") throw new Error(`${method}: rejected by RPC (${sent.hash})`);
    const res = await this.server.pollTransaction(sent.hash, { attempts: 40 });
    if (res.status !== rpc.Api.GetTransactionStatus.SUCCESS) throw new Error(`${method}: ${res.status} (${sent.hash})`);
    return { value: (res.returnValue ? scValToNative(res.returnValue) : null) as T, hash: sent.hash };
  }

  private px(v: bigint | number) {
    return Number(v) / 10 ** this.decimals;
  }

  async oracleTs(): Promise<number> {
    const pd = await this.read<{ price: bigint; timestamp: bigint } | null>(this.o.oracleId, "lastprice", [this.market_]);
    if (!pd) throw new Error("oracle has no price for the market");
    return Number(pd.timestamp);
  }

  async market(): Promise<VaultMarket> {
    const [pd, liq, cfg, fc, fs] = await Promise.all([
      this.read<{ price: bigint; timestamp: bigint } | null>(this.o.oracleId, "lastprice", [this.market_]),
      this.read<bigint>(this.o.vaultId, "liquidity"),
      this.read<Record<string, bigint | number>>(this.o.vaultId, "config"),
      this.read<Record<string, bigint | number>>(this.o.vaultId, "funding_config", [this.market_]),
      this.read<Record<string, bigint | number>>(this.o.vaultId, "funding_state", [this.market_]),
    ]);
    if (!pd) throw new Error("oracle has no price for the market");
    const now = Date.now() / 1000;
    const acc = Number(fs.premium_acc) + Number(fs.premium) * Math.max(0, now - Number(fs.last_sample_ts));
    const elapsed = Math.max(0, now - Number(fs.acc_start));
    return {
      oraclePrice: this.px(pd.price),
      oracleTs: Number(pd.timestamp),
      reserve: Number(liq) / UNIT,
      longOi: Number(fs.long_oi) / UNIT,
      shortOi: Number(fs.short_oi) / UNIT,
      mmBps: Number(cfg.maintenance_margin_bps),
      minMargin: Number(cfg.min_margin) / UNIT,
      openFeeBps: Number(cfg.open_fee_bps),
      funding: {
        k: Number(fc.k) / RATE_SCALE,
        skewScale: Number(fc.skew_scale) / UNIT,
        maxPremium: Number(fc.max_premium) / RATE_SCALE,
        capPerHour: Number(fc.max_funding_rate_per_hour) / RATE_SCALE,
        interestPerInterval: Number(fc.interest_per_interval) / RATE_SCALE,
        interval: Number(fc.interval),
        premium: Number(fs.premium) / RATE_SCALE,
        premiumTwap: (elapsed > 0 ? acc / elapsed : Number(fs.premium)) / RATE_SCALE,
      },
    };
  }

  async desk(owner: string) {
    const addr = new Address(owner).toScVal();
    const [free, ids] = await Promise.all([this.read<bigint>(this.o.vaultId, "free_collateral", [addr]), this.read<bigint[]>(this.o.vaultId, "user_positions", [addr])]);
    const positions = await Promise.all(ids.map((i) => this.position(Number(i))));
    return { free: Number(free) / UNIT, positions };
  }

  async position(id: number): Promise<ChainPosition> {
    const [p, pf] = await Promise.all([
      this.read<{ id: bigint; is_long: boolean; margin: bigint; size: bigint; entry_price: bigint; opened_at: bigint; stop_loss: bigint; take_profit: bigint }>(this.o.vaultId, "position", [u64(id)]),
      this.read<bigint>(this.o.vaultId, "pending_funding", [u64(id)]).catch(() => 0n),
    ]);
    return {
      id: Number(p.id), side: p.is_long ? "long" : "short", margin: Number(p.margin) / UNIT, size: Number(p.size) / UNIT,
      entry: this.px(p.entry_price), openedAt: Number(p.opened_at), stopLoss: this.px(p.stop_loss), takeProfit: this.px(p.take_profit),
      pendingFunding: Number(pf) / UNIT,
    };
  }

  private op(k: DeskKeys) {
    return new Address(Keypair.fromSecret(k.operatorSecret).publicKey()).toScVal();
  }

  async open(k: DeskKeys, side: Side, margin: number, leverageBps: number) {
    const r = await this.write<bigint>(k.operatorSecret, "open_position", [
      this.op(k), new Address(k.owner).toScVal(), this.market_, nativeToScVal(side === "long"),
      i128(BigInt(Math.floor(margin * UNIT))), nativeToScVal(leverageBps, { type: "u32" }),
    ]);
    const pos = await this.position(Number(r.value));
    return { value: { id: pos.id, entry: pos.entry }, hash: r.hash };
  }

  async setTriggers(k: DeskKeys, id: number, sl: number, tp: number) {
    const d = 10 ** this.decimals;
    return this.write<null>(k.operatorSecret, "set_triggers", [this.op(k), u64(id), i128(BigInt(Math.round(sl * d))), i128(BigInt(Math.round(tp * d)))]);
  }

  async close(k: DeskKeys, id: number) {
    const r = await this.write<bigint>(k.operatorSecret, "close_position", [this.op(k), u64(id)]);
    return { value: { payout: Number(r.value) / UNIT }, hash: r.hash };
  }

  async executeTrigger(k: DeskKeys, id: number) {
    const r = await this.write<bigint>(k.operatorSecret, "execute_trigger", [u64(id)]);
    return { value: { payout: Number(r.value) / UNIT }, hash: r.hash };
  }

  /** pos_close events for `owner` (since the last call; first call looks back ~1 day). */
  async closeEvents(owner: string): Promise<CloseEvent[]> {
    const latest = await this.server.getLatestLedger();
    const cur = this.eventCursor.get(owner);
    const start = cur ? cur.startLedger : Math.max(1, latest.sequence - 17_000);
    const topics = [[xdr.ScVal.scvSymbol("pos_close").toXDR("base64"), new Address(owner).toScVal().toXDR("base64")]];
    const out: CloseEvent[] = [];
    let r = await this.server.getEvents({ startLedger: start, filters: [{ type: "contract", contractIds: [this.o.vaultId], topics }], limit: 200 });
    for (let guard = 0; guard < 20; guard++) {
      for (const e of r.events) {
        const v = scValToNative(e.value) as Record<string, bigint | string>;
        out.push({ id: Number(v.id), exitPrice: this.px(v.exit_price as bigint), pnl: Number(v.pnl) / UNIT, payout: Number(v.payout) / UNIT, reason: String(v.reason), txHash: e.txHash, ledger: e.ledger });
      }
      if (r.events.length < 200) break;
      r = await this.server.getEvents({ cursor: r.cursor, filters: [{ type: "contract", contractIds: [this.o.vaultId], topics }], limit: 200 });
    }
    // overlap one ledger window so nothing is missed; consumers dedupe by id
    this.eventCursor.set(owner, { startLedger: Math.max(1, latest.sequence - 50) });
    return out;
  }
}

/** In-memory venue with the vault's open/close/trigger/fee rules (paper trading + tests). */
export class PaperOfficeVenue implements OfficeVenue {
  readonly kind = "paper" as const;
  price = 0.2;
  priceTs = Math.floor(Date.now() / 1000);
  reserve = 10_000;
  fundingHourly = 0;
  /** OI from traders outside the fleet (drives external skew in tests) */
  externalLong = 0;
  externalShort = 0;
  failNext = 0;
  private nextId = 1;
  private hashN = 0;
  readonly free = new Map<string, number>();
  readonly positions = new Map<number, ChainPosition & { owner: string }>();
  readonly closed: (CloseEvent & { owner: string })[] = [];
  constructor(public cfg = { mmBps: 500, minMargin: 10, openFeeBps: 10 }) {}

  private hash() {
    return `paper-${(++this.hashN).toString().padStart(6, "0")}`;
  }
  private maybeFail(m: string) {
    if (this.failNext > 0) {
      this.failNext--;
      throw new Error(`${m}: simulated failure`);
    }
  }
  async oracleTs() {
    return this.priceTs;
  }
  deposit(owner: string, amount: number) {
    this.free.set(owner, (this.free.get(owner) ?? 0) + amount);
  }
  async market(): Promise<VaultMarket> {
    let longOi = this.externalLong, shortOi = this.externalShort;
    for (const p of this.positions.values()) p.side === "long" ? (longOi += p.size) : (shortOi += p.size);
    return {
      oraclePrice: this.price, oracleTs: this.priceTs, reserve: this.reserve, longOi, shortOi, ...this.cfg,
      funding: { k: 0.0005, skewScale: 250_000, maxPremium: 0.0005, capPerHour: 0.0005, interestPerInterval: 0, interval: 3600, premium: this.fundingHourly, premiumTwap: this.fundingHourly },
    };
  }
  async desk(owner: string) {
    return { free: this.free.get(owner) ?? 0, positions: [...this.positions.values()].filter((p) => p.owner === owner).map(({ owner: _o, ...p }) => ({ ...p })) };
  }
  async open(k: DeskKeys, side: Side, margin: number, leverageBps: number) {
    this.maybeFail("open_position");
    const size = (margin * leverageBps) / 10_000;
    const fee = (size * this.cfg.openFeeBps) / 10_000;
    const free = this.free.get(k.owner) ?? 0;
    if (margin < this.cfg.minMargin) throw new Error("open_position: MarginTooLow");
    if (free < margin + fee) throw new Error("open_position: InsufficientCollateral");
    this.free.set(k.owner, free - margin - fee);
    const id = this.nextId++;
    this.positions.set(id, { id, owner: k.owner, side, margin, size, entry: this.price, openedAt: this.priceTs, stopLoss: 0, takeProfit: 0, pendingFunding: 0 });
    return { value: { id, entry: this.price }, hash: this.hash() };
  }
  async setTriggers(_k: DeskKeys, id: number, sl: number, tp: number) {
    this.maybeFail("set_triggers");
    const p = this.positions.get(id);
    if (!p) throw new Error("PositionNotFound");
    p.stopLoss = sl;
    p.takeProfit = tp;
    return { value: null, hash: this.hash() };
  }
  private settle(id: number, reason: string) {
    const p = this.positions.get(id);
    if (!p) throw new Error("PositionNotFound");
    const raw = ((p.side === "long" ? this.price - p.entry : p.entry - this.price) / p.entry) * p.size - p.pendingFunding;
    const pnl = raw >= 0 ? Math.min(raw, this.reserve) : Math.max(raw, -p.margin);
    this.reserve -= pnl;
    const payout = p.margin + pnl;
    this.free.set(p.owner, (this.free.get(p.owner) ?? 0) + payout);
    this.positions.delete(id);
    const hash = this.hash();
    this.closed.push({ owner: p.owner, id, exitPrice: this.price, pnl, payout, reason, txHash: hash, ledger: this.hashN });
    return { value: { payout }, hash };
  }
  async close(_k: DeskKeys, id: number) {
    this.maybeFail("close_position");
    return this.settle(id, "user");
  }
  async executeTrigger(_k: DeskKeys, id: number) {
    const p = this.positions.get(id);
    if (!p) throw new Error("PositionNotFound");
    const sl = p.stopLoss > 0 && (p.side === "long" ? this.price <= p.stopLoss : this.price >= p.stopLoss);
    const tp = p.takeProfit > 0 && (p.side === "long" ? this.price >= p.takeProfit : this.price <= p.takeProfit);
    if (!sl && !tp) throw new Error("TriggerNotHit");
    return this.settle(id, sl ? "stop_loss" : "take_profit");
  }
  /** Simulate a third party (keeper) closing a position — reconciliation must pick it up from events. */
  externalTrigger(id: number, reason = "stop_loss") {
    return this.settle(id, reason);
  }
  async closeEvents(owner: string) {
    return this.closed.filter((c) => c.owner === owner).map(({ owner: _o, ...c }) => c);
  }
}
