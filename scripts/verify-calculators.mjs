// Verify the Earn calculators with headless Chromium (Playwright). TESTNET ONLY, read-only.
//  - /calculators?c=staking|holder|lp: each calculator shows "live · Soroban testnet"
//    and produces numbers; screenshots calc-staking.png, calc-holder.png, calc-lp.png
//  - /calculators (all three) → calc-overview.png; /earn hub; panel links on /stake, /rewards, /pools
//  - mobile (390 px): no horizontal overflow on the calculator pages
// Usage: BASE_URL=https://yogibear1323.github.io/quasaria node scripts/verify-calculators.mjs
import { chromium } from "../frontend/node_modules/playwright/index.mjs";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = resolve(root, "screenshots");
mkdirSync(out, { recursive: true });
const BASE = (process.env.BASE_URL || "https://yogibear1323.github.io/quasaria").replace(/\/$/, "");
const result = { base: BASE, at: new Date().toISOString(), errors: [], calculators: {}, mobile: {}, links: {} };

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
page.on("pageerror", (e) => result.errors.push(`${page.url()}: ${e.message}`));

const text = async (sel) => ((await page.locator(sel).first().innerText().catch(() => "")) || "").replace(/\s+/g, " ").trim();
const hasNumber = (s) => /\d/.test(s) && !/—|NaN|Infinity/.test(s);

async function waitLive(card, extra = []) {
  await page.waitForSelector(`${card} .pill.green:has-text("live")`, { timeout: 90_000 });
  for (const sel of extra) await page.waitForFunction((s) => /\d/.test(document.querySelector(s)?.textContent ?? ""), sel, { timeout: 60_000 });
  await page.waitForTimeout(1500);
}

async function shot(name, h = 900) {
  const full = await page.evaluate(() => document.documentElement.scrollHeight);
  await page.setViewportSize({ width: 1440, height: Math.min(Math.max(h, full), 7000) });
  await page.waitForTimeout(700);
  await page.screenshot({ path: resolve(out, name), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  console.log("wrote", resolve(out, name));
}

// ---- Staking
await page.goto(`${BASE}/calculators?c=staking`, { waitUntil: "domcontentloaded" });
await waitLive('[data-testid="calc-staking"]', ['[data-testid="stake-rewards"]']);
const staking = {
  source: await text('[data-testid="calc-staking"] .pill.green'),
  pools: await page.locator('[data-testid^="stake-pool-"]').allInnerTexts(),
  rewards: await text('[data-testid="stake-rewards"]'),
  total: await text('[data-testid="stake-total"]'),
  apr: await text('[data-testid="stake-apr"]'),
  facts: await text('[data-testid="calc-staking"] .calc-facts'),
  chart: await page.locator('[data-testid="stake-chart"] svg path').count(),
  disclaimer: await page.locator('[data-testid="calc-staking"] [data-testid="calc-disclaimer"]').count(),
};
// Long horizon → reserve depletion warning must appear.
await page.fill('[data-testid="stake-amount"]', "1000");
await page.locator('[data-testid="calc-staking"] .chip-input').fill("1095");
await page.waitForTimeout(400);
staking.longHorizon = { rewards: await text('[data-testid="stake-rewards"]'), depletionWarning: await page.locator('[data-testid="stake-depletion-warning"]').count(), payoutWarning: await page.locator('[data-testid="stake-reserve-warning"]').count() };
await page.fill('[data-testid="stake-amount"]', "100");
await page.locator('[data-testid="calc-staking"] .chip-input').fill("30");
await page.waitForTimeout(400);
staking.ok = staking.source.includes("live") && hasNumber(staking.rewards) && staking.chart > 0 && staking.disclaimer === 1;
result.calculators.staking = staking;
await shot("calc-staking.png");

// ---- Holder yield
await page.goto(`${BASE}/calculators?c=holder`, { waitUntil: "domcontentloaded" });
await waitLive('[data-testid="calc-holder"]', ['[data-testid="holder-yield"]']);
const holder = {
  source: await text('[data-testid="calc-holder"] .pill.green'),
  yieldSimple: await text('[data-testid="holder-yield"]'),
  total: await text('[data-testid="holder-total"]'),
  reserve: await text('[data-testid="holder-reserve"]'),
  runway: await text('[data-testid="holder-runway"]'),
  caveat: await text('[data-testid="holder-reserve-caveat"]'),
  disclaimer: await page.locator('[data-testid="calc-holder"] [data-testid="calc-disclaimer"]').count(),
};
await page.click('[data-testid="calc-holder"] .tabs button:has-text("Settle daily")');
await page.waitForTimeout(300);
holder.yieldDaily = await text('[data-testid="holder-yield"]');
await page.click('[data-testid="calc-holder"] .tabs button:has-text("Simple")');
await page.waitForTimeout(300);
holder.ok = holder.source.includes("live") && hasNumber(holder.yieldSimple) && hasNumber(holder.reserve) && holder.yieldDaily !== holder.yieldSimple && holder.disclaimer === 1;
result.calculators.holder = holder;
await shot("calc-holder.png");

// ---- Liquidity
await page.goto(`${BASE}/calculators?c=lp`, { waitUntil: "domcontentloaded" });
await waitLive('[data-testid="calc-lp"]', ['[data-testid="lp-fees"]']);
await page.waitForFunction(() => !/summing/.test(document.querySelector('[data-testid="lp-volume-source"]')?.textContent ?? "summing"), null, { timeout: 60_000 }).catch(() => {});
const lp = {
  source: await text('[data-testid="calc-lp"] .pill.green'),
  poolOptions: await page.locator('[data-testid="lp-pool"] option').count(),
  selected: await page.locator('[data-testid="lp-pool"] option:checked').innerText(),
  volumeSource: await text('[data-testid="lp-volume-source"]'),
  fees: await text('[data-testid="lp-fees"]'),
  share: await text('[data-testid="lp-share"]'),
  apr: await text('[data-testid="lp-apr"]'),
  disclaimer: await page.locator('[data-testid="calc-lp"] [data-testid="calc-disclaimer"]').count(),
};
await page.locator('[data-testid="lp-price-change"]').fill("200");
await page.waitForTimeout(300);
lp.il200 = await text('[data-testid="lp-il-pct"]');
await page.locator('[data-testid="lp-price-change"]').fill("-50");
await page.waitForTimeout(300);
lp.ilMinus50 = await text('[data-testid="lp-il-pct"]');
lp.netMinus50 = await text('[data-testid="lp-net"]');
lp.ok = lp.source.includes("live") && lp.poolOptions >= 2 && hasNumber(lp.fees) && /13\.40%/.test(lp.il200) && /5\.72%/.test(lp.ilMinus50) && lp.disclaimer === 1;
await page.locator('[data-testid="lp-price-change"]').fill("50");
await page.waitForTimeout(300);
result.calculators.lp = lp;
await shot("calc-lp.png");

// ---- Combined page
await page.goto(`${BASE}/calculators`, { waitUntil: "domcontentloaded" });
for (const c of ["calc-staking", "calc-holder", "calc-lp"]) await waitLive(`[data-testid="${c}"]`);
result.calculators.overview = { cards: await page.locator('[data-testid^="calc-"][data-testid$="staking"], [data-testid="calc-holder"], [data-testid="calc-lp"]').count() };
await shot("calc-overview.png");

// ---- Earn hub + nav + panel links
await page.goto(`${BASE}/earn`, { waitUntil: "domcontentloaded" });
await page.waitForSelector('[data-testid="earn-calculators"] a[href$="/calculators"]', { timeout: 30_000 });
result.links.navEarn = await page.locator('nav.nav a[href$="/earn"]').count();
result.links.earnToCalculators = await page.locator('[data-testid="earn-calculators"] a[href$="/calculators"]').count();
result.links.earnCards = await page.locator('.earn-card a[href*="/calculators?c="]').count();
await page.goto(`${BASE}/stake`, { waitUntil: "domcontentloaded" });
await page.waitForSelector('a[href*="/calculators?c=staking"]', { timeout: 30_000 });
result.links.stake = await page.locator('a[href*="/calculators?c=staking"]').count();
await page.goto(`${BASE}/rewards`, { waitUntil: "domcontentloaded" });
await page.waitForSelector('[data-testid="calc-holder"]', { timeout: 30_000 });
result.links.rewards = { embeddedCalculator: await page.locator('[data-testid="calc-holder"]').count(), link: await page.locator('a[href*="/calculators?c=holder"]').count() };
await page.goto(`${BASE}/pools`, { waitUntil: "domcontentloaded" });
await page.waitForSelector('[data-testid="pools-calc-link"]', { timeout: 30_000 });
result.links.pools = await page.locator('a[href*="/calculators?c=lp"]').count();

// ---- Mobile
const m = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
m.on("pageerror", (e) => result.errors.push(`mobile ${m.url()}: ${e.message}`));
for (const c of ["staking", "holder", "lp"]) {
  await m.goto(`${BASE}/calculators?c=${c}`, { waitUntil: "domcontentloaded" });
  await m.waitForSelector(`[data-testid="calc-${c}"] .pill.green:has-text("live")`, { timeout: 90_000 });
  await m.waitForTimeout(1500);
  result.mobile[c] = await m.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth }));
  result.mobile[c].noOverflow = result.mobile[c].scrollWidth <= result.mobile[c].innerWidth + 1;
  if (c === "lp") { await m.screenshot({ path: resolve(out, "calc-mobile-lp.png"), fullPage: true }); console.log("wrote", resolve(out, "calc-mobile-lp.png")); }
}

await browser.close();
result.ok = ["staking", "holder", "lp"].every((k) => result.calculators[k].ok) && Object.values(result.mobile).every((x) => x.noOverflow) && result.errors.length === 0;
writeFileSync(resolve(out, "calc-verify.json"), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 1);
