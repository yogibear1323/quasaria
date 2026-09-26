import { healthFactor, LIQ_BONUS_BPS, MM_BPS, OPEN_FEE_BPS, pnl, triggerHit } from "./math.js";
import type { Position, Side } from "./types.js";

export interface OpenRequest {
  owner: string;
  asset: string;
  side: Side;
  margin: number;
  leverage: number;
  strategyId?: string;
}

/** What the strategy engine needs from a venue. */
export interface TradingVenue {
  price(asset: string): Promise<number>;
  open(req: OpenRequest): Promise<Position>;
  setTriggers(id: number, stopLoss: number, takeProfit: number): Promise<void>;
  close(id: number, reason: string): Promise<{ pnl: number; payout: number }>;
  positions(owner: string): Promise<Position[]>;
}

/** What the keeper needs from the vault. */
export interface KeeperVault {
  price(asset: string): Promise<number>;
  openPositionIds(): Promise<number[]>;
  position(id: number): Promise<Position>;
  liquidate(id: number): Promise<number>;
  executeTrigger(id: number): Promise<number>;
  maintenanceMarginBps(): Promise<number>;
}

export class VaultError extends Error {}

/**
 * In-memory simulation of contracts/leverage-vault (same fee, PnL, reserve
 * cap, health factor and liquidation rules). Used for paper trading + tests.
 */
export class PaperVault implements TradingVenue, KeeperVault {
  private nextId = 1;
  private readonly pos = new Map<number, Position>();
  private readonly free = new Map<string, number>();
  private prices = new Map<string, number>();
  liquidity: number;
  now = Math.floor(Date.now() / 1000);

  constructor(opts: { liquidity: number; maxLeverage?: number; mmBps?: number } = { liquidity: 100_000 }) {
    this.liquidity = opts.liquidity;
    this.maxLeverage = opts.maxLeverage ?? 10;
    this.mmBps = opts.mmBps ?? MM_BPS;
  }
  private readonly maxLeverage: number;
  private readonly mmBps: number;

  setPrice(asset: string, p: number) {
    this.prices.set(asset, p);
  }
  deposit(owner: string, amount: number) {
    this.free.set(owner, this.freeCollateral(owner) + amount);
  }
  freeCollateral(owner: string) {
    return this.free.get(owner) ?? 0;
  }

  async price(asset: string) {
    const p = this.prices.get(asset);
    if (!p) throw new VaultError(`no price for ${asset}`);
    return p;
  }
  async maintenanceMarginBps() {
    return this.mmBps;
  }

  async open(req: OpenRequest): Promise<Position> {
    if (req.leverage < 1) throw new VaultError("LeverageTooLow");
    if (req.leverage > this.maxLeverage) throw new VaultError("LeverageTooHigh");
    const size = req.margin * req.leverage;
    const fee = (size * OPEN_FEE_BPS) / 10_000;
    const free = this.freeCollateral(req.owner);
    if (free < req.margin + fee) throw new VaultError("InsufficientCollateral");
    this.free.set(req.owner, free - req.margin - fee);
    this.liquidity += fee;
    const p: Position = {
      id: this.nextId++, owner: req.owner, asset: req.asset, side: req.side, margin: req.margin, size,
      entryPrice: await this.price(req.asset), openedAt: this.now, stopLoss: 0, takeProfit: 0, strategyId: req.strategyId,
    };
    this.pos.set(p.id, p);
    return { ...p };
  }

  async setTriggers(id: number, stopLoss: number, takeProfit: number) {
    const p = this.get(id);
    p.stopLoss = stopLoss;
    p.takeProfit = takeProfit;
  }

  private get(id: number) {
    const p = this.pos.get(id);
    if (!p) throw new VaultError("PositionNotFound");
    return p;
  }

  private settle(p: Position, price: number) {
    const v = pnl(p.side, p.size, p.entryPrice, price);
    let payout: number;
    if (v >= 0) {
      const profit = Math.min(v, this.liquidity);
      this.liquidity -= profit;
      payout = p.margin + profit;
    } else {
      const loss = Math.min(-v, p.margin);
      this.liquidity += loss;
      payout = p.margin - loss;
    }
    this.free.set(p.owner, this.freeCollateral(p.owner) + payout);
    this.pos.delete(p.id);
    return { pnl: payout - p.margin, payout };
  }

  async close(id: number) {
    const p = this.get(id);
    return this.settle(p, await this.price(p.asset));
  }

  async positions(owner: string) {
    return [...this.pos.values()].filter((p) => p.owner === owner).map((p) => ({ ...p }));
  }
  async openPositionIds() {
    return [...this.pos.keys()];
  }
  async position(id: number) {
    return { ...this.get(id) };
  }

  async executeTrigger(id: number) {
    const p = this.get(id);
    const price = await this.price(p.asset);
    if (!triggerHit(p, price)) throw new VaultError("TriggerNotHit");
    return this.settle(p, price).payout;
  }

  /** Returns liquidator bonus. */
  async liquidate(id: number) {
    const p = this.get(id);
    const price = await this.price(p.asset);
    if (healthFactor(p, price, this.mmBps) >= 1) throw new VaultError("Healthy");
    const equity = Math.max(0, p.margin + pnl(p.side, p.size, p.entryPrice, price));
    const bonus = Math.min(equity, (p.margin * LIQ_BONUS_BPS) / 10_000);
    this.liquidity += p.margin - equity;
    if (equity - bonus > 0) this.free.set(p.owner, this.freeCollateral(p.owner) + equity - bonus);
    this.pos.delete(id);
    return bonus;
  }
}
