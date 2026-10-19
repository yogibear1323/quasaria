/**
 * Earnings maths from an account's own operation history + its current pool positions.
 * LP: Stellar pools do not pay fees out; they stay in the reserves and raise what your shares are worth.
 * So per pool and asset:  now + withdrawn - deposited  = what the position gained or lost (fees earned minus impermanent loss,
 * plus nothing else). It is exact for the operations we can see, so we also report whether the history may be cut off.
 * Rewards / referral: sums of verified GLACIERQ payments (issuer, reserve and memo checked by classifyOp).
 */
import { classifyMemo, type OpRec, type RewardCfg } from "./activity";
import type { Position } from "./nativePools";
import { keyOf } from "./nativePools";

export type Flow = { deposited: Map<string, number>; withdrawn: Map<string, number> };
const add = (m: Map<string, number>, k: string, v: number) => m.set(k, (m.get(k) ?? 0) + v);

/** Sum deposits and withdrawals per pool id from successful operations by `me`. */
export function lpFlows(ops: OpRec[], me: string): Map<string, Flow> {
  const out = new Map<string, Flow>();
  for (const o of ops) {
    if (o.transaction_successful === false || o.source_account !== me || !o.liquidity_pool_id) continue;
    const f = out.get(o.liquidity_pool_id) ?? { deposited: new Map(), withdrawn: new Map() };
    if (o.type === "liquidity_pool_deposit") for (const r of o.reserves_deposited ?? []) add(f.deposited, r.asset, Number(r.amount));
    else if (o.type === "liquidity_pool_withdraw") for (const r of o.reserves_received ?? []) add(f.withdrawn, r.asset, Number(r.amount));
    else continue;
    out.set(o.liquidity_pool_id, f);
  }
  return out;
}

export type LpLine = { poolId: string; a: { key: string; code: string; now: number; net: number }; b: { key: string; code: string; now: number; net: number }; sawDeposit: boolean };

/** One line per current position: gain/loss per asset versus what was put in (minus what was taken out). */
export function lpEarnings(positions: Position[], flows: Map<string, Flow>): LpLine[] {
  return positions.map((p) => {
    const f = flows.get(p.pool.id);
    const line = (asset: Position["pool"]["a"], now: number) => {
      const key = keyOf(asset);
      const net = f ? now + (f.withdrawn.get(key) ?? 0) - (f.deposited.get(key) ?? 0) : 0;
      return { key, code: asset.code, now, net };
    };
    return { poolId: p.pool.id, a: line(p.pool.a, p.amountA), b: line(p.pool.b, p.amountB), sawDeposit: !!f && f.deposited.size > 0 };
  });
}

export type PaymentTotals = { reward: number; referrer: number; referee: number; count: number };
/** Totals of verified GLACIERQ payments received by `me`, split by memo kind. */
export function paymentTotals(ops: OpRec[], me: string, cfg: RewardCfg): PaymentTotals {
  const t: PaymentTotals = { reward: 0, referrer: 0, referee: 0, count: 0 };
  for (const o of ops) {
    if (o.type !== "payment" || o.transaction_successful === false || o.to !== me) continue;
    const m = classifyMemo(o.transaction?.memo);
    const verified = o.asset_code === cfg.code && !!cfg.issuer && o.asset_issuer === cfg.issuer && (!cfg.reserve || o.from === cfg.reserve);
    if (!m || !verified) continue;
    t[m.kind] += Number(o.amount); t.count++;
  }
  return t;
}
