export const fmt = (n: number, d = 2) =>
  Number.isFinite(n) ? n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }) : "—";
export const fmtCompact = (n: number) =>
  Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(n);
export const pct = (bps: number, d = 2) => `${fmt(bps / 100, d)}%`;
export const short = (addr: string, n = 4) => (addr ? `${addr.slice(0, n)}…${addr.slice(-n)}` : "");
/** Stroops / 7-decimal fixed point to number. */
export const fromUnits = (v: bigint | number | string, decimals = 7) => Number(BigInt(v)) / 10 ** decimals;
export const toUnits = (v: number, decimals = 7) => BigInt(Math.round(v * 10 ** decimals));
/** Exact decimal string -> 7-decimal fixed point (no float rounding). Throws on bad input. */
export function parseUnits(s: string, decimals = 7): bigint {
  const t = s.trim();
  const m = /^(\d*)(?:\.(\d*))?$/.exec(t);
  if (!m || (!m[1] && !m[2])) throw new Error(`invalid amount: ${s}`);
  const frac = (m[2] ?? "").slice(0, decimals).padEnd(decimals, "0");
  return BigInt(m[1] || "0") * 10n ** BigInt(decimals) + BigInt(frac || "0");
}
