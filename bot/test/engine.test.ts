import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parseConfig } from "../src/config.js";
import { BotEngine, randomWalk } from "../src/engine.js";
import { PaperVault } from "../src/exchange.js";

describe("BotEngine (paper)", () => {
  it("runs all strategies deterministically, attaching SL/TP triggers and respecting risk caps", async () => {
    const cfg = parseConfig(JSON.parse(readFileSync(new URL("../quasaria-bot.config.example.json", import.meta.url), "utf8")));
    const vault = new PaperVault({ liquidity: 1_000_000, maxLeverage: cfg.risk.maxLeverage });
    vault.deposit("me", 10_000);
    const engine = new BotEngine(cfg, vault, "me", 10_000);
    for (const t of randomWalk(0.12, 400, 0.006, 7)) {
      vault.setPrice("XLM", t.price);
      await engine.tick("XLM", t);
      const open = await vault.positions("me");
      expect(open.length).toBeLessThanOrEqual(cfg.risk.maxOpenPositions);
      for (const p of open) {
        expect(p.stopLoss).toBeGreaterThan(0);
        expect(p.takeProfit).toBeGreaterThan(0);
      }
    }
    const types = new Set(engine.events.map((e) => e.type));
    expect(types.has("open")).toBe(true);
    expect(types.has("close")).toBe(true);
    expect(engine.events.filter((e) => e.type === "error")).toEqual([]);
  });

  it("closes a position off-chain when its stop-loss is crossed", async () => {
    const cfg = parseConfig({
      network: "testnet",
      strategies: [{ id: "d", type: "dca", asset: "XLM", side: "long", leverage: 2, margin: 10, stopLossPct: 5, takeProfitPct: 50, intervalSec: 1_000_000, maxOrders: 1 }],
      risk: { maxLeverage: 5, maxOpenPositions: 3, maxDailyLossPct: 50 },
      keeper: { enabled: false, intervalSec: 30 },
    });
    const vault = new PaperVault({ liquidity: 1000 });
    vault.deposit("me", 100);
    const engine = new BotEngine(cfg, vault, "me", 100);
    vault.setPrice("XLM", 1);
    await engine.tick("XLM", { time: 0, price: 1 });
    expect(await vault.positions("me")).toHaveLength(1);
    vault.setPrice("XLM", 0.94);
    await engine.tick("XLM", { time: 60, price: 0.94 });
    expect(await vault.positions("me")).toHaveLength(0);
    expect(engine.events.some((e) => e.type === "close" && e.detail.includes("stop_loss"))).toBe(true);
    expect(engine.realizedPnl).toBeCloseTo(-10 * 2 * 0.06);
  });
});
