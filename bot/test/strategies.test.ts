import { describe, expect, it } from "vitest";
import { DcaStrategy, GridStrategy, MomentumStrategy } from "../src/strategies/index.js";
import { ema, sma } from "../src/indicators.js";
import type { Position } from "../src/types.js";

const base = { asset: "XLM", side: "long" as const, leverage: 3, margin: 10, stopLossPct: 5, takeProfitPct: 10 };
const pos = (id: number, entryPrice: number): Position => ({ id, owner: "o", asset: "XLM", side: "long", margin: 10, size: 30, entryPrice, openedAt: 0, stopLoss: 0, takeProfit: 0, strategyId: "g" });

describe("indicators", () => {
  it("sma / ema", () => {
    expect(sma([1, 2, 3, 4], 2)).toBe(3.5);
    expect(sma([1], 2)).toBeNull();
    expect(ema([1, 1, 1, 1], 3)).toBe(1);
    const e = ema([1, 2, 3, 4, 5, 6], 3)!;
    expect(e).toBeGreaterThan(4);
    expect(e).toBeLessThan(6);
  });
});

describe("GridStrategy", () => {
  it("builds evenly spaced lines", () => {
    const g = new GridStrategy({ ...base, id: "g", type: "grid", lower: 0.1, upper: 0.14, levels: 5 });
    expect(g.gridLines().map((x) => +x.toFixed(4))).toEqual([0.1, 0.11, 0.12, 0.13, 0.14]);
  });
  it("opens on a downward cross and closes one step higher", () => {
    const g = new GridStrategy({ ...base, id: "g", type: "grid", lower: 0.1, upper: 0.14, levels: 5 });
    expect(g.onTick({ tick: { time: 1, price: 0.125 }, positions: [] })).toEqual([]);
    const a = g.onTick({ tick: { time: 2, price: 0.119 }, positions: [] });
    expect(a).toHaveLength(1);
    expect(a[0].kind).toBe("open");
    g.onOpened(1, 0.119);
    // no duplicate at the same level
    expect(g.onTick({ tick: { time: 3, price: 0.121 }, positions: [pos(1, 0.119)] })).toEqual([]);
    expect(g.onTick({ tick: { time: 4, price: 0.1195 }, positions: [pos(1, 0.119)] }).filter((x) => x.kind === "open")).toHaveLength(0);
    const exit = g.onTick({ tick: { time: 5, price: 0.1295 }, positions: [pos(1, 0.119)] });
    expect(exit.some((x) => x.kind === "close" && x.positionId === 1)).toBe(true);
  });
});

describe("DcaStrategy", () => {
  it("buys on schedule up to maxOrders", () => {
    const d = new DcaStrategy({ ...base, id: "d", type: "dca", intervalSec: 100, maxOrders: 2 });
    expect(d.onTick({ tick: { time: 0, price: 1 }, positions: [] })).toHaveLength(1);
    expect(d.onTick({ tick: { time: 50, price: 1 }, positions: [] })).toHaveLength(0);
    expect(d.onTick({ tick: { time: 100, price: 1 }, positions: [] })).toHaveLength(1);
    expect(d.onTick({ tick: { time: 1000, price: 1 }, positions: [] })).toHaveLength(0);
  });
});

describe("MomentumStrategy", () => {
  it("enters on bullish EMA cross and exits on bearish cross", () => {
    const m = new MomentumStrategy({ ...base, id: "m", type: "momentum", fastPeriod: 3, slowPeriod: 6 });
    let t = 0;
    const feed = (p: number, positions: Position[] = []) => m.onTick({ tick: { time: t++, price: p }, positions });
    for (let i = 0; i < 10; i++) feed(1 - i * 0.01); // downtrend
    let opened = false;
    for (let i = 0; i < 10 && !opened; i++) opened = feed(0.9 + i * 0.03).some((a) => a.kind === "open");
    expect(opened).toBe(true);
    let closed = false;
    const held = [{ ...pos(9, 1), strategyId: "m" }];
    for (let i = 0; i < 15 && !closed; i++) closed = feed(1.2 - i * 0.04, held).some((a) => a.kind === "close");
    expect(closed).toBe(true);
  });
});
