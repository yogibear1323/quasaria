/** Platt calibration (logistic on the raw score, per regime with a pooled fallback) + Brier / reliability. */
import type { Regime } from "./schema.js";

export interface Platt { a: number; b: number; n: number }
export interface Calibrator { pooled: Platt; byRegime: Partial<Record<Regime, Platt>>; trainedOn: { from: number; to: number; n: number } }

const sig = (x: number) => 1 / (1 + Math.exp(-x));
export function fitPlatt(x: number[], y: boolean[], iters = 400): Platt {
  let a = 0, b = 0;
  const n = x.length;
  if (!n) return { a: 0, b: -10, n: 0 }; // no data => ~0 confidence
  // Platt targets (avoid over-confidence on small samples)
  const np = y.filter((v) => v).length, nn = n - np;
  const tp = (np + 1) / (np + 2), tn = 1 / (nn + 2);
  const t = y.map((v) => (v ? tp : tn));
  for (let k = 0; k < iters; k++) {
    let ga = 0, gb = 0, haa = 0, hab = 0, hbb = 0;
    for (let i = 0; i < n; i++) {
      const p = sig(a * x[i] + b), d = p - t[i], w = Math.max(1e-9, p * (1 - p));
      ga += d * x[i]; gb += d; haa += w * x[i] * x[i]; hab += w * x[i]; hbb += w;
    }
    haa += 1e-6; hbb += 1e-6;
    const det = haa * hbb - hab * hab;
    if (Math.abs(det) < 1e-12) break;
    const da = (hbb * ga - hab * gb) / det, db = (haa * gb - hab * ga) / det;
    a -= da; b -= db;
    if (Math.abs(da) + Math.abs(db) < 1e-9) break;
  }
  return { a, b, n };
}
export const applyPlatt = (p: Platt, raw: number) => sig(p.a * raw + p.b);

export function fitCalibrator(rows: { raw: number; regime: Regime; win: boolean; t: number }[], minPerRegime = 150): Calibrator {
  const pooled = fitPlatt(rows.map((r) => r.raw), rows.map((r) => r.win));
  const byRegime: Partial<Record<Regime, Platt>> = {};
  for (const g of ["trending", "mean_reverting", "high_vol", "crisis"] as Regime[]) {
    const rs = rows.filter((r) => r.regime === g);
    if (rs.length >= minPerRegime) byRegime[g] = fitPlatt(rs.map((r) => r.raw), rs.map((r) => r.win));
  }
  return { pooled, byRegime, trainedOn: { from: rows[0]?.t ?? 0, to: rows[rows.length - 1]?.t ?? 0, n: rows.length } };
}
export const calibrateWith = (c: Calibrator) => (raw: number, regime: Regime) => applyPlatt(c.byRegime[regime] ?? c.pooled, raw);

export function brier(p: number[], y: boolean[]) {
  return p.length ? p.reduce((a, x, i) => a + (x - (y[i] ? 1 : 0)) ** 2, 0) / p.length : NaN;
}
export interface Bucket { lo: number; hi: number; n: number; meanP: number; hitRate: number }
export function reliability(p: number[], y: boolean[], bins = 10): Bucket[] {
  const out: Bucket[] = [];
  for (let k = 0; k < bins; k++) {
    const lo = k / bins, hi = (k + 1) / bins;
    const idx = p.map((_x, i) => i).filter((i) => p[i] >= lo && (p[i] < hi || (k === bins - 1 && p[i] <= 1)));
    if (!idx.length) continue;
    out.push({ lo, hi, n: idx.length, meanP: idx.reduce((a, i) => a + p[i], 0) / idx.length, hitRate: idx.filter((i) => y[i]).length / idx.length });
  }
  return out;
}
