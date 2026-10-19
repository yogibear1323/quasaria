/** Holder-rewards reads from Horizon: balance, tier, payment history and reserve status. Read-only. */
import { NETS, type NetId } from "./nativePools";
import { PAYOUT_UTC, REWARD_ASSET_CODE, REWARD_ISSUER, REWARD_RESERVE, TOKENOMICS, dailyReward, memoFor, tierFor } from "./rewards";

type F = typeof fetch;
let fx: F = (...a) => fetch(...a);
export const _setHoldersFetch = (f: F | null) => { fx = f ?? ((...a) => fetch(...a)); };
async function j<T>(url: string): Promise<T | null> {
  const r = await fx(url, { headers: { Accept: "application/json" } });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`Horizon ${r.status}`);
  return (await r.json()) as T;
}

export const utcDay = (d: Date | number = Date.now()) => new Date(d).toISOString().slice(0, 10);

/** Next payout instant (UTC) after `now`. */
export function nextPayout(now = Date.now()): Date {
  const d = new Date(now);
  const t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), PAYOUT_UTC.hour, PAYOUT_UTC.minute);
  return new Date(t > now ? t : t + 86_400_000);
}

export type RewardsLive = { live: boolean; issuer: string | null; reserve: string | null };
export const rewardsLive = (net: NetId): RewardsLive => ({ live: !!REWARD_ISSUER[net] && !!REWARD_RESERVE[net], issuer: REWARD_ISSUER[net], reserve: REWARD_RESERVE[net] });

type Bal = { asset_type: string; asset_code?: string; asset_issuer?: string; balance: string };
export async function fetchRewardBalance(net: NetId, address: string): Promise<number | null> {
  const issuer = REWARD_ISSUER[net];
  if (!issuer) return null;
  const a = await j<{ balances: Bal[] }>(`${NETS[net].horizon}/accounts/${address}`);
  if (!a) return 0;
  const b = a.balances.find((x) => x.asset_code === REWARD_ASSET_CODE && x.asset_issuer === issuer);
  return b ? Number(b.balance) : 0;
}

export type Payment = { id: string; at: string; amount: number; memo: string | null; day: string | null; tx: string };
type PayRec = { id: string; type: string; created_at: string; amount?: string; asset_code?: string; asset_issuer?: string; from?: string; to?: string; transaction_hash: string; transaction?: { memo?: string } };

/** Daily payments received by `address` from the reward reserve (memo-tagged), newest first. */
export async function fetchRewardHistory(net: NetId, address: string, limit = 60): Promise<Payment[]> {
  const issuer = REWARD_ISSUER[net], reserve = REWARD_RESERVE[net];
  if (!issuer || !reserve) return [];
  const out: Payment[] = [];
  let url: string | null = `${NETS[net].horizon}/accounts/${address}/payments?order=desc&limit=200&join=transactions`;
  for (let page = 0; url && page < 5 && out.length < limit; page++) {
    const r: { _embedded: { records: PayRec[] }; _links?: { next?: { href: string } } } | null = await j(url);
    const recs: PayRec[] = r?._embedded.records ?? [];
    for (const p of recs) {
      if (p.type !== "payment" || p.to !== address || p.from !== reserve || p.asset_code !== REWARD_ASSET_CODE || p.asset_issuer !== issuer) continue;
      const memo = p.transaction?.memo ?? null;
      const m = memo && memo.startsWith(`${REWARD_ASSET_CODE}:`) ? memo.slice(REWARD_ASSET_CODE.length + 1) : null;
      out.push({ id: p.id, at: p.created_at, amount: Number(p.amount), memo, day: m, tx: p.transaction_hash });
    }
    url = recs.length === 200 ? (r?._links?.next?.href ?? null) : null;
  }
  return out.slice(0, limit);
}

export type ReserveStatus = {
  balance: number; runwayDaysAtCap: number; runwayDaysAtCurrent: number | null;
  todayTotal: number; yesterdayTotal: number | null; todayCount: number; nextPayout: Date;
};
/** Reserve balance and payout totals (sums the reserve's own outgoing GLACIERQ payments for today and yesterday, UTC). */
export async function fetchReserveStatus(net: NetId, now = Date.now()): Promise<ReserveStatus | null> {
  const issuer = REWARD_ISSUER[net], reserve = REWARD_RESERVE[net];
  if (!issuer || !reserve) return null;
  const a = await j<{ balances: Bal[] }>(`${NETS[net].horizon}/accounts/${reserve}`);
  if (!a) return null;
  const balance = Number(a.balances.find((x) => x.asset_code === REWARD_ASSET_CODE && x.asset_issuer === issuer)?.balance ?? 0);
  const today = utcDay(now), yday = utcDay(now - 86_400_000);
  const sums: Record<string, number> = { [today]: 0, [yday]: 0 };
  let count = 0, url: string | null = `${NETS[net].horizon}/accounts/${reserve}/payments?order=desc&limit=200&join=transactions`;
  for (let page = 0; url && page < 10; page++) {
    const r: { _embedded: { records: PayRec[] } } | null = await j(url);
    const recs: PayRec[] = r?._embedded.records ?? [];
    let older = false;
    for (const p of recs) {
      const d = p.created_at.slice(0, 10);
      if (d < yday) { older = true; break; }
      if (p.type === "payment" && p.from === reserve && p.asset_code === REWARD_ASSET_CODE && p.asset_issuer === issuer && p.transaction?.memo?.startsWith(`${REWARD_ASSET_CODE}:`)) {
        sums[d] = (sums[d] ?? 0) + Number(p.amount);
        if (d === today) count++;
      }
    }
    url = !older && recs.length === 200 ? ((r as unknown as { _links?: { next?: { href: string } } })._links?.next?.href ?? null) : null;
  }
  const cur = sums[yday] || null;
  return { balance, runwayDaysAtCap: balance / TOKENOMICS.dailyCap, runwayDaysAtCurrent: cur ? balance / cur : null, todayTotal: sums[today], yesterdayTotal: sums[yday] ?? null, todayCount: count, nextPayout: nextPayout(now) };
}

export const estimateFor = (balance: number) => ({ tier: tierFor(balance), daily: dailyReward(balance) });
export { memoFor };
