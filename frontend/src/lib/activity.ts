/**
 * Activity feed: classify Horizon operations (joined with their transactions) into swaps, exchange orders, pool activity,
 * GLACIERQ reward / referral payments and plain payments. Pure classification (testable) + a Horizon reader.
 * Transaction links are NOT built here: the page renders every hash through TxLink -> explorerTxUrl (StellarChain only).
 */
import { NETS, type NetId } from "./nativePools";
import { REWARD_ASSET_CODE, REWARD_ISSUER, REWARD_RESERVE } from "./rewards";

export type ActivityKind = "swap" | "order" | "pool" | "reward" | "referral" | "payment";
export const ACTIVITY_FILTERS: { v: "all" | ActivityKind; label: string }[] = [
  { v: "all", label: "All" }, { v: "swap", label: "Swaps" }, { v: "order", label: "Exchange orders" }, { v: "pool", label: "Pools" },
  { v: "reward", label: "Rewards" }, { v: "referral", label: "Referral" }, { v: "payment", label: "Payments" },
];

export type ActivityItem = { id: string; kind: ActivityKind; time: string; hash: string; title: string; detail: string; mine: boolean | null };

/** The subset of a Horizon operation record we read (every field optional: records differ per type). */
export type OpRec = {
  id: string; type: string; created_at: string; transaction_hash: string; source_account?: string; transaction_successful?: boolean;
  transaction?: { memo?: string; memo_type?: string; hash?: string };
  from?: string; to?: string; funder?: string; account?: string;
  asset_type?: string; asset_code?: string; asset_issuer?: string; amount?: string;
  source_amount?: string; source_asset_type?: string; source_asset_code?: string; source_asset_issuer?: string;
  buying_asset_type?: string; buying_asset_code?: string; selling_asset_type?: string; selling_asset_code?: string; price?: string;
  liquidity_pool_id?: string; shares?: string; shares_received?: string;
  reserves_deposited?: { asset: string; amount: string }[]; reserves_received?: { asset: string; amount: string }[];
  reserves_max?: { asset: string; amount: string }[]; reserves_min?: { asset: string; amount: string }[];
};
export type RewardCfg = { code: string; issuer: string | null; reserve: string | null };

const code = (t?: string, c?: string) => (t === "native" ? "XLM" : c ?? "?");
const num = (s?: string) => { const n = Number(s); return Number.isFinite(n) ? n : 0; };
const nice = (s?: string) => { const n = num(s); return n >= 1000 ? n.toLocaleString("en-US", { maximumFractionDigits: 2 }) : String(Number(n.toFixed(7))); };
const poolAsset = (a: string) => (a === "native" ? "XLM" : a.split(":")[0]);
const reserves = (rs?: { asset: string; amount: string }[]) => (rs ?? []).map((r) => `${nice(r.amount)} ${poolAsset(r.asset)}`).join(" + ");
const sh = (a?: string) => (a ? `${a.slice(0, 4)}…${a.slice(-4)}` : "?");

/** What a GLACIERQ payment memo marks. Same conventions as the rewards script. */
export function classifyMemo(memo?: string | null): { kind: "reward" | "referrer" | "referee"; day: string } | null {
  if (!memo) return null;
  let m = /^GLACIERQ-REF:(\d{4}-\d{2}-\d{2})$/.exec(memo); if (m) return { kind: "referrer", day: m[1] };
  m = /^GLACIERQ-BOOST:(\d{4}-\d{2}-\d{2})$/.exec(memo); if (m) return { kind: "referee", day: m[1] };
  m = /^GLACIERQ:(\d{4}-\d{2}-\d{2})$/.exec(memo); if (m) return { kind: "reward", day: m[1] };
  return null;
}

/** Classify one operation. Returns null for types the feed does not show (trustline changes, etc.) and failed transactions. */
export function classifyOp(r: OpRec, me: string | null, cfg: RewardCfg = { code: REWARD_ASSET_CODE, issuer: null, reserve: null }): ActivityItem | null {
  if (r.transaction_successful === false) return null;
  const base = { id: r.id, time: r.created_at, hash: r.transaction_hash || r.transaction?.hash || "" };
  const mine = (a?: string) => (me ? a === me : null);
  switch (r.type) {
    case "path_payment_strict_send":
    case "path_payment_strict_receive": {
      const who = r.from ?? r.source_account;
      return { ...base, kind: "swap", mine: mine(who), title: `Swap ${nice(r.source_amount)} ${code(r.source_asset_type, r.source_asset_code)} → ${nice(r.amount)} ${code(r.asset_type, r.asset_code)}`, detail: who === r.to ? `by ${sh(who)}` : `by ${sh(who)} to ${sh(r.to)}` };
    }
    case "manage_buy_offer":
    case "manage_sell_offer":
    case "create_passive_sell_offer": {
      const buy = r.type === "manage_buy_offer";
      const a = code(r.selling_asset_type, r.selling_asset_code), b = code(r.buying_asset_type, r.buying_asset_code);
      const gone = num(r.amount) === 0;
      return { ...base, kind: "order", mine: mine(r.source_account), title: gone ? `Cancelled order ${a}/${b}` : buy ? `Buy order: ${nice(r.amount)} ${b} for ${a} at ${nice(r.price)}` : `Sell order: ${nice(r.amount)} ${a} for ${b} at ${nice(r.price)}`, detail: `by ${sh(r.source_account)}` };
    }
    case "liquidity_pool_deposit":
      return { ...base, kind: "pool", mine: mine(r.source_account), title: `Pool deposit: ${reserves(r.reserves_deposited) || reserves(r.reserves_max)}`, detail: `${r.shares_received ? `${nice(r.shares_received)} shares · ` : ""}by ${sh(r.source_account)}` };
    case "liquidity_pool_withdraw":
      return { ...base, kind: "pool", mine: mine(r.source_account), title: `Pool withdrawal: ${reserves(r.reserves_received) || reserves(r.reserves_min)}`, detail: `${r.shares ? `${nice(r.shares)} shares · ` : ""}by ${sh(r.source_account)}` };
    case "payment": {
      const c = code(r.asset_type, r.asset_code), memo = classifyMemo(r.transaction?.memo);
      const verified = c === cfg.code && !!cfg.issuer && r.asset_issuer === cfg.issuer && (!cfg.reserve || r.from === cfg.reserve);
      if (memo && verified) {
        const kind = memo.kind === "reward" ? "reward" : "referral";
        const t = memo.kind === "reward" ? "Holder reward" : memo.kind === "referrer" ? "Referral bonus (referrer)" : "Referral boost (referee)";
        return { ...base, kind, mine: mine(r.to), title: `${t}: ${nice(r.amount)} ${c}`, detail: `for ${memo.day} · to ${sh(r.to)}` };
      }
      return { ...base, kind: "payment", mine: me ? r.from === me || r.to === me : null, title: `${nice(r.amount)} ${c}`, detail: me && r.to === me ? `received from ${sh(r.from)}` : `${sh(r.from)} → ${sh(r.to)}` };
    }
    case "create_account":
      return { ...base, kind: "payment", mine: me ? r.account === me || r.funder === me : null, title: `Account created with ${nice(r.amount ?? (r as { starting_balance?: string }).starting_balance)} XLM`, detail: `${sh(r.funder)} → ${sh(r.account)}` };
    default:
      return null;
  }
}

export function filterItems(items: ActivityItem[], f: "all" | ActivityKind): ActivityItem[] { return f === "all" ? items : items.filter((i) => i.kind === f); }

/** One item per transaction+kind per account view: a multi-op transaction would otherwise repeat the same line. */
export function dedupe(items: ActivityItem[]): ActivityItem[] { const seen = new Set<string>(); return items.filter((i) => { const k = `${i.id}`; if (seen.has(k)) return false; seen.add(k); return true; }); }

/** Raw operations (joined with their transactions) for one account, newest first, or for the whole network when address is null. */
export async function fetchOps(net: NetId, address: string | null, limit = 100): Promise<OpRec[]> {
  const h = NETS[net].horizon;
  const url = address ? `${h}/accounts/${address}/operations?order=desc&limit=${limit}&join=transactions` : `${h}/operations?order=desc&limit=${limit}&join=transactions`;
  const r = await fetch(url);
  if (r.status === 404 && address) return [];
  if (!r.ok) throw new Error(`Horizon returned ${r.status}`);
  return ((await r.json()) as { _embedded: { records: OpRec[] } })._embedded.records;
}

export const rewardCfg = (net: NetId): RewardCfg => ({ code: REWARD_ASSET_CODE, issuer: REWARD_ISSUER[net], reserve: REWARD_RESERVE[net] });

export async function fetchActivity(net: NetId, address: string | null, limit = 100): Promise<ActivityItem[]> {
  const recs = await fetchOps(net, address, limit);
  const cfg = rewardCfg(net);
  return dedupe(recs.map((rec) => classifyOp(rec, address, cfg)).filter((x): x is ActivityItem => !!x));
}
