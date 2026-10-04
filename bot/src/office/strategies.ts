/**
 * The three Back Office strategies (pure; decide on CLOSED bars).
 *  - trend:   Donchian(20) breakout in the direction of EMA20 vs EMA50; 2×ATR stop, 3×ATR trail, exit on close through EMA20.
 *  - funding: sit on the side that RECEIVES funding when the external (non-fleet) skew pays ≥ minRate for 2 samples;
 *             small size, tight stop, exit when the rate fades/flips or after maxHoldSec. Directional — no hedge venue.
 *  - meanrev: fade closes outside Bollinger(20, 2.2) with RSI extreme, only when ADX < 20 and no fresh trend breakout;
 *             target = middle band, 1.5×ATR stop, 12-bar time stop.
 *  - supertrend: Supertrend ATR(n)×m flip (default 10×3); stop = the line, trailed with it; exit on the opposite flip.
 *  - liqpocket (EXPERIMENTAL): sweep + reclaim of resting liquidity (swing / equal highs-lows, prior-day high/low);
 *             stop beyond the sweep extreme, target R multiple, time stop. See liquidity.ts.
 *  Optional liquidity-pocket ENTRY FILTER on any bar strategy: params.lpSweepBars = N -> a long is only taken if
 *  sell-side liquidity was swept + reclaimed within the last N closed bars (shorts: buy-side), see withLiquidityFilter().
 */
import { adx, atr, bollinger, donchianPrev, emaSeries, last, rsi, stdev, sma, type Candle } from "./indicators.js";
import type { ChainPosition, DeskConfig, Signal } from "./types.js";
import { atrSeries, supertrendSeries, sweepScan } from "./liquidity.js";

export interface StrategyContext {
  bars: Candle[]; // closed bars at the desk timeframe
  price: number; // oracle price now
  now: number;
  fundingExtHourly: number; // rate implied by external skew (> 0: longs pay)
  fundingSamples: number[]; // recent hourly samples of fundingExtHourly, newest last
  externalSkew: number; // long_oi - short_oi excluding fleet positions
  trendBreakoutRecent: boolean;
}
export interface Manage {
  exit?: string;
  newStop?: number;
}
export interface OfficeStrategy {
  entry(ctx: StrategyContext): Signal | null;
  manage(ctx: StrategyContext, pos: ChainPosition): Manage;
}

const p = (d: DeskConfig, k: string, def: number) => d.params[k] ?? def;

export function trend(d: DeskConfig): OfficeStrategy {
  const fast = p(d, "fast", 20), slow = p(d, "slow", 50), look = p(d, "breakout", 20);
  const stopAtr = p(d, "stopAtr", 2), trailAtr = p(d, "trailAtr", 3);
  return {
    entry({ bars }) {
      if (bars.length < slow + 2) return null;
      const closes = bars.map((b) => b.c);
      const ef = last(emaSeries(closes, fast)), es = last(emaSeries(closes, slow));
      const { high, low } = donchianPrev(bars, look);
      const a = atr(bars, 14);
      const c = last(closes);
      if (!Number.isFinite(a) || !Number.isFinite(ef)) return null;
      if (c > high && ef > es) return { side: "long", stop: c - stopAtr * a, takeProfit: 0, reason: `close ${c.toFixed(5)} > ${look}-bar high ${high.toFixed(5)}, EMA${fast}>EMA${slow}` };
      if (c < low && ef < es) return { side: "short", stop: c + stopAtr * a, takeProfit: 0, reason: `close ${c.toFixed(5)} < ${look}-bar low ${low.toFixed(5)}, EMA${fast}<EMA${slow}` };
      return null;
    },
    manage({ bars }, pos) {
      if (bars.length < fast + 2) return {};
      const closes = bars.map((b) => b.c);
      const ef = last(emaSeries(closes, fast));
      const c = last(closes);
      const a = atr(bars, 14);
      if (pos.side === "long" && c < ef) return { exit: `close below EMA${fast}` };
      if (pos.side === "short" && c > ef) return { exit: `close above EMA${fast}` };
      if (!Number.isFinite(a)) return {};
      const trail = pos.side === "long" ? c - trailAtr * a : c + trailAtr * a;
      const better = pos.side === "long" ? trail > pos.stopLoss * 1.0025 : pos.stopLoss === 0 || trail < pos.stopLoss * 0.9975;
      return better ? { newStop: trail } : {};
    },
  };
}

export function funding(d: DeskConfig): OfficeStrategy {
  const minRate = p(d, "minRateHourly", 0.0002); // 0.02 %/h
  const exitRate = p(d, "exitRateHourly", 0.0001);
  const minSkew = p(d, "minExternalSkew", 5000);
  const maxRet = p(d, "maxAbsReturnPct", 1.5) / 100;
  const stopPct = p(d, "stopPct", 1.25) / 100;
  const tpPct = p(d, "takeProfitPct", 1.5) / 100;
  const maxHold = p(d, "maxHoldSec", 86_400);
  return {
    entry({ bars, price, fundingSamples, externalSkew, fundingExtHourly }) {
      const s = fundingSamples.slice(-2);
      if (s.length < 2) return null;
      const sameSign = Math.sign(s[0]) === Math.sign(s[1]) && Math.sign(s[1]) === Math.sign(fundingExtHourly);
      if (!sameSign || Math.min(Math.abs(s[0]), Math.abs(s[1]), Math.abs(fundingExtHourly)) < minRate) return null;
      if (Math.abs(externalSkew) < minSkew) return null;
      if (bars.length >= 2) {
        const r = last(bars.map((b) => b.c)) / bars[bars.length - 2].c - 1;
        if (Math.abs(r) >= maxRet) return null;
      }
      // rate > 0: longs pay -> short receives
      const side = fundingExtHourly > 0 ? "short" : "long";
      const stop = side === "long" ? price * (1 - stopPct) : price * (1 + stopPct);
      const tp = side === "long" ? price * (1 + tpPct) : price * (1 - tpPct);
      return { side, stop, takeProfit: tp, reason: `receive funding ${(Math.abs(fundingExtHourly) * 100).toFixed(4)}%/h, external skew ${externalSkew.toFixed(0)}` };
    },
    manage({ now, fundingExtHourly }, pos) {
      const receiving = pos.side === "short" ? fundingExtHourly : -fundingExtHourly;
      if (receiving < exitRate) return { exit: receiving < 0 ? "funding flipped" : "funding faded" };
      if (now - pos.openedAt > maxHold) return { exit: "max hold reached" };
      return {};
    },
  };
}

export function meanrev(d: DeskConfig): OfficeStrategy {
  const n = p(d, "bbPeriod", 20), k = p(d, "bbK", 2.2), lo = p(d, "rsiLow", 28), hi = p(d, "rsiHigh", 72);
  const maxAdx = p(d, "maxAdx", 20), stopAtr = p(d, "stopAtr", 1.5), timeBars = p(d, "timeStopBars", 12);
  return {
    entry({ bars, trendBreakoutRecent }) {
      if (bars.length < Math.max(n, 30) + 1 || trendBreakoutRecent) return null;
      const closes = bars.map((b) => b.c);
      const bb = bollinger(closes, n, k);
      const r = rsi(closes, 14);
      const x = adx(bars, 14);
      const a = atr(bars, 14);
      const c = last(closes);
      if (![bb.mid, r, x, a].every(Number.isFinite) || x >= maxAdx) return null;
      if (c < bb.lower && r < lo) return { side: "long", stop: c - stopAtr * a, takeProfit: bb.mid, reason: `close < BB lower, RSI ${r.toFixed(1)}, ADX ${x.toFixed(1)}` };
      if (c > bb.upper && r > hi) return { side: "short", stop: c + stopAtr * a, takeProfit: bb.mid, reason: `close > BB upper, RSI ${r.toFixed(1)}, ADX ${x.toFixed(1)}` };
      return null;
    },
    manage({ bars, now }, pos) {
      const tf = bars.length >= 2 ? bars[bars.length - 1].t - bars[bars.length - 2].t : 3600;
      if (now - pos.openedAt > timeBars * tf) return { exit: `time stop ${timeBars} bars` };
      return {};
    },
  };
}

export function supertrend(d: DeskConfig): OfficeStrategy {
  const n = p(d, "n", 10), m = p(d, "m", 3);
  return {
    entry({ bars }) {
      if (bars.length < n + 3) return null;
      const { line, dir } = supertrendSeries(bars, n, m);
      const i = bars.length - 1, c = bars[i].c;
      if (dir[i] === 1 && dir[i - 1] === -1) return { side: "long", stop: line[i], takeProfit: 0, reason: `Supertrend ${n}×${m} flipped up (close ${c.toFixed(5)} > ${line[i - 1].toFixed(5)})` };
      if (dir[i] === -1 && dir[i - 1] === 1) return { side: "short", stop: line[i], takeProfit: 0, reason: `Supertrend ${n}×${m} flipped down (close ${c.toFixed(5)} < ${line[i - 1].toFixed(5)})` };
      return null;
    },
    manage({ bars }, pos) {
      if (bars.length < n + 3) return {};
      const { line, dir } = supertrendSeries(bars, n, m);
      const i = bars.length - 1;
      if (pos.side === "long" && dir[i] === -1) return { exit: "Supertrend flipped down" };
      if (pos.side === "short" && dir[i] === 1) return { exit: "Supertrend flipped up" };
      const l = line[i];
      if (!Number.isFinite(l)) return {};
      const better = pos.side === "long" ? l > pos.stopLoss * 1.0025 : pos.stopLoss === 0 || l < pos.stopLoss * 0.9975;
      return better ? { newStop: l } : {};
    },
  };
}

/** EXPERIMENTAL liquidity sweep + reclaim (research family `lpsweep`). src: 0 pivots, 1 equal highs/lows, 2 prior-day, 3 any. */
export function liqpocket(d: DeskConfig): OfficeStrategy {
  const k = p(d, "k", 2), L = p(d, "L", 50), src = p(d, "src", 1), buf = p(d, "bufAtr", 0.25), R = p(d, "targetR", 3);
  const align = p(d, "alignEma", 50), timeBars = p(d, "timeStopBars", 48);
  return {
    entry({ bars }) {
      if (bars.length < Math.max(2 * k + 2, align, 30) + 1) return null;
      const sc = sweepScan(bars, k, L, src);
      const i = bars.length - 1, c = bars[i].c, a = atrSeries(bars, 14)[i];
      if (!Number.isFinite(a)) return null;
      const e = align > 0 ? last(emaSeries(bars.map((b) => b.c), align)) : NaN;
      if (sc.longSweep[i] && (!(align > 0) || c > e)) {
        const stop = sc.extreme[i] - buf * a, dist = Math.max(c - stop, 0.008 * c);
        return { side: "long", stop, takeProfit: c + R * dist, reason: `sell-side liquidity swept to ${sc.extreme[i].toFixed(5)} and reclaimed (close ${c.toFixed(5)})${align > 0 ? `, above EMA${align}` : ""}` };
      }
      if (sc.shortSweep[i] && (!(align > 0) || c < e)) {
        const stop = sc.extreme[i] + buf * a, dist = Math.max(stop - c, 0.008 * c);
        return { side: "short", stop, takeProfit: c - R * dist, reason: `buy-side liquidity swept to ${sc.extreme[i].toFixed(5)} and rejected (close ${c.toFixed(5)})${align > 0 ? `, below EMA${align}` : ""}` };
      }
      return null;
    },
    manage({ bars, now }, pos) {
      const tf = bars.length >= 2 ? bars[bars.length - 1].t - bars[bars.length - 2].t : 3600;
      if (now - pos.openedAt > timeBars * tf) return { exit: `time stop ${timeBars} bars` };
      return {};
    },
  };
}

/** Liquidity-pocket entry filter: only pass a long if sell-side liquidity was swept + reclaimed within the last N closed
 *  bars (short: buy-side). Exits / management are untouched. */
export function withLiquidityFilter(inner: OfficeStrategy, d: DeskConfig): OfficeStrategy {
  const N = p(d, "lpSweepBars", 0);
  if (!(N > 0)) return inner;
  const k = p(d, "lpK", 3), L = p(d, "lpL", 100), src = p(d, "lpSrc", 3);
  return {
    entry(ctx) {
      const sig = inner.entry(ctx);
      if (!sig) return null;
      const sc = sweepScan(ctx.bars, k, L, src);
      const i = ctx.bars.length - 1;
      const since = sig.side === "long" ? sc.sinceSell[i] : sc.sinceBuy[i];
      if (!(since <= N)) return null;
      return { ...sig, reason: `${sig.reason}; liquidity filter: ${sig.side === "long" ? "sell" : "buy"}-side sweep ${since} bars ago (≤ ${N})` };
    },
    manage: (ctx, pos) => inner.manage(ctx, pos),
  };
}

function baseStrategy(d: DeskConfig): OfficeStrategy {
  if (d.strategy === "trend") return trend(d);
  if (d.strategy === "funding") return funding(d);
  if (d.strategy === "supertrend") return supertrend(d);
  if (d.strategy === "liqpocket") return liqpocket(d);
  return meanrev(d);
}

export function createOfficeStrategy(d: DeskConfig): OfficeStrategy {
  return d.strategy === "funding" ? funding(d) : withLiquidityFilter(baseStrategy(d), d);
}

/** short "liquidity filter" suffix for explainEntry */
function lpNote(d: DeskConfig, bars: Candle[]): string {
  const N = p(d, "lpSweepBars", 0);
  if (!(N > 0) || bars.length < 10) return "";
  const sc = sweepScan(bars, p(d, "lpK", 3), p(d, "lpL", 100), p(d, "lpSrc", 3));
  const i = bars.length - 1, f = (x: number) => (x >= 1e8 ? "none recent" : `${x} bars ago`);
  return ` · liquidity filter (≤${N} bars): sell-side sweep ${f(sc.sinceSell[i])}, buy-side ${f(sc.sinceBuy[i])}`;
}

/**
 * Read-only explanation of what a desk is waiting for, computed from the SAME indicators and parameters as `entry()`.
 * Display only (Back Office demo "watching" line); never used for decisions.
 */
export function explainEntry(d: DeskConfig, ctx: StrategyContext): string {
  if (d.paused) return `Paused: ${d.paused}`;
  return explainBase(d, ctx) + lpNote(d, ctx.bars);
}

function explainBase(d: DeskConfig, ctx: StrategyContext): string {
  const { bars } = ctx;
  const fx = (v: number) => v.toFixed(4);
  if (d.strategy === "trend") {
    const fast = p(d, "fast", 20), slow = p(d, "slow", 50), look = p(d, "breakout", 20);
    if (bars.length < slow + 2) return `Trend: warming up (${bars.length}/${slow + 2} bars)`;
    const closes = bars.map((b) => b.c);
    const ef = last(emaSeries(closes, fast)), es = last(emaSeries(closes, slow));
    const { high, low } = donchianPrev(bars, look);
    const c = last(closes);
    if (ef > es) return `Trend: up (EMA${fast}>EMA${slow}), waiting for a close above ${fx(high)} (last close ${fx(c)}, ${(((high - c) / c) * 100).toFixed(2)}% away)`;
    if (ef < es) return `Trend: down (EMA${fast}<EMA${slow}), waiting for a close below ${fx(low)} (last close ${fx(c)}, ${(((c - low) / c) * 100).toFixed(2)}% away)`;
    return `Trend: EMAs flat, no direction`;
  }
  if (d.strategy === "supertrend") {
    const n = p(d, "n", 10), m = p(d, "m", 3);
    if (bars.length < n + 3) return `Supertrend: warming up (${bars.length}/${n + 3} bars)`;
    const { line, dir } = supertrendSeries(bars, n, m);
    const i = bars.length - 1, c = bars[i].c;
    return dir[i] === 1
      ? `Supertrend ${n}×${m}: up, line ${fx(line[i])}; a close below it flips short (last close ${fx(c)}, ${(((c - line[i]) / c) * 100).toFixed(2)}% away)`
      : `Supertrend ${n}×${m}: down, line ${fx(line[i])}; a close above it flips long (last close ${fx(c)}, ${(((line[i] - c) / c) * 100).toFixed(2)}% away)`;
  }
  if (d.strategy === "liqpocket") {
    if (bars.length < 51) return `Liquidity pockets: warming up (${bars.length}/51 bars)`;
    const sc = sweepScan(bars, p(d, "k", 2), p(d, "L", 50), p(d, "src", 1));
    const i = bars.length - 1;
    const up = sc.levelUp[i], dn = sc.levelDown[i];
    return `Liquidity pockets (experimental): nearest resting liquidity above ${Number.isFinite(up) ? fx(up) : "none"}, below ${Number.isFinite(dn) ? fx(dn) : "none"}; waiting for a sweep + reclaim`;
  }
  if (d.strategy === "funding") {
    const minRate = p(d, "minRateHourly", 0.0002), minSkew = p(d, "minExternalSkew", 5000);
    const r = Math.abs(ctx.fundingExtHourly);
    if (r < minRate) return `Funding: rate ${(ctx.fundingExtHourly * 100).toFixed(4)}%/h below the ${(minRate * 100).toFixed(3)}%/h threshold`;
    if (ctx.fundingSamples.length < 2) return `Funding: rate ok, collecting hourly samples (${ctx.fundingSamples.length}/2)`;
    if (Math.abs(ctx.externalSkew) < minSkew) return `Funding: external skew ${ctx.externalSkew.toFixed(0)} below ${minSkew}`;
    return `Funding: rate ${(ctx.fundingExtHourly * 100).toFixed(4)}%/h, waiting for a calm bar`;
  }
  const n = p(d, "bbPeriod", 20), k = p(d, "bbK", 2.2), lo = p(d, "rsiLow", 28), hi = p(d, "rsiHigh", 72), maxAdx = p(d, "maxAdx", 20);
  if (bars.length < Math.max(n, 30) + 1) return `Mean-rev: warming up (${bars.length}/${Math.max(n, 30) + 1} bars)`;
  if (ctx.trendBreakoutRecent) return `Mean-rev: standing aside after a recent trend breakout`;
  const closes = bars.map((b) => b.c);
  const sd = stdev(closes, n), mid = sma(closes, n);
  const z = sd > 0 ? (last(closes) - mid) / sd : 0;
  const r = rsi(closes, 14), x = adx(bars, 14);
  const parts = [`z ${z >= 0 ? "+" : ""}${z.toFixed(2)} (needs ±${k.toFixed(1)})`, `RSI ${r.toFixed(0)} (needs <${lo} / >${hi})`, `ADX ${x.toFixed(0)}${x >= maxAdx ? ` ≥ ${maxAdx}: trending, stands aside` : ` (< ${maxAdx} ok)`}`];
  return `Mean-rev: ${parts.join(" · ")}`;
}
