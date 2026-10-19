/**
 * Facts for the native-XLM About panel. Everything shown comes from Horizon (live) or the SDF Dashboard API (a saved copy,
 * because that API sends no CORS headers); anything unavailable is null and the UI shows a dash.
 */
export type LedgerFacts = { sequence: number; closedAt: string; protocol: number | null; baseFeeStroops: number | null; baseReserveXlm: number | null; feePoolXlm: number | null; avgCloseSeconds: number | null };
export type SupplySnapshot = { savedAt: string; totalSupply: number | null; circulatingSupply: number | null; originalSupply: number | null; source: string };

type HorizonLedger = { sequence?: number; closed_at?: string; protocol_version?: number; base_fee_in_stroops?: number; base_reserve_in_stroops?: number; fee_pool?: string };

const num = (v: unknown): number | null => {
  const n = typeof v === "string" || typeof v === "number" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

/** Newest-first Horizon ledger records → facts. Average close time is measured from the records, never assumed. */
export function parseLedgers(records: HorizonLedger[]): LedgerFacts | null {
  const r = records[0];
  if (!r || typeof r.sequence !== "number" || !r.closed_at) return null;
  const times = records.map((x) => Date.parse(x.closed_at ?? "")).filter(Number.isFinite);
  const avg = times.length >= 2 ? (times[0] - times[times.length - 1]) / 1000 / (times.length - 1) : null;
  const reserve = num(r.base_reserve_in_stroops);
  return {
    sequence: r.sequence,
    closedAt: r.closed_at,
    protocol: num(r.protocol_version),
    baseFeeStroops: num(r.base_fee_in_stroops),
    baseReserveXlm: reserve === null ? null : reserve / 1e7,
    feePoolXlm: num(r.fee_pool),
    avgCloseSeconds: avg !== null && avg > 0 ? Math.round(avg * 10) / 10 : null,
  };
}

export function parseSupply(j: unknown): SupplySnapshot | null {
  const o = (j ?? {}) as Record<string, unknown>;
  if (typeof o.savedAt !== "string") return null;
  return { savedAt: o.savedAt, totalSupply: num(o.totalSupply), circulatingSupply: num(o.circulatingSupply), originalSupply: num(o.originalSupply), source: typeof o.source === "string" ? o.source : "" };
}

export async function loadXlmAbout(base = import.meta.env.BASE_URL ?? "/"): Promise<{ ledger: LedgerFacts | null; supply: SupplySnapshot | null }> {
  const [ledger, supply] = await Promise.all([
    fetch("https://horizon.stellar.org/ledgers?order=desc&limit=6").then((r) => (r.ok ? r.json() : null)).then((j) => (j ? parseLedgers(j._embedded?.records ?? []) : null)).catch(() => null),
    fetch(`${base}data/xlm-supply.json`).then((r) => (r.ok ? r.json() : null)).then(parseSupply).catch(() => null),
  ]);
  return { ledger, supply };
}
