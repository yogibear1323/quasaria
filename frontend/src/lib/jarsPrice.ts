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

export function parseEtherfuse(j: unknown): UstryPrice | null {
  const o = j as { token_cost_in_usd?: string; current_basis_points?: number; current_time?: string; sources?: Record<string, { updated_at?: number }> };
  const usd = Number(o?.token_cost_in_usd);
  if (!(usd > 0.5 && usd < 5)) return null; // sanity band around $1 NAV
  const ups = Object.values(o.sources ?? {}).map((s) => Number(s.updated_at) * 1000).filter((n) => n > 0);
  const at = ups.length ? Math.max(...ups) : Date.parse(o.current_time ?? "") || 0;
  const bp = Number(o.current_basis_points);
  return { usd, ratePct: Number.isFinite(bp) && bp >= 0 && bp < 5000 ? bp / 100 : null, at };
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
