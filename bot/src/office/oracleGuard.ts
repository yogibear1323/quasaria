/**
 * Independent oracle check (fleet-wide). The feed writes timestamp=0 ("now"), so on-chain freshness only proves the
 * feeder ran; we compare against an independent reference (Coinbase/Kraken XLM-USD) and watch for a flat price.
 */
export interface OracleGuardCfg {
  warnAgeSec: number;
  haltAgeSec: number;
  staleFlatSec: number;
  warnDevPct: number;
  haltDevPct: number;
}
export interface OracleSample {
  t: number;
  oracle: number;
  ref: number | null;
}
export interface OracleVerdict {
  level: "ok" | "warn" | "halt";
  reasons: string[];
  ageSec: number;
  deviationPct: number | null;
}

export function oracleVerdict(now: number, oracleTs: number, history: OracleSample[], c: OracleGuardCfg): OracleVerdict {
  const reasons: string[] = [];
  let level: OracleVerdict["level"] = "ok";
  const bump = (l: "warn" | "halt", r: string) => {
    reasons.push(r);
    if (l === "halt" || level === "ok") level = l;
  };
  const age = Math.max(0, now - oracleTs);
  if (age > c.haltAgeSec) bump("halt", `oracle age ${age}s > ${c.haltAgeSec}s`);
  else if (age > c.warnAgeSec) bump("warn", `oracle age ${age}s > ${c.warnAgeSec}s`);
  const cur = history[history.length - 1];
  let dev: number | null = null;
  if (cur && cur.ref) {
    dev = (Math.abs(cur.oracle - cur.ref) / cur.ref) * 100;
    if (dev > c.haltDevPct) bump("halt", `oracle ${cur.oracle.toFixed(5)} vs reference ${cur.ref.toFixed(5)}: ${dev.toFixed(2)}% > ${c.haltDevPct}%`);
    else if (dev > c.warnDevPct) bump("warn", `deviation ${dev.toFixed(2)}% > ${c.warnDevPct}%`);
  } else {
    const lastRef = [...history].reverse().find((h) => h.ref);
    if (!lastRef || now - lastRef.t > 600) bump("halt", "no independent reference price for > 10 min");
    else bump("warn", "reference price unavailable");
  }
  // flat oracle while the reference moved
  const win = history.filter((h) => h.t >= now - c.staleFlatSec);
  if (cur && win.length >= 2 && now - win[0].t >= c.staleFlatSec * 0.9) {
    const flat = win.every((h) => h.oracle === cur.oracle);
    const refs = win.map((h) => h.ref).filter((x): x is number => !!x);
    const refMove = refs.length >= 2 ? (Math.abs(refs[refs.length - 1] - refs[0]) / refs[0]) * 100 : 0;
    if (flat && refMove > 0.3) bump("halt", `oracle flat ${c.staleFlatSec}s while reference moved ${refMove.toFixed(2)}%`);
  }
  return { level, reasons, ageSec: age, deviationPct: dev };
}
