// TESTNET ONLY. Curated asset list → testnet assets + v3 (hardened) AMM pools.
//
// Input : config/assets.mainnet.json (scripts/verify-mainnet-assets.ts; verified rows only)
// Output: deployments/testnet-assets.json (+ copy in frontend/src/config/)
//
// For every verified mainnet asset:
//   - use the REAL testnet asset when a legitimate testnet issuer exists AND we can hold it
//     (Circle's testnet USDC — published in Circle's docs; admin already holds it);
//   - otherwise issue a clearly-labelled TESTNET MIRROR ("mk<CODE>") from a Quasaria testnet
//     issuer whose home_domain is *.quasaria.invalid, and deploy its Stellar Asset Contract.
// Then deploy one v3 quasaria_amm_pool (pause / timelock / two-step admin; same wasm hash as
// the core v3 pools) per planned pair, allow it as a referral fee source, and seed modest
// liquidity at the live MAINNET price ratio recorded in assets.mainnet.json.
// The v3 router is stateless (no pool registry on-chain): "registration" = the pool list in
// testnet-assets.json that the frontend/bot route over, checked with router.get_amounts_out.
// Keys are read from the stellar CLI keystore in-process and never printed. Idempotent.
// Usage: node scripts/deploy-asset-pools-v3.ts [--tier 1|2|all] [--plan]
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Asset, BASE_FEE, Horizon, Keypair, Networks, Operation, TransactionBuilder } from "../frontend/node_modules/@stellar/stellar-sdk/lib/esm/index.js";

if (process.env.NETWORK && process.env.NETWORK !== "testnet") throw new Error("TESTNET ONLY");
const NETWORK = "testnet";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const WASM = resolve(root, "contracts/target/wasm32v1-none/release/quasaria_amm_pool.wasm");
const OUT = resolve(root, "deployments/testnet-assets.json");
const FRONT = resolve(root, "frontend/src/config/testnet-assets.json");
const dep = JSON.parse(readFileSync(resolve(root, "deployments/testnet.json"), "utf8"));
if (dep.network !== "testnet" || dep.networkPassphrase !== Networks.TESTNET) throw new Error("deployment is not testnet");
const mainnet = JSON.parse(readFileSync(resolve(root, "config/assets.mainnet.json"), "utf8"));
const oldStables = JSON.parse(readFileSync(resolve(root, "deployments/testnet-stablecoins.json"), "utf8"));
const horizon = new Horizon.Server(dep.horizonUrl);
const arg = (n: string, d?: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] ?? "1" : d; };
const TIER = arg("tier", "all")!;
const PLAN_ONLY = process.argv.includes("--plan");
const SEED_XLM = Number(process.env.SEED_XLM ?? 150);        // XLM side of each XLM pool
const SEED_XLM_BIG = Number(process.env.SEED_XLM_BIG ?? 400); // USDC/XLM + SHX/XLM (smoke-tested pairs)
const SEED_QUOTE_USD = Number(process.env.SEED_QUOTE_USD ?? 25); // quote side of stable-stable pools (≈ USD)
const DELAY = String(dep.governance?.timelockDelaySeconds ?? 300);
const ADMIN = dep.admin as string;
const XLM_SAC = dep.contracts.xlmSac as string, QUSD_SAC = dep.contracts.qusdSac as string;

// Legitimate testnet issuers (Circle publishes both in its contract-address docs). Only used
// when the admin can actually hold enough (Circle's faucet is a manual web form; testnet
// EURC has no sell-side liquidity on the testnet SDEX) — otherwise a mirror is deployed.
const REAL_TESTNET: Record<string, { issuer: string; source: string }> = {
  USDC: { issuer: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5", source: "https://developers.circle.com/stablecoins/usdc-contract-addresses" },
  EURC: { issuer: "GB3Q6QDZYTHWT7E5PVS3W7FUT5GVAFC5KSZFFLPU25GO7VTC3NM2ZTVO", source: "https://developers.circle.com/stablecoins/eurc-contract-addresses" },
};
const MIRROR = {
  stablecoin: { id: "quasaria-mock-stables", homeDomain: "mock-stables.quasaria.invalid" },
  popular: { id: "quasaria-mock-assets", homeDomain: "mock-assets.quasaria.invalid" },
} as const;

const sh = (args: string[]) => execFileSync("stellar", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const secretOf = (id: string) => execFileSync("stellar", ["keys", "show", id], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
const ensureIdentity = (id: string) => {
  try { return sh(["keys", "address", id]); } catch { sh(["keys", "generate", id, "--network", NETWORK, "--fund"]); return sh(["keys", "address", id]); }
};
const f7 = (n: number) => (Math.floor(n * 1e7) / 1e7).toFixed(7);
const raw = (n: number) => String(BigInt(Math.floor(n * 1e7)));
const log = (...a: unknown[]) => console.log(...a);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
function retry<T>(label: string, fn: () => T, tries = 3): T {
  for (let i = 1; ; i++) {
    try { return fn(); } catch (e) {
      const msg = String((e as { stderr?: string }).stderr ?? (e as Error).message).split("\n").filter(Boolean).slice(-3).join(" | ");
      if (i >= tries) throw new Error(`${label}: ${msg}`);
      log(`   retry ${label} (${i}): ${msg.slice(0, 160)}`);
      execFileSync("sleep", ["4"]);
    }
  }
}
const inv = (id: string, args: string[], send = true) =>
  retry(`invoke ${args[0]}`, () => sh(["contract", "invoke", "--id", id, "--source", "quasaria-admin", "--network", NETWORK, ...(send ? [] : ["--send=no"]), "--", ...args]));

// ------------------------------------------------------------------ asset plan
type MainRow = { code: string; issuer: string; category: "stablecoin" | "popular"; peg: string | null; name: string | null; org: string | null; homeDomain: string | null; verification: string; verified: boolean; verifiedVia: string | null; note: string | null; logo: string | null; holders: number | null; pricePerXlm: number | null; priceSource: string; offPeg?: boolean; expert: string };
const rows = (mainnet.assets as MainRow[]).filter((r) => r.verified && r.pricePerXlm);
const state = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : {};
state.assets = state.assets ?? [];
state.pools = state.pools ?? [];
type TAsset = {
  id: string; code: string; category: "stablecoin" | "popular" | "base"; peg: string | null; name: string | null; org: string | null; logo: string | null;
  mainnet: null | { code: string; issuer: string; homeDomain: string | null; verification: string; verifiedVia: string | null; note: string | null; holders: number | null; expert: string };
  pricePerXlm: number; priceSource: string; offPeg: boolean;
  testnet: { kind: "native" | "real" | "mirror" | "demo"; code: string; issuer: string | null; sac: string | null; label: string; note?: string };
};
const prevAsset = (id: string) => (state.assets as TAsset[]).find((a) => a.id === id);
const mirrorIssuers: Record<string, { address: string; homeDomain: string }> = {};
for (const k of ["stablecoin", "popular"] as const) mirrorIssuers[k] = { address: ensureIdentity(MIRROR[k].id), homeDomain: MIRROR[k].homeDomain };
state.mirrorIssuers = mirrorIssuers;

const adminAcct0 = await horizon.loadAccount(ADMIN);
const holds = (code: string, issuer: string) => Number(adminAcct0.balances.find((b) => "asset_code" in b && b.asset_code === code && b.asset_issuer === issuer)?.balance ?? 0);

const assets: TAsset[] = [
  { id: "XLM", code: "XLM", category: "base", peg: null, name: "Stellar Lumens", org: "Stellar Development Foundation", logo: null, mainnet: null, pricePerXlm: 1, priceSource: "native", offPeg: false,
    testnet: { kind: "native", code: "XLM", issuer: null, sac: XLM_SAC, label: "Native XLM (testnet, no value)" } },
  { id: "QUSD", code: "QUSD", category: "base", peg: "USD", name: "Quasaria demo USD", org: "Quasaria (testnet demo)", logo: null, mainnet: null,
    pricePerXlm: rows.find((r) => r.code === "USDC")!.pricePerXlm!, priceSource: "demo 1 QUSD ≈ 1 USD", offPeg: false,
    testnet: { kind: "demo", code: "QUSD", issuer: ADMIN, sac: QUSD_SAC, label: "QUSD — Quasaria testnet demo dollar (no mainnet equivalent, no value)" } },
];
for (const r of rows) {
  const real = REAL_TESTNET[r.code];
  const need = r.pricePerXlm! * SEED_XLM_BIG * 1.5 + 100;
  const useReal = real && holds(r.code, real.issuer) >= Math.min(need, 300);
  const iss = mirrorIssuers[r.category];
  const code = useReal ? r.code : `mk${r.code}`.slice(0, 12);
  const prev = prevAsset(r.code);
  assets.push({
    id: r.code, code: r.code, category: r.category, peg: r.peg, name: r.name, org: r.org, logo: r.logo,
    mainnet: { code: r.code, issuer: r.issuer, homeDomain: r.homeDomain, verification: r.verification, verifiedVia: r.verifiedVia, note: r.note, holders: r.holders, expert: r.expert },
    pricePerXlm: r.pricePerXlm!, priceSource: r.priceSource, offPeg: Boolean(r.offPeg),
    testnet: useReal
      ? { kind: "real", code, issuer: real.issuer, sac: prev?.testnet.kind === "real" ? prev.testnet.sac : null, label: `Real testnet ${r.code} (official testnet issuer, no value)`, note: `Testnet issuer published at ${real.source}` }
      : { kind: "mirror", code, issuer: iss.address, sac: prev?.testnet.code === code && prev.testnet.issuer === iss.address ? prev.testnet.sac : null,
          label: `Testnet mirror of ${r.code} — Quasaria mock, not redeemable, no value`,
          note: real ? `A real testnet ${r.code} exists (${real.issuer.slice(0, 6)}…, ${real.source}) but none is obtainable: Circle's faucet is a manual web form and the testnet SDEX has no sell-side liquidity.` : `No ${r.code} issuer exists on testnet; mirror issued by ${iss.address.slice(0, 6)}… (home_domain ${iss.homeDomain}).` },
  });
}
state.assets = assets;
const byId = Object.fromEntries(assets.map((a) => [a.id, a]));

// ------------------------------------------------------------------ pool plan
type Pool = { id: string; pair: string; base: string; quote: string; tokenA: string; tokenB: string; assetA: string; assetB: string; feeBps: number; tier: 1 | 2; kind: "xlm" | "stable-stable" | "demo"; pool?: string; seeded?: { a: number; b: number }; routerCheck?: string };
const plan: Omit<Pool, "tokenA" | "tokenB">[] = [];
const add = (base: string, quote: string, tier: 1 | 2, kind: Pool["kind"]) => {
  if (!byId[base] || !byId[quote]) return log(`  (skip ${base}/${quote}: asset not in verified list)`);
  // token A/B order: XLM first for XLM pools, else base then quote
  const [a, b] = quote === "XLM" ? ["XLM", base] : [base, quote];
  plan.push({ id: `${base}-${quote}`, pair: `${base}/${quote}`, base, quote, assetA: a, assetB: b, feeBps: 30, tier, kind });
};
const stables = assets.filter((a) => a.category === "stablecoin");
const popular = assets.filter((a) => a.category === "popular");
for (const s of stables) add(s.id, "XLM", 1, "xlm");
add("EURC", "USDC", 1, "stable-stable");
for (const id of ["SHX", "AQUA", "yXLM"]) add(id, "XLM", 1, "xlm");
for (const p of popular.filter((p) => !["SHX", "AQUA", "yXLM"].includes(p.id))) add(p.id, "XLM", 2, "xlm");
for (const s of stables.filter((s) => s.peg === "USD" && s.id !== "USDC" && !s.offPeg)) add(s.id, "USDC", 2, "stable-stable");
add("EURCV", "EURC", 2, "stable-stable");
add("yUSDC", "USDC", 2, "stable-stable");
add("QUSD", "USDC", 2, "demo");
log(`plan: ${assets.length} assets (${assets.filter((a) => a.testnet.kind === "real").length} real testnet, ${assets.filter((a) => a.testnet.kind === "mirror").length} mirrors) · ${plan.length} pools (tier1 ${plan.filter((p) => p.tier === 1).length}, tier2 ${plan.filter((p) => p.tier === 2).length})`);
if (PLAN_ONLY) { for (const p of plan) log(`  T${p.tier} ${p.pair.padEnd(14)} ${byId[p.base].testnet.kind}`); process.exit(0); }

const save = () => {
  const doc = {
    network: NETWORK, generation: "v3",
    _comment: "Curated asset list on TESTNET + v3 (hardened: pause, timelock, two-step admin) AMM pools. Mainnet codes/issuers are reference data from config/assets.mainnet.json (verified read-only). 'mirror' assets are Quasaria testnet mocks (code mk<CODE>, issuer home_domain *.quasaria.invalid): not redeemable, no value. Written by scripts/deploy-asset-pools-v3.ts.",
    updatedAt: new Date().toISOString(), wasmPool: "quasaria_amm_pool.wasm (v3)", router: dep.contracts.router, referral: dep.contracts.referral,
    timelockDelaySeconds: Number(DELAY), mainnetSource: { file: "config/assets.mainnet.json", generatedAt: mainnet.generatedAt, usdPerXlm: mainnet.usdPerXlm },
    mirrorIssuers, assets: state.assets, pools: state.pools,
    retired: {
      note: "v2-era XLM/stablecoin pools (pre-hardening wasm: no pause/timelock/two-step admin). Retired from the UI and routing; IDs kept for reference. Existing LPs can still withdraw (withdraw is never paused).",
      source: "deployments/testnet-stablecoins.json",
      pools: (oldStables.pools as { mainnetCode: string; code: string; pool: string; sac: string }[]).map((p) => ({ pair: `${p.mainnetCode}/XLM`, testnetCode: p.code, pool: p.pool, sac: p.sac })),
    },
  };
  writeFileSync(OUT, JSON.stringify(doc, null, 2) + "\n");
  writeFileSync(FRONT, JSON.stringify(doc, null, 2) + "\n");
};
save();

// ------------------------------------------------------------------ XLM budget (friendbot → merge into admin)
const todo = plan.filter((p) => TIER === "all" || String(p.tier) === TIER);
const xlmNeed = todo.filter((p) => p.quote === "XLM" && !(state.pools as Pool[]).find((x) => x.id === p.id)?.seeded).length * (SEED_XLM_BIG + 15) + 1500;
const xlmBal = async () => Number((await horizon.loadAccount(ADMIN)).balances.find((b) => b.asset_type === "native")!.balance);
let have = await xlmBal();
for (let i = 1; have < xlmNeed && i <= 8; i++) {
  const id = `quasaria-funder-assets-${Date.now()}`;
  const addr = ensureIdentity(id);
  await submit(Keypair.fromSecret(secretOf(id)), [Operation.accountMerge({ destination: ADMIN })], "merge funder");
  try { sh(["keys", "rm", id]); } catch { /* ignore */ }
  have = await xlmBal();
  log(`  merged friendbot funder ${addr.slice(0, 6)}… → admin ${have.toFixed(0)} XLM (need ~${xlmNeed})`);
}

// ------------------------------------------------------------------ mirrors: home_domain, trustlines, mint
const adminKp = Keypair.fromSecret(secretOf("quasaria-admin"));
if (adminKp.publicKey() !== ADMIN) throw new Error("admin identity mismatch");
for (const k of ["stablecoin", "popular"] as const) {
  const acct = await horizon.loadAccount(mirrorIssuers[k].address);
  if ((acct as unknown as { home_domain?: string }).home_domain !== MIRROR[k].homeDomain)
    await submit(Keypair.fromSecret(secretOf(MIRROR[k].id)), [Operation.setOptions({ homeDomain: MIRROR[k].homeDomain })], `home_domain ${k}`);
}
const used = new Set(todo.flatMap((p) => [p.base, p.quote]));
const need: Record<string, number> = {};
for (const p of todo.filter((t) => !(state.pools as Pool[]).find((x) => x.id === t.id)?.seeded)) {
  const q = byId[p.quote], b = byId[p.base];
  if (p.quote === "XLM") { const x = ["USDC", "SHX"].includes(p.base) ? SEED_XLM_BIG : SEED_XLM; need[p.base] = (need[p.base] ?? 0) + x * b.pricePerXlm; }
  else { const qAmt = SEED_QUOTE_USD * (q.pricePerXlm / byId.USDC.pricePerXlm); need[p.quote] = (need[p.quote] ?? 0) + qAmt; need[p.base] = (need[p.base] ?? 0) + qAmt * (b.pricePerXlm / q.pricePerXlm); }
}
let acct = await horizon.loadAccount(ADMIN);
const bal = (a: TAsset) => Number(acct.balances.find((x) => "asset_code" in x && x.asset_code === a.testnet.code && x.asset_issuer === a.testnet.issuer)?.balance ?? 0);
const classic = (a: TAsset) => new Asset(a.testnet.code, a.testnet.issuer!);
const tl = assets.filter((a) => used.has(a.id) && (a.testnet.kind === "mirror" || a.testnet.kind === "real") && !acct.balances.some((x) => "asset_code" in x && x.asset_code === a.testnet.code && x.asset_issuer === a.testnet.issuer));
if (tl.length) { await submit(adminKp, tl.map((a) => Operation.changeTrust({ asset: classic(a) })), "trustlines"); log(`  +${tl.length} admin trustlines`); acct = await horizon.loadAccount(ADMIN); }
for (const k of ["stablecoin", "popular"] as const) {
  const mint = assets.filter((a) => used.has(a.id) && a.testnet.kind === "mirror" && a.category === k)
    .map((a) => ({ a, want: (need[a.id] ?? 0) * 1.25 + a.pricePerXlm * 400 })) // + headroom for smoke tests
    .filter(({ a, want }) => bal(a) < want)
    .map(({ a, want }) => Operation.payment({ destination: ADMIN, asset: classic(a), amount: f7(want - bal(a)) }));
  for (let i = 0; i < mint.length; i += 50) await submit(Keypair.fromSecret(secretOf(MIRROR[k].id)), mint.slice(i, i + 50), `mint ${k} mirrors`);
  if (mint.length) log(`  minted ${mint.length} ${k} mirrors to admin`);
}
acct = await horizon.loadAccount(ADMIN);
for (const a of assets.filter((a) => used.has(a.id) && a.testnet.kind === "real")) if (bal(a) < (need[a.id] ?? 0)) throw new Error(`not enough real testnet ${a.id}: have ${bal(a)}, need ${need[a.id]}`);

// ------------------------------------------------------------------ SACs
for (const a of assets.filter((a) => used.has(a.id) && !a.testnet.sac)) {
  const id = `${a.testnet.code}:${a.testnet.issuer}`;
  try { a.testnet.sac = sh(["contract", "asset", "deploy", "--asset", id, "--source", "quasaria-admin", "--network", NETWORK]); }
  catch { a.testnet.sac = sh(["contract", "id", "asset", "--asset", id, "--network", NETWORK]); }
  log(`  SAC ${a.testnet.code.padEnd(9)} ${a.testnet.sac}`);
  save();
}

// ------------------------------------------------------------------ pools
const t0 = Date.now();
let n = 0;
for (const p0 of todo) {
  const pools = state.pools as Pool[];
  let p = pools.find((x) => x.id === p0.id);
  if (!p) { p = { ...p0, tokenA: byId[p0.assetA].testnet.sac!, tokenB: byId[p0.assetB].testnet.sac! }; pools.push(p); }
  const A = byId[p.assetA], B = byId[p.assetB];
  if (!p.pool) {
    const alias = `quasaria-v3-pool-${p.id.toLowerCase()}`;
    let existing = "";
    try { existing = sh(["contract", "alias", "show", alias, "--network", NETWORK]); } catch { /* none */ }
    p.pool = existing || retry(`deploy ${p.pair}`, () => sh(["contract", "deploy", "--wasm", WASM, "--source", "quasaria-admin", "--network", NETWORK, "--alias", alias, "--",
      "--admin", ADMIN, "--token_a", p!.tokenA, "--token_b", p!.tokenB, "--fee_bps", "30", "--referral", `"${dep.contracts.referral}"`, "--timelock_delay", DELAY]));
    save();
    inv(dep.contracts.referral, ["set_fee_source", "--source", p.pool, "--allowed", "true"]);
  }
  if (!p.seeded) {
    const info = JSON.parse(inv(p.pool, ["info"], false));
    if (Number(info.total_shares) === 0) {
      let a: number, b: number;
      if (p.quote === "XLM") { a = ["USDC", "SHX"].includes(p.base) ? SEED_XLM_BIG : SEED_XLM; b = a * B.pricePerXlm; }
      else { const q = byId[p.quote], base = byId[p.base]; const qAmt = SEED_QUOTE_USD * (q.pricePerXlm / byId.USDC.pricePerXlm); const bAmt = qAmt * (base.pricePerXlm / q.pricePerXlm); [a, b] = p.assetA === p.base ? [bAmt, qAmt] : [qAmt, bAmt]; }
      inv(p.pool, ["deposit", "--to", ADMIN, "--desired_a", raw(a), "--desired_b", raw(b), "--min_a", raw(a * 0.999), "--min_b", raw(b * 0.999)]);
      p.seeded = { a: Number(f7(a)), b: Number(f7(b)) };
    } else p.seeded = { a: Number(info.reserve_a) / 1e7, b: Number(info.reserve_b) / 1e7 };
    save();
  }
  n++;
  log(`  ✔ T${p.tier} ${p.pair.padEnd(13)} ${p.pool} · ${p.seeded.a} ${A.id} / ${p.seeded.b} ${B.id}  [${n}/${todo.length}, ${((Date.now() - t0) / 1000).toFixed(0)}s]`);
}

// ------------------------------------------------------------------ router check (read-only simulation)
for (const p of (state.pools as Pool[]).filter((x) => todo.some((t) => t.id === x.id) && x.routerCheck !== "ok")) {
  const tokIn = p.tokenA;
  const amt = raw(p.seeded!.a * 0.001);
  try {
    const out = JSON.parse(inv(dep.contracts.router, ["get_amounts_out", "--pools", JSON.stringify([p.pool]), "--token_in", tokIn, "--amount_in", amt], false));
    p.routerCheck = Number(out[1]) > 0 ? "ok" : `zero-out ${JSON.stringify(out)}`;
  } catch (e) { p.routerCheck = `error ${(e as Error).message.slice(0, 120)}`; }
  save();
}
const bad = (state.pools as Pool[]).filter((p) => p.routerCheck && p.routerCheck !== "ok");
log(`router check: ${(state.pools as Pool[]).filter((p) => p.routerCheck === "ok").length} ok, ${bad.length} failed ${bad.map((p) => p.pair).join(", ")}`);
log(`wrote ${OUT}`);
