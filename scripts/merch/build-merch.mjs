// Build the Quasaria merch line: print SVG/PNG files (outside the repo), web
// WebP versions (frontend/public/merch-assets), product mockups and contact sheets.
//
//   cd frontend && OPENTYPE_PATH=/path/to/opentype.js node ../scripts/merch/build-merch.mjs
//   python3 ../scripts/merch/post-merch.py      # 300/600 DPI tags + WebP (needs Pillow)
//
// Env: MERCH_PRINT_DIR (default /workspace/quasaria-merch/print),
//      MERCH_SHOTS_DIR (default /workspace/redesign-shots/merch).
import { chromium } from "../../frontend/node_modules/playwright/index.mjs";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { root } from "./lib.mjs";
import { DESIGNS, STICKERS, stickerSvg } from "./designs.mjs";
import * as M from "./mockups.mjs";

const PRINT = process.env.MERCH_PRINT_DIR || "/workspace/quasaria-merch/print";
const SHOTS = process.env.MERCH_SHOTS_DIR || "/workspace/redesign-shots/merch";
const only = process.argv.slice(2);
const want = (stage) => !only.length || only.includes(stage);
for (const d of ["svg", "png", "stickers/svg", "stickers/png"]) mkdirSync(resolve(PRINT, d), { recursive: true });
mkdirSync(SHOTS, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage();
async function render(svg, w, h, out, dsf = 3, bg = null) {
  const ctx = await browser.newContext({ viewport: { width: Math.round(w / dsf), height: Math.round(h / dsf) }, deviceScaleFactor: dsf });
  const p = await ctx.newPage();
  const sized = svg.replace(/<svg ([^>]*?)width="[\d.]+" height="[\d.]+"/, `<svg $1width="${w / dsf}" height="${h / dsf}"`);
  await p.setContent(`<html><body style="margin:0;background:${bg ?? "transparent"}">${sized.replace(/^<\?xml[^>]*>/, "")}</body></html>`);
  await p.waitForTimeout(120);
  await p.screenshot({ path: out, omitBackground: !bg, clip: { x: 0, y: 0, width: w / dsf, height: h / dsf } });
  await ctx.close();
}

// ------------------------------------------------------------------ 1) print files
const svgs = Object.fromEntries(DESIGNS.map((d) => [d.id, d.svg()]));
const stickerPrint = STICKERS.map((s) => ({ s, ...stickerSvg(s, { cut: true }) }));
const stickerWeb = Object.fromEntries(STICKERS.map((s) => [s.id, stickerSvg(s, { cut: false, bleed: 0 })]));
if (want("print")) {
  for (const d of DESIGNS) {
    writeFileSync(resolve(PRINT, "svg", `${d.file}.svg`), svgs[d.id]);
    await render(svgs[d.id], d.w, d.h, resolve(PRINT, "png", `${d.file}.png`));
    console.log("print", d.file, `${d.w}×${d.h}`);
  }
  for (const { s, w, h, svg } of stickerPrint) {
    writeFileSync(resolve(PRINT, "stickers/svg", `sticker-${s.id}.svg`), svg);
    await render(stickerWeb[s.id].svg, stickerWeb[s.id].w, stickerWeb[s.id].h, resolve(PRINT, "stickers/png", `sticker-${s.id}.png`), 1);
    console.log("sticker", s.id, `${w}×${h}`);
  }
}

// ------------------------------------------------------------------ 2) mockups
const G = M.GARMENT;
const L = (id, x, y, rot) => ({ ...stickerWeb[id], x, y, rot });
const front = (c, key) => () => M.tee({ color: G[c], art: svgs[key], placement: "front", label: svgs["neck-label"], pearl: c === "pearl" });
export const MOCKUPS = [
  ["hoodie-black", () => M.hoodie({ color: G.black, art: svgs["glow-lockup"] })],
  ["hoodie-navy", () => M.hoodie({ color: G.navy, art: svgs["glow-lockup"] })],
  ["pearl-tee", () => M.tee({ color: G.pearl, art: svgs["chest-mark"], placement: "chest", sleeve: svgs["sleeve-cyan"], label: svgs["neck-label"], pearl: true })],
  ["bomber-navy", () => M.bomber({ color: G.navy, patch: svgs["bomber-patch"], placket: svgs["bomber-placket"], label: svgs["neck-label"] })],
  ["bomber-black", () => M.bomber({ color: G.black, patch: svgs["bomber-patch"], placket: svgs["bomber-placket"], label: svgs["neck-label"] })],
  ["backglow-tee-black-front", () => M.tee({ color: G.black, art: svgs["chest-mark"], placement: "chest", label: svgs["neck-label"] })],
  ["backglow-tee-black-back", () => M.tee({ color: G.black, art: svgs["back-glow"], placement: "back" })],
  ["sleeve-tee-navy", () => M.tee({ color: G.navy, art: svgs["chest-mark"], placement: "chest", sleeve: svgs["sleeve-white"], label: svgs["neck-label"] })],
  ["sleeve-tee-black", () => M.tee({ color: G.black, art: svgs["chest-mark"], placement: "chest", sleeve: svgs["sleeve-cyan"], label: svgs["neck-label"] })],
  ["speed-of-light-black", front("black", "speed-of-light")],
  ["speed-of-light-navy", front("navy", "speed-of-light")],
  ["level-up-black", front("black", "level-up")],
  ["level-up-pearl", front("pearl", "level-up")],
  ["stardust-navy", front("navy", "stardust")],
  ["stardust-black", front("black", "stardust")],
  ["cap-black", () => M.cap({ color: G.black, art: svgs["cap-mark-3c"] })],
  ["cap-navy", () => M.cap({ color: G.navy, art: svgs["cap-mark-3c"] })],
  ["cap-black-lockup", () => M.cap({ color: G.black, art: svgs["cap-lockup"], aspect: 1050 / 2700, width: 430 })],
  ["mug-glow-front", () => M.mug({ wrap: svgs["mug-glow"], center: 700 })],
  ["mug-glow-back", () => M.mug({ wrap: svgs["mug-glow"], center: 2000 })],
  ["stickers-sheet", () => M.sheetOnDesk({ sheet: svgs["sticker-sheet-preview"], w: 1650, h: 2550 })],
  ["stickers-laptop", () => M.laptop({ stickers: [L("glow-q", 300, 340, -8), L("lockup-dark", 600, 290, 4), L("wordmark-cyan", 640, 560, -5), L("q-square", 800, 420, 10), L("q-diecut", 460, 470, 6), L("lockup-navy", 330, 600, 3), L("q-mono", 790, 610, -8), L("wordmark-white", 520, 385, -3)] })],
];
if (want("mockups")) {
  for (const [name, fn] of MOCKUPS) {
    await render(fn(), 1600, 1600, resolve(SHOTS, `mockup-${name}.png`), 1.6, M.STUDIO_BG);
    console.log("mockup", name);
  }
}

// ------------------------------------------------------------------ 3) contact sheets + hero
async function sheetPage(html, out, w, h = 800, full = true) {
  const f = resolve(SHOTS, "_sheet.html");
  writeFileSync(f, html);
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  await p.goto(pathToFileURL(f).href);
  await p.waitForTimeout(500);
  await p.screenshot({ path: out, fullPage: full });
  await ctx.close();
}
const css = `body{margin:0;background:#070709;color:#e8e6f5;font:15px/1.35 system-ui,sans-serif;padding:36px}h1{margin:0 0 6px;font-size:28px}p{margin:0 0 24px;color:#9aa0b8}
.g{display:grid;gap:18px}.c{background:#111114;border:1px solid #26262d;border-radius:14px;overflow:hidden}.c img{display:block;width:100%}.c div{padding:10px 12px;font-size:13px;color:#c9c6e0}`;
if (want("sheets")) {
  const cells = MOCKUPS.map(([n]) => `<div class="c"><img src="mockup-${n}.png"><div>${n}</div></div>`).join("");
  await sheetPage(`<style>${css}.g{grid-template-columns:repeat(6,1fr)}</style><h1>Quasaria merch v4 — mockups</h1><p>${MOCKUPS.length} programmatic studio mockups · minimal, logo-led · black / navy / pearl · example products, not for sale yet</p><div class="g">${cells}</div>`, resolve(SHOTS, "merch-contact-sheet-v4.png"), 2000);
  const dcells = DESIGNS.filter((d) => d.id !== "sticker-sheet").map((d) => `<div class="c"><div style="background:${d.id.startsWith("sticker") ? "#6f7385" : "#141417"};padding:14px;aspect-ratio:1;display:flex;align-items:center;justify-content:center"><img style="max-width:100%;max-height:100%;width:auto" src="${pathToFileURL(resolve(PRINT, "png", d.file + ".png")).href}"></div><div>${d.file}<br><span style="color:#8d93ad">${d.w}×${d.h} · ${d.kind}</span></div></div>`).join("");
  await sheetPage(`<style>${css}.g{grid-template-columns:repeat(6,1fr)}</style><h1>Quasaria merch v4 — print designs</h1><p>Full-resolution print PNGs (transparent) rendered from outlined SVG</p><div class="g">${dcells}</div>`, resolve(SHOTS, "merch-designs-overview-v4.png"), 2000);
  console.log("sheets done");
}
if (want("hero")) {
  const panels = ["hoodie-black", "pearl-tee", "bomber-navy"].map((n) => `<img src="mockup-${n}.png">`).join("");
  await sheetPage(`<style>html,body{margin:0;background:#0B0B0D}.h{display:grid;grid-template-columns:repeat(3,1fr);gap:24px;padding:24px;width:2400px;box-sizing:border-box}.h img{display:block;width:100%;aspect-ratio:1;object-fit:cover;border-radius:28px;box-shadow:0 0 0 1px #ffffff14}</style><div class="h">${panels}</div>`, resolve(SHOTS, "merch-hero-v4.png"), 2400, 2 * 24 + Math.round((2400 - 4 * 24) / 3), false);
  console.log("hero done");
}

// ------------------------------------------------------------------ 4) README for the print folder
if (want("readme")) {
  const dpi = (d) => (d.file.includes("600dpi") ? 600 : 300);
  const inch = (d) => `${(d.w / dpi(d)).toFixed(2).replace(/\.00$/, "")} × ${(d.h / dpi(d)).toFixed(2).replace(/\.00$/, "")} in`;
  const rows = DESIGNS.map((d) => `| \`svg/${d.file}.svg\` + \`png/${d.file}.png\` | ${d.kind} | ${d.w} × ${d.h} px | ${dpi(d)} DPI · ${inch(d)} | ${d.garments} | ${d.note} |`).join("\n");
  const srows = stickerPrint.map(({ s, w, h }) => `| \`stickers/svg/sticker-${s.id}.svg\` / \`stickers/png/sticker-${s.id}.png\` | ${s.name} | SVG ${w} × ${h} px (${(w / 300).toFixed(2)} × ${(h / 300).toFixed(2)} in, incl. bleed) · PNG ${stickerWeb[s.id].w} × ${stickerWeb[s.id].h} px |`).join("\n");
  writeFileSync(resolve(PRINT, "README.md"), `# Quasaria merch — print files (v4, minimal logo-led line)

Original artwork built around the Quasaria **Singularity Q** mark and the Quasaria wordmark (both
unchanged, taken from \`frontend/public/brand/\`). No third-party or Stellar/XLM logos. All text is
converted to outlines, so no fonts are needed. Regenerate with \`scripts/merch/build-merch.mjs\` +
\`scripts/merch/post-merch.py\` in the repo. Earlier lines are archived in \`../print-v1/\`,
\`../print-v2/\` and \`../print-v3/\`.

**Style:** minimal and premium. The glowing Singularity Q is the focal point; the wordmark is the
only type on the core pieces. The three slogan tees (Speed of Light, Level Up, Stardust to Quasar)
are kept but reduced to one glowing Q, one simple graphic element and one short line of type.

* **Palette:** logo violet \`#7C5CFF\` → cyan \`#22D3EE\` glow, white \`#FFFFFF\`.
  Garments: **Black** \`#141417\`, **Navy** \`#1B2446\`, **Pearl** (iridescent white, \`#E6E8EE\` base).
* **Pearl iridescent tee** is a specialty blank (pearlescent / iridescent-finish fabric) and is not a
  standard Printful/Printify DTG blank. Source it from a cut-and-sew or specialty supplier, or fall
  back to a white or "pearl"/ash heavyweight tee (the chest Q and cyan sleeve file work on white).
* **SVG** = master vector files (glow uses SVG gradients/blur). For embroidery use the flat
  \`*-embroidery-*\` / \`bomber-*-600dpi\` files and send them for digitising.
* **PNG** = transparent, sRGB, tagged 300 DPI (embroidery files 600 DPI). The glow contains
  semi-transparent pixels: for DTG on dark garments ask for a white underbase and keep transparency.

## Placements

| Product | Placement |
|---|---|
| Glow hoodie (black, navy) | \`glow-lockup\` centre chest, ~12 in wide |
| Pearl iridescent tee | \`chest-q\` left chest (~3.5 in) + \`sleeve-wordmark-cyan\` on the wearer's left sleeve + \`neck-label\` inside neck |
| Back Glow tee (black) | \`chest-q\` left chest + \`back-glow-q\` full back |
| Sleeve tee (navy, black) | \`chest-q\` left chest + sleeve wordmark (white on navy, cyan on black) |
| Speed of Light / Level Up / Stardust to Quasar tees | \`*-minimal\` full front, 15 × 18 in area (art is kept inside ~11 in) |
| Bomber (navy, black) | see below |
| Cap (black, navy) | \`cap-embroidery-q-3color\` or \`cap-embroidery-lockup\`, front, ≤ 3 threads |
| Mug (black 11 oz) | \`mug-11oz-wrap-glow-black\` full wrap |
| Sticker sheet | \`sticker-sheet-5.5x8.5in\`, kiss-cut |

## Bomber jacket (Printful embroidered bomber)

* **Chest:** \`bomber-chest-embroidery-4x4in\` on the left chest. Printful's left/right chest
  embroidery area is max **4 × 4 in**; sleeve/wrist placements are max **2 × 3 in**.
* **Extra placements** cost about **$2.95 each** at Printful; each design is limited to roughly
  **15,000 stitches** (the chest file is 3 threads and well under that).
* **Vertical "Quasaria" beside the zip:** a vertical placket is **not a standard Printful
  placement**. Options: (a) run \`bomber-placket-wordmark-vertical-1x4in\` in the **right chest**
  area (1 × 4 in fits the 4 × 4 in box), or (b) use a custom/cut-and-sew provider that embroiders the
  placket.
* **Patch alternative:** \`bomber-chest-patch-3x3.5in\` as a woven or sublimated patch sewn on the
  chest pocket (as in the reference), instead of direct embroidery.
* The sleeve utility pocket in the mockup is part of the blank (MA-1 style), not a print.

## Designs

| Files | Product | Pixels | Resolution / size | Garments | Notes |
|---|---|---|---|---|---|
${rows}

## Individual die-cut stickers (300 DPI)

SVGs include the magenta \`#EC008C\` **CutContour** hairline (2.5 mm white border, 1.5 mm bleed).
PNGs are the finished look (white border, no bleed/cut line).

| Files | Sticker | Size |
|---|---|---|
${srows}

## Before ordering

1. Order a physical sample of each item: the violet → cyan glow shifts on DTG, and navy and
   pearl blanks vary by supplier.
2. Re-check each provider's current templates (mug wrap, cap and bomber areas vary by blank).
3. Embroidery threads: violet ≈ \`#7C5CFF\`, turquoise/cyan ≈ \`#22D3EE\`, white. Caps ≤ 3 threads.
`);
  console.log("README written");
}
await browser.close();
