/**
 * Holder rewards program (GLACIERQ). No smart contract: a daily script makes plain payments from an
 * ordinary reward account, in newly issued GLACIERQ. The asset code is "GLACIERQ" (never plain
 * "GLACIER", which is a different issuer's asset). The issuer is configurable per network.
 * Terms: ~5% a year for balances from 1M to <10M, ~7% a year from 10M; daily rate = APR / 365 on the
 * whole balance. Rewards come from a finite reserve account, are NOT guaranteed, and a daily emission
 * cap can scale them down. Tokenomics below are confirmed.
 */
import testnetCfg from "../config/rewards.testnet.json";

export const REWARD_ASSET_CODE = (import.meta.env.VITE_REWARD_ASSET_CODE as string) || "GLACIERQ";
export const REWARD_TOTAL_SUPPLY = 100_000_000_000; // 100B, fixed: minted once, then the issuer is locked
/** Tokenomics CONFIRMED by Robert (2026-10-18). Values stay configurable. */
export const TOKENOMICS = {
  status: "CONFIRMED" as const,
  totalSupply: REWARD_TOTAL_SUPPLY,
  rewardReserve: 50_000_000_000, // pays the daily rewards (plain payments, nothing is minted per day)
  treasury: 50_000_000_000, // launch, liquidity, holders
  dailyCap: Number(import.meta.env.VITE_REWARD_DAILY_CAP) || 10_000_000, // 0.01% of supply per day; pro-rata scaled if exceeded
} as const;
export const REWARD_TIERS = [
  { name: "Tier 1", min: 1_000_000, max: 10_000_000, apr: 0.05 },
  { name: "Tier 2", min: 10_000_000, max: Infinity, apr: 0.07 },
] as const;
export const REWARD_MIN_BALANCE = REWARD_TIERS[0].min;

/** Years the reserve lasts if emission sits at the daily cap every day. */
export const reserveYearsAtCap = (t: { rewardReserve: number; dailyCap: number } = TOKENOMICS) => t.rewardReserve / (t.dailyCap * 365);
/** Years the reserve lasts for a given total of qualifying balances at a blended APR. */
export const reserveYears = (qualifying: number, blendedApr: number, t: { rewardReserve: number; dailyCap: number } = TOKENOMICS) =>
  t.rewardReserve / Math.min(qualifying * blendedApr, t.dailyCap * 365);

/** Public issuer address per network (null until it exists). Mainnet stays null until go-live. */
export const REWARD_ISSUER: Record<"testnet" | "mainnet", string | null> = {
  testnet: (import.meta.env.VITE_REWARD_ISSUER_TESTNET as string) || testnetCfg.issuer || null,
  mainnet: (import.meta.env.VITE_REWARD_ISSUER_MAINNET as string) || null,
};

/** Public reward-reserve account per network (null until it exists). The daily payer. */
export const REWARD_RESERVE: Record<"testnet" | "mainnet", string | null> = {
  testnet: (import.meta.env.VITE_REWARD_RESERVE_TESTNET as string) || (testnetCfg as { reserve?: string | null }).reserve || null,
  mainnet: (import.meta.env.VITE_REWARD_RESERVE_MAINNET as string) || null,
};
/** Daily payout time (UTC). One payment per holder per UTC day, memo `GLACIERQ:YYYY-MM-DD`. */
export const PAYOUT_UTC = { hour: 0, minute: 30 } as const;
export const memoFor = (day: string) => `${REWARD_ASSET_CODE}:${day}`;

/** GLACIERQ icon (the Quasaria yeti, square crop). Matched on code AND issuer, never ticker alone. */
export const GLACIERQ_ICON_128 = `${import.meta.env.BASE_URL ?? "/"}tokens/glacierq-128.png`;
export const GLACIERQ_ICON_512 = `${import.meta.env.BASE_URL ?? "/"}tokens/glacierq-512.png`;
export const isRewardAsset = (code: string, issuer?: string | null) =>
  code === REWARD_ASSET_CODE && !!issuer && (issuer === REWARD_ISSUER.testnet || issuer === REWARD_ISSUER.mainnet);

export const tierFor = (balance: number) => REWARD_TIERS.find((t) => balance >= t.min && balance < t.max) ?? null;
/** Daily reward in tokens for a balance; 0 below the minimum. */
export const dailyReward = (balance: number) => {
  const t = tierFor(balance);
  return t ? (balance * t.apr) / 365 : 0;
};
export const REWARD_DISCLOSURE =
  "Rewards are paid from a finite reserve account, so they put more GLACIERQ into circulation and dilute holders who do not receive them. They are not guaranteed: the program can change or stop, a payment can be skipped or delayed, and a daily emission cap can reduce everyone's reward pro rata. Rates are annual rates applied daily; they do not compound automatically. Nothing here is financial advice.";

/** Annual rate as a clean percent number (0.07 -> 7, never 7.000000000000001). */
export const pctYear = (apr: number) => Math.round(apr * 10000) / 100;

/**
 * Referral program terms, CONFIRMED by Robert (2026-10-18). Not live: it starts after the first mainnet holder-reward run.
 * Mirrors scripts/rewards/core.mjs. Flip REFERRAL_LIVE only when the payer account and binding reader are running.
 */
export const REFERRAL_LIVE = false;
export const REFERRAL_TERMS = {
  referrerPct: 10, referrerDays: 365, refereePct: 10, refereeDays: 180, refereeMonths: 6,
  perReferralCap: 100_000, perReferrerDay: 25_000, subBudgetDay: 1_000_000,
  refereeMinBalance: 1_000_000, refereeHoldHours: 48, referrerMinBalance: 100_000, referrerMinAgeDays: 14,
  bindWindowDays: 30, payoutLagDays: 7, bindKey: "quasaria:ref",
} as const;
