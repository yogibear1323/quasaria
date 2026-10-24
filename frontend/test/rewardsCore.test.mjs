import { describe, expect, it } from "vitest";
import {
  DAILY_CAP, REFERRAL, STROOPS, addDays, batches, buildManifest, classifyMemo, computeReferral, computeRewards, consolidate, daysBetween, effectiveBalances,
  fmtStroops, memoBoost, memoReferrer, memoReward, parseStroops, rawReward, sha256hex, toStroops,
} from "../scripts/rewards/core.mjs";

const A = (n) => `G${String(n).padStart(55, "A")}`;
const T = (n) => toStroops(n);

describe("stroop maths", () => {
  it("parses and formats without float error", () => {
    expect(parseStroops("1234.5678901")).toBe(12345678901n);
    expect(fmtStroops(12345678901n)).toBe("1234.5678901");
    expect(fmtStroops(parseStroops("0.0000001"))).toBe("0.0000001");
  });
});

describe("holder rewards", () => {
  it("12% APR (1%/month) from 1M and 10M, flat on the whole balance, /365; nothing below 1M", () => {
    expect(rawReward(T(999_999))).toBe(0n);
    expect(rawReward(T(1_000_000))).toBe((T(1_000_000) * 12n) / 36500n);
    expect(rawReward(T(9_999_999))).toBe((T(9_999_999) * 12n) / 36500n);
    expect(rawReward(T(10_000_000))).toBe((T(10_000_000) * 12n) / 36500n);
    expect(Number(rawReward(T(20_000_000))) / Number(STROOPS)).toBeCloseTo(6575.34, 1);
  });
  it("uses the lower of two snapshots, and a missing address counts as zero", () => {
    const d1 = new Map([[A(1), T(5_000_000)], [A(2), T(3_000_000)], [A(3), T(2_000_000)]]);
    const d0 = new Map([[A(1), T(2_000_000)], [A(2), T(8_000_000)]]);
    const eff = effectiveBalances([d1, d0]);
    expect(eff.get(A(1))).toBe(T(2_000_000));
    expect(eff.get(A(2))).toBe(T(3_000_000));
    expect(eff.has(A(3))).toBe(false);
  });
  it("excludes issuer, reserve, treasury and pool accounts", () => {
    const bal = new Map([[A(1), T(5_000_000)], [A(2), T(5_000_000)]]);
    const r = computeRewards({ balances: bal, exclude: new Set([A(2)]) });
    expect(r.items.map((i) => i.to)).toEqual([A(1)]);
  });
  it("scales pro rata when the 10M/day cap would be exceeded and never exceeds it", () => {
    const bal = new Map();
    for (let i = 0; i < 40; i++) bal.set(A(i), T(2_500_000_000)); // 100B in total at 7% = 19M/day, over the 10M cap
    const r = computeRewards({ balances: bal });
    expect(r.scaled).toBe(true);
    expect(r.total <= DAILY_CAP).toBe(true);
    expect(r.total > DAILY_CAP - 100n).toBe(true);
    const first = r.items[0].amount;
    expect(r.items.every((i) => i.amount === first)).toBe(true); // equal balances stay equal
  });
  it("batches at 100 operations per transaction", () => {
    const b = batches(Array.from({ length: 250 }, (_, i) => i), 100);
    expect(b.map((x) => x.length)).toEqual([100, 100, 50]);
  });
});

describe("memos and days", () => {
  it("fits the 28-byte text memo limit and classifies", () => {
    for (const m of [memoReward("2026-10-19"), memoReferrer("2026-10-19"), memoBoost("2026-10-19")]) expect(Buffer.byteLength(m)).toBeLessThanOrEqual(28);
    expect(classifyMemo("GLACIERQ:2026-10-19")).toEqual({ kind: "reward", day: "2026-10-19" });
    expect(classifyMemo("GLACIERQ-REF:2026-10-19")).toEqual({ kind: "referrer", day: "2026-10-19" });
    expect(classifyMemo("GLACIERQ-BOOST:2026-10-19")).toEqual({ kind: "referee", day: "2026-10-19" });
    expect(classifyMemo("hello")).toBeNull();
  });
  it("day arithmetic is UTC", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(daysBetween("2026-10-01", "2026-10-19")).toBe(18);
  });
});

describe("referral", () => {
  const day = "2026-10-12";
  const ref = A(100), kid = A(1);
  const base = () => ({
    day,
    rewards: new Map([[kid, T(300)]]),
    holdOk: new Set([kid]),
    bindings: new Map([[kid, { referrer: ref, boundDay: "2026-09-12" }]]),
    referrerOk: () => true,
    paidSoFar: { referrer: new Map(), referee: new Map() },
  });
  it("pays 10% to the referrer and +10% to the referee", () => {
    const r = computeReferral(base());
    expect(r.items.find((i) => i.kind === "referrer")).toMatchObject({ to: ref, amount: T(30) });
    expect(r.items.find((i) => i.kind === "referee")).toMatchObject({ to: kid, amount: T(30) });
  });
  it("referee boost stops after 180 days, referrer bonus continues to 365", () => {
    const b = base(); b.bindings.set(kid, { referrer: ref, boundDay: addDays(day, -181) });
    const r = computeReferral(b);
    expect(r.items.map((i) => i.kind)).toEqual(["referrer"]);
    const b2 = base(); b2.bindings.set(kid, { referrer: ref, boundDay: addDays(day, -366) });
    expect(computeReferral(b2).items).toEqual([]);
  });
  it("per-referral cap of 100,000 on each side, then stops", () => {
    const b = base(); b.rewards.set(kid, T(1_000_000)); // 10% = 100k/day -> capped by what is left
    b.paidSoFar.referrer.set(kid, T(99_990)); b.paidSoFar.referee.set(kid, T(100_000));
    const r = computeReferral(b);
    expect(r.items.find((i) => i.kind === "referrer").amount).toBe(T(10));
    expect(r.items.find((i) => i.kind === "referee")).toBeUndefined();
    expect(r.skipped.some((s) => s.reason.includes("referee boost"))).toBe(true);
  });
  it("referrer daily cap of 25,000 applies across all of that referrer's referees", () => {
    const b = base(); b.rewards = new Map(); b.holdOk = new Set(); b.bindings = new Map();
    for (let i = 1; i <= 5; i++) { b.rewards.set(A(i), T(100_000)); b.holdOk.add(A(i)); b.bindings.set(A(i), { referrer: ref, boundDay: "2026-09-20" }); } // 5 x 10,000 = 50,000
    const r = computeReferral(b);
    const sum = r.items.filter((i) => i.kind === "referrer").reduce((s, i) => s + i.amount, 0n);
    expect(sum <= T(25_000)).toBe(true);
    expect(sum > T(25_000) - 10n).toBe(true);
  });
  it("sub-budget 1M/day scales everything pro rata", () => {
    const b = base(); b.rewards = new Map(); b.holdOk = new Set(); b.bindings = new Map();
    for (let i = 1; i <= 200; i++) { const x = A(i), rr = A(1000 + i); b.rewards.set(x, T(400_000)); b.holdOk.add(x); b.bindings.set(x, { referrer: rr, boundDay: "2026-10-01" }); }
    const r = computeReferral(b);
    expect(r.scaled).toBe(true);
    expect(r.total <= REFERRAL.subBudgetDay).toBe(true);
  });
  it("never crowds out holders: headroom under the 10M cap limits referral payouts", () => {
    const b = base(); b.headroom = T(10);
    const r = computeReferral(b);
    expect(r.total <= T(10)).toBe(true);
    const none = computeReferral({ ...base(), headroom: 0n });
    expect(none.items).toEqual([]);
  });
  it("skips self, mutual, ineligible referrer, and short-hold referees", () => {
    const self = base(); self.bindings.set(kid, { referrer: kid, boundDay: "2026-09-12" });
    expect(computeReferral(self).items).toEqual([]);
    const mutual = base(); mutual.rewards.set(ref, T(300)); mutual.holdOk.add(ref); mutual.bindings.set(ref, { referrer: kid, boundDay: "2026-09-12" });
    expect(computeReferral(mutual).skipped.some((s) => s.reason.includes("mutual"))).toBe(true);
    const bad = base(); bad.referrerOk = () => false;
    expect(computeReferral(bad).items.map((i) => i.kind)).toEqual(["referee"]); // referee boost still paid, referrer not
    const short = base(); short.holdOk = new Set();
    expect(computeReferral(short).items).toEqual([]);
  });
  it("consolidates into one payment per recipient and kind, keeping per-referee lines", () => {
    const rows = [{ kind: "referrer", to: ref, referee: A(1), amount: 5n }, { kind: "referrer", to: ref, referee: A(2), amount: 7n }, { kind: "referee", to: A(1), referee: A(1), amount: 5n }];
    const c = consolidate(rows);
    expect(c.length).toBe(2);
    expect(c.find((x) => x.kind === "referrer")).toMatchObject({ amount: 12n });
    expect(c.find((x) => x.kind === "referrer").lines.length).toBe(2);
  });
});

describe("manifest", () => {
  it("is deterministic: same input, same sha256; any change alters it", () => {
    const mk = (amt) => buildManifest({ kind: "holder-rewards", network: "testnet", day: "2026-10-19", payer: A(9), asset: "GLACIERQ", issuer: A(8), rules: {}, totals: { total: "1" }, items: [{ to: A(1), amount: amt }] });
    expect(mk(5n).hash).toBe(mk(5n).hash);
    expect(mk(5n).hash).not.toBe(mk(6n).hash);
    expect(mk(5n).hash).toBe(sha256hex(mk(5n).text));
    expect(mk(5n).hash).toMatch(/^[0-9a-f]{64}$/);
  });
});
