import { describe, expect, it } from "vitest";
import { HF_ONE, allBorrowers, planLiquidation, runLendingKeeperOnce, type LendingVenue, type Position, type ReserveInfo } from "../src/lending/keeper.js";
import { feedAssetsFrom, quoteXlm, toOracleInt, toUsd, type FeedAsset, type Quote } from "../src/lending/prices.js";

const P = 10n ** 14n;
const U = 10_000_000n;
const reserves = new Map<string, ReserveInfo>([
  ["USDC", { asset: "USDC", code: "USDC", price: P, decimals: 7, cash: 1_000n * U, collateralEnabled: true }],
  ["XLM", { asset: "XLM", code: "XLM", price: P / 4n, decimals: 7, cash: 10_000n * U, collateralEnabled: true }],
  ["SHX", { asset: "SHX", code: "SHX", price: P / 200n, decimals: 7, cash: 0n, collateralEnabled: true }],
]);

describe("planLiquidation", () => {
  const pos: Position[] = [
    { asset: "USDC", supplied: 100n * U, borrowed: 0n, collateral: true },
    { asset: "SHX", supplied: 1_000n * U, borrowed: 0n, collateral: true },
    { asset: "XLM", supplied: 0n, borrowed: 400n * U, collateral: false },
  ];
  it("skips healthy accounts", () => {
    expect(planLiquidation("B", { healthFactor: HF_ONE, debtUsd: 0n, collateralUsd: 0n }, pos, reserves, { closeFactorBps: 5000, balances: new Map() })).toBeNull();
  });
  it("targets the biggest debt and collateral, capped at the close factor", () => {
    const p = planLiquidation("B", { healthFactor: 9_000_000n, debtUsd: 0n, collateralUsd: 0n }, pos, reserves, { closeFactorBps: 5000, balances: new Map([["XLM", 10_000n * U]]) })!;
    expect(p.debtAsset).toBe("XLM");
    expect(p.collateralAsset).toBe("USDC");
    expect(p.repay).toBe(200n * U);
    expect(p.receiveShares).toBe(false);
    expect(p.hf).toBeCloseTo(0.9);
  });
  it("limits repay to the liquidator balance and flags zero balance", () => {
    const p = planLiquidation("B", { healthFactor: 1n, debtUsd: 0n, collateralUsd: 0n }, pos, reserves, { closeFactorBps: 5000, balances: new Map([["XLM", 50n * U]]) })!;
    expect(p.repay).toBe(50n * U);
    const z = planLiquidation("B", { healthFactor: 1n, debtUsd: 0n, collateralUsd: 0n }, pos, reserves, { closeFactorBps: 5000, balances: new Map() })!;
    expect(z.repay).toBe(0n);
    expect(z.detail).toMatch(/holds no XLM/);
  });
  it("asks for supply shares when the collateral reserve has no cash", () => {
    const only: Position[] = [
      { asset: "SHX", supplied: 1_000_000n * U, borrowed: 0n, collateral: true },
      { asset: "USDC", supplied: 0n, borrowed: 10n * U, collateral: false },
    ];
    const p = planLiquidation("B", { healthFactor: 1n, debtUsd: 0n, collateralUsd: 0n }, only, reserves, { closeFactorBps: 5000, balances: new Map([["USDC", 100n * U]]) })!;
    expect(p.collateralAsset).toBe("SHX");
    expect(p.receiveShares).toBe(true);
  });
  it("returns null without collateral to seize", () => {
    expect(planLiquidation("B", { healthFactor: 1n, debtUsd: 0n, collateralUsd: 0n }, [pos[2]], reserves, { closeFactorBps: 5000, balances: new Map() })).toBeNull();
  });
});

function fakeVenue(n: number, unhealthy: Set<string>) {
  const calls: string[] = [];
  const users = Array.from({ length: n }, (_, i) => `G${i}`);
  const v: LendingVenue & { calls: string[]; pages: number } = {
    calls,
    pages: 0,
    borrowerCount: async () => users.length,
    borrowersPage: async (s, l) => {
      v.pages++;
      return users.slice(s, s + l);
    },
    account: async (u) => ({ healthFactor: unhealthy.has(u) ? 9_000_000n : 2n * HF_ONE, debtUsd: 0n, collateralUsd: 0n }),
    positions: async () => [
      { asset: "USDC", supplied: 100n * U, borrowed: 0n, collateral: true },
      { asset: "XLM", supplied: 0n, borrowed: 400n * U, collateral: false },
    ],
    reserves: async () => reserves,
    closeFactorBps: async () => 5000,
    balances: async () => new Map([["XLM", 100_000n * U]]),
    liquidate: async (p) => {
      calls.push(p.borrower);
      if (p.borrower === "G7") throw new Error("Healthy");
      return [p.repay, 50n * U];
    },
  };
  return v;
}

describe("runLendingKeeperOnce", () => {
  it("pages through the borrower index", async () => {
    const v = fakeVenue(250, new Set());
    expect((await allBorrowers(v)).length).toBe(250);
    expect(v.pages).toBe(3);
  });
  it("liquidates only unhealthy accounts and survives failures", async () => {
    const v = fakeVenue(10, new Set(["G2", "G7"]));
    const r = await runLendingKeeperOnce(v, { dryRun: false, log: () => void 0 });
    expect(v.calls).toEqual(["G2", "G7"]);
    expect(r.filter((x) => x.ok).length).toBe(1);
    expect(r.find((x) => x.plan.borrower === "G7")!.error).toMatch(/Healthy/);
  });
  it("dry-run never sends", async () => {
    const v = fakeVenue(10, new Set(["G2"]));
    const r = await runLendingKeeperOnce(v, { dryRun: true, log: () => void 0 });
    expect(v.calls).toEqual([]);
    expect(r[0].executed).toBe(false);
  });
});

describe("oracle prices", () => {
  const A = (id: string, extra: Partial<FeedAsset> = {}): FeedAsset => ({ id, category: "stablecoin", peg: "USD", offPeg: false, mainnet: { code: id, issuer: "GISSUER" }, sac: `C${id}`, snapshotPerXlm: 0.25, ...extra });
  it("prices strong quotes at market (off-peg stays off-peg), weak stables via FX, rest via snapshot", () => {
    const quotes = new Map<string, Quote>([
      ["USDC", { perXlm: 0.25, source: "sdex-mid" }],
      ["USD", { perXlm: 0.8, source: "last-1h-candle(7d)" }],
      ["EURCV", { perXlm: 0.2, source: "sdex-one-side" }],
      ["SHX", { perXlm: 50, source: "native-lp" }],
      ["NONE", { perXlm: null, source: "none" }],
    ]);
    const out = toUsd(
      [A("XLM", { mainnet: null }), A("USDC"), A("USD", { offPeg: true }), A("EURCV", { peg: "EUR" }), A("SHX", { category: "popular", peg: null }), A("NONE", { category: "popular", peg: null, snapshotPerXlm: 5 })],
      quotes, 0.25, { EUR: 0.8 },
    );
    const m = Object.fromEntries(out.map((p) => [p.id, p]));
    expect(m.XLM.usd).toBe(0.25);
    expect(m.USDC.usd).toBeCloseTo(1);
    expect(m.USD.usd).toBeCloseTo(0.3125);
    expect(m.USD.source).toMatch(/off-peg/);
    expect(m.EURCV.usd).toBeCloseTo(1.25);
    expect(m.EURCV.source).toBe("fx-reference:EUR");
    expect(m.SHX.usd).toBeCloseTo(0.005);
    expect(m.NONE.source).toBe("snapshot");
    expect(m.NONE.usd).toBeCloseTo(0.05);
  });
  it("converts to 14-decimal oracle integers", () => {
    expect(toOracleInt(1)).toBe(10n ** 14n);
    expect(toOracleInt(0.2270943)).toBe(22_709_430_000_000n);
    expect(toOracleInt(0.0000498562)).toBe(4_985_620_000n);
    expect(toOracleInt(84516)).toBe(84516n * 10n ** 14n);
    expect(() => toOracleInt(0)).toThrow();
    expect(() => toOracleInt(Number.NaN)).toThrow();
  });
  it("quoteXlm prefers a tight book, then the AMM, then candles", async () => {
    const tight = await quoteXlm("SHX", "G", async (u) => (u.includes("order_book") ? { bids: [{ price: "49" }], asks: [{ price: "51" }] } : null));
    expect(tight).toEqual({ perXlm: 50, source: "sdex-mid" });
    const lp = await quoteXlm("SHX", "G", async (u) =>
      u.includes("order_book") ? { bids: [{ price: "10" }], asks: [{ price: "90" }] } : u.includes("liquidity_pools") ? { _embedded: { records: [{ total_shares: "5", reserves: [{ asset: "native", amount: "2000" }, { asset: "SHX:G", amount: "100000" }] }] } } : null,
    );
    expect(lp).toEqual({ perXlm: 50, source: "native-lp" });
    const candle = await quoteXlm("SHX", "G", async (u) => (u.includes("trade_aggregations") ? { _embedded: { records: [{ close: "42" }] } } : null));
    expect(candle).toEqual({ perXlm: 42, source: "last-1h-candle(7d)" });
    expect((await quoteXlm("SHX", "G", async () => null)).source).toBe("none");
  });
  it("loads the 42 feed assets (QUSD excluded)", async () => {
    const { readFileSync } = await import("node:fs");
    const doc = JSON.parse(readFileSync(new URL("../../deployments/testnet-assets.json", import.meta.url), "utf8"));
    const f = feedAssetsFrom(doc);
    expect(f.length).toBe(42);
    expect(f.find((a) => a.id === "QUSD")).toBeUndefined();
    expect(f.find((a) => a.id === "XLM")!.mainnet).toBeNull();
  });
});
