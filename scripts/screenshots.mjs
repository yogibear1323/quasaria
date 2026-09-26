// Capture screenshots of every page + the in-app account flow with headless
// Chromium (Playwright). Secrets in the account flow are blurred via CSS
// before capture and never printed. Testnet only.
// Usage: (cd frontend && npm run build && npx vite preview --port 4173 &) ; node scripts/screenshots.mjs
//   E2E_SIGN=1 additionally signs one real testnet tx (set_referrer) with the new in-app key.
import { chromium } from "../frontend/node_modules/playwright/index.mjs";
import { mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = resolve(root, "screenshots");
mkdirSync(out, { recursive: true });
const BASE = process.env.BASE_URL || "http://127.0.0.1:4173";
const ONLY = process.env.ONLY; // e.g. ONLY=landing to capture just the landing shots
const pages = ONLY === "landing" ? [] : ["trade", "pools", "stake", "rewards", "referrals", "bots", "markets"];
const BLUR = ".secret-value { filter: blur(9px) !important; color: transparent !important; text-shadow: 0 0 12px rgba(255,255,255,.8) !important; }";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const errors = [];
page.on("pageerror", (e) => errors.push(`${page.url()}: ${e.message}`));
page.on("console", (m) => m.type() === "error" && errors.push(`${page.url()} console: ${m.text()}`));
const shot = async (name, fullPage = true) => {
  const file = resolve(out, name);
  await page.screenshot({ path: file, fullPage });
  console.log("wrote", file);
};

for (const [i, p] of pages.entries()) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${BASE}/${p}`, { waitUntil: "networkidle" }).catch(() => page.goto(`${BASE}/${p}`));
  await page.waitForTimeout(p === "markets" ? 6000 : 4000); // canvas scenes + chain / market data
  const h = await page.evaluate(() => document.documentElement.scrollHeight);
  await page.setViewportSize({ width: 1440, height: Math.max(900, h) });
  await page.waitForTimeout(800);
  await shot(`${String(i + 1).padStart(2, "0")}-${p}.png`);
}

// ---- public landing page: desktop full page + mobile full page
{
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" }).catch(() => page.goto(`${BASE}/`));
  await page.waitForTimeout(7000); // stellarchain + Horizon + Soroban reads
  const h = await page.evaluate(() => document.documentElement.scrollHeight);
  await page.setViewportSize({ width: 1440, height: h });
  await page.waitForTimeout(1200);
  await shot("00-landing-desktop.png");
  // "Create a wallet" must jump straight into the create flow (secret blurred)
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.addStyleTag({ content: BLUR });
  await page.getByRole("button", { name: "Create a wallet" }).first().click();
  await page.locator("input.secret-value").first().waitFor({ timeout: 5000 });
  await shot("12-landing-create-wallet-blurred.png", false);
  await page.keyboard.press("Escape");
  const m = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const mp = await m.newPage();
  mp.on("pageerror", (e) => errors.push(`mobile ${mp.url()}: ${e.message}`));
  await mp.goto(`${BASE}/`, { waitUntil: "networkidle" }).catch(() => mp.goto(`${BASE}/`));
  await mp.waitForTimeout(6000);
  // scroll through once so lazy-loaded logos are fetched before the full-page capture
  const mh = await mp.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 0; y < mh; y += 700) { await mp.evaluate((yy) => window.scrollTo(0, yy), y); await mp.waitForTimeout(120); }
  await mp.evaluate(() => window.scrollTo(0, 0));
  await mp.waitForTimeout(2500);
  const overflow = await mp.evaluate(() => document.documentElement.scrollWidth - 390); // >0 = page wider than the phone
  console.log("mobile horizontal overflow px:", overflow);
  await mp.screenshot({ path: resolve(out, "00-landing-mobile.png"), fullPage: true });
  console.log("wrote", resolve(out, "00-landing-mobile.png"));
  await mp.screenshot({ path: resolve(out, "00-landing-mobile-hero.png"), fullPage: false });
  await m.close();
}

if (ONLY === "landing") {
  await browser.close();
  if (errors.length) console.log("Page errors:\n" + errors.join("\n"));
  process.exit(0);
}

// ---- in-app (non-custodial) account creation with a throwaway testnet key
await page.setViewportSize({ width: 1440, height: 900 });
await page.goto(`${BASE}/trade`);
await page.addStyleTag({ content: BLUR });
await page.waitForTimeout(1500);
await page.getByRole("button", { name: "Create account", exact: true }).click();
await shot("08-account-options.png", false);
await page.getByRole("button", { name: /Create a new account/ }).click();
await page.waitForTimeout(400);
await shot("09-create-account-secret-blurred.png", false);
const secret = await page.locator("input.secret-value").first().inputValue(); // kept in memory only
await page.getByLabel(/I have saved my secret key/).check();
await page.getByRole("button", { name: "Continue" }).click();
const label = await page.getByText(/Backup check: type/).innerText();
const [, from, to] = label.match(/characters (\d+)–(\d+)/);
await page.locator("input.secret-value").fill(secret.slice(Number(from) - 1, Number(to)));
await page.waitForTimeout(300);
await shot("10-backup-check-blurred.png", false);
await page.getByRole("button", { name: /Finish & fund/ }).click();
await page.getByText(/Funded with 10,000 test XLM|Already funded|Friendbot failed/).waitFor({ timeout: 30000 });
const fundMsg = await page.getByText(/Funded with 10,000 test XLM|Already funded|Friendbot failed/).innerText();
const address = (await page.locator(".modal .mono").first().innerText()).trim();
await shot("11-account-ready.png", false);
console.log("in-app account:", address, "·", fundMsg);

if (process.env.E2E_SIGN === "1") {
  // Sign a real Soroban tx locally with the in-app key (no reload: the key lives in memory).
  await page.getByRole("button", { name: "Start trading" }).click();
  await page.getByRole("link", { name: "Referrals" }).click();
  await page.waitForTimeout(3000);
  await page.getByPlaceholder("G...").fill(process.env.E2E_REFERRER);
  await page.getByRole("button", { name: /Set referrer/ }).click();
  await page.getByText(/set referrer: confirmed|set referrer failed/).waitFor({ timeout: 90000 });
  console.log("e2e:", await page.getByText(/set referrer: confirmed|set referrer failed/).innerText());
}
await browser.close();
if (errors.length) console.log("Page errors:\n" + errors.join("\n"));
