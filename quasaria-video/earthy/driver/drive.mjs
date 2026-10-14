// Testnet driver for the home (45 s) and payoff-loop (20 s) films. Throwaway friendbot keys held in memory only.
// Usage: MODE=home|loop LOG=/path/loop.jsonl node drive.mjs   (cap.mjs films the read-only #/demo?id=N view in parallel)
import { chromium } from "/workspace/qworld/frontend/node_modules/playwright/index.mjs";
import fs from "node:fs";
import { createRequire } from "node:module";
const { Keypair } = createRequire("/workspace/quasaria-autopay/app/package.json")("@stellar/stellar-sdk");
const MODE = process.env.MODE, LOG = process.env.LOG;
const BASE = "https://yogibear1323.github.io/autopay/app/?v=earthlogo-20261013";
const Q = MODE === "home" ? "kind=home&price=400000&down=40000&rate=6.5&months=360" : "kind=car&price=30000&down=6000&rate=7&months=60";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (o) => { fs.appendFileSync(LOG, JSON.stringify({ t: Date.now() / 1000, ...o }) + "\n"); console.log(JSON.stringify(o)); };
fs.writeFileSync(LOG, "");
const buyer = Keypair.random(), lender = Keypair.random();
for (const k of [buyer, lender]) { const r = await fetch(`https://friendbot.stellar.org/?addr=${k.publicKey()}`); if (!r.ok) throw new Error("friendbot"); }
const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } }); const page = await ctx.newPage();
const go = async (h) => { await page.goto(BASE + h, { waitUntil: "networkidle" }); await sleep(1200); };
const setWallet = (kp) => page.evaluate((a) => localStorage.setItem("autopay.wallet", JSON.stringify({ id: "albedo", address: a })), kp.publicKey());
async function outcome() {
  await page.waitForFunction(() => { const n = [...document.querySelectorAll(".txnote.ok, .txnote.err, .txnote.busy")]; return n.length && !n.some((e) => e.classList.contains("busy")); }, null, { timeout: 120000 });
  return (await page.locator(".txnote.ok, .txnote.err").last().innerText()).trim();
}
async function sign(kp) {
  await page.locator(".wp-card").waitFor({ timeout: 90000 });
  const [pop] = await Promise.all([page.waitForEvent("popup", { timeout: 15000 }), page.locator(".wp-card .btn").click()]);
  await pop.waitForLoadState("domcontentloaded");
  await pop.getByText("Sign transaction").first().waitFor({ timeout: 25000 });
  await pop.getByText("directly", { exact: true }).click();
  await pop.locator('input[type="text"], input[type="password"]').first().fill(kp.secret());
  await sleep(800);
  if (!pop.isClosed()) await pop.getByText(/^Confirm/).last().click({ timeout: 5000 }).catch(() => {});
  if (!pop.isClosed()) await pop.waitForEvent("close", { timeout: 30000 }).catch(() => {});
}
const txOf = async () => (await page.locator(".txnote.ok a").last().getAttribute("href").catch(() => "")) || "";
await go("#/overview"); await setWallet(buyer); await go("#/connect"); await page.reload({ waitUntil: "networkidle" }); await sleep(3000);
await page.waitForFunction(() => [...document.querySelectorAll("button")].some((b) => b.innerText === "Get test tUSDC" && !b.disabled), null, { timeout: 60000 });
await page.getByRole("button", { name: "Get test tUSDC" }).click(); await sign(buyer); console.log("faucet:", await outcome());
log({ step: "ready", buyer: buyer.publicKey(), lender: lender.publicKey() });
await go(`#/create?${Q}&lender=${lender.publicKey()}`); await sleep(6000);
await page.getByRole("button", { name: "Review deposit" }).click(); await sleep(1500);
await page.waitForFunction(() => { const b = [...document.querySelectorAll("button")].find((x) => /Create & deposit/.test(x.innerText)); return b && !b.disabled; }, null, { timeout: 30000 });
await page.getByRole("button", { name: /Create & deposit/ }).click();
await sign(buyer);
await page.waitForFunction(() => /dashboard\?id=\d+/.test(location.hash) || [...document.querySelectorAll(".wp-card")].length, null, { timeout: 90000 }).catch(() => {});
let id = null;
await sign(buyer);
await page.waitForURL(/#\/dashboard\?id=\d+/, { timeout: 90000 });
id = Number(new URL(page.url()).hash.match(/id=(\d+)/)[1]);
log({ step: "created", id }); log({ step: "deposited", id });
async function sweep(n) {
  await go(`#/dashboard?id=${id}&panel=sweep`);
  const before = await page.evaluate(() => document.body.innerText.match(/(\d+) sweep period/)?.[1] || "0");
  for (let k = 0; k < 2; k++) {
    await page.waitForFunction((b) => [...document.querySelectorAll("button")].some((x) => x.innerText === "Trigger sweep now" && !x.disabled) || ((document.body.innerText.match(/(\d+) sweep period/)?.[1] || "0") !== b), before, { timeout: 480000, polling: 500 });
    const now = await page.evaluate(() => document.body.innerText.match(/(\d+) sweep period/)?.[1] || "0");
    if (now !== before) break;
    await page.getByRole("button", { name: "Trigger sweep now" }).click();
    await page.locator(".wp-card").waitFor({ timeout: 20000 }).catch(() => {});
    if (await page.locator(".wp-card .btn").count()) await sign(buyer);
    const o = await outcome().catch(() => ""); console.log("sweep:", o);
    if (!/already/i.test(o)) break;
  }
  const v = await page.evaluate(() => document.body.innerText.match(/Swept ([\d.,]+) tUSDC/)?.[1] || null);
  log({ step: `swept${n}`, id, value: v });
}
async function pay(n) {
  await go(`#/payments?id=${id}`);
  await page.waitForFunction(() => [...document.querySelectorAll("button")].some((b) => b.innerText === "Make a payment" && !b.disabled), null, { timeout: 60000 });
  await page.getByRole("button", { name: "Make a payment" }).click(); await sign(buyer); console.log("pay:", await outcome());
  log({ step: `paid${n}`, id });
}
await sweep(1); await pay(1);
if (MODE === "home") { await sleep(50000); log({ step: "end", id }); await b.close(); process.exit(0); }
await sweep(2); await pay(2);
await go(`#/payoff?id=${id}`);
await page.getByRole("button", { name: /^Pay off .* now$/ }).waitFor({ timeout: 30000 }); await sleep(3000);
await page.getByRole("button", { name: /^Pay off .* now$/ }).click(); await sign(buyer);
const po = await outcome(); console.log("payoff:", po);
log({ step: "paidoff", id, value: po.match(/([\d,]+\.\d+) tUSDC/)?.[1] || null, note: po });
await sleep(25000);
await setWallet(lender); await go(`#/dealer/agreement?id=${id}`); await page.reload({ waitUntil: "networkidle" }); await page.reload({ waitUntil: "networkidle" }); await sleep(1500);
await page.waitForFunction(() => [...document.querySelectorAll("button")].some((b) => b.innerText === "Attest lien released" && !b.disabled), null, { timeout: 60000 });
await page.getByRole("button", { name: "Attest lien released" }).click(); await sign(lender);
const co = await outcome(); console.log("close:", co);
log({ step: "closed", id, refunded: co.match(/([\d,]+\.\d+) tUSDC/)?.[1] || null, note: co });
await sleep(30000); log({ step: "end", id }); await b.close();
