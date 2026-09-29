/**
 * Chain reads for the Earn calculators (read-only simulation / RPC events,
 * no wallet). Falls back to the deterministic demo numbers when the chain is
 * unreachable, so the calculators always produce output.
 */
import { scValToNative, xdr } from "@stellar/stellar-sdk";
import testnetStables from "../config/testnet-stablecoins.json";
import { CONTRACTS, symbolOf } from "./config";
import { readContract, soroban } from "./soroban";
import { readPool, readQfx, readStaking, type PoolInfo, type QfxInfo, type StakePool } from "./chain";
import { fromUnits } from "./format";
import { inferTokenValues, lpShareValue, summarizeSwaps, type SwapEvent } from "./calc";
import { DEMO_POOLS, DEMO_QFX, DEMO_STAKING } from "./demo";

type StableEntry = { code: string; sac?: string; pool?: string; mock: boolean; label: string };
const STABLES: StableEntry[] = (testnetStables as { pools?: StableEntry[] }).pools ?? [];
const STABLE_SYMBOL: Record<string, string> = Object.fromEntries(STABLES.filter((s) => s.sac).map((s) => [s.sac!, s.code]));

export const tokenSymbol = (id: string) => STABLE_SYMBOL[id] ?? symbolOf(id);

/** XLM-denominated anchors: native XLM, and QFX by its 1:1 fully backed peg. */
export const XLM_ANCHORS = (): Record<string, number> => ({ [CONTRACTS.xlmSac]: 1, [CONTRACTS.qfx]: 1 });

export type CalcPool = PoolInfo & { symA: string; symB: string; group: "core" | "stable"; mock?: boolean; demo?: boolean };

export type CalcPools = { pools: CalcPool[]; values: Record<string, number>; demo: boolean };

/** Value (in XLM) of one unit of `token`, including LP share tokens of known pools. */
export function tokenValueXlm(token: string, pools: PoolInfo[], values: Record<string, number>) {
  if (values[token] !== undefined) return values[token];
  const p = pools.find((x) => x.id === token);
  if (p && values[p.tokenA] !== undefined && values[p.tokenB] !== undefined) return lpShareValue(p.reserveA, p.reserveB, p.totalShares, values[p.tokenA], values[p.tokenB]);
  return NaN;
}

// ---------------------------------------------------------------- LP pools
export async function loadCalcPools(): Promise<CalcPools> {
  const core = await Promise.all(CONTRACTS.pools.map(readPool));
  const stableIds = STABLES.filter((s) => s.pool).map((s) => s.pool!);
  const stable = (await Promise.allSettled(stableIds.map(readPool))).flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
  const pools: CalcPool[] = [
    ...core.map((p) => ({ ...p, symA: tokenSymbol(p.tokenA), symB: tokenSymbol(p.tokenB), group: "core" as const })),
    ...stable
      .filter((p) => p.reserveA > 0 && p.reserveB > 0)
      .map((p) => ({ ...p, symA: tokenSymbol(p.tokenA), symB: tokenSymbol(p.tokenB), group: "stable" as const, mock: STABLES.find((s) => s.pool === p.id)?.mock })),
  ];
  return { pools, values: inferTokenValues(pools, XLM_ANCHORS()), demo: false };
}

export function demoCalcPools(): CalcPools {
  const pools: CalcPool[] = DEMO_POOLS.map((p) => ({ id: p.id, tokenA: p.a, tokenB: p.b, reserveA: p.reserveA, reserveB: p.reserveB, totalShares: p.totalShares, feeBps: p.feeBps, symA: p.a, symB: p.b, group: "core", demo: true }));
  return { pools, values: inferTokenValues(pools, { XLM: 1, QFX: 1 }), demo: true };
}

export type PoolActivity = {
  /** Window actually scanned (days, from ledger close times). */
  windowDays: number;
  week: ReturnType<typeof summarizeSwaps>;
  day: ReturnType<typeof summarizeSwaps>;
  /** Referral cut of the fee (bps of the fee), from the referral contract. */
  referralShareBps: number;
};

const toSec = (v: string | number | undefined) => (v === undefined ? NaN : Number(v));

/**
 * Swap events of one pool over the RPC's retention window (≈7 days on
 * testnet), summarised for the last 24h and the whole window.
 */
export async function loadPoolActivity(pool: PoolInfo, maxDays = 7): Promise<PoolActivity> {
  const shareP = readContract<number>(CONTRACTS.referral, "share_bps").catch(() => 2000);
  const health = await soroban.getHealth();
  const latest = health.latestLedger;
  const oldest = health.oldestLedger;
  const start = Math.max(oldest + 20, latest - Math.round(maxDays * 17_280));
  const filters = [{ type: "contract" as const, contractIds: [pool.id], topics: [[xdr.ScVal.scvSymbol("swap").toXDR("base64"), "*"]] }];
  let r = await soroban.getEvents({ startLedger: start, filters, limit: 200 });
  const events = [...r.events];
  for (let i = 1; i < 60; i++) {
    const cursorLedger = r.cursor ? Number(BigInt(r.cursor.split("-")[0]) >> 32n) : Infinity;
    if (cursorLedger >= r.latestLedger) break;
    r = await soroban.getEvents({ cursor: r.cursor, filters, limit: 200 });
    events.push(...r.events);
  }
  const rr = r as unknown as { latestLedgerCloseTime?: string | number; oldestLedgerCloseTime?: string | number; oldestLedger?: number; latestLedger: number };
  const latestT = toSec(rr.latestLedgerCloseTime), oldestT = toSec(rr.oldestLedgerCloseTime);
  const secPerLedger = Number.isFinite(latestT) && Number.isFinite(oldestT) && rr.oldestLedger && rr.latestLedger > rr.oldestLedger ? (latestT - oldestT) / (rr.latestLedger - rr.oldestLedger) : 5;
  const windowDays = ((latest - start) * secPerLedger) / 86_400;
  const nowT = Number.isFinite(latestT) ? latestT : Date.now() / 1000;
  const parse = (e: (typeof events)[number]): SwapEvent & { t: number } => {
    const v = scValToNative(e.value) as { token_in: string; amount_in: bigint; amount_out: bigint; fee: bigint; referral_fee: bigint };
    return { tokenIn: v.token_in, amountIn: fromUnits(v.amount_in), amountOut: fromUnits(v.amount_out), fee: fromUnits(v.fee ?? 0n), referralFee: fromUnits(v.referral_fee ?? 0n), t: Date.parse(e.ledgerClosedAt) / 1000 };
  };
  const swaps = events.filter((e) => e.contractId?.toString() === pool.id).map(parse);
  return {
    windowDays,
    week: summarizeSwaps(swaps, pool),
    day: summarizeSwaps(swaps.filter((s) => s.t >= nowT - 86_400), pool),
    referralShareBps: await shareP,
  };
}

// ---------------------------------------------------------------- staking
export type CalcStakePool = StakePool & { stakeSym: string; rewardSym: string; stakeValueXlm: number; rewardValueXlm: number; demo?: boolean };

export async function loadCalcStaking(): Promise<{ pools: CalcStakePool[]; demo: boolean }> {
  const [{ pools }, core] = await Promise.all([readStaking(""), Promise.all(CONTRACTS.pools.map(readPool))]);
  const values = inferTokenValues(core, XLM_ANCHORS());
  return {
    demo: false,
    pools: pools.map((p) => ({
      ...p,
      stakeSym: tokenSymbol(p.stakeToken),
      rewardSym: tokenSymbol(p.rewardToken),
      stakeValueXlm: tokenValueXlm(p.stakeToken, core, values),
      rewardValueXlm: tokenValueXlm(p.rewardToken, core, values),
    })),
  };
}

export function demoCalcStaking(): { pools: CalcStakePool[]; demo: boolean } {
  return {
    demo: true,
    pools: DEMO_STAKING.map((p) => ({ id: p.id, stakeToken: p.stake, rewardToken: p.reward, ratePerSec: p.ratePerSec, lockDays: p.lockDays, totalStaked: p.totalStaked, reserve: p.reserve, active: p.active, minStake: p.minStake, stakeSym: p.stake, rewardSym: p.reward, stakeValueXlm: p.stake.startsWith("QLP") ? 2 : 1, rewardValueXlm: 1, demo: true })),
  };
}

// ---------------------------------------------------------------- QFX holder yield
export const loadCalcQfx = (): Promise<QfxInfo> => readQfx("");
export const demoCalcQfx = (): QfxInfo => ({ ...DEMO_QFX, balance: 0, raw: { xlmReserve: 0n, totalSupply: 0n } });
