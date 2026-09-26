export const fmt = (n: number, d = 2) =>
  Number.isFinite(n) ? n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }) : "—";
export const fmtCompact = (n: number) =>
  Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(n);
export const pct = (bps: number, d = 2) => `${fmt(bps / 100, d)}%`;
export const short = (addr: string, n = 4) => (addr ? `${addr.slice(0, n)}…${addr.slice(-n)}` : "");
/** Stroops / 7-decimal fixed point to number. */
export const fromUnits = (v: bigint | number | string, decimals = 7) => Number(BigInt(v)) / 10 ** decimals;
export const toUnits = (v: number, decimals = 7) => BigInt(Math.round(v * 10 ** decimals));
