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
const tone = (c) => (c === "black" ? "dark" : "light");
const tees = (n, key, colors, placement) => colors.map((c) => [`tee-${n}-${c}`, () => M.tee({ color: G[c], art: svgs[`${key}-${tone(c)}`], placement })]);
export const MOCKUPS = [
  ...tees("01", "tee-01-chest", ["black", "bone", "lavender"], "chest"),
  ["tee-02-black-back", () => M.tee({ color: G.black, art: svgs["tee-02-back-dark"], placement: "back" })],
  ["tee-02-bone-back", () => M.tee({ color: G.bone, art: svgs["tee-02-back-light"], placement: "back" })],
  ["tee-02-black-front", () => M.tee({ color: G.black, art: svgs["tee-02-chest"], placement: "chest" })],
  ...tees("03", "tee-03", ["black", "bone", "lime"]),
  ...tees("04", "tee-04", ["black", "lavender", "lime"]),
  ...tees("05", "tee-05", ["black", "bone", "lavender"]),
  ...["black", "bone", "lavender"].map((c) => [`hoodie-${c}`, () => M.hoodie({ color: G[c], art: svgs[`hoodie-front-${tone(c)}`] })]),
  ["cap-black", () => M.cap({ color: G.black, art: svgs["cap-mark-3c"] })],
  ["cap-bone", () => M.cap({ color: G.bone, art: svgs["cap-mark-tonal"] })],
  ["cap-black-lockup", () => M.cap({ color: G.black, art: svgs["cap-lockup-dark"], aspect: 1050 / 2700, width: 430 })],
  ["cap-bone-lockup", () => M.cap({ color: G.bone, art: svgs["cap-lockup-light"], aspect: 1050 / 2700, width: 430 })],
  ["mug-gm-front", () => M.mug({ wrap: svgs["mug-gm"], center: 700, body: G.white })],
  ["mug-gm-back", () => M.mug({ wrap: svgs["mug-gm"], center: 2000, body: G.white })],
  ["mug-singularity-front", () => M.mug({ wrap: svgs["mug-singularity"], center: 700 })],
  ["mug-singularity-back", () => M.mug({ wrap: svgs["mug-singularity"], center: 2000 })],
  ["stickers-laptop", () => M.laptop({ stickers: [L("logo", 285, 330, -8), L("lockup", 585, 280, 4), L("rank-quasar", 780, 410, 10), L("rank-nova", 675, 540, -6), L("badge-risk-aware", 285, 580, 6), L("level-up", 480, 615, -3), L("xp", 800, 615, 8), L("gm", 480, 440, -12), L("rank-comet", 390, 455, 4), L("pioneer", 610, 395, 3)] })],
  ["stickers-sheet", () => M.sheetOnDesk({ sheet: svgs["sticker-sheet-preview"] })],
];
if (want("mockups")) {
  for (const [name, fn] of MOCKUPS) {
    await render(fn(), 1600, 1600, resolve(SHOTS, `mockup-${name}.png`), 1.6, M.STUDIO_BG);
    console.log("mockup", name);
  }
}

// ------------------------------------------------------------------ 3) contact sheets
async function sheetPage(html, out, w) {
  const f = resolve(SHOTS, "_sheet.html");
  writeFileSync(f, html);
  const ctx = await browser.newContext({ viewport: { width: w, height: 800 }, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  await p.goto(pathToFileURL(f).href);
  await p.waitForTimeout(400);
  await p.screenshot({ path: out, fullPage: true });
  await ctx.close();
}
const css = `body{margin:0;background:#06070d;color:#e8e6f5;font:15px/1.35 system-ui,sans-serif;padding:36px}h1{margin:0 0 6px;font-size:28px}p{margin:0 0 24px;color:#9aa0b8}
.g{display:grid;gap:18px}.c{background:#0f1120;border:1px solid #242842;border-radius:14px;overflow:hidden}.c img{display:block;width:100%}.c div{padding:10px 12px;font-size:13px;color:#c9c6e0}`;
if (want("sheets")) {
  const cells = MOCKUPS.map(([n]) => `<div class="c"><img src="mockup-${n}.png"><div>${n}</div></div>`).join("");
  await sheetPage(`<style>${css}.g{grid-template-columns:repeat(6,1fr)}</style><h1>Quasaria merch v2 — mockups</h1><p>${MOCKUPS.length} programmatic mockups · original artwork only · example products, not for sale yet</p><div class="g">${cells}</div>`, resolve(SHOTS, "merch-contact-sheet-v2.png"), 2000);
  const dcells = DESIGNS.filter((d) => d.id !== "sticker-sheet").map((d) => `<div class="c"><div style="background:${d.id.startsWith("sticker") ? "#7d8299" : d.id.endsWith("-light") || d.id === "cap-mark-tonal" || d.id === "mug-gm" ? "#ECE6DA" : "#15161d"};padding:14px;aspect-ratio:1;display:flex;align-items:center;justify-content:center"><img style="max-width:100%;max-height:100%;width:auto" src="${pathToFileURL(resolve(PRINT, "png", d.file + ".png")).href}"></div><div>${d.file}<br><span style="color:#8d93ad">${d.w}×${d.h} · ${d.kind}</span></div></div>`).join("");
  await sheetPage(`<style>${css}.g{grid-template-columns:repeat(6,1fr)}</style><h1>Quasaria merch v2 — print designs</h1><p>Full-resolution print PNGs (transparent) rendered from outlined SVG</p><div class="g">${dcells}</div>`, resolve(SHOTS, "merch-designs-overview-v2.png"), 2000);
  console.log("sheets done");
}

// ------------------------------------------------------------------ 4) README for the print folder
if (want("readme")) {
  const dpi = (d) => (d.id.startsWith("cap") ? 600 : 300);
  const inch = (d) => `${(d.w / dpi(d)).toFixed(2).replace(/\.00$/, "")} × ${(d.h / dpi(d)).toFixed(2).replace(/\.00$/, "")} in`;
  const rows = DESIGNS.map((d) => `| \`svg/${d.file}.svg\` + \`png/${d.file}.png\` | ${d.kind} | ${d.w} × ${d.h} px | ${dpi(d)} DPI · ${inch(d)} | ${d.garments} | ${d.note} |`).join("\n");
  const srows = stickerPrint.map(({ s, w, h }) => `| \`stickers/svg/sticker-${s.id}.svg\` / \`stickers/png/sticker-${s.id}.png\` | ${s.name} | SVG ${w} × ${h} px (${(w / 300).toFixed(2)} × ${(h / 300).toFixed(2)} in, incl. bleed) · PNG ${stickerWeb[s.id].w} × ${stickerWeb[s.id].h} px |`).join("\n");
  writeFileSync(resolve(PRINT, "README.md"), `# Quasaria merch — print files (v2, 2026 refresh)

Original artwork built around the Quasaria **Singularity Q** mark (unchanged). No third-party or
Stellar/XLM logos are used. All text is converted to outlines (Space Grotesk + JetBrains Mono), so
no fonts are needed. Regenerate with \`scripts/merch/build-merch.mjs\` + \`scripts/merch/post-merch.py\`
in the repo. The v1 files are archived in \`../print-v1/\`.

**Style:** liquid-chrome type, holographic violet → cyan → lime → coral gradients, soft grain and
glow, oversized tight grotesk, asymmetric layouts. Designs that go on several garment colours come
in two inks: \`*-on-dark\` (light ink, for **Black**) and \`*-on-light\` (dark ink, for **Bone**,
**Lavender** and **Electric Lime**). Always match the file to the garment.

* **SVG** = master vector files. Chrome, holo gradients, glows and grain use SVG gradients/filters;
  for vector-only workflows (screen print / embroidery digitising) use the flat cap files or the PNG.
* **PNG** = transparent, sRGB, tagged \`300 DPI\` (cap files \`600 DPI\`). Shirt fronts/backs are 4500 × 5400 px
  (15 × 18 in), the standard DTG print area at Printful/Printify.
* Grain and glows contain semi-transparent pixels. For DTG on dark garments ask for a white
  underbase, and keep transparent areas transparent (don't flatten onto a background colour).
* Palette: violet \`#7C5CFF\` / deep \`#5B3DF5\`, cyan \`#22D3EE\` / deep \`#0EA5C6\`, lime \`#C6FF3D\`,
  electric coral \`#FF5E5B\`, sunset orange \`#FF8A3D\`, bone \`#F3EEE4\`, ink \`#0E0D18\`.
* Garments (example blanks): Black \`#141418\`, Bone \`#ECE6DA\`, Lavender \`#C9BEF2\`, Electric Lime \`#D4F75A\`.

## Designs

| Files | Product | Pixels | Resolution / size | Garments | Notes |
|---|---|---|---|---|---|
${rows}

## Individual die-cut stickers (300 DPI)

SVGs include the magenta \`#EC008C\` **CutContour** hairline (2.5 mm white border, 1.5 mm bleed).
PNGs are the finished look (white border, no bleed/cut line) for kiss-cut sticker products.

| Files | Sticker | Size |
|---|---|---|
${srows}

## Before ordering

1. Order one physical sample of each item: chrome and holographic gradients, lime and coral in
   particular, shift on DTG. Check the on-light files on real Bone/Lavender/Lime blanks.
2. Re-check each provider's current template (mug wrap and cap areas vary by blank).
3. Embroidery: send \`cap-embroidery-*.svg\` for digitising. Threads ≈ violet, turquoise/cyan, white
   (dark caps); violet + coral (tonal light cap); violet, cyan, ink + coral (light lockup).
`);
  console.log("README written");
}
await browser.close();
