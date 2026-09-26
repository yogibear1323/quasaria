import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { ConfigError, parseConfig } from "../src/config.js";

const example = JSON.parse(readFileSync(new URL("../quasaria-bot.config.example.json", import.meta.url), "utf8"));

describe("parseConfig", () => {
  it("accepts the example config", () => {
    const c = parseConfig(example);
    expect(c.strategies.map((s) => s.type)).toEqual(["grid", "dca", "momentum"]);
    expect(c.risk.maxLeverage).toBe(10);
  });
  it("rejects non-testnet networks", () => {
    expect(() => parseConfig({ ...example, network: "mainnet" })).toThrow(ConfigError);
  });
  it("caps leverage by risk.maxLeverage and the 20x hard cap", () => {
    const bad = structuredClone(example);
    bad.strategies[0].leverage = 11;
    expect(() => parseConfig(bad)).toThrow(/leverage/);
    expect(() => parseConfig({ ...example, risk: { ...example.risk, maxLeverage: 21 } })).toThrow(/maxLeverage/);
  });
  it("validates grid bounds and momentum periods", () => {
    const g = structuredClone(example);
    g.strategies[0].upper = 0.05;
    expect(() => parseConfig(g)).toThrow();
    const m = structuredClone(example);
    m.strategies[2].slowPeriod = 5;
    expect(() => parseConfig(m)).toThrow(/slowPeriod/);
  });
  it("accepts a config exported by the UI", () => {
    const ui = {
      network: "testnet",
      strategies: [{ id: "dca-xlm", type: "dca", asset: "XLM", side: "short", leverage: 3, margin: 100, stopLossPct: 8, takeProfitPct: 15, intervalSec: 86400, maxOrders: 10 }],
      risk: { maxLeverage: 10, maxOpenPositions: 5, maxDailyLossPct: 10 },
      keeper: { enabled: true, intervalSec: 30 },
    };
    expect(parseConfig(ui).strategies[0].side).toBe("short");
  });
});
