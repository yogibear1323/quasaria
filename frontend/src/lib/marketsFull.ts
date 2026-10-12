/**
 * Markets tab: the full mainnet list (top 1,000) from public/data/markets-mainnet.json
 * (written at build / every 30-min refresh by scripts/fetch-market-snapshot.mjs; the
 * browser never calls stellarchain.io), sorting, paging, search beyond the list
 * (stellar.expert + Horizon, both CORS-enabled) and the per-asset About data.
 */
import { MARKETS_FULL_URL, normalizeMarketAsset, type MarketAsset, type RawMarketAsset } from "./stellarchain";
import type { LiveRow } from "./liveMarkets";

export const PAGE_SIZE = 100;
export const MAX_PAGES = 10;

export type FullList = { at: string | null; assets: MarketAsset[]; raw: Map<string, RawMarketAsset>; sources?: { stellarchain?: number; stellarExpert?: number } };
let fullP: Promise<FullList | null> | null = null;
export function loadFullList(url = MARKETS_FULL_URL, f: typeof fetch = fetch): Promise<FullList | null> {
  if (!fullP)
    fullP = f(url, { headers: { Accept: "application/json" } })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { generatedAt?: string; fetchedAt?: string; member?: RawMarketAsset[]; sources?: FullList["sources"] } | null) => {
        if (!j?.member?.length) return null;
        const raw = new Map<string, RawMarketAsset>();
        const assets = j.member.filter((m) => typeof m.issuer === "string" && !!m.issuer).map((m) => { const a = normalizeMarketAsset(m); raw.set(a.key, m); return a; }).sort((a, b) => (a.rank ?? 1e9) - (b.rank ?? 1e9));
        return { at: j.fetchedAt ?? j.generatedAt ?? null, assets, raw, sources: j.sources };
      })
      .catch(() => null);
  return fullP;
}
export function _resetFullList() { fullP = null; }

export type SortKey = "rank" | "code" | "price" | "change24h" | "change7d" | "volume" | "trades" | "holders";
const val = (r: LiveRow, k: SortKey): number | string | null =>
  k === "rank" ? r.rank : k === "code" ? r.code.toLowerCase() : k === "price" ? r.priceXlm : k === "change24h" ? r.change24h : k === "change7d" ? r.change7d : k === "volume" ? r.volumeXlm24h : k === "trades" ? r.trades24h : r.holders;
/** Stable sort; missing values always last regardless of direction. */
export function sortRows(rows: LiveRow[], k: SortKey, dir: "asc" | "desc"): LiveRow[] {
  const m = dir === "asc" ? 1 : -1;
  return rows.map((r, i) => [r, i] as const).sort(([a, ia], [b, ib]) => {
    const x = val(a, k), y = val(b, k);
    if (x === null && y === null) return ia - ib;
    if (x === null) return 1;
    if (y === null) return -1;
    const c = typeof x === "string" ? x.localeCompare(String(y)) : (x as number) - (y as number);
    return c !== 0 ? c * m : ia - ib;
  }).map(([r]) => r);
}
export function filterRows(rows: LiveRow[], q: string): LiveRow[] {
  const s = q.trim().toLowerCase();
  if (!s) return rows;
  return rows.filter((r) => [r.code, r.issuer, r.key, r.orgName ?? "", r.homeDomain ?? ""].some((f) => f.toLowerCase().includes(s)));
}
export function pageCount(n: number, size = PAGE_SIZE) { return Math.max(1, Math.min(MAX_PAGES, Math.ceil(n / size))); }
export function clampPage(p: number, n: number) { return Number.isFinite(p) ? Math.min(Math.max(1, Math.floor(p)), pageCount(n)) : 1; }

// ---------------------------------------------------------------- search beyond the list
export type BeyondHit = { key: string; code: string; issuer: string; homeDomain: string | null; holders: number | null; source: "stellar.expert" | "Horizon" };
const EXPERT = "https://api.stellar.expert/explorer/public";
const HORIZON = "https://horizon.stellar.org";
/** Any Stellar asset by code, domain or issuer: stellar.expert search, plus Horizon /assets for an exact code or a G… issuer. */
export async function searchBeyond(q: string, exclude: Set<string>, f: typeof fetch = fetch): Promise<BeyondHit[]> {
  const s = q.trim();
  if (s.length < 2) return [];
  const out = new Map<string, BeyondHit>();
  const add = (h: BeyondHit) => { if (!exclude.has(h.key) && !out.has(h.key)) out.set(h.key, h); };
  const tasks: Promise<void>[] = [];
  tasks.push(f(`${EXPERT}/asset?search=${encodeURIComponent(s)}&sort=rating&order=desc&limit=20`).then((r) => (r.ok ? r.json() : null)).then((j) => {
    for (const r of j?._embedded?.records ?? []) {
      if (typeof r.asset !== "string" || !r.asset.includes("-")) continue;
      const [code, issuer] = r.asset.split("-");
      add({ key: `${code}-${issuer}`, code, issuer, homeDomain: r.domain ?? null, holders: r.trustlines?.total ?? null, source: "stellar.expert" });
    }
  }).catch(() => void 0));
  const isIssuer = /^G[A-Z2-7]{55}$/.test(s);
  if (isIssuer || /^[A-Za-z0-9]{1,12}$/.test(s)) {
    const qs = isIssuer ? `asset_issuer=${s}` : `asset_code=${encodeURIComponent(s)}`;
    tasks.push(f(`${HORIZON}/assets?${qs}&limit=50`).then((r) => (r.ok ? r.json() : null)).then((j) => {
      const recs = (j?._embedded?.records ?? []) as { asset_code: string; asset_issuer: string; accounts?: { authorized?: number } }[];
      recs.sort((a, b) => (b.accounts?.authorized ?? 0) - (a.accounts?.authorized ?? 0));
      for (const r of recs.slice(0, 20)) add({ key: `${r.asset_code}-${r.asset_issuer}`, code: r.asset_code, issuer: r.asset_issuer, homeDomain: null, holders: r.accounts?.authorized ?? null, source: "Horizon" });
    }).catch(() => void 0));
  }
  await Promise.all(tasks);
  return [...out.values()].slice(0, 25);
}

// ---------------------------------------------------------------- About (SEP-1 stellar.toml + Horizon facts)
export type TomlCurrency = Record<string, string | boolean | number>;
/** Minimal SEP-1 reader: the [[CURRENCIES]] tables and [DOCUMENTATION] (strings, booleans, numbers, """multi-line"""). */
export function parseTomlCurrencies(text: string): { currencies: TomlCurrency[]; documentation: TomlCurrency } {
  const currencies: TomlCurrency[] = [];
  const documentation: TomlCurrency = {};
  let cur: TomlCurrency | null = null;
  const lines = text.replace(/\r/g, "").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith("#")) continue;
    if (/^\[\[\s*CURRENCIES\s*\]\]$/.test(line)) { cur = {}; currencies.push(cur); continue; }
    if (/^\[\s*DOCUMENTATION\s*\]$/.test(line)) { cur = documentation; continue; }
    if (line.startsWith("[")) { cur = null; continue; }
    if (!cur) continue;
    const m = line.match(/^([A-Za-z0-9_]+)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if (v.startsWith('"""')) {
      let body = v.slice(3);
      while (!body.includes('"""') && i + 1 < lines.length) body += "\n" + lines[++i];
      cur[m[1]] = body.slice(0, body.indexOf('"""')).trim();
    } else if (v.startsWith('"')) {
      const end = v.lastIndexOf('"');
      cur[m[1]] = v.slice(1, end > 0 ? end : undefined).replace(/\\"/g, '"').replace(/\\n/g, "\n");
    } else if (v.startsWith("'")) {
      cur[m[1]] = v.slice(1, v.lastIndexOf("'"));
    } else {
      v = v.replace(/\s+#.*$/, "");
      cur[m[1]] = v === "true" ? true : v === "false" ? false : Number.isFinite(Number(v)) ? Number(v) : v;
    }
  }
  return { currencies, documentation };
}

export type AboutData = {
  code: string; issuer: string; homeDomain: string | null;
  currency: TomlCurrency | null; orgName: string | null; tomlUrl: string | null; tomlError: string | null;
  horizon: { holders: number | null; supply: number | null; flags: { auth_required?: boolean; auth_revocable?: boolean; auth_immutable?: boolean; auth_clawback_enabled?: boolean } | null; contract: string | null } | null;
  snapshotDesc: string | null;
};
const aboutCache = new Map<string, Promise<AboutData>>();
const SS = "quasaria.about.v1:";
const timeoutFetch = (f: typeof fetch, url: string, ms = 8000) => {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  return f(url, { signal: c.signal }).finally(() => clearTimeout(t));
};
/** Lazy, cached per asset (memory + sessionStorage). Nothing is invented: every field is the issuer's or Horizon's. */
export function loadAbout(a: { code: string; issuer: string; homeDomain: string | null; snapshotDesc?: string | null }, f: typeof fetch = fetch): Promise<AboutData> {
  const key = `${a.code}-${a.issuer}`;
  const hit = aboutCache.get(key);
  if (hit) return hit;
  try {
    const s = sessionStorage.getItem(SS + key);
    if (s) { const p = Promise.resolve(JSON.parse(s) as AboutData); aboutCache.set(key, p); return p; }
  } catch { /* private mode */ }
  const p = (async (): Promise<AboutData> => {
    const out: AboutData = { code: a.code, issuer: a.issuer, homeDomain: a.homeDomain, currency: null, orgName: null, tomlUrl: null, tomlError: null, horizon: null, snapshotDesc: a.snapshotDesc ?? null };
    const hz = timeoutFetch(f, `${HORIZON}/assets?asset_code=${encodeURIComponent(a.code)}&asset_issuer=${a.issuer}`).then((r) => (r.ok ? r.json() : null)).then((j) => {
      const r = j?._embedded?.records?.[0];
      if (!r) return;
      out.horizon = { holders: r.accounts?.authorized ?? null, supply: r.balances?.authorized != null ? Number(r.balances.authorized) : null, flags: r.flags ?? null, contract: r.contract_id ?? null };
      if (!out.homeDomain) out.homeDomain = null;
    }).catch(() => void 0);
    let domain = a.homeDomain;
    if (!domain) {
      // the issuer account's home_domain (on-chain)
      domain = await timeoutFetch(f, `${HORIZON}/accounts/${a.issuer}`).then((r) => (r.ok ? r.json() : null)).then((j) => j?.home_domain ?? null).catch(() => null);
      out.homeDomain = domain;
    }
    if (domain && /^[a-z0-9.-]+$/i.test(domain)) {
      out.tomlUrl = `https://${domain}/.well-known/stellar.toml`;
      try {
        const r = await timeoutFetch(f, out.tomlUrl);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const t = parseTomlCurrencies(await r.text());
        out.currency = t.currencies.find((c) => c.code === a.code && c.issuer === a.issuer) ?? null;
        out.orgName = typeof t.documentation.ORG_NAME === "string" ? t.documentation.ORG_NAME : null;
        if (!out.currency) out.tomlError = "this asset isn't listed in the issuer's stellar.toml";
      } catch (e) {
        out.tomlError = `couldn't read stellar.toml from the browser (${(e as Error).name === "AbortError" ? "timeout" : "blocked or unavailable"})`;
      }
    } else out.tomlError = "the issuer account has no home domain";
    await hz;
    try { sessionStorage.setItem(SS + key, JSON.stringify(out)); } catch { /* quota */ }
    return out;
  })();
  aboutCache.set(key, p);
  return p;
}
