/**
 * Demo account simulator (browser-only, deterministic): runs the SAME strategy, sizing, risk-gate and drift code as the
 * Back Office fleet (imported directly from bot/src/office) on live XLM prices, with simulated fills.
 * No wallet, no keys, no transactions: demo balances are numbers in localStorage, fully separate from testnet funds.
 */
import { createOfficeStrategy, type StrategyContext } from "../../../../bot/src/office/strategies";
import { clampStop, sizePosition } from "../../../../bot/src/office/sizing";
import { deskGate, fleetGate, fleetLevel, fundingGuard, toOpenRisk, type OpenRisk } from "../../../../bot/src/office/risk";
import { computeDrift, type Baseline, type ClosedTrade, type DriftResult } from "../../../../bot/src/office/drift";
import type { Candle } from "../../../../bot/src/office/indicators";
import type { ChainPosition, DeskConfig, DriftMode, LimitsConfig, OfficeConfig, Side } from "../../../../bot/src/office/types";
import officeJson from "../../../../bot/office.config.json";
import baselineJson from "../../../../bot/office.baselines.json";

export const OFFICE = officeJson as unknown as OfficeConfig;
export const BASELINES = (baselineJson as unknown as { desks: Record<string, Baseline> }).desks;

/** Simulated venue parameters (match the testnet leverage vault: 10 bps open fee, 5 % maintenance, 10 min margin). */
export const SIM = { openFeeBps: 10, mmBps: 500, minMargin: 10, slippageBps: 5, reservePerFleetUnit: 10_000 / 3_000 };
export const DEMO_MIN = 500;
export const DEMO_MAX = 1_000_000;
export const DEMO_PRESETS = [500, 1_000, 5_000];
export const CATCHUP_MAX_SEC = 48 * 3600;

export function validateBalance(input: unknown): { ok: true; value: number } | { ok: false; reason: string } {
  const s = typeof input === "number" ? String(input) : String(input ?? "").replace(/[$,\s]/g, "");
  if (!/^\d+(\.\d{0,2})?$/.test(s)) return { ok: false, reason: "Enter an amount like 2500 or 2500.50" };
  const v = Math.round(Number(s) * 100) / 100;
  if (!(v >= DEMO_MIN)) return { ok: false, reason: `Minimum is $${DEMO_MIN.toLocaleString("en-US")} (smaller desks fall under the 10-unit minimum margin)` };
  if (v > DEMO_MAX) return { ok: false, reason: `Maximum is $${DEMO_MAX.toLocaleString("en-US")}` };
  return { ok: true, value: v };
}

export interface SimPos extends ChainPosition {
  risk: number;
  decisionPrice: number;
  fee: number;
}
export interface SimTrade {
  kind: "open" | "close";
  id: number;
  side: Side;
  leverage: number;
  price: number;
  pnl?: number; // net of the open fee
  r?: number;
  reason: string;
  at: number;
  seq: number;
}
export interface DeskSim {
  id: string;
  free: number;
  positions: SimPos[];
  startEquity: number;
  dayStart: { day: number; equity: number };
  peak: number;
  maxDd: number;
  lossStreak: number;
  pausedUntil: number;
  entryTimes: number[];
  closed: ClosedTrade[];
  status: "running" | "paused" | "halted";
  statusReason: string;
  lastBarT: number;
  lastSignal: string;
  trades: SimTrade[]; // newest first
  drift: { score: number; level: DriftResult["level"]; top: string } | null;
}
export interface DemoState {
  v: 1;
  id: string;
  createdAt: number;
  balance: number;
  lastTick: number;
  seq: number;
  fleet: { dayStart: { day: number; equity: number }; peak: number; killed: boolean; killReason: string; paused: string; lastTrendEntry: number; fundingSamples: { t: number; hourly: number }[] };
  desks: Record<string, DeskSim>;
  history: { t: number; eq: number }[];
  away: { from: number; to: number; mode: "caught-up" | "paused" }[];
}
export interface MarketInput {
  now: number;
  price: number;
  hi?: number; // intra-period extremes (catch-up replay) for stop / take-profit checks
  lo?: number;
  bars: Record<number, Candle[]>; // closed bars per timeframe
  fundingHourly: number; // predicted hourly funding (> 0 longs pay)
  extSkew: number;
}

const day = (t: number) => Math.floor(t / 86_400);

export function newDemo(balance: number, now: number, id: string, cfg: OfficeConfig = OFFICE): DemoState {
  const total = cfg.desks.reduce((a, d) => a + d.capital, 0);
  const desks: Record<string, DeskSim> = {};
  let left = balance;
  for (const [i, d] of cfg.desks.entries()) {
    // same split ratios as the fleet; the last desk takes the rounding remainder so desks sum to the balance exactly
    const eq = i === cfg.desks.length - 1 ? Math.round(left * 100) / 100 : Math.round(((balance * d.capital) / total) * 100) / 100;
    left -= eq;
    desks[d.id] = { id: d.id, free: eq, positions: [], startEquity: eq, dayStart: { day: day(now), equity: eq }, peak: eq, maxDd: 0, lossStreak: 0, pausedUntil: 0, entryTimes: [], closed: [], status: "running", statusReason: "", lastBarT: 0, lastSignal: "waiting for the next closed bar", trades: [], drift: null };
  }
  return { v: 1, id, createdAt: now, balance, lastTick: now, seq: 0, fleet: { dayStart: { day: day(now), equity: balance }, peak: balance, killed: false, killReason: "", paused: "", lastTrendEntry: 0, fundingSamples: [] }, desks, history: [{ t: now, eq: balance }], away: [] };
}

const pnlAt = (p: ChainPosition, price: number) => ((p.side === "long" ? price - p.entry : p.entry - price) / p.entry) * p.size;
export const deskEquity = (s: DeskSim, price: number) => s.free + s.positions.reduce((a, p) => a + p.margin + pnlAt(p, price) - p.pendingFunding, 0);
export const demoEquity = (st: DemoState, price: number) => Object.values(st.desks).reduce((a, s) => a + deskEquity(s, price), 0);
const slip = (price: number, adverseUp: boolean) => price * (1 + ((adverseUp ? 1 : -1) * SIM.slippageBps) / 10_000);

function driftMode(now: number, cfg: OfficeConfig): DriftMode {
  return cfg.strictUntil && now * 1000 < Date.parse(cfg.strictUntil) ? "strict" : cfg.driftMode;
}

/** One simulation step (mirrors Fleet.tick/processDesk). Pure: returns a new state. */
export function step(prev: DemoState, m: MarketInput, cfg: OfficeConfig = OFFICE, baselines: Record<string, Baseline> = BASELINES): DemoState {
  const st: DemoState = structuredClone(prev);
  const L: LimitsConfig = cfg.limits;
  const { now, price } = m;
  if (!(price > 0) || now <= st.lastTick) return st;
  const dt = Math.min(now - st.lastTick, 4 * 3600);
  const f = st.fleet;

  // funding accrual on open positions (> 0: longs pay)
  for (const s of Object.values(st.desks)) for (const p of s.positions) p.pendingFunding += p.size * m.fundingHourly * (dt / 3600) * (p.side === "long" ? 1 : -1);
  const lastS = f.fundingSamples[f.fundingSamples.length - 1];
  if (!lastS || now - lastS.t >= 3570) f.fundingSamples = [...f.fundingSamples, { t: now, hourly: m.fundingHourly }].slice(-48);

  const close = (d: DeskConfig, s: DeskSim, p: SimPos, exitRaw: number, reason: string, exact = false) => {
    const exit = exact ? exitRaw : slip(exitRaw, p.side === "short");
    const raw = pnlAt(p, exit) - p.pendingFunding;
    const pnl = Math.max(raw, -p.margin);
    s.free += p.margin + pnl;
    s.positions = s.positions.filter((x) => x.id !== p.id);
    const adverse = p.side === "long" ? (p.entry - p.decisionPrice) / p.decisionPrice : (p.decisionPrice - p.entry) / p.decisionPrice;
    s.closed = [...s.closed, { r: p.risk > 0 ? pnl / p.risk : 0, pnl, slippagePct: Math.max(0, adverse * 100), fundingPnl: -p.pendingFunding, openedAt: p.openedAt, closedAt: now }].slice(-60);
    s.lossStreak = pnl > 0 ? 0 : s.lossStreak + 1;
    s.trades = [{ kind: "close" as const, id: p.id, side: p.side, leverage: p.size / p.margin, price: exit, pnl: pnl - p.fee, r: p.risk > 0 ? pnl / p.risk : 0, reason, at: now, seq: ++st.seq }, ...s.trades].slice(0, 60);
    void d;
  };
  const halt = (s: DeskSim, why: string) => {
    s.status = "halted";
    s.statusReason = why;
  };

  // equity, day roll, peaks
  const equity: Record<string, number> = {};
  for (const d of cfg.desks) {
    const s = st.desks[d.id];
    const eq = deskEquity(s, price);
    equity[d.id] = eq;
    if (s.dayStart.day !== day(now)) s.dayStart = { day: day(now), equity: eq };
    s.peak = Math.max(s.peak, eq);
  }
  const fleetEq = Object.values(equity).reduce((a, b) => a + b, 0);
  if (f.dayStart.day !== day(now)) f.dayStart = { day: day(now), equity: fleetEq };
  f.peak = Math.max(f.peak, fleetEq);
  const open: OpenRisk[] = cfg.desks.flatMap((d) => st.desks[d.id].positions.map((p) => toOpenRisk(p, price)));
  const fleetBase = { equity: fleetEq, dayStartEquity: f.dayStart.equity, peakEquity: f.peak, entryTimes: cfg.desks.flatMap((d) => st.desks[d.id].entryTimes), open, reserve: st.balance * SIM.reservePerFleetUnit };
  const lvl = fleetLevel(fleetBase, L);
  if (lvl.action === "kill" && !f.killed) (f.killed = true), (f.killReason = lvl.reason);
  f.paused = lvl.action === "pause" ? lvl.reason : "";
  const mode = driftMode(now, cfg);

  for (const d of cfg.desks) {
    const s = st.desks[d.id];
    const bars = m.bars[d.timeframeSec] ?? [];
    const drift = () => {
      const r = computeDrift({ mode, strategy: d.strategy, trades: s.closed, entryTimes: s.entryTimes, txAttempts: [], txFailures: [], baseline: baselines[d.id] ?? null, now });
      const top = [...r.metrics].sort((a, b) => b.points - a.points)[0];
      s.drift = { score: r.score, level: r.level, top: top ? `${top.id} ${top.label}: ${top.value}` : "" };
      return r;
    };
    // 0) kill / halted -> flat
    if (f.killed || s.status === "halted") {
      for (const p of [...s.positions]) close(d, s, p, price, f.killed ? "global_kill" : "halt");
      drift();
      continue;
    }
    // 1) stop / take-profit
    for (const p of [...s.positions]) {
      const lo = m.lo ?? price, hi = m.hi ?? price;
      const slHit = p.stopLoss > 0 && (p.side === "long" ? lo <= p.stopLoss : hi >= p.stopLoss);
      const tpHit = p.takeProfit > 0 && (p.side === "long" ? hi >= p.takeProfit : lo <= p.takeProfit);
      if (slHit) close(d, s, p, m.lo !== undefined ? p.stopLoss : price, "stop_loss");
      else if (tpHit) close(d, s, p, p.takeProfit, "take_profit", true);
    }
    // 2) drift + desk limits
    const dr = drift();
    if (dr.halt) {
      halt(s, `drift: ${dr.halt}`);
      for (const p of [...s.positions]) close(d, s, p, price, "drift_halt");
      continue;
    }
    const eq = deskEquity(s, price);
    const gate = deskGate({ equity: eq, dayStartEquity: s.dayStart.equity, peakEquity: s.peak, lossStreak: s.lossStreak, pausedUntil: s.pausedUntil, entryTimes: s.entryTimes }, s.positions.length, L, now);
    if (gate.action === "halt") {
      halt(s, gate.reason);
      for (const p of [...s.positions]) close(d, s, p, price, "drawdown_halt");
      continue;
    }
    if (gate.action === "pause") (s.pausedUntil = gate.until), (s.lossStreak = 0);
    if (s.pausedUntil > now) (s.status = "paused"), (s.statusReason = gate.action === "pause" ? gate.reason : s.statusReason || "auto pause");
    else (s.status = "running"), (s.statusReason = "");

    // 3) manage
    const lastBar = bars[bars.length - 1];
    const newBar = !!lastBar && lastBar.t > s.lastBarT;
    const ctx: StrategyContext = { bars, price, now, fundingExtHourly: m.fundingHourly, fundingSamples: f.fundingSamples.map((x) => x.hourly), externalSkew: m.extSkew, trendBreakoutRecent: now - f.lastTrendEntry < 4 * 3600 };
    const strat = createOfficeStrategy(d);
    if (newBar || d.strategy === "funding") {
      for (const p of [...s.positions]) {
        const mg = strat.manage(ctx, p);
        if (mg.exit) close(d, s, p, price, mg.exit);
        else if (mg.newStop) p.stopLoss = mg.newStop;
      }
    }
    if (!newBar) continue;
    s.lastBarT = lastBar.t;

    // 4) entry
    const sig = strat.entry(ctx);
    if (!sig) {
      s.lastSignal = `no signal @ bar ${new Date(lastBar.t * 1000).toISOString().slice(5, 16)}Z`;
      continue;
    }
    const block = (why: string) => void (s.lastSignal = `${sig.side.toUpperCase()} signal blocked: ${why}`);
    if (f.killed) { block("global kill active"); continue; }
    if (s.status !== "running") { block(`desk ${s.status}`); continue; }
    if (f.paused) { block(f.paused); continue; }
    if (gate.action !== "ok") { block(gate.reason); continue; }
    if (d.strategy !== "funding") {
      const fg = fundingGuard(sig.side, m.fundingHourly, L);
      if (fg) { block(fg); continue; }
    }
    const stop = clampStop(sig.side, price, sig.stop, L.minStopPct, L.maxStopPct);
    if (!stop) { block(`stop beyond ${L.maxStopPct}%`); continue; }
    const tp = sig.takeProfit > 0 && (sig.side === "long" ? sig.takeProfit > price : sig.takeProfit < price) ? sig.takeProfit : 0;
    const fg = fleetGate(fleetBase, sig.side, L, now);
    if (fg.action !== "ok") { block(fg.reason); continue; }
    const sz = sizePosition({
      equity: eq, riskPct: dr.level === "amber" ? d.riskPct / 2 : d.riskPct, hardMaxRiskPct: L.hardMaxRiskPct, entry: price, stop, maxLeverage: d.maxLeverage,
      maxMarginPct: L.maxMarginPct, maxNotionalX: L.maxNotionalX, minMargin: SIM.minMargin, feeBufferPct: L.feeBufferPct, mmBps: SIM.mmBps,
      riskBudget: fg.riskBudget, notionalBudget: fg.notionalBudget, freeCollateral: s.free, openFeeBps: SIM.openFeeBps,
    });
    if (!sz.ok) { block(sz.reason); continue; }
    const fill = slip(price, sig.side === "long");
    const fee = (sz.notional * SIM.openFeeBps) / 10_000;
    const id = ++st.seq;
    s.free -= sz.margin + fee;
    s.positions = [...s.positions, { id, side: sig.side, margin: sz.margin, size: sz.notional, entry: fill, openedAt: now, stopLoss: stop, takeProfit: tp, pendingFunding: 0, risk: sz.riskAmount, decisionPrice: price, fee }];
    s.entryTimes = [...s.entryTimes.filter((t) => t > now - 7 * 86_400), now];
    fleetBase.entryTimes.push(now);
    fleetBase.open.push({ side: sig.side, size: sz.notional, price, stop, margin: sz.margin });
    if (d.strategy === "trend") f.lastTrendEntry = now;
    s.trades = [{ kind: "open" as const, id, side: sig.side, leverage: sz.leverage, price: fill, reason: sig.reason, at: now, seq: id }, ...s.trades].slice(0, 60);
    s.lastSignal = `opened ${sig.side.toUpperCase()} ${sz.leverage.toFixed(1)}× — ${sig.reason}`;
  }

  // drawdown stats + equity curve
  for (const d of cfg.desks) {
    const s = st.desks[d.id];
    const eq = deskEquity(s, price);
    s.peak = Math.max(s.peak, eq);
    s.maxDd = Math.max(s.maxDd, s.peak > 0 ? ((s.peak - eq) / s.peak) * 100 : 0);
  }
  const total = demoEquity(st, price);
  const lastH = st.history[st.history.length - 1];
  if (!lastH || now - lastH.t >= 300) st.history = thin([...st.history, { t: now, eq: Math.round(total * 100) / 100 }], 720);
  st.lastTick = now;
  return st;
}

/** Keep the curve bounded: drop every other point from the older half when over `max`. */
function thin(h: { t: number; eq: number }[], max: number) {
  if (h.length <= max) return h;
  const half = Math.floor(h.length / 2);
  return [...h.slice(0, half).filter((_, i) => i % 2 === 0), ...h.slice(half)];
}

export const closedBy = (bars: Candle[], gran: number, t: number) => bars.filter((b) => b.t + gran <= t);

/**
 * Catch up after the tab was closed: replay 15-minute bars (high/low for stops) from the last tick to now.
 * Gaps older than CATCHUP_MAX_SEC or the available history are recorded as "paused while away".
 */
export function catchUp(st: DemoState, hist: { m15: Candle[]; h1: Candle[]; h4: Candle[] }, now: number, fundingHourly: number, cfg: OfficeConfig = OFFICE, baselines: Record<string, Baseline> = BASELINES): DemoState {
  if (now - st.lastTick < 900) return st;
  const from = Math.max(st.lastTick, now - CATCHUP_MAX_SEC, (hist.m15[0]?.t ?? now) + 900);
  let out = st;
  if (from > st.lastTick + 900) out = { ...out, lastTick: from, away: [...out.away, { from: st.lastTick, to: from, mode: "paused" as const }].slice(-20) };
  const replay = hist.m15.filter((b) => b.t + 900 > out.lastTick && b.t + 900 <= now);
  if (!replay.length) return out;
  const start = out.lastTick;
  const byTf = (t: number): Record<number, Candle[]> => ({ 900: closedBy(hist.m15, 900, t).slice(-300), 3600: closedBy(hist.h1, 3600, t).slice(-300), 14400: closedBy(hist.h4, 14400, t).slice(-300) });
  for (const b of replay) out = step(out, { now: b.t + 900, price: b.c, hi: b.h, lo: b.l, bars: byTf(b.t + 900), fundingHourly, extSkew: 0 }, cfg, baselines);
  return { ...out, away: [...out.away, { from: start, to: out.lastTick, mode: "caught-up" as const }].slice(-20) };
}
