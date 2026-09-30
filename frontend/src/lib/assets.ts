/**
 * Curated asset list (stablecoins + popular Stellar assets) and the v3 AMM
 * pools built on them — TESTNET. Data: src/config/testnet-assets.json, written
 * by scripts/deploy-asset-pools-v3.ts from config/assets.mainnet.json (mainnet
 * codes/issuers verified read-only against Horizon + stellar.toml).
 *
 * Most real assets don't exist on testnet, so each asset is either the real
 * testnet asset (Circle's testnet USDC), native XLM, the QUSD demo dollar, or
 * a clearly-labelled "testnet mirror" (Quasaria mock, code mk<CODE>, no value)
 * that links to the real mainnet asset. Pure module (no network) so it can be
 * unit-tested; UI helpers live in components/AssetSelect.tsx.
 */
import doc from "../config/testnet-assets.json";

export type AssetCategory = "stablecoin" | "popular" | "base";
export type TestnetKind = "native" | "real" | "mirror" | "demo";
export type ListedAsset = {
  id: string;
  code: string;
  category: AssetCategory;
  peg: string | null;
  name: string | null;
  org: string | null;
  logo: string | null;
  mainnet: null | { code: string; issuer: string; homeDomain: string | null; verification: string; verifiedVia: string | null; note: string | null; holders: number | null; expert: string };
  pricePerXlm: number;
  priceSource: string;
  offPeg: boolean;
  testnet: { kind: TestnetKind; code: string; issuer: string | null; sac: string | null; label: string; note?: string };
};
export type ListedPool = {
  id: string; pair: string; base: string; quote: string; assetA: string; assetB: string; tokenA: string; tokenB: string;
  feeBps: number; tier: 1 | 2; kind: "xlm" | "stable-stable" | "demo"; pool?: string; seeded?: { a: number; b: number }; routerCheck?: string;
};

type Doc = { assets: ListedAsset[]; pools: ListedPool[]; retired?: { note: string; pools: { pair: string; testnetCode: string; pool: string; sac: string }[] }; mirrorIssuers?: Record<string, { address: string; homeDomain: string }>; router?: string };
const D = doc as unknown as Doc;

/** Every listed asset that has a usable testnet token contract. */
export const ASSET_LIST: ListedAsset[] = D.assets.filter((a) => a.testnet.sac);
/** Deployed + seeded v3 pools only. */
export const POOL_LIST: ListedPool[] = D.pools.filter((p) => p.pool && p.seeded);
export const RETIRED_POOLS = D.retired?.pools ?? [];
export const RETIRED_NOTE = D.retired?.note ?? "";
export const MIRROR_ISSUERS = D.mirrorIssuers ?? {};

const byId = new Map(ASSET_LIST.map((a) => [a.id, a]));
const bySac = new Map(ASSET_LIST.map((a) => [a.testnet.sac!, a]));
export const assetById = (id: string) => byId.get(id);
export const assetBySac = (sac: string) => bySac.get(sac);

export const CATEGORY_LABEL: Record<AssetCategory, string> = { stablecoin: "Stablecoins", popular: "Popular assets", base: "Base" };
export const isMirror = (a: ListedAsset) => a.testnet.kind === "mirror";
/** Badge text: "REAL testnet" / "testnet mirror of SHX" / "native" / "demo". */
export function badgeOf(a: ListedAsset): { text: string; tone: "green" | "pink" | "cyan" | "gold" } {
  switch (a.testnet.kind) {
    case "real": return { text: "REAL testnet", tone: "green" };
    case "mirror": return { text: `testnet mirror of ${a.code}`, tone: "pink" };
    case "native": return { text: "native", tone: "cyan" };
    default: return { text: "testnet demo", tone: "gold" };
  }
}
/** Link to the REAL mainnet asset (stellar.expert, read-only explorer). */
export const mainnetUrl = (a: ListedAsset) => a.mainnet?.expert ?? null;
/** "CODE-ISSUER" testnet key used by the SDEX pickers (XLM for native). */
export const testnetKey = (a: ListedAsset) => (a.testnet.kind === "native" ? "XLM" : `${a.testnet.code}-${a.testnet.issuer}`);
export const assetByTestnetKey = (key: string) => ASSET_LIST.find((a) => testnetKey(a) === key);

/** Search + category filter used by the asset picker. Matches code, name, org, domain, peg. */
export function filterAssets(list: ListedAsset[], query: string, category: AssetCategory | "all" = "all"): ListedAsset[] {
  const q = query.trim().toLowerCase();
  const out = list.filter((a) => category === "all" || a.category === category || (category === "stablecoin" && a.id === "QUSD"));
  if (!q) return out;
  const score = (a: ListedAsset) => {
    const code = a.code.toLowerCase();
    if (code === q) return 0;
    if (code.startsWith(q)) return 1;
    if (code.includes(q)) return 2;
    const hay = [a.name, a.org, a.mainnet?.homeDomain, a.peg, a.testnet.code].filter(Boolean).join(" ").toLowerCase();
    return hay.includes(q) ? 3 : 9;
  };
  return out.map((a) => [a, score(a)] as const).filter(([, s]) => s < 9).sort((x, y) => x[1] - y[1]).map(([a]) => a);
}

/** Grouped for display: base (XLM, QUSD) first, then stablecoins, then popular assets. */
export function groupAssets(list: ListedAsset[]) {
  const order: AssetCategory[] = ["base", "stablecoin", "popular"];
  return order.map((c) => ({ category: c, label: CATEGORY_LABEL[c], items: list.filter((a) => a.category === c) })).filter((g) => g.items.length);
}

/** The pool for an unordered pair (either side may be chosen first). */
export function findPool(a: string, b: string, pools: ListedPool[] = POOL_LIST): ListedPool | undefined {
  return pools.find((p) => (p.assetA === a && p.assetB === b) || (p.assetA === b && p.assetB === a));
}
/** Pools containing an asset (for "no direct pool — try these"). */
export const poolsWith = (id: string, pools: ListedPool[] = POOL_LIST) => pools.filter((p) => p.assetA === id || p.assetB === id);

/**
 * Router path between two assets over the listed pools: direct, else one hop
 * through a hub (XLM, USDC, QUSD). Returns pool ids in swap order, or null.
 * The v3 router is stateless: it swaps along whatever pool path it is given.
 */
export function findRoute(from: string, to: string, pools: ListedPool[] = POOL_LIST): { pools: string[]; via: string[] } | null {
  if (from === to) return null;
  const d = findPool(from, to, pools);
  if (d) return { pools: [d.pool!], via: [] };
  for (const hub of ["XLM", "USDC", "QUSD"]) {
    if (hub === from || hub === to) continue;
    const p1 = findPool(from, hub, pools), p2 = findPool(hub, to, pools);
    if (p1 && p2) return { pools: [p1.pool!, p2.pool!], via: [hub] };
  }
  const x = findPool(from, "XLM", pools), u = findPool("USDC", to, pools), xu = findPool("XLM", "USDC", pools);
  if (x && u && xu) return { pools: [x.pool!, xu.pool!, u.pool!], via: ["XLM", "USDC"] };
  return null;
}

/** Stable-vs-volatile pairs carry more impermanent-loss risk than stable-stable (same peg) pairs. */
export function ilRisk(a: ListedAsset | undefined, b: ListedAsset | undefined): "low" | "high" {
  if (!a || !b) return "high";
  const stable = (x: ListedAsset) => x.category === "stablecoin" || x.id === "QUSD";
  return stable(a) && stable(b) && a.peg === b.peg && !a.offPeg && !b.offPeg ? "low" : "high";
}

/** Symbol for a token contract (asset list only). */
export const symbolForSac = (sac: string) => bySac.get(sac)?.code;
