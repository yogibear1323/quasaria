/**
 * State engine (layer 3 input): one compact, deterministic snapshot per CLOSED candle.
 *
 * No lookahead: `snapshotAt(bars, gran, decisionTs)` keeps only bars whose close time (t + gran) is <= decisionTs, i.e.
 * every input is timestamped strictly before the decision, then takes the last W of them. The feature math is an exact
 * port of research/quant/snapshot.py (parity fixture in test/fixtures/calibrated-parity.json).
 *
 * Live-only fields (L2 spread, order-book imbalance, funding) are recorded with each decision but are NOT model inputs:
 * they have no history, so they cannot be backtested.
 */
import type { Candle } from "../indicators.js";

export const W = 200;
export const FEATURES = ["r1z", "r3z", "r12z", "r48z", "volr", "trend1", "trend2", "er24", "rpos48", "bp6", "bp24", "volz", "rsi", "hlr"] as const;
export type Feature = (typeof FEATURES)[number];

export interface LiveExtras {
  spreadBps: number | null; // best ask - best bid, from the public L2 book at decision time
  bookImbalance: number | null; // (bid depth - ask depth) / total, within 0.5 % of mid
  fundingHourly: number | null; // vault funding estimate (fraction / h)
}
export interface Snapshot {
  decisionTs: number; // unix s; every input closed at or before this
  barT: number; // open time of the decision bar
  gran: number;
  price: number; // decision bar close
  atr: number; // Wilder ATR(14) in price units
  realizedVol: number; // stdev of 1-bar log returns, last 96 bars
  features: Record<Feature, number>;
  extras: LiveExtras;
}

function emaLast(v: number[], n: number) {
  const k = 2 / (n + 1);
  let e = 0;
  for (let i = 0; i < n; i++) e += v[i];
  e /= n;
  for (let i = n; i < v.length; i++) e = v[i] * k + e * (1 - k);
  return e;
}
function atrLast(b: Candle[], n = 14) {
  const tr = (i: number) => (i === 0 ? b[i].h - b[i].l : Math.max(b[i].h - b[i].l, Math.abs(b[i].h - b[i - 1].c), Math.abs(b[i].l - b[i - 1].c)));
  let a = 0;
  for (let i = 1; i <= n; i++) a += tr(i);
  a /= n;
  for (let i = n + 1; i < b.length; i++) a = (a * (n - 1) + tr(i)) / n;
  return a;
}
function rsiLast(v: number[], n = 14) {
  let g = 0, l = 0;
  for (let i = 1; i <= n; i++) {
    const d = v[i] - v[i - 1];
    if (d > 0) g += d;
    else l -= d;
  }
  g /= n;
  l /= n;
  for (let i = n + 1; i < v.length; i++) {
    const d = v[i] - v[i - 1];
    g = (g * (n - 1) + Math.max(d, 0)) / n;
    l = (l * (n - 1) + Math.max(-d, 0)) / n;
  }
  return l === 0 ? 100 : 100 - 100 / (1 + g / l);
}
function pstd(x: number[]) {
  const m = x.reduce((a, b) => a + b, 0) / x.length;
  return Math.sqrt(x.reduce((a, b) => a + (b - m) ** 2, 0) / x.length);
}
const sum = (x: number[]) => x.reduce((a, b) => a + b, 0);

/** Features of a window of exactly W closed bars (oldest -> newest). Pure. */
export function features(win: Candle[]): { f: Record<Feature, number>; atr: number; rv96: number } {
  if (win.length !== W) throw new Error(`snapshot needs ${W} bars, got ${win.length}`);
  const c = win.map((b) => b.c), h = win.map((b) => b.h), l = win.map((b) => b.l), v = win.map((b) => b.v ?? 0);
  const lr: number[] = [];
  for (let i = 1; i < W; i++) lr.push(Math.log(c[i] / c[i - 1]));
  const rv24 = pstd(lr.slice(-24));
  let rv96 = pstd(lr.slice(-96));
  if (!(rv96 > 0)) rv96 = 1e-9;
  let a = atrLast(win, 14);
  if (!(a > 0)) a = 1e-12;
  const e20 = emaLast(c, 20), e50 = emaLast(c, 50), e100 = emaLast(c, 100);
  let path = 0;
  for (let i = W - 24; i < W; i++) path += Math.abs(c[i] - c[i - 1]);
  const hi48 = Math.max(...h.slice(-48)), lo48 = Math.min(...l.slice(-48));
  const clv = win.map((b) => (b.h > b.l ? (b.c - b.l - (b.h - b.c)) / (b.h - b.l) : 0));
  const bp = (k: number) => {
    const sv = sum(v.slice(-k));
    let s = 0;
    for (let i = W - k; i < W; i++) s += clv[i] * v[i];
    return sv > 0 ? s / sv : 0;
  };
  const mv6 = sum(v.slice(-6)) / 6, mv96 = sum(v.slice(-96)) / 96;
  let hl6 = 0;
  for (let i = W - 6; i < W; i++) hl6 += Math.log(h[i] / l[i]);
  hl6 /= 6;
  const last = c[W - 1];
  const f: Record<Feature, number> = {
    r1z: lr[lr.length - 1] / rv96,
    r3z: Math.log(last / c[W - 4]) / (rv96 * Math.sqrt(3)),
    r12z: Math.log(last / c[W - 13]) / (rv96 * Math.sqrt(12)),
    r48z: Math.log(last / c[W - 49]) / (rv96 * Math.sqrt(48)),
    volr: rv24 / rv96,
    trend1: (last - e50) / a,
    trend2: (e20 - e100) / a,
    er24: path > 0 ? Math.abs(last - c[W - 25]) / path : 0,
    rpos48: hi48 > lo48 ? (last - lo48) / (hi48 - lo48) : 0.5,
    bp6: bp(6),
    bp24: bp(24),
    volz: mv6 > 0 && mv96 > 0 ? Math.log(mv6 / mv96) : 0,
    rsi: (rsiLast(c, 14) - 50) / 50,
    hlr: hl6 / (a / last),
  };
  return { f, atr: a, rv96 };
}

/** Bars usable for a decision at `decisionTs`: closed strictly by then (t + gran <= decisionTs). */
export const closedBefore = (bars: Candle[], gran: number, decisionTs: number) => bars.filter((b) => b.t + gran <= decisionTs);

/** Fill missing bars like the research loader: carry the last close forward, zero volume. */
export function fillGaps(bars: Candle[], gran: number): Candle[] {
  const out: Candle[] = [];
  for (const b of bars) {
    const prev = out[out.length - 1];
    if (prev) for (let t = prev.t + gran; t < b.t; t += gran) out.push({ t, o: prev.c, h: prev.c, l: prev.c, c: prev.c, v: 0 });
    out.push(b);
  }
  return out;
}

/** Snapshot for a decision at `decisionTs`, or null if fewer than W closed bars (or a gap) are available. */
export function snapshotAt(bars: Candle[], gran: number, decisionTs: number, extras: LiveExtras = { spreadBps: null, bookImbalance: null, fundingHourly: null }): Snapshot | null {
  const usable = fillGaps(closedBefore(bars, gran, decisionTs), gran);
  if (usable.length < W) return null;
  const win = usable.slice(-W);
  const { f, atr, rv96 } = features(win);
  if (!Object.values(f).every(Number.isFinite)) return null;
  const lastBar = win[W - 1];
  return { decisionTs, barT: lastBar.t, gran, price: lastBar.c, atr, realizedVol: rv96, features: f, extras };
}
