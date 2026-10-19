import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
const src = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const trade = src("../src/pages/Trade.tsx");
const market = trade.slice(trade.indexOf("function MarketPanel"), trade.indexOf("function OpenOffers"));

describe("Exchange page: limit + market", () => {
  it("has a Limit | Market toggle and keeps the limit panel", () => {
    expect(trade).toContain('label: "Limit"'); expect(trade).toContain('label: "Market"'); expect(trade).toContain("<LimitPanel");
    expect(trade).toContain("buildLimitOrder"); // limit path unchanged
  });
  it("market orders go through a confirm step before anything is signed", () => {
    expect(market).toContain('data-testid="market-confirm"'); expect(market).toContain('data-testid="market-cancel-btn"');
    const tapBody = market.slice(market.indexOf("const tap"), market.indexOf("const confirm"));
    expect(tapBody).not.toContain("w.sign"); expect(tapBody).not.toContain("executeMarket"); // tap only plans and checks funds
    expect(market.slice(market.indexOf("const confirm"))).toContain("executeMarket");
  });
  it("shows no slippage control and never mentions the band before the tap", () => {
    expect(market).not.toMatch(/slippage|range|PROTECTION_BAND|5%/i);
  });
  it("shows the result with a StellarChain link and no invented demo data", () => {
    expect(market).toContain("<TxLink"); expect(market).toContain("res.outcome.text");
    expect(trade).not.toMatch(/demoBook|demoCandles/); expect(trade).toContain("fetchOrderBook(b, q, false)");
  });
  it("the market tx module is fixed-band and cancel-always", () => {
    const m = src("../src/lib/market.ts"); const r = src("../src/lib/marketRun.ts");
    expect(m).toContain("PROTECTION_BAND = 0.05"); expect(r).toContain("buildCancelRemainderTx");
  });
});
