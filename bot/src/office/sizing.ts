/** Stop-distance position sizing (pure). See back-office scope §4. */
export interface SizingInput {
  equity: number;
  riskPct: number;
  hardMaxRiskPct: number;
  entry: number;
  stop: number;
  maxLeverage: number;
  maxMarginPct: number;
  maxNotionalX: number;
  minMargin: number;
  feeBufferPct: number;
  mmBps: number;
  /** remaining risk budget from fleet caps (QUSD) */
  riskBudget?: number;
  /** remaining notional budget from fleet caps (QUSD) */
  notionalBudget?: number;
  freeCollateral?: number;
  openFeeBps?: number;
}
export type Sizing =
  | { ok: true; notional: number; margin: number; leverage: number; riskAmount: number; stopDistPct: number; leverageBps: number }
  | { ok: false; reason: string };

export function sizePosition(i: SizingInput): Sizing {
  if (!(i.equity > 0)) return { ok: false, reason: "no equity" };
  if (!(i.entry > 0) || !(i.stop > 0) || i.entry === i.stop) return { ok: false, reason: "invalid stop" };
  const stopDist = Math.abs(i.entry - i.stop) / i.entry;
  const eff = stopDist + i.feeBufferPct / 100;
  const riskPct = Math.min(i.riskPct, i.hardMaxRiskPct);
  let risk = (i.equity * riskPct) / 100;
  if (i.riskBudget !== undefined) risk = Math.min(risk, i.riskBudget);
  if (!(risk > 0)) return { ok: false, reason: "risk budget exhausted" };
  let notional = risk / eff;
  notional = Math.min(notional, i.maxNotionalX * i.equity);
  if (i.notionalBudget !== undefined) notional = Math.min(notional, i.notionalBudget);
  // the stop must sit inside half the liquidation distance: stopDist <= (1/lev - mm)/2
  const mm = i.mmBps / 10_000;
  const levByStop = 1 / (2 * stopDist + mm);
  const maxLev = Math.min(i.maxLeverage, levByStop);
  if (maxLev < 1) return { ok: false, reason: `stop ${(stopDist * 100).toFixed(2)}% too wide for 1× (liquidation rule)` };
  const marginCap = (i.equity * i.maxMarginPct) / 100;
  let lev = Math.max(1, notional / marginCap);
  if (lev > maxLev) {
    lev = maxLev;
    notional = Math.min(notional, marginCap * lev);
  }
  lev = Math.ceil(lev * 10) / 10;
  if (lev > maxLev) lev = Math.floor(maxLev * 10) / 10;
  if (lev < 1) lev = 1;
  let margin = notional / lev;
  if (margin < i.minMargin) {
    // raise margin to the vault floor at lower leverage (same notional, same risk)
    if (notional < i.minMargin) return { ok: false, reason: `notional ${notional.toFixed(2)} below vault min margin ${i.minMargin}` };
    margin = i.minMargin;
    lev = Math.floor((notional / margin) * 10) / 10;
    if (lev < 1) lev = 1;
    margin = notional / lev;
  }
  const fee = (notional * (i.openFeeBps ?? 0)) / 10_000;
  if (i.freeCollateral !== undefined && margin + fee > i.freeCollateral) return { ok: false, reason: "insufficient free collateral" };
  const riskAmount = notional * eff;
  return { ok: true, notional, margin, leverage: lev, riskAmount, stopDistPct: stopDist * 100, leverageBps: Math.round(lev * 10_000) };
}

/** Clamp a proposed stop into the allowed distance band [minPct, maxPct]; null if too wide. */
export function clampStop(side: "long" | "short", entry: number, stop: number, minPct: number, maxPct: number): number | null {
  const sign = side === "long" ? -1 : 1;
  let d = (sign * (stop - entry)) / entry; // positive distance
  if (!(d > 0)) d = minPct / 100;
  if (d < minPct / 100) d = minPct / 100;
  if (d > maxPct / 100) return null;
  return entry * (1 + sign * d);
}
