/**
 * Back Office fleet runner: one loop drives every desk —
 * snapshot -> commands/kill -> oracle guard -> reconcile journal vs chain -> equity/limits -> triggers -> drift ->
 * manage open positions -> gated, risk-sized entries -> status document.
 * Halts close the desk's positions; the global kill closes everything and blocks entries until `unkill`.
 */
import { computeDrift, type Baseline, type DriftResult } from "./drift.js";
import type { Candle } from "./indicators.js";
import { oracleVerdict, type OracleVerdict } from "./oracleGuard.js";
import type { ReferenceFeed } from "./marketData.js";
import { deskGate, drawdownPct, dailyLossPct, fleetGate, fleetLevel, fundingGuard, riskToStop, toOpenRisk } from "./risk.js";
import { clampStop, sizePosition } from "./sizing.js";
import { reconcile, type DeskState, type FleetStateFile, type JournalOpen, type Store } from "./store.js";
import { createOfficeStrategy, type OfficeStrategy, type StrategyContext } from "./strategies.js";
import type { ChainPosition, DeskConfig, DriftMode, OfficeConfig } from "./types.js";
import type { DeskKeys, OfficeVenue, VaultMarket } from "./venue.js";

export type RunMode = "live" | "paper" | "dry-run";
export interface FleetOptions {
  mode: RunMode;
  baselines: Record<string, Baseline>;
  log?: (m: string) => void;
  now?: () => number;
  vaultId?: string;
  explorer?: string;
}

const clamp = (v: number, b: number) => Math.max(-Math.abs(b), Math.min(Math.abs(b), v));
const pnlAt = (p: ChainPosition, price: number) => ((p.side === "long" ? price - p.entry : p.entry - price) / p.entry) * p.size;

export function fundingRates(m: VaultMarket, fleetLong: number, fleetShort: number) {
  const f = m.funding;
  const capInt = (f.capPerHour * f.interval) / 3600;
  const toHour = (r: number) => (f.interval > 0 ? (r * 3600) / f.interval : 0);
  const extSkew = m.longOi - fleetLong - (m.shortOi - fleetShort);
  const extPrem = f.skewScale > 0 ? clamp((f.k * extSkew) / f.skewScale, f.maxPremium) : 0;
  return {
    extSkew,
    extHourly: toHour(clamp(extPrem + f.interestPerInterval, capInt)),
    predictedHourly: toHour(clamp(f.premiumTwap + f.interestPerInterval, capInt)),
  };
}

export class Fleet {
  readonly strategies: Record<string, OfficeStrategy>;
  lastStatus: Record<string, unknown> | null = null;
  private flattenReq = new Set<string>();
  private readonly log: (m: string) => void;
  private readonly now: () => number;

  constructor(
    readonly cfg: OfficeConfig,
    readonly venue: OfficeVenue,
    readonly keys: Record<string, DeskKeys>,
    readonly store: Store,
    readonly ref: ReferenceFeed,
    readonly opts: FleetOptions,
  ) {
    this.strategies = Object.fromEntries(cfg.desks.map((d) => [d.id, createOfficeStrategy(d)]));
    this.log = opts.log ?? ((m) => console.log(m));
    this.now = opts.now ?? (() => Math.floor(Date.now() / 1000));
  }

  driftMode(now: number): DriftMode {
    if (this.cfg.strictUntil && now * 1000 < Date.parse(this.cfg.strictUntil)) return "strict";
    return this.cfg.driftMode;
  }

  private async tx<T>(deskId: string, s: DeskState, what: string, fn: () => Promise<T>): Promise<T | null> {
    s.txAttempts.push(this.now());
    try {
      return await fn();
    } catch (e) {
      s.txFailures.push(this.now());
      const msg = (e as Error).message;
      this.log(`[${deskId}] ${what} failed: ${msg}`);
      this.store.journal({ desk: deskId, type: "tx_error", what, error: msg });
      return null;
    }
  }

  private recordClose(deskId: string, s: DeskState, id: number, c: { pnl: number; exit: number; reason: string; tx: string }) {
    const j = s.open[String(id)];
    if (!j) {
      this.store.journal({ desk: deskId, type: "close_unknown", id, ...c });
      return;
    }
    const adverse = j.side === "long" ? (j.entry - j.decisionPrice) / j.decisionPrice : (j.decisionPrice - j.entry) / j.decisionPrice;
    const t = {
      id, side: j.side, entry: j.entry, exit: c.exit, size: j.size, reason: c.reason, tx: c.tx, pnl: c.pnl,
      r: j.riskAmount > 0 ? c.pnl / j.riskAmount : 0, slippagePct: Math.max(0, adverse * 100), fundingPnl: -j.lastPendingFunding,
      openedAt: j.openedAt, closedAt: this.now(),
    };
    s.closed.push(t);
    delete s.open[String(id)];
    s.lossStreak = c.pnl > 0 ? 0 : s.lossStreak + 1;
    this.store.journal({ desk: deskId, type: "close", ...t });
    this.log(`[${deskId}] CLOSE #${id} ${j.side} ${c.reason} pnl ${c.pnl.toFixed(4)} (${t.r.toFixed(2)}R) tx ${c.tx}`);
  }

  private async flatten(d: DeskConfig, s: DeskState, positions: ChainPosition[], price: number, why: string) {
    for (const p of positions) {
      const r = await this.tx(d.id, s, `close #${p.id} (${why})`, () => this.venue.close(this.keys[d.id], p.id));
      if (r) this.recordClose(d.id, s, p.id, { pnl: r.value.payout - p.margin, exit: price, reason: why, tx: r.hash });
    }
  }

  private halt(d: DeskConfig, s: DeskState, reason: string) {
    if (s.status !== "halted") {
      this.log(`[${d.id}] HALT: ${reason}`);
      this.store.journal({ desk: d.id, type: "halt", reason });
    }
    s.status = "halted";
    s.statusReason = reason;
  }

  private applyCommands(f: FleetStateFile, desks: Record<string, DeskState>) {
    for (const c of this.store.drain()) {
      this.store.journal({ type: "command", ...c });
      this.log(`command: ${JSON.stringify(c)}`);
      if (c.cmd === "kill") {
        f.killed = true;
        f.killReason = c.reason ?? `manual kill${c.by ? ` (${c.by})` : ""}`;
        f.killedAt = this.now();
        this.store.setKillFlag(f.killReason);
        continue;
      }
      if (c.cmd === "unkill") {
        f.killed = false;
        f.killReason = "";
        f.oracleBadSince = 0;
        this.store.clearKillFlag();
        continue;
      }
      if (!("desk" in c)) continue;
      const ids = c.desk === "all" ? Object.keys(desks) : [c.desk];
      for (const id of ids) {
        const s = desks[id];
        if (!s) continue;
        if (c.cmd === "pause") {
          s.manualPause = true;
          if (s.status !== "halted") (s.status = "paused"), (s.statusReason = "paused by admin");
        } else if (c.cmd === "resume") {
          s.manualPause = false;
          if (s.status === "paused") (s.status = "running"), (s.statusReason = "");
        } else if (c.cmd === "flatten") this.flattenReq.add(id);
        else if (c.cmd === "halt") {
          s.status = "halted";
          s.statusReason = "halted by admin";
        } else if (c.cmd === "reset") {
          if (s.status === "halted") {
            s.status = s.manualPause ? "paused" : "running";
            s.statusReason = "";
            s.peakEquity = 0; // re-based on next equity read
            s.lossStreak = 0;
            s.pausedUntil = 0;
          }
        }
      }
    }
  }

  async step() {
    const now = this.now();
    const f = this.store.fleet();
    const states: Record<string, DeskState> = Object.fromEntries(this.cfg.desks.map((d) => [d.id, this.store.desk(d.id)]));
    this.applyCommands(f, states);
    if (this.store.killFlag() && !f.killed) {
      f.killed = true;
      f.killReason = "KILL flag file";
      f.killedAt = now;
    }

    let m: VaultMarket;
    try {
      m = await this.venue.market();
    } catch (e) {
      this.log(`market snapshot failed: ${(e as Error).message}`);
      for (const d of this.cfg.desks) this.store.saveDesk(d.id, states[d.id]);
      this.store.saveFleet(f);
      return this.lastStatus;
    }
    const refPrice = await this.ref.ticker().catch(() => null);
    f.oracleHistory.push({ t: now, oracle: m.oraclePrice, ref: refPrice });
    const ov = oracleVerdict(now, m.oracleTs, f.oracleHistory, this.cfg.oracle);
    if (ov.level === "halt") f.oracleBadSince ||= now;
    else f.oracleBadSince = 0;
    if (!f.killed && f.oracleBadSince && now - f.oracleBadSince > this.cfg.oracle.killAfterBadSec) this.kill(f, `oracle unhealthy > ${this.cfg.oracle.killAfterBadSec}s: ${ov.reasons.join("; ")}`);

    const bars: Record<number, Candle[]> = {};
    for (const tf of new Set(this.cfg.desks.map((d) => d.timeframeSec))) bars[tf] = await this.ref.closedBars(tf, now).catch(() => []);

    // chain views
    const views: Record<string, { free: number; positions: ChainPosition[] } | null> = {};
    for (const d of this.cfg.desks) {
      if (!this.keys[d.id]) {
        views[d.id] = null;
        continue;
      }
      views[d.id] = await this.venue.desk(this.keys[d.id].owner).catch((e) => (this.log(`[${d.id}] read failed: ${(e as Error).message}`), null));
    }
    let fleetLong = 0, fleetShort = 0;
    for (const v of Object.values(views)) for (const p of v?.positions ?? []) p.side === "long" ? (fleetLong += p.size) : (fleetShort += p.size);
    const fr = fundingRates(m, fleetLong, fleetShort);
    const lastSample = f.fundingSamples[f.fundingSamples.length - 1];
    if (!lastSample || now - lastSample.t >= 3570) f.fundingSamples.push({ t: now, hourly: fr.extHourly });

    // reconcile + equity
    const equity: Record<string, number> = {};
    for (const d of this.cfg.desks) {
      const s = states[d.id], v = views[d.id];
      if (!v) continue;
      const chainIds = v.positions.map((p) => p.id);
      const jIds = Object.keys(s.open).map(Number);
      const needEvents = jIds.some((id) => !chainIds.includes(id));
      const events = needEvents ? await this.venue.closeEvents(this.keys[d.id].owner).catch(() => []) : [];
      const rc = reconcile(jIds, chainIds, events);
      for (const id of rc.closed) {
        const e = events.filter((x) => x.id === id).pop()!;
        this.recordClose(d.id, s, id, { pnl: e.pnl, exit: e.exitPrice, reason: e.reason, tx: e.txHash });
      }
      for (const id of rc.missing) {
        this.halt(d, s, `reconciliation: journal position #${id} is gone on-chain with no close event`);
        delete s.open[String(id)];
      }
      for (const id of rc.unknown) this.halt(d, s, `reconciliation: on-chain position #${id} not in journal`);
      for (const p of v.positions) if (s.open[String(p.id)]) s.open[String(p.id)].lastPendingFunding = p.pendingFunding;
      const eq = v.free + v.positions.reduce((a, p) => a + p.margin + pnlAt(p, m.oraclePrice) - p.pendingFunding, 0);
      equity[d.id] = eq;
      const day = Math.floor(now / 86_400);
      if (s.dayStart.day !== day) s.dayStart = { day, equity: eq };
      if (!s.startEquity) s.startEquity = eq;
      s.peakEquity = Math.max(s.peakEquity || eq, eq);
    }
    const fleetEq = Object.values(equity).reduce((a, b) => a + b, 0);
    const day = Math.floor(now / 86_400);
    if (f.dayStart.day !== day) f.dayStart = { day, equity: fleetEq };
    if (!f.startEquity) f.startEquity = fleetEq;
    f.peakEquity = Math.max(f.peakEquity || fleetEq, fleetEq);
    const openRisk = this.cfg.desks.flatMap((d) => (views[d.id]?.positions ?? []).map((p) => toOpenRisk(p, m.oraclePrice)));
    const fleetBase = { equity: fleetEq, dayStartEquity: f.dayStart.equity, peakEquity: f.peakEquity, entryTimes: this.cfg.desks.flatMap((d) => states[d.id].entryTimes), open: openRisk, reserve: m.reserve };
    const lvl = fleetLevel(fleetBase, this.cfg.limits);
    if (lvl.action === "kill" && !f.killed) this.kill(f, lvl.reason);
    f.fleetPaused = lvl.action === "pause" ? lvl.reason : "";

    const drifts: Record<string, DriftResult> = {};
    const mode = this.driftMode(now);
    for (const d of this.cfg.desks) {
      const s = states[d.id], v = views[d.id], k = this.keys[d.id];
      if (!v || !k) continue;
      const before = s.txAttempts.length;
      try {
        await this.processDesk(d, s, v, k, m, f, ov, bars[d.timeframeSec] ?? [], fr, equity[d.id], fleetBase, mode, drifts, now);
      } catch (e) {
        this.log(`[${d.id}] desk error: ${(e as Error).message}`);
      }
      if (s.txAttempts.length !== before) {
        // refresh the chain view after transactions so status reflects what is on-chain now
        const nv = await this.venue.desk(k.owner).catch(() => null);
        if (nv) {
          views[d.id] = nv;
          equity[d.id] = nv.free + nv.positions.reduce((a, p) => a + p.margin + pnlAt(p, m.oraclePrice) - p.pendingFunding, 0);
        }
      }
    }
    const status = this.buildStatus(now, m, ov, fr, f, states, views, equity, drifts, bars, mode);
    for (const d of this.cfg.desks) this.store.saveDesk(d.id, states[d.id]);
    this.store.saveFleet(f);
    this.store.writeJson("status.json", status);
    this.lastStatus = status;
    return status;
  }

  private kill(f: FleetStateFile, reason: string) {
    f.killed = true;
    f.killReason = reason;
    f.killedAt = this.now();
    this.store.setKillFlag(reason);
    this.store.journal({ type: "global_kill", reason });
    this.log(`GLOBAL KILL: ${reason}`);
  }

  private async processDesk(
    d: DeskConfig, s: DeskState, v: { free: number; positions: ChainPosition[] }, k: DeskKeys, m: VaultMarket, f: FleetStateFile, ov: OracleVerdict,
    deskBars: Candle[], fr: ReturnType<typeof fundingRates>, eq: number, fleetBase: Parameters<typeof fleetGate>[0], mode: DriftMode,
    drifts: Record<string, DriftResult>, now: number,
  ) {
    const price = m.oraclePrice;
    const live = this.opts.mode !== "dry-run";
    let positions = v.positions;
    const drop = (id: number) => (positions = positions.filter((p) => p.id !== id));

    // 0) global kill / halted / flatten request -> close everything this desk holds
    if (f.killed || s.status === "halted" || this.flattenReq.has(d.id)) {
      const why = f.killed ? "global_kill" : s.status === "halted" ? "halt" : "flatten";
      if (positions.length && live) await this.flatten(d, s, positions, price, why);
      this.flattenReq.delete(d.id);
      drifts[d.id] = this.drift(d, s, mode, now);
      return;
    }

    // 1) SL/TP triggers at the oracle price (the vault re-checks; permissionless)
    for (const p of [...positions]) {
      const j = s.open[String(p.id)];
      const sl = p.stopLoss || j?.stop || 0;
      const slHit = sl > 0 && (p.side === "long" ? price <= sl : price >= sl);
      const tpHit = p.takeProfit > 0 && (p.side === "long" ? price >= p.takeProfit : price <= p.takeProfit);
      if (!slHit && !tpHit || !live) continue;
      const onChain = (slHit && p.stopLoss > 0) || tpHit;
      const r = onChain
        ? await this.tx(d.id, s, `execute_trigger #${p.id}`, () => this.venue.executeTrigger(k, p.id))
        : await this.tx(d.id, s, `backup stop close #${p.id}`, () => this.venue.close(k, p.id));
      if (r) {
        this.recordClose(d.id, s, p.id, { pnl: r.value.payout - p.margin, exit: price, reason: slHit ? "stop_loss" : "take_profit", tx: r.hash });
        drop(p.id);
      }
    }

    // 2) drift + desk limits
    const dr = this.drift(d, s, mode, now);
    drifts[d.id] = dr;
    if (dr.halt) {
      this.halt(d, s, `drift: ${dr.halt}`);
      if (live) await this.flatten(d, s, positions, price, "drift_halt");
      return;
    }
    const riskState = { equity: eq, dayStartEquity: s.dayStart.equity, peakEquity: s.peakEquity, lossStreak: s.lossStreak, pausedUntil: s.pausedUntil, entryTimes: s.entryTimes };
    const gate = deskGate(riskState, positions.length, this.cfg.limits, now);
    if (gate.action === "halt") {
      this.halt(d, s, gate.reason);
      if (live) await this.flatten(d, s, positions, price, "drawdown_halt");
      return;
    }
    if (gate.action === "pause") {
      s.pausedUntil = gate.until;
      s.lossStreak = 0;
      this.store.journal({ desk: d.id, type: "auto_pause", reason: gate.reason, until: gate.until });
      this.log(`[${d.id}] auto-pause until ${new Date(gate.until * 1000).toISOString()}: ${gate.reason}`);
    }
    if (!s.manualPause) {
      if (s.pausedUntil > now) (s.status = "paused"), (s.statusReason = gate.action === "pause" ? gate.reason : s.statusReason || "auto pause");
      else (s.status = "running"), (s.statusReason = "");
    }

    // 3) manage open positions on a new closed bar
    const lastBar = deskBars[deskBars.length - 1];
    const newBar = !!lastBar && lastBar.t > s.lastBarT;
    const ctx: StrategyContext = {
      bars: deskBars, price, now, fundingExtHourly: fr.extHourly, fundingSamples: f.fundingSamples.map((x) => x.hourly), externalSkew: fr.extSkew,
      trendBreakoutRecent: now - f.lastTrendEntry < 4 * 3600,
    };
    const strat = this.strategies[d.id];
    // funding exits are evaluated every loop (rate can flip intra-bar); bar strategies on new bars
    if (newBar || d.strategy === "funding") {
      for (const p of [...positions]) {
        const mg = strat.manage(ctx, p);
        if (mg.exit && live) {
          const r = await this.tx(d.id, s, `close #${p.id} (${mg.exit})`, () => this.venue.close(k, p.id));
          if (r) this.recordClose(d.id, s, p.id, { pnl: r.value.payout - p.margin, exit: price, reason: mg.exit, tx: r.hash }), drop(p.id);
        } else if (mg.newStop && live) {
          const r = await this.tx(d.id, s, `trail #${p.id}`, () => this.venue.setTriggers(k, p.id, mg.newStop!, p.takeProfit));
          if (r && s.open[String(p.id)]) s.open[String(p.id)].stop = mg.newStop;
          if (r) this.store.journal({ desk: d.id, type: "trail", id: p.id, stop: mg.newStop, tx: r.hash });
        }
      }
    }
    if (!newBar) return;
    s.lastBarT = lastBar.t;

    // 4) entries
    const sig = strat.entry(ctx);
    if (!sig) {
      s.lastSignal = `no signal @ bar ${new Date(lastBar.t * 1000).toISOString().slice(5, 16)}Z`;
      return;
    }
    const block = (why: string) => {
      s.lastSignal = `${sig.side.toUpperCase()} signal blocked: ${why}`;
      this.store.journal({ desk: d.id, type: "blocked", signal: sig, why });
      this.log(`[${d.id}] ${s.lastSignal}`);
    };
    if (f.killed) return block("global kill active");
    if (s.status !== "running") return block(`desk ${s.status}${s.statusReason ? `: ${s.statusReason}` : ""}`);
    if (f.fleetPaused) return block(f.fleetPaused);
    if (ov.level === "halt") return block(`oracle: ${ov.reasons.join("; ")}`);
    if (m.paused) return block("vault paused by guardian");
    if (gate.action !== "ok") return block(gate.reason);
    if (d.strategy !== "funding") {
      const fg = fundingGuard(sig.side, fr.predictedHourly, this.cfg.limits);
      if (fg) return block(fg);
    }
    const stop = clampStop(sig.side, price, sig.stop, this.cfg.limits.minStopPct, this.cfg.limits.maxStopPct);
    if (!stop) return block(`stop beyond ${this.cfg.limits.maxStopPct}%`);
    const tp = sig.takeProfit > 0 && (sig.side === "long" ? sig.takeProfit > price : sig.takeProfit < price) ? sig.takeProfit : 0;
    const fg = fleetGate({ ...fleetBase, open: fleetBase.open }, sig.side, this.cfg.limits, now);
    if (fg.action !== "ok") return block(fg.reason);
    const riskPct = dr.level === "amber" ? d.riskPct / 2 : d.riskPct;
    const sz = sizePosition({
      equity: eq, riskPct, hardMaxRiskPct: this.cfg.limits.hardMaxRiskPct, entry: price, stop, maxLeverage: d.maxLeverage,
      maxMarginPct: this.cfg.limits.maxMarginPct, maxNotionalX: this.cfg.limits.maxNotionalX, minMargin: m.minMargin, feeBufferPct: this.cfg.limits.feeBufferPct,
      mmBps: m.mmBps, riskBudget: fg.riskBudget, notionalBudget: fg.notionalBudget, freeCollateral: v.free, openFeeBps: m.openFeeBps,
    });
    if (!sz.ok) return block(sz.reason);
    const label = `${sig.side.toUpperCase()} ${sz.leverage.toFixed(1)}× margin ${sz.margin.toFixed(2)} (risk ${sz.riskAmount.toFixed(2)} QUSD, stop ${sz.stopDistPct.toFixed(2)}%)`;
    if (!live) {
      s.lastSignal = `dry-run: would open ${label} — ${sig.reason}`;
      this.log(`[${d.id}] ${s.lastSignal}`);
      return;
    }
    const opened = await this.tx(d.id, s, `open ${label}`, () => this.venue.open(k, sig.side, sz.margin, sz.leverageBps));
    if (!opened) return block("open transaction failed");
    s.entryTimes.push(now);
    fleetBase.entryTimes.push(now);
    if (d.strategy === "trend") f.lastTrendEntry = now;
    const j: JournalOpen = {
      id: opened.value.id, side: sig.side, entry: opened.value.entry, decisionPrice: price, stop, takeProfit: tp, size: sz.notional,
      margin: sz.margin, leverage: sz.leverage, riskAmount: sz.riskAmount, openedAt: now, reason: sig.reason, openTx: opened.hash, lastPendingFunding: 0,
    };
    s.open[String(j.id)] = j;
    fleetBase.open.push({ side: sig.side, size: sz.notional, price, stop, margin: sz.margin });
    this.store.journal({ desk: d.id, type: "open", ...j });
    this.log(`[${d.id}] OPEN #${j.id} ${label} @ ${j.entry.toFixed(6)} — ${sig.reason} — tx ${opened.hash}`);
    s.lastSignal = `opened ${label}`;
    // every position must carry an on-chain stop: retry once, otherwise close it
    let trig = await this.tx(d.id, s, `set_triggers #${j.id}`, () => this.venue.setTriggers(k, j.id, stop, tp));
    if (!trig) trig = await this.tx(d.id, s, `set_triggers retry #${j.id}`, () => this.venue.setTriggers(k, j.id, stop, tp));
    if (!trig) {
      const r = await this.tx(d.id, s, `close #${j.id} (no on-chain stop)`, () => this.venue.close(k, j.id));
      if (r) this.recordClose(d.id, s, j.id, { pnl: r.value.payout - sz.margin, exit: price, reason: "no_stop", tx: r.hash });
    } else this.store.journal({ desk: d.id, type: "triggers", id: j.id, stop, tp, tx: trig.hash });
  }

  private drift(d: DeskConfig, s: DeskState, mode: DriftMode, now: number) {
    return computeDrift({ mode, strategy: d.strategy, trades: s.closed, entryTimes: s.entryTimes, txAttempts: s.txAttempts, txFailures: s.txFailures, baseline: this.opts.baselines[d.id] ?? null, now });
  }

  private buildStatus(
    now: number, m: VaultMarket, ov: OracleVerdict, fr: ReturnType<typeof fundingRates>, f: FleetStateFile, states: Record<string, DeskState>,
    views: Record<string, { free: number; positions: ChainPosition[] } | null>, equity: Record<string, number>, drifts: Record<string, DriftResult>,
    bars: Record<number, Candle[]>, mode: DriftMode,
  ) {
    const L = this.cfg.limits;
    const fleetEq = Object.values(equity).reduce((a, b) => a + b, 0);
    const allPos = this.cfg.desks.flatMap((d) => (views[d.id]?.positions ?? []).map((p) => ({ d, p })));
    const risk = allPos.reduce((a, { p }) => a + riskToStop(toOpenRisk(p, m.oraclePrice)), 0);
    const net = allPos.reduce((a, { p }) => a + (p.side === "long" ? p.size : -p.size), 0);
    const r4 = (x: number) => Math.round(x * 1e4) / 1e4;
    return {
      schema: "quasaria-back-office/status@1",
      generatedAt: new Date(now * 1000).toISOString(),
      network: "testnet",
      vault: this.opts.vaultId ?? null,
      mode: this.opts.mode,
      driftMode: mode,
      exampleData: false,
      fleet: {
        status: f.killed ? "killed" : f.fleetPaused ? "paused" : "running",
        reason: f.killed ? f.killReason : f.fleetPaused,
        equity: r4(fleetEq), startEquity: r4(f.startEquity), pnlToday: r4(fleetEq - f.dayStart.equity), pnlTotal: r4(fleetEq - f.startEquity),
        drawdownPct: r4(f.peakEquity ? ((f.peakEquity - fleetEq) / f.peakEquity) * 100 : 0), drawdownLimitPct: L.fleetDrawdownPct,
        riskUsedPct: r4(fleetEq ? (risk / fleetEq) * 100 : 0), riskCapPct: L.fleetOpenRiskPct,
        openPositions: allPos.length, maxPositions: this.cfg.desks.length * L.maxOpenPerDesk,
        netNotional: r4(net), netSide: net > 0 ? "long" : net < 0 ? "short" : "flat",
      },
      market: {
        oraclePrice: m.oraclePrice, oracleAgeSec: ov.ageSec, referencePrice: f.oracleHistory[f.oracleHistory.length - 1]?.ref ?? null, deviationPct: ov.deviationPct === null ? null : r4(ov.deviationPct),
        oracleLevel: ov.level, oracleReasons: ov.reasons, reserve: r4(m.reserve), longOi: r4(m.longOi), shortOi: r4(m.shortOi),
        fundingPredictedHourly: fr.predictedHourly, fundingExternalHourly: fr.extHourly, externalSkew: r4(fr.extSkew),
      },
      desks: this.cfg.desks.map((d) => {
        const s = states[d.id], dr = drifts[d.id], eq = equity[d.id] ?? 0;
        const rs = { equity: eq, dayStartEquity: s.dayStart.equity, peakEquity: s.peakEquity, lossStreak: s.lossStreak, pausedUntil: s.pausedUntil, entryTimes: s.entryTimes };
        const top = dr?.metrics.filter((x) => x.points > 0).sort((a, b) => b.points - a.points)[0];
        const tb = bars[d.timeframeSec] ?? [];
        return {
          id: d.id, name: d.name, strategy: d.strategy, timeframeSec: d.timeframeSec, owner: this.keys[d.id]?.owner ?? null,
          status: s.status, reason: s.statusReason, manualPause: s.manualPause,
          equity: r4(eq), startEquity: r4(s.startEquity), pnlToday: r4(eq - s.dayStart.equity), pnlTotal: r4(eq - s.startEquity),
          riskPct: d.riskPct, maxLeverage: d.maxLeverage, dailyLossPct: r4(dailyLossPct(rs)), dailyLimitPct: L.deskDailyLossPct, drawdownPct: r4(drawdownPct(rs)), drawdownLimitPct: L.deskDrawdownPct,
          lossStreak: s.lossStreak,
          drift: dr ? { score: dr.score, level: dr.level, top: top ? `${top.id} ${top.label}: ${top.value}` : "all metrics normal", metrics: dr.metrics } : null,
          open: (views[d.id]?.positions ?? []).map((p) => ({ id: p.id, side: p.side, size: r4(p.size), margin: r4(p.margin), leverage: r4(p.size / p.margin), entry: p.entry, stop: p.stopLoss, takeProfit: p.takeProfit, upnl: r4(pnlAt(p, m.oraclePrice) - p.pendingFunding) })),
          lastSignal: s.lastSignal,
          trades: s.closed.slice(-6).reverse().map((t) => ({ id: t.id, side: t.side, pnl: r4(t.pnl), r: r4(t.r), reason: t.reason, at: t.closedAt, tx: t.tx })),
          entries: Object.values(s.open).map((j) => ({ id: j.id, side: j.side, leverage: j.leverage, entry: j.entry, at: j.openedAt, tx: j.openTx })),
          spark: tb.slice(-40).map((b) => b.c),
        };
      }),
    };
  }
}
