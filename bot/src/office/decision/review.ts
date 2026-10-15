/** Nightly review: reads the decision journal (JSONL), scores calibration on resolved decisions, writes a report. Never edits config. */
import { brier, reliability } from "./calibrate.js";
import type { DecisionLog } from "./engine.js";

export interface ReviewReport {
  generatedAt: number; window: { from: number; to: number };
  decisions: number; resolved: number; fired: number; firedWins: number; netPnl: number;
  brier: number; brierClimatology: number; baseRate: number; reliability: ReturnType<typeof reliability>;
  gateFailures: Record<string, number>; notes: string[]; autoDeploy: false;
}

export function review(rows: DecisionLog[], now: number, windowSec = 86400): ReviewReport {
  const w = rows.filter((r) => r.t > now - windowSec && r.t <= now);
  const res = w.filter((r) => r.direction !== "flat" && typeof r.win === "boolean");
  const p = res.map((r) => r.confidence), y = res.map((r) => !!r.win);
  const base = y.filter(Boolean).length / Math.max(1, y.length);
  const fired = w.filter((r) => r.fired);
  const gf: Record<string, number> = {};
  for (const r of w) for (const f of r.failed) gf[f.split(" ")[0]] = (gf[f.split(" ")[0]] ?? 0) + 1;
  const b = brier(p, y), clim = base * (1 - base);
  const notes: string[] = [];
  if (res.length < 30) notes.push(`only ${res.length} resolved decisions — calibration not meaningful yet`);
  else if (b > clim) notes.push(`Brier ${b.toFixed(3)} is worse than always predicting the base rate (${clim.toFixed(3)}) — confidence is not informative`);
  const hi = res.filter((r) => r.confidence > 0.8);
  if (hi.length >= 10) {
    const hr = hi.filter((r) => r.win).length / hi.length;
    if (hr < 0.7) notes.push(`decisions with confidence > 0.80 won only ${(hr * 100).toFixed(0)}% — over-confident`);
  }
  notes.push("report only: no parameter or config change is applied automatically");
  return { generatedAt: now, window: { from: now - windowSec, to: now }, decisions: w.length, resolved: res.length, fired: fired.length, firedWins: fired.filter((r) => (r.netPnl ?? 0) > 0).length,
    netPnl: fired.reduce((a, r) => a + (r.netPnl ?? 0), 0), brier: b, brierClimatology: clim, baseRate: base, reliability: reliability(p, y), gateFailures: gf, notes, autoDeploy: false };
}
