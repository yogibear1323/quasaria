/**
 * XLM (native Stellar Lumens) as a first-class listed asset: no issuer, never matched by ticker against credit assets.
 * Display fields come only from data we actually have; everything else is null so the UI shows a dash.
 */
export const XLM_CODE = "XLM";
export const XLM_NAME = "Stellar Lumens";
export const XLM_LOGO = `${import.meta.env.BASE_URL ?? "/"}tokens/xlm.svg`;

/** Does a Markets search string match the native asset? (empty matches). Code or name or "native" only; never an issuer. */
export function xlmMatches(q: string): boolean {
  const s = q.trim().toLowerCase();
  if (!s) return true;
  return "xlm".includes(s) || "stellar lumens".includes(s) || "lumens".includes(s) || "native".includes(s);
}

export type XlmRowData = { priceUsd: number | null; change24h: number | null; source: "live" | "snapshot" | "none" };
/** The XLM row's fields. `live`/`snapshot` come from the existing XLM/USD feed; change24h only exists for the live feed. */
export function xlmRowData(i: { usdPerXlm: number | null; change24h?: number | null; live: boolean }): XlmRowData {
  const priceUsd = i.usdPerXlm !== null && Number.isFinite(i.usdPerXlm) && i.usdPerXlm > 0 ? i.usdPerXlm : null;
  const change = i.live && priceUsd !== null && i.change24h !== undefined && i.change24h !== null && Number.isFinite(i.change24h) ? i.change24h : null;
  return { priceUsd, change24h: change, source: priceUsd === null ? "none" : i.live ? "live" : "snapshot" };
}
