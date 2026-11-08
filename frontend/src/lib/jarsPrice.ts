/**
 * USD prices for Savings Jars. USTRY: Etherfuse's own NAV API (the same source the USTRY keeper uses as its
 * primary). XLM/USD: the XLM/USDC (Circle) order-book mid on mainnet Horizon, as the header ticker does.
 * The rate shown is Etherfuse's live `current_basis_points` (variable, reset weekly), never a fixed number.
 */
import { fetchXlmUsd } from "./liveMarkets";

export const ETHERFUSE_USTRY_URL = "https://api.etherfuse.com/lookup/tokens/cost/USTRY";
export const STALE_MS = 30 * 60_000;
export type UstryPrice = { usd: number; ratePct: number | null; at: number };
export type JarPrices = { ustry: UstryPrice | null; xlmUsd: { price: number; at: number } | null };

/** Etherfuse `updated_at` is unix seconds. A 13-digit value is already milliseconds. */
export function etherfuseTimeMs(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n >= 1e12 ? n : n * 1000;
}
export function parseEtherfuse(j: unknown): UstryPrice | null {
  const o = j as { token_cost_in_usd?: string; current_basis_points?: number; current_time?: string; sources?: Record<string, { updated_at?: number }> };
  const usd = Number(o?.token_cost_in_usd);
  if (!(usd > 0.5 && usd < 5)) return null; // sanity band around $1 NAV
  const ups = Object.values(o.sources ?? {}).map((s) => etherfuseTimeMs(s?.updated_at)).filter((n) => n > 0);
  const at = ups.length ? Math.max(...ups) : Date.parse(o.current_time ?? "") || 0;
  const bp = Number(o.current_basis_points);
  return { usd, ratePct: Number.isFinite(bp) && bp >= 0 && bp < 5000 ? bp / 100 : null, at };
}

/** Public Etherfuse weekly rate. Not the vault's on-chain oracle price, and not a figure Quasaria computes. */
export function ustryRateLabel(p: UstryPrice | null): string {
  if (p?.ratePct == null) return "USTRY weekly rate unavailable";
  return `Etherfuse weekly rate: ${p.ratePct.toFixed(2)}% APY · public quote, variable, reset weekly`;
}

/** Public token price age. A missing quote is unavailable, not a stale on-chain price. */
export function ustryPriceAgeLabel(p: UstryPrice | null, now = Date.now()): { text: string; stale: boolean } {
  if (!p?.at) return { text: "Public USTRY price unavailable", stale: true };
  const stale = isStale(p.at, now);
  const m = Math.round((now - p.at) / 60_000);
  const age = m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 48 * 60 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`;
  return { text: `${stale ? "Stale public price" : "Public USTRY price"} · ${age}`, stale };
}
export async function fetchUstryPrice(f: typeof fetch = fetch): Promise<UstryPrice | null> {
  const r = await f(ETHERFUSE_USTRY_URL, { headers: { Accept: "application/json" } });
  if (!r.ok) return null;
  return parseEtherfuse(await r.json());
}
export async function loadJarPrices(): Promise<JarPrices> {
  const [u, x] = await Promise.allSettled([fetchUstryPrice(), fetchXlmUsd()]);
  return { ustry: u.status === "fulfilled" ? u.value : null, xlmUsd: x.status === "fulfilled" && x.value.price != null ? { price: x.value.price as number, at: x.value.at } : null };
}
export const isStale = (at: number | undefined, now = Date.now()) => !at || now - at > STALE_MS;
