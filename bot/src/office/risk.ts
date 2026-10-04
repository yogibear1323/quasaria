/** Per-desk and floor-wide risk gates (pure). Numbers come from LimitsConfig (scope §6, owner-approved defaults). */
import type { ChainPosition, LimitsConfig, Side } from "./types.js";

export interface DeskRiskState {
  equity: number;
  dayStartEquity: number;
  peakEquity: number;
  lossStreak: number;
  pausedUntil: number;
  entryTimes: number[]; // unix s
}
export interface OpenRisk {
  side: Side;
  size: number;
  price: number; // current price
  stop: number; // 0 if unset -> treated as full margin at risk
  margin: number;
}

/** QUSD at risk if the stop is hit now (>= 0). */
export function riskToStop(p: OpenRisk) {
  if (!(p.stop > 0)) return p.margin;
  const d = p.side === "long" ? (p.price - p.stop) / p.price : (p.stop - p.price) / p.price;
  return Math.max(0, d) * p.size;
}

export const dailyLossPct = (s: DeskRiskState) => (s.dayStartEquity > 0 ? Math.max(0, ((s.dayStartEquity - s.equity) / s.dayStartEquity) * 100) : 0);
export const drawdownPct = (s: DeskRiskState) => (s.peakEquity > 0 ? Math.max(0, ((s.peakEquity - s.equity) / s.peakEquity) * 100) : 0);

export type DeskVerdict = { action: "ok" } | { action: "block"; reason: string } | { action: "pause"; reason: string; until: number } | { action: "halt"; reason: string };

/** Desk-level checks before a new entry. Halt = flatten + manual reset. */
export function deskGate(s: DeskRiskState, open: number, L: LimitsConfig, now: number): DeskVerdict {
  if (drawdownPct(s) >= L.deskDrawdownPct) return { action: "halt", reason: `desk drawdown ${drawdownPct(s).toFixed(2)}% >= ${L.deskDrawdownPct}%` };
  if (dailyLossPct(s) >= L.deskDailyLossPct) return { action: "block", reason: `daily loss ${dailyLossPct(s).toFixed(2)}% >= ${L.deskDailyLossPct}% — entries stop until 00:00 UTC` };
  if (s.lossStreak >= L.lossStreak) return { action: "pause", reason: `${s.lossStreak} losses in a row`, until: now + L.lossStreakPauseSec };
  if (s.pausedUntil > now) return { action: "block", reason: `paused until ${new Date(s.pausedUntil * 1000).toISOString()}` };
  const today = s.entryTimes.filter((t) => t > now - 86_400).length;
  if (today >= L.entriesPerDeskDay) return { action: "block", reason: `${today} entries in 24 h (cap ${L.entriesPerDeskDay})` };
  if (open >= L.maxOpenPerDesk) return { action: "block", reason: `max ${L.maxOpenPerDesk} open positions` };
  return { action: "ok" };
}

/** Skip entries on the paying side when funding is expensive (funding desks only enter on the receiving side anyway). */
export function fundingGuard(side: Side, hourly: number, L: LimitsConfig): string | null {
  const pays = side === "long" ? hourly : -hourly;
  return pays > L.fundingGuardHourly ? `${side} pays ${(pays * 100).toFixed(4)}%/h > ${(L.fundingGuardHourly * 100).toFixed(3)}%/h` : null;
}

export interface FleetState {
  equity: number;
  dayStartEquity: number;
  peakEquity: number;
  entryTimes: number[];
  open: OpenRisk[];
  reserve: number;
}
export type FleetVerdict = { action: "ok"; riskBudget: number; notionalBudget: number } | { action: "block"; reason: string } | { action: "pause"; reason: string } | { action: "kill"; reason: string };

export function fleetLevel(f: FleetState, L: LimitsConfig): { action: "ok" } | { action: "pause"; reason: string } | { action: "kill"; reason: string } {
  const dd = f.peakEquity > 0 ? ((f.peakEquity - f.equity) / f.peakEquity) * 100 : 0;
  if (dd >= L.fleetDrawdownPct) return { action: "kill", reason: `fleet drawdown ${dd.toFixed(2)}% >= ${L.fleetDrawdownPct}%` };
  const dl = f.dayStartEquity > 0 ? ((f.dayStartEquity - f.equity) / f.dayStartEquity) * 100 : 0;
  if (dl >= L.fleetDailyLossPct) return { action: "pause", reason: `fleet daily loss ${dl.toFixed(2)}% >= ${L.fleetDailyLossPct}% — all entries stop until 00:00 UTC` };
  return { action: "ok" };
}

/** Floor-wide gate for a new entry on `side`; returns remaining risk + notional budgets for sizing. */
export function fleetGate(f: FleetState, side: Side, L: LimitsConfig, now: number): FleetVerdict {
  const lvl = fleetLevel(f, L);
  if (lvl.action !== "ok") return lvl;
  const today = f.entryTimes.filter((t) => t > now - 86_400).length;
  if (today >= L.entriesPerFleetDay) return { action: "block", reason: `fleet ${today} entries in 24 h (cap ${L.entriesPerFleetDay})` };
  const total = f.open.reduce((a, p) => a + riskToStop(p), 0);
  const same = f.open.filter((p) => p.side === side).reduce((a, p) => a + riskToStop(p), 0);
  const riskBudget = Math.min((f.equity * L.fleetOpenRiskPct) / 100 - total, (f.equity * L.fleetSameDirRiskPct) / 100 - same);
  if (riskBudget <= 0) return { action: "block", reason: `fleet risk cap reached (open ${total.toFixed(2)}, ${side} ${same.toFixed(2)} QUSD)` };
  const gross = f.open.reduce((a, p) => a + p.size, 0);
  const netDir = f.open.reduce((a, p) => a + (p.side === side ? p.size : -p.size), 0);
  const grossCap = Math.min(L.fleetGrossNotionalX * f.equity, L.fleetReserveFrac * f.reserve);
  const notionalBudget = Math.min(grossCap - gross, L.fleetNetNotionalX * f.equity - netDir);
  if (notionalBudget <= 0) return { action: "block", reason: `fleet notional cap reached (gross ${gross.toFixed(0)} / cap ${grossCap.toFixed(0)})` };
  return { action: "ok", riskBudget, notionalBudget };
}

export const toOpenRisk = (p: ChainPosition, price: number): OpenRisk => ({ side: p.side, size: p.size, price, stop: p.stopLoss, margin: p.margin });
