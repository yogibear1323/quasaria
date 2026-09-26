import type { MomentumConfig } from "../config.js";
import { ema } from "../indicators.js";
import type { Action, Strategy, StrategyContext } from "../types.js";

/**
 * EMA crossover momentum. Long mode: enter when fast EMA crosses above slow,
 * exit when it crosses back below. Short mode is the mirror image.
 */
export class MomentumStrategy implements Strategy {
  readonly id: string;
  private readonly prices: number[] = [];
  private prevDiff: number | null = null;

  constructor(private readonly cfg: MomentumConfig) {
    this.id = cfg.id;
  }

  onTick({ tick, positions }: StrategyContext): Action[] {
    this.prices.push(tick.price);
    if (this.prices.length > this.cfg.slowPeriod * 5) this.prices.shift();
    const f = ema(this.prices, this.cfg.fastPeriod);
    const s = ema(this.prices, this.cfg.slowPeriod);
    if (f === null || s === null) return [];
    const diff = f - s;
    const prev = this.prevDiff;
    this.prevDiff = diff;
    if (prev === null) return [];
    const long = this.cfg.side === "long";
    const bullCross = prev <= 0 && diff > 0;
    const bearCross = prev >= 0 && diff < 0;
    const enter = long ? bullCross : bearCross;
    const exit = long ? bearCross : bullCross;
    if (exit && positions.length) return positions.map((p) => ({ kind: "close" as const, positionId: p.id, reason: "momentum reversal" }));
    if (enter && positions.length === 0)
      return [{
        kind: "open", strategyId: this.id, asset: this.cfg.asset, side: this.cfg.side, margin: this.cfg.margin,
        leverage: this.cfg.leverage, stopLossPct: this.cfg.stopLossPct, takeProfitPct: this.cfg.takeProfitPct,
        reason: `ema${this.cfg.fastPeriod} ${long ? "above" : "below"} ema${this.cfg.slowPeriod}`,
      }];
    return [];
  }
}
