import { describe, expect, it } from "vitest";
import {
  DAY_S, YEAR_S, breakEvenDays, dayGrid, effectiveApy, holderYieldAt, impermanentLoss, inferTokenValues, lpFeeApr, lpFeeFraction, lpFees, lpShare,
  lpShareValue, lpSharesMinted, lpVsHold, projectHolderYield, projectStaking, reserveRunwayDays, stakeShare, stakingApr, stakingRewardsAt,
  stakingRunwayDays, summarizeSwaps, yieldGrowth,
} from "../src/lib/calc";

const close = (a: number, b: number, rel = 1e-9) => expect(Math.abs(a - b)).toBeLessThanOrEqual(Math.abs(b) * rel + 1e-12);

describe("staking (pro-rata stream from a funded reserve)", () => {
  // Live-like pool: 0.0001 QFX/s shared by 200 staked; you add 100 → 1/3 of the stream.
  const base = { amount: 100, ratePerSec: 0.0001, totalStaked: 200, reserve: 1_000, days: 30, lockDays: 7 };

  it("share, daily reward and APR follow rate × time × share", () => {
    expect(stakeShare(100, 200)).toBeCloseTo(1 / 3, 12);
    const r = projectStaking(base);
    close(r.dailyReward, (0.0001 * DAY_S) / 3); // 2.88 QFX/day
    close(r.uncapped, 2.88 * 30);
    close(r.rewards, 86.4);
    // APR = rate·year / (total + amount) = 3153.6 / 300
    close(r.apr, (0.0001 * YEAR_S) / 300);
    close(stakingApr(0.0001, 200, 100), 10.512);
    expect(r.reserveDepletes).toBe(false);
    expect(r.payoutExceedsReserve).toBe(false);
    expect(r.lockedAtEnd).toBe(false);
  });

  it("values the stake in reward units for a different stake token", () => {
    // 1 stake token worth 6 reward tokens → APR divided by 6.
    close(stakingApr(0.0002, 100, 0, 6), (0.0002 * YEAR_S) / 600);
  });

  it("caps rewards at the reserve: emission stops on the runway day", () => {
    const r = projectStaking({ ...base, reserve: 50 });
    close(r.runwayDays, 50 / 8.64);
    expect(r.reserveDepletes).toBe(true);
    close(r.rewards, 50 / 3); // your third of the whole remaining reserve
    close(stakingRewardsAt({ ...base, reserve: 50 }, 365), 50 / 3);
    expect(r.payoutExceedsReserve).toBe(true); // uncapped 86.4 > 50
  });

  it("flags a duration shorter than the lock and handles empty pools", () => {
    expect(projectStaking({ ...base, days: 3 }).lockedAtEnd).toBe(true);
    expect(stakeShare(0, 0)).toBe(0);
    expect(stakingApr(0.0001, 0, 0)).toBe(0);
    expect(stakingRunwayDays(10, 0)).toBe(Infinity);
    expect(stakeShare(100, 0)).toBe(1);
  });
});

describe("QFX holder yield: simple vs compound", () => {
  it("simple interest = P·APR·d/365 (the contract default)", () => {
    close(1000 * yieldGrowth(1200, 365, "simple"), 120);
    close(1000 * yieldGrowth(1200, 30, "simple"), (1000 * 0.12 * 30) / 365);
    // Only whole days accrue
    close(yieldGrowth(1200, 30.9, "simple"), yieldGrowth(1200, 30, "simple"));
  });

  it("daily settle = (1 + APR/365)^d − 1, i.e. 12% APR → 12.7475% APY", () => {
    close(effectiveApy(1200, "daily"), (1 + 0.12 / 365) ** 365 - 1);
    expect(effectiveApy(1200, "daily")).toBeCloseTo(0.127474614, 8);
  });

  it("weekly settle compounds 7-day simple periods", () => {
    const w = 1 + (0.12 * 7) / 365;
    close(yieldGrowth(1200, 364, "weekly"), w ** 52 - 1);
    close(yieldGrowth(1200, 10, "weekly"), w * (1 + (0.12 * 3) / 365) - 1);
    // Within the first week weekly == simple
    close(yieldGrowth(1200, 6, "weekly"), yieldGrowth(1200, 6, "simple"));
    const s = effectiveApy(1200, "simple"), wk = effectiveApy(1200, "weekly"), d = effectiveApy(1200, "daily");
    expect(s).toBeLessThan(wk);
    expect(wk).toBeLessThan(d);
    // Continuous-compounding upper bound e^0.12 − 1
    expect(d).toBeLessThan(Math.exp(0.12) - 1);
  });

  it("zero APR / zero days give zero", () => {
    expect(yieldGrowth(0, 365, "daily")).toBe(0);
    expect(yieldGrowth(1200, 0, "weekly")).toBe(0);
  });
});

describe("reserve runway", () => {
  it("simple: R / (E · APR/365)", () => {
    // Live-like numbers: 2,500 QFX reserve, 300 QFX earning at 12%
    close(reserveRunwayDays(2500, 300, 1200), 2500 / ((300 * 0.12) / 365));
    close(reserveRunwayDays(2500, 300, 1200), 25_347.2222222, 1e-9);
  });

  it("compound runways solve E·growth(d) = R", () => {
    const d = reserveRunwayDays(1000, 10_000, 1200, "daily");
    close(d, Math.log(1 + 0.1) / Math.log(1 + 0.12 / 365));
    close(10_000 * ((1 + 0.12 / 365) ** d - 1), 1000, 1e-9);
    const w = reserveRunwayDays(1000, 10_000, 1200, "weekly");
    // Check by evaluating the weekly growth at the fractional day
    const r = 0.12 / 365, K = Math.floor(w / 7), rem = w - 7 * K;
    close(10_000 * ((1 + 7 * r) ** K * (1 + r * rem) - 1), 1000, 1e-9);
    // Compounding drains the reserve faster
    expect(d).toBeLessThan(w);
    expect(w).toBeLessThan(reserveRunwayDays(1000, 10_000, 1200, "simple"));
  });

  it("edge cases", () => {
    expect(reserveRunwayDays(100, 0, 1200)).toBe(Infinity);
    expect(reserveRunwayDays(100, 100, 0)).toBe(Infinity);
    expect(reserveRunwayDays(0, 100, 1200)).toBe(0);
  });
});

describe("holder projection with the reserve cap", () => {
  const i = { amount: 1000, aprBps: 1200, days: 365, mode: "simple" as const, reserve: 100_000, eligibleSupply: 9_000 };

  it("uncapped when the reserve is ample", () => {
    const r = projectHolderYield(i);
    close(r.yield, 120);
    close(r.total, 1120);
    expect(r.capped).toBe(false);
    close(r.runwayDays, 100_000 / ((10_000 * 0.12) / 365));
  });

  it("stops at the pro-rata share of the reserve when it runs dry", () => {
    const r = projectHolderYield({ ...i, reserve: 500 });
    // 10,000 earning → 500 lasts 152.08 days; your 10% share = 50 QFX
    close(r.runwayDays, 500 / ((10_000 * 0.12) / 365));
    close(r.yield, 50);
    expect(r.capped).toBe(true);
    close(r.reserveShare, 50);
    // Before depletion, still the uncapped simple value
    close(holderYieldAt({ ...i, reserve: 500 }, 100), (1000 * 0.12 * 100) / 365);
  });
});

describe("LP fees and pool share", () => {
  it("share and minted shares", () => {
    close(lpShare(100, 900), 0.1);
    close(lpSharesMinted(100, 900, 450), 50);
    expect(lpShare(0, 0)).toBe(0);
  });

  it("fees = volume × fee × LP cut × share × days", () => {
    close(lpFeeFraction(2000, 1), 0.8);
    close(lpFeeFraction(2000, 0), 1);
    close(lpFeeFraction(2000, 0.5), 0.9);
    close(lpFees({ dailyVolume: 10_000, feeBps: 30, share: 0.1, days: 30, lpFraction: 0.8 }), 72);
    // Pool fee APR: 10,000 × 0.3% × 0.8 × 365 / 100,000 TVL = 8.76%
    close(lpFeeApr(10_000, 30, 100_000, 0.8), 0.0876);
    expect(lpFeeApr(10_000, 30, 0)).toBe(0);
  });
});

describe("impermanent loss (x·y=k)", () => {
  it("matches 2√k/(1+k) − 1 at the textbook points", () => {
    expect(impermanentLoss(1)).toBe(0);
    close(impermanentLoss(1.25), -0.0061920, 1e-4); // +25%: −0.62%
    close(impermanentLoss(1.5), -0.0202041, 1e-5); // +50%: −2.02%
    close(impermanentLoss(2), -0.0571910, 1e-5); // +100%: −5.72%
    close(impermanentLoss(3), -0.1339746, 1e-6); // +200%: −13.40%
    close(impermanentLoss(4), -0.2); // +300%: −20%
    close(impermanentLoss(5), -0.2546440, 1e-6); // +400%: −25.46%
    // Symmetric in log price: ½ behaves like 2, ¼ like 4
    close(impermanentLoss(0.5), impermanentLoss(2));
    close(impermanentLoss(0.25), -0.2);
    expect(impermanentLoss(0)).toBe(-1);
  });

  it("lpVsHold agrees with the closed form and keeps x·y constant", () => {
    const r = lpVsHold(1000, 100, 2); // 1000 A + 100 B, price 0.1 → 0.2
    close(r.p0, 0.1);
    close(r.p1, 0.2);
    close(r.lpA * r.lpB, 1000 * 100);
    close(r.lpB / r.lpA, r.p1); // pool price = new price
    close(r.holdValueB, 300);
    close(r.lpValueB, 200 * Math.SQRT2);
    close(r.ilPct, impermanentLoss(2));
    close(r.ilValueB, 200 * Math.SQRT2 - 300);
    const down = lpVsHold(1000, 100, 0.5);
    close(down.ilPct, impermanentLoss(0.5));
  });

  it("break-even days = loss / daily fees", () => {
    close(breakEvenDays(-10, 2), 5);
    expect(breakEvenDays(0, 2)).toBe(0);
    expect(breakEvenDays(-10, 0)).toBe(Infinity);
  });
});

describe("on-chain activity & valuation helpers", () => {
  const pool = { tokenA: "XLM", tokenB: "QUSD", reserveA: 5000, reserveB: 500 };

  it("summarises swaps on the input side in token-A value", () => {
    const s = summarizeSwaps(
      [
        { tokenIn: "XLM", amountIn: 200, amountOut: 19, fee: 0.6, referralFee: 0.12 },
        { tokenIn: "QUSD", amountIn: 10, amountOut: 99, fee: 0.03, referralFee: 0 },
      ],
      pool,
    );
    expect(s.swaps).toBe(2);
    close(s.volumeA, 200 + 100); // 10 QUSD × 10 XLM/QUSD
    close(s.feesA, 0.6 + 0.3);
    close(s.referralA, 0.12);
    close(s.lpFeesA, 0.78);
    close(s.referralCut, 0.12 / 0.9);
    close(s.referredFraction, 200 / 300); // only the first swap had a referrer
    // LP fraction from observed referred volume reproduces the observed LP fees
    close(lpFeeFraction(2000, 1) * 0.6 + 0.3, s.lpFeesA);
  });

  it("infers token values through pools from anchors", () => {
    const v = inferTokenValues(
      [pool, { tokenA: "QFX", tokenB: "QUSD", reserveA: 2500, reserveB: 250 }, { tokenA: "XLM", tokenB: "USDC", reserveA: 500, reserveB: 110 }],
      { XLM: 1, QFX: 1 },
    );
    close(v.QUSD, 10);
    close(v.USDC, 500 / 110);
    close(lpShareValue(5000, 500, 1000, 1, v.QUSD), 10); // (5000 + 5000) / 1000
  });

  it("dayGrid spans 0..days inclusive", () => {
    const g = dayGrid(365, 60);
    expect(g[0]).toBe(0);
    expect(g[g.length - 1]).toBe(365);
    expect(g.length).toBeLessThanOrEqual(62);
    expect(dayGrid(5, 60)).toEqual([0, 1, 2, 3, 4, 5]);
  });
});
