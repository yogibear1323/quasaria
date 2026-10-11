/**
 * Calibrated desk runner (layer 3 state owner). Per closed candle:
 *   snapshot (state engine) -> scorer (probabilities) -> policy (thresholds/weights/sizing) -> risk vetoes -> action.
 * Risk rules sit ABOVE the model and are evaluated in code on every candle: global kill switch (flatten + halt),
 * max open positions, desk daily loss, desk drawdown halt (flatten), loss-streak pause, entries/day, 2 % hard cap.
 *
 * Modes (none of them sends an order from this class):
 *   "shadow" (default) scores and logs every candle; no paper positions.
 *   "paper"  scores, logs and opens SIMULATED paper fills (fees, slippage, funding); never an on-chain order. Allowed even
 *            when the model failed the strategy gate (labelled "paper · failed gate"); same risk vetoes and sizing caps.
 *   "desk" / "live"  real on-chain TESTNET orders, routed by the fleet (fleet.ts stepCalibratedLive) through the
 *            stale-data breaker. Refused in code on any network other than testnet, and refused unless the model passed
 *            the strategy gate OR the config carries the explicit override `liveOverride: "testnet-tiny"` (Robert,
 *            Oct 10 2026) with tiny-slice limits (daily loss $, slice drawdown kill $, entries/day, 1 open).
 * Every decision and every resolved outcome is appended to calibration.jsonl (the nightly review reads it).
 */
import { appendFileSync, existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Candle } from "../indicators.js";
import { deskGate } from "../risk.js";
import { sizePosition } from "../sizing.js";
import type { CalibratedDeskConfig, LimitsConfig } from "../types.js";
import { QUESTIONS, score, type CalibratedModel, type Probabilities, type Question } from "./model.js";
import { markPaper, openPaper, resolveQuestions, stepPaper, type PaperTrade } from "./outcomes.js";
import { decide, type Decision } from "./policy.js";
import { fillGaps, snapshotAt, type LiveExtras } from "./snapshot.js";

export type { CalibratedDeskConfig };
export interface DecisionRow {
  t: number; // decision time (unix s)
  barT: number;
  price: number;
  side: "long" | "short";
  p: Decision["pSide"];
  score: number;
  action: string; // "paper long" | "skip: ..." | "veto: ..."
  fired: boolean;
  riskPct: number;
  sizing: Decision["sizing"];
  result: string | null; // filled when resolved
  pnl: number | null;
}
export interface ShadowState {
  status: "running" | "paused" | "halted";
  statusReason: string;
  equity: number;
  startEquity: number;
  peakEquity: number;
  dayStart: { day: number; equity: number };
  lossStreak: number;
  pausedUntil: number;
  entryTimes: number[];
  lastBarT: number;
  open: (PaperTrade & { decisionT: number }) | null;
  pending: { t: number; barT: number; atr: number; rv96: number; probs: Probabilities }[];
  decisions: DecisionRow[];
  closed: { side: string; pnl: number; reason: string; openedBarT: number; exitBarT: number; r: number }[];
  cal: Record<Question, { n: number; brierSum: number; hits: number }>;
  /** live testnet slice */
  liveSince?: number;
  liveOpen?: LiveOpen | null;
  liveFills?: LiveFill[];
  flattenReq?: boolean;
  paperClosed?: ShadowState["closed"];
}
export interface LiveOpen {
  id: number; side: "long" | "short"; entry: number; decisionPrice: number; stop: number; takeProfit: number; size: number; margin: number;
  leverage: number; fee: number; riskAmount: number; openedAt: number; openedBarT: number; decisionT: number; tx: string; minSizeBump: boolean;
}
export interface LiveFill {
  kind: "open" | "close"; id: number; side: "long" | "short"; price: number; refPrice: number; slippageBps: number; fee: number;
  pnl: number | null; reason: string; tx: string; at: number;
}
export interface LiveIntent { side: "long" | "short"; riskPct: number; decisionT: number; barT: number; price: number; atr: number }

/** Size a tiny-slice order: risk-based, capped leverage, bumped to the vault's minimum margin if needed (reported). */
export function sliceSize(a: { equity: number; riskPct: number; hardMaxRiskPct: number; entry: number; stop: number; maxLeverage: number; minMargin: number; openFeeBps: number; free: number; mmBps: number }) {
  const stopDist = Math.abs(a.entry - a.stop) / a.entry;
  if (!(stopDist > 0)) return { ok: false as const, reason: "zero stop distance" };
  const target = (a.equity * Math.min(a.riskPct, a.hardMaxRiskPct)) / 100;
  let notional = target / stopDist;
  let margin = notional / a.maxLeverage;
  let bumped = false;
  if (margin < a.minMargin) (margin = a.minMargin), (bumped = true);
  let lev = Math.min(a.maxLeverage, Math.max(1, notional / margin));
  notional = margin * lev;
  const riskAmount = notional * stopDist;
  const fee = (notional * a.openFeeBps) / 10_000;
  if (riskAmount > (a.equity * a.hardMaxRiskPct) / 100) return { ok: false as const, reason: `min-size order risks ${riskAmount.toFixed(2)} > ${a.hardMaxRiskPct}% hard cap` };
  if (stopDist > (1 / lev - a.mmBps / 10_000) / 2) return { ok: false as const, reason: "stop too wide for leverage (liquidation rule)" };
  if (margin + fee > a.free) return { ok: false as const, reason: `free collateral ${a.free.toFixed(2)} < margin+fee ${(margin + fee).toFixed(2)}` };
  lev = Math.round(lev * 100) / 100;
  return { ok: true as const, margin: Math.round(margin * 1e4) / 1e4, leverage: lev, leverageBps: Math.round(lev * 10_000), notional: margin * lev, riskAmount: margin * lev * stopDist, targetRisk: target, fee, bumped };
}
const emptyCal = () => Object.fromEntries(QUESTIONS.map((q) => [q, { n: 0, brierSum: 0, hits: 0 }])) as ShadowState["cal"];
export const newShadowState = (capital: number): ShadowState => ({
  status: "running", statusReason: "", equity: capital, startEquity: capital, peakEquity: capital, dayStart: { day: -1, equity: capital }, lossStreak: 0,
  pausedUntil: 0, entryTimes: [], lastBarT: 0, open: null, pending: [], decisions: [], closed: [], cal: emptyCal(),
});

export interface StepInput {
  now: number;
  killed: boolean;
  killReason?: string;
  bars: Candle[]; // closed or not; the desk filters to closed bars itself
  extras: LiveExtras;
  /** stale-data breaker state: entries halted while tripped (reduce-only/closes still allowed) */
  stale?: { tripped: boolean; reason: string };
  /** live mode: chain equity (free + margin + uPnL) and open position count from the fleet */
  liveEquity?: number;
  liveOpenCount?: number;
}

export class ShadowDesk {
  readonly mode: "shadow" | "paper" | "desk" | "live";
  private intent: LiveIntent | null = null;
  readonly modeNote: string;
  state: ShadowState;
  constructor(
    readonly cfg: CalibratedDeskConfig, readonly model: CalibratedModel, readonly limits: LimitsConfig, readonly dir: string,
    private readonly log: (m: string) => void = () => undefined, readonly env: { network: string } = { network: "paper" },
  ) {
    if ((cfg.mode === "desk" || cfg.mode === "live") && env.network !== "testnet") {
      this.mode = "shadow";
      this.modeNote = `live mode refused: network "${env.network}" is not testnet — running in shadow (no orders)`;
      log(`[${cfg.id}] ${this.modeNote}`);
    } else if ((cfg.mode === "desk" || cfg.mode === "live") && !model.gate.passed && cfg.liveOverride !== "testnet-tiny") {
      this.mode = "shadow";
      this.modeNote = "desk mode refused: model did not pass the strategy gate — running in shadow (no orders)";
      log(`[${cfg.id}] ${this.modeNote}`);
    } else if (cfg.mode === "desk" || cfg.mode === "live") {
      this.mode = "live";
      this.modeNote = model.gate.passed
        ? "live testnet: on-chain testnet orders (test funds only)"
        : `live testnet · tiny slice · failed gate: on-chain testnet orders, test funds only (override approved: ${cfg.liveApproval ?? "?"})`;
    } else {
      this.mode = cfg.mode;
      this.modeNote =
        cfg.mode === "shadow" ? "shadow: scores and logs only; no paper positions, never sends orders"
        : cfg.mode === "paper" ? `${model.gate.passed ? "paper" : "paper · failed gate"}: simulated fills only (fees, slippage, funding); never sends an on-chain order`
        : "desk";
    }
    if (model.timeframeSec !== cfg.timeframeSec) throw new Error(`${cfg.id}: model timeframe ${model.timeframeSec} != desk ${cfg.timeframeSec}`);
    this.state = this.load();
    if (this.mode === "live" && !this.state.liveSince) {
      // fresh slice accounting: paper history is kept separately, equity re-based to the live allocation
      const s = this.state;
      s.paperClosed = s.closed;
      Object.assign(s, { closed: [], entryTimes: [], equity: cfg.capital, startEquity: cfg.capital, peakEquity: cfg.capital, dayStart: { day: -1, equity: cfg.capital }, lossStreak: 0, liveOpen: null, liveFills: [], flattenReq: false, open: null });
      s.liveSince = Math.floor(Date.now() / 1000);
      if (s.status === "halted") (s.status = "running"), (s.statusReason = "");
    }
  }
  get isLive() { return this.mode === "live"; }
  takeIntent() { const i = this.intent; this.intent = null; return i; }
  private row(t: number) { return this.state.decisions.find((d) => d.t === t); }
  recordLiveBlocked(t: number, reason: string) {
    const r = this.row(t);
    if (r) (r.action = `veto: ${reason}`), (r.fired = false);
    this.journal({ type: "live_blocked", t, reason });
    this.log(`[${this.cfg.id}] live order blocked: ${reason}`);
  }
  recordLiveOpen(o: LiveOpen, at: number) {
    const s = this.state;
    s.liveOpen = o;
    s.entryTimes.push(at);
    const slip = ((o.side === "long" ? o.entry - o.decisionPrice : o.decisionPrice - o.entry) / o.decisionPrice) * 10_000;
    (s.liveFills ??= []).push({ kind: "open", id: o.id, side: o.side, price: o.entry, refPrice: o.decisionPrice, slippageBps: Math.round(slip * 10) / 10, fee: o.fee, pnl: null, reason: "entry", tx: o.tx, at });
    s.liveFills = s.liveFills.slice(-50);
    const r = this.row(o.decisionT);
    if (r) (r.action = `LIVE ${o.side} #${o.id} · margin ${o.margin.toFixed(2)} × ${o.leverage}${o.minSizeBump ? " (vault min size)" : ""} · risk ${o.riskAmount.toFixed(2)}`), (r.fired = true);
    this.journal({ type: "live_open", ...o, slippageBps: slip });
  }
  recordLiveClose(c: { exit: number; refPrice: number; payout: number | null; grossPnl: number; reason: string; tx: string; at: number }) {
    const s = this.state, o = s.liveOpen;
    if (!o) return;
    const net = c.grossPnl - o.fee;
    s.closed.push({ side: o.side, pnl: net, reason: c.reason, openedBarT: o.openedBarT, exitBarT: c.at, r: o.riskAmount ? net / o.riskAmount : 0 });
    s.lossStreak = net > 0 ? 0 : s.lossStreak + 1;
    const slip = ((o.side === "long" ? c.refPrice - c.exit : c.exit - c.refPrice) / c.refPrice) * 10_000;
    (s.liveFills ??= []).push({ kind: "close", id: o.id, side: o.side, price: c.exit, refPrice: c.refPrice, slippageBps: Math.round(slip * 10) / 10, fee: 0, pnl: net, reason: c.reason, tx: c.tx, at: c.at });
    s.liveFills = s.liveFills.slice(-50);
    const r = this.row(o.decisionT);
    if (r) (r.result = `${c.reason} ${net >= 0 ? "+" : ""}${net.toFixed(2)}`), (r.pnl = net);
    this.journal({ type: "live_close", id: o.id, ...c, netPnl: net, fee: o.fee });
    this.log(`[${this.cfg.id}] LIVE close #${o.id} ${c.reason} net ${net.toFixed(4)} (fee ${o.fee.toFixed(4)}) tx ${c.tx}`);
    s.liveOpen = null;
  }

  private file() { return join(this.dir, `calibrated-${this.cfg.id}.json`); }
  private load(): ShadowState {
    const p = this.file();
    if (!existsSync(p)) return newShadowState(this.cfg.capital);
    try { return { ...newShadowState(this.cfg.capital), ...(JSON.parse(readFileSync(p, "utf8")) as ShadowState) }; } catch { return newShadowState(this.cfg.capital); }
  }
  save() {
    const s = this.state;
    s.decisions = s.decisions.slice(-200);
    s.closed = s.closed.slice(-200);
    s.entryTimes = s.entryTimes.slice(-50);
    writeFileSync(`${this.file()}.tmp`, JSON.stringify(s), { mode: 0o600 });
    renameSync(`${this.file()}.tmp`, this.file());
  }
  private journal(e: Record<string, unknown>) {
    appendFileSync(join(this.dir, "calibration.jsonl"), JSON.stringify({ at: new Date().toISOString(), desk: this.cfg.id, ...e }) + "\n", { mode: 0o600 });
  }

  private closePaper(exitBarT: number, exit: number, reason: string, pnl: number) {
    const s = this.state, o = s.open!;
    s.equity += pnl;
    s.closed.push({ side: o.side, pnl, reason, openedBarT: o.openedBarT, exitBarT, r: o.riskAmount ? pnl / o.riskAmount : 0 });
    s.lossStreak = pnl > 0 ? 0 : s.lossStreak + 1;
    const row = s.decisions.find((d) => d.t === o.decisionT);
    if (row) (row.result = `${reason} ${pnl >= 0 ? "+" : ""}${pnl.toFixed(2)}`), (row.pnl = pnl);
    this.journal({ type: "paper_close", decisionT: o.decisionT, side: o.side, entry: o.entry, exit, reason, pnl, equity: s.equity });
    this.log(`[${this.cfg.id}] paper ${o.side} closed ${reason} pnl ${pnl.toFixed(2)} (${this.mode}, no order)`);
    s.open = null;
  }

  private halt(reason: string) {
    const s = this.state;
    if (s.status !== "halted") this.journal({ type: "halt", reason }), this.log(`[${this.cfg.id}] HALT: ${reason}`);
    s.status = "halted";
    s.statusReason = reason;
  }

  /** Admin commands from the fleet control queue (pause/resume/flatten/halt/reset). */
  command(cmd: string) {
    const s = this.state;
    if (cmd === "flatten" && s.open) this.closePaper(s.lastBarT, s.open.ref, "flatten", 0);
    else if (cmd === "halt") this.halt("halted by admin");
    else if (cmd === "pause") (s.status = s.status === "halted" ? s.status : "paused"), (s.pausedUntil = 4_102_444_800);
    else if (cmd === "resume" && s.status === "paused") (s.status = "running"), (s.pausedUntil = 0);
    else if (cmd === "reset" && s.status === "halted") (s.status = "running"), (s.statusReason = ""), (s.peakEquity = s.equity), (s.lossStreak = 0), (s.pausedUntil = 0);
    this.journal({ type: "command", cmd });
  }

  /** One loop. Returns the decision row for a new candle, or null if no new closed candle. */
  step(inp: StepInput): DecisionRow | null {
    const s = this.state, gran = this.cfg.timeframeSec, T = this.model.horizonBars;
    const closed = fillGaps(inp.bars.filter((b) => b.t + gran <= inp.now), gran);
    const last = closed[closed.length - 1];
    const mark = () => (s.open && last ? markPaper(s.open, last.c) : 0);

    // RULE 0 — global kill switch: flatten and halt, before anything else
    if (inp.killed) {
      if (this.isLive) s.flattenReq = true;
      if (s.open && last) this.closePaper(last.t, last.c, "global_kill", mark());
      this.halt(`global kill: ${inp.killReason ?? "kill switch"}`);
    }
    if (!last || last.t <= s.lastBarT) return null;
    const newBars = closed.filter((b) => b.t > s.lastBarT);

    // manage the open paper trade on the new bars (stop first, gaps at the open, time exit)
    if (s.open) {
      const r = stepPaper(s.open, newBars, gran);
      if (r) this.closePaper(r.exitBarT, r.exit, r.reason, r.pnl);
    }
    // resolve pending outcomes (calibration log)
    const still: ShadowState["pending"] = [];
    for (const p of s.pending) {
      const y = resolveQuestions(closed, p.barT, gran, T, p.atr, p.rv96, this.model.geometry);
      if (!y) { if (last.t - p.barT < (T + 48) * gran) still.push(p); continue; }
      for (const q of QUESTIONS) {
        const c = s.cal[q];
        c.n++; c.brierSum += (p.probs[q] - y[q]) ** 2; c.hits += y[q];
      }
      const row = s.decisions.find((d) => d.t === p.t);
      if (row && !row.fired && row.result === null) row.result = `would have ${y[row.side === "long" ? "setup_long" : "setup_short"] ? "won" : "lost"}`;
      this.journal({ type: "outcome", t: p.t, barT: p.barT, probs: p.probs, outcomes: y });
    }
    s.pending = still;
    s.lastBarT = last.t;

    // equity / day bookkeeping (paper)
    const live = this.isLive;
    if (live && inp.liveEquity !== undefined) s.equity = inp.liveEquity;
    const eqNow = live ? s.equity : s.equity + mark();
    const day = Math.floor(inp.now / 86_400);
    if (s.dayStart.day !== day) s.dayStart = { day, equity: eqNow };
    s.peakEquity = Math.max(s.peakEquity, eqNow);

    const decisionTs = last.t + gran;
    const snap = snapshotAt(closed, gran, decisionTs, inp.extras);
    if (!snap) {
      this.log(`[${this.cfg.id}] not enough closed bars for a snapshot`);
      return null;
    }
    const probs = score(this.model, snap);
    const d = decide(this.model, probs, { deskRiskPct: this.cfg.riskPct, hardMaxRiskPct: this.limits.hardMaxRiskPct });

    // risk vetoes (code, above the model)
    let veto = "";
    const openN = live ? (inp.liveOpenCount ?? (s.liveOpen ? 1 : 0)) : s.open ? 1 : 0;
    const L = this.cfg.live;
    let sliceVeto = "";
    if (live && L) {
      const dd = s.startEquity - eqNow, dayLoss = s.dayStart.equity - eqNow;
      if (dd >= L.killDrawdownUsd && s.status !== "halted" && !(s.status === "paused" && s.pausedUntil >= 4_102_444_800)) {
        s.status = "paused";
        s.pausedUntil = 4_102_444_800;
        s.statusReason = `slice drawdown kill: down ${dd.toFixed(2)} >= ${L.killDrawdownUsd} — flattened and paused (resume manually)`;
        s.flattenReq = true;
        this.journal({ type: "slice_kill", drawdown: dd });
        this.log(`[${this.cfg.id}] ${s.statusReason}`);
      }
      if (dayLoss >= L.dailyLossUsd) sliceVeto = `slice daily loss ${dayLoss.toFixed(2)} >= ${L.dailyLossUsd}`;
      else if (s.entryTimes.filter((t) => t > inp.now - 86_400).length >= L.maxEntriesPerDay) sliceVeto = `max ${L.maxEntriesPerDay} trades/day`;
      else if (openN >= L.maxOpen) sliceVeto = `max ${L.maxOpen} open position`;
    }
    const gate = deskGate({ equity: eqNow, dayStartEquity: s.dayStart.equity, peakEquity: s.peakEquity, lossStreak: s.lossStreak, pausedUntil: s.pausedUntil, entryTimes: s.entryTimes }, openN, { ...this.limits, maxOpenPerDesk: 1 }, inp.now);
    if (gate.action === "halt") {
      if (s.open) this.closePaper(last.t, last.c, "drawdown_halt", mark());
      if (live) s.flattenReq = true;
      this.halt(gate.reason);
    } else if (gate.action === "pause") {
      s.pausedUntil = gate.until;
      s.lossStreak = 0;
    }
    if (s.status !== "halted") s.status = s.pausedUntil > inp.now ? "paused" : "running";
    if (inp.killed) veto = "global kill active";
    else if (inp.stale?.tripped) veto = `STALE DATA · entries halted: ${inp.stale.reason}`;
    else if (s.status === "halted") veto = `halted: ${s.statusReason}`;
    else if (s.status === "paused" && s.pausedUntil > inp.now) veto = `paused: ${s.statusReason}`;
    else if (gate.action !== "ok") veto = gate.reason;
    else if (sliceVeto) veto = sliceVeto;
    else if (openN) veto = "position already open (max 1)";
    else if (this.mode === "shadow" && d.fire) veto = "shadow mode: no paper positions";

    let action: string, fired = false, riskPct = 0;
    if (!d.fire) action = `skip: ${d.failed.join(", ")}`;
    else if (veto) action = `veto: ${veto}`;
    else if (live) {
      // the fleet sizes and routes the on-chain order (pre-order stale check, vault minimums, triggers)
      this.intent = { side: d.side, riskPct: d.riskPct, decisionT: decisionTs, barT: last.t, price: snap.price, atr: snap.atr };
      action = `order: ${d.side} · risk ${d.riskPct.toFixed(2)}% (${d.sizing}) · routing on-chain`;
      riskPct = d.riskPct;
    } else {
      const stopPx = d.side === "long" ? snap.price * (1 - Math.max(0.008, Math.min(0.075, (this.model.geometry.slAtr * snap.atr) / snap.price))) : snap.price * (1 + Math.max(0.008, Math.min(0.075, (this.model.geometry.slAtr * snap.atr) / snap.price)));
      const L = this.limits;
      const sz = sizePosition({
        equity: eqNow, riskPct: d.riskPct, hardMaxRiskPct: L.hardMaxRiskPct, entry: snap.price, stop: stopPx, maxLeverage: this.cfg.maxLeverage, maxMarginPct: L.maxMarginPct,
        maxNotionalX: L.maxNotionalX, minMargin: 10, feeBufferPct: L.feeBufferPct, mmBps: 50,
      });
      if (!sz.ok) action = `veto: sizing — ${sz.reason}`;
      else {
        fired = true;
        riskPct = d.riskPct;
        s.open = { ...openPaper(d.side, snap.price, snap.atr, this.model.geometry, last.t, gran, T, sz.notional, sz.riskAmount, inp.extras.fundingHourly), decisionT: decisionTs };
        s.entryTimes.push(inp.now);
        action = `paper ${d.side} · risk ${d.riskPct.toFixed(2)}% (${d.sizing}) · notional ${sz.notional.toFixed(0)}`;
        this.log(`[${this.cfg.id}] ${action} (${this.mode}, simulated fill, no order)`);
      }
    }
    const row: DecisionRow = { t: decisionTs, barT: last.t, price: snap.price, side: d.side, p: d.pSide, score: d.score, action, fired, riskPct, sizing: fired ? d.sizing : "none", result: null, pnl: null };
    s.decisions.push(row);
    s.pending.push({ t: decisionTs, barT: last.t, atr: snap.atr, rv96: snap.realizedVol, probs });
    this.journal({ type: "decision", mode: this.mode, t: decisionTs, barT: last.t, snapshot: snap, probs, decision: d, veto: veto || null, action });
    return row;
  }

  status() {
    const s = this.state;
    const cal = Object.fromEntries(QUESTIONS.map((q) => {
      const c = s.cal[q];
      const base = c.n ? c.hits / c.n : 0;
      return [q, { n: c.n, brier: c.n ? +(c.brierSum / c.n).toFixed(4) : null, climatology: c.n ? +(base * (1 - base)).toFixed(4) : null }];
    }));
    const wins = s.closed.filter((t) => t.pnl > 0).length;
    return {
      id: this.cfg.id, name: this.cfg.name, mode: this.mode, modeNote: this.modeNote, label: this.cfg.label, timeframeSec: this.cfg.timeframeSec,
      status: s.status, reason: s.statusReason, equity: +s.equity.toFixed(4), startEquity: s.startEquity, paperPnl: +(s.equity - s.startEquity).toFixed(4),
      paperTrades: s.closed.length, paperWins: wins, open: s.open ? { side: s.open.side, entry: s.open.entry, stop: s.open.stop, takeProfit: s.open.takeProfit, notional: +s.open.notional.toFixed(2) } : null,
      thresholds: this.model.thresholds, weights: this.model.weights, sizing: this.model.calibration.verified ? "quarter-Kelly (calibration verified)" : `fixed ${this.model.sizing.fixedRiskPct}% (calibration not verified)`,
      model: { trainedAt: this.model.trainedAt, gatePassed: this.model.gate.passed, gate: this.model.gate.summary, calibrationNote: this.model.calibration.note },
      live: this.isLive ? {
        since: s.liveSince ?? null, capital: this.cfg.capital, riskPct: this.cfg.riskPct, maxLeverage: this.cfg.maxLeverage, limits: this.cfg.live ?? null,
        approval: this.cfg.liveApproval ?? null, override: this.cfg.liveOverride ?? null,
        open: s.liveOpen ? { id: s.liveOpen.id, side: s.liveOpen.side, entry: s.liveOpen.entry, stop: s.liveOpen.stop, takeProfit: s.liveOpen.takeProfit, margin: s.liveOpen.margin, leverage: s.liveOpen.leverage, tx: s.liveOpen.tx } : null,
        fills: (s.liveFills ?? []).slice(-10).reverse(),
        tradesToday: s.entryTimes.filter((t) => t > Math.floor(Date.now() / 1000) - 86_400).length,
      } : null,
      calibrationLive: cal,
      decisions: s.decisions.slice(-40).reverse().map((d) => ({ ...d, score: +d.score.toFixed(3), p: Object.fromEntries(Object.entries(d.p).map(([k, v]) => [k, +v.toFixed(3)])) })),
    };
  }
}
