import { describe, expect, it } from "vitest";
import { Asset, Keypair } from "@stellar/stellar-sdk";
import { MAINNET_SIGNING, XLM, assertSignable, curatedList, curatedPairs, fix7, orderAssets, poolIdFor, previewDeposit, previewWithdraw, verifyAsset, depositReserveCost, parseLookup, type PoolRow } from "../src/lib/nativePools";
import { minReceived } from "../src/lib/swap";
import { TESTNET_USDC_ISSUER } from "../src/lib/config";

const USDC = { code: "USDC", issuer: TESTNET_USDC_ISSUER };
const pool = (over: Partial<PoolRow> = {}): PoolRow => ({ id: "x", net: "testnet", feeBp: 30, totalShares: 1000, holders: 3, a: XLM, b: USDC, reserveA: 1000, reserveB: 500, ...over });

describe("native pools: maths", () => {
  it("deposit preview follows the pool ratio and bounds price by the slippage", () => {
    const pv = previewDeposit({ pool: pool(), driver: "A", amount: 100, slippageBps: 100 })!;
    expect(pv.amountA).toBe(100);
    expect(pv.amountB).toBeCloseTo(50, 9);
    expect(pv.shares).toBeCloseTo(100, 9); // 10% of reserves -> 10% of 1000 shares
    expect(pv.price).toBe(2);
    expect(pv.minPrice).toBeCloseTo(2 * 0.99, 9);
    expect(pv.maxPrice).toBeCloseTo(2 * 1.01, 9);
    expect(pv.poolShareAfter).toBeCloseTo(100 / 1100, 9);
  });
  it("driving by the B side gives the same pool ratio", () => {
    const pv = previewDeposit({ pool: pool(), driver: "B", amount: 50, slippageBps: 50 })!;
    expect(pv.amountA).toBeCloseTo(100, 9);
  });
  it("a new pool takes both amounts, sets the price and mints sqrt(a*b)", () => {
    const pv = previewDeposit({ pool: null, driver: "A", amount: 400, otherAmount: 100, slippageBps: 100 })!;
    expect(pv.newPool).toBe(true);
    expect(pv.shares).toBeCloseTo(200, 9);
    expect(pv.price).toBe(4);
    expect(previewDeposit({ pool: null, driver: "A", amount: 400, slippageBps: 100 })).toBeNull();
  });
  it("clamps slippage to 0.01%..50% and rejects empty input", () => {
    expect(previewDeposit({ pool: pool(), driver: "A", amount: 100, slippageBps: 0 })!.minPrice).toBeCloseTo(2 * 0.9999, 9);
    expect(previewDeposit({ pool: pool(), driver: "A", amount: 100, slippageBps: 99999 })!.minPrice).toBeCloseTo(1, 9);
    expect(previewDeposit({ pool: pool(), driver: "A", amount: 0, slippageBps: 100 })).toBeNull();
  });
  it("withdraw preview returns the pro-rata share with a minimum", () => {
    const w = previewWithdraw(pool(), 100, 100)!;
    expect(w.amountA).toBeCloseTo(100, 9);
    expect(w.amountB).toBeCloseTo(50, 9);
    expect(w.minAmountA).toBeCloseTo(99, 9);
    expect(previewWithdraw(pool(), 0, 100)).toBeNull();
  });
  it("reserve cost: 0.5 per trustline, pool-share trustline counts double", () => {
    expect(depositReserveCost({ needTrustA: true, needTrustB: false, needShareTrust: true }).total).toBe(1.5);
    expect(depositReserveCost({ needTrustA: false, needTrustB: false, needShareTrust: false }).total).toBe(0);
  });
  it("7-decimal formatting never rounds up", () => {
    expect(fix7(1.23456789)).toBe("1.2345678");
    expect(minReceived(100, 0.5)).toBe(99.5);
    expect(minReceived(1, 0)).toBe(0.9999); // floored at the 0.01% minimum limit
    expect(minReceived(1, 500)).toBe(0.5); // clamped at 50%
  });
});

describe("native pools: ids, assets and verification", () => {
  it("pool id is order-independent and 64 hex chars", () => {
    expect(poolIdFor(XLM, USDC)).toBe(poolIdFor(USDC, XLM));
    expect(poolIdFor(XLM, USDC)).toMatch(/^[0-9a-f]{64}$/);
    expect(orderAssets(USDC, XLM)[0]).toEqual(XLM);
    expect(new Asset("USDC", USDC.issuer).getIssuer()).toBe(TESTNET_USDC_ISSUER);
  });
  it("verification is by issuer: same ticker, other issuer = look-alike", () => {
    expect(verifyAsset("testnet", USDC).status).toBe("verified");
    const fake = { code: "USDC", issuer: Keypair.random().publicKey() };
    expect(verifyAsset("testnet", fake).status).toBe("lookalike");
    expect(verifyAsset("testnet", { code: "ZZZ", issuer: Keypair.random().publicKey() }).status).toBe("unverified");
    expect(verifyAsset("testnet", XLM).status).toBe("native");
  });
  it("curated pairs pair XLM with every curated asset", () => {
    const pairs = curatedPairs("testnet");
    const n = curatedList("testnet").filter((c) => c.issuer).length;
    expect(pairs.length).toBeGreaterThanOrEqual(n);
    expect(new Set(pairs.map(([a, b]) => `${a.code}${a.issuer}|${b.code}${b.issuer}`)).size).toBe(pairs.length);
  });
  it("mainnet curated list matches by issuer and has the Circle USDC", () => {
    const m = curatedList("mainnet");
    expect(m.find((c) => c.code === "USDC")?.issuer).toBe("GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN");
    expect(m.filter((c) => c.code === "USDC")).toHaveLength(1);
  });
});

describe("mainnet stays read-only", () => {
  it("signing flag is off and the builders refuse mainnet", () => {
    expect(MAINNET_SIGNING).toBe(false);
    expect(() => assertSignable("mainnet")).toThrow(/Mainnet signing is off/);
    expect(() => assertSignable("testnet")).not.toThrow();
  });
});

describe("native pools: any-asset lookup", () => {
  const G = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
  it("parses exact asset, pool id and native; leaves loose text as a filter", () => {
    expect(parseLookup(`USDC-${G}`)).toEqual({ kind: "asset", asset: { code: "USDC", issuer: G } });
    expect(parseLookup(` USDC:${G} `)).toEqual({ kind: "asset", asset: { code: "USDC", issuer: G } });
    expect(parseLookup("xlm")).toEqual({ kind: "asset", asset: { code: "XLM", issuer: null } });
    expect(parseLookup("a".repeat(64))).toEqual({ kind: "pool", id: "a".repeat(64) });
    expect(parseLookup("USDC")).toBeNull(); // never match on ticker alone
    expect(parseLookup(`USDC-${G.slice(0, 20)}`)).toBeNull();
  });
});
