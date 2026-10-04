/**
 * Demo persistence + one-demo-per-browser cap. localStorage is shared by every tab of this origin; creation runs under a
 * Web Lock when available (check-then-write is atomic across tabs), and other tabs learn about it via `storage` events.
 * Only one tab (the "runner", heartbeat lease) advances the simulation; the rest render what it saves.
 * Limitation (by design, no server): the cap is per browser profile, not per person.
 */
import { newDemo, validateBalance, type DemoState } from "./engine";

export const DEMO_KEY = "quasaria.demo.v1";
export const RUNNER_KEY = "quasaria.demo.runner";
export const LEASE_SEC = 45;

export interface KV {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
}
export interface Locks {
  request<T>(name: string, cb: () => T | Promise<T>): Promise<T>;
}

export function loadDemo(kv: KV): DemoState | null {
  try {
    const raw = kv.getItem(DEMO_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as DemoState;
    return s && s.v === 1 && typeof s.id === "string" && s.desks ? s : null;
  } catch {
    return null;
  }
}

export type CreateResult = { ok: true; demo: DemoState } | { ok: false; reason: "exists" | "invalid"; message: string; demo?: DemoState };

/** Synchronous core: refuses when a demo already exists in this browser. */
export function createDemo(kv: KV, balanceInput: unknown, now: number, id: string): CreateResult {
  const v = validateBalance(balanceInput);
  if (!v.ok) return { ok: false, reason: "invalid", message: v.reason };
  const existing = loadDemo(kv);
  if (existing) return { ok: false, reason: "exists", message: "You already have a demo open — close it to start a new one.", demo: existing };
  const demo = newDemo(v.value, now, id);
  kv.setItem(DEMO_KEY, JSON.stringify(demo));
  return { ok: true, demo };
}

/** Cross-tab safe create: serialised by a Web Lock when the browser has one. */
export async function createDemoLocked(kv: KV, balanceInput: unknown, now: number, id: string, locks: Locks | null | undefined): Promise<CreateResult> {
  const run = () => createDemo(kv, balanceInput, now, id);
  return locks ? locks.request("quasaria-demo-create", run) : run();
}

/** Save only if the stored demo is still this one (a closed demo is never resurrected by a stale tab). */
export function saveDemo(kv: KV, s: DemoState): boolean {
  const cur = loadDemo(kv);
  if (!cur || cur.id !== s.id) return false;
  kv.setItem(DEMO_KEY, JSON.stringify(s));
  return true;
}

export function closeDemo(kv: KV) {
  kv.removeItem(DEMO_KEY);
  kv.removeItem(RUNNER_KEY);
}

/** Heartbeat lease: returns true if `tab` is (or just became) the runner. */
export function claimRunner(kv: KV, tab: string, now: number): boolean {
  let cur: { tab: string; at: number } | null = null;
  try {
    cur = JSON.parse(kv.getItem(RUNNER_KEY) ?? "null");
  } catch {
    cur = null;
  }
  if (cur && cur.tab !== tab && now - cur.at < LEASE_SEC) return false;
  kv.setItem(RUNNER_KEY, JSON.stringify({ tab, at: now }));
  return true;
}
export function releaseRunner(kv: KV, tab: string) {
  try {
    const cur = JSON.parse(kv.getItem(RUNNER_KEY) ?? "null");
    if (cur?.tab === tab) kv.removeItem(RUNNER_KEY);
  } catch {
    /* ignore */
  }
}

export const randomId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `d${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`);
