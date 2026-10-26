import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { Keypair, Networks, TransactionBuilder } from "@stellar/stellar-sdk";
import { closeJar, createJar, deposit, emptyLedger, renameJar, type Ledger } from "../src/lib/jarsLedger";
import {
  JAR_SYNC_ENABLED, affordProblem, buildClearTx, buildSyncTx, compact, existingChunkCount, expand, hasSyncHeader, mergeLedgers, openLedger,
  passphraseProblem, readSyncEntries, sealLedger, syncCost,
} from "../src/lib/jarsSync";
import { JarSyncView, WARNING, type SyncViewState, type SyncViewActions } from "../src/components/JarSync";

const X = (v: number) => BigInt(Math.round(v * 1e7));
let r = 0; const rnd = () => ((r = (r + 0.137) % 1) || 0.5);
const id = (l: Ledger, n: string) => l.jars.find((j) => j.name === n)!.id;
const base = (): Ledger => { r = 0; let l = createJar(emptyLedger(0), { name: "Ski", fund: "XLM" }, 1, rnd); l = createJar(l, { name: "Car", fund: "USTRY" }, 2, rnd); return l; };
const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
const toData = (h: Uint8Array, c: Uint8Array[]) => { const d: Record<string, string> = { qjh: b64(h) }; c.forEach((x, k) => (d[`qj${k}`] = b64(x))); return d; };
const ADDR = Keypair.random().publicKey();
const noop: SyncViewActions = { setup() {}, unlock() {}, lock() {}, saveMerge() {}, dismissMerge() {}, prepare() {}, confirm() {}, cancel() {} };
const st = (o: Partial<SyncViewState> = {}): SyncViewState => ({ remote: false, unlocked: false, entries: 0, busy: false, error: null, info: null, merge: null, review: null, lastTx: null, ...o });
const html = (s: SyncViewState) => renderToStaticMarkup(<JarSyncView s={s} a={noop} />);
const text = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ");

describe("passphrase rules", () => {
  it("needs 8+ characters and a matching confirm on setup", () => {
    expect(passphraseProblem("short")).toMatch(/8/);
    expect(passphraseProblem("longenough")).toBeNull();
    expect(passphraseProblem("longenough", "longenougH")).toMatch(/match/);
    expect(passphraseProblem("longenough", "longenough")).toBeNull();
  });
  it("is never written to storage by the sync code", () => {
    const src = readFileSync("src/components/JarSync.tsx", "utf8") + readFileSync("src/lib/jarsSync.ts", "utf8");
    expect(src).not.toMatch(/localStorage|sessionStorage|indexedDB|document\.cookie/);
  });
});

describe("merge on load", () => {
  it("adds jars only on the other device, without duplicates (matched by id, not name)", () => {
    const local = base();
    const remote = createJar(local, { name: "Ski", fund: "USTRY" }, 5, rnd); // same NAME, different jar
    const m = mergeLedgers(local, remote);
    expect(m.ledger.jars).toHaveLength(3);
    expect(new Set(m.ledger.jars.map((j) => j.id)).size).toBe(3);
    expect(m.added).toEqual(["Ski"]); expect(m.changedLocal).toBe(true);
    expect(mergeLedgers(m.ledger, m.ledger).changedLocal).toBe(false);
  });
  it("conflict: the copy with the latest activity wins", () => {
    const l0 = base(); const ski = id(l0, "Ski");
    const local = renameJar(l0, ski, "Ski trip", 10);
    const remote = deposit(l0, ski, { units: X(1), usd: X(1.08) }, 20);
    const m = mergeLedgers(local, remote);
    expect(m.ledger.jars.find((j) => j.id === ski)!.units).toBe(X(1).toString());
    expect(m.updated).toEqual(["Ski"]);
    const m2 = mergeLedgers(remote, local); // local newer → keeps local, remote needs a sync
    expect(m2.ledger.jars.find((j) => j.id === ski)!.units).toBe(X(1).toString());
    expect(m2.changedLocal).toBe(false); expect(m2.changedRemote).toBe(true); // other device's copy is stale
    const m3 = mergeLedgers(renameJar(l0, ski, "Late", 30), remote);
    expect(m3.changedLocal).toBe(false); expect(m3.changedRemote).toBe(true);
  });
  it("a jar closed on another device stays closed; local-only jars are kept and flagged for upload", () => {
    const l0 = base(); const car = id(l0, "Car");
    const remote = closeJar(l0, car, 50);
    const m = mergeLedgers(l0, remote);
    expect(m.ledger.jars.map((j) => j.name)).toEqual(["Ski"]); expect(m.removed).toEqual(["Car"]);
    const local = createJar(l0, { name: "New", fund: "XLM" }, 60, rnd);
    const m2 = mergeLedgers(local, l0);
    expect(m2.changedLocal).toBe(false); expect(m2.changedRemote).toBe(true);
  });
  it("tombstones survive the encrypted round trip", async () => {
    const l = closeJar(base(), id(base(), "Car"), 9);
    expect(expand(compact(l)).removed).toEqual([{ id: id(base(), "Car"), ts: 9 }]);
    const { header, chunks } = await sealLedger(l, "correct horse", ADDR);
    const e = readSyncEntries(toData(header, chunks))!;
    const back = await openLedger(e.header, e.chunks, "correct horse", ADDR);
    expect(back.removed).toEqual(l.removed);
    expect(mergeLedgers(base(), back).ledger.jars.map((j) => j.name)).toEqual(["Ski"]);
  });
});

describe("sync transaction + cost", () => {
  it("cost: 0.5 XLM per entry, a couple of jars ≈ 2 XLM, rewrites refund stale entries", async () => {
    const { chunks } = await sealLedger(base(), "correct horse", ADDR);
    const c = syncCost(chunks.length, 0, 100, false);
    expect(c.entries).toBe(chunks.length + 1); expect(c.reserveDeltaXlm).toBe(c.entries * 0.5);
    expect(c.reserveDeltaXlm).toBeLessThanOrEqual(2.5);
    expect(syncCost(2, 5, 100, true).reserveDeltaXlm).toBe(-1.5);
    expect(syncCost(3, 3, 100, true).reserveDeltaXlm).toBe(0);
  });
  it("counts existing entries including stale chunks", () => {
    expect(existingChunkCount({ qjh: "x", qj0: "a", qj1: "b", qj4: "c", other: "z" })).toBe(5);
    expect(hasSyncHeader({ qj0: "a" })).toBe(false); expect(hasSyncHeader(undefined)).toBe(false);
  });
  it("blocks a sync the account can't afford", () => {
    expect(affordProblem({ entries: 4, newEntries: 4, reserveDeltaXlm: 2, feeXlm: 0.0004 }, 1)).toMatch(/needs 2\.0004/);
    expect(affordProblem({ entries: 4, newEntries: 4, reserveDeltaXlm: 2, feeXlm: 0.0004 }, 5)).toBeNull();
    expect(affordProblem({ entries: 0, newEntries: 0, reserveDeltaXlm: -2, feeXlm: 0.0004 }, 0.001)).toBeNull();
    expect(affordProblem({ entries: 1, newEntries: 1, reserveDeltaXlm: 0.5, feeXlm: 0 }, null)).toMatch(/balance/);
  });
  it("builds unsigned manageData txs; stale chunks deleted; clear removes everything", async () => {
    const { header, chunks } = await sealLedger(base(), "correct horse", ADDR);
    const t = TransactionBuilder.fromXDR(buildSyncTx({ source: ADDR, sequence: "1", passphrase: Networks.PUBLIC, header, chunks, existingChunks: chunks.length + 2 }), Networks.PUBLIC);
    expect(t.signatures).toHaveLength(0);
    const ops = t.operations as { type: string; name: string; value?: unknown }[];
    expect(ops.every((o) => o.type === "manageData")).toBe(true);
    expect(ops.length).toBe(1 + chunks.length + 2);
    expect(ops.slice(-2).every((o) => o.value == null)).toBe(true);
    const c = TransactionBuilder.fromXDR(buildClearTx({ source: ADDR, sequence: "1", passphrase: Networks.PUBLIC, data: { qjh: "x", qj0: "y", foo: "z" } }), Networks.PUBLIC);
    expect((c.operations as { name: string; value?: unknown }[]).map((o) => [o.name, o.value ?? null])).toEqual([["qjh", null], ["qj0", null]]);
    expect(() => buildClearTx({ source: ADDR, sequence: "1", passphrase: Networks.PUBLIC, data: {} })).toThrow(/no synced/);
  });
});

describe("sync UI", () => {
  it("flag gates the panel", () => {
    expect(JAR_SYNC_ENABLED).toBe(true);
    expect(readFileSync("src/components/SavingsJars.tsx", "utf8")).toMatch(/JAR_SYNC_ENABLED && <JarSync /);
  });
  it("setup: passphrase + confirm, unrecoverable warning, reserve explained", () => {
    const h = html(st());
    expect(h).toContain('data-testid="jar-sync-confirm"'); expect(h).toContain('type="password"');
    expect(text(h)).toContain(WARNING.split(",")[0]);
    expect(text(h)).toMatch(/0\.5 XLM of reserve \(about 2 XLM for a couple of jars, 20 XLM at most\)/);
  });
  it("unlock when synced data exists: single field, prompts merge", () => {
    const h = html(st({ remote: true, entries: 4 }));
    expect(h).not.toContain('data-testid="jar-sync-confirm"');
    expect(text(h)).toMatch(/Synced jars were found/); expect(text(h)).toContain("Unlock");
  });
  it("merge offer lists changes and blocks Sync now until saved", () => {
    const b0 = base(); const m = mergeLedgers(b0, createJar(b0, { name: "Boat", fund: "XLM" }, 9, rnd));
    const h = html(st({ remote: true, unlocked: true, merge: m }));
    expect(text(h)).toMatch(/Add Boat/); expect(h).toContain("jar-sync-merge-save");
    expect(h).toMatch(/data-testid="jar-sync-now" disabled=""/);
  });
  it("review shows reserve change and network fee BEFORE signing", () => {
    const h = text(html(st({ unlocked: true, review: { kind: "sync", cost: { entries: 4, newEntries: 4, reserveDeltaXlm: 2, feeXlm: 0.0004 } } })));
    expect(h).toMatch(/Reserve change \+2 XLM locked/); expect(h).toMatch(/Network fee 0\.0004 XLM/); expect(h).toContain("Confirm & sign");
    const c = text(html(st({ unlocked: true, remote: true, review: { kind: "clear", cost: { entries: 0, newEntries: 0, reserveDeltaXlm: -2, feeXlm: 0.0004 } } })));
    expect(c).toMatch(/2 XLM returned to you/);
  });
  it("shows errors clearly", () => {
    expect(html(st({ error: "Wrong passphrase, or the synced data is damaged." }))).toMatch(/role="alert"[^>]*>Wrong passphrase/);
  });
  it("links only to StellarChain.io", () => {
    const h = html(st({ unlocked: true, info: "Jars synced to your account.", lastTx: "a".repeat(64) }));
    expect(h).toMatch(/stellarchain\.io/); expect(h).not.toMatch(/stellar\.expert|stellarscan/);
  });
});
