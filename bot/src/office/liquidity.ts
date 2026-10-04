/**
 * Liquidity pockets (pure; CLOSED bars only). No historical order-book depth exists in public APIs, so resting
 * liquidity is inferred from price structure (port of research/liquidity.py, same rules):
 *  - swing liquidity: confirmed pivot highs/lows (k bars each side) not yet traded through (resting stops)
 *  - equal highs/lows: two pivots within `eqTol` × ATR (stop clusters)
 *  - prior UTC-day high/low
 *  - sweep + reclaim: a bar trades through an unswept level and CLOSES back on the other side.
 */
import type { Candle } from "./indicators.js";

export function atrSeries(bars: Candle[], n = 14): number[] {
  const out = new Array<number>(bars.length).fill(NaN);
  if (bars.length <= n) return out;
  const tr = bars.map((b, i) => (i === 0 ? b.h - b.l : Math.max(b.h - b.l, Math.abs(b.h - bars[i - 1].c), Math.abs(b.l - bars[i - 1].c))));
  let a = 0;
  for (let i = 1; i <= n; i++) a += tr[i];
  a /= n;
  out[n] = a;
  for (let i = n + 1; i < bars.length; i++) (a = (a * (n - 1) + tr[i]) / n), (out[i] = a);
  return out;
}

export interface SweepScan {
  longSweep: boolean[]; // sell-side liquidity swept + reclaimed on this bar
  shortSweep: boolean[]; // buy-side liquidity swept + reclaimed
  extreme: number[]; // the sweep bar's low (long) / high (short)
  levelUp: number[]; // nearest unswept level above the close (NaN if none)
  levelDown: number[];
  sinceSell: number[]; // bars since the last sell-side sweep
  sinceBuy: number[];
}

/** src: 0 pivots, 1 equal highs/lows only, 2 prior-day high/low only, 3 any. */
export function sweepScan(bars: Candle[], k = 3, L = 100, src = 3, eqTol = 0.1): SweepScan {
  const n = bars.length, atr = atrSeries(bars, 14);
  const r: SweepScan = { longSweep: Array(n).fill(false), shortSweep: Array(n).fill(false), extreme: Array(n).fill(NaN), levelUp: Array(n).fill(NaN), levelDown: Array(n).fill(NaN), sinceSell: Array(n).fill(1e9), sinceBuy: Array(n).fill(1e9) };
  type Lv = { px: number; bar: number; on: boolean; eq: boolean };
  const highs: Lv[] = [], lows: Lv[] = [];
  let day = -1, pdh = NaN, pdl = NaN, dh = -Infinity, dl = Infinity, pdhUsed = false, pdlUsed = false, lastSell = -1e9, lastBuy = -1e9;
  for (let i = 0; i < n; i++) {
    const b = bars[i];
    const d = Math.floor(b.t / 86_400);
    if (d !== day) {
      if (day >= 0) (pdh = dh), (pdl = dl);
      (day = d), (dh = -Infinity), (dl = Infinity), (pdhUsed = false), (pdlUsed = false);
    }
    const j = i - k;
    if (j - k >= 0) {
      let isH = true, isL = true;
      for (let q = j - k; q <= j + k; q++) {
        if (bars[q].h > bars[j].h) isH = false;
        if (bars[q].l < bars[j].l) isL = false;
      }
      const tol = eqTol * (Number.isFinite(atr[i]) ? atr[i] : 0);
      if (isH) {
        const lv: Lv = { px: bars[j].h, bar: j, on: true, eq: false };
        for (const o of highs) if (o.on && i - o.bar <= L && Math.abs(o.px - lv.px) <= tol) (o.eq = true), (lv.eq = true);
        highs.push(lv);
      }
      if (isL) {
        const lv: Lv = { px: bars[j].l, bar: j, on: true, eq: false };
        for (const o of lows) if (o.on && i - o.bar <= L && Math.abs(o.px - lv.px) <= tol) (o.eq = true), (lv.eq = true);
        lows.push(lv);
      }
    }
    if (i % 64 === 0) {
      for (const arr of [highs, lows]) {
        const keep = arr.filter((o) => o.on && i - o.bar <= L + k);
        arr.length = 0;
        arr.push(...keep);
      }
    }
    let sweptLow = false, sweptHigh = false;
    if (src !== 2) {
      for (const o of lows)
        if (o.on && i - o.bar <= L && o.bar < i - k && b.l < o.px) {
          if ((src === 0 || src === 3 || o.eq) && b.c > o.px) sweptLow = true;
          o.on = false;
        }
      for (const o of highs)
        if (o.on && i - o.bar <= L && o.bar < i - k && b.h > o.px) {
          if ((src === 0 || src === 3 || o.eq) && b.c < o.px) sweptHigh = true;
          o.on = false;
        }
    }
    if (src >= 2 && Number.isFinite(pdl)) {
      if (!pdlUsed && b.l < pdl) (pdlUsed = true), b.c > pdl && (sweptLow = true);
      if (!pdhUsed && b.h > pdh) (pdhUsed = true), b.c < pdh && (sweptHigh = true);
    }
    dh = Math.max(dh, b.h);
    dl = Math.min(dl, b.l);
    if (sweptLow && !sweptHigh) (r.longSweep[i] = true), (r.extreme[i] = b.l), (lastSell = i);
    else if (sweptHigh && !sweptLow) (r.shortSweep[i] = true), (r.extreme[i] = b.h), (lastBuy = i);
    r.sinceSell[i] = i - lastSell;
    r.sinceBuy[i] = i - lastBuy;
    let up = Infinity, dn = -Infinity;
    for (const o of highs) if (o.on && i - o.bar <= L && o.px > b.c && o.px < up) up = o.px;
    for (const o of lows) if (o.on && i - o.bar <= L && o.px < b.c && o.px > dn) dn = o.px;
    if (Number.isFinite(pdh) && !pdhUsed && pdh > b.c && pdh < up) up = pdh;
    if (Number.isFinite(pdl) && !pdlUsed && pdl < b.c && pdl > dn) dn = pdl;
    if (up < Infinity) r.levelUp[i] = up;
    if (dn > -Infinity) r.levelDown[i] = dn;
  }
  return r;
}

/** Supertrend line + direction (ATR(n) Wilder, multiplier m), same band ratchet as research/strategies.py. */
export function supertrendSeries(bars: Candle[], n = 10, m = 3): { line: number[]; dir: number[] } {
  const a = atrSeries(bars, n), N = bars.length;
  const line = Array<number>(N).fill(NaN), dir = Array<number>(N).fill(0);
  let ub = NaN, lb = NaN, cur = 1;
  for (let i = 0; i < N; i++) {
    if (!Number.isFinite(a[i])) continue;
    const b = bars[i], mid = (b.h + b.l) / 2, bu = mid + m * a[i], bl = mid - m * a[i];
    if (!Number.isFinite(ub)) (ub = bu), (lb = bl);
    else {
      ub = bu < ub || bars[i - 1].c > ub ? bu : ub;
      lb = bl > lb || bars[i - 1].c < lb ? bl : lb;
    }
    if (cur === 1 && b.c < lb) cur = -1;
    else if (cur === -1 && b.c > ub) cur = 1;
    dir[i] = cur;
    line[i] = cur === 1 ? lb : ub;
  }
  return { line, dir };
}
