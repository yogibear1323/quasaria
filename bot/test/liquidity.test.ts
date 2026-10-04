import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { aggregate, type Candle } from "../src/office/indicators.js";
import { atrSeries, supertrendSeries, sweepScan } from "../src/office/liquidity.js";
import { createOfficeStrategy, explainEntry, liqpocket, supertrend, withLiquidityFilter, type OfficeStrategy, type StrategyContext } from "../src/office/strategies.js";
import { loadOfficeConfig } from "../src/office/config.js";
import { Fleet } from "../src/office/fleet.js";
import { PaperOfficeVenue } from "../src/office/venue.js";
import { Store } from "../src/office/store.js";
import { computeDrift } from "../src/office/drift.js";
import type { ReferenceFeed } from "../src/office/marketData.js";
import type { ChainPosition, DeskConfig, OfficeConfig } from "../src/office/types.js";

const T0 = 1_789_948_800; // 00:00 UTC
const cfg = loadOfficeConfig();
const deskBase: DeskConfig = { id: "t", name: "T", strategy: "liqpocket", timeframeSec: 3600, riskPct: 0.75, maxLeverage: 3, capital: 500, params: {} };

/** gentle up-ramp (no pivots of its own) with hand-placed wicks */
function ramp(n: number, wicks: Record<number, Partial<Candle>> = {}): Candle[] {
  return Array.from({ length: n }, (_, i) => {
    const c = 0.2 + 0.0002 * i;
    return { t: T0 + i * 3600, o: c - 0.0001, c, h: c + 0.0005, l: c - 0.0005, ...wicks[i] };
  });
}
const ctx = (bars: Candle[], extra: Partial<StrategyContext> = {}): StrategyContext => ({
  bars, price: bars[bars.length - 1].c, now: bars[bars.length - 1].t + 3600, fundingExtHourly: 0, fundingSamples: [], externalSkew: 0, trendBreakoutRecent: false, ...extra,
});
const pos = (side: "long" | "short", entry: number, stopLoss: number, openedAt: number): ChainPosition => ({ id: 1, side, margin: 10, size: 30, entry, openedAt, stopLoss, takeProfit: 0, pendingFunding: 0 });

describe("liquidity pockets: sweep scan (port of research/liquidity.py)", () => {
  it("detects a sell-side sweep + reclaim of a swing low and reports the nearest resting level", () => {
    const bars = ramp(60, { 40: { l: 0.2 }, 50: { l: 0.1995 } });
    const s = sweepScan(bars, 2, 50, 0);
    expect(s.levelDown[45]).toBeCloseTo(0.2, 6); // pivot low at bar 40 is resting liquidity
    expect(s.longSweep[50]).toBe(true);
    expect(s.extreme[50]).toBe(0.1995);
    expect(s.longSweep.filter(Boolean).length).toBe(1);
    expect(s.shortSweep.some(Boolean)).toBe(false);
    expect(s.sinceSell[53]).toBe(3);
    expect(sweepScan(bars, 2, 50, 0).longSweep.slice(51).some(Boolean)).toBe(false); // a swept level cannot be swept twice
  });
  it("a break that CLOSES through the level is not a sweep (and consumes the level)", () => {
    const bars = ramp(60, { 40: { l: 0.2 }, 50: { l: 0.1995, c: 0.1998, o: 0.21 } });
    const s = sweepScan(bars, 2, 50, 0);
    expect(s.longSweep.some(Boolean)).toBe(false);
    expect(s.sinceSell[55]).toBeGreaterThan(1e8);
  });
  it("pivots are only usable k bars after they form (no look-ahead) and expire after L bars", () => {
    const early = sweepScan(ramp(60, { 40: { l: 0.2 }, 41: { l: 0.1995 } }), 2, 50, 0);
    expect(early.longSweep[41]).toBe(false);
    const stale = sweepScan(ramp(60, { 10: { l: 0.2 }, 50: { l: 0.1995 } }), 2, 20, 0);
    expect(stale.longSweep[50]).toBe(false);
  });
  it("src=1 needs equal lows (a stop cluster); one swing low is not enough", () => {
    const one = ramp(60, { 40: { l: 0.2 }, 50: { l: 0.1995 } });
    expect(sweepScan(one, 2, 50, 1).longSweep[50]).toBe(false);
    const two = ramp(60, { 30: { l: 0.2 }, 40: { l: 0.2001 }, 50: { l: 0.1995 } }); // 2nd low a touch higher (a lower one would sweep the first)
    expect(sweepScan(two, 2, 50, 1).longSweep[50]).toBe(true);
  });
  it("prior-day high sweep + rejection is a buy-side sweep (src=2)", () => {
    const bars = ramp(30).map((b, i) => (i >= 24 ? { ...b, o: 0.2, c: 0.2, h: 0.2005, l: 0.1995 } : b));
    const pdh = Math.max(...bars.slice(0, 24).map((b) => b.h));
    bars[26] = { ...bars[26], h: pdh + 0.003, c: pdh - 0.002, o: bars[26].c };
    const s = sweepScan(bars, 2, 50, 2);
    expect(s.shortSweep[26]).toBe(true);
    expect(s.extreme[26]).toBeCloseTo(pdh + 0.003, 8);
  });
  it("ATR series is Wilder-smoothed and NaN during warm-up", () => {
    const a = atrSeries(ramp(40), 14);
    expect(Number.isNaN(a[13])).toBe(true);
    expect(a[20]).toBeGreaterThan(0.0009);
    expect(a[20]).toBeLessThan(0.0012);
  });
});

describe("liquidity pockets: strategy (experimental) and entry filter", () => {
  const d: DeskConfig = { ...deskBase, params: { k: 2, L: 50, src: 0, bufAtr: 0.25, targetR: 3, alignEma: 0, timeStopBars: 48 } };
  it("enters long on the sweep bar: stop beyond the extreme, target 3R, time stop", () => {
    const bars = ramp(51, { 40: { l: 0.2 }, 50: { l: 0.1995 } });
    const sig = liqpocket(d).entry(ctx(bars))!;
    expect(sig.side).toBe("long");
    const a = atrSeries(bars, 14)[50], c = bars[50].c;
    expect(sig.stop).toBeCloseTo(0.1995 - 0.25 * a, 8);
    expect(sig.takeProfit).toBeCloseTo(c + 3 * Math.max(c - sig.stop, 0.008 * c), 8);
    expect(sig.reason).toMatch(/sell-side liquidity swept/);
    expect(liqpocket(d).entry(ctx(bars.slice(0, 50)))).toBeNull();
    const m = liqpocket(d).manage(ctx(bars, { now: bars[50].t + 49 * 3600 }), pos("long", c, sig.stop, bars[50].t));
    expect(m.exit).toMatch(/time stop/);
  });
  it("EMA alignment blocks counter-trend sweeps", () => {
    const bars = ramp(60, { 40: { l: 0.2 }, 50: { l: 0.1995 } }).map((b) => ({ ...b })).slice(0, 51);
    expect(liqpocket({ ...d, params: { ...d.params, alignEma: 50 } }).entry(ctx(bars))?.side).toBe("long"); // up-ramp: above EMA50
    const down = bars.map((b, i) => ({ ...b, c: b.c - 0.0006 * i, o: b.o - 0.0006 * i, h: b.h - 0.0006 * i, l: b.l - 0.0006 * i }));
    down[50] = { ...down[50], c: down[49].c - 0.004 };
    expect(liqpocket({ ...d, params: { ...d.params, alignEma: 50 } }).entry(ctx(down))).toBeNull();
  });
  it("filter passes a long only after a recent sell-side sweep; shorts need a buy-side sweep", () => {
    const always = (side: "long" | "short"): OfficeStrategy => ({ entry: () => ({ side, stop: side === "long" ? 0.19 : 0.23, takeProfit: 0, reason: "inner" }), manage: () => ({ exit: "inner exit" }) });
    const fd: DeskConfig = { ...deskBase, strategy: "trend", params: { lpSweepBars: 5, lpK: 2, lpSrc: 0 } };
    const bars = ramp(60, { 40: { l: 0.2 }, 50: { l: 0.1995 } });
    const f = withLiquidityFilter(always("long"), fd);
    expect(f.entry(ctx(bars.slice(0, 53)))?.reason).toMatch(/inner; liquidity filter: sell-side sweep 2 bars ago/);
    expect(f.entry(ctx(bars.slice(0, 50)))).toBeNull(); // before the sweep
    expect(f.entry(ctx(bars.slice(0, 57)))).toBeNull(); // 6 bars later > 5
    expect(withLiquidityFilter(always("short"), fd).entry(ctx(bars.slice(0, 53)))).toBeNull();
    expect(f.manage(ctx(bars), pos("long", 0.21, 0.2, T0)).exit).toBe("inner exit"); // exits untouched
    expect(withLiquidityFilter(always("long"), { ...fd, params: {} }).entry(ctx(bars.slice(0, 50)))?.reason).toBe("inner"); // off by default
  });
  it("shipped desks: Vega/Regal/Halo carry the filter, funding is never wrapped, Lyra runs liqpocket", () => {
    const by = Object.fromEntries(cfg.desks.map((x) => [x.id, x]));
    expect(by.vega.params.lpSweepBars).toBe(24);
    expect(by.rigel.params.lpSweepBars).toBe(12);
    expect(by.halo.params.lpSweepBars).toBe(12);
    expect(by.lyra.strategy).toBe("liqpocket");
    expect(by.lyra.riskPct).toBeLessThanOrEqual(1);
    for (const x of cfg.desks) expect(typeof createOfficeStrategy(x).entry).toBe("function");
    const bars = ramp(120);
    expect(explainEntry(by.vega, ctx(bars))).toMatch(/^Supertrend 10×3: up.*liquidity filter \(≤24 bars\)/);
    expect(explainEntry(by.echo, ctx(bars))).toMatch(/^Paused: /);
    expect(explainEntry(by.lyra, ctx(bars))).toMatch(/^Liquidity pockets \(experimental\)/);
  });
});

describe("supertrend", () => {
  const closes = [...Array.from({ length: 60 }, (_, i) => 0.25 - 0.0008 * i), ...Array.from({ length: 40 }, (_, i) => 0.202 + 0.0015 * (i + 1))];
  const bars: Candle[] = closes.map((c, i) => ({ t: T0 + i * 3600, o: i ? closes[i - 1] : c, c, h: Math.max(c, i ? closes[i - 1] : c) * 1.002, l: Math.min(c, i ? closes[i - 1] : c) * 0.998 }));
  const { line, dir } = supertrendSeries(bars, 10, 3);
  const flip = dir.findIndex((x, i) => i > 30 && x === 1 && dir[i - 1] === -1);
  const d: DeskConfig = { ...deskBase, strategy: "supertrend", params: { n: 10, m: 3 } };
  it("line sits below price in an uptrend, above in a downtrend; flips once on the reversal", () => {
    expect(dir[55]).toBe(-1);
    expect(line[55]).toBeGreaterThan(closes[55]);
    expect(flip).toBeGreaterThan(60);
    expect(dir[99]).toBe(1);
    expect(line[99]).toBeLessThan(closes[99]);
    for (let i = flip + 1; i < 100; i++) expect(line[i]).toBeGreaterThanOrEqual(line[i - 1]); // ratchets up
  });
  it("enters only on the flip bar with the line as stop; trails with the line; exits on the opposite flip", () => {
    const s = supertrend(d);
    const sig = s.entry(ctx(bars.slice(0, flip + 1)))!;
    expect(sig.side).toBe("long");
    expect(sig.stop).toBeCloseTo(line[flip], 10);
    expect(sig.stop).toBeLessThan(closes[flip]);
    expect(s.entry(ctx(bars.slice(0, flip + 2)))).toBeNull();
    const m = s.manage(ctx(bars), pos("long", closes[flip], line[flip], bars[flip].t));
    expect(m.newStop).toBeCloseTo(line[99], 10);
    const crash = [...bars, { t: T0 + 100 * 3600, o: closes[99], c: closes[99] * 0.9, h: closes[99], l: closes[99] * 0.89 }];
    expect(s.manage(ctx(crash), pos("long", closes[flip], line[flip], bars[flip].t)).exit).toMatch(/flipped down/);
  });
  it("drift treats Supertrend like trend (payoff check)", () => {
    const trades = Array.from({ length: 20 }, (_, i) => ({ r: i % 3 ? -1 : 2.5, pnl: i % 3 ? -5 : 12.5, slippagePct: 0, fundingPnl: 0, openedAt: i, closedAt: i + 1 }));
    const r = computeDrift({ mode: "standard", strategy: "supertrend", trades, entryTimes: [], txAttempts: [], txFailures: [], baseline: { winRate: 0.35, rSamples: trades.map((t) => t.r), tradesPerDayP95: 6, payoff: 2.5, source: "t" }, now: 100 });
    expect(r.metrics.find((m) => m.id === "D-8")!.label).toBe("payoff ratio");
  });
});

// ---------------------------------------------------------------- shipped config on the paper venue
class FakeRef implements ReferenceFeed {
  price: number | null = 0.2;
  bars: Record<number, Candle[]> = {};
  async ticker() {
    return this.price;
  }
  async closedBars(gran: number, now: number) {
    return (this.bars[gran] ?? []).filter((b) => b.t + gran <= now);
  }
}

describe("fleet: config-paused desks", () => {
  let dir: string, now: number, venue: PaperOfficeVenue, ref: FakeRef, store: Store;
  const owners = Object.fromEntries(cfg.desks.map((d) => [d.id, { owner: `OWNER_${d.id}`, operatorSecret: "" }]));
  const shipped: OfficeConfig = { ...cfg, strictUntil: "2999-01-01T00:00:00Z" };
  const mk = (c: OfficeConfig) => new Fleet(c, venue, owners, store, ref, { mode: "live", baselines: {}, log: () => undefined, now: () => now });
  const setMarket = (closes: number[]) => {
    const t0 = Math.floor((now - closes.length * 3600) / 3600) * 3600;
    ref.bars[3600] = closes.map((c, i) => ({ t: t0 + i * 3600, o: i ? closes[i - 1] : c, c, h: Math.max(c, i ? closes[i - 1] : c) * 1.002, l: Math.min(c, i ? closes[i - 1] : c) * 0.998 }));
    ref.bars[14_400] = aggregate(ref.bars[3600], 3600, 4);
    ref.bars[900] = [];
    venue.price = ref.price = closes[closes.length - 1];
    venue.priceTs = now - 20;
  };
  const breakout = () => [...Array.from({ length: 80 }, (_, i) => 0.2 * (1 + 0.0015 * Math.sin(i / 2))), ...Array.from({ length: 5 }, (_, i) => 0.2 * (1 + 0.012 * (i + 1)))];
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "office-lp-"));
    now = 1_790_100_000;
    venue = new PaperOfficeVenue();
    venue.reserve = 10_000;
    for (const d of cfg.desks) venue.deposit(owners[d.id].owner, d.capital);
    ref = new FakeRef();
    store = new Store(dir);
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("Echo and Nova publish 'paused' with the reason; admin resume does not override the config pause; Lyra carries its label", async () => {
    setMarket(breakout());
    const f = mk(shipped);
    let st = (await f.step()) as { desks: { id: string; status: string; reason: string; label: string | null; strategy: string; timeframeSec: number }[] };
    const by = (id: string) => st.desks.find((x) => x.id === id)!;
    expect(by("echo").status).toBe("paused");
    expect(by("echo").reason).toMatch(/paused in config: 15m mean-reversion/);
    expect(by("nova").status).toBe("paused");
    expect(by("lyra").label).toBe("Experimental · liquidity pockets · simulated/testnet");
    expect(by("vega").strategy).toBe("supertrend");
    expect(by("rigel").timeframeSec).toBe(14_400);
    expect(by("halo").status).toBe("running");
    store.enqueue({ cmd: "resume", desk: "echo" });
    now += 60;
    st = (await f.step()) as typeof st;
    expect(by("echo").status).toBe("paused");
    expect([...venue.positions.values()].some((p) => p.owner === "OWNER_echo" || p.owner === "OWNER_nova")).toBe(false);
  });

  it("a desk paused in config takes no new entries but still stops out what it already holds", async () => {
    const legacy: OfficeConfig = { ...shipped, desks: shipped.desks.map(({ paused: _p, ...d }) => (d.id === "vega" ? { ...d, strategy: "trend" as const, params: {} } : d)) };
    setMarket(breakout());
    await mk(legacy).step();
    const p = [...venue.positions.values()].find((x) => x.owner === "OWNER_vega")!;
    expect(p).toBeTruthy();
    const pausedVega: OfficeConfig = { ...legacy, desks: legacy.desks.map((d) => (d.id === "vega" ? { ...d, paused: "test pause" } : d)) };
    const f2 = mk(pausedVega);
    now += 3600;
    venue.price = ref.price = p.stopLoss * 0.999;
    venue.priceTs = now - 20;
    await f2.step();
    expect(venue.positions.has(p.id)).toBe(false);
    expect(store.desk("vega").closed.at(-1)!.reason).toBe("stop_loss");
    expect(store.desk("vega").status).toBe("paused");
    now += 3600;
    setMarket(breakout());
    await f2.step();
    expect([...venue.positions.values()].some((x) => x.owner === "OWNER_vega")).toBe(false);
  });
});
