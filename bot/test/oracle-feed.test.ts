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

import { crossCheck, decideFastPush, fetchXlmSources } from "../src/lending/prices.js";

describe("oracle feed: independent sources + cross-check", () => {
  it("parses Coinbase / Kraken / Bitstamp mids and drops unreachable or wide books", async () => {
    const fake = async (url: string) =>
      url.includes("coinbase") ? { bid: "0.2200", ask: "0.2202" } : url.includes("kraken") ? { error: [], result: { XXLMZUSD: { b: ["0.2199"], a: ["0.2201"] } } } : url.includes("bitstamp") ? { bid: "0.20", ask: "0.24" } : null;
    const q = await fetchXlmSources(fake);
    expect(q.find((x) => x.source === "coinbase")!.usd).toBeCloseTo(0.2201, 6);
    expect(q.find((x) => x.source === "kraken")!.usd).toBeCloseTo(0.22, 6);
    expect(q.find((x) => x.source === "bitstamp")!.usd).toBeNull(); // 18% spread: not a usable quote
    const down = await fetchXlmSources(async () => null);
    expect(down.every((x) => x.usd === null)).toBe(true);
  });
  it("needs two agreeing sources; prices the median of the agreeing ones; flags outliers", () => {
    const ok = crossCheck([{ source: "coinbase", usd: 0.22 }, { source: "kraken", usd: 0.2202 }, { source: "bitstamp", usd: 0.2201 }]);
    expect(ok.ok && ok.usd).toBeCloseTo(0.2201, 8);
    const out = crossCheck([{ source: "coinbase", usd: 0.22 }, { source: "kraken", usd: 0.2201 }, { source: "bitstamp", usd: 0.23 }]);
    expect(out.ok).toBe(true);
    expect(out.outliers[0]).toMatch(/^bitstamp/);
    expect(out.ok && out.used).toEqual(["coinbase", "kraken"]);
    const one = crossCheck([{ source: "coinbase", usd: 0.22 }, { source: "kraken", usd: null }, { source: "bitstamp", usd: null }]);
    expect(one.ok).toBe(false);
    expect(!one.ok && one.reason).toMatch(/only 1 live source/);
    const split = crossCheck([{ source: "coinbase", usd: 0.22 }, { source: "kraken", usd: 0.23 }]);
    expect(split.ok).toBe(false);
    expect(!split.ok && split.reason).toMatch(/disagree/);
  });
});

describe("oracle feed: deviation-triggered pushes with a heartbeat", () => {
  const base = { lastPushed: 0.22, lastPushAt: 1000, now: 1005, pendingJump: null };
  it("pushes immediately on a >= 0.12% move, otherwise every 20 s", () => {
    expect(decideFastPush({ ...base, usd: 0.22 * 1.0013 }).push).toBe(true);
    expect((decideFastPush({ ...base, usd: 0.22 * 0.9987 }) as { why: string }).why).toBe("deviation");
    expect(decideFastPush({ ...base, usd: 0.22 * 1.0005 }).push).toBe(false);
    expect((decideFastPush({ ...base, usd: 0.22 * 1.0005, now: 1020 }) as { why: string }).why).toBe("heartbeat");
    expect((decideFastPush({ ...base, usd: 0.22, lastPushed: null }) as { why: string }).why).toBe("first");
  });
  it("holds a > 5% jump until confirmed", () => {
    const a = decideFastPush({ ...base, usd: 0.24 });
    expect(a.push).toBe(false);
    expect(decideFastPush({ ...base, usd: 0.2401, pendingJump: a.pendingJump }).push).toBe(true);
  });
});
