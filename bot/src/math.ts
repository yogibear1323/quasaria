/** Mirrors contracts/leverage-vault math (floating point, for decisions/previews). */
import type { Position, Side } from "./types.js";

export const MM_BPS = 500; // maintenance margin 5% of notional (vault default)
export const OPEN_FEE_BPS = 10;
export const LIQ_BONUS_BPS = 500;

export const pnl = (side: Side, size: number, entry: number, price: number) =>
  (size * (side === "long" ? price - entry : entry - price)) / entry;

export function healthFactor(p: Pick<Position, "side" | "size" | "entryPrice" | "margin">, price: number, mmBps = MM_BPS) {
  const equity = p.margin + pnl(p.side, p.size, p.entryPrice, price);
  if (equity <= 0) return 0;
  return equity / ((p.size * mmBps) / 10_000);
}

export function liquidationPrice(side: Side, margin: number, size: number, entry: number, mmBps = MM_BPS) {
  const maint = (size * mmBps) / 10_000;
  const delta = ((margin - maint) * entry) / size;
  return side === "long" ? entry - delta : entry + delta;
}

/** Convert % SL/TP to absolute trigger prices for a new position. */
export function triggerPrices(side: Side, entry: number, stopLossPct: number, takeProfitPct: number) {
  const dir = side === "long" ? 1 : -1;
  return {
    stopLoss: entry * (1 - (dir * stopLossPct) / 100),
    takeProfit: entry * (1 + (dir * takeProfitPct) / 100),
  };
}

export function triggerHit(p: Pick<Position, "side" | "stopLoss" | "takeProfit">, price: number): "stop_loss" | "take_profit" | null {
  const long = p.side === "long";
  if (p.stopLoss > 0 && (long ? price <= p.stopLoss : price >= p.stopLoss)) return "stop_loss";
  if (p.takeProfit > 0 && (long ? price >= p.takeProfit : price <= p.takeProfit)) return "take_profit";
  return null;
}
