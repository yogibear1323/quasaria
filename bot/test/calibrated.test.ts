import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Candle } from "../src/office/indicators.js";
import { loadOfficeConfig, parseOfficeConfig } from "../src/office/config.js";
import { FEATURES, W, snapshotAt } from "../src/office/calibrated/snapshot.js";
import { QUESTIONS, loadModel, score, type CalibratedModel, type Probabilities } from "../src/office/calibrated/model.js";
import { decide, riskPctFor } from "../src/office/calibrated/policy.js";
import { openPaper, stepPaper } from "../src/office/calibrated/outcomes.js";
import { ShadowDesk, sliceSize, type CalibratedDeskConfig } from "../src/office/calibrated/shadowDesk.js";

const fx = JSON.parse(readFileSync(new URL("./fixtures/calibrated-parity.json", import.meta.url), "utf8")) as {
  gran: number; bars: Candle[]; cases: { decisionTs: number; features: Record<string, number>; atr: number; probs: Record<string, number> }[];
};
const MODEL_PATH = new URL("../office.calibrated.model.json", import.meta.url).pathname;
const limits = loadOfficeConfig().limits;

/** model whose every question returns a fixed probability (zero weights, intercept = logit(p), identity calibration). */
function fakeModel(p: Partial<Probabilities>, over: Partial<CalibratedModel> = {}): CalibratedModel {
  const real = loadModel(MODEL_PATH);
  const logit = (x: number) => Math.log(x / (1 - x));
  const q = Object.fromEntries(QUESTIONS.map((k) => [k, { kind: "logit", mean: FEATURES.map(() => 0), scale: FEATURES.map(() => 1), coef: FEATURES.map(() => 0), intercept: logit(p[k] ?? 0.5), iso: { x: [], y: [] } }]));
  return { ...real, questions: q as unknown as CalibratedModel["questions"], ...over };
}

describe("calibrated desk · state engine", () => {
  it("TypeScript snapshot + scorer reproduce the Python research exactly (parity fixture)", () => {
    const m = loadModel(MODEL_PATH);
    for (const c of fx.cases) {
      const s = snapshotAt(fx.bars, fx.gran, c.decisionTs)!;
      expect(s).not.toBeNull();
      for (const f of FEATURES) expect(s.features[f]).toBeCloseTo(c.features[f], 9);
      expect(s.atr).toBeCloseTo(c.atr, 12);
      const p = score(m, s);
      for (const q of QUESTIONS) expect(p[q]).toBeCloseTo(c.probs[q], 6);
    }
  });

  it("uses only bars closed strictly before the decision (no lookahead)", () => {
    const c = fx.cases[0];
    const g = fx.gran;
    const base = snapshotAt(fx.bars, g, c.decisionTs)!;
    // tamper with every bar that closes after the decision time, and add an in-progress bar
    const future = fx.bars.map((b) => (b.t + g > c.decisionTs ? { ...b, o: b.o * 3, h: b.h * 3, l: b.l * 0.2, c: b.c * 2, v: (b.v ?? 0) * 50 } : b));
    const last = future[future.length - 1];
    future.push({ t: last.t + g, o: 9, h: 9, l: 9, c: 9, v: 1e9 });
    const again = snapshotAt(future, g, c.decisionTs)!;
    expect(again.features).toEqual(base.features);
    expect(again.barT + g).toBeLessThanOrEqual(c.decisionTs);
    // a bar that is still open at the decision time is excluded
    const inProgress = snapshotAt(fx.bars, g, c.decisionTs + g - 1)!;
    expect(inProgress.barT).toBe(base.barT);
  });

  it("refuses to score without a full window of closed bars", () => {
    expect(snapshotAt(fx.bars.slice(0, W - 1), fx.gran, fx.bars[W - 2].t + fx.gran)).toBeNull();
  });
});

describe("calibrated desk · deterministic policy (models advise, code decides)", () => {
  const caps = { deskRiskPct: 1, hardMaxRiskPct: limits.hardMaxRiskPct };
  const good: Probabilities = { regime: 0.6, direction: 0.7, pressure: 0.7, setup_long: 0.7, setup_short: 0.2, risk: 0.9 };

  it("fires only when every probability clears its threshold", () => {
    const m = fakeModel(good);
    const d = decide(m, good, caps);
    expect(d.fire).toBe(true);
    expect(d.side).toBe("long");
    for (const [k, v] of [["setup_long", 0.3], ["direction", 0.45], ["pressure", 0.3], ["risk", 0.3]] as const) {
      const bad = { ...good, [k]: v };
      const dd = decide(m, bad, caps);
      expect(dd.fire, `${k} below threshold must block`).toBe(false);
    }
    expect(decide({ ...m, thresholds: { ...m.thresholds, regime: 0.7 } }, good, caps).fire).toBe(false);
  });

  it("sizing never exceeds the desk target or the 2 % hard cap, whatever the model file says", () => {
    const greedy = fakeModel(good, { sizing: { fixedRiskPct: 10, kellyFraction: 5, kellyCapPct: 50 }, calibration: { verified: true, note: "", brier: {} } });
    const r = riskPctFor(greedy, 0.99, caps);
    expect(r.riskPct).toBeLessThanOrEqual(1);
    expect(riskPctFor(greedy, 0.99, { deskRiskPct: 5, hardMaxRiskPct: 9 }).riskPct).toBeLessThanOrEqual(2);
    const unverified = fakeModel(good, { sizing: { fixedRiskPct: 10, kellyFraction: 0.25, kellyCapPct: 1 }, calibration: { verified: false, note: "", brier: {} } });
    expect(riskPctFor(unverified, 0.99, caps)).toEqual({ riskPct: 1, sizing: "fixed" });
  });

  it("Kelly is zero below the cutoff and quarter-Kelly at most; fixed 0.5 % when calibration is not verified", () => {
    const m = fakeModel(good, { calibration: { verified: true, note: "", brier: {} } });
    expect(riskPctFor(m, m.thresholds.setup - 0.01, { deskRiskPct: 1, hardMaxRiskPct: 2 }).riskPct).toBe(0);
    const b = (m.geometry.tpAtr / m.geometry.slAtr) * 0.85;
    const p = Math.max(m.thresholds.setup, 0.6);
    const quarter = 0.25 * (p - (1 - p) / b) * 100;
    expect(riskPctFor(m, p, { deskRiskPct: 1, hardMaxRiskPct: 2 }).riskPct).toBeCloseTo(Math.max(0, Math.min(quarter, 1)), 9);
    const real = loadModel(MODEL_PATH);
    if (!real.calibration.verified) expect(riskPctFor(real, 0.9, { deskRiskPct: 1, hardMaxRiskPct: 2 })).toEqual({ riskPct: 0.5, sizing: "fixed" });
  });
});

describe("calibrated desk · paper fills", () => {
  it("stop is checked before target and gaps fill at the open", () => {
    const p = openPaper("long", 1, 0.01, { tpAtr: 2, slAtr: 1 }, 0, 900, 24, 100, 1, 0);
    expect(p.stop).toBeCloseTo(0.99, 9); // 1 x ATR = 1 % (inside the 0.8–7.5 % band)
    const both = stepPaper(p, [{ t: 900, o: 1, h: 1.05, l: 0.95, c: 1 }], 900)!;
    expect(both.reason).toBe("stop_loss");
    const gap = stepPaper(p, [{ t: 900, o: 0.9, h: 0.91, l: 0.89, c: 0.9 }], 900)!;
    expect(gap.exit).toBeCloseTo(0.9 * (1 - 0.0005), 9);
  });
});

describe("calibrated desk · risk rules above the model", () => {
  let dir: string;
  beforeEach(() => (dir = mkdtempSync(join(tmpdir(), "cal-"))));
  afterEach(() => rmSync(dir, { recursive: true, force: true }));
  const cfg: CalibratedDeskConfig = { id: "orion", name: "Orion", mode: "paper", timeframeSec: fx.gran, model: "", capital: 500, riskPct: 1, maxLeverage: 3, label: "test" };
  const extras = { spreadBps: null, bookImbalance: null, fundingHourly: 0 };
  const allYes: Probabilities = { regime: 0.9, direction: 0.9, pressure: 0.9, setup_long: 0.9, setup_short: 0.1, risk: 0.9 };
  const endOf = (n: number) => fx.bars[n - 1].t + fx.gran;

  it("paper mode opens a simulated fill when everything clears, even with a failed gate (labelled), at fixed 0.5 % risk", () => {
    const desk = new ShadowDesk(cfg, fakeModel(allYes, { gate: { passed: false, summary: "FAILED GATE" } }), limits, dir);
    const row = desk.step({ now: endOf(W + 1), killed: false, bars: fx.bars.slice(0, W + 1), extras })!;
    expect(row.fired).toBe(true);
    expect(row.action).toMatch(/^paper long/);
    expect(row.riskPct).toBe(0.5);
    expect(desk.state.open).not.toBeNull();
    expect(desk.mode).toBe("paper");
    expect(desk.modeNote).toMatch(/^paper · failed gate/);
    expect(desk.status().open!.notional).toBeLessThanOrEqual(500 * limits.maxNotionalX + 1e-9);
  });

  it("shadow mode scores and logs but opens no paper position", () => {
    const desk = new ShadowDesk({ ...cfg, mode: "shadow" }, fakeModel(allYes), limits, dir);
    const row = desk.step({ now: endOf(W + 1), killed: false, bars: fx.bars.slice(0, W + 1), extras })!;
    expect(row.fired).toBe(false);
    expect(row.action).toMatch(/^veto: shadow mode/);
    expect(desk.state.open).toBeNull();
  });

  it("kill switch flattens the open position and halts; later signals are vetoed", () => {
    const desk = new ShadowDesk(cfg, fakeModel(allYes), limits, dir);
    desk.step({ now: endOf(W + 1), killed: false, bars: fx.bars.slice(0, W + 1), extras });
    expect(desk.state.open).not.toBeNull();
    const row = desk.step({ now: endOf(W + 2), killed: true, killReason: "test", bars: fx.bars.slice(0, W + 2), extras })!;
    expect(desk.state.open).toBeNull();
    expect(desk.state.status).toBe("halted");
    expect(desk.state.closed.some((t) => t.reason === "global_kill")).toBe(true);
    expect(row.fired).toBe(false);
    expect(row.action).toMatch(/^veto: global kill/);
    // still halted after the kill clears (needs a manual reset)
    const r2 = desk.step({ now: endOf(W + 3), killed: false, bars: fx.bars.slice(0, W + 3), extras })!;
    expect(r2.action).toMatch(/^veto: halted/);
  });

  it("drawdown limit flattens and halts even when the model is maximally confident", () => {
    const desk = new ShadowDesk(cfg, fakeModel(allYes), limits, dir);
    desk.state.peakEquity = 500;
    desk.state.equity = 500 * (1 - limits.deskDrawdownPct / 100) - 1;
    const row = desk.step({ now: endOf(W + 1), killed: false, bars: fx.bars.slice(0, W + 1), extras })!;
    expect(desk.state.status).toBe("halted");
    expect(row.fired).toBe(false);
    expect(desk.state.open).toBeNull();
  });

  it("daily loss limit blocks new entries", () => {
    const desk = new ShadowDesk(cfg, fakeModel(allYes), limits, dir);
    const now = endOf(W + 1);
    desk.state.dayStart = { day: Math.floor(now / 86400), equity: 500 };
    desk.state.equity = 500 * (1 - limits.deskDailyLossPct / 100) - 0.5;
    desk.state.peakEquity = 500 * (1 - limits.deskDailyLossPct / 100);
    const row = desk.step({ now, killed: false, bars: fx.bars.slice(0, W + 1), extras })!;
    expect(row.fired).toBe(false);
    expect(row.action).toMatch(/^veto: daily loss/);
  });

  it("max one open position: a second signal is vetoed", () => {
    const desk = new ShadowDesk(cfg, fakeModel(allYes, { horizonBars: 50 }), limits, dir);
    desk.step({ now: endOf(W + 1), killed: false, bars: fx.bars.slice(0, W + 1), extras });
    const row = desk.step({ now: endOf(W + 2), killed: false, bars: fx.bars.slice(0, W + 2), extras })!;
    expect(desk.state.open).not.toBeNull();
    expect(row.fired).toBe(false);
    expect(row.action).toMatch(/^veto: (max 1 open|position already open)/);
  });

  it("desk (live order) mode is refused unless the model passed the strategy gate", () => {
    const m = fakeModel(allYes, { gate: { passed: false, summary: "FAILED GATE" } });
    const desk = new ShadowDesk({ ...cfg, mode: "desk" }, m, limits, dir);
    expect(desk.mode).toBe("shadow");
    expect(desk.modeNote).toMatch(/refused/);
  });

  it("logs every decision and its later outcome for calibration", () => {
    const desk = new ShadowDesk(cfg, fakeModel({}), limits, dir);
    const T = desk.model.horizonBars;
    for (let n = W; n <= W + 5; n++) desk.step({ now: endOf(n), killed: false, bars: fx.bars.slice(0, n), extras });
    const log = readFileSync(join(dir, "calibration.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    expect(log.filter((e) => e.type === "decision").length).toBe(6);
    expect(log[0].snapshot.features).toBeTruthy();
    expect(T).toBeGreaterThan(5); // outcomes resolve only after T bars
    expect(log.some((e) => e.type === "outcome")).toBe(false);
  });
});

describe("calibrated desk · fleet integration (live testnet tiny slice)", () => {
  const allYes: Probabilities = { regime: 0.9, direction: 0.9, pressure: 0.9, setup_long: 0.9, setup_short: 0.1, risk: 0.9 };
  async function rig(opts: { network?: string; stale?: boolean } = {}) {
    const { Fleet } = await import("../src/office/fleet.js");
    const { Store } = await import("../src/office/store.js");
    const { PaperOfficeVenue } = await import("../src/office/venue.js");
    const cfgAll = loadOfficeConfig();
    const dir = mkdtempSync(join(tmpdir(), "cal-fleet-"));
    const venue = new PaperOfficeVenue();
    venue.reserve = 10_000;
    const ids = [...cfgAll.desks.map((d) => d.id), "orion"];
    const owners = Object.fromEntries(ids.map((id) => [id, { owner: `OWNER_${id}`, operatorSecret: "" }]));
    for (const d of cfgAll.desks) venue.deposit(owners[d.id].owner, d.capital);
    venue.deposit("OWNER_orion", 100);
    const last = fx.bars[fx.bars.length - 1];
    let now = last.t + fx.gran + 5;
    venue.price = last.c;
    venue.priceTs = opts.stale ? now - 70 : now - 10;
    const ref = { ticker: async () => venue.price, closedBars: async (g: number, n: number) => (g === fx.gran ? fx.bars.filter((b) => b.t + g <= n) : []) };
    const store = new Store(dir);
    const fleet = new Fleet(cfgAll, venue, owners, store, ref, { mode: "live", baselines: {}, log: () => undefined, now: () => now, network: opts.network ?? "testnet" });
    const orionCfg = cfgAll.calibrated![0];
    (fleet.calibrated as ShadowDesk[])[0] = new ShadowDesk(orionCfg, fakeModel(allYes), cfgAll.limits, dir, () => undefined, { network: opts.network ?? "testnet" });
    return { fleet, venue, store, dir, cfgAll, advance: (s: number) => { now += s; venue.priceTs = now - 10; }, get now() { return now; } };
  }
  const orionPos = (v: { positions: Map<number, { owner: string; margin: number; size: number; stopLoss: number; takeProfit: number }> }) => [...v.positions.values()].filter((p) => p.owner === "OWNER_orion");

  it("config: Orion is live on testnet via the explicit override, with the tiny-slice limits", () => {
    const o = loadOfficeConfig().calibrated![0];
    expect(o).toMatchObject({ mode: "live", liveOverride: "testnet-tiny", capital: 100, riskPct: 0.25, maxLeverage: 2, live: { dailyLossUsd: 2, killDrawdownUsd: 5, maxEntriesPerDay: 4, maxOpen: 1 } });
  });

  it("routes a real (paper-venue) on-chain order through the breaker: vault-minimum sized, <= 2x, stop + target set on-chain", async () => {
    const r = await rig();
    try {
      const st = (await r.fleet.step()) as { calibrated: { mode: string; modeNote: string; live: { open: { id: number } | null; fills: { kind: string; slippageBps: number }[] } }[] };
      const o = st.calibrated[0];
      expect(o.mode).toBe("live");
      expect(o.modeNote).toMatch(/^live testnet · tiny slice · failed gate/);
      const ps = orionPos(r.venue);
      expect(ps.length).toBe(1);
      expect(ps[0].margin).toBeGreaterThanOrEqual(10); // vault min margin
      expect(ps[0].size / ps[0].margin).toBeLessThanOrEqual(2 + 1e-9);
      expect(ps[0].stopLoss).toBeGreaterThan(0);
      expect(ps[0].takeProfit).toBeGreaterThan(0);
      expect(o.live.fills[0].kind).toBe("open");
    } finally {
      rmSync(r.dir, { recursive: true, force: true });
    }
  });

  it("stale data: Orion's live entry is refused (STALE DATA), nothing is sent", async () => {
    const r = await rig({ stale: true });
    try {
      const st = (await r.fleet.step()) as { calibrated: { decisions: { action: string }[] }[] };
      expect(orionPos(r.venue).length).toBe(0);
      expect(st.calibrated[0].decisions[0].action).toMatch(/veto: STALE DATA · entries halted/);
    } finally {
      rmSync(r.dir, { recursive: true, force: true });
    }
  });

  it("global kill flattens Orion's on-chain position and halts it", async () => {
    const r = await rig();
    try {
      await r.fleet.step();
      expect(orionPos(r.venue).length).toBe(1);
      r.store.setKillFlag("test kill");
      r.advance(60);
      const st = (await r.fleet.step()) as { calibrated: { status: string }[] };
      expect(orionPos(r.venue).length).toBe(0);
      expect(st.calibrated[0].status).toBe("halted");
    } finally {
      rmSync(r.dir, { recursive: true, force: true });
    }
  });

  it("live mode is refused on any network other than testnet", async () => {
    const r = await rig({ network: "mainnet" });
    try {
      const st = (await r.fleet.step()) as { calibrated: { mode: string; modeNote: string }[] };
      expect(st.calibrated[0].mode).toBe("shadow");
      expect(st.calibrated[0].modeNote).toMatch(/not testnet/);
      expect(orionPos(r.venue).length).toBe(0);
    } finally {
      rmSync(r.dir, { recursive: true, force: true });
    }
  });
});

describe("calibrated desk · tiny slice rules", () => {
  let dir: string;
  beforeEach(() => (dir = mkdtempSync(join(tmpdir(), "slice-"))));
  afterEach(() => rmSync(dir, { recursive: true, force: true }));
  const allYes: Probabilities = { regime: 0.9, direction: 0.9, pressure: 0.9, setup_long: 0.9, setup_short: 0.1, risk: 0.9 };
  const live = (): CalibratedDeskConfig => ({ ...loadOfficeConfig().calibrated![0] });
  const extras = { spreadBps: null, bookImbalance: null, fundingHourly: 0 };
  const endOf = (n: number) => fx.bars[n - 1].t + fx.gran;

  it("sizes at 0.25 % risk, capped at 2x, and bumps to the vault minimum margin when the risk-based size is smaller", () => {
    const a = sliceSize({ equity: 100, riskPct: 0.25, hardMaxRiskPct: 2, entry: 1, stop: 0.99, maxLeverage: 2, minMargin: 10, openFeeBps: 10, free: 100, mmBps: 50 });
    expect(a).toMatchObject({ ok: true, margin: 12.5, leverage: 2, bumped: false });
    const b = sliceSize({ equity: 100, riskPct: 0.25, hardMaxRiskPct: 2, entry: 1, stop: 0.97, maxLeverage: 2, minMargin: 10, openFeeBps: 10, free: 100, mmBps: 50 });
    expect(b).toMatchObject({ ok: true, margin: 10, leverage: 1, bumped: true });
    if (b.ok) expect(b.riskAmount).toBeCloseTo(0.3, 9);
  });

  it("slice drawdown kill: down $5 -> flatten requested and Orion paused (manual resume)", () => {
    const d = new ShadowDesk(live(), fakeModel(allYes), limits, dir, () => undefined, { network: "testnet" });
    d.step({ now: endOf(W + 1), killed: false, bars: fx.bars.slice(0, W + 1), extras, liveEquity: 94.9, liveOpenCount: 1 });
    expect(d.state.flattenReq).toBe(true);
    expect(d.state.status).toBe("paused");
    expect(d.state.statusReason).toMatch(/slice drawdown kill/);
    expect(d.takeIntent()).toBeNull();
  });

  it("daily loss cap ($2) and 4 trades/day block new live orders", () => {
    const d = new ShadowDesk(live(), fakeModel(allYes), limits, dir, () => undefined, { network: "testnet" });
    const now = endOf(W + 1);
    d.state.dayStart = { day: Math.floor(now / 86400), equity: 100 };
    let row = d.step({ now, killed: false, bars: fx.bars.slice(0, W + 1), extras, liveEquity: 97.9, liveOpenCount: 0 })!;
    expect(row.action).toMatch(/veto: slice daily loss/);
    const d2 = new ShadowDesk(live(), fakeModel(allYes), limits, mkdtempSync(join(tmpdir(), "slice2-")), () => undefined, { network: "testnet" });
    d2.state.entryTimes = [now - 100, now - 200, now - 300, now - 400];
    row = d2.step({ now, killed: false, bars: fx.bars.slice(0, W + 1), extras, liveEquity: 100, liveOpenCount: 0 })!;
    expect(row.action).toMatch(/veto: max 4 trades\/day/);
  });

  it("live mode without the override is refused while the gate is failed", () => {
    const { liveOverride: _o, ...noOverride } = live();
    const d = new ShadowDesk(noOverride as CalibratedDeskConfig, fakeModel(allYes, { gate: { passed: false, summary: "FAILED GATE" } }), limits, dir, () => undefined, { network: "testnet" });
    expect(d.mode).toBe("shadow");
  });
});

describe("issue #30 guard", () => {
  const raw = () => JSON.parse(readFileSync(new URL("../office.config.json", import.meta.url), "utf8"));
  it("refuses to raise Orion's live slice above $100 without --ack-issue-30", () => {
    const c = raw();
    c.calibrated[0].capital = 150;
    expect(() => parseOfficeConfig(c)).toThrow(/issue #30/);
    c.calibrated[0].live.dailyLossUsd = 2;
    expect(() => parseOfficeConfig(c, { ackIssue30: true })).not.toThrow();
  });
  it("refuses to unpause Echo or Nova without --ack-issue-30", () => {
    for (const id of ["echo", "nova"]) {
      const c = raw();
      delete c.desks.find((d: { id: string }) => d.id === id).paused;
      expect(() => parseOfficeConfig(c)).toThrow(/issue #30/);
      expect(() => parseOfficeConfig(c, { ackIssue30: true })).not.toThrow();
    }
  });
  it("tiny-slice limits cannot be loosened (risk, leverage)", () => {
    const c = raw();
    c.calibrated[0].riskPct = 0.5;
    expect(() => parseOfficeConfig(c)).toThrow(/riskPct must be <= 0.25/);
    const c2 = raw();
    c2.calibrated[0].maxLeverage = 3;
    expect(() => parseOfficeConfig(c2)).toThrow(/maxLeverage must be <= 2/);
  });
});
