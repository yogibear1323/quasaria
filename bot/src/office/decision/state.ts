/**
 * Deterministic state engine (TESTNET research / shadow only). One MarketState per CLOSED candle.
 * Strictly causal: state at index i reads candles[0..i] only, and refuses any candle whose close time
 * (t + tf) is after `asOf`. Order-book fields come from a live L2 snapshot when one is supplied (shadow);
 * on historical bars there is no book, so spread / imbalance use labelled candle proxies (`bookSource: "proxy"`).
 */
import type { Candle } from "../indicators.js";

export interface BookSnap { ts: number; bids: [number, number][]; asks: [number, number][] }
export interface Portfolio { equity: number; peakEquity: number; dayStartEquity: number; inventory: number /* signed base units */ }
export interface MarketState {
  t: number; // close time of the bar the state describes (unix s)
  mid: number;
  spreadBps: number;
  imbalance: number; // -1..1, + = bid pressure
  bookSource: "l2" | "proxy";
  rvol: number; // realized vol, annualized, from 48 log returns
  rvolPct: number; // percentile of rvol within the trailing 960-bar window (0..1)
  er: number; // Kaufman efficiency ratio over 32 bars (0..1)
  trend: number; // (ema12 - ema48) / atr
  z: number; // (close - sma48) / std48
  atr: number;
  inventory: number;
  drawdownPct: number;
}

export const WARMUP = 120;

export class CausalityError extends Error {}

function emaAt(c: number[], n: number, i: number) {
  const k = 2 / (n + 1);
  const s = Math.max(0, i - n * 4);
  let e = c[s];
  for (let j = s + 1; j <= i; j++) e = c[j] * k + e * (1 - k);
  return e;
}

export function bookFeatures(b: BookSnap, depth = 10) {
  const bb = b.bids[0]?.[0], ba = b.asks[0]?.[0];
  if (!(bb > 0 && ba > 0)) return null;
  const mid = (bb + ba) / 2;
  const bv = b.bids.slice(0, depth).reduce((a, [, q]) => a + q, 0), av = b.asks.slice(0, depth).reduce((a, [, q]) => a + q, 0);
  return { mid, spreadBps: ((ba - bb) / mid) * 1e4, imbalance: bv + av > 0 ? (bv - av) / (bv + av) : 0 };
}

type Core = Omit<MarketState, "inventory" | "drawdownPct">;
const memo = new WeakMap<Candle[], Map<number, Core>>();

export function computeState(bars: Candle[], i: number, tf: number, asOf: number, pf: Portfolio, book?: BookSnap): MarketState | null {
  if (i < WARMUP || i >= bars.length) return null;
  const closeT = bars[i].t + tf;
  if (closeT > asOf) throw new CausalityError(`bar ${bars[i].t} closes at ${closeT} > asOf ${asOf}`);
  if (book && book.ts > asOf) throw new CausalityError(`book ${book.ts} > asOf ${asOf}`);
  const drawdownPct = pf.peakEquity > 0 ? Math.max(0, (pf.peakEquity - pf.equity) / pf.peakEquity) * 100 : 0;
  // candle-only features depend on bars[0..i] alone, so they are memoised (bars arrays are treated as append-only)
  let m = memo.get(bars);
  if (!m) memo.set(bars, (m = new Map()));
  let core = book ? undefined : m.get(i);
  if (!core) {
    core = coreState(bars, i, tf, closeT, book);
    if (!book) m.set(i, core);
  }
  return { ...core, inventory: pf.inventory, drawdownPct };
}

function coreState(bars: Candle[], i: number, tf: number, closeT: number, book?: BookSnap): Core {
  const c = bars.map((b) => b.c);
  const b = bars[i];
  // ATR(14)
  let atr = 0;
  for (let j = i - 13; j <= i; j++) atr += Math.max(bars[j].h - bars[j].l, Math.abs(bars[j].h - c[j - 1]), Math.abs(bars[j].l - c[j - 1]));
  atr /= 14;
  const rets: number[] = [];
  for (let j = i - 47; j <= i; j++) rets.push(Math.log(c[j] / c[j - 1]));
  const mu = rets.reduce((a, x) => a + x, 0) / rets.length;
  const sd = Math.sqrt(rets.reduce((a, x) => a + (x - mu) ** 2, 0) / (rets.length - 1));
  const rvol = sd * Math.sqrt((365 * 86400) / tf);
  // percentile of current 48-bar vol among trailing samples (every 8th bar, causal)
  const hist: number[] = [];
  for (let j = Math.max(WARMUP - 48, i - 960); j < i; j += 8) {
    let s = 0, m = 0;
    const r: number[] = [];
    for (let k = j - 47; k <= j; k++) if (k > 0) r.push(Math.log(c[k] / c[k - 1]));
    m = r.reduce((a, x) => a + x, 0) / r.length;
    s = Math.sqrt(r.reduce((a, x) => a + (x - m) ** 2, 0) / Math.max(1, r.length - 1));
    hist.push(s);
  }
  const rvolPct = hist.length ? hist.filter((x) => x <= sd).length / hist.length : 0.5;
  let path = 0;
  for (let j = i - 31; j <= i; j++) path += Math.abs(c[j] - c[j - 1]);
  const er = path > 0 ? Math.abs(c[i] - c[i - 32]) / path : 0;
  const trend = atr > 0 ? (emaAt(c, 12, i) - emaAt(c, 48, i)) / atr : 0;
  const w = c.slice(i - 47, i + 1);
  const m48 = w.reduce((a, x) => a + x, 0) / 48;
  const s48 = Math.sqrt(w.reduce((a, x) => a + (x - m48) ** 2, 0) / 47);
  const z = s48 > 0 ? (c[i] - m48) / s48 : 0;
  let mid: number, spreadBps: number, imbalance: number, bookSource: "l2" | "proxy";
  const bf = book ? bookFeatures(book) : null;
  if (bf) ({ mid, spreadBps, imbalance } = bf), (bookSource = "l2");
  else {
    // proxies: mid = (h+l)/2; spread ~ Roll-style 2*sqrt(-cov) floored at 2 bps; imbalance = close-location value, volume-weighted over 4 bars
    mid = (b.h + b.l) / 2;
    let cov = 0;
    for (let j = i - 19; j <= i; j++) cov += (c[j] - c[j - 1]) * (c[j - 1] - c[j - 2]);
    cov /= 20;
    spreadBps = Math.max(2, cov < 0 ? (2 * Math.sqrt(-cov) / c[i]) * 1e4 : 2);
    let num = 0, den = 0;
    for (let j = i - 3; j <= i; j++) {
      const rng = bars[j].h - bars[j].l, v = bars[j].v ?? 1;
      num += (rng > 0 ? (2 * bars[j].c - bars[j].h - bars[j].l) / rng : 0) * v;
      den += v;
    }
    imbalance = den > 0 ? num / den : 0;
    bookSource = "proxy";
  }
  return { t: closeT, mid, spreadBps, imbalance, bookSource, rvol, rvolPct, er, trend, z, atr };
}
