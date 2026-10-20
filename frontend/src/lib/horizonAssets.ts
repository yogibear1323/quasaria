/**
 * Uncapped Horizon /assets browser: cursor pagination (200 per page, Horizon's max) and server-side search by
 * asset_code (exact, Horizon semantics) or asset_issuer (a G... address). Pure fetch helpers, no React.
 */
export const HORIZON_PAGE = 200;
export type HAsset = { code: string; issuer: string; type: string; trustlines: number; amount: string; pools: number; toml: string | null; pagingToken: string };
export type HPage = { records: HAsset[]; next: string | null };

type Raw = { asset_code: string; asset_issuer: string; asset_type: string; paging_token: string; accounts?: { authorized?: number }; balances?: { authorized?: string }; amount?: string; num_liquidity_pools?: number; _links?: { toml?: { href?: string } } };

export const isAccountId = (s: string) => /^G[A-Z2-7]{55}$/.test(s.trim());
/** A Horizon asset_code is 1-12 alphanumerics. */
export const isAssetCode = (s: string) => /^[a-zA-Z0-9]{1,12}$/.test(s.trim());

export function assetsUrl(horizon: string, q = "", cursor?: string | null): string {
  const u = new URL(`${horizon.replace(/\/$/, "")}/assets`);
  u.searchParams.set("limit", String(HORIZON_PAGE));
  u.searchParams.set("order", "asc");
  const s = q.trim();
  if (s) {
    if (isAccountId(s)) u.searchParams.set("asset_issuer", s.toUpperCase());
    else if (s.includes(":") || s.includes("-")) {
      const [c, i] = s.split(/[:-]/);
      if (c) u.searchParams.set("asset_code", c);
      if (i && isAccountId(i)) u.searchParams.set("asset_issuer", i.toUpperCase());
    } else u.searchParams.set("asset_code", s);
  }
  if (cursor) u.searchParams.set("cursor", cursor);
  return u.toString();
}

export const parseRecord = (r: Raw): HAsset => ({
  code: r.asset_code, issuer: r.asset_issuer, type: r.asset_type, pagingToken: r.paging_token,
  trustlines: r.accounts?.authorized ?? 0, amount: r.balances?.authorized ?? r.amount ?? "0", pools: r.num_liquidity_pools ?? 0,
  toml: r._links?.toml?.href || null,
});

export async function fetchAssetsPage(horizon: string, q = "", cursor?: string | null, f: typeof fetch = fetch): Promise<HPage> {
  const r = await f(assetsUrl(horizon, q, cursor), { headers: { Accept: "application/json" } });
  if (!r.ok) throw new Error(`Horizon /assets ${r.status}`);
  const d = (await r.json()) as { _embedded: { records: Raw[] } };
  const records = d._embedded.records.map(parseRecord);
  // Horizon keeps returning a next link; the end is a short (or empty) page.
  const next = records.length === HORIZON_PAGE ? records[records.length - 1].pagingToken : null;
  return { records, next };
}

/** Total mainnet assets, counted offline (see PR notes) — shown with its source and date. */
export const MAINNET_ASSET_TOTAL = {
  stellarExpert: { count: 510635, source: "StellarExpert ledger-stats (sum of daily new_assets)", asOf: "2026-10-20" },
} as const;
