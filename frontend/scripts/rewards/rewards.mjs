#!/usr/bin/env node
/**
 * GLACIERQ holder rewards + referral payouts. Plain Stellar payments from ordinary accounts; no smart contract.
 *
 *   node scripts/rewards/rewards.mjs snapshot  --net testnet [--day YYYY-MM-DD]
 *   node scripts/rewards/rewards.mjs daily     --net testnet [--day D] [--send]
 *   node scripts/rewards/rewards.mjs referral  --net testnet [--day D] [--send]
 *   node scripts/rewards/rewards.mjs status    --net testnet
 *
 * DRY-RUN IS THE DEFAULT AND, IN THIS BUILD, THE ONLY MODE: --send is refused unless net is testnet AND QUASARIA_TESTNET_SEND=yes
 * is set (for rehearsals with throwaway testnet accounts). Mainnet sending is blocked outright by the MAINNET_SIGNING constant
 * below (false until Robert says go), by QUASARIA_MAINNET_GO, and by a PAUSE file.
 * Secrets are read from a mode-600 keys file outside the repo (--keys) and are never printed or logged.
 */
import { parseArgs } from "node:util";
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { Asset, BASE_FEE, Horizon, Keypair, Memo, Networks, Operation, TransactionBuilder } from "@stellar/stellar-sdk";
import {
  ASSET_CODE, DAILY_CAP, REFERRAL, addDays, batches, buildManifest, computeReferral, computeRewards, consolidate, daysBetween, effectiveBalances, fmtStroops, human, isDay,
  memoBoost, memoReferrer, memoReward, parseStroops, tierOf, utcDay,
} from "./core.mjs";
import { PASSPHRASE, client, fetchAccountCreatedDay, fetchBinding, fetchHolders, fetchPaidWithMemo } from "./horizon.mjs";

/** Mainnet signing stays OFF until Robert says go. Flip only in a reviewed commit. */
export const MAINNET_SIGNING = false;

const HOME = process.env.HOME ?? "/home/box";
const { values: a, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    net: { type: "string", default: "testnet" }, day: { type: "string" }, send: { type: "boolean", default: false },
    keys: { type: "string" }, sim: { type: "boolean", default: false }, state: { type: "string" }, "min-lag": { type: "string" }, quiet: { type: "boolean", default: false },
  },
});
const cmd = positionals[0] ?? "status";
const net = a.net;
if (!["testnet", "mainnet"].includes(net)) die("--net must be testnet or mainnet");
if (a.sim && net !== "testnet") die("--sim is a testnet-only fixture switch");
if (a.send && !(net === "testnet" && process.env.QUASARIA_TESTNET_SEND === "yes")) die("sending is disabled in this build: dry-run only. (Testnet rehearsals need QUASARIA_TESTNET_SEND=yes; mainnet is blocked by MAINNET_SIGNING.)");
const day = a.day ?? utcDay();
if (!isDay(day)) die(`bad --day ${day}`);
const STATE = a.state ?? join(HOME, `.quasaria-${net}-glacierq`, "state");
const KEYS = a.keys ?? join(HOME, `.quasaria-${net}-glacierq`, net === "mainnet" ? "glacierq-mainnet-keys.json" : "keys.json");
const say = (...x) => { if (!a.quiet) console.log(...x); };
function die(m) { console.error(`error: ${m}`); process.exit(1); }

const readJson = (p, d = null) => (existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : d);
const writeJson = (p, v) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, typeof v === "string" ? v : JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x), 2)); };

/** Public addresses only unless a send is requested (secrets are loaded lazily, inside signing). */
function roles() {
  const k = readJson(KEYS);
  if (!k) die(`keys file not found: ${KEYS}`);
  const acc = k.accounts;
  return { issuer: acc.issuer.public, reserve: acc.reward_reserve.public, treasury: acc.distribution.public, payer: acc.referral_payer?.public ?? null, k };
}

function snapshotPath(d) { return join(STATE, "snapshots", `${d}.json`); }
const loadSnap = (d) => {
  const j = readJson(snapshotPath(d));
  return j ? { day: j.day, balances: new Map(Object.entries(j.balances).map(([k, v]) => [k, BigInt(v)])), data: j.data ?? {} } : null;
};

async function takeSnapshot(r, h, d) {
  const holders = await fetchHolders(h, r.issuer);
  const balances = {}, data = {};
  for (const [addr, v] of holders) { balances[addr] = v.stroops.toString(); if (v.data["quasaria:ref"]) data[addr] = { "quasaria:ref": v.data["quasaria:ref"] }; }
  writeJson(snapshotPath(d), { day: d, takenAt: new Date().toISOString(), network: net, issuer: r.issuer, holders: holders.size, balances, data });
  return { holders: holders.size };
}

function guardSend({ total, cap, floatBalance, label }) {
  if (net === "mainnet" && (!MAINNET_SIGNING || process.env.QUASARIA_MAINNET_GO !== "yes")) die("mainnet sending is OFF (MAINNET_SIGNING=false). Dry-run only.");
  if (existsSync(join(STATE, "PAUSE"))) die(`paused: ${join(STATE, "PAUSE")} exists. Remove it to send.`);
  if (total > cap) die(`${label}: total ${human(total)} exceeds the daily maximum ${human(cap)}. Refusing.`);
  if (floatBalance !== null && floatBalance < total) die(`${label}: paying account holds ${human(floatBalance)} but needs ${human(total)}. Top it up first.`);
}

async function paying(r, h, which, items, { memo, day: d, manifest, live }) {
  const secret = which === "reserve" ? r.k.accounts.reward_reserve.secret : r.k.accounts.referral_payer.secret;
  const kp = Keypair.fromSecret(secret);
  const server = new Horizon.Server(h.base);
  const asset = new Asset(ASSET_CODE, r.issuer);
  const ledgerFile = join(STATE, "paid", `${memo.replace(/[^A-Za-z0-9._-]/g, "_")}.json`);
  const done = readJson(ledgerFile, {});
  const onChain = await fetchPaidWithMemo(h, kp.publicKey(), r.issuer, memo, d);
  const todo = items.filter((i) => !done[`${i.kind ?? "x"}|${i.to}`] && !onChain.has(i.to));
  say(`  ${items.length - todo.length} already paid for ${memo} (ledger + chain), ${todo.length} to pay`);
  let n = 0;
  const failed = [];
  const submit = async (chunk, first) => {
    const acct = await server.loadAccount(kp.publicKey());
    const fee = String(Number(BASE_FEE) * (chunk.length + (first ? 2 : 0)) * 2);
    const b = new TransactionBuilder(acct, { fee, networkPassphrase: PASSPHRASE[net] }).setTimeout(120).addMemo(Memo.text(memo));
    if (first) {
      // public commitment to this batch's manifest (overwrites yesterday's pair; history lives in the ledger)
      b.addOperation(Operation.manageData({ name: "manifest-day", value: d }));
      b.addOperation(Operation.manageData({ name: "manifest-sha256", value: manifest.hash }));
    }
    for (const i of chunk) b.addOperation(Operation.payment({ destination: i.to, asset, amount: fmtStroops(i.amount) }));
    const tx = b.build();
    tx.sign(kp);
    return server.submitTransaction(tx);
  };
  let first = true;
  for (const chunk0 of batches(todo.filter((i) => !live || live.has(i.to)), 100)) {
    let chunk = chunk0;
    for (let attempt = 0; attempt < 2 && chunk.length; attempt++) {
      try {
        const res = await submit(chunk, first);
        first = false;
        for (const i of chunk) done[`${i.kind ?? "x"}|${i.to}`] = res.hash;
        writeJson(ledgerFile, done);
        n += chunk.length;
        say(`  tx ${res.hash.slice(0, 12)}…  ${chunk.length} payments`);
        break;
      } catch (e) {
        const ops = e?.response?.data?.extras?.result_codes?.operations;
        if (!ops || attempt) throw e;
        const off = first ? 2 : 0; // manifest ops come first
        const bad = new Set(ops.map((c, k) => (c === "op_success" ? -1 : k - off)).filter((k) => k >= 0));
        if (!bad.size) throw e;
        for (const k of bad) failed.push({ to: chunk[k].to, code: ops[k + off] });
        chunk = chunk.filter((_, k) => !bad.has(k));
        say(`  dropped ${bad.size} unpayable recipient(s) (${[...new Set(failed.map((f) => f.code))].join(", ")}); retrying the rest`);
      }
    }
  }
  if (failed.length) writeJson(join(STATE, "paid", `${memo.replace(/[^A-Za-z0-9._-]/g, "_")}.failed.json`), failed);
  return { paid: n, skipped: items.length - todo.length, failed: failed.length };
}

const table = (items, cols) => items.slice(0, 15).map((i) => "    " + cols.map((c) => c(i)).join("  ")).join("\n") + (items.length > 15 ? `\n    … and ${items.length - 15} more` : "");

async function main() {
  const r = roles();
  const h = client(net);
  if (cmd === "status") {
    for (const [name, addr] of [["issuer", r.issuer], ["reward reserve", r.reserve], ["treasury", r.treasury], ["referral payer", r.payer]]) {
      if (!addr) { say(`${name}: (none)`); continue; }
      const acc = await h.get(`/accounts/${addr}`);
      if (!acc) { say(`${name}: ${addr}  NOT ON LEDGER`); continue; }
      const b = acc.balances.find((x) => x.asset_code === ASSET_CODE && x.asset_issuer === r.issuer);
      say(`${name}: ${addr}  XLM ${acc.balances.find((x) => x.asset_type === "native").balance}  ${ASSET_CODE} ${b ? b.balance : "(no trustline)"}`);
    }
    say(`state: ${STATE}  paused: ${existsSync(join(STATE, "PAUSE"))}  snapshots: ${existsSync(join(STATE, "snapshots")) ? readdirSync(join(STATE, "snapshots")).length : 0}`);
    return;
  }
  if (cmd === "snapshot") {
    if (net === "mainnet" && day !== utcDay()) die("mainnet snapshots can only be taken for today");
    const s = await takeSnapshot(r, h, day);
    say(`snapshot ${day}: ${s.holders} holders -> ${snapshotPath(day)}`);
    return;
  }
  const exclude = new Set([r.issuer, r.reserve, r.treasury, ...(r.payer ? [r.payer] : []), ...(readJson(join(STATE, "exclude.json"), []))]);

  if (cmd === "daily") {
    if (!loadSnap(day)) { if (day === utcDay()) { say(`taking today's snapshot first…`); await takeSnapshot(r, h, day); } else die(`no snapshot for ${day}`); }
    const prev = loadSnap(addDays(day, -1));
    if (!prev) die(`no snapshot for ${addDays(day, -1)}: the lower-of-two-snapshots rule needs yesterday's. This is the baseline day; nothing is paid.`);
    const eff = effectiveBalances([loadSnap(day).balances, prev.balances]);
    const rw = computeRewards({ balances: eff, exclude });
    const manifest = buildManifest({ kind: "holder-rewards", network: net, day, payer: r.reserve, asset: ASSET_CODE, issuer: r.issuer,
      rules: { tiers: "5%/yr from 1M, 7%/yr from 10M, flat on whole balance, /365", snapshots: [addDays(day, -1), day], cap: DAILY_CAP.toString(), memo: memoReward(day) },
      totals: { holders: rw.items.length, total: rw.total.toString(), rawTotal: rw.rawTotal.toString(), scaled: rw.scaled, factor: rw.factor },
      items: rw.items.map((i) => ({ to: i.to, balance: i.balance.toString(), tier: i.tier, amount: i.amount.toString() })) });
    writeJson(join(STATE, "manifests", `reward-${day}.json`), manifest.body);
    writeJson(join(STATE, "manifests", `reward-${day}.sha256`), `${manifest.hash}\n`);
    say(`holder rewards for ${day} (${net}) ${a.send ? "SEND" : "DRY-RUN"}`);
    say(`  qualifying holders: ${rw.items.length}   total: ${human(rw.total)} ${ASSET_CODE}${rw.scaled ? `   SCALED pro rata x${rw.factor} (raw ${human(rw.rawTotal)} > cap ${human(DAILY_CAP)})` : ""}`);
    say(`  manifest sha256: ${manifest.hash}`);
    say(table(rw.items, [(i) => i.to, (i) => human(i.balance).padStart(20), (i) => i.tier, (i) => human(i.amount).padStart(14)]));
    if (!a.send) return;
    const bal = await h.get(`/accounts/${r.reserve}`).then((x) => x?.balances.find((b) => b.asset_code === ASSET_CODE && b.asset_issuer === r.issuer)?.balance);
    guardSend({ total: rw.total, cap: DAILY_CAP, floatBalance: bal ? parseStroops(bal) : 0n, label: "holder rewards" });
    for (const i of rw.items) if (i.amount > (i.balance * 7n) / 36500n + 1n) die("sanity check failed: a reward exceeds 7%/365 of its balance");
    const res = await paying(r, h, "reserve", rw.items.map((i) => ({ ...i, kind: "reward" })), { memo: memoReward(day), day, manifest, live: new Set(loadSnap(day).balances.keys()) });
    say(`done: ${res.paid} paid, ${res.skipped} skipped (already paid)`);
    return;
  }

  if (cmd === "referral") {
    if (!r.payer) die("no referral_payer account in the keys file");
    const rewardDay = addDays(day, -REFERRAL.lagDays);
    const rm = readJson(join(STATE, "manifests", `reward-${rewardDay}.json`));
    if (!rm) die(`no holder-reward manifest for ${rewardDay} (the referral bonus is paid ${REFERRAL.lagDays} days after the reward day). Nothing to do.`);
    const todayM = readJson(join(STATE, "manifests", `reward-${day}.json`));
    const holderTotal = todayM ? BigInt(todayM.totals.total) : a.sim ? 0n : DAILY_CAP; // unknown today = no headroom (never crowd out holders)
    const rewards = new Map(rm.items.map((i) => [i.to, BigInt(i.amount)]));
    const snaps = Array.from({ length: REFERRAL.holdSnapshots }, (_, k) => loadSnap(addDays(rewardDay, -k)));
    const holdOk = new Set();
    if (snaps.every(Boolean)) for (const [addr] of rewards) if (snaps.every((s) => (s.balances.get(addr) ?? 0n) >= tierMin())) holdOk.add(addr);
    const rewardSnap = loadSnap(rewardDay);
    const nowHolders = await fetchHolders(h, r.issuer);
    // bindings: only accounts that carried the data entry on the reward day
    const bindings = new Map();
    for (const [addr] of rewards) {
      const dat = rewardSnap?.data?.[addr];
      if (!dat) continue;
      const b = await fetchBinding(h, addr, dat);
      if (!b) continue;
      if (b.createdDay && daysBetween(b.createdDay, b.boundDay) > REFERRAL.bindWindowDays) continue; // outside the 30-day bind window
      bindings.set(addr, { referrer: b.referrer, boundDay: b.boundDay });
    }
    const ageCache = new Map();
    const okCache = new Map();
    for (const { referrer } of bindings.values()) {
      if (okCache.has(referrer)) continue;
      const nh = nowHolders.get(referrer);
      const created = nh ? await fetchAccountCreatedDay(h, referrer) : null;
      ageCache.set(referrer, created);
      okCache.set(referrer, !!nh && nh.stroops >= REFERRAL.minReferrerBalance && !!created && daysBetween(created, a.sim ? created : day) >= (a.sim ? 0 : REFERRAL.minReferrerAgeDays) && !exclude.has(referrer));
    }
    const paidSoFar = paidFromManifests(day);
    const out = computeReferral({ day: rewardDay, rewards, holdOk, bindings, referrerOk: (x) => okCache.get(x) === true, paidSoFar, headroom: DAILY_CAP - holderTotal, exclude });
    const pays = consolidate(out.items);
    const manifest = buildManifest({ kind: "referral", network: net, day, payer: r.payer, asset: ASSET_CODE, issuer: r.issuer,
      rules: { ...Object.fromEntries(Object.entries(REFERRAL).map(([k, v]) => [k, typeof v === "bigint" ? v.toString() : v])), rewardDay, memoReferrer: memoReferrer(day), memoBoost: memoBoost(day) },
      totals: { payments: pays.length, total: out.total.toString(), scaled: out.scaled, factor: out.factor, budget: out.budget.toString(), skipped: out.skipped.length },
      items: pays.map((p) => ({ kind: p.kind, to: p.to, amount: p.amount.toString(), lines: p.lines.map((l) => ({ referee: l.referee, amount: l.amount.toString() })) })) });
    writeJson(join(STATE, "manifests", `referral-${day}.json`), manifest.body);
    writeJson(join(STATE, "manifests", `referral-${day}.sha256`), `${manifest.hash}\n`);
    say(`referral payouts for ${day} (rewards of ${rewardDay}) (${net}) ${a.send ? "SEND" : "DRY-RUN"}`);
    say(`  bindings: ${bindings.size}  eligible rows: ${out.items.length}  payments: ${pays.length}  total: ${human(out.total)} ${ASSET_CODE}  budget: ${human(out.budget)}${out.scaled ? `  SCALED pro rata x${out.factor}` : ""}`);
    say(`  skipped: ${out.skipped.length}${out.skipped.length ? " (" + [...new Set(out.skipped.map((s) => s.reason))].join("; ") + ")" : ""}`);
    say(`  manifest sha256: ${manifest.hash}`);
    say(table(pays, [(i) => i.kind.padEnd(8), (i) => i.to, (i) => human(i.amount).padStart(12)]));
    if (!a.send) return;
    const bal = await h.get(`/accounts/${r.payer}`).then((x) => x?.balances.find((b) => b.asset_code === ASSET_CODE && b.asset_issuer === r.issuer)?.balance);
    guardSend({ total: out.total, cap: REFERRAL.subBudgetDay, floatBalance: bal ? parseStroops(bal) : 0n, label: "referral" });
    for (const k of ["referrer", "referee"]) {
      const list = pays.filter((p) => p.kind === k);
      if (!list.length) continue;
      const res = await paying(r, h, "payer", list, { memo: k === "referrer" ? memoReferrer(day) : memoBoost(day), day, manifest, live: new Set(nowHolders.keys()) });
      say(`done (${k}): ${res.paid} paid, ${res.skipped} skipped`);
    }
    return;
  }
  die(`unknown command ${cmd}`);
}
/** Lifetime paid per referee, from the published manifests of earlier days (never includes `beforeDay` itself, so a re-run is stable). */
function paidFromManifests(beforeDay) {
  const out = { referrer: new Map(), referee: new Map() };
  const dir = join(STATE, "manifests");
  if (!existsSync(dir)) return out;
  for (const f of readdirSync(dir).filter((x) => /^referral-\d{4}-\d{2}-\d{2}\.json$/.test(x))) {
    const m = readJson(join(dir, f));
    if (m.day >= beforeDay) continue;
    for (const it of m.items) for (const l of it.lines) out[it.kind].set(l.referee, (out[it.kind].get(l.referee) ?? 0n) + BigInt(l.amount));
  }
  return out;
}
const tierMin = () => tierOf(parseStroops("1000000")).min;
main().catch((e) => { console.error("error:", e.message); process.exit(1); });

