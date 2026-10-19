// Quasaria merch line — v4 "Glow": minimal, premium, logo-led. The full-colour glowing
// Singularity Q is the hero, paired with the exact brand wordmark; strategic placements
// (big centre chest, small left chest, sleeve, vertical placket, neck label) and very little
// else. Palette (frost): the silver / ice-blue glowing Q on midnight-navy, slate and glacier-white
// garments; glacier white carries the deep-ink (navy) variants of the Q and type.
// All artwork is original; the only brand assets used are our own Q mark and wordmark.
import { r2, text, fit, mark, flatMark, sparkle, glyph, shapePath, shapeBox, svgDoc, V2, holo, blur,
  wordmark, wordmarkC, wordmarkH, glowMark } from "./lib.mjs";

const W = 4500, H = 5400; // 15 × 18 in @ 300 DPI (DTG full front / back)
const LS = 0.32; // letter-spacing for the small caps lines

/** Small, widely-tracked caption (Space Grotesk 500). */
const caption = (s, cx, y, size, fill = V2.text2) => text(s, { w: 500, size, x: cx, y, tracking: LS, fill });

// ------------------------------------------------------------------ core placements
/** Big centre-chest lockup: glowing Q over the wordmark (hoodie, 12 × 14 in). */
function glowLockup() {
  const w = 3600, h = 4200, s = 2500;
  return svgDoc(w, h, `${glowMark((w - s) / 2, 120, s, "gl")}${wordmarkC(w / 2, 3560, 2900, "#fff")}`,
    { title: "Quasaria — Glow lockup, centre chest (12 × 14 in @ 300 DPI)", desc: "Full-colour glowing Singularity Q over the Quasaria wordmark" });
}
/** Small full-colour left-chest Q (4 × 4 in). */
const chestMark = () => svgDoc(1200, 1200, glowMark(150, 150, 900, "cm", { halo: 0.6, bloom: 0.5 }), { title: "Quasaria — left-chest Q (4 × 4 in @ 300 DPI)", desc: "Full-colour Singularity Q with a soft glow" });
/** Deep-ink left-chest Q for light garments (glacier white). */
const chestMarkInk = () => svgDoc(1200, 1200, glowMark(150, 150, 900, "cmi", { halo: 0.6, bloom: 0.5, ink: true }), { title: "Quasaria — left-chest Q, deep ink (4 × 4 in @ 300 DPI)", desc: "Navy-ink Singularity Q for light garments" });
/** Sleeve wordmark (4 × 1.2 in): cyan on dark / light garments alike. */
const sleeveWordmark = (fill, tag) => () => svgDoc(1200, 360, wordmarkC(600, 180, 1080, fill), { title: `Quasaria — sleeve wordmark, ${tag} (4 × 1.2 in @ 300 DPI)`, desc: "Exact brand wordmark for the upper sleeve" });
/** Woven / printed neck label (2 × 0.75 in): white wordmark on black. */
const neckLabel = () => svgDoc(600, 225, `<rect width="600" height="225" rx="16" fill="#0F1830"/>${wordmarkC(300, 112, 420, "#fff")}`, { title: "Quasaria — neck label (2 × 0.75 in @ 300 DPI)", desc: "Woven label: white wordmark on black. For inside-label printing, use only the wordmark" });
/** Large back print: big glowing Q + small wordmark (black tee). */
function backGlow() {
  const s = 2900;
  return svgDoc(W, H, `${glowMark((W - s) / 2, 500, s, "bg")}${wordmarkC(W / 2, 3900, 1500, "#fff")}${caption("SINGULARITY SERIES", W / 2, 4250, 90)}`,
    { title: "Quasaria — back glow print (15 × 18 in @ 300 DPI)", desc: "Large glowing Singularity Q, small wordmark" });
}

// ------------------------------------------------------------------ the three text designs, simplified
/** Speed of Light: the Q with a single light streak through its core. */
function speedOfLight() {
  const s = 2200, x = (W - s) / 2, y = 900, cy = y + s / 2;
  const body = `<defs><linearGradient id="slst" x1="200" y1="0" x2="4300" y2="0" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#8FA6C8" stop-opacity="0"/><stop offset=".3" stop-color="#8FA6C8" stop-opacity=".7"/><stop offset=".5" stop-color="#FFFFFF"/><stop offset=".7" stop-color="#BFE3F7" stop-opacity=".7"/><stop offset="1" stop-color="#BFE3F7" stop-opacity="0"/></linearGradient>${blur("slb", 18)}</defs>
<rect x="200" y="${cy - 14}" width="4100" height="28" rx="14" fill="url(#slst)" filter="url(#slb)"/>
<rect x="200" y="${cy - 5}" width="4100" height="10" rx="5" fill="url(#slst)"/>
${glowMark(x, y, s, "sl")}
${caption("TRADE AT THE SPEED OF LIGHT", W / 2, 3700, 120, V2.text)}
${wordmarkC(W / 2, 4060, 900, V2.text2)}`;
  return svgDoc(W, H, body, { title: "Quasaria — Speed of Light (minimal)", desc: "Glowing Q with a single light streak, one line of type" });
}
/** Level Up: the Q inside one thin XP ring, almost full. */
function levelUp(ink = false) {
  const s = 1900, cx = W / 2, cy = 1950, R = 1350, a0 = -90, a1 = -90 + 360 * 0.86;
  const P = (a) => [r2(cx + R * Math.cos((a * Math.PI) / 180)), r2(cy + R * Math.sin((a * Math.PI) / 180))];
  const [sx, sy] = P(a0), [ex, ey] = P(a1);
  const body = `<defs>${holo("luring", cx - R, cy - R, cx + R, cy + R, ink ? { stops: ["#4A6FA5", "#1E3A66", "#16305C"] } : {})}</defs>
<circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="${ink ? "#1E3A66" : "#fff"}" stroke-opacity="${ink ? ".14" : ".10"}" stroke-width="40"/>
<path d="M${sx} ${sy}A${R} ${R} 0 1 1 ${ex} ${ey}" fill="none" stroke="url(#luring)" stroke-width="40" stroke-linecap="round"/>
<circle cx="${ex}" cy="${ey}" r="46" fill="${ink ? "#16305C" : "#fff"}"/>
${glowMark(cx - s / 2, cy - s / 2, s, "lu", { ink })}
${caption("LEVEL UP", cx, 3750, 150, ink ? "#16305C" : V2.text)}
${wordmarkC(cx, 4100, 900, ink ? "#2B4A7C" : V2.text2)}`;
  return svgDoc(W, H, body, { title: `Quasaria — Level Up (minimal${ink ? ", deep ink" : ""})`, desc: "Glowing Q in a single XP ring, one line of type" });
}
/** Stardust to Quasar: five dots growing along an arc into the glowing Q. */
function stardust() {
  const s = 1900, qx = 2250 + 250, qy = 1000, qc = [qx + s / 2 - 250, qy + s / 2];
  const dots = [[700, 3050, 24], [1050, 2800, 38], [1400, 2560, 56], [1740, 2330, 78]].map(([x, y, r], i) =>
    `<circle cx="${x}" cy="${y}" r="${r}" fill="${i < 2 ? V2.text2 : i === 2 ? V2.lilac : V2.ice}"/>`).join("");
  const body = `<path d="M600 3120Q1500 2600 ${qc[0] - 700} ${qc[1] + 450}" fill="none" stroke="#fff" stroke-opacity=".12" stroke-width="10" stroke-dasharray="2 44" stroke-linecap="round"/>
${dots}
${glowMark(qc[0] - s / 2, qy, s, "sq")}
${caption("FROM STARDUST TO QUASAR", W / 2, 3750, 120, V2.text)}
${wordmarkC(W / 2, 4100, 900, V2.text2)}`;
  return svgDoc(W, H, body, { title: "Quasaria — From Stardust to Quasar (minimal)", desc: "Four dots of stardust growing into the glowing Q, one line of type" });
}

// ------------------------------------------------------------------ bomber (embroidery / patch)
/** Chest embroidery lockup: flat 3-thread Q over a white wordmark (4 × 4 in @ 600 DPI). */
const bomberChestEmb = () => svgDoc(2400, 2400, flatMark(450, 150, 1500) + wordmarkC(1200, 2000, 2100, "#fff"), { title: "Quasaria — bomber chest embroidery (4 × 4 in @ 600 DPI)", desc: "Flat Q (silver-blue #8FA6C8, ice blue #BFE3F7, white) + white wordmark: 3 threads, no gradients" });
/** Printed/woven chest patch with the glowing Q (3 × 3.5 in @ 300 DPI, navy patch). */
const bomberPatch = () => svgDoc(900, 1050, `<rect x="6" y="6" width="888" height="1038" rx="60" fill="#1E2D4D" stroke="#4D648F" stroke-width="12"/><rect x="36" y="36" width="828" height="978" rx="40" fill="none" stroke="#fff" stroke-opacity=".18" stroke-width="4" stroke-dasharray="14 12"/>${glowMark(190, 110, 520, "bp", { halo: 0.8 })}${wordmarkC(450, 820, 600, "#fff")}`, { title: "Quasaria — bomber chest patch (3 × 3.5 in @ 300 DPI)", desc: "Woven or sublimated patch: glowing Q + wordmark on navy, merrowed edge" });
/** Vertical placket wordmark, embroidery, 1 white thread (1 × 4 in @ 600 DPI). */
const bomberPlacket = () => svgDoc(600, 2400, `<g transform="translate(300 1200) rotate(-90)">${wordmarkC(0, 0, 2250, "#fff")}</g>`, { title: "Quasaria — vertical placket wordmark (1 × 4 in @ 600 DPI)", desc: "1 white thread, reads bottom-to-top beside the zip" });

// ------------------------------------------------------------------ caps (600 DPI, ≤ 3 threads)
const capMark3 = () => svgDoc(2400, 1050, flatMark(750, 75, 900), { title: "Quasaria — cap embroidery Q, 3 threads", desc: "Flat fills only: silver-blue #8FA6C8, ice blue #BFE3F7, white" });
const capMark1 = () => svgDoc(2400, 1050, flatMark(750, 75, 900, { ring: "#fff", tail: "#fff", core: "#fff", glint: "#fff" }), { title: "Quasaria — cap embroidery Q, 1 thread (white)", desc: "Single-colour variant" });
const capLockup = () => svgDoc(2700, 1050, flatMark(60, 175, 700) + wordmark(860, 525 - wordmarkH(1700) / 2 - 20, 1700, "#fff"), { title: "Quasaria — cap embroidery lockup (4.5 × 1.75 in @ 600 DPI)", desc: "Flat Q + white wordmark, 3 threads" });

// ------------------------------------------------------------------ mug (11 oz wrap, 2700 × 1050)
function mugGlow() {
  const w = 2700, h = 1050;
  return svgDoc(w, h, `<rect width="${w}" height="${h}" fill="#0F1830"/>${glowMark(700 - 330, 190, 660, "mg")}${wordmarkC(2000, 525, 900, "#fff")}`,
    { title: "Quasaria — Glow mug wrap (black 11 oz)", desc: "Side A: glowing Singularity Q; side B: the wordmark" });
}

// ------------------------------------------------------------------ stickers (small sheet, 5.5 × 8.5 in)
const rr = (w, h, rx) => ({ type: "rrect", w, h, rx });
const fill = (s, f) => `<path d="${shapePath(s)}" fill="${f}"/>`;
export const STICKERS = [
  { id: "glow-q", name: "Glow Q (circle)", shape: { type: "circle", r: 280 }, draw: (p) => `${fill({ type: "circle", r: 280 }, "#0F1830")}${glowMark(-215, -215, 430, p)}` },
  { id: "q-diecut", name: "Q die-cut", shape: { type: "circle", r: 220 }, draw: (p) => `${fill({ type: "circle", r: 220 }, "#0F1830")}${mark(-180, -180, 360, p)}` },
  { id: "lockup-dark", name: "Lockup (dark)", shape: rr(1100, 260, 130), draw: (p) => `${fill(rr(1100, 260, 130), "#0F1830")}${mark(-500, -105, 210, p)}${wordmark(-235, -wordmarkH(700) / 2 - 8, 700, "#fff")}` },
  { id: "lockup-navy", name: "Lockup (navy)", shape: rr(1100, 260, 130), draw: (p) => `${fill(rr(1100, 260, 130), "#1E2D4D")}${mark(-500, -105, 210, p)}${wordmark(-235, -wordmarkH(700) / 2 - 8, 700, "#fff")}` },
  { id: "wordmark-white", name: "Wordmark (white)", shape: rr(900, 220, 110), draw: () => `${fill(rr(900, 220, 110), "#F4F8FA")}${wordmarkC(0, -4, 700, "#0F1830")}` },
  { id: "wordmark-cyan", name: "Wordmark (cyan)", shape: rr(900, 220, 110), draw: () => `${fill(rr(900, 220, 110), "#0F1830")}${wordmarkC(0, -4, 700, V2.cyan)}` },
  { id: "q-mono", name: "Q mono white", shape: rr(340, 340, 86), draw: () => `${fill(rr(340, 340, 86), "#1E2D4D")}${flatMark(-120, -120, 240, { ring: "#fff", tail: "#fff", core: "#fff", glint: "#fff" })}` },
  { id: "q-square", name: "Glow Q (square)", shape: rr(340, 340, 86), draw: (p) => `${fill(rr(340, 340, 86), "#0F1830")}${glowMark(-130, -130, 260, p, { halo: 0.9 })}` },
];
export const SHEET_POS = { "glow-q": [470, 390], "q-diecut": [1210, 390], "lockup-dark": [825, 900], "lockup-navy": [825, 1260], "wordmark-white": [825, 1600], "wordmark-cyan": [825, 1920], "q-mono": [470, 2320], "q-square": [1180, 2320] };
export function stickerGroup(st, { cut = true, bleed = 18, border = 30 } = {}) {
  const p = `s-${st.id}`;
  return `<path d="${shapePath(st.shape, border + bleed)}" fill="#fff"/>` + st.draw(p) + (cut ? `<path d="${shapePath(st.shape, border)}" fill="none" stroke="#FF00FF" stroke-width="2" class="cut"/>` : "");
}
export function stickerSvg(st, opts = {}) {
  const pad = 30 + (opts.bleed ?? 18) + 4, [bw, bh] = shapeBox(st.shape), w = Math.ceil(bw + 2 * pad), h = Math.ceil(bh + 2 * pad);
  return { w, h, svg: svgDoc(w, h, `<g transform="translate(${w / 2} ${h / 2})">${stickerGroup(st, opts)}</g>`, { title: `Quasaria sticker — ${st.name}`, desc: `Die-cut sticker at 300 DPI. ${opts.cut === false ? "" : "Magenta (#FF00FF) hairline = CutContour; white border 30 px (2.5 mm) + 18 px bleed."}` }) };
}
export function stickerSheet({ cut, list = STICKERS, pos = SHEET_POS }) {
  const g = list.map((st) => { const [x, y] = pos[st.id]; return `<g transform="translate(${x} ${y})">${stickerGroup(st, { cut, bleed: cut ? 18 : 0 })}</g>`; }).join("\n");
  return svgDoc(1650, 2550, g, { title: `Quasaria logo sticker sheet (5.5 × 8.5 in @ 300 DPI)${cut ? " with cut lines" : ""}`, desc: "8 logo and wordmark stickers" });
}

// ------------------------------------------------------------------ catalogue of print files
export const DESIGNS = [
  { id: "glow-lockup", file: "glow-lockup-center-chest-12x14in", w: 3600, h: 4200, svg: glowLockup, kind: "Hoodie · centre chest (DTG)", garments: "Midnight Navy, Glacier Slate hoodie", note: "The Glow hoodie. Glow uses transparency: DTG with white underbase." },
  { id: "chest-mark", file: "chest-q-left-4x4in", w: 1200, h: 1200, svg: chestMark, kind: "Tee · left chest (DTG)", garments: "Midnight Navy, Glacier Slate", note: "Small full-colour Q; ~3.5 in wide on the garment." },
  { id: "sleeve-cyan", file: "sleeve-wordmark-cyan-4x1.2in", w: 1200, h: 360, svg: sleeveWordmark(V2.cyan, "cyan"), kind: "Tee · sleeve (DTG)", garments: "Midnight Navy", note: "Upper sleeve (wearer's left). Printful max sleeve area 4 × 3.5 in." },
  { id: "sleeve-ink", file: "sleeve-wordmark-ink-4x1.2in", w: 1200, h: 360, svg: sleeveWordmark("#1E3A66", "deep ink"), kind: "Tee · sleeve (DTG)", garments: "Glacier White", note: "Deep-ink alternative for light tees." },
  { id: "sleeve-white", file: "sleeve-wordmark-white-4x1.2in", w: 1200, h: 360, svg: sleeveWordmark("#fff", "white"), kind: "Tee · sleeve (DTG)", garments: "Glacier Slate", note: "White alternative for dark tees." },
  { id: "chest-mark-ink", file: "chest-q-left-4x4in-ink", w: 1200, h: 1200, svg: chestMarkInk, kind: "Tee · left chest (DTG)", garments: "Glacier White", note: "Deep-ink Q for light garments; ~3.5 in wide." },
  { id: "neck-label", file: "neck-label-2x0.75in", w: 600, h: 225, svg: neckLabel, kind: "Inside neck label", garments: "All tees", note: "Woven label art; for printed inside labels use the wordmark only (Printful 'inside label' placement)." },
  { id: "back-glow", file: "back-glow-q-15x18in", w: W, h: H, svg: backGlow, kind: "Tee · full back (DTG)", garments: "Midnight Navy", note: "Pairs with the left-chest Q on the front." },
  { id: "speed-of-light", file: "speed-of-light-minimal-15x18in", w: W, h: H, svg: speedOfLight, kind: "Tee · full front (DTG)", garments: "Midnight Navy, Glacier Slate", note: "Minimal: glowing Q, one light streak, one line of type." },
  { id: "level-up", file: "level-up-minimal-15x18in", w: W, h: H, svg: levelUp, kind: "Tee · full front (DTG)", garments: "Midnight Navy", note: "Minimal: glowing Q in one XP ring." },
  { id: "level-up-ink", file: "level-up-minimal-15x18in-ink", w: W, h: H, svg: () => levelUp(true), kind: "Tee · full front (DTG)", garments: "Glacier White", note: "Deep-ink version of Level Up for light tees." },
  { id: "stardust", file: "stardust-to-quasar-minimal-15x18in", w: W, h: H, svg: stardust, kind: "Tee · full front (DTG)", garments: "Glacier Slate, Midnight Navy", note: "Minimal: four stardust dots growing into the glowing Q." },
  { id: "bomber-chest-emb", file: "bomber-chest-embroidery-4x4in-600dpi", w: 2400, h: 2400, svg: bomberChestEmb, kind: "Bomber · left chest (embroidery)", garments: "Glacier Slate, Midnight Navy bomber", note: "3 threads; Printful left-chest embroidery max 4 × 4 in." },
  { id: "bomber-patch", file: "bomber-chest-patch-3x3.5in", w: 900, h: 1050, svg: bomberPatch, kind: "Bomber · chest patch (woven/sublimated)", garments: "Glacier Slate, Midnight Navy bomber", note: "Alternative to direct embroidery, sewn on the chest pocket." },
  { id: "bomber-placket", file: "bomber-placket-wordmark-vertical-1x4in-600dpi", w: 600, h: 2400, svg: bomberPlacket, kind: "Bomber · vertical placket (embroidery)", garments: "Glacier Slate, Midnight Navy bomber", note: "1 white thread; see README for placement options." },
  { id: "cap-mark-3c", file: "cap-embroidery-q-3color-600dpi", w: 2400, h: 1050, svg: capMark3, kind: "Cap · front (embroidery)", garments: "Midnight Navy, Glacier Slate cap", note: "4 × 1.75 in @ 600 DPI, 3 threads: silver-blue #8FA6C8, ice blue #BFE3F7, white." },
  { id: "cap-mark-1c", file: "cap-embroidery-q-1color-white-600dpi", w: 2400, h: 1050, svg: capMark1, kind: "Cap · front (embroidery)", garments: "Any dark cap", note: "1 thread." },
  { id: "cap-lockup", file: "cap-embroidery-lockup-600dpi", w: 2700, h: 1050, svg: capLockup, kind: "Cap · front (embroidery)", garments: "Midnight Navy, Glacier Slate cap", note: "4.5 × 1.75 in; 3 threads." },
  { id: "mug-glow", file: "mug-11oz-wrap-glow-black", w: 2700, h: 1050, svg: mugGlow, kind: "Mug · 11 oz wrap", garments: "Midnight Navy 11 oz ceramic", note: "Side A centred at x=700, side B at x=2000." },
  { id: "sticker-sheet", file: "sticker-sheet-5.5x8.5in-print-with-cutlines", w: 1650, h: 2550, svg: () => stickerSheet({ cut: true }), kind: "Stickers · sheet", garments: "White vinyl, kiss-cut", note: "Magenta #FF00FF hairlines = CutContour, 18 px bleed." },
  { id: "sticker-sheet-preview", file: "sticker-sheet-5.5x8.5in-preview", w: 1650, h: 2550, svg: () => stickerSheet({ cut: false }), kind: "Stickers · sheet", garments: "—", note: "Preview without cut lines." },
];
export const _unused = { sparkle, glyph, fit };
