#!/usr/bin/env node
/**
 * Daily Quasaria fee distribution.
 *
 * Reads the fee wallet's balances and, per split.json:
 *   - reward_reserve_pct + referral_payer_pct of each fee asset → buys GLACIERQ on the SDEX with a strict-send path
 *     payment (destMin = quote × (1 − slippage)) delivered straight to reward_reserve / referral_payer;
 *   - treasury_pct → paid to the treasury (keys file "distribution") in the asset as received (skipped if the
 *     treasury lacks that trustline);
 *   - GLACIERQ already held is split the same way without a trade.
 * XLM: keeps the account minimum balance + xlm_buffer (network fees/reserves) off the top.
 *
 * SAFETY: dry-run by default (prints the plan, signs nothing).
 *   testnet send: --network testnet --send  AND QUASARIA_TESTNET_SEND=yes
 *   mainnet send: --network mainnet --send  AND QUASARIA_MAINNET_GO=yes
 * Refuses to run if the split is unset/invalid. NOT scheduled anywhere.
 *
 * Usage: node scripts/fees/distribute.mjs [--network mainnet|testnet] [--keys <keys.json>] [--split <split.json>]
 *          [--asset CODE:ISSUER] [--send]
 *   keys.json shape = the mainnet keys file: { accounts: { fee_wallet:{public,secret}, reward_reserve:{public},
 *   referral_payer:{public}, distribution:{public}, issuer:{public} } }. GLACIERQ = GLACIERQ:<issuer> unless --asset.
 * Run with the Stellar SDK resolvable (e.g. NODE_PATH=frontend/node_modules). Secrets are never printed.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { Asset, Horizon, Keypair, Networks, Operation, TransactionBuilder, Memo } = require("@stellar/stellar-sdk");

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const net = opt("network", "mainnet");
if (!["mainnet", "testnet"].includes(net)) throw new Error("--network must be mainnet or testnet");
const here = path.dirname(fileURLToPath(import.meta.url));
const keysPath = opt("keys", "/home/box/.quasaria-mainnet-glacierq/glacierq-mainnet-keys.json");
const splitPath = opt("split", path.join(here, "split.json"));
const wantSend = args.includes("--send");
const gate = net === "mainnet" ? process.env.QUASARIA_MAINNET_GO === "yes" : process.env.QUASARIA_TESTNET_SEND === "yes";
const SEND = wantSend && gate;

export function loadSplit(s) {
  const need = ["reward_reserve_pct", "referral_payer_pct", "treasury_pct", "xlm_buffer", "slippage_pct"];
  for (const k of need) if (typeof s?.[k] !== "number" || !Number.isFinite(s[k]) || s[k] < 0) throw new Error(`split.json: ${k} is unset or invalid, refusing to run`);
  const sum = s.reward_reserve_pct + s.referral_payer_pct + s.treasury_pct;
  if (Math.abs(sum - 100) > 1e-9) throw new Error(`split.json: percentages sum to ${sum}, must be 100`);
  if (s.slippage_pct > 10) throw new Error("split.json: slippage_pct > 10 refused");
  return { ...s, min_amount: s.min_amount ?? 0.01 };
}
const f7 = (n) => (Math.floor(n * 1e7) / 1e7).toFixed(7);

async function main() {
  const split = loadSplit(JSON.parse(fs.readFileSync(splitPath, "utf8")));
  const keys = JSON.parse(fs.readFileSync(keysPath, "utf8")).accounts;
  for (const k of ["fee_wallet", "reward_reserve", "referral_payer", "distribution"]) if (!keys[k]?.public) throw new Error(`keys: accounts.${k} missing`);
  const glacierq = (() => { const a = opt("asset"); if (a) { const [c, i] = a.split(":"); return new Asset(c, i); } return new Asset("GLACIERQ", keys.issuer.public); })();
  const horizon = new Horizon.Server(net === "mainnet" ? "https://horizon.stellar.org" : "https://horizon-testnet.stellar.org");
  const passphrase = net === "mainnet" ? Networks.PUBLIC : Networks.TESTNET;

  console.log(`network=${net} mode=${SEND ? "SEND" : "DRY-RUN"}${wantSend && !gate ? ` (--send ignored: set ${net === "mainnet" ? "QUASARIA_MAINNET_GO" : "QUASARIA_TESTNET_SEND"}=yes)` : ""}`);
  console.log(`split reserve ${split.reward_reserve_pct}% / referral ${split.referral_payer_pct}% / treasury ${split.treasury_pct}%, XLM buffer ${split.xlm_buffer}, slippage ${split.slippage_pct}%`);
  const fee = await horizon.loadAccount(keys.fee_wallet.public).catch(() => null);
  if (!fee) { console.log(`fee wallet ${keys.fee_wallet.public} not found on ${net} (unfunded): nothing to do`); return; }
  const treasury = await horizon.loadAccount(keys.distribution.public).catch(() => null);
  const ledger = await horizon.ledgers().order("desc").limit(1).call();
  const baseReserve = Number(ledger.records[0].base_reserve_in_stroops) / 1e7;

  // Each leg is its own transaction, re-quoted right before it is sent: two buys in one tx would each be quoted
  // against the same pool state, and the second one would fail its destMin after the first moved the price.
  const legs = []; // { label, make: async () => op | null }
  const toSdk = (b) => (b.asset_type === "native" ? Asset.native() : new Asset(b.asset_code, b.asset_issuer));
  const treasuryCan = (a) => a.isNative() || !!treasury?.balances.some((b) => b.asset_code === a.getCode() && b.asset_issuer === a.getIssuer());
  for (const b of fee.balances) {
    if (b.asset_type === "liquidity_pool_shares") continue;
    const asset = toSdk(b);
    let avail = Number(b.balance) - Number(b.selling_liabilities ?? 0);
    if (asset.isNative()) {
      const minBal = (2 + fee.subentry_count + (fee.num_sponsoring ?? 0) - (fee.num_sponsored ?? 0)) * baseReserve;
      avail -= minBal + split.xlm_buffer + 0.01; // + headroom for the per-leg network fees
    }
    if (!(avail >= split.min_amount)) continue;
    const code = asset.isNative() ? "XLM" : asset.getCode();
    for (const [who, pct] of [["reward_reserve", split.reward_reserve_pct], ["referral_payer", split.referral_payer_pct]]) {
      const amt = (avail * pct) / 100;
      if (amt < split.min_amount) continue;
      const dest = keys[who].public;
      if (asset.equals(glacierq)) { legs.push({ label: `${f7(amt)} GLACIERQ → ${who}`, make: async () => Operation.payment({ destination: dest, asset, amount: f7(amt) }) }); continue; }
      legs.push({ label: `${f7(amt)} ${code} → GLACIERQ → ${who}`, make: async () => {
        const best = (await horizon.strictSendPaths(asset, f7(amt), [glacierq]).call()).records[0];
        if (!best) { console.log(`    SKIP: no SDEX route ${code}→GLACIERQ`); return null; }
        const destMin = Number(best.destination_amount) * (1 - split.slippage_pct / 100);
        console.log(`    quote ${best.destination_amount} GLACIERQ, min ${f7(destMin)}`);
        const p = best.path.map((x) => (x.asset_type === "native" ? Asset.native() : new Asset(x.asset_code, x.asset_issuer)));
        return Operation.pathPaymentStrictSend({ sendAsset: asset, sendAmount: f7(amt), destination: dest, destAsset: glacierq, destMin: f7(destMin), path: p });
      } });
    }
    const tAmt = (avail * split.treasury_pct) / 100;
    if (tAmt >= split.min_amount) {
      if (treasuryCan(asset)) legs.push({ label: `${f7(tAmt)} ${code} → treasury`, make: async () => Operation.payment({ destination: keys.distribution.public, asset, amount: f7(tAmt) }) });
      else console.log(`  SKIP treasury ${code}: treasury has no trustline (left in fee wallet)`);
    }
  }
  if (!legs.length) { console.log("nothing to distribute"); return; }
  let kp = null;
  if (SEND) {
    if (!keys.fee_wallet.secret) throw new Error("keys: fee_wallet secret missing");
    kp = Keypair.fromSecret(keys.fee_wallet.secret);
    if (kp.publicKey() !== keys.fee_wallet.public) throw new Error("keys: fee_wallet secret does not match public");
  }
  let failed = 0;
  for (const l of legs) {
    console.log("  " + l.label);
    if (SEND && l !== legs[0]) await new Promise((r) => setTimeout(r, 8000)); // let Horizon's path-finding see the previous trade
    const op = await l.make();
    if (!op || !SEND) continue;
    try {
      const tx = new TransactionBuilder(await horizon.loadAccount(kp.publicKey()), { fee: "1000", networkPassphrase: passphrase }).setTimeout(120).addMemo(Memo.text("quasaria fees")).addOperation(op).build();
      tx.sign(kp);
      console.log(`    sent ${(await horizon.submitTransaction(tx)).hash}`);
    } catch (e) { failed++; console.log(`    FAILED ${JSON.stringify(e?.response?.data?.extras?.result_codes ?? e.message)} (left in fee wallet)`); }
  }
  console.log(SEND ? `done, ${failed} leg(s) failed` : `dry-run: ${legs.length} leg(s); nothing signed (quotes are per-leg and re-taken before each send)`);
  if (failed) process.exitCode = 2;
}
main().catch((e) => { console.error("ERROR:", e?.response?.data?.extras?.result_codes ?? e.message ?? e); process.exit(1); });
