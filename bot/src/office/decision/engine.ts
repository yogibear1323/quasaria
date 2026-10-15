/**
 * Decision desk engine: state -> typed decision -> gate -> hard risk -> size. Shared by the walk-forward
 * backtest and the shadow runner. PAPER ONLY: this module has no order path at all.
 */
import type { Candle } from "../indicators.js";
import type { DeskRiskState } from "../risk.js";
import { brier, type Calibrator, calibrateWith, fitCalibrator, reliability } from "./calibrate.js";
import { hardCheck, type HardLimits, kellyRiskPct } from "./hardRisk.js";
import { gate, propose, type Regime, riskStateFor, type TradeDecision } from "./schema.js";
import { computeState, type MarketState, WARMUP } from "./state.js";

export const GEOM = { tpAtr: 1.5, slAtr: 1.0, maxBars: 32 };
export const COSTS = { feeBpsPerSide: 10 }; // + half the (proxy/L2) spread per side
const roundTripCost = (spreadBps: number) => (2 * COSTS.feeBpsPerSide + spreadBps) / 1e4;
/** payoff ratio net of costs at a typical 15m ATR (~0.6 %) */
export const PAYOFF_B = (GEOM.tpAtr - 0.35) / (GEOM.slAtr + 0.35);

export interface Outcome { win: boolean; netRet: number; exitIdx: number; exitT: number; reason: "tp" | "sl" | "time" }
/** Entry at next bar open (causal), first-touch TP/SL with SL-first on ties, timeout close. Net of fees + spread. */
export function outcome(bars: Candle[], i: number, side: 1 | -1, atr: number, spreadBps: number, tf: number): Outcome | null {
  if (i + 1 >= bars.length) return null;
  const e = bars[i + 1].o;
  const tp = e + side * GEOM.tpAtr * atr, sl = e - side * GEOM.slAtr * atr;
  const end = Math.min(bars.length - 1, i + GEOM.maxBars);
  if (i + GEOM.maxBars >= bars.length) return null;
  for (let j = i + 1; j <= end; j++) {
    const b = bars[j];
    const hitSl = side > 0 ? b.l <= sl : b.h >= sl, hitTp = side > 0 ? b.h >= tp : b.l <= tp;
    if (hitSl || hitTp) {
      const px = hitSl ? sl : tp;
      const net = (side * (px - e)) / e - roundTripCost(spreadBps);
      return { win: net > 0, netRet: net, exitIdx: j, exitT: b.t + tf, reason: hitSl ? "sl" : "tp" };
    }
  }
  const net = (side * (bars[end].c - e)) / e - roundTripCost(spreadBps);
  return { win: net > 0, netRet: net, exitIdx: end, exitT: bars[end].t + tf, reason: "time" };
}

export interface DecisionLog extends TradeDecision { fired: boolean; failed: string[]; hard: string; riskPct: number; spreadBps: number; imbalance: number; rvol: number; drawdownPct: number; bookSource: string; win?: boolean; netPnl?: number }
export interface Fill { t: number; side: "long" | "short"; entry: number; exitT: number; notional: number; riskPct: number; confidence: number; netPnl: number; reason: string }

export interface SimResult {
  decisions: DecisionLog[]; fills: Fill[]; equityCurve: [number, number][];
  peakEquity: number;
  stats: { from: number; to: number; days: number; candidates: number; fired: number; winRate: number; netPnl: number; netPnlPct: number; maxDrawdownPct: number; brierCandidates: number; brierFired: number; baseRate: number; brierClimatology: number; feesPaid: number; killed: string | null };
  reliability: ReturnType<typeof reliability>;
  gateFailures: Record<string, number>;
  regimes: Record<Regime, number>;
}

/** Labelled candidate rows (for calibration) over [from, to): proposals with a direction and a resolved outcome. */
export function candidates(bars: Candle[], tf: number, fromIdx: number, toIdx: number, resolvedBy: number) {
  const rows: { i: number; raw: number; regime: Regime; win: boolean; t: number; dir: 1 | -1 }[] = [];
  const pf = { equity: 1, peakEquity: 1, dayStartEquity: 1, inventory: 0 };
  for (let i = Math.max(WARMUP, fromIdx); i < toIdx; i++) {
    const s = computeState(bars, i, tf, bars[i].t + tf, pf)!;
    const d = propose(s, "safe", () => 0);
    if (d.direction === "flat") continue;
    const dir = d.direction === "long" ? 1 : -1;
    const o = outcome(bars, i, dir, s.atr, s.spreadBps, tf);
    if (!o || o.exitT > resolvedBy) continue; // label must be known before the test window starts
    rows.push({ i, raw: d.raw, regime: d.regime, win: o.win, t: s.t, dir });
  }
  return rows;
}

export function simulate(bars: Candle[], tf: number, fromIdx: number, toIdx: number, cal: Calibrator, h: HardLimits, startEquity: number, kellyFraction = 0.25, diagFixedRiskPct = 0, carryPeak = startEquity, baseEquity = startEquity): SimResult {
  const calib = calibrateWith(cal);
  const desk: DeskRiskState = { equity: startEquity, dayStartEquity: startEquity, peakEquity: Math.max(startEquity, carryPeak), lossStreak: 0, pausedUntil: 0, entryTimes: [] };
  let day = -1, openUntil = -1, killed: string | null = null, maxDd = 0, fees = 0;
  const decisions: DecisionLog[] = [], fills: Fill[] = [], curve: [number, number][] = [];
  const gateFailures: Record<string, number> = {};
  const regimes = { trending: 0, mean_reverting: 0, high_vol: 0, crisis: 0 } as Record<Regime, number>;
  const pC: number[] = [], yC: boolean[] = [], pF: number[] = [], yF: boolean[] = [];
  let pending: { exitIdx: number; pnl: number } | null = null;
  for (let i = Math.max(WARMUP, fromIdx); i < toIdx; i++) {
    const t = bars[i].t + tf;
    if (pending && pending.exitIdx <= i) {
      desk.equity += pending.pnl;
      desk.lossStreak = pending.pnl < 0 ? desk.lossStreak + 1 : 0;
      pending = null;
    }
    const d0 = Math.floor(t / 86400);
    if (d0 !== day) (day = d0), (desk.dayStartEquity = desk.equity);
    desk.peakEquity = Math.max(desk.peakEquity, desk.equity);
    maxDd = Math.max(maxDd, (desk.peakEquity - desk.equity) / desk.peakEquity);
    if (i % 16 === 0) curve.push([t, +desk.equity.toFixed(4)]);
    const s: MarketState = computeState(bars, i, tf, t, { equity: desk.equity, peakEquity: desk.peakEquity, dayStartEquity: desk.dayStartEquity, inventory: pending ? 1 : 0 })!;
    const hasPos = !!pending || openUntil > i;
    const dayLoss = desk.dayStartEquity > 0 ? Math.max(0, ((desk.dayStartEquity - desk.equity) / desk.dayStartEquity) * 100) : 0;
    const dec = propose(s, riskStateFor(s, h.maxDrawdownPct, hasPos, dayLoss, h.maxDailyLossPct), calib);
    regimes[dec.regime]++;
    if (!killed && desk.peakEquity > 0 && ((desk.peakEquity - desk.equity) / desk.peakEquity) * 100 >= h.maxDrawdownPct) killed = `drawdown >= ${h.maxDrawdownPct}% (closed equity)`;
    if (killed) break;
    if (dec.direction === "flat") continue;
    const dir = dec.direction === "long" ? 1 : -1;
    const o = outcome(bars, i, dir, s.atr, s.spreadBps, tf);
    if (o) pC.push(dec.confidence), yC.push(o.win);
    const g = diagFixedRiskPct > 0 ? gate(dec, -1) : gate(dec);
    const hv = hardCheck(h, { desk, startEquity: baseEquity, open: hasPos ? 1 : 0, now: t, killFlag: !!killed });
    if (!hv.ok && hv.level === "kill") killed ??= hv.reason;
    let riskPct = 0;
    const failed = [...g.failed];
    if (g.fire && hv.ok) {
      riskPct = diagFixedRiskPct > 0 ? Math.min(diagFixedRiskPct, hv.riskCapPct) : kellyRiskPct(dec.confidence, PAYOFF_B, kellyFraction, hv.riskCapPct);
      if (riskPct <= 0) failed.push("kelly <= 0");
    }
    for (const f of failed) gateFailures[f.split(" ")[0]] = (gateFailures[f.split(" ")[0]] ?? 0) + 1;
    if (!hv.ok) gateFailures["hard:" + hv.reason.split(" ")[0]] = (gateFailures["hard:" + hv.reason.split(" ")[0]] ?? 0) + 1;
    const fire = g.fire && hv.ok && riskPct > 0 && !!o;
    const log: DecisionLog = { ...dec, fired: fire, failed, hard: hv.ok ? "ok" : hv.reason, riskPct, spreadBps: s.spreadBps, imbalance: s.imbalance, rvol: s.rvol, drawdownPct: s.drawdownPct, bookSource: s.bookSource, win: o?.win };
    if (fire && o && hv.ok) {
      const stopPct = (GEOM.slAtr * s.atr) / bars[i + 1].o + 0.002;
      const notional = Math.min((desk.equity * riskPct) / 100 / stopPct, hv.maxNotional);
      const pnl = notional * o.netRet;
      fees += notional * roundTripCost(s.spreadBps);
      pending = { exitIdx: o.exitIdx, pnl };
      openUntil = o.exitIdx;
      desk.entryTimes.push(t);
      log.netPnl = pnl;
      fills.push({ t, side: dec.direction as "long" | "short", entry: bars[i + 1].o, exitT: o.exitT, notional, riskPct, confidence: dec.confidence, netPnl: pnl, reason: o.reason });
      pF.push(dec.confidence), yF.push(o.win);
    }
    decisions.push(log);
  }
  if (pending) desk.equity += pending.pnl;
  maxDd = Math.max(maxDd, (desk.peakEquity - desk.equity) / desk.peakEquity);
  const base = yC.filter(Boolean).length / Math.max(1, yC.length);
  const from = bars[Math.max(WARMUP, fromIdx)].t, to = bars[toIdx - 1].t + tf;
  return {
    peakEquity: desk.peakEquity, decisions, fills, equityCurve: curve, reliability: reliability(pC, yC), gateFailures, regimes,
    stats: {
      from, to, days: (to - from) / 86400, candidates: pC.length, fired: fills.length,
      winRate: fills.length ? fills.filter((f) => f.netPnl > 0).length / fills.length : NaN,
      netPnl: desk.equity - startEquity, netPnlPct: ((desk.equity - startEquity) / startEquity) * 100, maxDrawdownPct: maxDd * 100,
      brierCandidates: brier(pC, yC), brierFired: brier(pF, yF), baseRate: base, brierClimatology: base * (1 - base), feesPaid: fees, killed,
    },
  };
}

/** Walk-forward: retrain the calibrator every `testDays` on the previous `trainDays` of resolved candidates. */
export function walkForward(bars: Candle[], tf: number, h: HardLimits, opts: { trainDays: number; testDays: number; startEquity: number; kellyFraction: number; diagFixedRiskPct?: number } = { trainDays: 180, testDays: 30, startEquity: 500, kellyFraction: 0.25 }) {
  const per = 86400 / tf;
  const folds: { cal: Calibrator; res: SimResult }[] = [];
  let eq = opts.startEquity, peak = opts.startEquity;
  for (let s = WARMUP + opts.trainDays * per; s + per < bars.length; s += opts.testDays * per) {
    const e = Math.min(bars.length - GEOM.maxBars - 1, s + opts.testDays * per);
    if (e <= s) break;
    const rows = candidates(bars, tf, s - opts.trainDays * per, s, bars[s].t);
    const cal = fitCalibrator(rows);
    const res = simulate(bars, tf, s, e, cal, h, eq, opts.kellyFraction, opts.diagFixedRiskPct ?? 0, peak, opts.startEquity);
    peak = Math.max(res.peakEquity, eq + res.stats.netPnl);
    eq += res.stats.netPnl;
    folds.push({ cal, res });
    if (res.stats.killed) break;
  }
  return folds;
}
