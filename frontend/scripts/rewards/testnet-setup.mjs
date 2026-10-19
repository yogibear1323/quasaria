#!/usr/bin/env node
/**
 * TESTNET ONLY. Creates throwaway accounts with Friendbot, issues the 100B test GLACIERQ (50B reward reserve, 50B treasury),
 * funds the referral payer float from the reserve, seeds an XLM/GLACIERQ native pool + a few SDEX offers, then LOCKS the issuer
 * (master weight 0), rehearsing the mainnet steps. Idempotent: re-running skips what already exists.
 * Keys go to ~/.quasaria-testnet-glacierq/keys.json (mode 600, outside git). Secrets are never printed.
 * Refuses to run against mainnet: the network passphrase is hard-coded to testnet.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Asset, BASE_FEE, Horizon, Keypair, LiquidityPoolAsset, Networks, Operation, TransactionBuilder, getLiquidityPoolId, LiquidityPoolFeeV18 } from "@stellar/stellar-sdk";

const HOME = process.env.HOME ?? "/home/box";
const KEYS = join(HOME, ".quasaria-testnet-glacierq", "keys.json");
const server = new Horizon.Server("https://horizon-testnet.stellar.org");
const log = (...x) => console.log(...x);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function load() {
  if (existsSync(KEYS)) return JSON.parse(readFileSync(KEYS, "utf8"));
  const accounts = {};
  for (const n of ["issuer", "distribution", "reward_reserve", "referral_payer", "pool_seed"]) { const kp = Keypair.random(); accounts[n] = { public: kp.publicKey(), secret: kp.secret() }; }
  return { network: "testnet", created: new Date().toISOString(), accounts };
}
function save(k) { mkdirSync(dirname(KEYS), { recursive: true, mode: 0o700 }); writeFileSync(KEYS, JSON.stringify(k, null, 2), { mode: 0o600 }); chmodSync(KEYS, 0o600); }

async function friendbot(pub) {
  for (let i = 0; i < 6; i++) {
    try { await server.loadAccount(pub); return; } catch { /* not funded yet */ }
    const r = await fetch(`https://friendbot.stellar.org/?addr=${pub}`).catch(() => null);
    if (r?.ok) { await sleep(1500); continue; }
    await sleep(3000);
  }
  await server.loadAccount(pub);
}
async function tx(name, ops, extraSigners = []) {
  const kp = Keypair.fromSecret(K.accounts[name].secret);
  const acct = await server.loadAccount(kp.publicKey());
  const b = new TransactionBuilder(acct, { fee: String(Number(BASE_FEE) * ops.length * 10), networkPassphrase: Networks.TESTNET }).setTimeout(120);
  ops.forEach((o) => b.addOperation(o));
  const t = b.build(); t.sign(kp); extraSigners.forEach((s) => t.sign(s));
  return server.submitTransaction(t);
}
const bal = (acc, code, issuer) => acc.balances.find((b) => (code ? b.asset_code === code && b.asset_issuer === issuer : b.asset_type === "native"))?.balance;

const K = load(); save(K);
const pub = (n) => K.accounts[n].public;
log("accounts (public):"); for (const n of Object.keys(K.accounts)) log(`  ${n.padEnd(15)} ${pub(n)}`);
for (const n of Object.keys(K.accounts)) await friendbot(pub(n));
log("all funded by Friendbot");

const GQ = new Asset("GLACIERQ", pub("issuer"));
const issuerAcc = await server.loadAccount(pub("issuer"));
const locked = issuerAcc.signers.every((s) => s.weight === 0) || issuerAcc.signers.find((s) => s.key === pub("issuer"))?.weight === 0;

// 1. trustlines
for (const n of ["distribution", "reward_reserve", "referral_payer", "pool_seed"]) {
  const a = await server.loadAccount(pub(n));
  if (bal(a, "GLACIERQ", pub("issuer")) === undefined) { await tx(n, [Operation.changeTrust({ asset: GQ })]); log(`trustline ${n}`); }
}
// 2. issue 100B once (50B reserve + 50B treasury) then lock
const reserveAcc = await server.loadAccount(pub("reward_reserve"));
const treasuryAcc = await server.loadAccount(pub("distribution"));
const total = Number(bal(reserveAcc, "GLACIERQ", pub("issuer"))) + Number(bal(treasuryAcc, "GLACIERQ", pub("issuer")));
if (total === 0 && !locked) {
  await tx("issuer", [
    Operation.payment({ destination: pub("reward_reserve"), asset: GQ, amount: "50000000000" }),
    Operation.payment({ destination: pub("distribution"), asset: GQ, amount: "50000000000" }),
  ]);
  log("issued 50B -> reward reserve, 50B -> treasury");
}
// 3. referral payer float (30M) from the reserve
const payerAcc = await server.loadAccount(pub("referral_payer"));
const reserveNow = await server.loadAccount(pub("reward_reserve")); // reload: the balance read before issuance is stale on a first run
if (Number(bal(payerAcc, "GLACIERQ", pub("issuer"))) < 30_000_000 && Number(bal(reserveNow, "GLACIERQ", pub("issuer"))) > 0) {
  await tx("reward_reserve", [Operation.payment({ destination: pub("referral_payer"), asset: GQ, amount: "30000000" })]);
  log("referral payer float: 30,000,000 GLACIERQ from the reserve");
}
// 4. seed the XLM/GLACIERQ pool + offers from pool_seed (GLACIERQ comes from the treasury)
const seed = await server.loadAccount(pub("pool_seed"));
if (Number(bal(seed, "GLACIERQ", pub("issuer"))) < 1_000_000) {
  await tx("distribution", [Operation.payment({ destination: pub("pool_seed"), asset: GQ, amount: "10000000" })]);
  log("treasury -> pool_seed 10,000,000 GLACIERQ");
}
const lpAsset = new LiquidityPoolAsset(Asset.native(), GQ, LiquidityPoolFeeV18);
const poolId = Array.from(getLiquidityPoolId("constant_product", lpAsset.getLiquidityPoolParameters()), (v) => v.toString(16).padStart(2, "0")).join("");
const hasShares = (await server.loadAccount(pub("pool_seed"))).balances.some((b) => b.asset_type === "liquidity_pool_shares" && b.liquidity_pool_id === poolId);
if (!hasShares) {
  await tx("pool_seed", [
    Operation.changeTrust({ asset: lpAsset }),
    Operation.liquidityPoolDeposit({ liquidityPoolId: poolId, maxAmountA: "2000", maxAmountB: "4000000", minPrice: { n: 1, d: 5000 }, maxPrice: { n: 1, d: 500 } }),
  ]);
  log(`pool ${poolId.slice(0, 12)}… seeded: 2,000 XLM / 4,000,000 GLACIERQ`);
}
const offers = (await server.offers().forAccount(pub("pool_seed")).call()).records;
if (!offers.length) {
  await tx("pool_seed", [
    Operation.manageSellOffer({ selling: GQ, buying: Asset.native(), amount: "500000", price: "0.00052" }),
    Operation.manageBuyOffer({ selling: Asset.native(), buying: GQ, buyAmount: "500000", price: "0.00048" }),
  ]);
  log("SDEX offers: sell 500k @ 0.00052 XLM, buy 500k @ 0.00048 XLM");
}
// 5. lock the issuer (master weight 0) once everything is issued
const iss = await server.loadAccount(pub("issuer"));
if (!iss.signers.find((s) => s.key === pub("issuer") && s.weight === 0)) {
  await tx("issuer", [Operation.setOptions({ masterWeight: 0, lowThreshold: 255, medThreshold: 255, highThreshold: 255 })]);
  log("issuer LOCKED (master weight 0)");
}
// 6. publish public addresses for the app
const cfgPath = new URL("../../src/config/rewards.testnet.json", import.meta.url);
writeFileSync(cfgPath, JSON.stringify({
  _comment: "Public testnet reward-token accounts (throwaway testnet keys, held outside git). Filled in by scripts/rewards/testnet-setup.mjs.",
  issuer: pub("issuer"), reserve: pub("reward_reserve"), treasury: pub("distribution"), payer: pub("referral_payer"), poolSeed: pub("pool_seed"), poolId,
}, null, 2) + "\n");
log("wrote src/config/rewards.testnet.json (public addresses only)");
const fin = await server.loadAccount(pub("issuer"));
log("issuer signers:", fin.signers.map((s) => `${s.key.slice(0, 6)}…:${s.weight}`).join(", "));
