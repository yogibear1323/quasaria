import { describe, expect, it } from "vitest";
import { allocation, closeJar, createJar, deposit, emptyLedger, jarView, loadLedger, migrateV1, moveUnits, renameJar, resolveShortfall, saveLedger, toUnits, withdraw, type Ledger } from "../src/lib/jarsLedger";
import { planJarSwap } from "../src/lib/jarsSwap";
import { parseEtherfuse, isStale } from "../src/lib/jarsPrice";
import { JAR_SYNC_ENABLED, buildSyncTx, openLedger, readSyncEntries, sealLedger, syncCost } from "../src/lib/jarsSync";

const X = (v: number) => BigInt(Math.round(v * 1e7));
const mem = (init: Record<string, string> = {}) => { const m = new Map(Object.entries(init)); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m }; };
let seq = 0; const rnd = () => (++seq) / 997;
const two = (): Ledger => { let l = createJar(emptyLedger(0), { name: "A", fund: "USTRY" }, 1, rnd); l = createJar(l, { name: "B", fund: "XLM", targetUsd: X(100) }, 2, rnd); return l; };
const id = (l: Ledger, n: string) => l.jars.find((j) => j.name === n)!.id;

describe("jars ledger math", () => {
  it("only XLM or USTRY funding; names required", () => {
    expect(() => createJar(emptyLedger(), { name: " ", fund: "XLM" })).toThrow(/name/);
    expect(() => createJar(emptyLedger(), { name: "x", fund: "BTC" as never })).toThrow(/XLM or USTRY/);
    expect(two().jars.every((j) => j.holding === "USTRY")).toBe(true);
  });
  it("each jar tracks its own cost basis, value and gain (independent compounding)", () => {
    let l = two();
    l = deposit(l, id(l, "A"), { units: X(100), usd: X(105) }); // bought at $1.05
    l = deposit(l, id(l, "B"), { units: X(100), usd: X(107.8), xlm: X(400), tx: "a".repeat(64) }); // at $1.078
    const a = jarView(l.jars[0], X(1.1)), b = jarView(l.jars[1], X(1.1));
    expect(a.valueUsd).toBe(X(110)); expect(a.gainUsd).toBe(X(5)); expect(b.gainUsd).toBe(X(2.2));
    expect(b.pct).toBe(100); expect(b.done).toBe(true);
    expect(l.jars[1].history.at(-1)!.tx).toBe("a".repeat(64));
    expect(jarView(l.jars[0], null).valueUsd).toBeNull();
  });
  it("withdraw/release reduces cost basis pro rata", () => {
    let l = two(); l = deposit(l, id(l, "A"), { units: X(10), usd: X(11) });
    l = withdraw(l, id(l, "A"), X(4));
    expect(l.jars[0].units).toBe(X(6).toString()); expect(l.jars[0].costUsd).toBe(X(6.6).toString());
    expect(() => withdraw(l, id(l, "A"), X(7))).toThrow();
  });
  it("same-asset moves are free relabels and carry cost basis pro rata; totals unchanged", () => {
    let l = two(); l = deposit(l, id(l, "A"), { units: X(10), usd: X(12) });
    l = moveUnits(l, id(l, "A"), id(l, "B"), X(2.5));
    expect(l.jars[0].costUsd).toBe(X(9).toString()); expect(l.jars[1].costUsd).toBe(X(3).toString());
    expect(allocation(l, "USTRY", X(10)).allocated).toBe(X(10));
    expect(l.jars[1].history.at(-1)!.type).toBe("move-in");
  });
  it("cross-holding moves are refused; close needs an empty jar; rename logs", () => {
    let l = migrateV1([{ id: "v", name: "Old", target: X(5).toString(), shares: X(3).toString(), principal: X(3).toString(), created: 1 }]);
    l = createJar(l, { name: "N", fund: "USTRY" }, 2, rnd); l = deposit(l, id(l, "N"), { units: X(1), usd: X(1) });
    expect(() => moveUnits(l, "v", id(l, "N"), X(1))).toThrow(/same asset/);
    expect(() => deposit(l, "v", { units: X(1), usd: X(1) })).toThrow(/vault/);
    expect(() => closeJar(l, "v")).toThrow(/Empty/);
    expect(renameJar(l, "v", "Older").jars[0].history.at(-1)!.type).toBe("rename");
  });
  it("unassigned is consumed first, then a shortfall appears", () => {
    let l = two(); l = deposit(l, id(l, "A"), { units: X(6), usd: X(6) }); l = deposit(l, id(l, "B"), { units: X(4), usd: X(4) });
    expect(allocation(l, "USTRY", X(12))).toMatchObject({ unassigned: X(2), shortfall: 0n });
    expect(allocation(l, "USTRY", X(8))).toMatchObject({ unassigned: 0n, shortfall: X(2) });
    expect(resolveShortfall(l, "USTRY", X(12))).toBe(l);
  });
  it("shortfall: proportional scale-down lands exactly on the wallet balance", () => {
    let l = two(); l = deposit(l, id(l, "A"), { units: 3333333n, usd: 3333333n }); l = deposit(l, id(l, "B"), { units: 6666667n, usd: 7000000n });
    const r = resolveShortfall(l, "USTRY", 5000000n);
    expect(allocation(r, "USTRY", 5000000n).allocated).toBe(5000000n);
    expect(BigInt(r.jars[1].costUsd)).toBeLessThan(7000000n);
    expect(r.jars[0].history.at(-1)!.type).toBe("scale");
  });
  it("shortfall: a chosen jar absorbs first, remainder spreads", () => {
    let l = two(); l = deposit(l, id(l, "A"), { units: X(6), usd: X(6) }); l = deposit(l, id(l, "B"), { units: X(4), usd: X(4) });
    const r = resolveShortfall(l, "USTRY", X(7), id(l, "B"));
    expect(r.jars[1].units).toBe(X(1).toString()); expect(r.jars[0].units).toBe(X(6).toString());
    const r2 = resolveShortfall(l, "USTRY", X(1), id(l, "B"));
    expect(r2.jars[1].units).toBe("0"); expect(r2.jars[0].units).toBe(X(1).toString());
  });
  it("toUnits parses 7-decimal amounts only", () => {
    expect(toUnits("1.5")).toBe(X(1.5)); expect(toUnits("1.12345678")).toBeNull(); expect(toUnits("-1")).toBeNull();
  });
});

describe("migration from v1 vault-share jars", () => {
  it("keeps shares and XLM principal; loads v1 when no v2; v1 key untouched", () => {
    const v1 = [{ id: "j1", name: "Ski", target: X(100).toString(), shares: X(50).toString(), principal: X(48).toString(), created: 5 }];
    const s = mem({ "quasaria.jars.v1.GA": JSON.stringify(v1) });
    const l = loadLedger("GA", s, 9);
    expect(l.jars[0]).toMatchObject({ id: "j1", holding: "VAULT", units: X(50).toString(), costXlm: X(48).toString(), created: 5 });
    expect(l.jars[0].history[0].type).toBe("migrate");
    saveLedger("GA", l, s); expect(s.m.get("quasaria.jars.v1.GA")).toBe(JSON.stringify(v1));
    expect(loadLedger("GA", s).jars).toHaveLength(1);
    expect(loadLedger("GB", s).jars).toHaveLength(0);
  });
  it("tolerates corrupt data", () => {
    expect(loadLedger("GA", mem({ "quasaria.jars.v1.GA": "{nope" })).jars).toEqual([]);
    expect(migrateV1([{ id: "x", name: "y", target: "bad", shares: "-4", principal: "z", created: 0 } as never]).jars[0].units).toBe("0");
  });
  it("vault jars still reconcile to the on-chain vault balance", () => {
    const l = migrateV1([{ id: "a", name: "a", target: "1", shares: X(10).toString(), principal: X(10).toString(), created: 0 }, { id: "b", name: "b", target: "1", shares: X(10).toString(), principal: X(10).toString(), created: 0 }]);
    const r = resolveShortfall(l, "VAULT", X(10));
    expect(allocation(r, "VAULT", X(10)).allocated).toBe(X(10)); expect(r.jars[0].costXlm).toBe(X(5).toString());
  });
});

describe("XLM → USTRY swap guard", () => {
  const q = (send: number, dest: number) => ({ sendAmount: send, destAmount: dest, path: [], rate: dest / send });
  it("refuses no route, too-high slippage and bad price impact", () => {
    expect(planJarSwap({ quote: null, slippage: 0.5, xlmUsd: 0.3, ustryUsd: 1.08 }).ok).toBe(false);
    expect(planJarSwap({ quote: q(100, 27.7), slippage: 5, xlmUsd: 0.3, ustryUsd: 1.08 }).ok).toBe(false);
    const bad = planJarSwap({ quote: q(100, 25), slippage: 0.5, xlmUsd: 0.3, ustryUsd: 1.08 });
    expect(bad.ok).toBe(false); if (!bad.ok) expect(bad.error).toMatch(/NAV/);
  });
  it("accepts a fair quote and sets a min-received bound", () => {
    const p = planJarSwap({ quote: q(100, 27.6), slippage: 0.5, xlmUsd: 0.3, ustryUsd: 1.08 });
    expect(p.ok).toBe(true); if (p.ok) { expect(p.minOut).toBeCloseTo(27.462, 3); expect(p.impactPct!).toBeLessThan(1); }
  });
});

describe("price source", () => {
  it("parses Etherfuse NAV and live rate; sanity band; staleness", () => {
    const p = parseEtherfuse({ token_cost_in_usd: "1.078221", current_basis_points: 360, current_time: "2026-10-26T03:17:51Z", sources: { a: { updated_at: 1792984662 } } });
    expect(p).toMatchObject({ usd: 1.078221, ratePct: 3.6, at: 1792984662000 });
    expect(parseEtherfuse({ token_cost_in_usd: "99" })).toBeNull();
    expect(isStale(1000, 1000 + 31 * 60_000)).toBe(true); expect(isStale(1000, 1000 + 60_000)).toBe(false);
  });
});

describe("sync proposal (flag off)", () => {
  it("is disabled and refuses to build a tx", () => {
    expect(JAR_SYNC_ENABLED).toBe(false);
    expect(() => buildSyncTx({ source: "G", sequence: "1", passphrase: "x", header: new Uint8Array(), chunks: [], existingChunks: 0 })).toThrow(/not enabled/);
  });
  it("round-trips encrypted, compressed, 64-byte chunks; wrong passphrase fails", async () => {
    let l = two(); for (let k = 0; k < 6; k++) l = deposit(l, id(l, "B"), { units: X(1), usd: X(1.08), xlm: X(3.6), tx: "b".repeat(64) }, 10 + k);
    const { header, chunks } = await sealLedger(l, "correct horse", "GABC");
    expect(chunks.every((c) => c.length <= 64)).toBe(true);
    const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
    const data: Record<string, string> = { qjh: b64(header) }; chunks.forEach((c, k) => (data[`qj${k}`] = b64(c)));
    const back = readSyncEntries(data)!;
    const out = await openLedger(back.header, back.chunks, "correct horse", "GABC");
    expect(out.jars.map((j) => [j.name, j.units, j.costUsd])).toEqual(l.jars.map((j) => [j.name, j.units, j.costUsd]));
    await expect(openLedger(back.header, back.chunks, "wrong pass!", "GABC")).rejects.toThrow();
    const c = syncCost(chunks.length, 0);
    expect(c.reserveDeltaXlm).toBe((chunks.length + 1) * 0.5);
    console.log(`[sync-cost] 2 jars, 8 history entries: ${chunks.length} chunks + header = ${c.entries} entries, reserve ${c.reserveDeltaXlm} XLM, fee ${c.feeXlm} XLM`);
  });
});
