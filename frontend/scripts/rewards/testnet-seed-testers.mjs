#!/usr/bin/env node
/** TESTNET ONLY. Creates throwaway tester accounts (holders, a referrer, a referee that binds to it) funded from the test treasury. Keys: keys.json "testers" (0600). */
import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Asset, BASE_FEE, Horizon, Keypair, Networks, Operation, TransactionBuilder } from "@stellar/stellar-sdk";
const KEYS = join(process.env.HOME ?? "/home/box", ".quasaria-testnet-glacierq", "keys.json");
const K = JSON.parse(readFileSync(KEYS, "utf8"));
const server = new Horizon.Server("https://horizon-testnet.stellar.org");
const GQ = new Asset("GLACIERQ", K.accounts.issuer.public);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
K.testers ??= {};
const WANT = { referrer: 2_000_000, referee: 3_000_000, whale: 12_000_000, small: 500_000 };
async function send(kp, ops) {
  const acct = await server.loadAccount(kp.publicKey());
  const b = new TransactionBuilder(acct, { fee: String(Number(BASE_FEE) * ops.length * 10), networkPassphrase: Networks.TESTNET }).setTimeout(120);
  ops.forEach((o) => b.addOperation(o)); const t = b.build(); t.sign(kp); return server.submitTransaction(t);
}
for (const [name, amt] of Object.entries(WANT)) {
  if (!K.testers[name]) { const kp = Keypair.random(); K.testers[name] = { public: kp.publicKey(), secret: kp.secret() }; writeFileSync(KEYS, JSON.stringify(K, null, 2), { mode: 0o600 }); chmodSync(KEYS, 0o600); }
  const kp = Keypair.fromSecret(K.testers[name].secret);
  for (let i = 0; i < 6; i++) { try { await server.loadAccount(kp.publicKey()); break; } catch { await fetch(`https://friendbot.stellar.org/?addr=${kp.publicKey()}`).catch(() => null); await sleep(2500); } }
  const acc = await server.loadAccount(kp.publicKey());
  const has = acc.balances.find((b) => b.asset_code === "GLACIERQ" && b.asset_issuer === GQ.issuer);
  if (!has) {
    const ops = [Operation.changeTrust({ asset: GQ })];
    // the referee binds to the referrer in the same step it opens its GLACIERQ trustline (first binding wins)
    if (name === "referee") ops.push(Operation.manageData({ name: "quasaria:ref", value: K.testers.referrer.public }));
    await send(kp, ops);
  }
  if (Number(has?.balance ?? 0) < amt) await send(Keypair.fromSecret(K.accounts.distribution.secret), [Operation.payment({ destination: kp.publicKey(), asset: GQ, amount: String(amt) })]);
  console.log(`${name.padEnd(9)} ${kp.publicKey()}  ${amt.toLocaleString()} GLACIERQ`);
}
