/** Read-only Horizon helpers for the rewards scripts (no keys here). Plain fetch, polite paging. */
import { parseStroops, ASSET_CODE, classifyMemo } from "./core.mjs";

export const HORIZON = { testnet: "https://horizon-testnet.stellar.org", mainnet: "https://horizon.stellar.org" };
export const PASSPHRASE = { testnet: "Test SDF Network ; September 2015", mainnet: "Public Global Stellar Network ; September 2015" };

export function client(net, f = fetch) {
  const base = HORIZON[net];
  const get = async (path, tries = 4) => {
    const url = path.startsWith("http") ? path : `${base}${path}`;
    for (let i = 0; i < tries; i++) {
      const r = await f(url, { headers: { Accept: "application/json" } });
      if (r.status === 404) return null;
      if (r.status === 429 || r.status >= 500) { await new Promise((res) => setTimeout(res, 800 * (i + 1))); continue; }
      if (!r.ok) throw new Error(`Horizon ${r.status} for ${url}`);
      return r.json();
    }
    throw new Error(`Horizon kept failing for ${url}`);
  };
  return { net, base, get };
}

/** Every account with a GLACIERQ trustline: address -> { stroops, data, sequence }. Pages of 200. */
export async function fetchHolders(h, issuer, { maxPages = 500 } = {}) {
  const out = new Map();
  let url = `/accounts?asset=${ASSET_CODE}:${issuer}&limit=200`;
  for (let p = 0; url && p < maxPages; p++) {
    const j = await h.get(url);
    const recs = j?._embedded?.records ?? [];
    for (const a of recs) {
      const b = a.balances.find((x) => x.asset_code === ASSET_CODE && x.asset_issuer === issuer);
      if (b) out.set(a.id, { stroops: parseStroops(b.balance), data: a.data ?? {} });
    }
    url = recs.length === 200 ? j._links.next.href : null;
  }
  return out;
}

export async function fetchBalance(h, addr, issuer) {
  const a = await h.get(`/accounts/${addr}`);
  if (!a) return null;
  const b = a.balances.find((x) => x.asset_code === ASSET_CODE && x.asset_issuer === issuer);
  return b ? parseStroops(b.balance) : null; // null = no trustline
}

/** Addresses already paid with exactly this memo by `payer` (newest first, stops once older than `day`). Idempotency from the chain itself. */
export async function fetchPaidWithMemo(h, payer, issuer, memo, day) {
  const paid = new Map();
  let url = `/accounts/${payer}/payments?order=desc&limit=200&join=transactions`;
  for (let p = 0; url && p < 60; p++) {
    const j = await h.get(url);
    const recs = j?._embedded?.records ?? [];
    let older = false;
    for (const r of recs) {
      if (r.created_at.slice(0, 10) < day) { older = true; break; }
      if (r.type === "payment" && r.from === payer && r.asset_code === ASSET_CODE && r.asset_issuer === issuer && r.transaction?.memo === memo) paid.set(r.to, (paid.get(r.to) ?? 0n) + parseStroops(r.amount));
    }
    url = !older && recs.length === 200 ? j._links.next.href : null;
  }
  return paid;
}

/** Everything `payer` has ever paid per memo kind, summed per recipient. Used for the per-referral lifetime caps. */
export async function fetchLifetimePaid(h, payer, issuer, kind, { maxPages = 400 } = {}) {
  const sums = new Map();
  let url = `/accounts/${payer}/payments?order=desc&limit=200&join=transactions`;
  for (let p = 0; url && p < maxPages; p++) {
    const j = await h.get(url);
    const recs = j?._embedded?.records ?? [];
    for (const r of recs) {
      if (r.type !== "payment" || r.from !== payer || r.asset_code !== ASSET_CODE || r.asset_issuer !== issuer) continue;
      const c = classifyMemo(r.transaction?.memo);
      if (c?.kind === kind) sums.set(r.to, (sums.get(r.to) ?? 0n) + parseStroops(r.amount));
    }
    url = recs.length === 200 ? j._links.next.href : null;
  }
  return sums;
}

const G = /^G[A-Z2-7]{55}$/;
/**
 * Referral binding of an account: the EARLIEST valid `quasaria:ref` manage_data operation wins (first binding wins),
 * and it only counts while the entry is still present on the account. Returns { referrer, boundDay, createdDay } or null.
 */
export async function fetchBinding(h, addr, currentData) {
  const cur = currentData?.["quasaria:ref"];
  if (!cur) return null;
  let url = `/accounts/${addr}/operations?order=asc&limit=200`;
  let createdDay = null, first = null;
  for (let p = 0; url && p < 20 && !first; p++) {
    const j = await h.get(url);
    const recs = j?._embedded?.records ?? [];
    for (const o of recs) {
      if (!createdDay && (o.type === "create_account" || o.type === "payment" || o.type === "change_trust")) createdDay = o.created_at.slice(0, 10);
      if (o.type === "manage_data" && o.name === "quasaria:ref" && o.value) {
        const v = Buffer.from(o.value, "base64").toString("utf8");
        if (G.test(v) && o.source_account === addr) { first = { referrer: v, boundDay: o.created_at.slice(0, 10) }; break; }
      }
    }
    url = recs.length === 200 ? j._links.next.href : null;
  }
  return first ? { ...first, createdDay } : null;
}

export async function fetchAccountCreatedDay(h, addr) {
  const j = await h.get(`/accounts/${addr}/operations?order=asc&limit=1`);
  const o = j?._embedded?.records?.[0];
  return o ? o.created_at.slice(0, 10) : null;
}
