/**
 * GLACIERQ rewards + referral maths. Pure functions, no network, no keys.
 * All amounts are BigInt stroops (1 token = 10_000_000 stroops) so nothing depends on float rounding.
 * Terms (CONFIRMED by Robert, 2026-10-18):
 *   holder rewards: 5% a year on balances from 1M to <10M, 7% a year from 10M, flat on the whole balance, paid daily;
 *   daily cap 10M GLACIERQ across all holder rewards, scaled pro rata; lower of snapshots 24h apart.
 *   referral (option A + two confirmed improvements): see REFERRAL below.
 */
export const ASSET_CODE = "GLACIERQ";
export const STROOPS = 10_000_000n;
export const toStroops = (tokens) => BigInt(Math.round(tokens)) * STROOPS;
export const parseStroops = (s) => {
  const m = /^(\d+)(?:\.(\d{1,7}))?$/.exec(String(s).trim());
  if (!m) throw new Error(`bad amount: ${s}`);
  return BigInt(m[1]) * STROOPS + BigInt((m[2] ?? "").padEnd(7, "0") || "0");
};
export const fmtStroops = (b) => `${b / STROOPS}.${String(b % STROOPS).padStart(7, "0")}`;
/** Human text with thousands separators, 2 decimals. */
export const human = (b) => `${(b / STROOPS).toLocaleString("en-US")}.${String((b % STROOPS) / 100000n).padStart(2, "0")}`;

export const DAILY_CAP = toStroops(10_000_000);
export const TIERS = [
  { name: "Tier 1", min: toStroops(1_000_000), max: toStroops(10_000_000), aprNum: 5n, aprDen: 100n },
  { name: "Tier 2", min: toStroops(10_000_000), max: null, aprNum: 7n, aprDen: 100n },
];
export const tierOf = (bal) => TIERS.find((t) => bal >= t.min && (t.max === null || bal < t.max)) ?? null;
/** floor(balance * apr / 365). */
export const rawReward = (bal) => {
  const t = tierOf(bal);
  return t ? (bal * t.aprNum) / (t.aprDen * 365n) : 0n;
};

export const REFERRAL = {
  referrerPct: 10n, // % of the referee's daily reward, paid on top, to the referrer
  refereePct: 10n, // % of the referee's own daily reward, paid on top, to the referee
  referrerDays: 365, // from binding
  refereeDays: 180, // 6 months from binding
  perReferralCap: toStroops(100_000), // total per referral, referrer side
  perRefereeCap: toStroops(100_000), // total per referee, boost side
  perReferrerDay: toStroops(25_000),
  subBudgetDay: toStroops(1_000_000),
  lagDays: 7,
  minReferrerBalance: toStroops(100_000),
  minReferrerAgeDays: 14,
  bindWindowDays: 30,
  holdSnapshots: 3, // 48 h: the balance must be >= 1M at three consecutive daily snapshots
};

// ---------------------------------------------------------------- dates / memos
const DAY = 86_400_000;
export const isDay = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
export const utcDay = (d = Date.now()) => new Date(d).toISOString().slice(0, 10);
export const addDays = (day, n) => utcDay(Date.parse(`${day}T00:00:00Z`) + n * DAY);
export const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY);
export const memoReward = (day) => `${ASSET_CODE}:${day}`; // 17 bytes
export const memoReferrer = (day) => `${ASSET_CODE}-REF:${day}`; // 23 bytes
export const memoBoost = (day) => `${ASSET_CODE}-BOOST:${day}`; // 25 bytes (text memo limit is 28)
/** What kind of GLACIERQ payment a memo marks, for the site's Activity feed. */
export const classifyMemo = (memo) => {
  if (!memo) return null;
  let m = /^GLACIERQ-REF:(\d{4}-\d{2}-\d{2})$/.exec(memo); if (m) return { kind: "referrer", day: m[1] };
  m = /^GLACIERQ-BOOST:(\d{4}-\d{2}-\d{2})$/.exec(memo); if (m) return { kind: "referee", day: m[1] };
  m = /^GLACIERQ:(\d{4}-\d{2}-\d{2})$/.exec(memo); if (m) return { kind: "reward", day: m[1] };
  return null;
};

// ---------------------------------------------------------------- holder rewards
/** Lower of several snapshots (Map addr -> stroops); an address missing from a snapshot counts as 0. */
export function effectiveBalances(snapshots) {
  const [first, ...rest] = snapshots;
  const out = new Map();
  if (!first) return out;
  for (const [a, b] of first) {
    let m = b;
    for (const s of rest) { const x = s.get(a) ?? 0n; if (x < m) m = x; }
    if (m > 0n) out.set(a, m);
  }
  return out;
}

/** Scale `items[].amount` pro rata so the total is at most `cap` (floor per item, so the total never exceeds it). */
export function scaleToCap(items, cap) {
  const total = items.reduce((s, i) => s + i.amount, 0n);
  if (total <= cap) return { items, total, scaled: false, factor: 1 };
  const out = items.map((i) => ({ ...i, amount: (i.amount * cap) / total })).filter((i) => i.amount > 0n);
  return { items: out, total: out.reduce((s, i) => s + i.amount, 0n), scaled: true, factor: Number((cap * 1_000_000n) / total) / 1_000_000 };
}

/**
 * Daily holder rewards from effective balances (already the lower of two snapshots).
 * `exclude` = issuer, reserve, treasury, payer, pool accounts. Returns items sorted by address for determinism.
 */
export function computeRewards({ balances, exclude = new Set(), cap = DAILY_CAP }) {
  const raw = [];
  for (const [to, bal] of [...balances.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    if (exclude.has(to)) continue;
    const t = tierOf(bal);
    if (!t) continue;
    const amount = rawReward(bal);
    if (amount > 0n) raw.push({ to, balance: bal, tier: t.name, aprPct: Number(t.aprNum), raw: amount, amount });
  }
  const s = scaleToCap(raw, cap);
  return { items: s.items, total: s.total, rawTotal: raw.reduce((x, i) => x + i.amount, 0n), scaled: s.scaled, factor: s.factor, cap };
}

/** Split into transactions of at most `size` payment operations. */
export function batches(items, size = 100) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

// ---------------------------------------------------------------- referral
/**
 * Referral payouts for reward day `day` (paid on `day + lagDays`).
 * Inputs (all plain data, supplied by the Horizon layer):
 *   rewards      Map referee -> that day's holder reward (stroops), i.e. what the holder program paid/will pay on `day`
 *   holdOk       Set of referees whose balance was >= 1M at the last `holdSnapshots` snapshots (48 h)
 *   bindings     Map referee -> { referrer, boundDay }   (first binding wins; already validated against the bind window)
 *   referrerOk   (addr) => boolean: >=100k GLACIERQ now, trustline, account >= 14 days, not excluded
 *   paidSoFar    { referrer: Map<referee, stroops>, referee: Map<referee, stroops> } cumulative paid before today
 *   headroom     stroops left under the 10M/day cap after holder rewards (referral never crowds holders out)
 */
export function computeReferral({ day, rewards, holdOk, bindings, referrerOk, paidSoFar, headroom = DAILY_CAP, params = REFERRAL, exclude = new Set() }) {
  const rows = [];
  const skipped = [];
  const skip = (referee, reason) => skipped.push({ referee, reason });
  for (const [referee, reward] of [...rewards.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const b = bindings.get(referee);
    if (!b) continue;
    if (b.referrer === referee) { skip(referee, "self-referral"); continue; }
    if (exclude.has(referee) || exclude.has(b.referrer)) { skip(referee, "excluded account"); continue; }
    if (!holdOk.has(referee)) { skip(referee, "held 1M+ for under 48h"); continue; }
    const age = daysBetween(b.boundDay, day);
    if (age < 0) { skip(referee, "reward day before binding"); continue; }
    const back = bindings.get(b.referrer);
    if (back && back.referrer === referee) { skip(referee, "mutual referral pair"); continue; }
    // referrer side: 10% of the referee's reward, 365 days, 100k total per referral, referrer must be eligible
    if (age < params.referrerDays) {
      if (!referrerOk(b.referrer)) skip(referee, "referrer not eligible (balance, trustline, age)");
      else {
        const left = params.perReferralCap - (paidSoFar.referrer.get(referee) ?? 0n);
        const amt = min((reward * params.referrerPct) / 100n, left);
        if (amt > 0n) rows.push({ kind: "referrer", to: b.referrer, referee, amount: amt, uncapped: (reward * params.referrerPct) / 100n });
        else if (left <= 0n) skip(referee, "per-referral cap reached (referrer)");
      }
    }
    // referee side: +10% of own reward, 180 days, 100k total
    if (age < params.refereeDays) {
      const left = params.perRefereeCap - (paidSoFar.referee.get(referee) ?? 0n);
      const amt = min((reward * params.refereePct) / 100n, left);
      if (amt > 0n) rows.push({ kind: "referee", to: referee, referee, amount: amt, uncapped: (reward * params.refereePct) / 100n });
      else if (left <= 0n) skip(referee, "per-referral cap reached (referee boost)");
    }
  }
  // per-referrer daily cap (referrer bonuses only), pro rata within each referrer
  const byReferrer = new Map();
  for (const r of rows) if (r.kind === "referrer") byReferrer.set(r.to, [...(byReferrer.get(r.to) ?? []), r]);
  for (const list of byReferrer.values()) {
    const sum = list.reduce((s, r) => s + r.amount, 0n);
    if (sum > params.perReferrerDay) for (const r of list) r.amount = (r.amount * params.perReferrerDay) / sum;
  }
  // sub-budget (1M/day) and headroom under the 10M/day cap, pro rata over everything
  const budget = min(params.subBudgetDay, headroom < 0n ? 0n : headroom);
  const s = scaleToCap(rows.filter((r) => r.amount > 0n), budget);
  return { items: s.items, total: s.total, scaled: s.scaled, factor: s.factor, budget, skipped };
}
const min = (a, b) => (a < b ? a : b);

/** Pay one transfer per recipient per kind: combine items of the same kind and recipient into a single payment (per-referee `lines` are kept for the lifetime caps). */
export function consolidate(items) {
  const m = new Map();
  for (const i of items) {
    const k = `${i.kind}|${i.to}`;
    const cur = m.get(k);
    const line = { referee: i.referee, amount: i.amount };
    if (cur) { cur.amount += i.amount; cur.referees.push(i.referee); cur.lines.push(line); } else m.set(k, { kind: i.kind, to: i.to, amount: i.amount, referees: [i.referee], lines: [line] });
  }
  return [...m.values()].sort((a, b) => (a.kind + a.to < b.kind + b.to ? -1 : 1));
}

// ---------------------------------------------------------------- manifest
import { createHash } from "node:crypto";
const replacer = (_k, v) => (typeof v === "bigint" ? v.toString() : v);
export const canonical = (obj) => JSON.stringify(obj, replacer);
export const sha256hex = (s) => createHash("sha256").update(s).digest("hex");
/** A manifest is the public record of a batch: who, how much, why. Its sha256 is committed on chain. */
export function buildManifest({ kind, network, day, payer, asset, issuer, items, totals, rules }) {
  const body = { version: 1, kind, network, day, payer, asset: { code: asset, issuer }, rules, totals, items };
  const text = canonical(body);
  return { body, text, hash: sha256hex(text) };
}
