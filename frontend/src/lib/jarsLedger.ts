/**
 * Savings Jars v1 ledger (spec: specs/savings-jars-xlm-ustry.md §4, §6b).
 *
 * Jars are LABELS on balances the user already owns. Nothing here is on-chain and no contract
 * holds jar funds. Two kinds of holdings:
 *  - "USTRY": an earmark on Etherfuse USTRY in the user's own wallet. A jar is funded either with
 *    USTRY already in the wallet (`fund: "USTRY"`) or with XLM that is swapped into USTRY at
 *    deposit time by a user-signed path payment (`fund: "XLM"`). Either way the jar holds USTRY units.
 *  - "VAULT": legacy (pre-v1) jars that hold Yield Vault shares. Migrated as-is so existing users
 *    keep their jars; they can still be withdrawn through the vault but take no new deposits.
 *
 * All amounts are 7-decimal integers stored as strings: units (USTRY or vault shares) and USD
 * (1e7 = $1). Cost basis is what the user paid, in USD at the time of each deposit.
 */
export const SCALE = 10_000_000n;
export type Holding = "USTRY" | "VAULT";
export type Fund = "XLM" | "USTRY";
export type EntryType = "create" | "deposit" | "withdraw" | "move-in" | "move-out" | "scale" | "rename" | "migrate" | "assign";
export type Entry = { ts: number; type: EntryType; units?: string; usd?: string; xlm?: string; tx?: string; note?: string };
export type Jar = {
  id: string; name: string; holding: Holding; fund: Fund;
  units: string; costUsd: string; costXlm?: string;
  targetUsd?: string; date?: string; created: number; history: Entry[];
};
/** `removed`: tombstones for closed jars so a cross-device merge does not bring them back. */
export type Ledger = { v: 2; jars: Jar[]; updated: number; removed?: { id: string; ts: number }[] };

const B = (s: string | undefined) => BigInt(s ?? "0");
const S = (v: bigint) => v.toString();
export const emptyLedger = (now = Date.now()): Ledger => ({ v: 2, jars: [], updated: now });

const v1Key = (a: string) => `quasaria.jars.v1.${a}`;
const v2Key = (a: string) => `quasaria.jars.v2.${a}`;

type V1Jar = { id: string; name: string; target: string; date?: string; shares: string; principal: string; created: number };

/**
 * v1 → v2: every old jar becomes a VAULT jar with its shares and XLM principal kept exactly.
 * The old XLM target can't be priced in USD reliably, so it moves to `note` and the USD target is left
 * for the user to set; the v1 key is left untouched (rollback-safe).
 */
export function migrateV1(v1: V1Jar[], now = Date.now()): Ledger {
  const jars: Jar[] = v1.filter((j) => j && typeof j.id === "string" && typeof j.name === "string").map((j) => ({
    id: j.id, name: j.name, holding: "VAULT", fund: "XLM",
    units: safeInt(j.shares), costUsd: "0", costXlm: safeInt(j.principal),
    date: j.date, created: Number(j.created) || now,
    history: [{ ts: now, type: "migrate", units: safeInt(j.shares), xlm: safeInt(j.principal), note: `Moved from the old Snowbanks (target ${fmt7(B(safeInt(j.target)))} XLM)` }],
  }));
  return { v: 2, jars, updated: now };
}
function safeInt(s: unknown) { try { const v = BigInt(String(s ?? "0")); return v < 0n ? "0" : S(v); } catch { return "0"; } }
export const fmt7 = (v: bigint) => (Number(v) / 1e7).toLocaleString("en-US", { maximumFractionDigits: 7 });

export function loadLedger(address: string, store: Pick<Storage, "getItem"> = localStorage, now = Date.now()): Ledger {
  try {
    const raw = store.getItem(v2Key(address));
    if (raw) { const l = JSON.parse(raw); if (l && l.v === 2 && Array.isArray(l.jars)) return l; }
  } catch { /* fall through to migration */ }
  try {
    const old = JSON.parse(store.getItem(v1Key(address)) ?? "[]");
    if (Array.isArray(old) && old.length) return migrateV1(old, now);
  } catch { /* corrupt v1: start empty */ }
  return emptyLedger(now);
}
export function saveLedger(address: string, l: Ledger, store: Pick<Storage, "setItem"> = localStorage) {
  store.setItem(v2Key(address), JSON.stringify(l));
}

const touch = (l: Ledger, jars: Jar[], now: number): Ledger => ({ ...l, jars, updated: now });
const mapJar = (l: Ledger, id: string, f: (j: Jar) => Jar, now: number) => {
  if (!l.jars.some((j) => j.id === id)) throw new Error("Snowbank not found");
  return touch(l, l.jars.map((j) => (j.id === id ? f(j) : j)), now);
};

export function createJar(l: Ledger, i: { name: string; fund: Fund; targetUsd?: bigint; date?: string }, now = Date.now(), rnd = Math.random): Ledger {
  const name = i.name.trim().slice(0, 40);
  if (!name) throw new Error("Give the Snowbank a name");
  if (i.fund !== "XLM" && i.fund !== "USTRY") throw new Error("Snowbanks take XLM or USTRY only");
  if (i.targetUsd !== undefined && i.targetUsd <= 0n) throw new Error("Target must be above $0");
  const j: Jar = { id: `${now.toString(36)}${rnd().toString(36).slice(2, 6)}`, name, holding: "USTRY", fund: i.fund, units: "0", costUsd: "0",
    targetUsd: i.targetUsd !== undefined ? S(i.targetUsd) : undefined, date: i.date || undefined, created: now, history: [{ ts: now, type: "create", note: `Funded with ${i.fund}` }] };
  return touch(l, [...l.jars, j], now);
}

export function renameJar(l: Ledger, id: string, name: string, now = Date.now()): Ledger {
  const n = name.trim().slice(0, 40); if (!n) throw new Error("Give the Snowbank a name");
  return mapJar(l, id, (j) => ({ ...j, name: n, history: [...j.history, { ts: now, type: "rename", note: `${j.name} → ${n}` }] }), now);
}

/** Confirmed deposit: add units and their USD cost (for XLM-funded jars, the XLM actually sent priced at XLM/USD). */
export function deposit(l: Ledger, id: string, d: { units: bigint; usd: bigint; xlm?: bigint; tx?: string; type?: "deposit" | "assign" }, now = Date.now()): Ledger {
  if (d.units <= 0n) throw new Error("Amount must be above 0");
  if (d.usd < 0n) throw new Error("Bad cost");
  return mapJar(l, id, (j) => {
    if (j.holding !== "USTRY") throw new Error("Old vault Snowbanks take no new deposits");
    return { ...j, units: S(B(j.units) + d.units), costUsd: S(B(j.costUsd) + d.usd), costXlm: d.xlm !== undefined ? S(B(j.costXlm) + d.xlm) : j.costXlm,
      history: [...j.history, { ts: now, type: d.type ?? "deposit", units: S(d.units), usd: S(d.usd), xlm: d.xlm !== undefined ? S(d.xlm) : undefined, tx: d.tx }] };
  }, now);
}

/** Take `units` out of a jar with cost basis reduced pro rata. Returns the jar and the cost removed. */
function take(j: Jar, units: bigint): { jar: Jar; usd: bigint; xlm: bigint } {
  const u = B(j.units);
  if (units <= 0n || units > u) throw new Error("Not that much in this Snowbank");
  const usd = units === u ? B(j.costUsd) : (B(j.costUsd) * units) / u;
  const xlm = units === u ? B(j.costXlm) : (B(j.costXlm) * units) / u;
  return { jar: { ...j, units: S(u - units), costUsd: S(B(j.costUsd) - usd), costXlm: j.costXlm !== undefined ? S(B(j.costXlm) - xlm) : undefined }, usd, xlm };
}

/** Withdraw: for USTRY jars this just releases the earmark back to Unassigned (no transaction). */
export function withdraw(l: Ledger, id: string, units: bigint, tx?: string, now = Date.now()): Ledger {
  return mapJar(l, id, (j) => { const t = take(j, units); return { ...t.jar, history: [...j.history, { ts: now, type: "withdraw", units: S(units), usd: S(t.usd), tx }] }; }, now);
}

/** Free off-chain relabel between jars of the same holding; cost basis moves pro rata. */
export function moveUnits(l: Ledger, fromId: string, toId: string, units: bigint, now = Date.now()): Ledger {
  if (fromId === toId) throw new Error("Pick a different Snowbank");
  const a = l.jars.find((j) => j.id === fromId), b = l.jars.find((j) => j.id === toId);
  if (!a || !b) throw new Error("Snowbank not found");
  if (a.holding !== b.holding) throw new Error("Moves only work between Snowbanks of the same asset");
  const t = take(a, units);
  const nb: Jar = { ...b, units: S(B(b.units) + units), costUsd: S(B(b.costUsd) + t.usd), costXlm: b.costXlm !== undefined || t.xlm > 0n ? S(B(b.costXlm) + t.xlm) : undefined,
    history: [...b.history, { ts: now, type: "move-in", units: S(units), usd: S(t.usd), note: `from ${a.name}` }] };
  const na: Jar = { ...t.jar, history: [...a.history, { ts: now, type: "move-out", units: S(units), usd: S(t.usd), note: `to ${b.name}` }] };
  return touch(l, l.jars.map((j) => (j.id === fromId ? na : j.id === toId ? nb : j)), now);
}

export function closeJar(l: Ledger, id: string, now = Date.now()): Ledger {
  const j = l.jars.find((k) => k.id === id); if (!j) throw new Error("Snowbank not found");
  if (B(j.units) > 0n) throw new Error("Empty the Snowbank first (move or withdraw its balance)");
  return { ...touch(l, l.jars.filter((k) => k.id !== id), now), removed: [...(l.removed ?? []).filter((r) => r.id !== id), { id, ts: now }] };
}

export const allocated = (l: Ledger, h: Holding) => l.jars.filter((j) => j.holding === h).reduce((a, j) => a + B(j.units), 0n);

export type Allocation = { wallet: bigint; allocated: bigint; unassigned: bigint; shortfall: bigint };
/** Unassigned is consumed first: a shortfall only exists once jars claim more than the wallet holds. */
export function allocation(l: Ledger, h: Holding, wallet: bigint): Allocation {
  const a = allocated(l, h), d = wallet - a;
  return { wallet, allocated: a, unassigned: d > 0n ? d : 0n, shortfall: d < 0n ? -d : 0n };
}

/**
 * Resolve a shortfall. With `absorbId`, that jar absorbs as much as it can first and any remainder is
 * spread pro rata over the rest; otherwise every jar of the holding scales down pro rata. Cost basis
 * falls in proportion. Rounding is floored per jar and the dust is taken from the largest jar so the
 * total lands exactly on the wallet balance.
 */
export function resolveShortfall(l: Ledger, h: Holding, wallet: bigint, absorbId?: string, now = Date.now()): Ledger {
  let { shortfall } = allocation(l, h, wallet < 0n ? 0n : wallet);
  if (shortfall === 0n) return l;
  let jars = l.jars.slice();
  const note = (j: Jar, cut: bigint, usd: bigint, why: string): Jar => ({ ...j, history: [...j.history, { ts: now, type: "scale", units: S(cut), usd: S(usd), note: why }] });
  if (absorbId) {
    const idx = jars.findIndex((j) => j.id === absorbId && j.holding === h);
    if (idx < 0) throw new Error("Pick a Snowbank of the same asset");
    const cut = B(jars[idx].units) < shortfall ? B(jars[idx].units) : shortfall;
    if (cut > 0n) { const t = take(jars[idx], cut); jars[idx] = note(t.jar, cut, t.usd, "Wallet balance fell below Snowbanks; you chose this Snowbank to absorb it"); shortfall -= cut; }
  }
  if (shortfall > 0n) {
    const ids = jars.map((j, i) => (j.holding === h && B(j.units) > 0n ? i : -1)).filter((i) => i >= 0);
    const tot = ids.reduce((a, i) => a + B(jars[i].units), 0n);
    const target = tot - shortfall;
    const kept = ids.map((i) => (B(jars[i].units) * target) / tot);
    let dust = target - kept.reduce((a, v) => a + v, 0n);
    // hand floored dust back to the largest jars so the sum is exact
    const order = ids.map((_, k) => k).sort((x, y) => (B(jars[ids[y]].units) > B(jars[ids[x]].units) ? 1 : -1));
    for (const k of order) { if (dust <= 0n) break; kept[k] += 1n; dust -= 1n; }
    ids.forEach((i, k) => {
      const cut = B(jars[i].units) - kept[k];
      if (cut > 0n) { const t = take(jars[i], cut); jars[i] = note(t.jar, cut, t.usd, "Wallet balance fell below Snowbanks; scaled down in proportion"); }
    });
  }
  return touch(l, jars, now);
}

export type JarView = { valueUsd: bigint | null; gainUsd: bigint | null; gainPct: number | null; pct: number | null; done: boolean };
/** Value = units × live USD price per unit (1e7-scaled). Null price → null value (shown as "no price"). */
export function jarView(j: Jar, usdPerUnit: bigint | null): JarView {
  if (usdPerUnit === null) return { valueUsd: null, gainUsd: null, gainPct: null, pct: null, done: false };
  const valueUsd = (B(j.units) * usdPerUnit) / SCALE, cost = B(j.costUsd);
  const gainUsd = valueUsd - cost;
  const gainPct = cost > 0n ? Number((gainUsd * 1_000_000n) / cost) / 10_000 : null;
  const t = j.targetUsd ? B(j.targetUsd) : 0n;
  const pct = t > 0n ? Math.min(100, Number((valueUsd * 10_000n) / t) / 100) : null;
  return { valueUsd, gainUsd, gainPct, pct, done: t > 0n && valueUsd >= t };
}

/** Number → 7-decimal integer (floors; rejects >7 decimals, negatives, junk). */
export function toUnits(s: string): bigint | null {
  const t = s.trim(); if (!/^\d+(\.\d{1,7})?$/.test(t)) return null;
  const [w, f = ""] = t.split("."); return BigInt(w) * SCALE + BigInt((f + "0000000").slice(0, 7));
}
export const toUnitsN = (n: number) => BigInt(Math.floor(n * 1e7 + 1e-6));
