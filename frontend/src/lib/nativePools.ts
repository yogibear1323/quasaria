/**
 * Stellar-native (CAP-38) liquidity pools: browse, preview, deposit, withdraw.
 *
 *  - Data comes from Horizon `/liquidity_pools` (+ `/liquidity_pools/{id}/trades` for 24h volume).
 *  - TESTNET is the only network that can sign. Mainnet is READ-ONLY data browsing behind the
 *    VITE_MAINNET_BROWSE=1 build flag; `MAINNET_SIGNING` is a compile-time `false` and every
 *    transaction builder refuses a non-testnet network.
 *  - Assets are matched on code + issuer, never on ticker alone. The curated list is generated from
 *    each issuer's stellar.toml (or the issuer's own docs): see scripts/gen-lp-curated.mjs.
 */
import { Asset, BASE_FEE, Horizon, LiquidityPoolAsset, Networks, Operation, TransactionBuilder, getLiquidityPoolId } from "@stellar/stellar-sdk";
import { HORIZON_URL, NETWORK_PASSPHRASE, TESTNET_USDC_ISSUER } from "./config";
import curated from "../config/lp-curated.json";
import testnetDoc from "../config/testnet-assets.json";
import { GLACIERQ_ICON_128, REWARD_ASSET_CODE, REWARD_ISSUER } from "./rewards";

export type NetId = "testnet" | "mainnet";
/** Build flag: show the read-only mainnet data switch. Off unless VITE_MAINNET_BROWSE=1. */
export const MAINNET_BROWSE = import.meta.env.VITE_MAINNET_BROWSE === "1";
/** Mainnet signing is OFF until explicitly approved. A constant on purpose: it cannot be flipped by an env var. */
export const MAINNET_SIGNING = false as boolean;

export const NETS: Record<NetId, { id: NetId; label: string; horizon: string; passphrase: string; canSign: boolean }> = {
  testnet: { id: "testnet", label: "Testnet", horizon: HORIZON_URL, passphrase: NETWORK_PASSPHRASE, canSign: true },
  mainnet: { id: "mainnet", label: "Mainnet (read-only)", horizon: "https://horizon.stellar.org", passphrase: Networks.PUBLIC, canSign: false },
};

export const BASE_RESERVE = 0.5;
export const POOL_FEE_BP = 30;
export const POOL_SHARE_TRUSTLINE_RESERVES = 2; // a pool-share trustline counts as 2 subentries (CAP-38)

// ---------- assets ----------
export type AssetRef = { code: string; issuer: string | null }; // issuer null = native XLM
export const XLM: AssetRef = { code: "XLM", issuer: null };
export const keyOf = (a: AssetRef) => (a.issuer ? `${a.code}:${a.issuer}` : "native");
export const sameAsset = (a: AssetRef, b: AssetRef) => keyOf(a) === keyOf(b);
export const toSdk = (a: AssetRef) => (a.issuer ? new Asset(a.code, a.issuer) : Asset.native());
export const fromHorizonKey = (s: string): AssetRef => {
  if (s === "native") return XLM;
  const i = s.indexOf(":");
  return { code: s.slice(0, i), issuer: s.slice(i + 1) };
};
export const shortAddr = (s: string) => `${s.slice(0, 4)}…${s.slice(-4)}`;

export type CuratedAsset = AssetRef & {
  category: string; peg: string | null; name: string; homeDomain: string | null;
  verification: string; verifiedVia: string | null; logo: string | null; authRequired: boolean;
  /** testnet only: what this asset is on testnet */
  testnetKind?: "native" | "real" | "demo";
};

type RawCurated = { code: string; issuer: string; category: string; peg: string | null; name: string; homeDomain: string | null; verification: string; verifiedVia: string | null; logo: string | null; authRequired: boolean };

const MAINNET_LIST: CuratedAsset[] = (curated.mainnet as RawCurated[]).map((a) => ({ ...a }));
const MAINNET_XLM: CuratedAsset = { ...XLM, category: "base", peg: null, name: "Stellar Lumens", homeDomain: null, verification: "native", verifiedVia: null, logo: null, authRequired: false, testnetKind: "native" };

/** Testnet: native XLM, Circle's real testnet USDC, and the QUSD demo dollar (identified by issuer). */
function testnetList(): CuratedAsset[] {
  const out: CuratedAsset[] = [{ ...MAINNET_XLM }];
  const raw = (testnetDoc as unknown as { assets: { id: string; code: string; category: string; peg: string | null; name: string | null; logo: string | null; testnet: { kind: string; code: string; issuer: string | null; label: string } }[] }).assets;
  for (const a of raw) {
    if (a.testnet.kind !== "real" && a.testnet.kind !== "demo") continue;
    if (!a.testnet.issuer) continue;
    out.push({ code: a.testnet.code, issuer: a.testnet.issuer, category: a.category, peg: a.peg, name: a.name ?? a.code, homeDomain: null,
      verification: a.testnet.kind === "real" ? "testnet-official" : "quasaria-demo", verifiedVia: null, logo: a.logo, authRequired: false, testnetKind: a.testnet.kind as "real" | "demo" });
  }
  if (!out.some((a) => a.issuer === TESTNET_USDC_ISSUER)) out.push({ code: "USDC", issuer: TESTNET_USDC_ISSUER, category: "stablecoin", peg: "USD", name: "USD Coin (testnet)", homeDomain: null, verification: "testnet-official", verifiedVia: null, logo: null, authRequired: false, testnetKind: "real" });
  return out;
}

/** GLACIERQ joins the curated list (matched by code + issuer) as soon as its issuer exists on that network. */
const glacierq = (net: NetId): CuratedAsset[] => {
  const issuer = REWARD_ISSUER[net];
  return issuer ? [{ code: REWARD_ASSET_CODE, issuer, category: "reward", peg: null, name: "Glacier (Quasaria rewards token)", homeDomain: net === "mainnet" ? "yogibear1323.github.io" : null,
    verification: "quasaria-issuer", verifiedVia: null, logo: GLACIERQ_ICON_128, authRequired: false, testnetKind: net === "testnet" ? "real" : undefined }] : [];
};
const TESTNET_LIST = testnetList();
export const curatedList = (net: NetId): CuratedAsset[] => (net === "mainnet" ? [MAINNET_XLM, ...MAINNET_LIST, ...glacierq("mainnet")] : [...TESTNET_LIST, ...glacierq("testnet")]);
export const CURATED_VERIFIED_AT: string = curated.verifiedAt;

export type Verification =
  | { status: "native" }
  | { status: "verified"; asset: CuratedAsset }
  | { status: "lookalike"; imposes: CuratedAsset }   // same ticker as a curated asset, different issuer
  | { status: "unverified" };

/** Verification by issuer address. A matching ticker with another issuer is flagged as a look-alike. */
export function verifyAsset(net: NetId, a: AssetRef): Verification {
  if (!a.issuer) return { status: "native" };
  const list = curatedList(net);
  const hit = list.find((c) => c.issuer && c.code === a.code && c.issuer === a.issuer);
  if (hit) return { status: "verified", asset: hit };
  const twin = list.find((c) => c.issuer && c.code.toLowerCase() === a.code.toLowerCase());
  if (twin) return { status: "lookalike", imposes: twin };
  return { status: "unverified" };
}
export const isVerified = (net: NetId, a: AssetRef) => { const v = verifyAsset(net, a).status; return v === "native" || v === "verified"; };
export const poolVerified = (net: NetId, p: { a: AssetRef; b: AssetRef }) => isVerified(net, p.a) && isVerified(net, p.b);

// ---------- pool ids / pairs ----------
export function orderAssets(a: AssetRef, b: AssetRef): [AssetRef, AssetRef] {
  return Asset.compare(toSdk(a), toSdk(b)) <= 0 ? [a, b] : [b, a];
}
export function poolIdFor(a: AssetRef, b: AssetRef, fee = POOL_FEE_BP): string {
  const [x, y] = orderAssets(a, b);
  return Array.from(getLiquidityPoolId("constant_product", { assetA: toSdk(x), assetB: toSdk(y), fee }) as Uint8Array, (v) => v.toString(16).padStart(2, "0")).join("");
}

/** Curated pairs to look up: XLM against every curated asset, plus USDC against every curated stablecoin. */
export function curatedPairs(net: NetId): [AssetRef, AssetRef][] {
  const list = curatedList(net);
  const out: [AssetRef, AssetRef][] = [];
  const seen = new Set<string>();
  const add = (x: AssetRef, y: AssetRef) => {
    if (sameAsset(x, y)) return;
    const [a, b] = orderAssets(x, y);
    const k = `${keyOf(a)}|${keyOf(b)}`;
    if (!seen.has(k)) { seen.add(k); out.push([a, b]); }
  };
  for (const c of list) if (c.issuer) add(XLM, c);
  const usdc = list.find((c) => c.code === "USDC" && c.issuer);
  if (usdc) for (const c of list) if (c.issuer && c.category === "stablecoin") add(usdc, c);
  return out;
}

// ---------- Horizon data ----------
export type PoolRow = {
  id: string; net: NetId; feeBp: number; totalShares: number; holders: number;
  a: AssetRef; b: AssetRef; reserveA: number; reserveB: number; lastModified?: string;
};
export type PoolRecord = { id: string; fee_bp: number; total_shares: string; total_trustlines: string; reserves: { asset: string; amount: string }[]; last_modified_time?: string };

export const parsePool = (r: PoolRecord, net: NetId): PoolRow => ({
  id: r.id, net, feeBp: r.fee_bp, totalShares: Number(r.total_shares), holders: Number(r.total_trustlines),
  a: fromHorizonKey(r.reserves[0].asset), b: fromHorizonKey(r.reserves[1].asset),
  reserveA: Number(r.reserves[0].amount), reserveB: Number(r.reserves[1].amount), lastModified: r.last_modified_time,
});

type Fetcher = typeof fetch;
let fetcher: Fetcher = (...a) => fetch(...a);
/** Test hook. */
export const _setFetcher = (f: Fetcher | null) => { fetcher = f ?? ((...a) => fetch(...a)); };

async function getJson<T>(url: string): Promise<T | null> {
  const r = await fetcher(url, { headers: { Accept: "application/json" } });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`Horizon ${r.status}`);
  return (await r.json()) as T;
}

/** `/liquidity_pools?reserves=A,B`: the pool(s) holding exactly this pair (fee-30 pools only exist). */
export async function fetchPoolForPair(net: NetId, x: AssetRef, y: AssetRef): Promise<PoolRow | null> {
  const [a, b] = orderAssets(x, y);
  const j = await getJson<{ _embedded: { records: PoolRecord[] } }>(`${NETS[net].horizon}/liquidity_pools?reserves=${encodeURIComponent(keyOf(a))},${encodeURIComponent(keyOf(b))}&limit=5`);
  const rec = j?._embedded.records.find((r) => r.fee_bp === POOL_FEE_BP) ?? null;
  return rec ? parsePool(rec, net) : null;
}
export async function fetchPoolById(net: NetId, id: string): Promise<PoolRow | null> {
  const r = await getJson<PoolRecord>(`${NETS[net].horizon}/liquidity_pools/${id}`);
  return r ? parsePool(r, net) : null;
}
/** Most recently created pools, any assets (flagged unverified unless both legs are curated). */
export async function fetchRecentPools(net: NetId, limit = 40): Promise<PoolRow[]> {
  const j = await getJson<{ _embedded: { records: PoolRecord[] } }>(`${NETS[net].horizon}/liquidity_pools?order=desc&limit=${limit}`);
  return (j?._embedded.records ?? []).filter((r) => r.reserves.length === 2).map((r) => parsePool(r, net));
}

/** What a search box entry means for the "any asset" browser. */
export type Lookup = { kind: "pool"; id: string } | { kind: "asset"; asset: AssetRef };
/** Parse "XLM", "CODE-GISSUER", "CODE:GISSUER" or a 64-hex pool id. Anything else is a plain filter (null). */
export function parseLookup(input: string): Lookup | null {
  const t = input.trim();
  if (/^[0-9a-f]{64}$/i.test(t)) return { kind: "pool", id: t.toLowerCase() };
  if (/^xlm$/i.test(t)) return { kind: "asset", asset: XLM };
  const m = /^([A-Za-z0-9]{1,12})[-:](G[A-Z2-7]{55})$/.exec(t);
  return m ? { kind: "asset", asset: { code: m[1], issuer: m[2] } } : null;
}
/** Pools for an exact asset (code AND issuer), or one pool by id. Horizon filters; we never match on ticker alone. */
export async function fetchPoolsByLookup(net: NetId, l: Lookup): Promise<PoolRow[]> {
  if (l.kind === "pool") {
    const r = await getJson<PoolRecord>(`${NETS[net].horizon}/liquidity_pools/${l.id}`);
    return r && r.reserves?.length === 2 ? [parsePool(r, net)] : [];
  }
  const res = l.asset.issuer ? `${l.asset.code}:${l.asset.issuer}` : "native";
  const j = await getJson<{ _embedded: { records: PoolRecord[] } }>(`${NETS[net].horizon}/liquidity_pools?reserves=${encodeURIComponent(res)}&limit=40`);
  return (j?._embedded.records ?? []).filter((r) => r.reserves.length === 2).map((r) => parsePool(r, net));
}

/** Run `fn` over items with bounded concurrency; failures are skipped. */
export async function pooled<T, R>(items: T[], conc: number, fn: (x: T) => Promise<R>, onEach?: (r: R, i: number) => void): Promise<void> {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(conc, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      try { onEach?.(await fn(items[idx]), idx); } catch { /* skip */ }
    }
  }));
}

type TradeRec = { ledger_close_time: string; base_amount: string; base_asset_type: string; base_asset_code?: string; base_asset_issuer?: string; counter_amount: string; counter_asset_type: string; counter_asset_code?: string; counter_asset_issuer?: string };
const tradeAsset = (t: TradeRec, side: "base" | "counter"): AssetRef => {
  const type = side === "base" ? t.base_asset_type : t.counter_asset_type;
  if (type === "native") return XLM;
  return { code: (side === "base" ? t.base_asset_code : t.counter_asset_code) ?? "?", issuer: (side === "base" ? t.base_asset_issuer : t.counter_asset_issuer) ?? null };
};

/** 24h swap volume of a pool measured in `unit` (one of its two assets). `truncated`: more than `maxPages` pages in 24h. */
export async function fetchVolume24h(net: NetId, poolId: string, unit: AssetRef, now = Date.now(), maxPages = 3): Promise<{ volume: number; truncated: boolean; trades: number }> {
  const since = now - 24 * 3600_000;
  let url: string | null = `${NETS[net].horizon}/liquidity_pools/${poolId}/trades?order=desc&limit=200`;
  let volume = 0, trades = 0, pages = 0, done = false;
  while (url && pages < maxPages && !done) {
    const j: { _embedded: { records: TradeRec[] }; _links?: { next?: { href: string } } } | null = await getJson<{ _embedded: { records: TradeRec[] }; _links?: { next?: { href: string } } }>(url);
    const recs: TradeRec[] = j?._embedded.records ?? [];
    for (const t of recs) {
      if (Date.parse(t.ledger_close_time) < since) { done = true; break; }
      volume += sameAsset(tradeAsset(t, "base"), unit) ? Number(t.base_amount) : sameAsset(tradeAsset(t, "counter"), unit) ? Number(t.counter_amount) : 0;
      trades++;
    }
    pages++;
    url = recs.length === 200 && !done ? (j?._links?.next?.href ?? null) : null;
  }
  return { volume, trades, truncated: !done && pages >= maxPages && url !== null };
}

// ---------- valuation / metrics ----------
/** Spot price of A in terms of B (B per A). */
export const spot = (p: { reserveA: number; reserveB: number }) => (p.reserveA > 0 ? p.reserveB / p.reserveA : 0);

export type Pricing = { xlmUsd: number | null };
/** USD value of one unit of `a`: USD-pegged curated stablecoins = 1, XLM = pricing.xlmUsd. Otherwise null. */
export function usdUnit(net: NetId, a: AssetRef, pricing: Pricing): number | null {
  if (!a.issuer) return pricing.xlmUsd;
  const v = verifyAsset(net, a);
  if (v.status === "verified" && v.asset.category === "stablecoin" && v.asset.peg === "USD") return 1;
  return null;
}

/** XLM/USD derived from the pool's own reserves (XLM vs a verified USD stablecoin), ignoring dust pools. */
export function deriveXlmUsd(net: NetId, pools: PoolRow[]): number | null {
  let best: { usd: number; px: number } | null = null;
  for (const p of pools) {
    const x = !p.a.issuer ? { xlm: p.reserveA, o: p.b, ro: p.reserveB } : !p.b.issuer ? { xlm: p.reserveB, o: p.a, ro: p.reserveA } : null;
    if (!x || x.xlm <= 0 || x.ro <= 0) continue;
    if (usdUnit(net, x.o, { xlmUsd: null }) !== 1 && !(verifyAsset(net, x.o).status === "verified" && (verifyAsset(net, x.o) as { asset: CuratedAsset }).asset.peg === "USD")) continue;
    if (!best || x.ro > best.usd) best = { usd: x.ro, px: x.ro / x.xlm };
  }
  return best?.px ?? null;
}

/** TVL in USD when at least one leg has a USD value (the pool is balanced, so TVL = 2 × that leg). */
export function tvlUsd(p: PoolRow, pricing: Pricing): number | null {
  const ua = usdUnit(p.net, p.a, pricing), ub = usdUnit(p.net, p.b, pricing);
  if (ua != null) return 2 * ua * p.reserveA;
  if (ub != null) return 2 * ub * p.reserveB;
  return null;
}
/** The leg used to measure volume: the one with a USD value (so volume converts to USD), else asset A. */
export function volumeUnit(p: PoolRow, pricing: Pricing): { unit: AssetRef; usd: number | null } {
  const ua = usdUnit(p.net, p.a, pricing), ub = usdUnit(p.net, p.b, pricing);
  if (ua != null) return { unit: p.a, usd: ua };
  if (ub != null) return { unit: p.b, usd: ub };
  return { unit: p.a, usd: null };
}
/** Fee APR estimate: yesterday's fees annualised over today's TVL. Excludes impermanent loss and any rewards. */
export function feeApr(volumeUsd24h: number | null, tvl: number | null, feeBp = POOL_FEE_BP): number | null {
  if (volumeUsd24h == null || !tvl || tvl <= 0) return null;
  return ((volumeUsd24h * (feeBp / 10_000) * 365) / tvl) * 100;
}

// ---------- positions ----------
export type Position = { pool: PoolRow; shares: number; fraction: number; amountA: number; amountB: number; usd: number | null };

export async function fetchPositions(net: NetId, address: string, pricing: Pricing): Promise<Position[]> {
  const acct = await getJson<{ balances: { asset_type: string; liquidity_pool_id?: string; balance: string }[] }>(`${NETS[net].horizon}/accounts/${address}`);
  const shares = (acct?.balances ?? []).filter((b) => b.asset_type === "liquidity_pool_shares" && Number(b.balance) > 0);
  const out: Position[] = [];
  await pooled(shares, 4, async (b) => ({ b, pool: await fetchPoolById(net, b.liquidity_pool_id!) }), ({ b, pool }) => {
    if (!pool) return;
    const s = Number(b.balance), f = pool.totalShares > 0 ? s / pool.totalShares : 0;
    const t = tvlUsd(pool, pricing);
    out.push({ pool, shares: s, fraction: f, amountA: pool.reserveA * f, amountB: pool.reserveB * f, usd: t == null ? null : t * f });
  });
  return out;
}
export async function fetchAccountBalances(net: NetId, address: string): Promise<{ native: number; trust: Set<string>; subentries: number; shareTrust: Set<string> } | null> {
  const a = await getJson<{ balances: { asset_type: string; asset_code?: string; asset_issuer?: string; liquidity_pool_id?: string; balance: string }[]; subentry_count: number }>(`${NETS[net].horizon}/accounts/${address}`);
  if (!a) return null;
  const trust = new Set<string>(), shareTrust = new Set<string>();
  let native = 0;
  for (const b of a.balances) {
    if (b.asset_type === "native") { native = Number(b.balance); trust.add("native"); }
    else if (b.asset_type === "liquidity_pool_shares") shareTrust.add(b.liquidity_pool_id!);
    else trust.add(`${b.asset_code}:${b.asset_issuer}`);
  }
  return { native, trust, subentries: a.subentry_count, shareTrust };
}
export async function fetchAssetBalance(net: NetId, address: string, asset: AssetRef): Promise<number | null> {
  const a = await getJson<{ balances: { asset_type: string; asset_code?: string; asset_issuer?: string; balance: string }[] }>(`${NETS[net].horizon}/accounts/${address}`);
  const b = a?.balances.find((x) => (asset.issuer ? x.asset_code === asset.code && x.asset_issuer === asset.issuer : x.asset_type === "native"));
  return b ? Number(b.balance) : null;
}

// ---------- deposit / withdraw maths (pure) ----------
export const fix7 = (n: number) => (Math.floor(n * 1e7 + 1e-6) / 1e7).toFixed(7);
export const slipOf = (bps: number) => Math.min(Math.max(bps, 1), 5000) / 10_000;

export type DepositInput = { pool: PoolRow | null; driver: "A" | "B"; amount: number; /** only used when pool is empty/new */ otherAmount?: number; slippageBps: number };
export type DepositPreview = {
  amountA: number; amountB: number; maxAmountA: number; maxAmountB: number;
  minPrice: number; maxPrice: number; price: number;
  shares: number; poolShareAfter: number; newPool: boolean;
};
/** Share/price preview. Price is A per B. For an existing pool the other side follows the pool ratio. */
export function previewDeposit(i: DepositInput): DepositPreview | null {
  const { pool, driver, amount } = i;
  if (!(amount > 0)) return null;
  const s = slipOf(i.slippageBps);
  const empty = !pool || pool.reserveA <= 0 || pool.reserveB <= 0 || pool.totalShares <= 0;
  let a: number, b: number, price: number;
  if (empty) {
    const o = i.otherAmount ?? 0;
    if (!(o > 0)) return null;
    a = driver === "A" ? amount : o; b = driver === "A" ? o : amount; price = a / b;
    const shares = Math.sqrt(a * b);
    return { amountA: a, amountB: b, maxAmountA: a, maxAmountB: b, minPrice: price * (1 - s), maxPrice: price * (1 + s), price, shares, poolShareAfter: 1, newPool: true };
  }
  price = pool!.reserveA / pool!.reserveB;
  if (driver === "A") { a = amount; b = amount / price; } else { b = amount; a = amount * price; }
  const shares = Math.min(a / pool!.reserveA, b / pool!.reserveB) * pool!.totalShares;
  return { amountA: a, amountB: b, maxAmountA: a, maxAmountB: b, minPrice: price * (1 - s), maxPrice: price * (1 + s), price, shares, poolShareAfter: shares / (pool!.totalShares + shares), newPool: false };
}

/** Reserve (XLM, locked while held) the deposit adds: 0.5 per new asset trustline, 2 × 0.5 for the pool-share trustline. */
export function depositReserveCost(o: { needTrustA: boolean; needTrustB: boolean; needShareTrust: boolean }) {
  const lines = (o.needTrustA ? 1 : 0) + (o.needTrustB ? 1 : 0);
  return { trustlines: lines * BASE_RESERVE, shareTrust: o.needShareTrust ? POOL_SHARE_TRUSTLINE_RESERVES * BASE_RESERVE : 0, total: lines * BASE_RESERVE + (o.needShareTrust ? POOL_SHARE_TRUSTLINE_RESERVES * BASE_RESERVE : 0) };
}

export type WithdrawPreview = { shares: number; amountA: number; amountB: number; minAmountA: number; minAmountB: number };
export function previewWithdraw(pool: PoolRow, shares: number, slippageBps: number): WithdrawPreview | null {
  if (!(shares > 0) || pool.totalShares <= 0) return null;
  const f = shares / pool.totalShares, s = slipOf(slippageBps);
  const a = pool.reserveA * f, b = pool.reserveB * f;
  return { shares, amountA: a, amountB: b, minAmountA: a * (1 - s), minAmountB: b * (1 - s) };
}

// ---------- transaction builders (TESTNET ONLY) ----------
export function assertSignable(net: NetId) {
  if (net !== "testnet" || !NETS.testnet.canSign || NETS.testnet.passphrase !== Networks.TESTNET) {
    throw new Error("Mainnet signing is off. Liquidity transactions can only be built and signed on testnet.");
  }
}
const testnetServer = () => new Horizon.Server(NETS.testnet.horizon);

export type DepositTx = { xdr: string; poolId: string; added: string[] };
/** Adds missing asset + pool-share trustlines, then deposits with min/max price bounds. */
export async function buildDepositTx(net: NetId, pubkey: string, a: AssetRef, b: AssetRef, pv: DepositPreview, opts: { fee?: string } = {}): Promise<DepositTx> {
  assertSignable(net);
  const [x, y] = orderAssets(a, b);
  const server = testnetServer();
  const acct = await server.loadAccount(pubkey);
  const id = poolIdFor(x, y);
  const holds = (as: AssetRef) => !as.issuer || acct.balances.some((bal) => "asset_code" in bal && bal.asset_code === as.code && bal.asset_issuer === as.issuer);
  const hasShare = acct.balances.some((bal) => bal.asset_type === "liquidity_pool_shares" && (bal as { liquidity_pool_id: string }).liquidity_pool_id === id);
  const added: string[] = [];
  const bld = new TransactionBuilder(acct, { fee: opts.fee ?? BASE_FEE, networkPassphrase: Networks.TESTNET }).setTimeout(180);
  for (const as of [x, y]) if (!holds(as)) { bld.addOperation(Operation.changeTrust({ asset: toSdk(as) })); added.push(`${as.code} trustline`); }
  if (!hasShare) { bld.addOperation(Operation.changeTrust({ asset: new LiquidityPoolAsset(toSdk(x), toSdk(y), POOL_FEE_BP) })); added.push("pool-share trustline"); }
  const swapped = !sameAsset(x, a); // pv is expressed for (a,b) as the caller named them; the op needs (x,y)
  const amtA = swapped ? pv.maxAmountB : pv.maxAmountA, amtB = swapped ? pv.maxAmountA : pv.maxAmountB;
  const minP = swapped ? 1 / pv.maxPrice : pv.minPrice, maxP = swapped ? 1 / pv.minPrice : pv.maxPrice;
  bld.addOperation(Operation.liquidityPoolDeposit({ liquidityPoolId: id, maxAmountA: fix7(amtA), maxAmountB: fix7(amtB), minPrice: minP.toFixed(7), maxPrice: maxP.toFixed(7) }));
  return { xdr: bld.build().toXDR(), poolId: id, added };
}

/** Withdraws `shares` with min-amount bounds; optionally closes the (now empty) pool-share trustline to free its reserve. */
export async function buildWithdrawTx(net: NetId, pubkey: string, pool: PoolRow, pv: WithdrawPreview, closeTrustline: boolean, opts: { fee?: string } = {}): Promise<string> {
  assertSignable(net);
  const acct = await testnetServer().loadAccount(pubkey);
  const bld = new TransactionBuilder(acct, { fee: opts.fee ?? BASE_FEE, networkPassphrase: Networks.TESTNET }).setTimeout(180);
  bld.addOperation(Operation.liquidityPoolWithdraw({ liquidityPoolId: pool.id, amount: fix7(pv.shares), minAmountA: fix7(pv.minAmountA), minAmountB: fix7(pv.minAmountB) }));
  if (closeTrustline) bld.addOperation(Operation.changeTrust({ asset: new LiquidityPoolAsset(toSdk(pool.a), toSdk(pool.b), pool.feeBp), limit: "0" }));
  return bld.build().toXDR();
}

/** Pools for every curated pair that exists on `net` (bounded concurrency, failures skipped). */
export async function loadCuratedPools(net: NetId): Promise<PoolRow[]> {
  const out: PoolRow[] = [];
  await pooled(curatedPairs(net), 4, ([a, b]) => fetchPoolForPair(net, a, b), (p) => { if (p) out.push(p); });
  return out;
}
