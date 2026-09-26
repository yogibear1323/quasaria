// Render brand SVGs to PNG (favicons, apple-touch icon, OG image, README
// banner) with headless Chromium via Playwright. Fonts come from
// @fontsource packages installed in frontend/.
//   node scripts/render-brand.mjs
import { chromium } from "../frontend/node_modules/playwright/index.mjs";
import { readFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pub = resolve(root, "frontend/public");
const brand = resolve(pub, "brand");
const docs = resolve(root, "docs/brand");
mkdirSync(docs, { recursive: true });

const logo = readFileSync(resolve(brand, "logo.svg"), "utf8");
const fav = readFileSync(resolve(brand, "favicon.svg"), "utf8");
const fontCss = (pkg, file) =>
  pathToFileURL(resolve(root, "frontend/node_modules/@fontsource", pkg, file)).href;

const browser = await chromium.launch();
const page = await browser.newPage();

async function renderSvg(svg, size, out) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<html><body style="margin:0;background:transparent">${svg.replace(
      "<svg ",
      `<svg width="${size}" height="${size}" `
    )}</body></html>`
  );
  await page.screenshot({ path: out, omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
  console.log("wrote", out);
}

await renderSvg(fav, 32, resolve(pub, "favicon-32.png"));
await renderSvg(logo, 180, resolve(pub, "apple-touch-icon.png"));
await renderSvg(logo, 512, resolve(pub, "icon-512.png"));
await renderSvg(logo, 512, resolve(docs, "logo-512.png"));
await renderSvg(fav, 128, resolve(docs, "favicon-preview-128.png"));

// Banner / OG image (1200x630)
async function banner(out, w, h) {
  await page.setViewportSize({ width: w, height: h });
  const stars = Array.from({ length: 220 }, () => {
    const x = Math.random() * w, y = Math.random() * h, r = Math.random() * 1.4 + 0.2;
    return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r.toFixed(2)}" fill="#fff" opacity="${(Math.random() * 0.8 + 0.2).toFixed(2)}"/>`;
  }).join("");
  await page.setContent(`<!doctype html><html><head><style>
    @import url("${fontCss("orbitron", "900.css")}");
    @import url("${fontCss("space-grotesk", "500.css")}");
    body{margin:0;width:${w}px;height:${h}px;overflow:hidden;background:#05030f;font-family:'Space Grotesk',sans-serif}
    .bg{position:absolute;inset:0;background:
      radial-gradient(ellipse 45% 60% at 18% 30%, rgba(155,92,255,.55), transparent 70%),
      radial-gradient(ellipse 40% 55% at 85% 80%, rgba(255,61,203,.45), transparent 70%),
      radial-gradient(ellipse 30% 40% at 70% 10%, rgba(56,243,255,.30), transparent 70%),
      linear-gradient(160deg,#0b0726,#05030f)}
    svg.stars{position:absolute;inset:0}
    .wrap{position:absolute;inset:0;display:flex;align-items:center;gap:${h * 0.07}px;padding-left:${w * 0.07}px}
    .logo{width:${h * 0.68}px;height:${h * 0.68}px;filter:drop-shadow(0 0 40px rgba(56,243,255,.45))}
    h1{margin:0;font-family:Orbitron,sans-serif;font-weight:900;font-size:${h * 0.17}px;letter-spacing:.06em;
      background:linear-gradient(90deg,#38f3ff,#c9b6ff 45%,#ff3dcb);-webkit-background-clip:text;color:transparent;
      filter:drop-shadow(0 0 18px rgba(155,92,255,.6))}
    p{margin:${h * 0.02}px 0 0;color:#eef1ff;font-size:${h * 0.05}px;opacity:.9}
    .tag{margin-top:${h * 0.04}px;display:inline-block;padding:6px 16px;border-radius:999px;border:1px solid rgba(56,243,255,.6);
      color:#38f3ff;font-size:${h * 0.032}px;letter-spacing:.2em;text-transform:uppercase}
  </style></head><body><div class="bg"></div><svg class="stars" width="${w}" height="${h}">${stars}</svg>
  <div class="wrap"><div class="logo">${logo.replace("<svg ", '<svg width="100%" height="100%" ')}</div>
  <div><h1>QUASARIA</h1><p>Trade at the speed of light on Stellar.</p><span class="tag">Testnet · Soroban · SDEX</span></div></div></body></html>`);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
  await page.screenshot({ path: out });
  console.log("wrote", out);
}
await banner(resolve(pub, "og-image.png"), 1200, 630);
await banner(resolve(docs, "banner.png"), 1280, 400);
await browser.close();
