/**
 * Typed read-only views over the deployed Quasaria contracts (simulation via
 * Soroban RPC; no wallet needed) + a tiny data hook.
 */
import { useEffect, useState } from "react";
import { rpc, scValToNative, xdr } from "@stellar/stellar-sdk";
import { CONTRACTS, CONTRACTS_CONFIGURED, DEMO_ACCOUNTS } from "./config";
import { addr, assetOther, readContract, soroban, u32, u64 } from "./soroban";
import { fromUnits } from "./format";
import { useWallet } from "./wallet";

export type LoadState<T> = { data: T | null; error: string | null; loading: boolean; live: boolean };

/** Run an async loader when chain reads are possible; `live` = data came from chain. */
export function useChain<T>(load: () => Promise<T>, deps: unknown[] = []): LoadState<T> {
  const [s, setS] = useState<LoadState<T>>({ data: null, error: null, loading: CONTRACTS_CONFIGURED, live: false });
  useEffect(() => {
    if (!CONTRACTS_CONFIGURED) return;
    let alive = true;
    setS((x) => ({ ...x, loading: true }));
    load()
      .then((data) => alive && setS({ data, error: null, loading: false, live: true }))
      .catch((e) => alive && setS({ data: null, error: e instanceof Error ? e.message : String(e), loading: false, live: false }));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return s;
}

/** Connected wallet, or the public seeded demo account for `role`. */
export function useViewer(role: keyof typeof DEMO_ACCOUNTS) {
  const w = useWallet();
  const address = w.address ?? DEMO_ACCOUNTS[role];
  return { address, isDemo: !w.address, role };
}

/** Page through getEvents (the RPC scans a bounded ledger window per call). */
export async function scanEvents(filters: rpc.Api.EventFilter[], back: number, maxPages = 40) {
  const latest = await soroban.getLatestLedger();
  let r = await soroban.getEvents({ startLedger: Math.max(1, latest.sequence - back), filters, limit: 200 });
  const events = [...r.events];
  for (let i = 1; i < maxPages; i++) {
    const cursorLedger = r.cursor ? Number(BigInt(r.cursor.split("-")[0]) >> 32n) : Infinity;
    if (cursorLedger >= r.latestLedger) break;
    r = await soroban.getEvents({ cursor: r.cursor, filters, limit: 200 });
    events.push(...r.events);
  }
  return events;
}

// ---------------------------------------------------------------- pools
export type PoolInfo = { id: string; tokenA: string; tokenB: string; reserveA: number; reserveB: number; totalShares: number; feeBps: number };

export async function readPool(id: string): Promise<PoolInfo> {
  const i = await readContract<{ token_a: string; token_b: string; reserve_a: bigint; reserve_b: bigint; total_shares: bigint; fee_bps: number }>(id, "info");
  return { id, tokenA: i.token_a, tokenB: i.token_b, reserveA: fromUnits(i.reserve_a), reserveB: fromUnits(i.reserve_b), totalShares: fromUnits(i.total_shares), feeBps: i.fee_bps };
}

export async function tokenBalance(token: string, who: string) {
  return fromUnits(await readContract<bigint>(token, "balance", [addr(who)]));
}

/** Swap volume (in token B units) per pool over roughly the last `ledgers` ledgers, from `swap` events. */
export async function poolVolumes(pools: PoolInfo[], ledgers = 17_280): Promise<Record<string, number>> {
  const vol: Record<string, number> = Object.fromEntries(pools.map((p) => [p.id, 0]));
  const events = await scanEvents([{ type: "contract", contractIds: pools.map((p) => p.id), topics: [[xdr.ScVal.scvSymbol("swap").toXDR("base64"), "*"]] }], ledgers);
  for (const e of events) {
    const pool = pools.find((p) => p.id === e.contractId?.toString());
    if (!pool) continue;
    const v = scValToNative(e.value) as { token_in: string; amount_in: bigint; amount_out: bigint };
    vol[pool.id] += v.token_in === pool.tokenB ? fromUnits(v.amount_in) : fromUnits(v.amount_out);
  }
  return vol;
}

// ---------------------------------------------------------------- staking
export type StakePool = { id: number; stakeToken: string; rewardToken: string; ratePerSec: number; lockDays: number; totalStaked: number; reserve: number; active: boolean };
export type StakePos = { amount: number; pending: number; unlockAt: number };

export async function readStaking(viewer: string) {
  const n = await readContract<number>(CONTRACTS.staking, "pool_count");
  const pools: StakePool[] = [];
  const positions: Record<number, StakePos> = {};
  for (let i = 0; i < n; i++) {
    const p = await readContract<{ stake_token: string; reward_token: string; reward_rate: bigint; lock_seconds: bigint; total_staked: bigint; reward_reserve: bigint; active: boolean }>(CONTRACTS.staking, "pool", [u32(i)]);
    pools.push({ id: i, stakeToken: p.stake_token, rewardToken: p.reward_token, ratePerSec: fromUnits(p.reward_rate), lockDays: Number(p.lock_seconds) / 86_400, totalStaked: fromUnits(p.total_staked), reserve: fromUnits(p.reward_reserve), active: p.active });
    if (viewer) {
      const pos = await readContract<{ amount: bigint; unlock_at: bigint }>(CONTRACTS.staking, "position", [u32(i), addr(viewer)]);
      const pending = await readContract<bigint>(CONTRACTS.staking, "pending_rewards", [u32(i), addr(viewer)]);
      positions[i] = { amount: fromUnits(pos.amount), pending: fromUnits(pending), unlockAt: Number(pos.unlock_at) };
    }
  }
  return { pools, positions };
}

// ---------------------------------------------------------------- QFX (1 QFX = 1 XLM, fully backed)
export type QfxReserves = {
  /** Live XLM held by the QFX contract (native XLM SAC balance). */
  xlmReserve: number;
  totalSupply: number;
  surplus: number;
  fullyBacked: boolean;
  /** QFX held for holder yield (unallocated + accrued, unsettled). */
  rewardReserve: number;
  circulating: number;
  /** Raw stroop values, for exact equality checks. */
  raw: { xlmReserve: bigint; totalSupply: bigint };
};

export async function readQfxReserves(): Promise<QfxReserves> {
  const r = await readContract<{ xlm_reserve: bigint; total_supply: bigint; surplus: bigint; fully_backed: boolean; reward_reserve: bigint; circulating: bigint }>(CONTRACTS.qfx, "reserves");
  return {
    xlmReserve: fromUnits(r.xlm_reserve),
    totalSupply: fromUnits(r.total_supply),
    surplus: fromUnits(r.surplus),
    fullyBacked: r.fully_backed,
    rewardReserve: fromUnits(r.reward_reserve),
    circulating: fromUnits(r.circulating),
    raw: { xlmReserve: BigInt(r.xlm_reserve), totalSupply: BigInt(r.total_supply) },
  };
}

/** XLM (native SAC) and QFX balances of `who`. */
export async function readMintBalances(who: string) {
  if (!who) return { xlm: 0, qfx: 0 };
  const [xlm, qfx] = await Promise.all([tokenBalance(CONTRACTS.xlmSac, who), tokenBalance(CONTRACTS.qfx, who)]);
  return { xlm, qfx };
}

export type QfxInfo = QfxReserves & {
  aprBps: number;
  apyBps: number;
  maxAprBps: number;
  genesis: number;
  nextAccrualAt: number;
  /** Unallocated holder-yield reserve (QFX). */
  rewardPool: number;
  eligibleSupply: number;
  dailyEmission: number;
  balance: number;
  pending: number;
};

export async function readQfx(viewer: string): Promise<QfxInfo> {
  const [y, res] = await Promise.all([
    readContract<{ apr_bps: number; apy_bps: number; max_apr_bps: number; genesis: bigint; next_accrual_at: bigint; reward_pool: bigint; eligible_supply: bigint; daily_emission: bigint }>(CONTRACTS.qfx, "yield_info"),
    readQfxReserves(),
  ]);
  const balance = viewer ? await tokenBalance(CONTRACTS.qfx, viewer) : 0;
  const pending = viewer ? fromUnits(await readContract<bigint>(CONTRACTS.qfx, "pending_yield", [addr(viewer)])) : 0;
  return {
    ...res,
    aprBps: y.apr_bps,
    apyBps: y.apy_bps,
    maxAprBps: y.max_apr_bps,
    genesis: Number(y.genesis),
    nextAccrualAt: Number(y.next_accrual_at),
    rewardPool: fromUnits(y.reward_pool),
    eligibleSupply: fromUnits(y.eligible_supply),
    dailyEmission: fromUnits(y.daily_emission),
    balance,
    pending,
  };
}

// ---------------------------------------------------------------- referrals
export type RefActivity = { ledger: number; when: string; token: string; amount: number; source: string };

export async function readReferrals(referrer: string) {
  const [count, shareBps] = await Promise.all([
    readContract<number>(CONTRACTS.referral, "referral_count", [addr(referrer)]),
    readContract<number>(CONTRACTS.referral, "share_bps"),
  ]);
  const tokens = [CONTRACTS.xlmSac, CONTRACTS.qusdSac, CONTRACTS.qfx];
  const earned = await Promise.all(tokens.map(async (t) => ({ token: t, amount: fromUnits(await readContract<bigint>(CONTRACTS.referral, "earned", [addr(referrer), addr(t)])) })));
  let recent: RefActivity[] = [];
  try {
    const events = await scanEvents([{ type: "contract", contractIds: [CONTRACTS.referral], topics: [[xdr.ScVal.scvSymbol("referral_paid").toXDR("base64"), addr(referrer).toXDR("base64")]] }], 100_000, 60);
    recent = events.map((e) => {
      const v = scValToNative(e.value) as { token: string; amount: bigint; source: string };
      return { ledger: e.ledger, when: e.ledgerClosedAt, token: v.token, amount: fromUnits(v.amount), source: v.source };
    }).reverse();
  } catch {
    /* event retention window exceeded or RPC limit */
  }
  return { count, shareBps, earned, recent };
}

export async function readReferrerOf(user: string) {
  return readContract<string | null>(CONTRACTS.referral, "get_referrer", [addr(user)]);
}

// ---------------------------------------------------------------- vault
export type VaultPosition = { id: number; asset: string; isLong: boolean; margin: number; size: number; entry: number; sl: number; tp: number; openedAt: number };

export async function readVault(owner: string) {
  const [cfg, liquidity, openIds, decimals] = await Promise.all([
    readContract<{ max_leverage_bps: number; maintenance_margin_bps: number; open_fee_bps: number; max_price_age: bigint }>(CONTRACTS.vault, "config"),
    readContract<bigint>(CONTRACTS.vault, "liquidity"),
    readContract<bigint[]>(CONTRACTS.vault, "open_position_ids"),
    readContract<number>(CONTRACTS.oracle, "decimals"),
  ]);
  const pd = await readContract<{ price: bigint; timestamp: bigint } | null>(CONTRACTS.oracle, "lastprice", [assetOther("XLM")]);
  const scale = 10 ** decimals;
  const ids = owner ? await readContract<bigint[]>(CONTRACTS.vault, "user_positions", [addr(owner)]) : [];
  const positions: VaultPosition[] = [];
  for (const id of ids) {
    const p = await readContract<{ id: bigint; asset: [string, string]; is_long: boolean; margin: bigint; size: bigint; entry_price: bigint; stop_loss: bigint; take_profit: bigint; opened_at: bigint }>(CONTRACTS.vault, "position", [u64(id)]);
    positions.push({ id: Number(p.id), asset: String(p.asset[1]), isLong: p.is_long, margin: fromUnits(p.margin), size: fromUnits(p.size), entry: Number(p.entry_price) / scale, sl: Number(p.stop_loss) / scale, tp: Number(p.take_profit) / scale, openedAt: Number(p.opened_at) });
  }
  const free = owner ? fromUnits(await readContract<bigint>(CONTRACTS.vault, "free_collateral", [addr(owner)])) : 0;
  return {
    maxLeverage: cfg.max_leverage_bps / 10_000,
    mmBps: cfg.maintenance_margin_bps,
    openFeeBps: cfg.open_fee_bps,
    maxPriceAge: Number(cfg.max_price_age),
    liquidity: fromUnits(liquidity),
    openCount: openIds.length,
    mark: pd ? Number(pd.price) / scale : null,
    priceTimestamp: pd ? Number(pd.timestamp) : null,
    positions,
    free,
  };
}

