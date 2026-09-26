/**
 * Stablecoin discovery for auto-generated XLM/stablecoin pairs.
 *
 * Shared by the frontend (imported by Vite) and the Node scripts (run directly
 * with Node >= 22.18 type stripping). Keep this file dependency-free and use
 * only erasable TypeScript syntax (no enums / parameter properties).
 *
 * Pipeline: page through the stellarchain.io market feed → pick assets whose
 * stellar.toml marks them fiat-anchored (or anchored to a major stablecoin) →
 * drop yield / wrapped variants → safety filters (holders, recent trades,
 * home domain, deny rules, brand / impostor checks) → verify the issuer by
 * fetching the home domain's stellar.toml and matching a CURRENCIES entry →
 * flag duplicate codes and mark the most-held verified issuer as primary.
 *
 * The output is DISPLAY / CONFIG data. Verification proves the issuer is
 * claimed by its home domain — it does not prove the domain is trustworthy,
 * which is why the brand and deny rules exist. Always review the list.
 */

export type FetchLike = (url: string, init?: { headers?: Record<string, string>; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; text(): Promise<string>; json(): Promise<unknown> }>;

export interface FeedToml {
  code?: string;
  issuer?: string;
  desc?: string;
  anchor_asset?: string;
  anchor_asset_type?: string;
  is_asset_anchored?: boolean;
  home_domain?: string;
  toml_url?: string;
  image?: string;
  documentation?: { ORG_NAME?: string; ORG_URL?: string; ORG_LOGO?: string };
}

export interface FeedAsset {
  assetKey: string;
  code: string;
  issuer: string;
  network?: number;
  rankPosition?: number | null;
  trustlinesTotal?: number | null;
  trades24h?: number | null;
  volumeXlm24h?: string | null;
  priceXlm?: string | null;
  updatedAt?: string;
  homeDomain?: string | null;
  imageUrl?: string | null;
  tomlInfo?: FeedToml | null;
}

export interface StablecoinConfig {
  network: "mainnet" | "testnet";
  minTrustlines: number;
  minTrades24h: number;
  itemsPerPage: number;
  maxPages: number;
  /** Fetch each home domain's stellar.toml to verify code+issuer. */
  verifyToml: boolean;
  /** "CODE:ISSUER", "CODE@domain" or "@domain" — force-include (still verified). */
  allow: string[];
  /** Same formats — always reject. */
  deny: string[];
  /** Substrings that mark a home domain as a scam / impostor. */
  denyDomainPatterns: string[];
  /**
   * Official home domains for brand-name stablecoins. An asset using one of
   * these codes from any other domain is rejected as an impostor. An empty
   * list means the brand has no official Stellar issuer (e.g. Tether USDT).
   */
  brandDomains: Record<string, string[]>;
}

export const FIAT_CODES = new Set([
  "USD", "EUR", "GBP", "JPY", "CHF", "AUD", "CAD", "NZD", "CNY", "HKD", "SGD", "KRW", "INR", "IDR", "PHP", "THB", "VND", "MYR",
  "BRL", "ARS", "CLP", "COP", "PEN", "MXN", "UYU", "NGN", "ZAR", "KES", "GHS", "UGX", "TZS", "XOF", "XAF", "EGP", "MAD", "TRY",
  "PLN", "CZK", "HUF", "RON", "SEK", "NOK", "DKK", "UAH", "RUB", "ILS", "AED", "SAR", "PKR", "BDT", "LKR", "TWD",
]);
/** Major fiat-backed stablecoins that count as a peg target. */
export const MAJOR_STABLES: Record<string, string> = { USDC: "USD", USDT: "USD", PYUSD: "USD", EURC: "EUR", EUROC: "EUR", USDP: "USD", GUSD: "USD" };
/** Non-ISO anchor codes seen in the wild → peg currency. */
const PEG_ALIASES: Record<string, string> = { IDRT: "IDR", NGNT: "NGN", BIDR: "IDR", ZARZ: "ZAR" };

export const DEFAULT_CONFIG: StablecoinConfig = {
  network: "mainnet",
  minTrustlines: 1000,
  minTrades24h: 10,
  itemsPerPage: 100,
  maxPages: 10,
  verifyToml: true,
  allow: [],
  deny: ["@apay.io", "@pyusd-qfs.com", "@stellarusdtzero.com", "@stellarallbridge.io", "@q-maga.com", "@mgusdstellar.org"],
  denyDomainPatterns: ["qfs", "maga", "new-stellar", "usd1-stellar"],
  brandDomains: {
    USDC: ["circle.com"],
    EURC: ["circle.com", "mykobo.co"],
    PYUSD: ["paxos.com"],
    USDT0: ["usdt0.to"],
    USDT: [], // Tether does not issue USDT on Stellar
  },
};

export type Verification = "verified" | "allowlisted" | "not-listed" | "fetch-failed" | "skipped" | "no-domain";

export interface StablePair {
  base: "XLM";
  code: string;
  issuer: string;
  assetKey: string;
  domain: string | null;
  org: string | null;
  logo: string | null;
  peg: string;
  holders: number;
  trades24h: number;
  rank: number | null;
  verified: boolean;
  verification: Verification;
  primary: boolean;
  /** Other passing issuers use the same code. */
  duplicate: boolean;
  allowlisted: boolean;
  asOf: string | null;
}

export interface Rejected {
  code: string;
  issuer: string;
  domain: string | null;
  holders: number;
  trades24h: number;
  reasons: string[];
}

export interface DiscoveryResult {
  network: "mainnet" | "testnet";
  source: string;
  generatedAt: string;
  /** Newest snapshot timestamp among considered assets. */
  asOf: string | null;
  config: Omit<StablecoinConfig, "brandDomains"> & { brandDomains: Record<string, string[]> };
  scanned: number;
  pairs: StablePair[];
  rejected: Rejected[];
}

// ------------------------------------------------------------------ helpers

const lower = (s?: string | null) => (s ?? "").trim().toLowerCase();
export const domainOf = (a: FeedAsset): string | null => {
  const d = lower(a.homeDomain ?? a.tomlInfo?.home_domain);
  return d ? d.replace(/^https?:\/\//, "").replace(/\/.*$/, "") : null;
};
/** a.example.com matches example.com */
export const domainMatches = (domain: string | null, root: string) => !!domain && (domain === root || domain.endsWith(`.${root}`));

function ruleMatches(rule: string, a: FeedAsset): boolean {
  const r = rule.trim();
  if (!r) return false;
  const d = domainOf(a);
  if (r.startsWith("@")) return domainMatches(d, lower(r.slice(1)));
  if (r.includes("@")) {
    const [code, dom] = r.split("@");
    return code === a.code && domainMatches(d, lower(dom));
  }
  if (r.includes(":")) {
    const [code, issuer] = r.split(":");
    return code === a.code && issuer === a.issuer;
  }
  return r === a.code;
}

/** Peg currency from stellar.toml fields, or null when not a stablecoin. */
export function pegOf(a: FeedAsset): string | null {
  const t = a.tomlInfo ?? {};
  const type = lower(t.anchor_asset_type);
  const anchors = (t.anchor_asset ?? "").split(/[,\s]+/).map((x) => x.trim().toUpperCase()).filter(Boolean);
  for (const x of anchors) {
    if (FIAT_CODES.has(x)) return x;
    if (MAJOR_STABLES[x]) return MAJOR_STABLES[x];
    if (type === "fiat" && PEG_ALIASES[x]) return PEG_ALIASES[x];
  }
  if (type === "fiat") return anchors[0] ?? null;
  // no anchor metadata, but the code itself is a major stablecoin (e.g. Paxos PYUSD)
  if (!type && !anchors.length && MAJOR_STABLES[a.code]) return MAJOR_STABLES[a.code];
  return null;
}

const WRAPPED_CODE = /^(y|w|s|st|axl|a[a-z])(?=(USD|EUR|USDC|USDT)[A-Z0-9]*$)/;
const YIELD_WORDS = /\b(yield|interest[- ]?(bearing|earning)|staked|staking|earn(s|ing)? interest|apy|bridged|wrapped)\b/i;

/** Yield-bearing / wrapped / bridged variant (unless clearly pegged: fiat + anchored). */
export function isYieldOrWrapped(a: FeedAsset): boolean {
  const t = a.tomlInfo ?? {};
  const clearlyPegged = lower(t.anchor_asset_type) === "fiat" && t.is_asset_anchored === true;
  if (clearlyPegged) return false;
  if (WRAPPED_CODE.test(a.code)) return true;
  if (a.code === "USDY") return true;
  return YIELD_WORDS.test(t.desc ?? "");
}

/** For non-fiat anchors, the code must carry the peg (USDM, USDT0, EURZ …), not e.g. a platform token. */
function namesItsPeg(a: FeedAsset, peg: string): boolean {
  const code = a.code.toUpperCase();
  const anchors = (a.tomlInfo?.anchor_asset ?? "").toUpperCase().split(/[,\s]+/).filter(Boolean);
  return code.includes(peg) || anchors.some((x) => x.length >= 3 && code.includes(x.replace(/C$/, ""))) || code in MAJOR_STABLES;
}

/** Reasons to reject (empty = passes the static filters). Verification happens later. */
export function screen(a: FeedAsset, cfg: StablecoinConfig): { peg: string | null; reasons: string[]; allowlisted: boolean } {
  const reasons: string[] = [];
  const d = domainOf(a);
  const allowlisted = cfg.allow.some((r) => ruleMatches(r, a));
  if (cfg.deny.some((r) => ruleMatches(r, a))) reasons.push("denylisted");
  const pat = cfg.denyDomainPatterns.find((p) => d && d.includes(lower(p)));
  if (pat) reasons.push(`suspicious home domain (matches "${pat}")`);
  const peg = pegOf(a);
  if (allowlisted && !reasons.length) return { peg: peg ?? "USD", reasons, allowlisted };
  if (!peg) reasons.push("not fiat-anchored in stellar.toml");
  if (peg && isYieldOrWrapped(a)) reasons.push("yield-bearing / wrapped variant");
  if (peg && lower(a.tomlInfo?.anchor_asset_type) !== "fiat" && !namesItsPeg(a, peg)) reasons.push(`crypto-backed token not named as a ${peg} stablecoin`);
  if (!d) reasons.push("no home_domain");
  const brand = cfg.brandDomains[a.code];
  if (brand) {
    if (!brand.length) reasons.push(`${a.code} has no official Stellar issuer (impostor)`);
    else if (!brand.some((b) => domainMatches(d, b))) reasons.push(`impersonates ${a.code} (official: ${brand.join(", ")})`);
  }
  if ((a.trustlinesTotal ?? 0) < cfg.minTrustlines) reasons.push(`holders ${a.trustlinesTotal ?? 0} < ${cfg.minTrustlines}`);
  if ((a.trades24h ?? 0) < cfg.minTrades24h) reasons.push(`trades24h ${a.trades24h ?? 0} < ${cfg.minTrades24h}`);
  return { peg, reasons, allowlisted };
}

/** Stablecoin-looking name (used only to decide whether a rejection is worth reporting). */
export function looksLikeStablecoin(a: FeedAsset, cfg: StablecoinConfig): boolean {
  return a.code in cfg.brandDomains || a.code in MAJOR_STABLES || /(USD|EUR|GBP|JPY|CHF|AUD|BRL|ARS|NGN|ZAR|IDR)/i.test(a.code);
}

// ------------------------------------------------------------------ stellar.toml

/** Minimal parser for [[CURRENCIES]] tables (code / issuer string keys). */
export function parseTomlCurrencies(text: string): { code: string; issuer: string }[] {
  const out: { code: string; issuer: string }[] = [];
  let cur: { code?: string; issuer?: string } | null = null;
  const flush = () => {
    if (cur?.code && cur.issuer) out.push({ code: cur.code, issuer: cur.issuer });
  };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\s+#.*$/, "").trim();
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("[")) {
      flush();
      cur = /^\[\[\s*CURRENCIES\s*\]\]$/i.test(line) ? {} : null;
      continue;
    }
    if (!cur) continue;
    const m = line.match(/^(code|issuer)\s*=\s*["']([^"']*)["']/i);
    if (m) cur[m[1].toLowerCase() as "code" | "issuer"] = m[2].trim();
  }
  flush();
  return out;
}

export interface VerifyCache {
  get(domain: string): { at: number; currencies: { code: string; issuer: string }[] | null } | undefined;
  set(domain: string, v: { at: number; currencies: { code: string; issuer: string }[] | null }): void;
}
export function memoryCache(): VerifyCache {
  const m = new Map<string, { at: number; currencies: { code: string; issuer: string }[] | null }>();
  return { get: (d) => m.get(d), set: (d, v) => void m.set(d, v) };
}

/** Fetch https://<domain>/.well-known/stellar.toml and check a CURRENCIES entry for code+issuer. */
export async function verifyIssuer(domain: string | null, code: string, issuer: string, deps: { fetch: FetchLike; cache?: VerifyCache; ttlMs?: number; now?: () => number; timeoutMs?: number }): Promise<Verification> {
  if (!domain) return "no-domain";
  const now = deps.now ?? Date.now;
  const ttl = deps.ttlMs ?? 24 * 3600_000;
  let entry = deps.cache?.get(domain);
  if (!entry || now() - entry.at > ttl) {
    let currencies: { code: string; issuer: string }[] | null = null;
    try {
      const ctl = typeof AbortController !== "undefined" ? new AbortController() : undefined;
      const t = ctl ? setTimeout(() => ctl.abort(), deps.timeoutMs ?? 8000) : undefined;
      try {
        const r = await deps.fetch(`https://${domain}/.well-known/stellar.toml`, { signal: ctl?.signal });
        if (r.ok) {
          const text = await r.text();
          // bot walls / SPA fallbacks return HTML with 200: treat as a failed fetch, not "not listed"
          if (!/<html|<!doctype/i.test(text.slice(0, 500)) && /=/.test(text)) currencies = parseTomlCurrencies(text);
        }
      } finally {
        if (t) clearTimeout(t);
      }
    } catch {
      currencies = null;
    }
    entry = { at: now(), currencies };
    deps.cache?.set(domain, entry);
  }
  if (!entry.currencies) return "fetch-failed";
  return entry.currencies.some((c) => c.code === code && c.issuer === issuer) ? "verified" : "not-listed";
}

// ------------------------------------------------------------------ feed

export const STELLARCHAIN_FEED = "https://api.stellarchain.io/v1/market/assets";

export async function fetchFeed(cfg: Pick<StablecoinConfig, "network" | "itemsPerPage" | "maxPages">, f: FetchLike): Promise<FeedAsset[]> {
  const all: FeedAsset[] = [];
  for (let page = 1; page <= cfg.maxPages; page++) {
    const r = await f(`${STELLARCHAIN_FEED}?network=${cfg.network}&itemsPerPage=${cfg.itemsPerPage}&page=${page}`, { headers: { Accept: "application/ld+json" } });
    if (!r.ok) throw new Error(`stellarchain feed HTTP ${r.status} (page ${page})`);
    const body = (await r.json()) as { member?: FeedAsset[]; totalItems?: number };
    const m = body.member ?? [];
    all.push(...m);
    if (m.length < cfg.itemsPerPage || (body.totalItems !== undefined && all.length >= body.totalItems)) break;
  }
  return all;
}

// ------------------------------------------------------------------ pipeline

export async function discoverStablecoins(
  input: { assets: FeedAsset[] } | { fetch: FetchLike },
  cfgIn: Partial<StablecoinConfig> = {},
  deps: { fetch?: FetchLike; cache?: VerifyCache; now?: () => number } = {},
): Promise<DiscoveryResult> {
  const cfg: StablecoinConfig = { ...DEFAULT_CONFIG, ...cfgIn, brandDomains: { ...DEFAULT_CONFIG.brandDomains, ...(cfgIn.brandDomains ?? {}) } };
  const f = deps.fetch ?? ("fetch" in input ? input.fetch : undefined);
  const assets = "assets" in input ? input.assets : await fetchFeed(cfg, input.fetch);
  const cache = deps.cache ?? memoryCache();
  const pairs: StablePair[] = [];
  const rejected: Rejected[] = [];
  let asOf: string | null = null;

  for (const a of assets) {
    const { peg, reasons, allowlisted } = screen(a, cfg);
    if (peg === null && !allowlisted && !looksLikeStablecoin(a, cfg)) continue; // not a stablecoin candidate at all: skip silently
    const d = domainOf(a);
    const base = { code: a.code, issuer: a.issuer, domain: d, holders: a.trustlinesTotal ?? 0, trades24h: a.trades24h ?? 0 };
    if (reasons.length) {
      rejected.push({ ...base, reasons });
      continue;
    }
    let verification: Verification = "skipped";
    if (cfg.verifyToml && f) verification = await verifyIssuer(d, a.code, a.issuer, { fetch: f, cache, now: deps.now });
    if (a.updatedAt && (!asOf || a.updatedAt > asOf)) asOf = a.updatedAt;
    if (verification === "not-listed") {
      rejected.push({ ...base, reasons: [`issuer not listed in ${d}/.well-known/stellar.toml CURRENCIES`] });
      continue;
    }
    // "skip if the fetch fails": stays unverified (hidden by default in the UI) —
    // unless an operator explicitly allowlisted this exact asset in config.
    if ((verification === "fetch-failed" || verification === "skipped") && allowlisted) verification = "allowlisted";
    pairs.push({
      base: "XLM",
      code: a.code,
      issuer: a.issuer,
      assetKey: `${a.code}-${a.issuer}`,
      domain: d,
      org: a.tomlInfo?.documentation?.ORG_NAME ?? null,
      logo: a.imageUrl ?? a.tomlInfo?.image ?? null,
      peg: peg ?? "USD",
      holders: a.trustlinesTotal ?? 0,
      trades24h: a.trades24h ?? 0,
      rank: a.rankPosition ?? null,
      verified: verification === "verified" || verification === "allowlisted",
      verification,
      primary: false,
      duplicate: false,
      allowlisted,
      asOf: a.updatedAt ?? null,
    });
  }

  // duplicates: most-held verified issuer per code is primary
  const byCode = new Map<string, StablePair[]>();
  for (const p of pairs) byCode.set(p.code, [...(byCode.get(p.code) ?? []), p]);
  for (const group of byCode.values()) {
    const dup = group.length > 1;
    const verified = group.filter((p) => p.verified).sort((x, y) => y.holders - x.holders);
    if (verified[0]) verified[0].primary = true;
    for (const p of group) p.duplicate = dup;
  }
  pairs.sort((x, y) => Number(y.verified) - Number(x.verified) || Number(y.primary) - Number(x.primary) || y.holders - x.holders);
  rejected.sort((x, y) => y.holders - x.holders);

  return {
    network: cfg.network,
    source: "stellarchain.io /v1/market/assets + issuer stellar.toml",
    generatedAt: new Date((deps.now ?? Date.now)()).toISOString(),
    asOf,
    config: cfg,
    scanned: assets.length,
    pairs,
    rejected,
  };
}
