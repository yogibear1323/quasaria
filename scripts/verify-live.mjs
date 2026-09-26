// Verify the deployed site with headless Chromium (Playwright). TESTNET ONLY.
//  - /markets shows rows (live stellarchain.io or the build-time snapshot)
//    (BLOCK_STELLARCHAIN=1 aborts stellarchain.io requests to exercise the snapshot path)
//  - /rewards Mint/Redeem panel loads the on-chain XLM reserve and QFX supply
//  - ROUNDTRIP=1: a fresh friendbot-funded throwaway testnet key is imported in
//    the browser, mints QFX with XLM and redeems it back through the UI; tx hashes
//    are printed. The secret only lives in this process's memory and the browser
//    tab; it is never printed or written to disk.
// Usage: BASE_URL=https://yogibear1323.github.io/quasaria ROUNDTRIP=1 node scripts/verify-live.mjs
import { chromium } from "../frontend/node_modules/playwright/index.mjs";
import { Keypair, rpc, Contract, TransactionBuilder, Account, BASE_FEE, Networks, scValToNative } from "../frontend/node_modules/@stellar/stellar-sdk/lib/esm/index.js";
import { mkdirSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = resolve(root, "screenshots");
mkdirSync(out, { recursive: true });
const BASE = (process.env.BASE_URL || "https://yogibear1323.github.io/quasaria").replace(/\/$/, "");
const AMOUNT = process.env.AMOUNT || "25";
const dep = JSON.parse(readFileSync(resolve(root, "deployments/testnet.json"), "utf8"));
if (dep.networkPassphrase !== Networks.TESTNET) throw new Error("testnet only");
const server = new rpc.Server(dep.rpcUrl);

async function view(method) {
  const tx = new TransactionBuilder(new Account(Keypair.random().publicKey(), "0"), { fee: BASE_FEE, networkPassphrase: Networks.TESTNET })
    .addOperation(new Contract(dep.contracts.qfx).call(method)).setTimeout(30).build();
  const sim = await server.simulateTransaction(tx);
  if (!rpc.Api.isSimulationSuccess(sim)) throw new Error(`sim ${method} failed`);
  return scValToNative(sim.result.retval);
}

const result = { base: BASE, errors: [] };
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on("pageerror", (e) => result.errors.push(`${page.url()}: ${e.message}`));
const blocked = [];
// BLOCK_STELLARCHAIN=1 simulates the github.io CORS block locally.
if (process.env.BLOCK_STELLARCHAIN === "1") await page.route("**/api.stellarchain.io/**", (r) => r.abort("blockedbyclient"));
page.on("requestfailed", (r) => r.url().includes("stellarchain.io") && blocked.push(`${r.url()} (${r.failure()?.errorText})`));

const fullShot = async (name) => {
  const h = await page.evaluate(() => document.documentElement.scrollHeight);
  await page.setViewportSize({ width: 1440, height: Math.min(Math.max(900, h), 6000) });
  await page.waitForTimeout(600);
  await page.screenshot({ path: resolve(out, name), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  console.log("wrote", resolve(out, name));
};

// ---- Markets
await page.goto(`${BASE}/markets`, { waitUntil: "domcontentloaded" });
await page.waitForSelector('[data-testid="market-row"]', { timeout: 60_000 });
await page.waitForTimeout(4000);
result.markets = {
  rows: await page.locator('[data-testid="market-row"]').count(),
  feed: (await page.locator('[data-testid="feed-badge"]').first().textContent().catch(() => null)) ?? null,
  snapshotNotice: await page.locator('[data-testid="snapshot-notice"]').count(),
  stellarchainRequestsFailed: blocked.length,
};
await fullShot("live-markets.png");

// ---- Mint / Redeem
await page.goto(`${BASE}/rewards`, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => /\d/.test(document.querySelector('[data-testid="qfx-reserve"]')?.textContent ?? ""), null, { timeout: 60_000 });
const readPanel = async () => ({
  reserve: (await page.locator('[data-testid="qfx-reserve"]').textContent())?.trim(),
  supply: (await page.locator('[data-testid="qfx-supply"]').textContent())?.trim(),
  backing: (await page.locator('[data-testid="qfx-backing"]').textContent())?.trim(),
  label: (await page.locator('[data-testid="peg-label"]').textContent())?.trim(),
});
result.panel = await readPanel();

if (process.env.ROUNDTRIP === "1") {
  const kp = Keypair.random();
  const fb = await fetch(`https://friendbot.stellar.org?addr=${kp.publicKey()}`);
  if (!fb.ok) throw new Error(`friendbot ${fb.status}`);
  result.roundTrip = { account: kp.publicKey(), amount: AMOUNT, before: await view("reserves") };
  await page.getByRole("button", { name: /Create account|Unlock account/ }).first().click();
  await page.getByRole("button", { name: /Import a secret key/ }).click();
  await page.locator('input[placeholder="S…"]').fill(kp.secret());
  await page.getByRole("button", { name: /^Import$/ }).click();
  await page.getByRole("button", { name: /Start trading/ }).click();
  await page.waitForSelector('[data-testid="mint-balances"]', { timeout: 60_000 });

  const doTx = async (label) => {
    await page.locator('[data-testid="mint-amount"]').fill(AMOUNT);
    await page.locator('[data-testid="mint-submit"]').click();
    const re = new RegExp(`${label}: (confirmed \\(tx ([0-9a-f]{64})\\)|failed.*)`);
    await page.waitForFunction((src) => new RegExp(src).test(document.querySelector('[data-testid="mint-redeem"]')?.textContent ?? ""), re.source, { timeout: 120_000 });
    const text = await page.locator('[data-testid="mint-redeem"] .notice').last().textContent();
    const m = re.exec(text ?? "");
    if (!m?.[2]) throw new Error(`${label} did not confirm: ${text}`);
    return m[2];
  };
  result.roundTrip.mintTx = await doTx("Mint QFX");
  await page.waitForFunction((a) => (document.querySelector('[data-testid="mint-balances"]')?.textContent ?? "").includes(`${Number(a).toFixed(4)} QFX`), AMOUNT, { timeout: 60_000 });
  result.roundTrip.afterMintBalances = (await page.locator('[data-testid="mint-balances"]').textContent())?.trim();
  result.roundTrip.afterMint = await view("reserves");
  await page.getByRole("button", { name: /Redeem · QFX → XLM/ }).click();
  result.roundTrip.redeemTx = await doTx("Redeem QFX");
  await page.waitForFunction(() => (document.querySelector('[data-testid="mint-balances"]')?.textContent ?? "").includes("0.0000 QFX"), null, { timeout: 60_000 });
  result.roundTrip.afterRedeemBalances = (await page.locator('[data-testid="mint-balances"]').textContent())?.trim();
  result.roundTrip.after = await view("reserves");
  for (const k of ["mintTx", "redeemTx"]) {
    const r = await server.getTransaction(result.roundTrip[k]);
    result.roundTrip[`${k}Status`] = r.status;
  }
  await page.waitForTimeout(3000);
  result.panelAfter = await readPanel();
}
await fullShot("live-mint-redeem.png");
await browser.close();
console.log(JSON.stringify(result, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2));
