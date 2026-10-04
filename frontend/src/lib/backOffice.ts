/**
 * Back Office read model (public, read-only):
 *  - positions + trades straight from the chain (vault `user_positions`/`position`/`pending_funding`, `pos_open`/`pos_close` events
 *    filtered by each desk's owner account) — trustless;
 *  - off-chain bot state (running/paused/halted, drift score, risk used, last signal) from the runner's published
 *    status JSON on the repo's `bot-status` branch (raw.githubusercontent.com, CDN-cached ~5 min).
 */
import { scValToNative, xdr } from "@stellar/stellar-sdk";
import cfg from "../config/back-office.json";
import { scanEvents } from "./chain";
import { readContract, addr, u64 } from "./soroban";
import { PERPS, marketKeyScVal } from "./perps";

export type Strategy = "trend" | "funding" | "meanrev";
export type DeskStatus = "running" | "paused" | "halted" | "unknown";
export interface DeskCfg {
  id: string;
  name: string;
  strategy: Strategy;
  timeframeSec: number;
  riskPct: number;
  maxLeverage: number;
  capital: number;
  owner: string;
  operator: string;
}
export const BACK_OFFICE = cfg as { statusUrl: string; limits: Record<string, number>; desks: DeskCfg[] };
export const STRATEGY_LABEL: Record<Strategy, string> = { trend: "Trend", funding: "Funding", meanrev: "Mean-Rev" };
export const tfLabel = (s: number) => (s >= 3600 ? `${s / 3600}h` : `${s / 60}m`);

const UNIT = 1e7;

export interface ChainPos {
  id: number;
  side: "long" | "short";
  margin: number;
  size: number;
  leverage: number;
  entry: number;
  stop: number;
  takeProfit: number;
  pendingFunding: number;
  upnl: number;
}
export interface ChainTrade {
  kind: "open" | "close";
  id: number;
  side?: "long" | "short";
  leverage?: number;
  price: number;
  pnl?: number;
  reason?: string;
  ledger: number;
  at: string;
  tx: string;
}
export interface ChainDesk {
  free: number;
  positions: ChainPos[];
  equity: number;
}
export interface ChainFloor {
  price: number | null;
  priceTs: number | null;
  desks: Record<string, ChainDesk>;
  readAt: number;
}

type Read = <T>(c: string, m: string, a?: xdr.ScVal[]) => Promise<T>;

export async function readFloorOnChain(read: Read = readContract as Read, desks: DeskCfg[] = BACK_OFFICE.desks, vault = PERPS.vault): Promise<ChainFloor> {
  const oracle = await read<string>(vault, "oracle").catch(() => PERPS.fallbackOracle);
  const [decimals, pd] = await Promise.all([
    read<number>(oracle, "decimals").catch(() => 14),
    read<{ price: bigint; timestamp: bigint } | null>(oracle, "lastprice", [marketKeyScVal(PERPS.markets[0].key)]).catch(() => null),
  ]);
  const scale = 10 ** Number(decimals);
  const price = pd ? Number(pd.price) / scale : null;
  const out: Record<string, ChainDesk> = {};
  await Promise.all(
    desks.map(async (d) => {
      const [free, ids] = await Promise.all([read<bigint>(vault, "free_collateral", [addr(d.owner)]), read<bigint[]>(vault, "user_positions", [addr(d.owner)])]);
      const positions = await Promise.all(
        ids.map(async (i) => {
          const [p, pf] = await Promise.all([
            read<{ id: bigint; is_long: boolean; margin: bigint; size: bigint; entry_price: bigint; stop_loss: bigint; take_profit: bigint }>(vault, "position", [u64(i)]),
            read<bigint>(vault, "pending_funding", [u64(i)]).catch(() => 0n),
          ]);
          const margin = Number(p.margin) / UNIT, size = Number(p.size) / UNIT, entry = Number(p.entry_price) / scale;
          const side = p.is_long ? "long" : "short";
          const pnl = price ? ((side === "long" ? price - entry : entry - price) / entry) * size : 0;
          return { id: Number(p.id), side, margin, size, leverage: margin ? size / margin : 0, entry, stop: Number(p.stop_loss) / scale, takeProfit: Number(p.take_profit) / scale, pendingFunding: Number(pf) / UNIT, upnl: pnl - Number(pf) / UNIT } as ChainPos;
        }),
      );
      const f = Number(free) / UNIT;
      out[d.id] = { free: f, positions, equity: f + positions.reduce((a, p) => a + p.margin + p.upnl, 0) };
    }),
  );
  return { price, priceTs: pd ? Number(pd.timestamp) : null, desks: out, readAt: Date.now() / 1000 };
}

/** Recent pos_open / pos_close events for the desk owners (RPC keeps ~7 days). */
export async function readFloorTrades(desks: DeskCfg[] = BACK_OFFICE.desks, vault = PERPS.vault, scale = 1e14): Promise<Record<string, ChainTrade[]>> {
  const owners = new Map(desks.map((d) => [d.owner, d.id]));
  const t = (s: string) => xdr.ScVal.scvSymbol(s).toXDR("base64");
  const events = await scanEvents([{ type: "contract", contractIds: [vault], topics: [[t("pos_open"), "*"], [t("pos_close"), "*"]] }], 120_000, 30);
  const out: Record<string, ChainTrade[]> = Object.fromEntries(desks.map((d) => [d.id, []]));
  for (const e of events) {
    const topic = e.topic.map((x) => scValToNative(x));
    const desk = owners.get(String(topic[1]));
    if (!desk) continue;
    const v = scValToNative(e.value) as Record<string, bigint | boolean | string>;
    if (topic[0] === "pos_open") {
      const margin = Number(v.margin) / UNIT, size = Number(v.size) / UNIT;
      out[desk].push({ kind: "open", id: Number(v.id), side: v.is_long ? "long" : "short", leverage: margin ? size / margin : 0, price: Number(v.entry_price) / scale, ledger: e.ledger, at: e.ledgerClosedAt, tx: e.txHash });
    } else out[desk].push({ kind: "close", id: Number(v.id), price: Number(v.exit_price) / scale, pnl: Number(v.pnl) / UNIT, reason: String(v.reason), ledger: e.ledger, at: e.ledgerClosedAt, tx: e.txHash });
  }
  for (const k of Object.keys(out)) out[k].sort((a, b) => b.ledger - a.ledger);
  return out;
}

// ---------------------------------------------------------------- status feed
export interface StatusDesk {
  id: string;
  status: DeskStatus;
  reason: string;
  equity: number;
  startEquity: number;
  pnlToday: number;
  pnlTotal: number;
  riskPct: number;
  dailyLossPct: number;
  dailyLimitPct: number;
  drawdownPct: number;
  drawdownLimitPct: number;
  drift: { score: number; level: "green" | "amber" | "red"; top: string } | null;
  lastSignal: string;
  spark: number[];
}
export interface StatusDoc {
  schema: string;
  generatedAt: string;
  mode: string;
  driftMode: string;
  fleet: { status: "running" | "paused" | "killed"; reason: string; equity: number; startEquity: number; pnlToday: number; pnlTotal: number; riskUsedPct: number; riskCapPct: number; openPositions: number; maxPositions: number; netSide: string; drawdownPct: number; drawdownLimitPct: number };
  market: { oraclePrice: number; oracleAgeSec: number; referencePrice: number | null; deviationPct: number | null; oracleLevel: string; fundingPredictedHourly: number; reserve: number };
  desks: StatusDesk[];
}

export async function fetchStatus(url = BACK_OFFICE.statusUrl, f: typeof fetch = fetch): Promise<StatusDoc> {
  const r = await f(`${url}?t=${Math.floor(Date.now() / 60_000)}`, { cache: "no-store" });
  if (!r.ok) throw new Error(`status feed HTTP ${r.status}`);
  const j = (await r.json()) as StatusDoc;
  if (j.schema !== "quasaria-back-office/status@1") throw new Error("unexpected status schema");
  return j;
}

/** Status age in seconds and whether it is too old to trust (> 15 min: runner down or CDN stale). */
export function statusAge(s: StatusDoc | null, now = Date.now() / 1000) {
  if (!s) return { age: null as number | null, stale: true };
  const age = Math.max(0, now - Date.parse(s.generatedAt) / 1000);
  return { age, stale: age > 900 };
}

// ---------------------------------------------------------------- merged desk view
export interface DeskView {
  cfg: DeskCfg;
  status: DeskStatus;
  reason: string;
  equity: number | null;
  pnl: number | null; // since start (chain equity - capital)
  positions: ChainPos[];
  trades: ChainTrade[];
  drift: StatusDesk["drift"];
  dailyLossPct: number | null;
  drawdownPct: number | null;
  lastSignal: string;
  spark: number[];
}

export function mergeDesks(desks: DeskCfg[], chain: ChainFloor | null, status: StatusDoc | null, trades: Record<string, ChainTrade[]> | null, stale: boolean): DeskView[] {
  return desks.map((d) => {
    const c = chain?.desks[d.id];
    const s = status?.desks.find((x) => x.id === d.id);
    const fleetKilled = status?.fleet.status === "killed" && !stale;
    const st: DeskStatus = !s || stale ? "unknown" : fleetKilled ? "halted" : s.status;
    const equity = c ? c.equity : s ? s.equity : null;
    return {
      cfg: d,
      status: st,
      reason: fleetKilled ? `global kill: ${status!.fleet.reason}` : s?.reason ?? "",
      equity,
      pnl: equity === null ? null : equity - (s?.startEquity || d.capital),
      positions: c?.positions ?? [],
      trades: trades?.[d.id] ?? [],
      drift: s?.drift ?? null,
      dailyLossPct: s?.dailyLossPct ?? null,
      drawdownPct: s?.drawdownPct ?? null,
      lastSignal: s?.lastSignal ?? "",
      spark: s?.spark ?? [],
    };
  });
}

export function sparkPath(v: number[], w = 150, h = 46) {
  if (v.length < 2) return { line: "", area: "", last: null as null | [number, number] };
  const lo = Math.min(...v), hi = Math.max(...v);
  const pts = v.map((x, i) => [(i * w) / (v.length - 1), h - 4 - ((x - lo) / (hi - lo || 1)) * (h - 8)] as [number, number]);
  const line = "M" + pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" L");
  return { line, area: `${line} L${w},${h} L0,${h} Z`, last: pts[pts.length - 1] };
}
