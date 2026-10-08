/**
 * Deterministic decision code (layer 3). The model advises; this code decides.
 *  - side from the direction question;
 *  - fire ONLY when every probability clears its threshold (setup, direction, regime, pressure, risk);
 *  - explicit weights combine the probabilities into a confidence score (display/ranking only);
 *  - sizing: capped fractional Kelly from the calibrated setup probability, quarter-Kelly max, zero below the cutoff,
 *    and only when calibration is verified — otherwise a fixed 0.5 % risk. Never above the desk's riskPct target
 *    (1 %) or the fleet hard cap (2 %): those caps are applied here AND again in sizing.ts.
 */
import type { CalibratedModel, Probabilities } from "./model.js";

export interface Decision {
  fire: boolean;
  side: "long" | "short";
  pSide: { setup: number; direction: number; pressure: number; regime: number; risk: number };
  score: number; // weighted combination, 0..1
  failed: string[]; // thresholds that were not cleared
  riskPct: number; // % of equity to risk if it fires (0 when not firing)
  sizing: "kelly" | "fixed" | "none";
}

export function decide(m: CalibratedModel, p: Probabilities, caps: { deskRiskPct: number; hardMaxRiskPct: number }): Decision {
  const side = p.direction >= 0.5 ? "long" : "short";
  const pSide = {
    setup: side === "long" ? p.setup_long : p.setup_short,
    direction: side === "long" ? p.direction : 1 - p.direction,
    pressure: side === "long" ? p.pressure : 1 - p.pressure,
    regime: p.regime,
    risk: p.risk,
  };
  const th = m.thresholds;
  const failed: string[] = [];
  if (pSide.setup < th.setup) failed.push(`setup ${pSide.setup.toFixed(2)} < ${th.setup}`);
  if (pSide.direction < th.direction) failed.push(`direction ${pSide.direction.toFixed(2)} < ${th.direction}`);
  if (pSide.regime < th.regime) failed.push(`regime ${pSide.regime.toFixed(2)} < ${th.regime}`);
  if (pSide.pressure < th.pressure) failed.push(`pressure ${pSide.pressure.toFixed(2)} < ${th.pressure}`);
  if (pSide.risk < th.risk) failed.push(`risk ${pSide.risk.toFixed(2)} < ${th.risk}`);
  const w = m.weights;
  const score = (w.setup * pSide.setup + w.direction * pSide.direction + w.pressure * pSide.pressure + w.regime * pSide.regime + w.risk * pSide.risk) / (w.setup + w.direction + w.pressure + w.regime + w.risk);
  const fire = failed.length === 0;
  const sz = fire ? riskPctFor(m, pSide.setup, caps) : { riskPct: 0, sizing: "none" as const };
  return { fire: fire && sz.riskPct > 0, side, pSide, score, failed: fire && sz.riskPct <= 0 ? ["kelly fraction <= 0"] : failed, riskPct: sz.riskPct, sizing: sz.sizing };
}

/** Risk % of equity. Kelly only if calibration is verified; quarter Kelly max; capped by desk target and hard cap. */
export function riskPctFor(m: CalibratedModel, pWin: number, caps: { deskRiskPct: number; hardMaxRiskPct: number }): { riskPct: number; sizing: "kelly" | "fixed" | "none" } {
  const cap = Math.min(caps.deskRiskPct, caps.hardMaxRiskPct, 2);
  if (!m.calibration.verified) return { riskPct: Math.min(m.sizing.fixedRiskPct, cap), sizing: "fixed" };
  if (!(pWin >= m.thresholds.setup)) return { riskPct: 0, sizing: "none" };
  const b = (m.geometry.tpAtr / m.geometry.slAtr) * 0.85; // payoff ratio net of ~costs (same as research)
  const kelly = pWin - (1 - pWin) / b;
  if (!(kelly > 0)) return { riskPct: 0, sizing: "none" };
  const frac = Math.min(m.sizing.kellyFraction, 0.25) * kelly * 100;
  return { riskPct: Math.max(0, Math.min(frac, m.sizing.kellyCapPct, cap)), sizing: "kelly" };
}
