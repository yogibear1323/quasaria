/**
 * Hard risk layer (code-only; the proposer cannot see or change it). Every check can only BLOCK or SHRINK.
 * Combines: own limits (15 % max drawdown kill, max position, max daily loss, armed kill switch),
 * the existing stale-data breaker (allowOrder) and the existing desk gate (risk.ts). When a desk has
 * stricter existing limits (e.g. Orion's tiny live slice), the stricter number wins.
 */
import { type DeskRiskState, deskGate, drawdownPct, dailyLossPct } from "../risk.js";
import { allowOrder, type StaleBreakerState } from "../staleBreaker.js";
import type { LimitsConfig } from "../types.js";

export interface HardLimits {
  maxDrawdownPct: number; // 15
  maxDailyLossPct: number; // 3
  maxPositionX: number; // notional cap as multiple of equity
  riskCapPct: number; // max % equity at risk per trade
  killSwitchArmed: boolean;
  /** extra absolute caps from an existing desk (Orion live slice): stricter wins */
  usd?: { dailyLoss?: number; killDrawdown?: number; maxOpen?: number };
}
export const DEFAULT_HARD: HardLimits = { maxDrawdownPct: 15, maxDailyLossPct: 3, maxPositionX: 1.5, riskCapPct: 1, killSwitchArmed: true };

/** Merge with the fleet LimitsConfig and a desk's riskPct: every field takes the stricter value. */
export function hardLimitsFor(L: LimitsConfig, deskRiskPct: number, usd?: HardLimits["usd"]): HardLimits {
  return {
    maxDrawdownPct: Math.min(DEFAULT_HARD.maxDrawdownPct, L.deskDrawdownPct),
    maxDailyLossPct: Math.min(DEFAULT_HARD.maxDailyLossPct, L.deskDailyLossPct),
    maxPositionX: Math.min(DEFAULT_HARD.maxPositionX, L.maxNotionalX),
    riskCapPct: Math.min(DEFAULT_HARD.riskCapPct, deskRiskPct, L.hardMaxRiskPct),
    killSwitchArmed: true,
    usd,
  };
}

export interface RiskCtx {
  desk: DeskRiskState;
  startEquity: number;
  open: number;
  now: number;
  killFlag: boolean; // global KILL file / fleet.killed
  breaker?: StaleBreakerState;
  L?: LimitsConfig; // when present, the existing desk gate also runs
}
export type HardVerdict = { ok: true; riskCapPct: number; maxNotional: number } | { ok: false; level: "block" | "kill"; reason: string };

export function hardCheck(h: HardLimits, c: RiskCtx): HardVerdict {
  if (h.killSwitchArmed && c.killFlag) return { ok: false, level: "kill", reason: "kill switch engaged" };
  const dd = drawdownPct(c.desk);
  if (dd >= h.maxDrawdownPct) return { ok: false, level: "kill", reason: `drawdown ${dd.toFixed(2)}% >= ${h.maxDrawdownPct}%` };
  if (h.usd?.killDrawdown !== undefined && c.startEquity - c.desk.equity >= h.usd.killDrawdown) return { ok: false, level: "kill", reason: `loss ${(c.startEquity - c.desk.equity).toFixed(2)} >= ${h.usd.killDrawdown} USD` };
  const dl = dailyLossPct(c.desk);
  if (dl >= h.maxDailyLossPct) return { ok: false, level: "block", reason: `daily loss ${dl.toFixed(2)}% >= ${h.maxDailyLossPct}%` };
  if (h.usd?.dailyLoss !== undefined && c.desk.dayStartEquity - c.desk.equity >= h.usd.dailyLoss) return { ok: false, level: "block", reason: `daily loss >= ${h.usd.dailyLoss} USD` };
  if (h.usd?.maxOpen !== undefined && c.open >= h.usd.maxOpen) return { ok: false, level: "block", reason: `max ${h.usd.maxOpen} open` };
  if (c.breaker) {
    const a = allowOrder(c.breaker, "entry");
    if (!a.ok) return { ok: false, level: "block", reason: `stale-data breaker: ${a.reason}` };
  }
  if (c.L) {
    const v = deskGate(c.desk, c.open, c.L, c.now);
    if (v.action === "halt") return { ok: false, level: "kill", reason: v.reason };
    if (v.action !== "ok") return { ok: false, level: "block", reason: v.reason };
  }
  return { ok: true, riskCapPct: h.riskCapPct, maxNotional: h.maxPositionX * c.desk.equity };
}

/** Fractional Kelly from calibrated p and payoff b; quarter-Kelly max; never above the hard risk cap. */
export function kellyRiskPct(p: number, b: number, fraction: number, capPct: number) {
  const k = p - (1 - p) / b;
  if (!(k > 0)) return 0;
  return Math.max(0, Math.min(Math.min(fraction, 0.25) * k * 100, capPct));
}
