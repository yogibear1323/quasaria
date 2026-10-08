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
 *   "desk"   (live testnet orders) is refused in code unless the model file says it passed the strategy gate; until then
 *            the desk is forced to shadow.
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
}

export class ShadowDesk {
  readonly mode: "shadow" | "paper" | "desk";
  readonly modeNote: string;
  state: ShadowState;
  constructor(readonly cfg: CalibratedDeskConfig, readonly model: CalibratedModel, readonly limits: LimitsConfig, readonly dir: string, private readonly log: (m: string) => void = () => undefined) {
    if (cfg.mode === "desk" && !model.gate.passed) {
      this.mode = "shadow";
      this.modeNote = "desk mode refused: model did not pass the strategy gate — running in shadow (no orders)";
      log(`[${cfg.id}] ${this.modeNote}`);
    } else {
      this.mode = cfg.mode;
      this.modeNote =
        cfg.mode === "shadow" ? "shadow: scores and logs only; no paper positions, never sends orders"
        : cfg.mode === "paper" ? `${model.gate.passed ? "paper" : "paper · failed gate"}: simulated fills only (fees, slippage, funding); never sends an on-chain order`
        : "desk";
    }
    if (model.timeframeSec !== cfg.timeframeSec) throw new Error(`${cfg.id}: model timeframe ${model.timeframeSec} != desk ${cfg.timeframeSec}`);
    this.state = this.load();
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
    const eqNow = s.equity + mark();
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
    const gate = deskGate({ equity: eqNow, dayStartEquity: s.dayStart.equity, peakEquity: s.peakEquity, lossStreak: s.lossStreak, pausedUntil: s.pausedUntil, entryTimes: s.entryTimes }, s.open ? 1 : 0, { ...this.limits, maxOpenPerDesk: 1 }, inp.now);
    if (gate.action === "halt") {
      if (s.open) this.closePaper(last.t, last.c, "drawdown_halt", mark());
      this.halt(gate.reason);
    } else if (gate.action === "pause") {
      s.pausedUntil = gate.until;
      s.lossStreak = 0;
    }
    if (s.status !== "halted") s.status = s.pausedUntil > inp.now ? "paused" : "running";
    if (inp.killed) veto = "global kill active";
    else if (s.status === "halted") veto = `halted: ${s.statusReason}`;
    else if (gate.action !== "ok") veto = gate.reason;
    else if (s.open) veto = "position already open (max 1)";
    else if (this.mode === "shadow" && d.fire) veto = "shadow mode: no paper positions";

    let action: string, fired = false, riskPct = 0;
    if (!d.fire) action = `skip: ${d.failed.join(", ")}`;
    else if (veto) action = `veto: ${veto}`;
    else {
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
      calibrationLive: cal,
      decisions: s.decisions.slice(-40).reverse().map((d) => ({ ...d, score: +d.score.toFixed(3), p: Object.fromEntries(Object.entries(d.p).map(([k, v]) => [k, +v.toFixed(3)])) })),
    };
  }
}
