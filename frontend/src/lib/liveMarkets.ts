/**
 * LIVE market data for the Markets page, read directly from Stellar MAINNET
 * public Horizon (https://horizon.stellar.org) in the browser. Read-only,
 * display-only: nothing here is used for trading, which stays on TESTNET.
 *
 * Horizon sends `Access-Control-Allow-Origin` for github.io, so no proxy is
 * needed. Requests are plain GETs (no custom headers → no CORS preflight).
 *
 * Rate limits (measured on horizon.stellar.org, Sep 2026): ~3600 req/h per IP
 * overall, and /trade_aggregations is separately capped at 100 requests per
 * 5 minutes per IP. The load balancer's 429 responses carry NO CORS headers,
 * so in a browser a rate-limit looks like a generic "Failed to fetch". Hence:
 *
 *  - fast tier, every ~30s: ONE network-wide `/trades` poll (cursor-paged, a
 *    few pages at most) → the latest trade price of each tracked asset vs XLM,
 *    and XLM/USD from the Circle-USDC/XLM trades;
 *  - `/trade_aggregations` (1h candles over 7d, asset vs XLM) → 1h / 24h / 7d
 *    change, 24h volume + trades, sparkline. Refreshed per asset every 10 min,
 *    staggered (≤3 per tick after the first load), cached in localStorage, and
 *    paused for up to 5 min after a failure (≈ 26 calls per 10 min, well under
 *    100 per 5 min);
 *  - `/assets` (holders + circulating supply) every 30 min, cached;
 *  - `/order_book` mid only for assets with no trade in 24h (every 10 min).
 *
 * Logos / org names come from the snapshot's stellar.toml data (stellarchain.io
 * reads each issuer's toml at deploy time): many issuers' stellar.toml don't send
 * CORS headers (circle.com, ripplefox.com, …), so fetching them from the browser
 * would only produce CORS errors.
 *
 * The asset list (and fallback values) come from the build-time snapshot
 * (public/data/stellarchain-snapshot.json, scripts/fetch-market-snapshot.mjs).
 * If Horizon fails, rows fall back to that snapshot: per asset when only some
 * data is missing, or the whole table when the feed is down.
 */
import { useEffect, useRef, useState } from "react";
import { normalizeMarketAsset, num, stellarchain, type MarketAsset, type MarketSnapshot, type StorageLike } from "./stellarchain";

export const MAINNET_HORIZON = "https://horizon.stellar.org";
/** Circle's USDC issuer on Stellar mainnet (home_domain circle.com). */
export const MAINNET_USDC_ISSUER = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
export const USDC_KEY = `USDC-${MAINNET_USDC_ISSUER}`;
export const LIVE_ASSET_COUNT = 25;
export const REFRESH_MS = 30_000;
export const REQUEST_TIMEOUT_MS = 8_000;
export const MAX_CONCURRENCY = 4;
/** Per-asset candle refresh period, and how long cached candles still count as live. */
export const AGG_TTL_MS = 10 * 60_000;
export const AGG_MAX_AGE_MS = 30 * 60_000;
/** Max candle requests per tick after the first load (spreads refreshes out). */
export const AGG_PER_TICK = 3;
/** Holders / supply refresh period. */
export const ASSET_TTL_MS = 30 * 60_000;
/** Order-book mid refresh (only for assets with no trade in 24h). */
export const BOOK_TTL_MS = 10 * 60_000;
/** Max /trades pages per tick (200 trades each) before jumping to the newest trades. */
export const TRADE_PAGES = 4;
/** Delay before the single retry of a failed /trades probe. */
export const PROBE_RETRY_MS = 1_500;
/** Ignore dust trades below this many XLM and trades >50% away from the candle reference (spam / fat-finger). */
export const MIN_TRADE_XLM = 0.1;
export const MAX_TRADE_DEVIATION = 0.5;

const HOUR = 3600_000;
const DAY = 24 * HOUR;

export type AssetId = { code: string; issuer: string };
export const keyOf = (a: AssetId) => `${a.code}-${a.issuer}`;

// ---------------------------------------------------------------- raw Horizon shapes
export interface RawAgg {
  timestamp: string | number;
  trade_count: string | number;
  counter_volume: string;
  open: string;
  close: string;
  base_volume?: string;
}
export interface RawTrade {
  paging_token: string;
  ledger_close_time: string;
  base_asset_type: string;
  base_asset_code?: string;
  base_asset_issuer?: string;
  base_amount: string;
  counter_asset_type: string;
  counter_asset_code?: string;
  counter_asset_issuer?: string;
  counter_amount: string;
  price?: { n: string | number; d: string | number };
}
export interface RawHorizonAsset {
  asset_code: string;
  asset_issuer: string;
  accounts?: { authorized?: number; authorized_to_maintain_liabilities?: number; unauthorized?: number };
  balances?: { authorized?: string; authorized_to_maintain_liabilities?: string; unauthorized?: string };
  claimable_balances_amount?: string;
  liquidity_pools_amount?: string;
  contracts_amount?: string;
}
export interface RawOrderBook {
  bids: { price: string }[];
  asks: { price: string }[];
}

// ---------------------------------------------------------------- pure mapping
const pct = (from: number | null | undefined, to: number | null | undefined) => (from && to !== null && to !== undefined && Number.isFinite(from) && from > 0 ? ((to - from) / from) * 100 : null);

export interface Candle {
  t: number;
  open: number;
  close: number;
  n: number;
  xlm: number;
}
/** Keep only the candle fields we use (for the localStorage cache too). */
export function toCandles(records: RawAgg[]): Candle[] {
  return records
    .map((r) => ({ t: Number(r.timestamp), open: num(r.open) ?? NaN, close: num(r.close) ?? NaN, n: Number(r.trade_count) || 0, xlm: num(r.counter_volume) ?? 0 }))
    .filter((c) => Number.isFinite(c.t) && Number.isFinite(c.close) && c.close > 0)
    .sort((a, b) => a.t - b.t);
}

export interface PriceStats {
  price: number | null;
  priceKind: "trade" | "book" | null;
  change1h: number | null;
  change24h: number | null;
  change7d: number | null;
  volumeXlm24h: number;
  trades24h: number;
  sparkline: number[];
  lastTradeAt: number | null;
  /** true: `lastTradeAt` is an actual trade time (trade feed); false: start of the hourly candle with the last trade. */
  lastTradeExact: boolean;
}

/**
 * Hourly candles (asset vs XLM, ~7 days) + the latest live trade → row stats.
 * "Price N ago" = last traded price at or before that time, i.e. the close of the
 * latest candle that ENDED by then (open of the first candle if nothing traded before).
 * Current price = the newest of the live trade and the last candle close; if the
 * asset didn't trade in 24h, `book` (order-book mid) is used when available.
 */
export function priceStats(candles: Candle[], now = Date.now(), live?: { price: number; at: number } | null, book?: number | null): PriceStats {
  const last = candles[candles.length - 1];
  const lastClose = last?.close ?? null;
  const lastCandleAt = last ? last.t : null;
  const useLive = live && (lastCandleAt === null || live.at >= lastCandleAt);
  const traded24h = (last && last.t + HOUR > now - DAY) || (live && live.at > now - DAY);
  let price: number | null = useLive ? live!.price : lastClose;
  let priceKind: PriceStats["priceKind"] = price !== null ? "trade" : null;
  if (!traded24h && book) {
    price = book;
    priceKind = "book";
  }
  const priceAt = (t: number) => {
    let ref: number | null = null;
    for (const c of candles) {
      if (c.t + HOUR <= t) ref = c.close;
      else break;
    }
    return ref ?? candles.find((c) => c.t + HOUR > t)?.open ?? null;
  };
  const day = candles.filter((c) => c.t + HOUR > now - DAY);
  // 24 hourly points ending now, carrying the last close forward; the live price is the final point
  const sparkline: number[] = [];
  if (candles.length) {
    for (let h = 23; h >= 0; h--) {
      const v = priceAt(now - h * HOUR);
      if (v !== null) sparkline.push(v);
    }
    if (price !== null && sparkline.length) sparkline[sparkline.length - 1] = price;
  }
  const lastTradeAt = useLive ? live!.at : lastCandleAt;
  return {
    price,
    priceKind,
    change1h: traded24h && candles.length ? pct(priceAt(now - HOUR), price) : null,
    change24h: traded24h && candles.length ? pct(priceAt(now - DAY), price) : null,
    change7d: candles.length ? pct(priceAt(now - 7 * DAY), price) : null,
    volumeXlm24h: day.reduce((s, c) => s + c.xlm, 0),
    trades24h: day.reduce((s, c) => s + c.n, 0),
    sparkline,
    lastTradeAt,
    lastTradeExact: !!useLive,
  };
}

/**
 * A network-wide trade → (asset key, price in XLM per unit, XLM amount), or null
 * if it isn't a credit-asset vs native-XLM trade.
 */
export function tradeVsXlm(t: RawTrade): { key: string; price: number; xlm: number; at: number } | null {
  const at = Date.parse(t.ledger_close_time);
  const ba = num(t.base_amount);
  const ca = num(t.counter_amount);
  if (!ba || !ca || !Number.isFinite(at)) return null;
  if (t.base_asset_type === "native" && t.counter_asset_type !== "native" && t.counter_asset_code && t.counter_asset_issuer)
    return { key: `${t.counter_asset_code}-${t.counter_asset_issuer}`, price: ba / ca, xlm: ba, at };
  if (t.counter_asset_type === "native" && t.base_asset_type !== "native" && t.base_asset_code && t.base_asset_issuer)
    return { key: `${t.base_asset_code}-${t.base_asset_issuer}`, price: ca / ba, xlm: ca, at };
  return null;
}

/**
 * Latest usable trade price per tracked asset from a batch of trades (any order).
 * Skips dust (< MIN_TRADE_XLM) and prices more than MAX_TRADE_DEVIATION away from `ref` (if given).
 */
export function latestTradePrices(trades: RawTrade[], tracked: Set<string>, ref: (key: string) => number | null = () => null): Map<string, { price: number; at: number }> {
  const out = new Map<string, { price: number; at: number; tok: string }>();
  for (const t of trades) {
    const x = tradeVsXlm(t);
    if (!x || !tracked.has(x.key) || x.xlm < MIN_TRADE_XLM) continue;
    const r = ref(x.key);
    if (r && Math.abs(x.price / r - 1) > MAX_TRADE_DEVIATION) continue;
    const prev = out.get(x.key);
    if (!prev || x.at > prev.at || (x.at === prev.at && t.paging_token > prev.tok)) out.set(x.key, { price: x.price, at: x.at, tok: t.paging_token });
  }
  return new Map([...out].map(([k, v]) => [k, { price: v.price, at: v.at }]));
}

/** Order-book mid (or the only side present). */
export function bookMid(ob: RawOrderBook | null | undefined): number | null {
  const bid = num(ob?.bids?.[0]?.price);
  const ask = num(ob?.asks?.[0]?.price);
  if (bid && ask) return (bid + ask) / 2;
  return bid || ask || null;
}

/** /assets record → holders (authorized + maintain-liabilities trustlines) and circulating supply (balances + claimable + pools + contracts). */
export function assetStats(r: RawHorizonAsset | null | undefined): { holders: number | null; supply: number | null } {
  if (!r) return { holders: null, supply: null };
  const a = r.accounts;
  const holders = a ? (a.authorized ?? 0) + (a.authorized_to_maintain_liabilities ?? 0) : null;
  const parts = [r.balances?.authorized, r.balances?.authorized_to_maintain_liabilities, r.balances?.unauthorized, r.claimable_balances_amount, r.liquidity_pools_amount, r.contracts_amount].map(num);
  const supply = parts.every((p) => p === null) ? null : parts.reduce<number>((s, p) => s + (p ?? 0), 0);
  return { holders, supply };
}

// ---------------------------------------------------------------- rows
export type RowSource = "live" | "snapshot";
export interface LiveRow {
  key: string;
  code: string;
  issuer: string;
  rank: number | null;
  logo: string | null;
  orgName: string | null;
  homeDomain: string | null;
  priceXlm: number | null;
  /** "trade" = last trade, "book" = order-book mid (no trade in 24h), "snapshot" = from the saved copy. */
  priceKind: "trade" | "book" | "snapshot" | null;
  change1h: number | null;
  change24h: number | null;
  change7d: number | null;
  volumeXlm24h: number | null;
  trades24h: number | null;
  holders: number | null;
  supply: number | null;
  sparkline: number[];
  lastTradeAt: number | null;
  lastTradeExact?: boolean;
  /** Whole-row provenance. "snapshot" = no live data for this asset right now; values are from the saved copy. */
  source: RowSource;
  /** When this row's candles were fetched (live rows). */
  fetchedAt: number | null;
  /** Live row fields still showing snapshot values (marked in the UI) until Horizon /assets answers. */
  snapshotFields: "holders"[];
}

export function snapshotRow(a: MarketAsset): LiveRow {
  return {
    key: a.key,
    code: a.code,
    issuer: a.issuer,
    rank: a.rank,
    logo: a.logo,
    orgName: a.orgName,
    homeDomain: a.homeDomain,
    priceXlm: a.priceXlm,
    priceKind: a.priceXlm !== null ? "snapshot" : null,
    change1h: a.change1h,
    change24h: a.change24h,
    change7d: a.change7d,
    volumeXlm24h: a.volumeXlm24h,
    trades24h: a.trades24h,
    holders: a.trustlines,
    supply: null,
    sparkline: a.sparkline,
    lastTradeAt: null,
    source: "snapshot",
    fetchedAt: null,
    snapshotFields: [],
  };
}

/** Top `n` mainnet assets of the saved snapshot, by rank (the fixed asset list of the live feed). */
export function snapshotAssets(s: MarketSnapshot | null, n = LIVE_ASSET_COUNT): { assets: MarketAsset[]; at: string | null } {
  const e = s?.marketAssets?.mainnet;
  if (!e?.member?.length) return { assets: [], at: null };
  const all = e.member.map(normalizeMarketAsset).sort((a, b) => (a.rank ?? 1e9) - (b.rank ?? 1e9));
  return { assets: all.slice(0, n), at: e.fetchedAt ?? s?.generatedAt ?? null };
}

// ---------------------------------------------------------------- HTTP: timeout, concurrency, 429 backoff
export class HttpError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "HttpError";
  }
}

export interface FetcherOptions {
  fetch?: typeof fetch;
  timeoutMs?: number;
  concurrency?: number;
  now?: () => number;
}

/**
 * Request gate: at most N requests in flight, a per-request timeout, and a
 * cooldown per endpoint (path) after a 429. Horizon's 429s have no CORS headers,
 * so browsers can't see them; callers may also call `coolDown()` on a generic
 * network failure of a rate-limited endpoint.
 */
export class Fetcher {
  private readonly f: typeof fetch;
  readonly timeout: number;
  private readonly max: number;
  private readonly now: () => number;
  private active = 0;
  private queue: (() => void)[] = [];
  private cool = new Map<string, { until: number; hits: number }>();

  constructor(o: FetcherOptions = {}) {
    this.f = o.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
    this.timeout = o.timeoutMs ?? REQUEST_TIMEOUT_MS;
    this.max = o.concurrency ?? MAX_CONCURRENCY;
    this.now = o.now ?? Date.now;
  }

  private async slot<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.max) await new Promise<void>((r) => this.queue.push(r));
    this.active++;
    try {
      return await fn();
    } finally {
      this.active--;
      this.queue.shift()?.();
    }
  }

  static path(url: string) {
    try {
      return new URL(url).pathname;
    } catch {
      return url;
    }
  }

  /** Back off an endpoint: `ms`, or exponential from 30s up to 5 min. */
  coolDown(path: string, ms?: number) {
    const c = this.cool.get(path) ?? { until: 0, hits: 0 };
    c.hits++;
    c.until = this.now() + (ms ?? Math.min(30_000 * 2 ** (c.hits - 1), 300_000));
    this.cool.set(path, c);
  }
  coolingUntil(path: string) {
    return this.cool.get(path)?.until ?? 0;
  }
  isCooling(path: string) {
    return this.now() < this.coolingUntil(path);
  }
  /** Latest cooldown end across endpoints (0 if none). */
  get cooldownUntil() {
    return Math.max(0, ...[...this.cool.values()].map((c) => c.until));
  }
  get rateLimited() {
    return this.now() < this.cooldownUntil;
  }

  async json<T>(url: string): Promise<T> {
    const path = Fetcher.path(url);
    return this.slot(async () => {
      if (this.isCooling(path)) throw new HttpError(`rate limited on ${path} (cooling down)`, 429);
      const ctl = typeof AbortController !== "undefined" ? new AbortController() : null;
      const timer = ctl ? setTimeout(() => ctl.abort(), this.timeout) : null;
      try {
        const res = await this.f(url, { signal: ctl?.signal });
        if (res.status === 429) {
          const ra = Number(res.headers?.get?.("Retry-After") ?? res.headers?.get?.("X-RateLimit-Reset"));
          this.coolDown(path, Number.isFinite(ra) && ra > 0 ? ra * 1000 : undefined);
          throw new HttpError("Horizon rate limit (429)", 429);
        }
        if (!res.ok) throw new HttpError(`HTTP ${res.status}`, res.status);
        const body = (await res.json()) as T;
        const c = this.cool.get(path);
        if (c) c.hits = 0;
        return body;
      } catch (e) {
        if (e instanceof HttpError) throw e;
        const aborted = (e as Error)?.name === "AbortError";
        throw new HttpError(aborted ? `timeout after ${this.timeout / 1000}s` : `request failed: ${(e as Error)?.message ?? e}`);
      } finally {
        if (timer) clearTimeout(timer);
      }
    });
  }
}

const assetParams = (prefix: string, a: AssetId | "native") => {
  if (a === "native") return { [`${prefix}_asset_type`]: "native" };
  return { [`${prefix}_asset_type`]: a.code.length <= 4 ? "credit_alphanum4" : "credit_alphanum12", [`${prefix}_asset_code`]: a.code, [`${prefix}_asset_issuer`]: a.issuer };
};
const qs = (o: Record<string, string | number>) => Object.entries(o).map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join("&");

/** Hourly candles of `base` priced in `counter`, covering 7 days + 2h (≤ 170 records, one page). */
export function aggUrl(base: AssetId | "native", counter: AssetId | "native", now: number, horizonUrl = MAINNET_HORIZON) {
  const end = Math.ceil(now / HOUR) * HOUR + HOUR;
  return `${horizonUrl}/trade_aggregations?${qs({ ...assetParams("base", base), ...assetParams("counter", counter), resolution: HOUR, start_time: end - 7 * DAY - 3 * HOUR, end_time: end, limit: 200, order: "asc" })}`;
}
export function tradesUrl(cursor: string | null, horizonUrl = MAINNET_HORIZON) {
  return cursor ? `${horizonUrl}/trades?${qs({ cursor, order: "asc", limit: 200 })}` : `${horizonUrl}/trades?order=desc&limit=200`;
}
export function orderBookUrl(selling: AssetId | "native", buying: AssetId | "native", horizonUrl = MAINNET_HORIZON) {
  return `${horizonUrl}/order_book?${qs({ ...assetParams("selling", selling), ...assetParams("buying", buying), limit: 1 })}`;
}
export function assetUrl(a: AssetId, horizonUrl = MAINNET_HORIZON) {
  return `${horizonUrl}/assets?${qs({ asset_code: a.code, asset_issuer: a.issuer, limit: 1 })}`;
}

type Page<T> = { _embedded?: { records?: T[] } };
const records = <T,>(p: Page<T>) => p?._embedded?.records ?? [];

// ---------------------------------------------------------------- the feed
export type FeedMode = "loading" | "live" | "fallback";
export interface XlmUsdLive {
  price: number | null;
  change24h: number | null;
  at: number;
}
export interface FeedState {
  mode: FeedMode;
  rows: LiveRow[];
  /** Last time a live refresh succeeded (ms epoch). */
  updatedAt: number | null;
  xlmUsd: XlmUsdLive | null;
  snapshotAt: string | null;
  /** Human reason for the last failure (fallback mode) or partial data (live mode). */
  error: string | null;
  /** How many rows are currently from the snapshot. */
  snapshotRows: number;
  rateLimited: boolean;
  /** When the next refresh is scheduled (ms epoch). */
  nextAttemptAt: number | null;
}

export interface FeedOptions extends FetcherOptions {
  horizonUrl?: string;
  loadSnapshot?: () => Promise<MarketSnapshot | null>;
  count?: number;
  /** localStorage by default (candles / asset stats cache across reloads); null disables. */
  storage?: StorageLike | null;
}

interface AssetLive {
  candles?: { at: number; list: Candle[] };
  trade?: { price: number; at: number };
  book?: { price: number | null; at: number };
  stats?: { holders: number | null; supply: number | null; at: number };
}

const CACHE_PREFIX = "quasaria.live.v1:";

/**
 * One feed per Markets page. `tick()` runs one refresh; scheduling
 * (30s, visibility-aware, backoff) is done by `useLiveMarkets`.
 */
export class LiveMarketsFeed {
  readonly fetcher: Fetcher;
  private readonly horizon: string;
  private readonly loadSnap: () => Promise<MarketSnapshot | null>;
  private readonly count: number;
  private readonly now: () => number;
  private readonly storage: StorageLike | null;
  private base: MarketAsset[] = [];
  private tracked: AssetId[] = [];
  private snapAt: string | null = null;
  private live = new Map<string, AssetLive>();
  private cursor: string | null = null;
  private first = true;
  private failures = 0;
  /** Called with each intermediate state. */
  onUpdate: ((s: FeedState) => void) | null = null;
  state: FeedState = { mode: "loading", rows: [], updatedAt: null, xlmUsd: null, snapshotAt: null, error: null, snapshotRows: 0, rateLimited: false, nextAttemptAt: null };

  constructor(o: FeedOptions = {}) {
    this.fetcher = new Fetcher(o);
    this.horizon = (o.horizonUrl ?? MAINNET_HORIZON).replace(/\/$/, "");
    this.loadSnap = o.loadSnapshot ?? (() => stellarchain.loadSnapshot());
    this.count = o.count ?? LIVE_ASSET_COUNT;
    this.now = o.now ?? Date.now;
    this.storage = o.storage === undefined ? (typeof localStorage !== "undefined" ? localStorage : null) : o.storage;
  }

  /** 30s normally; after failed refreshes 30s → 60s → 120s (max). */
  nextDelay(): number {
    return this.failures ? Math.min(REFRESH_MS * 2 ** (this.failures - 1), 120_000) : REFRESH_MS;
  }

  private cacheGet<T>(k: string): T | null {
    try {
      const raw = this.storage?.getItem(CACHE_PREFIX + k);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch {
      return null;
    }
  }
  private cacheSet(k: string, v: unknown) {
    try {
      this.storage?.setItem(CACHE_PREFIX + k, JSON.stringify(v));
    } catch {
      /* quota / private mode */
    }
  }

  private async ensureBase() {
    if (this.base.length) return;
    const s = await this.loadSnap().catch(() => null);
    const { assets, at } = snapshotAssets(s, this.count);
    this.base = assets;
    this.snapAt = at;
    this.tracked = assets.map((a) => ({ code: a.code, issuer: a.issuer }));
    if (!assets.some((a) => a.key === USDC_KEY)) this.tracked.push({ code: "USDC", issuer: MAINNET_USDC_ISSUER }); // for XLM/USD
    for (const a of this.tracked) {
      const k = keyOf(a);
      const l: AssetLive = {};
      const c = this.cacheGet<{ at: number; list: Candle[] }>(`agg:${k}`);
      if (c && Array.isArray(c.list) && this.now() - c.at < AGG_MAX_AGE_MS) l.candles = c;
      const st = this.cacheGet<{ holders: number | null; supply: number | null; at: number }>(`asset:${k}`);
      if (st && this.now() - st.at < ASSET_TTL_MS) l.stats = st;
      this.live.set(k, l);
    }
  }

  private setState(p: Partial<FeedState>) {
    this.state = { ...this.state, ...p };
  }
  private emit() {
    this.onUpdate?.(this.state);
  }

  private ref(key: string) {
    const l = this.live.get(key);
    return l?.trade?.price ?? l?.candles?.list[l.candles.list.length - 1]?.close ?? null;
  }

  private stats(key: string, now: number): PriceStats | null {
    const l = this.live.get(key);
    if (!l?.candles || now - l.candles.at > AGG_MAX_AGE_MS) return null;
    return priceStats(l.candles.list, now, l.trade, l.book?.price);
  }

  private buildRows(mode: FeedMode, now: number): LiveRow[] {
    return this.base.map((a) => {
      const snap = snapshotRow(a);
      if (mode !== "live") return snap;
      const l = this.live.get(a.key);
      const s = this.stats(a.key, now);
      if (!l || !s || s.price === null) return snap; // per-asset fallback
      return {
        ...snap,
        source: "live",
        fetchedAt: l.candles!.at,
        priceXlm: s.price,
        priceKind: s.priceKind,
        change1h: s.change1h,
        change24h: s.change24h,
        change7d: s.change7d,
        volumeXlm24h: s.volumeXlm24h,
        trades24h: s.trades24h,
        sparkline: s.sparkline,
        lastTradeAt: s.lastTradeAt,
        lastTradeExact: s.lastTradeExact,
        holders: l.stats ? l.stats.holders : snap.holders,
        supply: l.stats?.supply ?? null,
        snapshotFields: l.stats ? [] : ["holders"],
      };
    });
  }

  private xlmUsd(now: number): XlmUsdLive | null {
    const s = this.stats(USDC_KEY, now);
    if (!s?.price) return null;
    const inv = (x: number | null) => (x === null ? null : (100 / (1 + x / 100) - 100)); // change of 1/p
    return { price: 1 / s.price, change24h: inv(s.change24h), at: now };
  }

  /** Whole-table fallback to the saved snapshot. */
  private fallback(error: string, now: number) {
    this.failures++;
    const rows = this.buildRows("fallback", now);
    this.setState({ mode: "fallback", error, rows, snapshotAt: this.snapAt, snapshotRows: rows.length, rateLimited: this.fetcher.rateLimited, nextAttemptAt: now + this.nextDelay() });
    this.emit();
    return this.state;
  }

  /** Fast tier: page through network-wide trades since the last cursor. */
  private async pollTrades() {
    const set = new Set(this.tracked.map(keyOf));
    const get = async (url: string) => {
      try {
        return await this.fetcher.json<Page<RawTrade>>(url);
      } catch (e) {
        const he = e as HttpError;
        if (he.status === 429 || /timeout|cooling/.test(he.message)) throw e;
        await new Promise((r) => setTimeout(r, PROBE_RETRY_MS)); // one retry for transient errors
        return await this.fetcher.json<Page<RawTrade>>(url);
      }
    };
    const apply = (rs: RawTrade[]) => {
      for (const [k, v] of latestTradePrices(rs, set, (key) => this.ref(key))) {
        const l = this.live.get(k)!;
        if (!l.trade || v.at >= l.trade.at) l.trade = v;
      }
    };
    if (this.cursor) {
      for (let i = 0; i < TRADE_PAGES; i++) {
        const rs: RawTrade[] = records(await get(tradesUrl(this.cursor, this.horizon)));
        apply(rs);
        if (rs.length) this.cursor = rs[rs.length - 1].paging_token;
        if (rs.length < 200) return;
      }
      // too far behind: jump to the newest trades
    }
    const rs: RawTrade[] = records(await get(tradesUrl(null, this.horizon)));
    apply(rs);
    if (rs.length) this.cursor = rs[0].paging_token;
  }

  async tick(): Promise<FeedState> {
    const now = this.now();
    await this.ensureBase();
    this.setState({ snapshotAt: this.snapAt });
    if (!this.base.length) return this.fallback("saved snapshot missing (no asset list)", now);

    // 1) fast tier = liveness probe. If Horizon is unreachable, stop here (no burst of doomed requests).
    try {
      await this.pollTrades();
    } catch (e) {
      return this.fallback((e as Error).message, now);
    }

    // 2) candles: all missing ones on first load, then the stalest few per tick
    const AGG = "/trade_aggregations";
    let aggFailed = 0;
    if (!this.fetcher.isCooling(AGG)) {
      const due = this.tracked
        .map((a) => ({ a, l: this.live.get(keyOf(a))! }))
        .filter(({ l }) => !l.candles || now - l.candles.at >= AGG_TTL_MS)
        .sort((x, y) => (x.l.candles?.at ?? 0) - (y.l.candles?.at ?? 0));
      const batch = this.first ? due : due.slice(0, AGG_PER_TICK);
      await Promise.all(
        batch.map(async ({ a, l }) => {
          if (this.fetcher.isCooling(AGG)) return;
          try {
            const list = toCandles(records(await this.fetcher.json<Page<RawAgg>>(aggUrl(a, "native", now, this.horizon))));
            l.candles = { at: now, list };
            this.cacheSet(`agg:${keyOf(a)}`, l.candles);
          } catch (e) {
            aggFailed++;
            // 429s arrive without CORS headers (= "Failed to fetch"): back the whole endpoint off
            if (!this.fetcher.isCooling(AGG)) this.fetcher.coolDown(AGG, (e as HttpError).status === 429 ? undefined : 60_000);
          }
        }),
      );
    }
    this.first = false;

    const rows = this.buildRows("live", now);
    const liveRows = rows.filter((r) => r.source === "live").length;
    if (!liveRows) return this.fallback(aggFailed ? "Horizon trade history unavailable (likely rate-limited)" : "no live data", now);
    this.failures = 0;
    const missing = rows.length - liveRows;
    this.setState({ mode: "live", rows, updatedAt: now, xlmUsd: this.xlmUsd(now), error: missing ? `${missing} of ${rows.length} assets have no live data right now` : null, snapshotRows: missing, rateLimited: this.fetcher.rateLimited });
    this.emit();

    // 3) slow tier: holders/supply (30 min) and order-book mids for assets without a trade in 24h (10 min)
    const slow: Promise<unknown>[] = [];
    for (const a of this.base) {
      const l = this.live.get(a.key)!;
      if (!this.fetcher.isCooling("/assets") && (!l.stats || now - l.stats.at >= ASSET_TTL_MS))
        slow.push(
          this.fetcher
            .json<Page<RawHorizonAsset>>(assetUrl(a, this.horizon))
            .then((p) => {
              l.stats = { ...assetStats(records(p)[0]), at: now };
              this.cacheSet(`asset:${a.key}`, l.stats);
            })
            .catch(() => void 0),
        );
      const s = this.stats(a.key, now);
      const quiet = s && s.lastTradeAt !== null ? s.lastTradeAt < now - DAY : !!l.candles;
      if (quiet && (!l.book || now - l.book.at >= BOOK_TTL_MS) && !this.fetcher.isCooling("/order_book"))
        slow.push(
          this.fetcher
            .json<RawOrderBook>(orderBookUrl(a, "native", this.horizon))
            .then((ob) => void (l.book = { price: bookMid(ob), at: now }))
            .catch(() => void 0),
        );
    }
    if (slow.length) {
      await Promise.all(slow);
      const rows2 = this.buildRows("live", now);
      const miss2 = rows2.filter((r) => r.source === "snapshot").length;
      this.setState({ rows: rows2, snapshotRows: miss2, error: miss2 ? `${miss2} of ${rows2.length} assets have no live data right now` : null });
      this.emit();
    }
    this.setState({ nextAttemptAt: this.now() + this.nextDelay() });
    return this.state;
  }
}

// ---------------------------------------------------------------- shared XLM/USD (header ticker + Markets card)
type XlmListener = (v: XlmUsdLive) => void;
let lastXlm: XlmUsdLive | null = null;
const xlmListeners = new Set<XlmListener>();
export function publishXlmUsd(v: XlmUsdLive) {
  if (v.price === null) return;
  lastXlm = v;
  xlmListeners.forEach((l) => l(v));
}
export function latestXlmUsd() {
  return lastXlm;
}
export function subscribeXlmUsd(l: XlmListener) {
  xlmListeners.add(l);
  return () => void xlmListeners.delete(l);
}

/** XLM/USD straight from mainnet Horizon: XLM/USDC (Circle) order-book mid (cheap; not the rate-limited candles endpoint). */
export async function fetchXlmUsd(f: Fetcher = new Fetcher(), now = Date.now(), horizonUrl = MAINNET_HORIZON): Promise<XlmUsdLive> {
  const mid = bookMid(await f.json<RawOrderBook>(orderBookUrl("native", { code: "USDC", issuer: MAINNET_USDC_ISSUER }, horizonUrl)));
  if (mid === null) throw new HttpError("empty XLM/USDC order book");
  return { price: mid, change24h: null, at: now };
}

const visible = () => typeof document === "undefined" || document.visibilityState !== "hidden";

/**
 * Live XLM/USD for the header ticker: shares the Markets feed's value when it
 * is fresh, otherwise polls Horizon itself (every `refreshMs`, visible tabs only).
 * Returns null until the first value; callers fall back to their old source.
 */
export function useLiveXlmUsd(refreshMs = 5 * 60_000, disabled = false): XlmUsdLive | null {
  const [v, setV] = useState<XlmUsdLive | null>(lastXlm);
  useEffect(() => {
    if (disabled) return;
    let alive = true;
    const unsub = subscribeXlmUsd((x) => alive && setV(x));
    const f = new Fetcher();
    const go = () => {
      if (!visible()) return;
      if (lastXlm && Date.now() - lastXlm.at < Math.min(refreshMs, 60_000)) return setV(lastXlm);
      fetchXlmUsd(f).then((x) => alive && publishXlmUsd(x)).catch(() => void 0);
    };
    go();
    const t = setInterval(go, refreshMs);
    const onVis = () => visible() && go();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      alive = false;
      unsub();
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [refreshMs, disabled]);
  return v;
}

/**
 * Markets page hook: tick on mount, then every ~30s while the tab is visible
 * (paused when hidden, immediate refresh when it becomes visible again),
 * with backoff after failures / 429s.
 */
export function useLiveMarkets(opts: { disabled?: boolean; feed?: LiveMarketsFeed } = {}): FeedState & { now: number } {
  const feedRef = useRef<LiveMarketsFeed | null>(null);
  if (!feedRef.current) feedRef.current = opts.feed ?? new LiveMarketsFeed();
  const [state, setState] = useState<FeedState>(feedRef.current.state);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (opts.disabled) return;
    const feed = feedRef.current!;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let running = false;
    feed.onUpdate = (s) => {
      if (!alive) return;
      setState(s);
      if (s.mode === "live" && s.xlmUsd) publishXlmUsd(s.xlmUsd);
    };
    const schedule = (ms: number) => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(run, ms);
    };
    const run = async () => {
      timer = null;
      if (!alive || running) return;
      if (!visible()) return; // paused; visibilitychange restarts
      running = true;
      try {
        await feed.tick();
      } finally {
        running = false;
      }
      if (alive) schedule(feed.nextDelay());
    };
    const onVis = () => {
      if (!visible()) {
        if (timer) clearTimeout(timer);
        timer = null;
      } else if (!running) {
        const last = feed.state.updatedAt ?? 0;
        schedule(Math.max(0, Math.min(feed.nextDelay(), REFRESH_MS - (Date.now() - last))));
      }
    };
    document.addEventListener("visibilitychange", onVis);
    void run();
    const clock = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      alive = false;
      feed.onUpdate = null;
      if (timer) clearTimeout(timer);
      clearInterval(clock);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [opts.disabled]);
  return { ...state, now };
}

/** "HH:MM:SS" (24h, local time). */
export function hms(ms: number | null | undefined): string {
  if (!ms) return "--:--:--";
  const d = new Date(ms);
  return [d.getHours(), d.getMinutes(), d.getSeconds()].map((x) => String(x).padStart(2, "0")).join(":");
}
