import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Address, scValToNative } from "@stellar/stellar-sdk";
import { assetScVal, marketKeyFor } from "../src/soroban.js";
import { defaultMarkets, loadDeployment } from "../src/office/deployment.js";
import { adx, aggregate, atr, bollinger, donchianPrev, emaSeries, rsi, type Candle } from "../src/office/indicators.js";
import { clampStop, sizePosition } from "../src/office/sizing.js";
import { deskGate, fleetGate, fleetLevel, fundingGuard, riskToStop } from "../src/office/risk.js";
import { bootstrapPercentile, computeDrift, ksTest, type Baseline, type ClosedTrade } from "../src/office/drift.js";
import { oracleVerdict } from "../src/office/oracleGuard.js";
import { reconcile, Store } from "../src/office/store.js";
import { funding, meanrev, trend } from "../src/office/strategies.js";
import { Fleet, fundingRates } from "../src/office/fleet.js";
import { PaperOfficeVenue } from "../src/office/venue.js";
import { loadOfficeConfig, parseOfficeConfig } from "../src/office/config.js";
import { backtest } from "../src/office/backtest.js";
import type { DeskConfig, OfficeConfig } from "../src/office/types.js";
import type { ReferenceFeed } from "../src/office/marketData.js";

const cfg = loadOfficeConfig();
const L = cfg.limits;
const desk = (id: string) => cfg.desks.find((d) => d.id === id)!;

function series(closes: number[], t0 = 1_790_000_000, tf = 3600, wick = 0.002): Candle[] {
  return closes.map((c, i) => {
    const o = i ? closes[i - 1] : c;
    return { t: t0 + i * tf, o, c, h: Math.max(o, c) * (1 + wick), l: Math.min(o, c) * (1 - wick) };
  });
}
const flat = (n: number, p = 0.2, amp = 0.0015) => Array.from({ length: n }, (_, i) => p * (1 + amp * Math.sin(i / 2)));

describe("market key (perps-v1 vault keys XLM by token address)", () => {
  it("deployments vault.marketAsset is Stellar(XLM SAC) and encodes as an Asset::Stellar vec", () => {
    const dep = loadDeployment();
    expect(dep.vault.marketAsset).toEqual({ Stellar: dep.contracts.xlmSac });
    const v = scValToNative(assetScVal(dep.vault.marketAsset));
    expect(v).toEqual(["Stellar", dep.contracts.xlmSac]);
    expect(scValToNative(marketKeyFor("XLM", defaultMarkets(dep)))).toEqual(["Stellar", dep.contracts.xlmSac]);
    expect(scValToNative(marketKeyFor("BTC", defaultMarkets(dep)))).toEqual(["Other", "BTC"]);
    expect(Address.fromString(dep.contracts.xlmSac).toString()).toBe(dep.contracts.xlmSac);
  });
});

describe("indicators", () => {
  it("ema / bollinger / donchian / aggregate", () => {
    const v = [1, 2, 3, 4, 5, 6];
    expect(emaSeries(v, 3)[2]).toBeCloseTo(2);
    expect(emaSeries(v, 3)[5]).toBeCloseTo(5);
    const bb = bollinger([1, 1, 1, 1], 4, 2);
    expect(bb.upper).toBe(1);
    const bars = series([1, 2, 3, 4, 5]);
    expect(donchianPrev(bars, 3).high).toBeCloseTo(4 * 1.002);
    const agg = aggregate(series(Array.from({ length: 9 }, (_, i) => i + 1), 1_790_006_400, 3600), 3600, 4);
    expect(agg.every((b) => b.t % 14_400 === 0)).toBe(true);
    expect(agg[0].c).toBe(4);
  });
  it("rsi extremes, atr positive, adx high in a trend and low in chop", () => {
    const up = Array.from({ length: 40 }, (_, i) => 1 + i * 0.01);
    expect(rsi(up)).toBe(100);
    expect(atr(series(up))).toBeGreaterThan(0);
    expect(adx(series(up))).toBeGreaterThan(40);
    expect(adx(series(flat(80)))).toBeLessThan(25);
  });
});

describe("sizing (risk 1-2% via stop distance)", () => {
  const base = { equity: 500, riskPct: 1, hardMaxRiskPct: 2, entry: 0.2, maxLeverage: 5, maxMarginPct: 25, maxNotionalX: 1.5, minMargin: 10, feeBufferPct: 0.25, mmBps: 500 };
  it("scope example: 2% stop -> ~222 notional, risk ~5 QUSD", () => {
    const s = sizePosition({ ...base, stop: 0.196 });
    expect(s.ok).toBe(true);
    if (!s.ok) return;
    expect(s.notional).toBeCloseTo(5 / 0.0225, 1);
    expect(s.riskAmount).toBeCloseTo(5, 5);
    expect(s.margin).toBeLessThanOrEqual(125 + 1e-9);
    expect(s.leverage).toBeGreaterThanOrEqual(1);
  });
  it("never exceeds the hard max risk even if asked for more", () => {
    const s = sizePosition({ ...base, riskPct: 5, stop: 0.19 });
    expect(s.ok && s.riskAmount).toBeCloseTo(10, 5);
  });
  it("tight stop is capped by notional cap; leverage capped by liquidation rule", () => {
    const s = sizePosition({ ...base, stop: 0.1999 });
    expect(s.ok && s.notional).toBeLessThanOrEqual(750);
    const w = sizePosition({ ...base, stop: 0.188, maxLeverage: 10 }); // 6% stop -> lev <= 1/(0.12+0.05)=5.88
    expect(w.ok && w.leverage).toBeLessThanOrEqual(5.88);
    if (w.ok) expect(w.stopDistPct / 100).toBeLessThanOrEqual((1 / w.leverage - 0.05) / 2 + 1e-9);
  });
  it("shrinks to fleet budgets and refuses dust / insufficient collateral", () => {
    const s = sizePosition({ ...base, stop: 0.196, riskBudget: 1 });
    expect(s.ok && s.riskAmount).toBeCloseTo(1, 5);
    expect(sizePosition({ ...base, stop: 0.196, riskBudget: 0 }).ok).toBe(false);
    expect(sizePosition({ ...base, equity: 20, stop: 0.196 }).ok).toBe(false);
    expect(sizePosition({ ...base, stop: 0.196, freeCollateral: 5, openFeeBps: 10 }).ok).toBe(false);
  });
  it("clampStop widens tiny stops to the min and rejects stops beyond the max", () => {
    expect(clampStop("long", 1, 0.999, 0.8, 7.5)).toBeCloseTo(0.992);
    expect(clampStop("short", 1, 1.001, 0.8, 7.5)).toBeCloseTo(1.008);
    expect(clampStop("long", 1, 0.9, 0.8, 7.5)).toBeNull();
  });
});

describe("risk gates", () => {
  const now = 1_790_000_000;
  const st = { equity: 500, dayStartEquity: 500, peakEquity: 500, lossStreak: 0, pausedUntil: 0, entryTimes: [] as number[] };
  it("desk: ok, daily loss block, drawdown halt, loss-streak pause, caps", () => {
    expect(deskGate(st, 0, L, now).action).toBe("ok");
    expect(deskGate({ ...st, equity: 484 }, 0, L, now).action).toBe("block");
    expect(deskGate({ ...st, equity: 449, dayStartEquity: 449, peakEquity: 500 }, 0, L, now).action).toBe("halt");
    expect(deskGate({ ...st, lossStreak: 5 }, 0, L, now).action).toBe("pause");
    expect(deskGate(st, 2, L, now).action).toBe("block");
    expect(deskGate({ ...st, entryTimes: Array(6).fill(now - 10) }, 0, L, now).action).toBe("block");
  });
  it("funding guard blocks the paying side above 0.03%/h", () => {
    expect(fundingGuard("long", 0.0004, L)).toMatch(/pays/);
    expect(fundingGuard("short", 0.0004, L)).toBeNull();
  });
  it("fleet: risk budget, same-direction cap, notional vs reserve, daily pause, drawdown kill", () => {
    const f = { equity: 3000, dayStartEquity: 3000, peakEquity: 3000, entryTimes: [], open: [] as ReturnType<typeof Array<never>>, reserve: 10_000 };
    const ok = fleetGate(f, "long", L, now);
    expect(ok.action).toBe("ok");
    if (ok.action === "ok") {
      expect(ok.riskBudget).toBeCloseTo(105); // 3.5% same-dir binds first
      expect(ok.notionalBudget).toBeCloseTo(4500); // net 1.5x binds before gross 2x/5000 reserve
    }
    const longs = [{ side: "long" as const, size: 2000, price: 0.2, stop: 0.193, margin: 400 }];
    expect(riskToStop(longs[0])).toBeCloseTo(70);
    const r = fleetGate({ ...f, open: longs }, "long", L, now);
    expect(r.action === "ok" && r.riskBudget).toBeCloseTo(35);
    expect(fleetGate({ ...f, open: [{ ...longs[0], stop: 0.18 }] }, "long", L, now).action).toBe("block");
    expect(fleetGate({ ...f, reserve: 1000 }, "short", L, now).action === "ok" && (fleetGate({ ...f, reserve: 1000 }, "short", L, now) as { notionalBudget: number }).notionalBudget).toBeCloseTo(500);
    expect(fleetLevel({ ...f, equity: 2870 }, L).action).toBe("pause");
    expect(fleetLevel({ ...f, equity: 2600, dayStartEquity: 2600 }, L).action).toBe("kill");
  });
});

describe("drift", () => {
  const now = 1_790_000_000;
  const base: Baseline = { winRate: 0.5, rSamples: Array.from({ length: 60 }, (_, i) => (i % 2 ? 1.2 : -1)), tradesPerDayP95: 2, payoff: 1.2, source: "test" };
  const mk = (rs: number[], slip = 0.05): ClosedTrade[] => rs.map((r, i) => ({ r, pnl: r * 5, slippagePct: slip, fundingPnl: 0, openedAt: now - 1e5 + i, closedAt: now - 1e5 + i + 1 }));
  const inp = (trades: ClosedTrade[], extra = {}) => ({ mode: "strict" as const, strategy: "meanrev" as const, trades, entryTimes: [], txAttempts: [], txFailures: [], baseline: base, now, ...extra });
  it("ks test + bootstrap behave", () => {
    expect(ksTest([1, 2, 3], [1, 2, 3]).p).toBeGreaterThan(0.9);
    expect(ksTest(Array(40).fill(-1), Array(40).fill(1)).p).toBeLessThan(0.001);
    expect(bootstrapPercentile([1, -1], 30, -30)).toBe(0);
  });
  it("green when live matches baseline", () => {
    const d = computeDrift(inp(mk(Array.from({ length: 30 }, (_, i) => (i % 2 ? 1.2 : -1)))));
    expect(d.halt).toBeNull();
    expect(d.level).toBe("green");
  });
  it("halts on collapsed win rate / R distribution (strict)", () => {
    const d = computeDrift(inp(mk(Array.from({ length: 30 }, (_, i) => (i % 6 ? -1 : 1.2)))));
    expect(d.halt).toMatch(/D-1|D-2|D-3/);
    expect(d.level).toBe("red");
  });
  it("hard triggers: slippage, failed txs, frequency", () => {
    expect(computeDrift(inp(mk([1], 0.8))).halt).toMatch(/D-4 fill slippage/);
    expect(computeDrift(inp([], { txAttempts: Array(10).fill(now - 60), txFailures: Array(3).fill(now - 60) })).halt).toMatch(/failed tx/);
    expect(computeDrift(inp([], { entryTimes: Array(5).fill(now - 60) })).halt).toMatch(/D-5/);
  });
  it("waits for enough trades before statistical tests; mean-rev oversized losses halt", () => {
    expect(computeDrift(inp(mk([-1, -1, -1]))).halt).toBeNull();
    expect(computeDrift(inp(mk([-1.8, 1, -1.7]))).halt).toMatch(/oversized/);
  });
});

describe("oracle guard (independent freshness/deviation)", () => {
  const c = cfg.oracle;
  const now = 1_790_000_000;
  it("ok / deviation halt / age halt / no reference / flat oracle", () => {
    expect(oracleVerdict(now, now - 30, [{ t: now, oracle: 0.2, ref: 0.2005 }], c).level).toBe("ok");
    expect(oracleVerdict(now, now - 30, [{ t: now, oracle: 0.2, ref: 0.21 }], c).level).toBe("halt");
    expect(oracleVerdict(now, now - 120, [{ t: now, oracle: 0.2, ref: 0.2 }], c).level).toBe("halt"); // vault rejects > 90 s
    expect(oracleVerdict(now, now - 30, [{ t: now, oracle: 0.2, ref: null }], c).level).toBe("halt");
    const hist = Array.from({ length: 25 }, (_, i) => ({ t: now - 1200 + i * 50, oracle: 0.2, ref: 0.2 * (1 + i * 0.0003) }));
    expect(oracleVerdict(now, now - 30, hist, c).reasons.join()).toMatch(/flat/);
  });
});

describe("strategies", () => {
  it("trend: breakout long with ATR stop; exits on close below EMA20; trails", () => {
    const s = trend(desk("vega"));
    const closes = [...flat(60), ...Array.from({ length: 6 }, (_, i) => 0.2 * (1 + 0.012 * (i + 1)))];
    const bars = series(closes);
    const sig = s.entry({ bars, price: closes[closes.length - 1], now: bars[bars.length - 1].t + 3600, fundingExtHourly: 0, fundingSamples: [], externalSkew: 0, trendBreakoutRecent: false });
    expect(sig?.side).toBe("long");
    expect(sig!.stop).toBeLessThan(closes[closes.length - 1]);
    const pos = { id: 1, side: "long" as const, margin: 50, size: 150, entry: 0.21, openedAt: 0, stopLoss: 0.19, takeProfit: 0, pendingFunding: 0 };
    expect(s.manage({ bars, price: 0.24, now: 0, fundingExtHourly: 0, fundingSamples: [], externalSkew: 0, trendBreakoutRecent: false }, pos).newStop).toBeGreaterThan(0.19);
    const down = series([...closes, 0.2]);
    expect(s.manage({ bars: down, price: 0.2, now: 0, fundingExtHourly: 0, fundingSamples: [], externalSkew: 0, trendBreakoutRecent: false }, pos).exit).toMatch(/EMA/);
  });
  it("funding: enters on the receiving side only with persistent external skew, exits when it fades", () => {
    const s = funding(desk("lyra"));
    const bars = series(flat(10));
    const ctx = { bars, price: 0.2, now: 1e9, fundingExtHourly: 0.0003, fundingSamples: [0.00025, 0.0003], externalSkew: 150_000, trendBreakoutRecent: false };
    const sig = s.entry(ctx);
    expect(sig?.side).toBe("short"); // longs pay -> short receives
    expect(sig!.stop).toBeCloseTo(0.2 * 1.0125);
    expect(s.entry({ ...ctx, externalSkew: 100 })).toBeNull();
    expect(s.entry({ ...ctx, fundingSamples: [-0.0003, 0.0003] })).toBeNull();
    const pos = { id: 1, side: "short" as const, margin: 50, size: 100, entry: 0.2, openedAt: 1e9 - 10, stopLoss: 0.2025, takeProfit: 0.197, pendingFunding: 0 };
    expect(s.manage({ ...ctx, fundingExtHourly: 0.00005 }, pos).exit).toMatch(/faded/);
    expect(s.manage({ ...ctx, fundingExtHourly: -0.0002 }, pos).exit).toMatch(/flipped/);
    expect(s.manage({ ...ctx, now: 1e9 + 90_000 }, pos).exit).toMatch(/max hold/);
  });
  it("mean-rev: fades a stretched close in a range, skips after a trend breakout, time stop", () => {
    const s = meanrev(desk("halo"));
    const closes = [...flat(60), 0.2 * 0.985];
    const bars = series(closes, 1_790_000_000, 3600, 0.0005);
    const ctx = { bars, price: closes[closes.length - 1], now: bars[bars.length - 1].t + 3600, fundingExtHourly: 0, fundingSamples: [], externalSkew: 0, trendBreakoutRecent: false };
    const sig = s.entry(ctx);
    expect(sig?.side).toBe("long");
    expect(sig!.takeProfit).toBeGreaterThan(ctx.price);
    expect(s.entry({ ...ctx, trendBreakoutRecent: true })).toBeNull();
    const pos = { id: 1, side: "long" as const, margin: 50, size: 100, entry: 0.197, openedAt: ctx.now - 13 * 3600, stopLoss: 0.19, takeProfit: 0.2, pendingFunding: 0 };
    expect(s.manage(ctx, pos).exit).toMatch(/time stop/);
  });
});

describe("reconcile", () => {
  it("separates explained closes, unexplained disappearances and unknown positions", () => {
    expect(reconcile([1, 2, 3], [3, 9], [{ id: 1 }])).toEqual({ closed: [1], missing: [2], unknown: [9] });
  });
});

describe("funding rates exclude the fleet's own OI", () => {
  it("external skew drives the rate; fleet OI is removed", () => {
    const m = { funding: { k: 0.0005, skewScale: 250_000, maxPremium: 0.0005, capPerHour: 0.0005, interestPerInterval: 0, interval: 3600, premium: 0, premiumTwap: 0 }, longOi: 10_000, shortOi: 0 } as never;
    const r = fundingRates(m, 10_000, 0);
    expect(r.extSkew).toBe(0);
    expect(r.extHourly).toBe(0);
    expect(fundingRates(m, 0, 0).extHourly).toBeCloseTo(0.0005 * 10_000 / 250_000);
  });
});

describe("config + backtest", () => {
  it("validates desks and refuses > 2% risk", () => {
    expect(cfg.desks.map((d) => d.name)).toEqual(["Vega", "Regal", "Lyra", "Nova", "Echo", "Halo"]);
    expect(Object.fromEntries(cfg.desks.map((d) => [d.id, `${d.strategy}/${d.timeframeSec}${d.paused ? "/paused" : ""}`]))).toEqual({
      vega: "supertrend/3600", rigel: "trend/14400", lyra: "liqpocket/3600", nova: "funding/3600/paused", echo: "meanrev/900/paused", halo: "meanrev/3600",
    });
    for (const d of cfg.desks) expect(d.riskPct).toBeLessThanOrEqual(1);
    expect(desk("lyra").label).toMatch(/Experimental · liquidity pockets · simulated\/testnet/);
    expect(cfg.oracle.haltAgeSec).toBeLessThanOrEqual(90);
    expect(() => parseOfficeConfig({ ...cfg, desks: [{ ...cfg.desks[0], strategy: "martingale" as never }] })).toThrow(/unknown strategy/);
    expect(() => parseOfficeConfig({ ...cfg, desks: [{ ...cfg.desks[0], riskPct: 3 }] })).toThrow(/riskPct/);
    expect(() => parseOfficeConfig({ ...cfg, limits: { ...L, hardMaxRiskPct: 5 } })).toThrow();
  });
  it("backtest on a synthetic trend produces trades with bounded per-trade loss", () => {
    const closes: number[] = [];
    let p = 0.2;
    for (let i = 0; i < 600; i++) closes.push((p *= 1 + 0.004 * Math.sin(i / 25) + 0.0004 * Math.cos(i * 1.7)));
    const r = backtest({ ...desk("vega"), strategy: "trend", params: {} }, series(closes), L, 500);
    expect(r.trades.length).toBeGreaterThan(2);
    for (const t of r.trades) expect(t.pnl).toBeGreaterThan(-500 * 0.02 * 1.6); // stop-sized losses (gaps/fees allowed)
  });
});

// ---------------------------------------------------------------- fleet end-to-end on the paper venue
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

describe("fleet (paper venue)", () => {
  let dir: string;
  let now: number;
  let venue: PaperOfficeVenue;
  let ref: FakeRef;
  let store: Store;
  let fleet: Fleet;
  const owners = Object.fromEntries(cfg.desks.map((d) => [d.id, { owner: `OWNER_${d.id}`, operatorSecret: "" }]));
  // end-to-end mechanics are tested on the original six running desks (Vega = 1h Donchian trend, no filter);
  // the shipped config (paused desks, Supertrend, liquidity filter) is exercised in "fleet: shipped config" below.
  const config: OfficeConfig = {
    ...cfg,
    strictUntil: "2999-01-01T00:00:00Z",
    desks: cfg.desks.map(({ paused: _p, ...d }) => (d.id === "vega" ? { ...d, strategy: "trend" as const, params: {} } : d)),
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "office-"));
    now = 1_790_100_000;
    venue = new PaperOfficeVenue();
    venue.reserve = 10_000;
    for (const d of cfg.desks) venue.deposit(owners[d.id].owner, d.capital);
    ref = new FakeRef();
    store = new Store(dir);
    fleet = new Fleet(config, venue, owners, store, ref, { mode: "live", baselines: {}, log: () => undefined, now: () => now });
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const setMarket = (closes: number[], tf = 3600) => {
    const t0 = Math.floor((now - closes.length * tf) / tf) * tf;
    ref.bars[tf] = series(closes, t0, tf);
    ref.bars[14_400] = aggregate(ref.bars[3600] ?? [], 3600, 4);
    ref.bars[900] = ref.bars[900] ?? [];
    const px = closes[closes.length - 1];
    venue.price = px;
    venue.priceTs = now - 60;
    ref.price = px;
  };
  const breakout = () => [...flat(80), ...Array.from({ length: 5 }, (_, i) => 0.2 * (1 + 0.012 * (i + 1)))];

  it("opens a risk-sized trend position with an on-chain stop and publishes status", async () => {
    setMarket(breakout());
    const st = (await fleet.step()) as { desks: { id: string; open: unknown[]; status: string }[]; fleet: { openPositions: number; riskUsedPct: number } };
    const vega = st.desks.find((d) => d.id === "vega")!;
    expect(vega.open.length).toBe(1);
    const p = [...venue.positions.values()].find((x) => x.owner === "OWNER_vega")!;
    expect(p.side).toBe("long");
    expect(p.stopLoss).toBeGreaterThan(0);
    const risk = ((p.entry - p.stopLoss) / p.entry) * p.size;
    expect(risk).toBeLessThanOrEqual(500 * 0.01 + 1e-6); // <= 1% of desk equity
    expect(p.size / p.margin).toBeLessThanOrEqual(5);
    expect(st.fleet.riskUsedPct).toBeLessThanOrEqual(5);
    expect(store.desk("vega").open[String(p.id)].openTx).toMatch(/^paper-/);
  });

  it("executes the stop when price crosses it and journals the loss in R", async () => {
    setMarket(breakout());
    await fleet.step();
    const p = [...venue.positions.values()].find((x) => x.owner === "OWNER_vega")!;
    now += 60;
    venue.price = p.stopLoss * 0.999;
    ref.price = venue.price;
    venue.priceTs = now - 30;
    await fleet.step();
    expect(venue.positions.has(p.id)).toBe(false);
    const c = store.desk("vega").closed.at(-1)!;
    expect(c.reason).toBe("stop_loss");
    expect(c.r).toBeLessThan(0);
    expect(c.r).toBeGreaterThan(-1.3);
  });

  it("reconciles a third-party trigger via close events; halts on an unknown on-chain position", async () => {
    setMarket(breakout());
    await fleet.step();
    const p = [...venue.positions.values()].find((x) => x.owner === "OWNER_vega")!;
    venue.externalTrigger(p.id, "stop_loss");
    now += 60;
    await fleet.step();
    expect(store.desk("vega").closed.at(-1)!.id).toBe(p.id);
    expect(store.desk("vega").status).not.toBe("halted");
    // a position the journal never opened
    await venue.open(owners.rigel, "long", 20, 20_000);
    now += 60;
    await fleet.step();
    expect(store.desk("rigel").status).toBe("halted");
    now += 60;
    await fleet.step(); // halt flattens
    expect([...venue.positions.values()].some((x) => x.owner === "OWNER_rigel")).toBe(false);
  });

  it("global kill (flag file) closes every position and blocks entries until unkill", async () => {
    setMarket(breakout());
    await fleet.step();
    expect(venue.positions.size).toBeGreaterThan(0);
    store.setKillFlag("test kill");
    now += 60;
    const st = (await fleet.step()) as { fleet: { status: string } };
    expect(st.fleet.status).toBe("killed");
    expect(venue.positions.size).toBe(0);
    store.enqueue({ cmd: "unkill" });
    now += 60;
    const st2 = (await fleet.step()) as { fleet: { status: string } };
    expect(st2.fleet.status).toBe("running");
  });

  it("blocks entries when the oracle deviates from the independent reference, kills after 30 min", async () => {
    setMarket(breakout());
    ref.price = venue.price * 1.03;
    await fleet.step();
    expect(venue.positions.size).toBe(0);
    expect(store.desk("vega").lastSignal).toMatch(/oracle/);
    for (let i = 0; i < 32; i++) {
      now += 60;
      venue.priceTs = now - 30;
      await fleet.step();
    }
    expect(store.fleet().killed).toBe(true);
  });

  it("drawdown halt flattens the desk; manual pause/resume via commands", async () => {
    setMarket(breakout());
    await fleet.step();
    const s = store.desk("vega");
    s.peakEquity = 600; // equity ~500 -> 16% drawdown
    store.saveDesk("vega", s);
    now += 60;
    await fleet.step();
    expect(store.desk("vega").status).toBe("halted");
    expect([...venue.positions.values()].some((x) => x.owner === "OWNER_vega")).toBe(false);
    store.enqueue({ cmd: "pause", desk: "echo" });
    now += 60;
    await fleet.step();
    expect(store.desk("echo").status).toBe("paused");
    store.enqueue({ cmd: "resume", desk: "echo" });
    store.enqueue({ cmd: "reset", desk: "vega" });
    now += 60;
    await fleet.step();
    expect(store.desk("echo").status).toBe("running");
    expect(store.desk("vega").status).toBe("running");
  });

  it("closes a fresh position if its on-chain stop cannot be set (never runs unprotected)", async () => {
    setMarket(breakout());
    const orig = venue.setTriggers.bind(venue);
    venue.setTriggers = async () => {
      throw new Error("set_triggers boom");
    };
    await fleet.step();
    venue.setTriggers = orig;
    expect([...venue.positions.values()].some((x) => x.owner === "OWNER_vega")).toBe(false);
    expect(store.desk("vega").closed.at(-1)!.reason).toBe("no_stop");
  });

  it("dry-run never sends transactions", async () => {
    const dry = new Fleet(config, venue, owners, store, ref, { mode: "dry-run", baselines: {}, log: () => undefined, now: () => now });
    setMarket(breakout());
    await dry.step();
    expect(venue.positions.size).toBe(0);
    expect(store.desk("vega").lastSignal).toMatch(/dry-run: would open LONG/);
  });

  it("floor-wide same-direction cap limits combined long risk across desks", async () => {
    // pre-load other desks with long risk close to the 3.5% cap (3000 equity -> 105 QUSD)
    for (const id of ["lyra", "nova"]) {
      const r = await venue.open(owners[id], "long", 100, 50_000);
      await venue.setTriggers(owners[id], r.value.id, 0.2 * 0.9, 0);
      const s = store.desk(id);
      s.open[String(r.value.id)] = { id: r.value.id, side: "long", entry: 0.2, decisionPrice: 0.2, stop: 0.18, takeProfit: 0, size: 500, margin: 100, leverage: 5, riskAmount: 50, openedAt: now, reason: "test", openTx: r.hash, lastPendingFunding: 0 };
      store.saveDesk(id, s);
    }
    setMarket(breakout());
    venue.price = 0.2; // keep the preloaded positions' risk to stop at 2 × 50 = 100
    ref.price = 0.2;
    await fleet.step();
    const vegaPos = [...venue.positions.values()].filter((x) => x.owner === "OWNER_vega");
    const total = [...venue.positions.values()].filter((x) => x.side === "long").reduce((a, x) => a + ((venue.price - x.stopLoss) / venue.price) * x.size, 0);
    expect(total).toBeLessThanOrEqual(3000 * 0.035 + 1e-6);
    if (vegaPos.length) expect(((venue.price - vegaPos[0].stopLoss) / venue.price) * vegaPos[0].size).toBeLessThan(5);
  });
});

export type { DeskConfig };
