import { describe, expect, it, afterEach } from "vitest";
import { existsSync, readFileSync, statSync } from "node:fs";
import { PAYOUT_UTC, REWARD_ASSET_CODE, REWARD_DISCLOSURE, REWARD_TIERS, TOKENOMICS, dailyReward, isRewardAsset, reserveYears, reserveYearsAtCap, tierFor } from "../src/lib/rewards";
import { _setHoldersFetch, nextPayout, rewardsLive, utcDay } from "../src/lib/holders";

describe("GLACIERQ rewards config", () => {
  it("uses the confirmed tokenomics and the exact asset code", () => {
    expect(REWARD_ASSET_CODE).toBe("GLACIERQ");
    expect(TOKENOMICS.status).toBe("CONFIRMED");
    expect(TOKENOMICS.totalSupply).toBe(100_000_000_000);
    expect(TOKENOMICS.rewardReserve).toBe(50_000_000_000);
    expect(TOKENOMICS.treasury).toBe(50_000_000_000);
    expect(TOKENOMICS.dailyCap).toBe(10_000_000);
  });
  it("tiers: none under 1M, 5% from 1M, 7% from 10M, flat on the whole balance", () => {
    expect(tierFor(999_999)).toBeNull();
    expect(dailyReward(999_999)).toBe(0);
    expect(tierFor(1_000_000)?.apr).toBe(REWARD_TIERS[0].apr);
    expect(dailyReward(1_000_000)).toBeCloseTo((1_000_000 * 0.05) / 365, 6);
    expect(dailyReward(9_999_999)).toBeCloseTo((9_999_999 * 0.05) / 365, 4);
    expect(tierFor(10_000_000)?.apr).toBe(0.07);
    expect(dailyReward(10_000_000)).toBeCloseTo((10_000_000 * 0.07) / 365, 6);
    expect(0.05 / 365 * 100).toBeCloseTo(0.0137, 4);
    expect(0.07 / 365 * 100).toBeCloseTo(0.01918, 4);
  });
  it("runway math matches the docs", () => {
    expect(reserveYearsAtCap()).toBeCloseTo(13.7, 1);
    expect(reserveYears(10_000_000_000, 0.07)).toBeGreaterThan(70);
  });
  it("disclosure says finite reserve, dilution, not guaranteed; never APY or guaranteed returns", () => {
    expect(REWARD_DISCLOSURE).toMatch(/finite reserve/);
    expect(REWARD_DISCLOSURE).toMatch(/dilute/);
    expect(REWARD_DISCLOSURE).toMatch(/not guaranteed/);
    expect(REWARD_DISCLOSURE).not.toMatch(/APY/);
  });
  it("icon assets exist, match on issuer, and are square", () => {
    for (const f of ["glacierq-128.png", "glacierq-512.png", "glacierq-quasaria-128.png", "glacierq-quasaria-512.png"]) {
      const p = new URL(`../public/tokens/${f}`, import.meta.url);
      expect(existsSync(p)).toBe(true);
      expect(statSync(p).size).toBeGreaterThan(1000);
    }
    const b = readFileSync(new URL("../public/tokens/glacierq-quasaria-512.png", import.meta.url));
    expect(b.readUInt32BE(16)).toBe(512); expect(b.readUInt32BE(20)).toBe(512);
    expect(isRewardAsset("GLACIERQ", "GAAAA")).toBe(false); // look-alike issuer
    expect(isRewardAsset("GLACIERQ", null)).toBe(false);
  });
});

describe("holders reads", () => {
  afterEach(() => _setHoldersFetch(null));
  it("payout time and day helpers are UTC", () => {
    const now = Date.UTC(2026, 9, 18, 12, 0);
    expect(nextPayout(now).toISOString()).toBe(`2026-10-19T0${PAYOUT_UTC.hour}:${PAYOUT_UTC.minute}:00.000Z`);
    expect(nextPayout(Date.UTC(2026, 9, 18, 0, 10)).toISOString()).toBe("2026-10-18T00:30:00.000Z");
    expect(utcDay(now)).toBe("2026-10-18");
  });
  it("is 'not live' while no issuer/reserve is configured", () => {
    _setHoldersFetch((() => { throw new Error("no network expected"); }) as never);
    expect(rewardsLive("mainnet").live).toBe(false);
  });
});
