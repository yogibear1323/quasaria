/** On-box state: per-desk journal state, fleet state, append-only event journal, control commands. Never committed. */
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ClosedTrade } from "./drift.js";
import type { DeskStatus, Side } from "./types.js";

export const officeHome = () => process.env.QUASARIA_OFFICE_HOME ?? join(homedir(), ".quasaria-office");

export interface JournalOpen {
  id: number;
  side: Side;
  entry: number;
  decisionPrice: number;
  stop: number;
  takeProfit: number;
  size: number;
  margin: number;
  leverage: number;
  riskAmount: number;
  openedAt: number;
  reason: string;
  openTx: string;
  lastPendingFunding: number;
}
export interface JournalClosed extends ClosedTrade {
  id: number;
  side: Side;
  entry: number;
  exit: number;
  size: number;
  reason: string;
  tx: string;
}
export interface DeskState {
  status: DeskStatus;
  statusReason: string;
  manualPause: boolean;
  pausedUntil: number;
  peakEquity: number;
  dayStart: { day: number; equity: number };
  startEquity: number;
  lossStreak: number;
  entryTimes: number[];
  txAttempts: number[];
  txFailures: number[];
  lastBarT: number;
  lastSignal: string;
  open: Record<string, JournalOpen>;
  closed: JournalClosed[];
}
export interface FleetStateFile {
  killed: boolean;
  killReason: string;
  killedAt: number;
  peakEquity: number;
  dayStart: { day: number; equity: number };
  startEquity: number;
  oracleBadSince: number;
  oracleHistory: { t: number; oracle: number; ref: number | null }[];
  stale?: import("./staleBreaker.js").StaleBreakerState;
  fundingSamples: { t: number; hourly: number }[];
  lastTrendEntry: number;
  fleetPaused: string;
}

export const newDeskState = (): DeskState => ({
  status: "running", statusReason: "", manualPause: false, pausedUntil: 0, peakEquity: 0, dayStart: { day: -1, equity: 0 }, startEquity: 0,
  lossStreak: 0, entryTimes: [], txAttempts: [], txFailures: [], lastBarT: 0, lastSignal: "", open: {}, closed: [],
});
export const newFleetState = (): FleetStateFile => ({
  killed: false, killReason: "", killedAt: 0, peakEquity: 0, dayStart: { day: -1, equity: 0 }, startEquity: 0, oracleBadSince: 0,
  oracleHistory: [], fundingSamples: [], lastTrendEntry: 0, fleetPaused: "",
});

export type Command = { cmd: "pause" | "resume" | "flatten" | "halt" | "reset"; desk: string; by?: string } | { cmd: "kill" | "unkill"; by?: string; reason?: string };

export class Store {
  readonly dir: string;
  constructor(dir = join(officeHome(), "state")) {
    this.dir = dir;
    for (const d of [dir, join(dir, "control")]) mkdirSync(d, { recursive: true, mode: 0o700 });
  }
  private path(name: string) {
    return join(this.dir, name);
  }
  private readJson<T>(name: string, def: () => T): T {
    const p = this.path(name);
    if (!existsSync(p)) return def();
    try {
      return { ...def(), ...(JSON.parse(readFileSync(p, "utf8")) as T) };
    } catch {
      return def();
    }
  }
  writeJson(name: string, v: unknown) {
    const p = this.path(name);
    writeFileSync(`${p}.tmp`, JSON.stringify(v, null, 1), { mode: 0o600 });
    renameSync(`${p}.tmp`, p);
  }
  desk(id: string) {
    return this.readJson<DeskState>(`desk-${id}.json`, newDeskState);
  }
  saveDesk(id: string, s: DeskState) {
    s.entryTimes = s.entryTimes.slice(-200);
    s.txAttempts = s.txAttempts.slice(-500);
    s.txFailures = s.txFailures.slice(-500);
    s.closed = s.closed.slice(-500);
    this.writeJson(`desk-${id}.json`, s);
  }
  fleet() {
    return this.readJson<FleetStateFile>("fleet.json", newFleetState);
  }
  saveFleet(f: FleetStateFile) {
    f.oracleHistory = f.oracleHistory.slice(-240);
    f.fundingSamples = f.fundingSamples.slice(-72);
    this.writeJson("fleet.json", f);
  }
  journal(e: Record<string, unknown>) {
    appendFileSync(this.path("journal.jsonl"), JSON.stringify({ at: new Date().toISOString(), ...e }) + "\n", { mode: 0o600 });
  }
  /** A KILL file is the out-of-band global kill switch (touch it, or `office kill`). */
  killFlag() {
    return existsSync(this.path("KILL"));
  }
  setKillFlag(reason: string) {
    writeFileSync(this.path("KILL"), reason + "\n", { mode: 0o600 });
  }
  clearKillFlag() {
    rmSync(this.path("KILL"), { force: true });
  }
  enqueue(c: Command) {
    const name = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`;
    writeFileSync(join(this.dir, "control", name), JSON.stringify(c), { mode: 0o600 });
  }
  drain(): Command[] {
    const dir = join(this.dir, "control");
    const out: Command[] = [];
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".json")).sort()) {
      try {
        out.push(JSON.parse(readFileSync(join(dir, f), "utf8")) as Command);
      } catch {
        /* ignore malformed */
      }
      rmSync(join(dir, f), { force: true });
    }
    return out;
  }
}

/** Journal vs chain: which journal positions closed (with their event), which are unexplained, which chain positions are unknown. */
export function reconcile(journalIds: number[], chainIds: number[], events: { id: number }[]) {
  const chain = new Set(chainIds);
  const known = new Set(journalIds);
  const ev = new Map(events.map((e) => [e.id, e]));
  const closed: number[] = [], missing: number[] = [];
  for (const id of journalIds) if (!chain.has(id)) (ev.has(id) ? closed : missing).push(id);
  const unknown = chainIds.filter((id) => !known.has(id));
  return { closed, missing, unknown };
}
