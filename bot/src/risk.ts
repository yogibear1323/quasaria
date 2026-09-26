import type { BotConfig } from "./config.js";
import type { Action } from "./types.js";

/** Pre-trade risk checks + daily-loss kill switch. */
export class RiskManager {
  private day = -1;
  private realizedToday = 0;
  private halted = false;

  constructor(private readonly risk: BotConfig["risk"], private readonly startingEquity: number) {}

  private roll(time: number) {
    const d = Math.floor(time / 86_400);
    if (d !== this.day) {
      this.day = d;
      this.realizedToday = 0;
      this.halted = false;
    }
  }

  recordRealized(pnl: number, time: number) {
    this.roll(time);
    this.realizedToday += pnl;
    if (-this.realizedToday >= (this.startingEquity * this.risk.maxDailyLossPct) / 100) this.halted = true;
  }

  isHalted(time: number) {
    this.roll(time);
    return this.halted;
  }

  /** Returns null if allowed, otherwise a rejection reason. Closes are always allowed. */
  check(action: Action, openPositions: number, time: number): string | null {
    if (action.kind === "close") return null;
    this.roll(time);
    if (this.halted) return `daily loss limit ${this.risk.maxDailyLossPct}% reached — new entries halted until next UTC day`;
    if (action.leverage > this.risk.maxLeverage) return `leverage ${action.leverage}x exceeds cap ${this.risk.maxLeverage}x`;
    if (action.leverage < 1) return "leverage must be >= 1x";
    if (openPositions >= this.risk.maxOpenPositions) return `max open positions (${this.risk.maxOpenPositions}) reached`;
    if (action.margin <= 0) return "margin must be positive";
    return null;
  }
}
