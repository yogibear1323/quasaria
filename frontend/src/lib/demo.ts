/**
 * Deterministic demo data so every page renders without a wallet, without
 * deployed contracts, and even fully offline (VITE_OFFLINE_DEMO=1).
 */
export type Level = { price: number; amount: number };
export type Book = { bids: Level[]; asks: Level[]; source: "horizon" | "demo" };

function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

export function demoBook(mid = 0.1234, seed = 7): Book {
  const r = rng(seed);
  const bids: Level[] = [], asks: Level[] = [];
  for (let i = 0; i < 12; i++) {
    bids.push({ price: +(mid * (1 - 0.0015 * (i + 1) - r() * 0.0006)).toFixed(5), amount: Math.round(800 + r() * 9000 * (1 + i / 4)) });
    asks.push({ price: +(mid * (1 + 0.0015 * (i + 1) + r() * 0.0006)).toFixed(5), amount: Math.round(800 + r() * 9000 * (1 + i / 4)) });
  }
  return { bids, asks, source: "demo" };
}

export function demoCandles(n = 90, start = 0.118, seed = 3) {
  const r = rng(seed);
  const out: { t: number; o: number; h: number; l: number; c: number }[] = [];
  let p = start;
  for (let i = 0; i < n; i++) {
    const o = p;
    const c = Math.max(0.05, o * (1 + (r() - 0.47) * 0.03));
    out.push({ t: i, o, c, h: Math.max(o, c) * (1 + r() * 0.01), l: Math.min(o, c) * (1 - r() * 0.01) });
    p = c;
  }
  return out;
}

export const DEMO_POOLS = [
  { id: "demo-xlm-qusd", a: "XLM", b: "QUSD", reserveA: 4_250_000, reserveB: 524_400, feeBps: 30, totalShares: 1_492_000, volume24h: 312_000, myShares: 0 },
  { id: "demo-qfx-qusd", a: "QFX", b: "QUSD", reserveA: 910_000, reserveB: 455_000, feeBps: 30, totalShares: 643_000, volume24h: 98_500, myShares: 0 },
  { id: "demo-qfx-xlm", a: "QFX", b: "XLM", reserveA: 380_000, reserveB: 1_540_000, feeBps: 30, totalShares: 765_000, volume24h: 41_200, myShares: 0 },
];

export const DEMO_STAKING = [
  { id: 0, stake: "QFX", reward: "QFX", ratePerSec: 0.0075, lockDays: 7, totalStaked: 1_240_000, reserve: 380_000, active: true, minStake: 1 },
  { id: 1, stake: "QLP XLM/QUSD", reward: "QFX", ratePerSec: 0.0068, lockDays: 0, totalStaked: 612_000, reserve: 910_000, active: true, minStake: 1 },
  { id: 2, stake: "XLM", reward: "QFX", ratePerSec: 0.0093, lockDays: 30, totalStaked: 3_900_000, reserve: 150_000, active: true, minStake: 1 },
];

/** Offline demo numbers for the QFX page (1 QFX = 1 XLM; reserve == supply). */
export const DEMO_QFX = {
  aprBps: 1200,
  apyBps: 1274,
  maxAprBps: 2500,
  genesis: Date.UTC(2026, 8, 1) / 1000,
  nextAccrualAt: Date.UTC(2026, 8, 2) / 1000,
  maxEligible: 1_000_000,
  effectiveAprBps: 1200,
  xlmReserve: 8_500,
  totalSupply: 8_500,
  surplus: 0,
  fullyBacked: true,
  rewardReserve: 2_500,
  circulating: 6_000,
  rewardPool: 2_500,
  eligibleSupply: 300,
  dailyEmission: 0.0986,
  pending: 0,
  demoBalance: 300,
};

export const DEMO_REFERRAL = {
  count: 14,
  shareBps: 2000,
  earned: [
    { token: "XLM", amount: 812.44 },
    { token: "QUSD", amount: 96.1 },
    { token: "QFX", amount: 1204.9 },
  ],
  recent: [
    { who: "GCQZ…7KDA", when: "2h ago", volume: 18_200 },
    { who: "GBN3…PLQ2", when: "5h ago", volume: 7_450 },
    { who: "GD4X…M2ZW", when: "1d ago", volume: 52_100 },
    { who: "GAYT…9HHC", when: "3d ago", volume: 2_300 },
  ],
};

export const DEMO_POSITIONS = [
  { id: 17, asset: "XLM", isLong: true, margin: 250, leverage: 5, entry: 0.1211, mark: 0.1234, sl: 0.115, tp: 0.135 },
  { id: 18, asset: "XLM", isLong: false, margin: 120, leverage: 3, entry: 0.1262, mark: 0.1234, sl: 0.131, tp: 0.118 },
];
