import { describe, expect, it } from "vitest";
import { PaperVault } from "../src/exchange.js";
import { planKeeperActions, runKeeperOnce } from "../src/keeper.js";
import { healthFactor, liquidationPrice, triggerHit, triggerPrices } from "../src/math.js";
import { RiskManager } from "../src/risk.js";
import type { Action } from "../src/types.js";

const open: Action = { kind: "open", strategyId: "s", asset: "XLM", side: "long", margin: 10, leverage: 3, stopLossPct: 5, takeProfitPct: 10, reason: "t" };

describe("RiskManager", () => {
  it("enforces leverage cap and max open positions", () => {
    const r = new RiskManager({ maxLeverage: 5, maxOpenPositions: 2, maxDailyLossPct: 10 }, 1000);
    expect(r.check(open, 0, 0)).toBeNull();
    expect(r.check({ ...open, leverage: 6 }, 0, 0)).toMatch(/exceeds cap/);
    expect(r.check(open, 2, 0)).toMatch(/max open/);
    expect(r.check({ kind: "close", positionId: 1, reason: "x" }, 99, 0)).toBeNull();
  });
  it("halts entries after the daily loss limit and resets next UTC day", () => {
    const r = new RiskManager({ maxLeverage: 5, maxOpenPositions: 5, maxDailyLossPct: 10 }, 1000);
    r.recordRealized(-60, 100);
    expect(r.check(open, 0, 100)).toBeNull();
    r.recordRealized(-50, 200);
    expect(r.check(open, 0, 300)).toMatch(/daily loss/);
    expect(r.check(open, 0, 86_400 + 1)).toBeNull();
  });
});

describe("vault math parity with contracts/leverage-vault tests", () => {
  it("10x long with 5% maintenance liquidates at -5%", () => {
    expect(liquidationPrice("long", 1000, 10_000, 1, 500)).toBeCloseTo(0.95);
    expect(healthFactor({ side: "long", size: 10_000, entryPrice: 1, margin: 1000 }, 0.94, 500)).toBeCloseTo(0.8);
  });
  it("trigger prices + detection", () => {
    const t = triggerPrices("short", 100, 5, 10);
    expect(t).toEqual({ stopLoss: 105, takeProfit: 90 });
    expect(triggerHit({ side: "short", ...t }, 106)).toBe("stop_loss");
    expect(triggerHit({ side: "short", ...t }, 89)).toBe("take_profit");
    expect(triggerHit({ side: "short", ...t }, 100)).toBeNull();
  });
});

describe("PaperVault", () => {
  it("charges fees, pays profit from the reserve and caps it", async () => {
    const v = new PaperVault({ liquidity: 20 });
    v.setPrice("XLM", 1);
    v.deposit("u", 1000);
    const p = await v.open({ owner: "u", asset: "XLM", side: "long", margin: 100, leverage: 10 });
    expect(v.freeCollateral("u")).toBeCloseTo(1000 - 100 - 1); // 0.1% of 1000 notional
    v.setPrice("XLM", 1.5); // +500 pnl, capped by 21 reserve (20 + 1 fee)
    const r = await v.close(p.id);
    expect(r.payout).toBeCloseTo(121);
    expect(v.liquidity).toBeCloseTo(0);
  });
  it("rejects leverage above the cap", async () => {
    const v = new PaperVault({ liquidity: 0, maxLeverage: 10 });
    v.setPrice("XLM", 1);
    v.deposit("u", 1000);
    await expect(v.open({ owner: "u", asset: "XLM", side: "long", margin: 10, leverage: 11 })).rejects.toThrow("LeverageTooHigh");
  });
});

describe("keeper", () => {
  it("plans liquidations and trigger executions", () => {
    const mk = (id: number, over = {}) => ({ id, owner: "u", asset: "XLM", side: "long" as const, margin: 100, size: 1000, entryPrice: 1, openedAt: 0, stopLoss: 0, takeProfit: 0, ...over });
    const actions = planKeeperActions([mk(1), mk(2, { stopLoss: 0.97 }), mk(3, { takeProfit: 1.2 })], { XLM: 0.96 }, 500);
    // pos1: equity 60 vs maint 50 -> healthy; pos2: SL hit
    expect(actions).toEqual([{ id: 2, kind: "trigger", detail: "stop_loss" }]);
    const crash = planKeeperActions([mk(1)], { XLM: 0.94 }, 500);
    expect(crash[0].kind).toBe("liquidate");
  });
  it("sweeps a vault: liquidates unhealthy, executes SL, leaves healthy", async () => {
    const v = new PaperVault({ liquidity: 10_000 });
    v.setPrice("XLM", 1);
    v.deposit("a", 10_000);
    const risky = await v.open({ owner: "a", asset: "XLM", side: "long", margin: 100, leverage: 10 });
    const guarded = await v.open({ owner: "a", asset: "XLM", side: "long", margin: 100, leverage: 2 });
    await v.setTriggers(guarded.id, 0.97, 0);
    const calm = await v.open({ owner: "a", asset: "XLM", side: "short", margin: 100, leverage: 2 });
    v.setPrice("XLM", 0.94);
    const res = await runKeeperOnce(v, () => void 0);
    expect(res.map((r) => [r.action.id, r.action.kind, r.ok])).toEqual([
      [risky.id, "liquidate", true],
      [guarded.id, "trigger", true],
    ]);
    expect(res[0].value).toBeCloseTo(5); // 5% of 100 margin
    expect(await v.openPositionIds()).toEqual([calm.id]);
  });
});
