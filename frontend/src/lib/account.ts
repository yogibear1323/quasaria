/**
 * Read-only account view from the Horizon account endpoint (never touches a secret key).
 * Pure parsers (testable) + thin fetchers. Anything Horizon does not give us is null; the UI shows a dash.
 */
import { NETS, type NetId } from "./nativePools";
import { REWARD_ASSET_CODE, REWARD_ISSUER, REWARD_TIERS, isRewardAsset, tierFor, pctYear } from "./rewards";
import { TESTNET_USDC_ISSUER } from "./config";
import { MAINNET_USDC_ISSUER } from "./liveMarkets";

export type HBalance = {
  asset_type: string; balance: string; asset_code?: string; asset_issuer?: string; liquidity_pool_id?: string;
  buying_liabilities?: string; selling_liabilities?: string; is_authorized?: boolean; limit?: string;
};
export type HAccount = { balances: HBalance[]; data?: Record<string, string>; subentry_count?: number; num_sponsoring?: number; num_sponsored?: number };
export type HPool = { id: string; fee_bp: number; total_shares: string; total_trustlines?: string; reserves: { asset: string; amount: string }[] };

const n = (v: unknown): number | null => { const x = typeof v === "string" || typeof v === "number" ? Number(v) : NaN; return Number.isFinite(x) ? x : null; };

/** Issuer-verified labels. Matched on code AND issuer, never ticker alone. */
export type Verified = { code: string; issuer: string; label: string };
export function verifiedList(net: NetId): Verified[] {
  const out: Verified[] = [{ code: "USDC", issuer: net === "mainnet" ? MAINNET_USDC_ISSUER : TESTNET_USDC_ISSUER, label: net === "mainnet" ? "USDC · Circle (verified issuer)" : "USDC · Circle testnet issuer (verified, no value)" }];
  const g = REWARD_ISSUER[net];
  if (g) out.push({ code: REWARD_ASSET_CODE, issuer: g, label: `${REWARD_ASSET_CODE} · Quasaria holder-reward token (verified issuer)` });
  return out;
}
export const verifiedLabel = (net: NetId, code: string, issuer: string): string | null => verifiedList(net).find((v) => v.code === code && v.issuer === issuer)?.label ?? null;

export type Holding = { code: string; issuer: string; balance: number; sellingLiabilities: number; available: number; limit: number | null; authorized: boolean; verified: string | null; isReward: boolean };
/** Kept back from "available" XLM so a full send still pays its network fee (0.01 XLM ≈ 1,000 operations at the base fee). */
export const XLM_FEE_BUFFER = 0.01;
export type PoolShare = { poolId: string; shares: number };
export type Native = { balance: number; sellingLiabilities: number; buyingLiabilities: number; reserve: number | null; available: number | null };
export type AccountView =
  | { exists: false }
  | { exists: true; native: Native; holdings: Holding[]; poolShares: PoolShare[]; subentries: number; reward: { balance: number; tier: string; apr: number | null; next: string | null } | null };

/** Minimum balance = (2 + subentries + sponsoring − sponsored) × base reserve (stellar docs: Lumens › Minimum balance). */
export function minimumBalance(a: HAccount, baseReserve: number | null): number | null {
  if (baseReserve === null) return null;
  const units = 2 + (a.subentry_count ?? 0) + (a.num_sponsoring ?? 0) - (a.num_sponsored ?? 0);
  return Math.max(0, units) * baseReserve;
}

export function parseAccount(a: HAccount, net: NetId, baseReserve: number | null): AccountView {
  const nat = a.balances.find((b) => b.asset_type === "native");
  const bal = n(nat?.balance) ?? 0;
  const sell = n(nat?.selling_liabilities) ?? 0;
  const reserve = minimumBalance(a, baseReserve);
  const native: Native = { balance: bal, sellingLiabilities: sell, buyingLiabilities: n(nat?.buying_liabilities) ?? 0, reserve, available: reserve === null ? null : Math.max(0, +(bal - reserve - sell - XLM_FEE_BUFFER).toFixed(7)) };
  const holdings: Holding[] = a.balances
    .filter((b) => (b.asset_type === "credit_alphanum4" || b.asset_type === "credit_alphanum12") && b.asset_code && b.asset_issuer)
    .map((b) => ({
      code: b.asset_code!, issuer: b.asset_issuer!, balance: n(b.balance) ?? 0, sellingLiabilities: n(b.selling_liabilities) ?? 0, available: Math.max(0, +((n(b.balance) ?? 0) - (n(b.selling_liabilities) ?? 0)).toFixed(7)), limit: n(b.limit), authorized: b.is_authorized !== false,
      verified: verifiedLabel(net, b.asset_code!, b.asset_issuer!), isReward: isRewardAsset(b.asset_code!, b.asset_issuer),
    }));
  const poolShares: PoolShare[] = a.balances.filter((b) => b.asset_type === "liquidity_pool_shares" && b.liquidity_pool_id).map((b) => ({ poolId: b.liquidity_pool_id!, shares: n(b.balance) ?? 0 }));
  return { exists: true, native, holdings, poolShares, subentries: a.subentry_count ?? 0, reward: rewardStatus(holdings.find((h) => h.isReward)?.balance ?? 0) };
}

/** GLACIERQ holder-reward status from a balance. Wording: "per year from 1M / 10M, not guaranteed". */
export function rewardStatus(balance: number) {
  const t = tierFor(balance);
  const next = REWARD_TIERS.find((x) => x.min > balance) ?? null;
  return {
    balance,
    tier: t ? `${t.name} · ${pctYear(t.apr)}% a year` : "Below 1M · not earning yet",
    apr: t ? t.apr : null,
    next: next ? `${(next.min - balance).toLocaleString("en-US", { maximumFractionDigits: 0 })} more ${REWARD_ASSET_CODE} for ${pctYear(next.apr)}% a year` : null,
  };
}

export type PoolPosition = { poolId: string; name: string; shares: number; shareOfPool: number | null; amounts: { code: string; amount: number }[]; feePct: number | null; valueUsd: number | null };
const assetCode = (s: string) => (s === "native" ? "XLM" : s.split(":")[0]);

/** A share balance → underlying amounts (shares / total_shares × reserves). Value only when an XLM side AND a real price exist. */
export function poolPosition(ps: PoolShare, pool: HPool | null, usdPerXlm: number | null, net: NetId): PoolPosition {
  if (!pool) return { poolId: ps.poolId, name: "—", shares: ps.shares, shareOfPool: null, amounts: [], feePct: null, valueUsd: null };
  const total = n(pool.total_shares);
  const frac = total && total > 0 ? ps.shares / total : null;
  const amounts = frac === null ? [] : pool.reserves.map((r) => ({ code: assetCode(r.asset), amount: (n(r.amount) ?? 0) * frac }));
  const xlm = amounts.find((a) => a.code === "XLM");
  const valueUsd = net === "mainnet" && xlm && usdPerXlm ? xlm.amount * 2 * usdPerXlm : null; // constant-product pools hold equal value on both sides
  return { poolId: ps.poolId, name: pool.reserves.map((r) => assetCode(r.asset)).join(" / "), shares: ps.shares, shareOfPool: frac, amounts, feePct: pool.fee_bp / 100, valueUsd };
}

async function getJson<T>(url: string, f: typeof fetch): Promise<T | null> {
  const r = await f(url, { headers: { Accept: "application/json" } });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`Horizon ${r.status}`);
  return (await r.json()) as T;
}
export async function fetchBaseReserve(net: NetId, f: typeof fetch = fetch): Promise<number | null> {
  try {
    const j = await getJson<{ _embedded: { records: { base_reserve_in_stroops?: number }[] } }>(`${NETS[net].horizon}/ledgers?order=desc&limit=1`, f);
    const s = j?._embedded.records[0]?.base_reserve_in_stroops;
    return typeof s === "number" ? s / 1e7 : null;
  } catch { return null; }
}
/** null → the account does not exist on this network (unfunded). */
export async function fetchRawAccount(net: NetId, address: string, f: typeof fetch = fetch): Promise<HAccount | null> {
  return getJson<HAccount>(`${NETS[net].horizon}/accounts/${address}`, f);
}
export async function loadAccountView(net: NetId, address: string, f: typeof fetch = fetch): Promise<{ view: AccountView; raw: HAccount | null }> {
  const raw = await fetchRawAccount(net, address, f);
  if (!raw) return { view: { exists: false }, raw: null };
  return { view: parseAccount(raw, net, await fetchBaseReserve(net, f)), raw };
}
export async function fetchPool(net: NetId, id: string, f: typeof fetch = fetch): Promise<HPool | null> {
  try { return await getJson<HPool>(`${NETS[net].horizon}/liquidity_pools/${id}`, f); } catch { return null; }
}
