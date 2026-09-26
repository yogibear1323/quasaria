// Capture screenshots of every main page with headless Chromium (Playwright).
// Usage: (cd frontend && npm run build && npx vite preview --port 4173 &) ; node scripts/screenshots.mjs
import { chromium } from "../frontend/node_modules/playwright/index.mjs";
import { mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = resolve(root, "screenshots");
mkdirSync(out, { recursive: true });
const BASE = process.env.BASE_URL || "http://127.0.0.1:4173";
const pages = ["trade", "pools", "stake", "rewards", "referrals", "bots"];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const errors = [];
page.on("pageerror", (e) => errors.push(`${page.url()}: ${e.message}`));
page.on("console", (m) => m.type() === "error" && errors.push(`${page.url()} console: ${m.text()}`));
for (const [i, p] of pages.entries()) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${BASE}/${p}`, { waitUntil: "networkidle" }).catch(() => page.goto(`${BASE}/${p}`));
  await page.waitForTimeout(2500); // let canvas scenes animate + data load
  // Grow the viewport to the full page so the fixed cosmic background covers it.
  const h = await page.evaluate(() => document.documentElement.scrollHeight);
  await page.setViewportSize({ width: 1440, height: Math.max(900, h) });
  await page.waitForTimeout(800);
  const file = resolve(out, `${String(i + 1).padStart(2, "0")}-${p}.png`);
  await page.screenshot({ path: file, fullPage: true });
  console.log("wrote", file);
}
await browser.close();
if (errors.length) {
  console.log("Page errors:\n" + errors.join("\n"));
}
