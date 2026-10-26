/**
 * Cross-device jar sync — PROPOSAL, behind JAR_SYNC_ENABLED (off until Robert approves).
 *
 * The site is static (GitHub Pages), so the only shared store every device can reach is the user's own
 * Stellar account. Design: compact the ledger → deflate → AES-GCM encrypt with a key derived (PBKDF2-SHA256,
 * 210k rounds, salt = account address) from a sync passphrase the user sets → split into 64-byte
 * `manageData` values named `qj0`, `qj1`, … plus a `qjh` header (version, chunk count, nonce). One
 * user-signed transaction writes/clears entries. Each data entry is a subentry: 0.5 XLM reserve (returned when
 * the entry is removed) plus the normal network fee. Data is public on-chain but unreadable without the passphrase.
 * Local storage stays the source of truth while the flag is off.
 */
import { Account, BASE_FEE, Operation, TransactionBuilder } from "@stellar/stellar-sdk";
import type { Jar, Ledger } from "./jarsLedger";

export const JAR_SYNC_ENABLED = false;
export const CHUNK = 64;
export const MAX_CHUNKS = 40; // ≈2.5 KB ciphertext, 20 XLM reserve ceiling
export const RESERVE_PER_ENTRY_XLM = 0.5;
const PREFIX = "qj";

/** Compact form: short keys, history capped to the last 20 entries per jar (tx links are kept). */
export function compact(l: Ledger) {
  return { v: 2, u: l.updated, j: l.jars.map((j) => [j.id, j.name, j.holding === "VAULT" ? 1 : 0, j.fund === "XLM" ? 1 : 0, j.units, j.costUsd, j.costXlm ?? "", j.targetUsd ?? "", j.date ?? "", j.created,
    j.history.slice(-20).map((e) => [e.ts, e.type, e.units ?? "", e.usd ?? "", e.tx ?? ""])]) };
}
export function expand(c: ReturnType<typeof compact>): Ledger {
  return { v: 2, updated: c.u, jars: c.j.map((r) => {
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
  if (chunks.length > MAX_CHUNKS) throw new Error("Too much jar history to sync; close or trim some jars");
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
export function syncCost(nextChunks: number, existingChunks: number, baseFeeStroops = Number(BASE_FEE)): SyncCost {
  const entries = nextChunks + 1, existing = existingChunks ? existingChunks + 1 : 0;
  const ops = Math.max(entries, existing);
  return { entries, newEntries: Math.max(0, entries - existing), reserveDeltaXlm: (entries - existing) * RESERVE_PER_ENTRY_XLM, feeXlm: (ops * baseFeeStroops) / 1e7 };
}

/** Build (unsigned) the manageData transaction; stale higher chunks are deleted (value null) to free reserve. */
export function buildSyncTx(i: { source: string; sequence: string; passphrase: string; header: Uint8Array; chunks: Uint8Array[]; existingChunks: number }): string {
  if (!JAR_SYNC_ENABLED) throw new Error("Jar sync is not enabled yet");
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
