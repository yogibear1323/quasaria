import type { GridConfig } from "../config.js";
import type { Action, Strategy, StrategyContext } from "../types.js";

/**
 * Leveraged grid: split [lower, upper] into `levels` lines. For a long grid,
 * each time price crosses DOWN through a level with no open position at that
 * level, open one; close it when price rises one grid step above its entry.
 * (Mirror image for short grids.) Price outside the band = no new orders.
 */
export class GridStrategy implements Strategy {
  readonly id: string;
  private lastPrice: number | null = null;
  private readonly lines: number[];
  private readonly step: number;
  /** positionId -> level index */
  private readonly levelOf = new Map<number, number>();
  private readonly pendingLevels = new Set<number>();

  constructor(private readonly cfg: GridConfig) {
    this.id = cfg.id;
    this.step = (cfg.upper - cfg.lower) / (cfg.levels - 1);
    this.lines = Array.from({ length: cfg.levels }, (_, i) => cfg.lower + i * this.step);
  }

  gridLines() {
    return [...this.lines];
  }

  /** Engine callback so the strategy can map fills to levels. */
  onOpened(positionId: number, entryPrice: number) {
    const idx = this.nearestLevel(entryPrice);
    this.levelOf.set(positionId, idx);
    this.pendingLevels.delete(idx);
  }

  private nearestLevel(price: number) {
    let best = 0;
    for (let i = 1; i < this.lines.length; i++) if (Math.abs(this.lines[i] - price) < Math.abs(this.lines[best] - price)) best = i;
    return best;
  }

  onTick({ tick, positions }: StrategyContext): Action[] {
    const out: Action[] = [];
    const prev = this.lastPrice;
    this.lastPrice = tick.price;
    const long = this.cfg.side === "long";

    // exits: one grid step in our favour
    for (const p of positions) {
      const target = long ? p.entryPrice + this.step : p.entryPrice - this.step;
      if (long ? tick.price >= target : tick.price <= target) {
        out.push({ kind: "close", positionId: p.id, reason: "grid take-step" });
        this.levelOf.delete(p.id);
      }
    }
    if (prev === null) return out;
    const occupied = new Set([...positions.map((p) => this.levelOf.get(p.id)), ...this.pendingLevels]);
    this.lines.forEach((line, idx) => {
      const crossed = long ? prev > line && tick.price <= line : prev < line && tick.price >= line;
      if (crossed && !occupied.has(idx)) {
        this.pendingLevels.add(idx);
        out.push({
          kind: "open", strategyId: this.id, asset: this.cfg.asset, side: this.cfg.side, margin: this.cfg.margin,
          leverage: this.cfg.leverage, stopLossPct: this.cfg.stopLossPct, takeProfitPct: this.cfg.takeProfitPct,
          reason: `grid level ${idx} @ ${line.toFixed(6)}`,
        });
      }
    });
    return out;
  }
}
