// TESTNET ONLY. Deploy the Quasaria lending pool, list a reserve for XLM + the 41 curated
// assets with the tiered risk parameters in config/lending-params.json, and seed modest supply
// liquidity from a friendbot-funded account. Idempotent (re-run safely).
//
// Prereqs: `stellar contract build`; the mock oracle priced (bot: npm run oracle-feed -- --once
// --identity quasaria-admin). Keys come from the stellar CLI keystore and are never printed.
// Output: deployments/testnet.json (contracts.lending + lending{}), deployments/testnet-lending.json,
//         frontend/src/config/lending.json.
// Usage: node scripts/deploy-lending.ts [--no-seed]
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertWasmDeployable } from "./lib/wasm-guard.ts";
import { Asset, BASE_FEE, Horizon, Keypair, Networks, Operation, TransactionBuilder } from "../frontend/node_modules/@stellar/stellar-sdk/lib/esm/index.js";

if (process.env.NETWORK && process.env.NETWORK !== "testnet") throw new Error("TESTNET ONLY");
const NET = "testnet";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const WASM = resolve(root, "contracts/target/wasm32v1-none/release/quasaria_lending.wasm");
const DEP = resolve(root, "deployments/testnet.json");
const OUT = resolve(root, "deployments/testnet-lending.json");
const FRONT = resolve(root, "frontend/src/config/lending.json");
const dep = JSON.parse(readFileSync(DEP, "utf8"));
if (dep.network !== "testnet" || dep.networkPassphrase !== Networks.TESTNET) throw new Error("deployment is not testnet");
const assetsDoc = JSON.parse(readFileSync(resolve(root, "deployments/testnet-assets.json"), "utf8"));
const params = JSON.parse(readFileSync(resolve(root, "config/lending-params.json"), "utf8"));
const horizon = new Horizon.Server(dep.horizonUrl);
const ADMIN = dep.admin as string, ORACLE = dep.contracts.oracle as string;
const SEED_USD = Number(process.env.SEED_USD ?? 250);
const SEED_XLM = Number(process.env.SEED_XLM ?? 3000);
const SEED_USDC = Number(process.env.SEED_USDC ?? 100);
const P14 = 10n ** 14n;
const log = (...a: unknown[]) => console.log(...a);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const sh = (args: string[]) => execFileSync("stellar", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const secretOf = (id: string) => execFileSync("stellar", ["keys", "show", id], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
const ensureIdentity = (id: string) => {
  try { return sh(["keys", "address", id]); } catch { sh(["keys", "generate", id, "--network", NET, "--fund"]); return sh(["keys", "address", id]); }
};
function retry<T>(label: string, fn: () => T, tries = 3): T {
  for (let i = 1; ; i++) {
    try { return fn(); } catch (e) {
      const msg = String((e as { stderr?: string }).stderr ?? (e as Error).message).split("\n").filter(Boolean).slice(-3).join(" | ");
      if (i >= tries) throw new Error(`${label}: ${msg}`);
      log(`   retry ${label} (${i}): ${msg.slice(0, 200)}`);
      execFileSync("sleep", ["4"]);
    }
  }
}
const inv = (id: string, source: string, args: string[], send = true) =>
  retry(`invoke ${args[0]}`, () => sh(["contract", "invoke", "--id", id, "--source", source, "--network", NET, ...(send ? [] : ["--send=no"]), "--", ...args]));

async function submit(kp: Keypair, ops: unknown[], memo: string) {
  for (let attempt = 0; ; attempt++) {
    const acct = await horizon.loadAccount(kp.publicKey());
    const b = new TransactionBuilder(acct, { fee: String(Number(BASE_FEE) * 20), networkPassphrase: Networks.TESTNET });
    ops.forEach((o) => b.addOperation(o as never));
    const tx = b.setTimeout(120).build();
    tx.sign(kp);
    try { return await horizon.submitTransaction(tx); } catch (e) {
      const codes = (e as { response?: { data?: { extras?: { result_codes?: unknown } } } }).response?.data?.extras?.result_codes;
      if (attempt < 2 && (!codes || JSON.stringify(codes).includes("tx_bad_seq"))) { await sleep(3000); continue; }
      throw new Error(`${memo} failed: ${JSON.stringify(codes ?? (e as Error).message)}`);
    }
  }
}

// ------------------------------------------------------------------ oracle prices
type A = { id: string; code: string; category: string; peg: string | null; offPeg: boolean; name: string | null; logo: string | null;
  mainnet: null | { code: string; issuer: string; homeDomain: string | null; expert: string };
  testnet: { kind: string; code: string; issuer: string | null; sac: string; label: string } };
const assets = (assetsDoc.assets as A[]).filter((a) => a.id !== "QUSD" && params.assets[a.id]);
if (assets.length !== 42) throw new Error(`expected 42 reserves (XLM + 41), got ${assets.length}`);
const priceOf = (sac: string): bigint => {
  const out = inv(ORACLE, "quasaria-admin", ["lastprice", "--asset", JSON.stringify({ Stellar: sac })], false);
  const pd = JSON.parse(out);
  if (!pd) throw new Error(`oracle has no price for ${sac}; run the oracle feed first`);
  const age = Math.floor(Date.now() / 1000) - Number(pd.timestamp);
  if (age > 800) throw new Error(`oracle price for ${sac} is ${age}s old; refresh the feed first`);
  return BigInt(pd.price);
};
const rawFromUsd = (usd: number, price: bigint) => (BigInt(Math.round(usd * 1e6)) * P14 * 10n ** 7n) / (price * 1_000_000n);
const ceilRawFromUsd = (usd: number, price: bigint) => {
  const n = BigInt(Math.round(usd * 1e6)) * P14 * 10n ** 7n, d = price * 1_000_000n;
  return (n + d - 1n) / d;
};
const max = (a: bigint, b: bigint) => (a > b ? a : b);

type Tier = { label: string; ltv: number; threshold: number; bonus: number; reserveFactor: number; collateral: boolean; borrowable: boolean; supplyCapUsd: number; borrowCapUsd: number; rate: { base: number; slope1: number; optimal: number; slope2: number } };
function reserveConfig(t: Tier, price: bigint) {
  return {
    decimals: 7,
    ltv_bps: t.ltv, liq_threshold_bps: t.threshold, liq_bonus_bps: t.bonus, reserve_factor_bps: t.reserveFactor,
    supply_cap: rawFromUsd(t.supplyCapUsd, price).toString(),
    borrow_cap: (t.borrowable ? rawFromUsd(t.borrowCapUsd, price) : 0n).toString(),
    min_supply: max(1000n, ceilRawFromUsd(params.minSupplyUsd, price)).toString(),
    min_borrow: max(1000n, ceilRawFromUsd(params.minBorrowUsd, price)).toString(),
    collateral_enabled: t.collateral, borrowable: t.borrowable,
    base_rate_bps: t.rate.base, slope1_bps: t.rate.slope1, optimal_util_bps: t.rate.optimal, slope2_bps: t.rate.slope2,
  };
}

// ------------------------------------------------------------------ deploy pool
const state = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : {};
let POOL: string = dep.contracts.lending;
if (!POOL) {
  if (!existsSync(WASM)) throw new Error("build the contracts first (stellar contract build)");
  assertWasmDeployable(WASM, NET); // F-12 guard (refuses mocks / non-audited wasm on mainnet)
  const pc = params.pool;
  const cfg = { max_price_age: pc.maxPriceAgeSec, close_factor_bps: pc.closeFactorBps, close_dust_usd: (BigInt(pc.closeDustUsd) * P14).toString(), max_user_reserves: pc.maxUserReserves, max_borrowers: pc.maxBorrowers };
  log("deploying lending pool…");
  POOL = retry("deploy", () => sh(["contract", "deploy", "--wasm", WASM, "--source", "quasaria-admin", "--network", NET, "--",
    "--admin", ADMIN, "--oracle", ORACLE, "--config", JSON.stringify(cfg), "--timelock_delay", String(pc.timelockDelaySec)])).split("\n").pop()!.trim();
  dep.contracts.lending = POOL;
  writeFileSync(DEP, JSON.stringify(dep, null, 2) + "\n");
  log(`  pool ${POOL}`);
}
const wasmHash = sh(["contract", "fetch", "--id", POOL, "--network", NET, "--out-file", "/tmp/lending.fetched.wasm"]) || "";
void wasmHash;

// ------------------------------------------------------------------ reserves
// Mainnet Step 1: listing is a timelocked action and a reserve is listed with
// borrowing + collateral disabled; enabling each is its own timelocked action.
// Queue everything for unlisted assets, wait out the delay once, execute.
// (Needs the Step-1 lending wasm; the pre-Step-1 pool had an instant add_reserve.)
const listed = new Set<string>(JSON.parse(inv(POOL, "quasaria-admin", ["reserve_list"], false)));
const queued: string[] = [];
const queue = (action: unknown) => {
  const a = JSON.stringify(action);
  inv(POOL, "quasaria-admin", ["propose_action", "--action", a]);
  queued.push(a);
};
const rows: Record<string, unknown>[] = [];
for (const a of assets) {
  const tierName = params.assets[a.id] as string;
  const t = params.tiers[tierName] as Tier;
  const price = priceOf(a.testnet.sac);
  let cfg = reserveConfig(t, price);
  if (!listed.has(a.testnet.sac)) {
    const c = cfg as Record<string, unknown>;
    const listing = { ...c, borrowable: false, borrow_cap: "0", collateral_enabled: false, ltv_bps: 0 };
    queue({ AddReserve: [a.testnet.sac, listing] });
    if (c.collateral_enabled) queue({ EnableCollateral: [a.testnet.sac, { ltv_bps: c.ltv_bps, liq_threshold_bps: c.liq_threshold_bps, liq_bonus_bps: c.liq_bonus_bps }] });
    if (c.borrowable) queue({ EnableBorrowing: [a.testnet.sac, String(c.borrow_cap)] });
    log(`  + queued reserve ${a.id.padEnd(7)} ${tierName.padEnd(19)} LTV ${t.ltv / 100}% thr ${t.threshold / 100}% bonus ${t.bonus / 100}%`);
  } else {
    cfg = JSON.parse(inv(POOL, "quasaria-admin", ["reserve_config", "--asset", a.testnet.sac], false));
  }
  rows.push({
    id: a.id, code: a.code, canonical: a.mainnet ? `${a.mainnet.code}:${a.mainnet.issuer}` : "XLM:native",
    testnetCanonical: a.testnet.issuer ? `${a.testnet.code}:${a.testnet.issuer}` : "XLM:native",
    homeDomain: a.mainnet?.homeDomain ?? null, testnetKind: a.testnet.kind, testnetCode: a.testnet.code, testnetIssuer: a.testnet.issuer,
    sac: a.testnet.sac, name: a.name, logo: a.logo, category: a.category, peg: a.peg, offPeg: a.offPeg, tier: tierName, tierLabel: t.label,
    config: cfg, seedPriceUsd: Number(price) / 1e14,
  });
}

if (queued.length) {
  const delay = Number(params.pool.timelockDelaySec) + 15;
  log(`  waiting ${delay}s for the timelock (${queued.length} queued actions)…`);
  await sleep(delay * 1000);
  for (const a of queued) inv(POOL, "quasaria-admin", ["execute_action", "--action", a]);
  log(`  executed ${queued.length} timelocked listing actions`);
}

// ------------------------------------------------------------------ seed supply
const seeded: Record<string, string> = state.seeded ?? {};
const fmt = (n: number) => (Math.floor(n * 1e7) / 1e7).toFixed(7);
if (!process.argv.includes("--no-seed")) {
  const SEEDER = ensureIdentity("quasaria-lending-seeder");
  const seedKp = Keypair.fromSecret(secretOf("quasaria-lending-seeder"));
  const acct = await horizon.loadAccount(SEEDER);
  const has = (code: string, issuer: string) => acct.balances.some((b) => "asset_code" in b && b.asset_code === code && b.asset_issuer === issuer);
  const credit = assets.filter((a) => a.testnet.issuer);
  const need = credit.filter((a) => !has(a.testnet.code, a.testnet.issuer!));
  for (let i = 0; i < need.length; i += 50)
    await submit(seedKp, need.slice(i, i + 50).map((a) => Operation.changeTrust({ asset: new Asset(a.testnet.code, a.testnet.issuer!) })), "trustlines");
  log(`  seeder ${SEEDER.slice(0, 6)}… trustlines ok (${need.length} new)`);
  // mirror issuers pay the seeder; admin sends real testnet USDC
  const issuers: Record<string, string> = { [assetsDoc.mirrorIssuers.stablecoin.address]: "quasaria-mock-stables", [assetsDoc.mirrorIssuers.popular.address]: "quasaria-mock-assets" };
  const pending = credit.filter((a) => !seeded[a.id] && !(state.minted ?? []).includes(a.id));
  const amountFor = (a: A) => {
    if (a.id === "USDC") return SEED_USDC;
    const px = Number(rows.find((r) => r.id === a.id)!.seedPriceUsd);
    return SEED_USD / px;
  };
  for (const [issuer, idn] of Object.entries(issuers)) {
    const mine = pending.filter((a) => a.testnet.issuer === issuer);
    if (!mine.length) continue;
    const kp = Keypair.fromSecret(secretOf(idn));
    await submit(kp, mine.map((a) => Operation.payment({ destination: SEEDER, asset: new Asset(a.testnet.code, issuer), amount: fmt(amountFor(a) * 1.02) })), `mint ${idn}`);
  }
  state.minted = [...new Set([...(state.minted ?? []), ...pending.map((a) => a.id)])];
  const usdc = pending.find((a) => a.id === "USDC");
  if (usdc) {
    const adminKp = Keypair.fromSecret(secretOf("quasaria-admin"));
    await submit(adminKp, [Operation.payment({ destination: SEEDER, asset: new Asset("USDC", usdc.testnet.issuer!), amount: fmt(SEED_USDC) })], "usdc to seeder");
  }
  // The pool caps reserves per account (max_user_reserves = 8), so supply is spread over
  // seeder accounts: #0 holds all minted tokens and forwards each group's share.
  const PER = Number(params.pool.maxUserReserves);
  const seeders: string[] = [SEEDER];
  for (let g = 0; g * PER < assets.length; g++) {
    const group = assets.slice(g * PER, g * PER + PER);
    if (group.every((a) => seeded[a.id])) { if (g > 0) seeders.push(sh(["keys", "address", `quasaria-lending-seeder-${g}`])); continue; }
    const idn = g === 0 ? "quasaria-lending-seeder" : `quasaria-lending-seeder-${g}`;
    const addr = g === 0 ? SEEDER : ensureIdentity(idn);
    if (g > 0) {
      seeders.push(addr);
      const kp = Keypair.fromSecret(secretOf(idn));
      const ac = await horizon.loadAccount(addr);
      const hasT = (a: A) => ac.balances.some((b) => "asset_code" in b && b.asset_code === a.testnet.code && b.asset_issuer === a.testnet.issuer);
      const tl = group.filter((a) => a.testnet.issuer && !hasT(a));
      if (tl.length) await submit(kp, tl.map((a) => Operation.changeTrust({ asset: new Asset(a.testnet.code, a.testnet.issuer!) })), `trustlines ${idn}`);
      const pay = group.filter((a) => a.testnet.issuer && !seeded[a.id]);
      const src = await horizon.loadAccount(SEEDER);
      const balOf = (a: A) => Number(src.balances.find((b) => "asset_code" in b && b.asset_code === a.testnet.code && b.asset_issuer === a.testnet.issuer)?.balance ?? 0);
      if (pay.length) await submit(seedKp, pay.map((a) => Operation.payment({ destination: addr, asset: new Asset(a.testnet.code, a.testnet.issuer!), amount: fmt(Math.min(amountFor(a) * 1.01, balOf(a))) })), `forward to ${idn}`);
    }
    for (const a of group) {
      if (seeded[a.id]) continue;
      let amt = a.id === "XLM" ? SEED_XLM : amountFor(a);
      if (a.testnet.issuer) {
        const me = await horizon.loadAccount(addr);
        const b = Number(me.balances.find((x) => "asset_code" in x && x.asset_code === a.testnet.code && x.asset_issuer === a.testnet.issuer)?.balance ?? 0);
        amt = Math.min(amt, b);
      }
      const raw = BigInt(Math.floor(amt * 1e7));
      inv(POOL, idn, ["supply", "--user", addr, "--asset", a.testnet.sac, "--amount", raw.toString()]);
      seeded[a.id] = raw.toString();
      log(`  supplied ${a.id.padEnd(7)} ${fmt(amt)} (~$${a.id === "XLM" ? (SEED_XLM * Number(rows[0].seedPriceUsd)).toFixed(0) : a.id === "USDC" ? SEED_USDC : SEED_USD}) from ${idn}`);
      state.seeded = seeded;
      writeFileSync(OUT, JSON.stringify({ ...state, seeders }, null, 2) + "\n");
    }
  }
  state.seeders = seeders;
  state.seeder = SEEDER;
}

// ------------------------------------------------------------------ write outputs
const pc = params.pool;
const lendingDoc = {
  network: "testnet",
  _comment: "Quasaria lending pool on TESTNET (unaudited). One reserve per asset, keyed by its Stellar Asset Contract (SEP-41 via token::Client). Canonical asset ids are CODE:ISSUER (SEP-1 [[CURRENCIES]] / SEP-11 style); mainnet reference ids are shown alongside the testnet asset actually used. Prices: Quasaria mock oracle (SEP-40 interface) refreshed from live mainnet Horizon by the bot (npm run oracle-feed). Written by scripts/deploy-lending.ts.",
  updatedAt: new Date().toISOString(),
  pool: POOL, oracle: ORACLE, oracleDecimals: 14, admin: ADMIN,
  poolConfig: { maxPriceAgeSec: pc.maxPriceAgeSec, closeFactorBps: pc.closeFactorBps, closeDustUsd: pc.closeDustUsd, maxUserReserves: pc.maxUserReserves, maxBorrowers: pc.maxBorrowers, timelockDelaySec: pc.timelockDelaySec },
  hfScale: 10_000_000, indexScale: "1000000000000",
  reserves: rows,
};
writeFileSync(FRONT, JSON.stringify(lendingDoc, null, 2) + "\n");
writeFileSync(OUT, JSON.stringify({ ...lendingDoc, seeded, seeders: state.seeders ?? [], minted: state.minted ?? [] }, null, 2) + "\n");
dep.lending = {
  pool: POOL, reserves: rows.length, source: "deployments/testnet-lending.json",
  oracle: ORACLE, oracleNote: "Mock oracle (SEP-40 interface: lastprice/price/prices/decimals/resolution/assets/last_timestamp). Mainnet needs Reflector.",
  timelockDelaySeconds: pc.timelockDelaySec, note: "Supply/borrow pool, testnet-only, unaudited.",
};
writeFileSync(DEP, JSON.stringify(dep, null, 2) + "\n");
log(`done: pool ${POOL}, ${rows.length} reserves`);
