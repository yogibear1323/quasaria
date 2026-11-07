/**
 * One pool's recent trades from Horizon. Bounded pages. No other pool is fetched.
 */
import { consumePage, emptyWalk, emptyWalkState, finishWalk, TRADE_WINDOW_MAX_PAGES, WINDOW_MS, type UnitTrade, type VolumeWalk } from "./lpQuote";
import { type AssetRef } from "./nativePools";

type RawTrade = {
  ledger_close_time?: string;
  base_amount?: string;
  base_asset_type?: string;
  base_asset_code?: string;
  base_asset_issuer?: string;
  counter_amount?: string;
  counter_asset_type?: string;
  counter_asset_code?: string;
  counter_asset_issuer?: string;
};

const amountOf = (s: unknown): number | null => {
  if (typeof s !== "string" || !/^\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

const assetOf = (type: unknown, code: unknown, issuer: unknown): AssetRef | null => {
  if (type === "native") return { code: "XLM", issuer: null };
  if ((type === "credit_alphanum4" || type === "credit_alphanum12") && typeof code === "string" && typeof issuer === "string" && issuer.startsWith("G")) return { code, issuer };
  return null;
};

export function parsePoolTrade(raw: RawTrade): UnitTrade | null {
  const atMs = Date.parse(raw.ledger_close_time ?? "");
  const base = assetOf(raw.base_asset_type, raw.base_asset_code, raw.base_asset_issuer);
  const counter = assetOf(raw.counter_asset_type, raw.counter_asset_code, raw.counter_asset_issuer);
  const baseAmount = amountOf(raw.base_amount);
  const counterAmount = amountOf(raw.counter_amount);
  if (!Number.isFinite(atMs) || !base || !counter || baseAmount === null || counterAmount === null) return null;
  return { atMs, base, baseAmount, counter, counterAmount };
}

const POOL_ID = /^[0-9a-f]{64}$/i;

/**
 * Walk `/liquidity_pools/{id}/trades` until a trade falls outside the 24h window,
 * the history runs out, or `maxPages` is hit. The last case is truncated and must not be annualized.
 */
export async function fetchTradeWindow(horizon: string, poolId: string, unit: AssetRef, nowMs = Date.now(), opts: { maxPages?: number; limit?: number; fetchImpl?: typeof fetch; windowMs?: number } = {}): Promise<VolumeWalk> {
  const fetchedAtMs = nowMs;
  if (!POOL_ID.test(poolId)) return emptyWalk(fetchedAtMs, false);
  const maxPages = opts.maxPages ?? TRADE_WINDOW_MAX_PAGES;
  const limit = opts.limit ?? 200;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const windowMs = opts.windowMs ?? WINDOW_MS;
  let url: string | null = `${horizon.replace(/\/$/, "")}/liquidity_pools/${poolId}/trades?order=desc&limit=${limit}`;
  const state = emptyWalkState();
  let pages = 0;
  let exhausted = false;
  const seen = new Set<string>();
  try {
    while (url && pages < maxPages && !state.reachedCutoff && !state.bad) {
      if (seen.has(url)) return emptyWalk(fetchedAtMs, false);
      seen.add(url);
      const res = await fetchImpl(url, { headers: { Accept: "application/json" } });
      if (!res.ok) return emptyWalk(fetchedAtMs, false);
      const body = await res.json() as { _embedded?: { records?: RawTrade[] }; _links?: { next?: { href?: string } } };
      const recs = body?._embedded?.records;
      if (!Array.isArray(recs)) return emptyWalk(fetchedAtMs, false);
      pages += 1;
      const parsed = recs.map((r) => parsePoolTrade(r));
      const folded = consumePage(state, parsed, unit, nowMs, windowMs);
      state.volumeInUnit = folded.volumeInUnit;
      state.tradesInWindow = folded.tradesInWindow;
      state.newestTradeMs = folded.newestTradeMs;
      state.oldestInWindowMs = folded.oldestInWindowMs;
      state.reachedCutoff = folded.reachedCutoff;
      state.bad = folded.bad;
      if (state.bad) return emptyWalk(fetchedAtMs, false);
      if (recs.length < limit) { exhausted = true; break; }
      const next = body._links?.next?.href;
      url = next && recs.length === limit && !state.reachedCutoff ? next : null;
      if (!url) exhausted = true;
    }
  } catch {
    return emptyWalk(fetchedAtMs, false);
  }
  return finishWalk(state, { pages, maxPages, exhausted: exhausted || state.reachedCutoff, fetchedAtMs });
}
