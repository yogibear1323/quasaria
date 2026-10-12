/**
 * Typed decision schema + the deterministic gate. The "model" (proposer) only fills a TradeDecision;
 * this file validates it and decides whether it may fire. Nothing here can raise a limit.
 */
import type { MarketState } from "./state.js";

export const REGIMES = ["trending", "mean_reverting", "high_vol", "crisis"] as const;
export type Regime = (typeof REGIMES)[number];
export type Direction = "long" | "short" | "flat";
export type RiskState = "safe" | "mean_limit" | "reduce";

export interface TradeDecision {
  t: number;
  regime: Regime;
  direction: Direction;
  setup_quality: 0 | 1 | 2 | 3;
  risk_state: RiskState;
  confidence: number; // calibrated P(win), 0..1
  raw: number; // un-calibrated score that confidence was mapped from
  why: string[];
}

export const GATE = { minSetup: 2, minConfidence: 0.8 } as const;

export function validateDecision(d: unknown): d is TradeDecision {
  const x = d as TradeDecision;
  return !!x && typeof x.t === "number" && (REGIMES as readonly string[]).includes(x.regime) && ["long", "short", "flat"].includes(x.direction) &&
    [0, 1, 2, 3].includes(x.setup_quality) && ["safe", "mean_limit", "reduce"].includes(x.risk_state) &&
    Number.isFinite(x.confidence) && x.confidence >= 0 && x.confidence <= 1;
}

export interface GateResult { fire: boolean; failed: string[] }
export function gate(d: TradeDecision, minConfidence: number = GATE.minConfidence): GateResult {
  const failed: string[] = [];
  if (!validateDecision(d)) return { fire: false, failed: ["invalid decision schema"] };
  if (d.direction === "flat") failed.push("direction flat");
  if (d.setup_quality < GATE.minSetup) failed.push(`setup_quality ${d.setup_quality} < ${GATE.minSetup}`);
  if (!(d.confidence > minConfidence)) failed.push(`confidence ${d.confidence.toFixed(3)} <= ${minConfidence}`);
  if (d.risk_state !== "safe") failed.push(`risk_state ${d.risk_state}`);
  if (d.regime === "crisis") failed.push("regime crisis");
  return { fire: failed.length === 0, failed };
}

/**
 * Risk state is derived in code, never chosen by the proposer.
 *   reduce     : drawdown >= 2/3 of the kill level (only exits / no new risk)
 *   mean_limit : a position is already open, or today's loss >= half the daily limit
 *   safe       : otherwise
 */
export function riskStateFor(s: MarketState, maxDdPct: number, hasPosition: boolean, dayLossPct = 0, maxDailyLossPct = Infinity): RiskState {
  if (s.drawdownPct >= maxDdPct * (2 / 3)) return "reduce";
  if (hasPosition || dayLossPct >= maxDailyLossPct / 2) return "mean_limit";
  return "safe";
}

/** Deterministic rule-based proposer. Returns the raw score; the calibrator maps it to confidence. */
export function propose(s: MarketState, risk: RiskState, calibrate: (raw: number, regime: Regime) => number): TradeDecision {
  const why: string[] = [];
  let regime: Regime;
  if (s.rvolPct >= 0.97) regime = "crisis";
  else if (s.rvolPct >= 0.85) regime = "high_vol";
  else if (s.er >= 0.3) regime = "trending";
  else regime = "mean_reverting";
  let dir = 0, strength = 0;
  if (regime === "trending") {
    dir = Math.sign(s.trend);
    strength = Math.min(1, Math.abs(s.trend) / 2) * 0.6 + Math.min(1, s.er) * 0.4;
    why.push(`trend ${s.trend.toFixed(2)} ATR, ER ${s.er.toFixed(2)}`);
  } else if (regime === "mean_reverting" && Math.abs(s.z) >= 1.5) {
    dir = -Math.sign(s.z);
    strength = Math.min(1, (Math.abs(s.z) - 1.5) / 1.5 + 0.3);
    why.push(`z ${s.z.toFixed(2)} fade`);
  } else why.push(regime === "mean_reverting" ? `z ${s.z.toFixed(2)} inside band` : `${regime}: stand aside`);
  const direction: Direction = dir > 0 ? "long" : dir < 0 ? "short" : "flat";
  let q = 0;
  if (direction !== "flat") {
    if (strength >= 0.5) q++;
    if (Math.sign(s.imbalance) === dir && Math.abs(s.imbalance) >= 0.1) q++, why.push(`imbalance ${s.imbalance.toFixed(2)} agrees`);
    if (s.spreadBps <= 15) q++;
  }
  const raw = direction === "flat" ? 0 : Math.max(0, Math.min(1, 0.5 * strength + 0.15 * q + 0.1 * Math.abs(s.imbalance)));
  return { t: s.t, regime, direction, setup_quality: q as 0 | 1 | 2 | 3, risk_state: risk, raw, confidence: direction === "flat" ? 0 : calibrate(raw, regime), why };
}
