/**
 * Pure math behind the Earn calculators (staking, QFX holder yield, LP fees,
 * impermanent loss). No I/O, no React: every function here is unit-tested in
 * test/calc.test.ts against the textbook formulas.
 *
 * These are ESTIMATES for display only. The contracts are the source of truth.
 */

export const DAY_S = 86_400;
export const YEAR_S = 365 * DAY_S; // 31_536_000, the contracts' year
const BPS = 10_000;

const pos = (n: number) => (Number.isFinite(n) && n > 0 ? n : 0);

// ============================================================ staking (contracts/staking)
/**
 * The staking contract streams `ratePerSec` reward tokens per second to the
 * whole pool, split pro-rata by stake (MasterChef accumulator), and only
 * while the pool's pre-funded `reserve` lasts. Rewards are not auto-restaked.
 */
export type StakingInput = {
  /** Amount you add, in stake-token units. */
  amount: number;
  /** Pool-wide emission, reward tokens per second. */
  ratePerSec: number;
  /** Already staked by others, in stake-token units. */
  totalStaked: number;
  /** Remaining funded reward reserve, reward-token units. */
  reserve: number;
  days: number;
  lockDays?: number;
  /** Value of 1 stake token measured in reward tokens (1 when both are QFX). */
  stakeValueInReward?: number;
};

export type StakingResult = {
  /** Your fraction of the pool after staking (0..1). */
  share: number;
  /** Reward tokens per day for you while the reserve lasts. */
  dailyReward: number;
  /** Value APR (fraction): yearly rewards / staked value, uncapped. */
  apr: number;
  /** Rewards over `days` if the reserve were unlimited. */
  uncapped: number;
  /** Rewards over `days` after the reserve cap (what the contract can pay). */
  rewards: number;
  /** Days until the pool's reserve is empty at the current rate (Infinity if never). */
  runwayDays: number;
  /** The reserve runs out before `days` (emission stops on day runwayDays). */
  reserveDepletes: boolean;
  /** Your projected (uncapped) payout alone exceeds the remaining reserve. */
  payoutExceedsReserve: boolean;
  /** Duration is shorter than the lock: you cannot unstake at the end. */
  lockedAtEnd: boolean;
};

export const stakeShare = (amount: number, totalStaked: number) => {
  const a = pos(amount), t = pos(totalStaked);
  return a + t > 0 ? a / (a + t) : 0;
};

/** Days of emission left in a staking pool's reserve at `ratePerSec`. */
export const stakingRunwayDays = (reserve: number, ratePerSec: number) => (pos(ratePerSec) > 0 ? pos(reserve) / (ratePerSec * DAY_S) : Infinity);

/** Value APR as a fraction; `amount` is included in the pool (your stake dilutes the rate). */
export function stakingApr(ratePerSec: number, totalStaked: number, amount = 0, stakeValueInReward = 1) {
  const staked = (pos(totalStaked) + pos(amount)) * pos(stakeValueInReward);
  return staked > 0 ? (pos(ratePerSec) * YEAR_S) / staked : 0;
}

/** Your cumulative rewards after `day` days (reserve-capped), for charts. */
export function stakingRewardsAt(i: StakingInput, day: number) {
  const share = stakeShare(i.amount, i.totalStaked);
  const runway = stakingRunwayDays(i.reserve, i.ratePerSec);
  return share * pos(i.ratePerSec) * DAY_S * Math.min(pos(day), runway);
}

export function projectStaking(i: StakingInput): StakingResult {
  const share = stakeShare(i.amount, i.totalStaked);
  const dailyReward = share * pos(i.ratePerSec) * DAY_S;
  const days = pos(i.days);
  const runwayDays = stakingRunwayDays(i.reserve, i.ratePerSec);
  const uncapped = dailyReward * days;
  const rewards = stakingRewardsAt(i, days);
  return {
    share,
    dailyReward,
    apr: stakingApr(i.ratePerSec, i.totalStaked, i.amount, i.stakeValueInReward ?? 1),
    uncapped,
    rewards,
    runwayDays,
    reserveDepletes: runwayDays < days,
    payoutExceedsReserve: uncapped > pos(i.reserve),
    lockedAtEnd: pos(i.lockDays ?? 0) > days,
  };
}

// ============================================================ QFX holder yield (contracts/reward-token)
/**
 * Yield accrues continuously (per second, time-weighted) at apr/365 per day on
 * the balance actually held. It is only credited to the balance (and so only
 * compounds) when the balance changes or someone calls `settle`. Without that
 * it is simple interest.
 */
export type CompoundMode = "simple" | "daily" | "weekly";

export const dailyRate = (aprBps: number) => pos(aprBps) / BPS / 365;

/**
 * Growth per 1 unit of principal after `days` (e.g. 0.12 = +12%). Simple mode
 * accrues fractional days (the contract accrues per second); compounding modes
 * credit whole settle periods and accrue the remainder simply.
 */
export function yieldGrowth(aprBps: number, days: number, mode: CompoundMode = "simple") {
  const r = dailyRate(aprBps);
  const t = pos(days);
  if (mode === "daily") { const d = Math.floor(t); return (1 + r) ** d * (1 + r * (t - d)) - 1; }
  if (mode === "weekly") { const w = Math.floor(t / 7); return (1 + 7 * r) ** w * (1 + r * (t - 7 * w)) - 1; }
  return r * t;
}

/** Effective annual yield (fraction) for a mode over 365 days. */
export const effectiveApy = (aprBps: number, mode: CompoundMode) => yieldGrowth(aprBps, 365, mode);

/**
 * Days until a holder-yield reserve `reserve` is exhausted when `supply` QFX is
 * earning at `aprBps` (Infinity when nothing is emitted). Assumes the whole
 * earning supply follows the same settle cadence (`mode`).
 */
export function reserveRunwayDays(reserve: number, supply: number, aprBps: number, mode: CompoundMode = "simple") {
  const R = pos(reserve), E = pos(supply), r = dailyRate(aprBps);
  if (E === 0 || r === 0) return Infinity;
  if (R === 0) return 0;
  if (mode === "daily") return Math.log(1 + R / E) / Math.log(1 + r);
  if (mode === "weekly") {
    const w = 1 + 7 * r;
    const K = Math.floor(Math.log(1 + R / E) / Math.log(w) + 1e-12);
    const grown = w ** K;
    const left = R - E * (grown - 1);
    return 7 * K + Math.max(0, left) / (E * grown * r);
  }
  return R / (E * r);
}

export type HolderInput = {
  amount: number;
  aprBps: number;
  days: number;
  mode: CompoundMode;
  /** Unallocated holder-yield reserve (QFX). */
  reserve: number;
  /** QFX already earning (eligible supply), excluding `amount`. */
  eligibleSupply: number;
};

export type HolderResult = {
  /** Yield if the reserve never ran out. */
  uncapped: number;
  /** Yield after the reserve cap. */
  yield: number;
  total: number;
  /** Reserve runway with `amount` added to the earning supply. */
  runwayDays: number;
  capped: boolean;
  /** The part of the reserve that is proportionally "yours" (amount / earning supply). */
  reserveShare: number;
};

/** Your yield after `day` days, capped at your pro-rata share of the reserve. */
export function holderYieldAt(i: HolderInput, day: number) {
  const a = pos(i.amount);
  const share = a + pos(i.eligibleSupply) > 0 ? a / (a + pos(i.eligibleSupply)) : 0;
  return Math.min(a * yieldGrowth(i.aprBps, day, i.mode), share * pos(i.reserve));
}

export function projectHolderYield(i: HolderInput): HolderResult {
  const a = pos(i.amount);
  const uncapped = a * yieldGrowth(i.aprBps, i.days, i.mode);
  const y = holderYieldAt(i, i.days);
  const earning = a + pos(i.eligibleSupply);
  return {
    uncapped,
    yield: y,
    total: a + y,
    runwayDays: reserveRunwayDays(i.reserve, earning, i.aprBps, i.mode),
    capped: y < uncapped - 1e-12,
    reserveShare: earning > 0 ? (a / earning) * pos(i.reserve) : 0,
  };
}

// ============================================================ AMM LP (contracts/amm-pool)
/**
 * x·y=k pool. The swap fee (`feeBps` of the input) stays in the reserves, so
 * it accrues to LPs pro-rata, except the referral cut (`referralShareBps` of
 * the fee) when the trader has a referrer.
 */

/** Your fraction of the pool after depositing `depositA` of token A (B matched to the ratio). */
export const lpShare = (depositA: number, reserveA: number) => {
  const d = pos(depositA), r = pos(reserveA);
  return d + r > 0 ? d / (d + r) : 0;
};

/** LP shares minted for a ratio-matched deposit (existing pool). */
export const lpSharesMinted = (depositA: number, reserveA: number, totalShares: number) => (pos(reserveA) > 0 ? (pos(depositA) / reserveA) * pos(totalShares) : 0);

/** Fraction of each swap fee that stays with LPs. */
export const lpFeeFraction = (referralShareBps: number, referredFraction = 1) =>
  1 - Math.min(1, pos(referredFraction)) * (Math.min(BPS, pos(referralShareBps)) / BPS);

export type LpFeeInput = {
  /** Expected swap volume per day, in the same value unit as the result. */
  dailyVolume: number;
  feeBps: number;
  /** Your pool share (0..1). */
  share: number;
  days: number;
  /** Fraction of fees kept by LPs (see lpFeeFraction). */
  lpFraction?: number;
};

/** Fees earned by you over `days` (volume and share held constant, so linear). */
export const lpFees = (i: LpFeeInput) => (pos(i.dailyVolume) * pos(i.feeBps)) / BPS * (i.lpFraction ?? 1) * pos(i.share) * pos(i.days);

/** Fee APR (fraction) of the pool: yearly LP fees / TVL. */
export const lpFeeApr = (dailyVolume: number, feeBps: number, tvl: number, lpFraction = 1) =>
  pos(tvl) > 0 ? ((pos(dailyVolume) * pos(feeBps)) / BPS * lpFraction * 365) / tvl : 0;

/**
 * Impermanent loss for a price move of token A (in B) by factor `k`
 * (k = 1 + change, e.g. +100% → 2). Returns the LP-vs-hold value change as a
 * fraction (≤ 0): 2·√k / (1 + k) − 1.
 */
export function impermanentLoss(k: number) {
  if (!(k > 0)) return -1;
  return (2 * Math.sqrt(k)) / (1 + k) - 1;
}

export type LpVsHold = {
  /** Price of A in B before / after. */
  p0: number;
  p1: number;
  /** Tokens in the LP position after the move (x·y=k rebalancing, fees excluded). */
  lpA: number;
  lpB: number;
  /** Values in token-B units at the new price. */
  holdValueB: number;
  lpValueB: number;
  /** lpValueB − holdValueB (≤ 0). */
  ilValueB: number;
  ilPct: number;
};

/** Deposit `a` of A and `b` of B (at the pool ratio), then A's price in B moves by factor `k`. */
export function lpVsHold(a: number, b: number, k: number): LpVsHold {
  const A = pos(a), B = pos(b), K = k > 0 ? k : 1e-9;
  const p0 = A > 0 ? B / A : 0;
  const p1 = p0 * K;
  const lpA = A / Math.sqrt(K);
  const lpB = B * Math.sqrt(K);
  const holdValueB = A * p1 + B;
  const lpValueB = lpA * p1 + lpB;
  return { p0, p1, lpA, lpB, holdValueB, lpValueB, ilValueB: lpValueB - holdValueB, ilPct: holdValueB > 0 ? lpValueB / holdValueB - 1 : 0 };
}

/** Days of fee income needed to cover an impermanent loss (Infinity if no fees). */
export const breakEvenDays = (ilValue: number, dailyFees: number) => {
  const loss = Math.abs(Math.min(0, ilValue));
  if (loss === 0) return 0;
  return pos(dailyFees) > 0 ? loss / dailyFees : Infinity;
};

// ============================================================ on-chain activity & valuation helpers
export type SwapEvent = { tokenIn: string; amountIn: number; amountOut: number; fee: number; referralFee: number };
export type PoolSide = { tokenA: string; tokenB: string; reserveA: number; reserveB: number };

/**
 * Sum swap events of one pool, valuing everything on the input side in token-A
 * units at the current spot price (the fee is charged on the input, so
 * fees = volume × feeBps exactly).
 */
export function summarizeSwaps(events: SwapEvent[], pool: PoolSide) {
  const bInA = pool.reserveB > 0 ? pool.reserveA / pool.reserveB : 0;
  let volumeA = 0, feesA = 0, referralA = 0, referredVolumeA = 0;
  for (const e of events) {
    const f = e.tokenIn === pool.tokenA ? 1 : bInA;
    volumeA += e.amountIn * f;
    feesA += e.fee * f;
    referralA += e.referralFee * f;
    if (e.referralFee > 0) referredVolumeA += e.amountIn * f;
  }
  return {
    swaps: events.length,
    volumeA,
    feesA,
    referralA,
    lpFeesA: feesA - referralA,
    /** Share of volume from traders with a referrer (their swaps paid a referral cut). */
    referredFraction: volumeA > 0 ? referredVolumeA / volumeA : 0,
    /** Share of all fees that went to referrers. */
    referralCut: feesA > 0 ? referralA / feesA : 0,
  };
}

/**
 * Value of each token in an anchor unit (e.g. XLM), inferred through pool
 * spot prices from tokens whose value is known (`anchors`, e.g. XLM = 1,
 * QFX = 1 by its 1:1 peg).
 */
export function inferTokenValues(pools: PoolSide[], anchors: Record<string, number>) {
  const v: Record<string, number> = { ...anchors };
  for (let pass = 0; pass < 3; pass++) {
    for (const p of pools) {
      if (!(p.reserveA > 0 && p.reserveB > 0)) continue;
      if (v[p.tokenA] !== undefined && v[p.tokenB] === undefined) v[p.tokenB] = (v[p.tokenA] * p.reserveA) / p.reserveB;
      else if (v[p.tokenB] !== undefined && v[p.tokenA] === undefined) v[p.tokenA] = (v[p.tokenB] * p.reserveB) / p.reserveA;
    }
  }
  return v;
}

/** Value of one LP share given reserve values. */
export const lpShareValue = (reserveA: number, reserveB: number, totalShares: number, valueA: number, valueB: number) =>
  pos(totalShares) > 0 ? (pos(reserveA) * valueA + pos(reserveB) * valueB) / totalShares : 0;

/** Evenly spaced integer days 0..days (at most `n + 1` points, always including the end). */
export function dayGrid(days: number, n = 60) {
  const d = Math.max(1, Math.round(pos(days)));
  const step = Math.max(1, Math.ceil(d / n));
  const out: number[] = [];
  for (let x = 0; x < d; x += step) out.push(x);
  out.push(d);
  return out;
}
