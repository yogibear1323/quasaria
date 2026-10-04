import { describe, expect, it } from "vitest";
import { decideXlmPush, filterFreshPrices, type UsdPrice } from "../src/lending/prices.js";

describe("oracle feed stale/deviation guard", () => {
  it("never pushes the cached snapshot as fresh", () => {
    expect(decideXlmPush({ usd: 0.22, source: "snapshot", reference: 0.22, lastPushed: null, pendingJump: null }).push).toBe(false);
    expect(decideXlmPush({ usd: null, source: "none", reference: 0.22, lastPushed: null, pendingJump: null }).push).toBe(false);
    const p: UsdPrice[] = [{ id: "XLM", sac: "C1", usd: 0.2, source: "xlm/usdc" }, { id: "AQUA", sac: "C2", usd: 0.001, source: "snapshot" }];
    expect(filterFreshPrices(p, "snapshot").fresh).toHaveLength(0);
    const r = filterFreshPrices(p, "mainnet USDC sdex");
    expect(r.fresh.map((x) => x.id)).toEqual(["XLM"]);
    expect(r.skipped).toEqual(["AQUA"]);
  });
  it("skips a price that deviates from the independent reference", () => {
    expect(decideXlmPush({ usd: 0.23, source: "mainnet USDC sdex-mid", reference: 0.22, lastPushed: 0.22, pendingJump: null }).push).toBe(false);
    expect(decideXlmPush({ usd: 0.2205, source: "mainnet USDC sdex-mid", reference: 0.22, lastPushed: 0.22, pendingJump: null }).push).toBe(true);
    expect(decideXlmPush({ usd: 0.2205, source: "mainnet USDC sdex-mid", reference: null, lastPushed: 0.22, pendingJump: null }).push).toBe(true);
  });
  it("holds a large jump until a second read confirms it", () => {
    const a = decideXlmPush({ usd: 0.25, source: "mainnet USDC sdex-mid", reference: null, lastPushed: 0.22, pendingJump: null });
    expect(a.push).toBe(false);
    const b = decideXlmPush({ usd: 0.2501, source: "mainnet USDC sdex-mid", reference: null, lastPushed: 0.22, pendingJump: a.pendingJump ?? null });
    expect(b.push).toBe(true);
  });
});
