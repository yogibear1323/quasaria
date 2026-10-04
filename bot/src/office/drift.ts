/**
 * Drift monitor (pure): "does live behaviour still look like the tested model?"
 * Score 0–100 from weighted components (each 0–20); amber ≥ 40 (half size), red ≥ 70 (halt).
 * Hard triggers halt regardless of score. Strict mode tightens every threshold (first 14 days live).
 */
import type { DriftMode, StrategyKind } from "./types.js";

export interface ClosedTrade {
  r: number; // pnl / planned risk
  pnl: number;
  slippagePct: number; // adverse fill vs decision price, % (>= 0 adverse)
  fundingPnl: number; // + received
  openedAt: number;
  closedAt: number;
}
export interface Baseline {
  winRate: number;
  rSamples: number[];
  tradesPerDayP95: number;
  payoff: number; // avg win / avg loss
  source: string;
}
export interface DriftInput {
  mode: DriftMode;
  strategy: StrategyKind;
  trades: ClosedTrade[]; // oldest -> newest
  entryTimes: number[];
  txAttempts: number[];
  txFailures: number[];
  baseline: Baseline | null;
  now: number;
}
export interface DriftMetric {
  id: string;
  label: string;
  value: string;
  points: number; // 0..20
  level: "ok" | "warn" | "halt";
}
export interface DriftResult {
  score: number;
  level: "green" | "amber" | "red";
  metrics: DriftMetric[];
  halt: string | null;
}

export function thresholds(mode: DriftMode) {
  const strict = mode === "strict";
  return {
    minTrades: strict ? 20 : 30,
    winWarnZ: strict ? -1.5 : -2,
    winHaltZ: strict ? -2 : -3,
    ksWarnP: strict ? 0.1 : 0.05,
    ksHaltP: strict ? 0.05 : 0.01,
    cumWarnPct: strict ? 10 : 5,
    cumHaltPct: strict ? 5 : 1,
    slipWarnMedian: strict ? 0.2 : 0.3,
    slipHaltAny: strict ? 0.5 : 1.0,
    failHaltRate: strict ? 0.2 : 0.2,
    freqWarnX: strict ? 1.5 : 2,
    freqHaltX: strict ? 2 : 3,
    redScore: strict ? 60 : 70,
    amberScore: strict ? 35 : 40,
  };
}

/** Two-sample Kolmogorov–Smirnov: D statistic and asymptotic p-value. */
export function ksTest(a: number[], b: number[]) {
  if (!a.length || !b.length) return { d: 0, p: 1 };
  const x = [...a].sort((m, n) => m - n), y = [...b].sort((m, n) => m - n);
  let i = 0, j = 0, d = 0;
  while (i < x.length && j < y.length) {
    const v = Math.min(x[i], y[j]);
    while (i < x.length && x[i] <= v) i++;
    while (j < y.length && y[j] <= v) j++;
    d = Math.max(d, Math.abs(i / x.length - j / y.length));
  }
  const en = Math.sqrt((x.length * y.length) / (x.length + y.length));
  const lam = (en + 0.12 + 0.11 / en) * d;
  // Kolmogorov distribution Q_KS(lam) (Numerical Recipes probks): 1 when the series does not converge (tiny lam)
  if (lam < 1e-3) return { d, p: 1 };
  let p = 0, prev = 0, sign = 1;
  for (let k = 1; k <= 100; k++) {
    const term = sign * 2 * Math.exp(-2 * k * k * lam * lam);
    p += term;
    if (Math.abs(term) <= 1e-3 * Math.abs(prev) || Math.abs(term) <= 1e-8 * Math.abs(p)) return { d, p: Math.min(1, Math.max(0, p)) };
    prev = term;
    sign = -sign;
  }
  return { d, p: 1 };
}

/** Percentile (0..100) of `value` among bootstrap sums of n draws from `samples` (deterministic PRNG). */
export function bootstrapPercentile(samples: number[], n: number, value: number, iters = 400, seed = 42) {
  if (!samples.length || n <= 0) return 50;
  let s = seed >>> 0;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  let below = 0;
  for (let it = 0; it < iters; it++) {
    let sum = 0;
    for (let k = 0; k < n; k++) sum += samples[Math.floor(rnd() * samples.length)];
    if (sum < value) below++;
  }
  return (below / iters) * 100;
}

const median = (v: number[]) => {
  if (!v.length) return 0;
  const s = [...v].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const pts = (x: number) => Math.max(0, Math.min(20, Math.round(x)));

export function computeDrift(i: DriftInput): DriftResult {
  const T = thresholds(i.mode);
  const m: DriftMetric[] = [];
  let halt: string | null = null;
  const trades = i.trades.slice(-30);
  const n = trades.length;
  const b = i.baseline;
  const haltIf = (cond: boolean, why: string) => {
    if (cond && !halt) halt = why;
  };

  // D-1 win rate vs baseline (binomial z)
  if (b && n >= T.minTrades && b.winRate > 0 && b.winRate < 1) {
    const wr = trades.filter((t) => t.pnl > 0).length / n;
    const z = (wr - b.winRate) / Math.sqrt((b.winRate * (1 - b.winRate)) / n);
    const lvl = z <= T.winHaltZ ? "halt" : z <= T.winWarnZ ? "warn" : "ok";
    m.push({ id: "D-1", label: "win rate", value: `${(wr * 100).toFixed(0)}% vs ${(b.winRate * 100).toFixed(0)}% (z ${z.toFixed(2)})`, points: pts(((-z - 0.5) / Math.abs(T.winHaltZ)) * 20), level: lvl });
    haltIf(lvl === "halt", `D-1 win rate z ${z.toFixed(2)} <= ${T.winHaltZ}`);
  } else m.push({ id: "D-1", label: "win rate", value: `waiting (${n}/${T.minTrades} trades)`, points: 0, level: "ok" });

  // D-2 KS on R distribution
  if (b && n >= T.minTrades && b.rSamples.length >= 20) {
    const { p } = ksTest(trades.map((t) => t.r), b.rSamples);
    const meanLive = trades.reduce((a, t) => a + t.r, 0) / n;
    const meanBase = b.rSamples.reduce((a, r) => a + r, 0) / b.rSamples.length;
    const worse = meanLive < meanBase;
    const lvl = p < T.ksHaltP && worse ? "halt" : p < T.ksWarnP ? "warn" : "ok";
    m.push({ id: "D-2", label: "R distribution (KS)", value: `p ${p.toFixed(3)}, mean R ${meanLive.toFixed(2)} vs ${meanBase.toFixed(2)}`, points: lvl === "halt" ? 20 : lvl === "warn" ? 10 : 0, level: lvl });
    haltIf(lvl === "halt", `D-2 KS p ${p.toFixed(3)} < ${T.ksHaltP} and mean R worse`);
  } else m.push({ id: "D-2", label: "R distribution (KS)", value: "waiting", points: 0, level: "ok" });

  // D-3 cumulative R vs bootstrap
  if (b && n >= T.minTrades && b.rSamples.length >= 20) {
    const pct = bootstrapPercentile(b.rSamples, n, trades.reduce((a, t) => a + t.r, 0));
    const lvl = pct < T.cumHaltPct ? "halt" : pct < T.cumWarnPct ? "warn" : "ok";
    m.push({ id: "D-3", label: "cumulative R", value: `p${pct.toFixed(0)} of baseline`, points: pts(((25 - pct) / 25) * 20), level: lvl });
    haltIf(lvl === "halt", `D-3 cumulative R at p${pct.toFixed(1)} < p${T.cumHaltPct}`);
  } else m.push({ id: "D-3", label: "cumulative R", value: "waiting", points: 0, level: "ok" });

  // D-4 slippage + failed tx rate
  const slips = i.trades.slice(-10).map((t) => t.slippagePct);
  const med = median(slips);
  const worst = slips.length ? Math.max(...slips) : 0;
  const att = i.txAttempts.filter((t) => t > i.now - 3600).length;
  const fail = i.txFailures.filter((t) => t > i.now - 3600).length;
  const failRate = att >= 5 ? fail / att : 0;
  const slipLvl = worst > T.slipHaltAny || failRate > T.failHaltRate ? "halt" : med > T.slipWarnMedian ? "warn" : "ok";
  m.push({ id: "D-4", label: "execution", value: `slip med ${med.toFixed(2)}% max ${worst.toFixed(2)}% · tx fail ${fail}/${att} 1h`, points: pts((med / T.slipHaltAny) * 20 + failRate * 40), level: slipLvl });
  haltIf(worst > T.slipHaltAny, `D-4 fill slippage ${worst.toFixed(2)}% > ${T.slipHaltAny}%`);
  haltIf(failRate > T.failHaltRate, `D-4 failed tx rate ${(failRate * 100).toFixed(0)}% in 1 h`);

  // D-5 trade frequency vs baseline p95
  const day = i.entryTimes.filter((t) => t > i.now - 86_400).length;
  const p95 = Math.max(1, b?.tradesPerDayP95 ?? 3);
  const fLvl = day > T.freqHaltX * p95 ? "halt" : day > T.freqWarnX * p95 ? "warn" : "ok";
  m.push({ id: "D-5", label: "trade frequency", value: `${day}/24h vs p95 ${p95.toFixed(1)}`, points: pts(((day / p95 - 1) / (T.freqHaltX - 1)) * 20), level: fLvl });
  haltIf(fLvl === "halt", `D-5 ${day} entries/24h > ${T.freqHaltX}× baseline p95 ${p95.toFixed(1)}`);

  // D-8 strategy-specific
  const s8 = strategySpecific(i, T.minTrades);
  m.push(s8);
  haltIf(s8.level === "halt", `D-8 ${s8.label}: ${s8.value}`);

  const score = Math.min(100, Math.round(m.reduce((a, x) => a + x.points, 0) * (100 / 120)));
  const level = halt || score >= T.redScore ? "red" : score >= T.amberScore ? "amber" : "green";
  if (!halt && score >= T.redScore) halt = `drift score ${score} >= ${T.redScore}`;
  return { score, level, metrics: m, halt };
}

function strategySpecific(i: DriftInput, minTrades: number): DriftMetric {
  const t = i.trades.slice(-30);
  if (i.strategy === "trend" || i.strategy === "supertrend") {
    const wins = t.filter((x) => x.pnl > 0), losses = t.filter((x) => x.pnl <= 0);
    if (t.length < minTrades || !wins.length || !losses.length || !i.baseline) return { id: "D-8", label: "payoff ratio", value: "waiting", points: 0, level: "ok" };
    const payoff = wins.reduce((a, x) => a + x.r, 0) / wins.length / Math.abs(losses.reduce((a, x) => a + x.r, 0) / losses.length || 1);
    const ratio = payoff / (i.baseline.payoff || 1);
    const lvl = ratio < (i.mode === "strict" ? 0.6 : 0.5) ? "halt" : ratio < 0.75 ? "warn" : "ok";
    return { id: "D-8", label: "payoff ratio", value: `${payoff.toFixed(2)} vs ${i.baseline.payoff.toFixed(2)}`, points: pts((1 - ratio) * 30), level: lvl };
  }
  if (i.strategy === "funding") {
    const f = i.trades.slice(-20);
    const need = i.mode === "strict" ? 10 : 20;
    if (f.length < need) return { id: "D-8", label: "funding share", value: `waiting (${f.length}/${need})`, points: 0, level: "ok" };
    const gross = f.reduce((a, x) => a + Math.abs(x.pnl), 0) || 1;
    const share = f.reduce((a, x) => a + x.fundingPnl, 0) / gross;
    const lvl = share < 0.25 ? "halt" : share < 0.4 ? "warn" : "ok";
    return { id: "D-8", label: "funding share", value: `${(share * 100).toFixed(0)}% of gross PnL`, points: pts(((0.4 - share) / 0.4) * 20), level: lvl };
  }
  const recent = i.trades.slice(-20);
  const big = recent.filter((x) => x.r < -1.5).length;
  const lim = i.mode === "strict" ? 2 : 3;
  const lvl = big >= lim ? "halt" : big >= 1 ? "warn" : "ok";
  return { id: "D-8", label: "oversized losses", value: `${big} losses < −1.5R in last ${recent.length}`, points: pts((big / lim) * 20), level: lvl };
}
