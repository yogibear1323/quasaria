/**
 * Typed client for the public stellarchain.io API (https://api.stellarchain.io/v1).
 *
 * DISPLAY DATA ONLY: prices, ranks, logos and org names for discovery UIs.
 * Trading, order books and settlement always go through Horizon / Soroban RPC.
 *
 * - No API key. Requests MUST send `Accept: application/ld+json`
 *   (plain application/json returns 406). Responses are Hydra collections
 *   with a `member` array.
 * - Snapshots can be stale, so every normalized value keeps its `updatedAt`
 *   and callers should check `isStale()` and fall back to Horizon.
 * - Responses are cached in memory (and localStorage when available) for
 *   `ttlMs` (the API itself sends `cache-control: max-age=300`).
 */

export const STELLARCHAIN_BASE = "https://api.stellarchain.io/v1";
export const STELLARCHAIN_ATTRIBUTION = "Market data: stellarchain.io";
const STROOPS = 10_000_000;

export type ScNetwork = "mainnet" | "testnet";

export interface HydraCollection<T> {
  "@id"?: string;
  totalItems?: number;
  member: T[];
}

// ---- raw API shapes (only the fields we use)
export interface RawOverview {
  xlmPriceUsd: string | null;
  xlmVolume24h: string | null;
  totalTrades24h: string | number | null;
  activeAssets24h: number | null;
  trackedAssets: number | null;
  totalAccounts: number | null;
  totalContracts: number | null;
  recordedAt: string;
}
export interface RawToml {
  image?: string;
  home_domain?: string;
  desc?: string;
  documentation?: { ORG_NAME?: string; ORG_LOGO?: string; ORG_URL?: string };
}
export interface RawMarketAsset {
  assetKey: string;
  code: string;
  issuer: string;
  network: number;
  rankPosition: number | null;
  priceXlm: string | null;
  priceChange1h: string | null;
  priceChange24h: string | null;
  priceChange7d: string | null;
  volumeXlm24h: string | null;
  trades24h: number | null;
  trustlinesTotal: number | null;
  supply: string | null;
  sparkline1h: (string | number | null)[] | null;
  updatedAt: string;
  tomlInfo?: RawToml | null;
  imageUrl?: string | null;
  homeDomain?: string | null;
}
export interface RawAssetStatistic {
  price: string | null;
  supply: string | null;
  trades: number | null;
  tradedAmount: number | null;
  trustlinesTotal: number | null;
  recordedAt: string;
}
export interface RawProject {
  id: number;
  name: string;
  website?: string | null;
  github?: string | null;
  description?: string | null;
  category?: string | null;
  sourceUrl?: string | null;
  updatedAt?: string | null;
}

// ---- normalized shapes
export interface MarketOverview {
  xlmPriceUsd: number | null;
  xlmVolume24h: number | null;
  trades24h: number | null;
  activeAssets24h: number | null;
  trackedAssets: number | null;
  totalAccounts: number | null;
  totalContracts: number | null;
  updatedAt: string;
}
export interface MarketAsset {
  key: string;
  code: string;
  issuer: string;
  network: ScNetwork;
  rank: number | null;
  priceXlm: number | null;
  change1h: number | null;
  change24h: number | null;
  change7d: number | null;
  /** 24h volume in XLM (the API reports stroops; converted here). */
  volumeXlm24h: number | null;
  trades24h: number | null;
  trustlines: number | null;
  sparkline: number[];
  logo: string | null;
  orgName: string | null;
  homeDomain: string | null;
  updatedAt: string;
}

export const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

const httpsOnly = (u?: string | null) => (u && /^https:\/\//i.test(u) ? u : null);

export function normalizeOverview(r: RawOverview): MarketOverview {
  return {
    xlmPriceUsd: num(r.xlmPriceUsd),
    xlmVolume24h: num(r.xlmVolume24h),
    trades24h: num(r.totalTrades24h),
    activeAssets24h: num(r.activeAssets24h),
    trackedAssets: num(r.trackedAssets),
    totalAccounts: num(r.totalAccounts),
    totalContracts: num(r.totalContracts),
    updatedAt: r.recordedAt,
  };
}

export function normalizeMarketAsset(r: RawMarketAsset): MarketAsset {
  const vol = num(r.volumeXlm24h);
  return {
    key: r.assetKey,
    code: r.code,
    issuer: r.issuer,
    network: r.network === 2 ? "testnet" : "mainnet",
    rank: num(r.rankPosition),
    priceXlm: num(r.priceXlm),
    change1h: num(r.priceChange1h),
    change24h: num(r.priceChange24h),
    change7d: num(r.priceChange7d),
    volumeXlm24h: vol === null ? null : vol / STROOPS,
    trades24h: num(r.trades24h),
    trustlines: num(r.trustlinesTotal),
    sparkline: (r.sparkline1h ?? []).map(num).filter((x): x is number => x !== null),
    logo: httpsOnly(r.imageUrl ?? r.tomlInfo?.image ?? r.tomlInfo?.documentation?.ORG_LOGO),
    orgName: r.tomlInfo?.documentation?.ORG_NAME ?? null,
    homeDomain: r.homeDomain ?? r.tomlInfo?.home_domain ?? null,
    updatedAt: r.updatedAt,
  };
}

/** True when `updatedAt` is missing/invalid or older than `maxAgeMs`. */
export function isStale(updatedAt: string | null | undefined, maxAgeMs: number, now = Date.now()): boolean {
  if (!updatedAt) return true;
  const t = Date.parse(updatedAt);
  return !Number.isFinite(t) || now - t > maxAgeMs;
}

/** Human "as of" label, e.g. "3 min ago" / "14 days ago". */
export function asOf(updatedAt: string, now = Date.now()): string {
  const s = Math.max(0, (now - Date.parse(updatedAt)) / 1000);
  if (!Number.isFinite(s)) return "unknown";
  if (s < 90) return "just now";
  if (s < 5400) return `${Math.round(s / 60)} min ago`;
  if (s < 172_800) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86_400)} days ago`;
}

export interface StorageLike {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
}

export interface ClientOptions {
  baseUrl?: string;
  fetch?: typeof fetch;
  ttlMs?: number;
  timeoutMs?: number;
  storage?: StorageLike | null;
  now?: () => number;
}

export class StellarchainError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "StellarchainError";
  }
}

export class StellarchainClient {
  private readonly base: string;
  private readonly f: typeof fetch;
  private readonly ttl: number;
  private readonly timeout: number;
  private readonly storage: StorageLike | null;
  private readonly now: () => number;
  private readonly mem = new Map<string, { at: number; data: unknown }>();
  private readonly inflight = new Map<string, Promise<unknown>>();

  constructor(o: ClientOptions = {}) {
    this.base = (o.baseUrl ?? STELLARCHAIN_BASE).replace(/\/$/, "");
    this.f = o.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
    this.ttl = o.ttlMs ?? 5 * 60_000;
    this.timeout = o.timeoutMs ?? 8_000;
    this.storage = o.storage === undefined ? (typeof localStorage !== "undefined" ? localStorage : null) : o.storage;
    this.now = o.now ?? Date.now;
  }

  /** GET a path (relative to /v1) with the required JSON-LD Accept header, cached. */
  async get<T>(path: string, query: Record<string, string | number | undefined> = {}): Promise<T> {
    const qs = Object.entries(query).filter(([, v]) => v !== undefined && v !== "").map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join("&");
    const url = `${this.base}${path}${qs ? `?${qs}` : ""}`;
    const key = `quasaria.sc:${url}`;
    const hit = this.mem.get(key) ?? this.readStorage(key);
    if (hit && this.now() - hit.at < this.ttl) return hit.data as T;
    const pending = this.inflight.get(key);
    if (pending) return pending as Promise<T>;
    const p = this.fetchJson<T>(url)
      .then((data) => {
        const entry = { at: this.now(), data };
        this.mem.set(key, entry);
        try {
          this.storage?.setItem(key, JSON.stringify(entry));
        } catch {
          /* quota / private mode */
        }
        return data;
      })
      .catch((e) => {
        // serve an expired cache entry rather than nothing
        if (hit) return hit.data as T;
        throw e;
      })
      .finally(() => this.inflight.delete(key));
    this.inflight.set(key, p);
    return p;
  }

  private readStorage(key: string) {
    try {
      const raw = this.storage?.getItem(key);
      if (!raw) return undefined;
      const e = JSON.parse(raw) as { at: number; data: unknown };
      this.mem.set(key, e);
      return e;
    } catch {
      return undefined;
    }
  }

  private async fetchJson<T>(url: string): Promise<T> {
    const ctl = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timer = ctl ? setTimeout(() => ctl.abort(), this.timeout) : null;
    try {
      const res = await this.f(url, { headers: { Accept: "application/ld+json" }, signal: ctl?.signal });
      if (!res.ok) throw new StellarchainError(`stellarchain ${res.status} for ${url}`, res.status);
      return (await res.json()) as T;
    } catch (e) {
      if (e instanceof StellarchainError) throw e;
      throw new StellarchainError(`stellarchain request failed: ${(e as Error).message}`);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async overview(network: ScNetwork = "mainnet"): Promise<MarketOverview | null> {
    const c = await this.get<HydraCollection<RawOverview>>("/market/overview", { network, "order[recordedAt]": "desc" });
    return c.member[0] ? normalizeOverview(c.member[0]) : null;
  }

  async marketAssets(o: { network?: ScNetwork; itemsPerPage?: number; page?: number; search?: string } = {}): Promise<{ total: number; assets: MarketAsset[] }> {
    const c = await this.get<HydraCollection<RawMarketAsset>>("/market/assets", { network: o.network ?? "mainnet", itemsPerPage: o.itemsPerPage ?? 25, page: o.page, search: o.search });
    const assets = c.member.map(normalizeMarketAsset).sort((a, b) => (a.rank ?? 1e9) - (b.rank ?? 1e9));
    return { total: c.totalItems ?? assets.length, assets };
  }

  async asset(assetKey: string, network: ScNetwork = "mainnet") {
    return this.get<{ assetKey: string; code: string; issuer: string; tomlInfo?: RawToml; ratingAverage?: string; updatedAt: string }>(`/assets/${encodeURIComponent(assetKey)}`, { network });
  }

  async assetStatistics(assetKey: string, network: ScNetwork = "mainnet"): Promise<RawAssetStatistic[]> {
    const c = await this.get<HydraCollection<RawAssetStatistic>>(`/assets/${encodeURIComponent(assetKey)}/statistics`, { network });
    return c.member;
  }

  async projects(o: { itemsPerPage?: number; name?: string } = {}): Promise<RawProject[]> {
    const c = await this.get<HydraCollection<RawProject>>("/projects", { itemsPerPage: o.itemsPerPage ?? 20, name: o.name });
    return c.member;
  }
}

/** Shared browser instance. */
export const stellarchain = new StellarchainClient();
