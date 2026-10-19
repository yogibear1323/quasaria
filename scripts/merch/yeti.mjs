// Quasaria merch line — "Yeti": the parka yeti (same character as the GLACIERQ token icon, the site
// background and the store logo) is the hero of the tees, hoodie, bomber patch, back print, mug and
// stickers. The Singularity Q stays as the small supporting mark (sleeve lockup, cap embroidery, Q
// stickers, bomber embroidery). Minimal, premium, logo-led: a glowing yeti bust with a frost rim light,
// or a navy badge with a thin silver ring where the print has to stay legible on a light garment.
//
// Source art: scripts/merch/assets/yeti-bust-cutout.webp, built by yeti-cutout.py from the user's yeti
// photo (head, hood and shoulders only; the chest logo is cropped out). Override with YETI_CUTOUT=/path.
// Used by build-merch.mjs when MERCH_LINE=yeti.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { r2, svgDoc, V2, wordmarkC, flatMark, glowMark, text, blur, holo, root } from "./lib.mjs";
import { DESIGNS as BASE, STICKERS as BASE_STICKERS, SHEET_POS as BASE_POS, stickerSheet } from "./designs.mjs";
import * as M from "./mockups.mjs";

const buf = readFileSync(process.env.YETI_CUTOUT || resolve(root, "scripts/merch/assets/yeti-bust-cutout.webp"));
const YURI = `data:image/webp;base64,${buf.toString("base64")}`;
// WebP VP8X header: canvas width-1 / height-1 as 24-bit little-endian at bytes 24 / 27.
const YW = buf.readUIntLE(24, 3) + 1, YH = buf.readUIntLE(27, 3) + 1;
export const YETI_SIZE = [YW, YH];

const W = 4500, H = 5400; // 15 × 18 in @ 300 DPI
const caption = (s, cx, y, size, fill = V2.text2) => text(s, { w: 500, size, x: cx, y, tracking: 0.32, fill });

/** Frost-lit yeti bust: soft halo, ice rim light around the fur, bust dissolving into the garment.
 *  (cx, y) = top-centre, w = width. ink = light-garment variant (deep navy rim, no bright halo). */
export function yeti(cx, y, w, p, { ink = false, glow = 1 } = {}) {
  const h = (w * YH) / YW, x = cx - w / 2, rim = ink ? "#1E3A66" : "#BFE3F7";
  return `<defs><radialGradient id="${p}hl" cx="${r2(cx)}" cy="${r2(y + h * 0.45)}" r="${r2(w * 0.62)}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${ink ? "#4F86B8" : "#BFE3F7"}" stop-opacity="${r2((ink ? 0.14 : 0.32) * glow)}"/><stop offset=".5" stop-color="#8FA6C8" stop-opacity="${r2((ink ? 0.07 : 0.15) * glow)}"/><stop offset="1" stop-color="#8FA6C8" stop-opacity="0"/></radialGradient>
<filter id="${p}rim" x="-20%" y="-20%" width="140%" height="140%" color-interpolation-filters="sRGB"><feGaussianBlur in="SourceAlpha" stdDeviation="${r2(w * 0.05)}" result="b2"/><feFlood flood-color="${rim}" flood-opacity="${r2((ink ? 0.35 : 0.5) * glow)}"/><feComposite in2="b2" operator="in" result="g2"/><feGaussianBlur in="SourceAlpha" stdDeviation="${r2(w * 0.011)}" result="b1"/><feFlood flood-color="${rim}" flood-opacity="${ink ? 0.55 : 0.9}"/><feComposite in2="b1" operator="in" result="g1"/><feMerge><feMergeNode in="g2"/><feMergeNode in="g1"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>
<ellipse cx="${r2(cx)}" cy="${r2(y + h * 0.48)}" rx="${r2(w * 0.62)}" ry="${r2(h * 0.7)}" fill="url(#${p}hl)"/>
<image href="${YURI}" x="${r2(x)}" y="${r2(y)}" width="${r2(w)}" height="${r2(h)}" filter="url(#${p}rim)"/>`;
}

/** Round badge: yeti on a deep-navy disc with a thin silver ring. Legible on any garment colour. */
export function badge(cx, cy, R, p, { ink = false } = {}) {
  const bw = R * 2.1, bh = (bw * YH) / YW, bx = cx - 0.45 * bw, by = cy - 0.44 * bh;
  return `<defs><radialGradient id="${p}dk" cx="${r2(cx)}" cy="${r2(cy - R * 0.3)}" r="${r2(R * 1.15)}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#34527F"/><stop offset=".55" stop-color="#1B2A4A"/><stop offset="1" stop-color="#0B1428"/></radialGradient>
<radialGradient id="${p}hl" cx="${r2(cx)}" cy="${r2(cy)}" r="${r2(R * 1.32)}" gradientUnits="userSpaceOnUse"><stop offset=".72" stop-color="#BFE3F7" stop-opacity="${ink ? 0 : 0.34}"/><stop offset="1" stop-color="#BFE3F7" stop-opacity="0"/></radialGradient>
<linearGradient id="${p}rg" x1="${r2(cx - R)}" y1="${r2(cy - R)}" x2="${r2(cx + R)}" y2="${r2(cy + R)}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#FFFFFF"/><stop offset=".35" stop-color="#A9BFDD"/><stop offset=".62" stop-color="#5B7299"/><stop offset="1" stop-color="#E8F0FA"/></linearGradient>
<clipPath id="${p}cl"><circle cx="${r2(cx)}" cy="${r2(cy)}" r="${r2(R * 0.97)}"/></clipPath></defs>
<circle cx="${r2(cx)}" cy="${r2(cy)}" r="${r2(R * 1.32)}" fill="url(#${p}hl)"/>
<circle cx="${r2(cx)}" cy="${r2(cy)}" r="${r2(R)}" fill="url(#${p}dk)"/>
<g clip-path="url(#${p}cl)"><image href="${YURI}" x="${r2(bx)}" y="${r2(by)}" width="${r2(bw)}" height="${r2(bh)}"/></g>
<circle cx="${r2(cx)}" cy="${r2(cy)}" r="${r2(R * 0.965)}" fill="none" stroke="#000" stroke-opacity=".28" stroke-width="${r2(R * 0.03)}"/>
<circle cx="${r2(cx)}" cy="${r2(cy)}" r="${r2(R * 0.985)}" fill="none" stroke="url(#${p}rg)" stroke-width="${r2(R * 0.045)}"/>`;
}

// ------------------------------------------------------------------ placements
/** Hoodie centre chest (12 × 14 in): glowing yeti over the white wordmark. */
const yetiLockup = () => svgDoc(3600, 4200, `${yeti(1800, 250, 3300, "yl")}${wordmarkC(1800, 3420, 2700, "#fff")}`, { title: "Quasaria — Yeti lockup, centre chest (12 × 14 in @ 300 DPI)", desc: "Glowing parka yeti bust over the Quasaria wordmark" });
/** Small left-chest yeti badge (4 × 4 in). */
const chestBadge = () => svgDoc(1200, 1200, badge(600, 600, 520, "cb"), { title: "Quasaria — left-chest yeti badge (4 × 4 in @ 300 DPI)", desc: "Yeti on a navy disc with a silver ring" });
const chestBadgeInk = () => svgDoc(1200, 1200, badge(600, 600, 520, "cbi", { ink: true }), { title: "Quasaria — left-chest yeti badge, light-garment version (4 × 4 in @ 300 DPI)", desc: "Same badge without the bright halo, for glacier white" });
/** Centre-chest yeti badge (9 in) for the glacier-white iridescent tee. */
const centerBadgeInk = () => svgDoc(2700, 2700, badge(1350, 1350, 1190, "ccb", { ink: true }), { title: "Quasaria — centre-chest yeti badge, light-garment version (9 × 9 in @ 300 DPI)", desc: "Navy disc keeps the white fur legible on glacier white" });
/** Sleeve lockup (4 × 1.2 in): small supporting Q + wordmark. */
const sleeveLockup = (fill, tag, q) => () => svgDoc(1200, 360, flatMark(60, 85, 190, q) + wordmarkC(745, 180, 850, fill), { title: `Quasaria — sleeve Q + wordmark, ${tag} (4 × 1.2 in @ 300 DPI)`, desc: "Small supporting Singularity Q with the exact brand wordmark for the upper sleeve" });
const INK_Q = { ring: "#1E3A66", tail: "#2B4A7C", core: "#16305C", glint: "#2B4A7C" };
/** Full back (15 × 18 in): big glowing yeti, small wordmark. */
const backYeti = () => svgDoc(W, H, `${yeti(W / 2, 380, 4100, "by")}${wordmarkC(W / 2, 4080, 1500, "#fff")}${caption("SINGULARITY SERIES", W / 2, 4430, 90)}`, { title: "Quasaria — back yeti print (15 × 18 in @ 300 DPI)", desc: "Large glowing yeti bust, small wordmark" });
function speedYeti() {
  const w = 3300, x = W / 2, y = 800, h = (w * YH) / YW, cy = y + h * 0.4;
  const body = `<defs><linearGradient id="slst" x1="200" y1="0" x2="4300" y2="0" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#8FA6C8" stop-opacity="0"/><stop offset=".3" stop-color="#8FA6C8" stop-opacity=".7"/><stop offset=".5" stop-color="#FFFFFF"/><stop offset=".7" stop-color="#BFE3F7" stop-opacity=".7"/><stop offset="1" stop-color="#BFE3F7" stop-opacity="0"/></linearGradient>${blur("slb", 18)}</defs>
<rect x="200" y="${r2(cy - 14)}" width="4100" height="28" rx="14" fill="url(#slst)" filter="url(#slb)"/>
<rect x="200" y="${r2(cy - 5)}" width="4100" height="10" rx="5" fill="url(#slst)"/>
${yeti(x, y, w, "sy")}
${caption("TRADE AT THE SPEED OF LIGHT", W / 2, 3900, 120, V2.text)}
${wordmarkC(W / 2, 4260, 900, V2.text2)}`;
  return svgDoc(W, H, body, { title: "Quasaria — Speed of Light, yeti (minimal)", desc: "Glowing yeti with a single light streak behind it, one line of type" });
}
function levelYeti(ink = false) {
  const cx = W / 2, cy = 2050, R = 1500, a0 = -90, a1 = -90 + 360 * 0.86;
  const P = (a) => [r2(cx + R * Math.cos((a * Math.PI) / 180)), r2(cy + R * Math.sin((a * Math.PI) / 180))];
  const [sx, sy] = P(a0), [ex, ey] = P(a1), w = 2450, h = (w * YH) / YW;
  const body = `<defs>${holo("luring", cx - R, cy - R, cx + R, cy + R, ink ? { stops: ["#4A6FA5", "#1E3A66", "#16305C"] } : {})}</defs>
<circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="${ink ? "#1E3A66" : "#fff"}" stroke-opacity="${ink ? ".14" : ".10"}" stroke-width="40"/>
<path d="M${sx} ${sy}A${R} ${R} 0 1 1 ${ex} ${ey}" fill="none" stroke="url(#luring)" stroke-width="40" stroke-linecap="round"/>
<circle cx="${ex}" cy="${ey}" r="46" fill="${ink ? "#16305C" : "#fff"}"/>
${ink ? badge(cx, cy, 1270, "ly", { ink: true }) : yeti(cx, cy - h * 0.5, w, "ly")}
${text("LEVEL UP", { w: 500, size: 150, x: cx, y: 3950, tracking: 0.32, fill: ink ? "#16305C" : V2.text })}
${wordmarkC(cx, 4300, 900, ink ? "#2B4A7C" : V2.text2)}`;
  return svgDoc(W, H, body, { title: `Quasaria — Level Up, yeti (minimal${ink ? ", deep ink" : ""})`, desc: "Yeti inside a single XP ring, one line of type" });
}
function stardustYeti() {
  const w = 2900, cx = 2850, y = 900;
  const dots = [[500, 3250, 24], [800, 3030, 38], [1100, 2830, 56], [1400, 2640, 78]].map(([x, yy, r], i) => `<circle cx="${x}" cy="${yy}" r="${r}" fill="${i < 2 ? V2.text2 : i === 2 ? V2.lilac : V2.ice}"/>`).join("");
  const body = `<path d="M600 3200Q1200 2750 1500 2600" fill="none" stroke="#fff" stroke-opacity=".12" stroke-width="10" stroke-dasharray="2 44" stroke-linecap="round"/>
${dots}
${yeti(cx, y, w, "sd")}
${caption("FROM STARDUST TO QUASAR", W / 2, 3900, 120, V2.text)}
${wordmarkC(W / 2, 4260, 900, V2.text2)}`;
  return svgDoc(W, H, body, { title: "Quasaria — From Stardust to Quasar, yeti (minimal)", desc: "Four dots of stardust growing into the glowing yeti, one line of type" });
}
/** Bomber chest patch (3 × 3.5 in): yeti bust + wordmark on the navy patch. */
const bomberPatchYeti = () => svgDoc(900, 1050, `<rect x="6" y="6" width="888" height="1038" rx="60" fill="#1E2D4D" stroke="#4D648F" stroke-width="12"/><rect x="36" y="36" width="828" height="978" rx="40" fill="none" stroke="#fff" stroke-opacity=".18" stroke-width="4" stroke-dasharray="14 12"/>${yeti(450, 120, 700, "bpy", { glow: 0.8 })}${wordmarkC(450, 830, 600, "#fff")}`, { title: "Quasaria — bomber chest patch, yeti (3 × 3.5 in @ 300 DPI)", desc: "Woven or sublimated patch: yeti bust + wordmark on navy, merrowed edge" });
/** Cap patch (3 in round, sublimated or woven photo patch). The embroidered Q stays the primary cap mark. */
const capPatch = () => svgDoc(900, 900, badge(450, 450, 400, "cpy"), { title: "Quasaria — cap yeti patch (3 in round @ 300 DPI)", desc: "Round woven/sublimated patch: yeti on navy with a silver ring" });
/** Mug wrap (11 oz): side A yeti, side B Q + wordmark. */
function mugYeti() {
  const w = 2700, h = 1050;
  return svgDoc(w, h, `<rect width="${w}" height="${h}" fill="#0F1830"/>${yeti(700, 130, 900, "mgy")}${glowMark(1900, 210, 200, "mgq", { bloom: 0.5 })}${wordmarkC(2000, 600, 900, "#fff")}`, { title: "Quasaria — Yeti mug wrap (navy 11 oz)", desc: "Side A: glowing yeti; side B: small Q over the wordmark" });
}

// ------------------------------------------------------------------ stickers
const rr = (w, h, rx) => ({ type: "rrect", w, h, rx });
export const STICKERS = BASE_STICKERS.map((s) => {
  if (s.id === "glow-q") return { id: "yeti-circle", name: "Yeti badge (circle)", shape: { type: "circle", r: 280 }, draw: (p) => badge(0, 0, 262, p) };
  if (s.id === "q-square") return { id: "yeti-square", name: "Yeti badge (square)", shape: rr(340, 340, 86), draw: (p) => `<rect x="-170" y="-170" width="340" height="340" rx="86" fill="#0F1830"/>${badge(0, 0, 134, p)}` };
  return s;
});
export const SHEET_POS = { "yeti-circle": BASE_POS["glow-q"], "yeti-square": BASE_POS["q-square"], ...Object.fromEntries(Object.entries(BASE_POS).filter(([k]) => k !== "glow-q" && k !== "q-square")) };

// ------------------------------------------------------------------ catalogue of print files (yeti line)
const R = {
  "glow-lockup": { file: "glow-lockup-yeti-center-chest-12x14in", svg: yetiLockup, note: "The Yeti hoodie print. Glow uses transparency: DTG with white underbase." },
  "chest-mark": { file: "chest-yeti-badge-left-4x4in", svg: chestBadge, note: "Yeti badge; ~3.5 in wide on the garment." },
  "chest-mark-ink": { file: "chest-yeti-badge-left-4x4in-ink", svg: chestBadgeInk, note: "Light-garment version of the left-chest badge (no bright halo); ~3.5 in wide." },
  "sleeve-cyan": { file: "sleeve-q-wordmark-cyan-4x1.2in", svg: sleeveLockup(V2.cyan, "ice blue", undefined), note: "Small supporting Q + wordmark. Upper sleeve (wearer's left); Printful max sleeve area 4 × 3.5 in." },
  "sleeve-ink": { file: "sleeve-q-wordmark-ink-4x1.2in", svg: sleeveLockup("#1E3A66", "deep ink", INK_Q), note: "Deep-ink Q + wordmark for light tees." },
  "sleeve-white": { file: "sleeve-q-wordmark-white-4x1.2in", svg: sleeveLockup("#fff", "white", undefined), note: "White wordmark with the silver-blue Q, for dark tees." },
  "back-glow": { file: "back-glow-yeti-15x18in", svg: backYeti, note: "Pairs with the left-chest yeti badge on the front." },
  "speed-of-light": { file: "speed-of-light-yeti-15x18in", svg: speedYeti, note: "Minimal: glowing yeti, one light streak, one line of type." },
  "level-up": { file: "level-up-yeti-15x18in", svg: () => levelYeti(false), note: "Minimal: glowing yeti in one XP ring." },
  "level-up-ink": { file: "level-up-yeti-15x18in-ink", svg: () => levelYeti(true), note: "Navy yeti badge in a deep-ink ring, for light tees." },
  "stardust": { file: "stardust-to-quasar-yeti-15x18in", svg: stardustYeti, note: "Minimal: four stardust dots growing into the glowing yeti." },
  "bomber-patch": { file: "bomber-chest-patch-yeti-3x3.5in", svg: bomberPatchYeti, note: "Alternative to direct embroidery (the 3-thread Q embroidery file is kept), sewn on the chest." },
  "mug-glow": { file: "mug-11oz-wrap-yeti-navy", svg: mugYeti, note: "Side A (yeti) centred at x=700, side B (Q + wordmark) at x=2000." },
};
export const DESIGNS = [
  ...BASE.filter((d) => !d.id.startsWith("sticker-sheet")).map((d) => (R[d.id] ? { ...d, ...R[d.id] } : d)),
  { id: "badge-center-ink", file: "chest-yeti-badge-center-ink-9x9in", w: 2700, h: 2700, svg: centerBadgeInk, kind: "Tee · centre chest (DTG)", garments: "Glacier White", note: "9 in navy yeti badge for the light tee." },
  { id: "cap-patch-yeti", file: "cap-patch-yeti-3in-round", w: 900, h: 900, svg: capPatch, kind: "Cap · front patch (woven/sublimated)", garments: "Midnight Navy, Glacier Slate cap", note: "Photo patch alternative to the embroidered Q." },
  { id: "sticker-sheet", file: "sticker-sheet-5.5x8.5in-print-with-cutlines", w: 1650, h: 2550, svg: () => stickerSheet({ cut: true, list: STICKERS, pos: SHEET_POS }), kind: "Stickers · sheet", garments: "White vinyl, kiss-cut", note: "Magenta #FF00FF hairlines = CutContour, 18 px bleed." },
  { id: "sticker-sheet-preview", file: "sticker-sheet-5.5x8.5in-preview", w: 1650, h: 2550, svg: () => stickerSheet({ cut: false, list: STICKERS, pos: SHEET_POS }), kind: "Stickers · sheet", garments: "—", note: "Preview without cut lines." },
];

// ------------------------------------------------------------------ mockups
/** ctx = { svgs, stickerWeb } from build-merch.mjs. Same mockup names as the earlier lines, plus the cap yeti patch. */
export function mockups({ svgs, stickerWeb }) {
  const G = M.GARMENT;
  const L = (id, x, y, rot) => ({ ...stickerWeb[id], x, y, rot });
  const front = (c, key) => () => M.tee({ color: G[c], art: svgs[key], placement: "front", label: svgs["neck-label"], pearl: c === "pearl", crisp: true });
  return [
    ["hoodie-black", () => M.hoodie({ color: G.black, art: svgs["glow-lockup"] })],
    ["hoodie-navy", () => M.hoodie({ color: G.navy, art: svgs["glow-lockup"] })],
    ["pearl-tee", () => M.tee({ color: G.pearl, art: svgs["badge-center-ink"], placement: "front", box: [388, 226, 224, 224], sleeve: svgs["sleeve-ink"], label: svgs["neck-label"], pearl: true, crisp: true })],
    ["bomber-navy", () => M.bomber({ color: G.navy, patch: svgs["bomber-patch"], placket: svgs["bomber-placket"], label: svgs["neck-label"] })],
    ["bomber-black", () => M.bomber({ color: G.black, patch: svgs["bomber-patch"], placket: svgs["bomber-placket"], label: svgs["neck-label"] })],
    ["backglow-tee-black-front", () => M.tee({ color: G.black, art: svgs["chest-mark"], placement: "chest", label: svgs["neck-label"] })],
    ["backglow-tee-black-back", () => M.tee({ color: G.black, art: svgs["back-glow"], placement: "back" })],
    ["sleeve-tee-navy", () => M.tee({ color: G.navy, art: svgs["chest-mark"], placement: "chest", sleeve: svgs["sleeve-white"], label: svgs["neck-label"] })],
    ["sleeve-tee-black", () => M.tee({ color: G.black, art: svgs["chest-mark"], placement: "chest", sleeve: svgs["sleeve-cyan"], label: svgs["neck-label"] })],
    ["speed-of-light-black", front("black", "speed-of-light")],
    ["speed-of-light-navy", front("navy", "speed-of-light")],
    ["level-up-black", front("black", "level-up")],
    ["level-up-pearl", front("pearl", "level-up-ink")],
    ["stardust-navy", front("navy", "stardust")],
    ["stardust-black", front("black", "stardust")],
    ["cap-black", () => M.cap({ color: G.black, art: svgs["cap-mark-3c"] })],
    ["cap-navy", () => M.cap({ color: G.navy, art: svgs["cap-mark-3c"] })],
    ["cap-black-lockup", () => M.cap({ color: G.black, art: svgs["cap-lockup"], aspect: 1050 / 2700, width: 430 })],
    ["cap-black-yeti-patch", () => M.cap({ color: G.black, art: svgs["cap-patch-yeti"], aspect: 1, width: 175 })],
    ["mug-glow-front", () => M.mug({ wrap: svgs["mug-glow"], center: 700 })],
    ["mug-glow-back", () => M.mug({ wrap: svgs["mug-glow"], center: 2000 })],
    ["stickers-sheet", () => M.sheetOnDesk({ sheet: svgs["sticker-sheet-preview"], w: 1650, h: 2550 })],
    ["stickers-laptop", () => M.laptop({ stickers: [L("yeti-circle", 300, 340, -8), L("lockup-dark", 600, 290, 4), L("wordmark-cyan", 640, 560, -5), L("yeti-square", 800, 420, 10), L("q-diecut", 460, 470, 6), L("lockup-navy", 330, 600, 3), L("q-mono", 790, 610, -8), L("wordmark-white", 520, 385, -3)] })],
  ];
}
