import type { DcaConfig } from "../config.js";
import type { Action, Strategy, StrategyContext } from "../types.js";

/** Dollar-cost averaging: open a fixed-margin position every `intervalSec`, up to `maxOrders`. */
export class DcaStrategy implements Strategy {
  readonly id: string;
  private lastBuy: number | null = null;
  private orders = 0;

  constructor(private readonly cfg: DcaConfig) {
    this.id = cfg.id;
  }

  onTick({ tick }: StrategyContext): Action[] {
    if (this.orders >= this.cfg.maxOrders) return [];
    if (this.lastBuy !== null && tick.time - this.lastBuy < this.cfg.intervalSec) return [];
    this.lastBuy = tick.time;
    this.orders++;
    return [{
      kind: "open", strategyId: this.id, asset: this.cfg.asset, side: this.cfg.side, margin: this.cfg.margin,
      leverage: this.cfg.leverage, stopLossPct: this.cfg.stopLossPct, takeProfitPct: this.cfg.takeProfitPct,
      reason: `dca #${this.orders}`,
    }];
  }
}
