/**
 * Stale-data circuit breaker (TESTNET). Halts NEW exposure the moment price data ages, instead of waiting for the
 * 30-min oracle kill. Two independent freshness sources, both must be fresh:
 *   1. the on-chain oracle timestamp (what the vault checks: it rejects prices older than max_price_age = 90 s), and
 *   2. the feed heartbeat file (epoch of the feed's last successful on-chain XLM push; written by lending/cli.ts).
 *
 * Levels (age = the older of the two sources):
 *   age <  blockAgeSec (60 s)        fresh
 *   age >= blockAgeSec (60 s)        BLOCK: entries / size increases halted (never sent near the vault's 90 s reject)
 *   age >= tripAgeSec  (90 s)        TRIP:  same effect, flagged as a hard trip (the vault itself would refuse)
 *   tripped for >= escalateAfterSec  ESCALATE: the caller fires the existing global kill (flatten + halt)
 * Once tripped, the breaker latches: it clears only after `clearAfterFresh` (3) consecutive fresh reads.
 * Clock jump (wall time advanced far more than the loop interval, e.g. VM suspend/resume): every cached read is
 * distrusted -> the breaker trips with reason "resume", the fresh-read counter restarts, and the escalation timer
 * restarts at the resume (the suspended time does not count towards the kill).
 * Reduce-only actions (close, stop/TP execution, protective trigger updates) are ALWAYS allowed.
 */
import { readFileSync } from "node:fs";

export interface StaleBreakerCfg {
  blockAgeSec: number;
  tripAgeSec: number;
  clearAfterFresh: number;
  escalateAfterSec: number;
  clockJumpSec: number;
  heartbeatFile?: string; // absent = on-chain timestamp only
}
export const DEFAULT_STALE_BREAKER: StaleBreakerCfg = { blockAgeSec: 60, tripAgeSec: 90, clearAfterFresh: 3, escalateAfterSec: 600, clockJumpSec: 180 };

export interface StaleBreakerState {
  tripped: boolean;
  level: "fresh" | "block" | "trip";
  reason: string;
  trippedSince: number; // 0 when not tripped
  freshCount: number;
  lastReadAt: number;
  lastOracleAgeSec: number | null;
  lastHeartbeatAgeSec: number | null;
  trips: number;
}
export const newBreakerState = (): StaleBreakerState => ({
  tripped: false, level: "fresh", reason: "", trippedSince: 0, freshCount: 0, lastReadAt: 0, lastOracleAgeSec: null, lastHeartbeatAgeSec: null, trips: 0,
});

export type OrderKind = "entry" | "increase" | "reduce" | "close" | "trigger";
export const isRiskIncreasing = (k: OrderKind) => k === "entry" || k === "increase";

export interface FreshRead {
  now: number;
  oracleTs: number | null; // null = unreadable (treated as stale)
  heartbeatTs: number | null; // null = file missing/unreadable (treated as stale when a heartbeat file is configured)
}
export interface ReadResult {
  state: StaleBreakerState;
  changed: "tripped" | "cleared" | null;
  escalate: boolean;
  age: number;
}

export function readHeartbeat(file: string | undefined): number | null {
  if (!file) return null;
  try {
    const v = Number(readFileSync(file, "utf8").trim());
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}

/** Pure state transition for one freshness read. */
export function observe(prev: StaleBreakerState, r: FreshRead, c: StaleBreakerCfg): ReadResult {
  const s: StaleBreakerState = { ...prev };
  const oAge = r.oracleTs === null ? Infinity : Math.max(0, r.now - r.oracleTs);
  const useHb = !!c.heartbeatFile;
  const hAge = !useHb ? 0 : r.heartbeatTs === null ? Infinity : Math.max(0, r.now - r.heartbeatTs);
  const age = Math.max(oAge, hAge);
  s.lastOracleAgeSec = Number.isFinite(oAge) ? oAge : null;
  s.lastHeartbeatAgeSec = useHb && Number.isFinite(hAge) ? hAge : null;
  const jumped = prev.lastReadAt > 0 && r.now - prev.lastReadAt > c.clockJumpSec;
  s.lastReadAt = r.now;
  const was = prev.tripped;
  const why = (lvl: string) => {
    const parts = [];
    if (oAge >= c.blockAgeSec) parts.push(r.oracleTs === null ? "on-chain oracle unreadable" : `on-chain oracle age ${oAge}s`);
    if (useHb && hAge >= c.blockAgeSec) parts.push(r.heartbeatTs === null ? "feed heartbeat missing" : `feed heartbeat age ${hAge}s`);
    return `${lvl} (>= ${lvl === "trip" ? c.tripAgeSec : c.blockAgeSec}s): ${parts.join(", ")}`;
  };

  if (jumped) {
    s.tripped = true;
    s.level = age >= c.tripAgeSec ? "trip" : "block";
    s.reason = `resume: clock jumped ${r.now - prev.lastReadAt}s; need ${c.clearAfterFresh} fresh reads`;
    s.trippedSince = r.now; // suspended time does not count towards escalation
    s.freshCount = age < c.blockAgeSec ? 1 : 0;
  } else if (age >= c.blockAgeSec) {
    s.level = age >= c.tripAgeSec ? "trip" : "block";
    s.reason = why(s.level);
    if (!s.tripped) (s.tripped = true), (s.trippedSince = r.now);
    s.freshCount = 0;
  } else if (s.tripped) {
    s.freshCount += 1;
    if (s.freshCount >= c.clearAfterFresh) (s.tripped = false), (s.level = "fresh"), (s.reason = ""), (s.trippedSince = 0);
    else s.reason = `recovering: ${s.freshCount}/${c.clearAfterFresh} fresh reads`;
  } else {
    s.level = "fresh";
    s.freshCount = Math.min(s.freshCount + 1, c.clearAfterFresh);
  }
  if (s.tripped && !was) s.trips += 1;
  const escalate = s.tripped && s.trippedSince > 0 && r.now - s.trippedSince >= c.escalateAfterSec;
  return { state: s, changed: s.tripped && !was ? "tripped" : !s.tripped && was ? "cleared" : null, escalate, age: Number.isFinite(age) ? age : -1 };
}

/** May an order of this kind be signed/submitted right now? Reduce-only and closes always may. */
export function allowOrder(s: StaleBreakerState, kind: OrderKind): { ok: true } | { ok: false; reason: string } {
  if (!isRiskIncreasing(kind)) return { ok: true };
  if (s.tripped) return { ok: false, reason: `STALE DATA · entries halted: ${s.reason}` };
  return { ok: true };
}

/** Label for status documents / the Back Office. */
export function breakerLabel(s: StaleBreakerState): string {
  return s.tripped ? `STALE DATA · entries halted (${s.level}) — ${s.reason}` : "fresh";
}
