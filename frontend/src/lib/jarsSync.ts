/**
 * Cross-device jar sync, behind JAR_SYNC_ENABLED (method approved by Robert 2026-10-26; UI in components/JarSync.tsx).
 *
 * The site is static (GitHub Pages), so the only shared store every device can reach is the user's own
 * Stellar account. Design: compact the ledger → deflate → AES-GCM encrypt with a key derived (PBKDF2-SHA256,
 * 210k rounds, salt = account address) from a sync passphrase the user sets → split into 64-byte
 * `manageData` values named `qj0`, `qj1`, … plus a `qjh` header (version, chunk count, nonce). One
 * user-signed transaction writes/clears entries. Each data entry is a subentry: 0.5 XLM reserve (returned when
 * the entry is removed) plus the normal network fee. Data is public on-chain but unreadable without the passphrase.
 * Local storage stays the working copy; the on-chain copy is only written when the user confirms "Sync now" and signs.
 * The passphrase is never stored: it lives in memory for the open tab only.
 */
import { Account, BASE_FEE, Operation, TransactionBuilder } from "@stellar/stellar-sdk";
import type { Jar, Ledger } from "./jarsLedger";

export const JAR_SYNC_ENABLED = true;
export const CHUNK = 64;
export const MAX_CHUNKS = 40; // ≈2.5 KB ciphertext, 20 XLM reserve ceiling
export const RESERVE_PER_ENTRY_XLM = 0.5;
const PREFIX = "qj";

/** Compact form: short keys, history capped to the last 20 entries per jar (tx links are kept). */
export function compact(l: Ledger) {
  return { v: 2, u: l.updated, g: (l.removed ?? []).map((r) => [r.id, r.ts] as [string, number]), j: l.jars.map((j) => [j.id, j.name, j.holding === "VAULT" ? 1 : 0, j.fund === "XLM" ? 1 : 0, j.units, j.costUsd, j.costXlm ?? "", j.targetUsd ?? "", j.date ?? "", j.created,
    j.history.slice(-20).map((e) => [e.ts, e.type, e.units ?? "", e.usd ?? "", e.tx ?? ""])]) };
}
export function expand(c: ReturnType<typeof compact>): Ledger {
  const removed = (c.g ?? []).map(([id, ts]) => ({ id, ts }));
  return { v: 2, updated: c.u, ...(removed.length ? { removed } : {}), jars: c.j.map((r) => {
    const [id, name, vault, xlm, units, costUsd, costXlm, targetUsd, date, created, h] = r as [string, string, number, number, string, string, string, string, string, number, [number, string, string, string, string][]];
    return { id, name, holding: vault ? "VAULT" : "USTRY", fund: xlm ? "XLM" : "USTRY", units, costUsd, costXlm: costXlm || undefined, targetUsd: targetUsd || undefined, date: date || undefined, created,
      history: h.map(([ts, type, u, usd, tx]) => ({ ts, type: type as Jar["history"][number]["type"], units: u || undefined, usd: usd || undefined, tx: tx || undefined })) } as Jar;
  }) };
}

async function pipe(data: Uint8Array, t: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const s = new Blob([data as BlobPart]).stream().pipeThrough(t as unknown as TransformStream<Uint8Array, Uint8Array>);
  return new Uint8Array(await new Response(s).arrayBuffer());
}
async function keyFor(passphrase: string, address: string) {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(passphrase), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt: new TextEncoder().encode(`quasaria-jars:${address}`), iterations: 210_000 }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

export async function sealLedger(l: Ledger, passphrase: string, address: string, iv = crypto.getRandomValues(new Uint8Array(12))): Promise<{ header: Uint8Array; chunks: Uint8Array[] }> {
  if (passphrase.length < 8) throw new Error("Use a sync passphrase of at least 8 characters");
  const z = await pipe(new TextEncoder().encode(JSON.stringify(compact(l))), new CompressionStream("deflate-raw"));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await keyFor(passphrase, address), z as BufferSource));
  const chunks: Uint8Array[] = [];
  for (let i = 0; i < ct.length; i += CHUNK) chunks.push(ct.slice(i, i + CHUNK));
  if (chunks.length > MAX_CHUNKS) throw new Error("Too much Snowbank history to sync; close or trim some Snowbanks");
  const header = new Uint8Array([1, chunks.length, ...iv]);
  return { header, chunks };
}
export async function openLedger(header: Uint8Array, chunks: Uint8Array[], passphrase: string, address: string): Promise<Ledger> {
  if (header[0] !== 1 || header[1] !== chunks.length) throw new Error("Sync data is incomplete");
  const ct = new Uint8Array(chunks.reduce((a, c) => a + c.length, 0)); let o = 0; for (const c of chunks) { ct.set(c, o); o += c.length; }
  const z = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: header.slice(2, 14) }, await keyFor(passphrase, address), ct));
  return expand(JSON.parse(new TextDecoder().decode(await pipe(z, new DecompressionStream("deflate-raw")))));
}

export type SyncCost = { entries: number; newEntries: number; reserveDeltaXlm: number; feeXlm: number };
export function syncCost(nextChunks: number, existingChunks: number, baseFeeStroops = Number(BASE_FEE), hasHeader = existingChunks > 0): SyncCost {
  const entries = nextChunks + 1, existing = existingChunks + (hasHeader ? 1 : 0);
  const ops = Math.max(entries, existing);
  return { entries, newEntries: Math.max(0, entries - existing), reserveDeltaXlm: (entries - existing) * RESERVE_PER_ENTRY_XLM, feeXlm: (ops * baseFeeStroops) / 1e7 };
}

/** Build (unsigned) the manageData transaction; stale higher chunks are deleted (value null) to free reserve. */
export function buildSyncTx(i: { source: string; sequence: string; passphrase: string; header: Uint8Array; chunks: Uint8Array[]; existingChunks: number }): string {
  if (!JAR_SYNC_ENABLED) throw new Error("Snowbank sync is not enabled yet");
  const b = new TransactionBuilder(new Account(i.source, i.sequence), { fee: BASE_FEE, networkPassphrase: i.passphrase }).setTimeout(180);
  b.addOperation(Operation.manageData({ name: `${PREFIX}h`, value: Buffer.from(i.header) }));
  i.chunks.forEach((c, k) => b.addOperation(Operation.manageData({ name: `${PREFIX}${k}`, value: Buffer.from(c) })));
  for (let k = i.chunks.length; k < i.existingChunks; k++) b.addOperation(Operation.manageData({ name: `${PREFIX}${k}`, value: null }));
  return b.build().toXDR();
}

/** Read back from a Horizon account's `data` map (base64 values). */
export function readSyncEntries(data: Record<string, string> | undefined): { header: Uint8Array; chunks: Uint8Array[] } | null {
  const d = data ?? {}, h = d[`${PREFIX}h`]; if (!h) return null;
  const header = Uint8Array.from(atob(h), (c) => c.charCodeAt(0));
  const chunks: Uint8Array[] = [];
  for (let k = 0; k < header[1]; k++) { const v = d[`${PREFIX}${k}`]; if (!v) return null; chunks.push(Uint8Array.from(atob(v), (c) => c.charCodeAt(0))); }
  return { header, chunks };
}

/** Every `qj<n>` chunk key on the account (including stale ones past the header's count). */
export function existingChunkCount(data: Record<string, string> | undefined): number {
  return Object.keys(data ?? {}).reduce((m, k) => { const x = /^qj(\d+)$/.exec(k); return x ? Math.max(m, Number(x[1]) + 1) : m; }, 0);
}
export const hasSyncHeader = (data: Record<string, string> | undefined) => !!(data ?? {})[`${PREFIX}h`];

/** Passphrase rules for setup (confirm given) or unlock (confirm omitted). Null = ok. */
export function passphraseProblem(p: string, confirm?: string): string | null {
  if (p.length < 8) return "Use at least 8 characters";
  if (confirm !== undefined && p !== confirm) return "The two passphrases don't match";
  return null;
}

/** Remove every sync entry (header + all chunks). Frees their reserve. Unsigned. */
export function buildClearTx(i: { source: string; sequence: string; passphrase: string; data: Record<string, string> | undefined }): string {
  if (!JAR_SYNC_ENABLED) throw new Error("Snowbank sync is not enabled yet");
  const keys = Object.keys(i.data ?? {}).filter((k) => /^qj(h|\d+)$/.test(k));
  if (!keys.length) throw new Error("There is no synced Snowbank data on this account");
  const b = new TransactionBuilder(new Account(i.source, i.sequence), { fee: BASE_FEE, networkPassphrase: i.passphrase }).setTimeout(180);
  keys.forEach((name) => b.addOperation(Operation.manageData({ name, value: null })));
  return b.build().toXDR();
}

/** Can the account pay for this sync? `availableXlm` = spendable XLM after the current minimum balance. */
export function affordProblem(c: SyncCost, availableXlm: number | null): string | null {
  if (availableXlm === null) return "Couldn't read your XLM balance; try again";
  const need = Math.max(0, c.reserveDeltaXlm) + c.feeXlm;
  return need > availableXlm ? `This sync needs ${need.toFixed(5)} XLM free (reserve + fee); you have ${availableXlm.toFixed(5)} XLM spendable` : null;
}

const lastTouch = (j: Jar) => j.history.reduce((m, e) => Math.max(m, e.ts), j.created);

export type MergeResult = { ledger: Ledger; added: string[]; updated: string[]; removed: string[]; changedLocal: boolean; changedRemote: boolean };
/**
 * Merge the on-chain ledger into the local one. Jars match by id (never by name), so nothing is duplicated.
 * Conflict rule: the copy with the most recent activity wins (latest history timestamp; tie → longer history,
 * then local). A jar closed on either device stays closed unless it had activity after it was closed.
 */
export function mergeLedgers(local: Ledger, remote: Ledger): MergeResult {
  const tomb = new Map<string, number>();
  for (const r of [...(local.removed ?? []), ...(remote.removed ?? [])]) tomb.set(r.id, Math.max(tomb.get(r.id) ?? 0, r.ts));
  const L = new Map(local.jars.map((j) => [j.id, j])), R = new Map(remote.jars.map((j) => [j.id, j]));
  const ids = [...local.jars.map((j) => j.id), ...remote.jars.map((j) => j.id).filter((id) => !L.has(id))];
  const added: string[] = [], updated: string[] = [], removed: string[] = [];
  let changedRemote = false;
  const jars: Jar[] = [];
  for (const id of ids) {
    const a = L.get(id), b = R.get(id);
    let w: Jar;
    if (a && b) {
      const ta = lastTouch(a), tb = lastTouch(b);
      w = tb > ta || (tb === ta && b.history.length > a.history.length) ? b : a;
      if (w === b && JSON.stringify(a) !== JSON.stringify(b)) updated.push(b.name);
      if (w === a && JSON.stringify(a) !== JSON.stringify(b)) changedRemote = true;
    } else w = (a ?? b)!;
    const t = tomb.get(id);
    if (t !== undefined && lastTouch(w) <= t) { if (a) removed.push(a.name); if (b) changedRemote = true; continue; }
    if (!a) added.push(w.name);
    if (!b) changedRemote = true;
    jars.push(w);
  }
  const tombs = [...tomb].map(([id, ts]) => ({ id, ts }));
  if ((remote.removed ?? []).length !== tombs.length) changedRemote = true;
  const ledger: Ledger = { v: 2, jars, updated: Math.max(local.updated, remote.updated), ...(tombs.length ? { removed: tombs } : {}) };
  return { ledger, added, updated, removed, changedLocal: added.length + updated.length + removed.length > 0, changedRemote };
}
