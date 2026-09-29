// Shared helpers for the Quasaria merch generator: outlined text (Space Grotesk
// via opentype.js), the Singularity Q mark (full-colour + flat/embroidery),
// rank icons, a 5x7 pixel font, starfields and die-cut sticker shapes.
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

export const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(import.meta.url);
let opentype;
try { opentype = require("opentype.js"); } catch { opentype = createRequire(import.meta.url)(process.env.OPENTYPE_PATH || "opentype.js"); }
const fontDir = resolve(root, "frontend/node_modules/@fontsource/space-grotesk/files");
const FONTS = {};
const font = (w) => (FONTS[w] ??= opentype.loadSync(resolve(fontDir, `space-grotesk-latin-${w}-normal.woff`)));

export const C = {
  base: "#06070d", ink: "#0b0d18", violet: "#7C5CFF", violetDeep: "#4f46e5", lilac: "#C4B5FD",
  cyan: "#22D3EE", ice: "#A5F3FC", white: "#ffffff", gold: "#FDE047", pink: "#F472B6", warm: "#FDE68A",
};
export const r2 = (n) => Math.round(n * 100) / 100;

// ------------------------------------------------------------------ text → path
function layout(f, text, size, x, y, tracking) {
  const scale = size / f.unitsPerEm;
  let pen = x, d = "", prev = null;
  for (const ch of text) {
    const g = f.charToGlyph(ch);
    if (g.index === 0 && ch !== " ") console.warn(`[merch] missing glyph "${ch}" in Space Grotesk`);
    if (prev) pen += f.getKerningValue(prev, g) * scale;
    d += g.getPath(pen, y, size).toPathData(2);
    pen += g.advanceWidth * scale + tracking * size;
    prev = g;
  }
  return { d, width: pen - tracking * size - x };
}
export const measure = (str, { w = 700, size, tracking = 0 }) => layout(font(w), str, size, 0, 0, tracking).width;
/** Outlined text. anchor: start | middle | end. */
export function text(str, { w = 700, size, x, y, anchor = "middle", tracking = 0, fill = "#fff", attrs = "" }) {
  const width = measure(str, { w, size, tracking });
  const x0 = anchor === "middle" ? x - width / 2 : anchor === "end" ? x - width : x;
  return `<path d="${layout(font(w), str, size, x0, y, tracking).d}" fill="${fill}" ${attrs}/>`;
}
/** Font size at which `str` is exactly `width` wide. */
export const fit = (str, width, o = {}) => (width / measure(str, { ...o, size: 1000 })) * 1000;

// ------------------------------------------------------------------ mark
const markSrc = readFileSync(resolve(root, "frontend/public/brand/concept-a-mark.svg"), "utf8");
const markInner = markSrc.replace(/^[\s\S]*?<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "").replace(/<title[\s\S]*?<\/title>|<desc[\s\S]*?<\/desc>/g, "");
/** Full-colour Singularity Q, `size` px square with top-left at (x, y). */
export function mark(x, y, size, p = "m") {
  const inner = markInner.replace(/id="a-/g, `id="${p}-`).replace(/url\(#a-/g, `url(#${p}-`);
  return `<svg x="${r2(x)}" y="${r2(y)}" width="${r2(size)}" height="${r2(size)}" viewBox="0 0 64 64" overflow="visible">${inner}</svg>`;
}
const pt = (a, rad) => [r2(32 + rad * Math.cos((a * Math.PI) / 180)), r2(32 + rad * Math.sin((a * Math.PI) / 180))];
/** Flat, embroidery-friendly Singularity Q on a 64 grid: solid fills only, no hairlines. */
export function flatMarkInner({ ring = C.violet, tail = C.cyan, core = "#fff", glint = C.cyan, ringW = 7, tailW = 5 } = {}) {
  const [ax, ay] = pt(61, 19.5), [bx, by] = pt(29, 19.5);
  return `<path d="M${ax} ${ay}A19.5 19.5 0 1 1 ${bx} ${by}" fill="none" stroke="${ring}" stroke-width="${ringW}"/>` +
    `<path d="M34 34L57.5 57.5" stroke="${tail}" stroke-width="${tailW}" stroke-linecap="round"/>` +
    `<circle cx="32" cy="32" r="6.4" fill="${core}"/>` +
    (glint ? `<path d="M47.2 7.8L49.1 11.7L53 13.6L49.1 15.5L47.2 19.4L45.3 15.5L41.4 13.6L45.3 11.7Z" fill="${glint}"/>` : "");
}
export const flatMark = (x, y, size, o) => `<svg x="${r2(x)}" y="${r2(y)}" width="${r2(size)}" height="${r2(size)}" viewBox="0 0 64 64" overflow="visible">${flatMarkInner(o)}</svg>`;

// ------------------------------------------------------------------ shapes
export const sparkle = (cx, cy, R, k = 0.2) => {
  const q = R * k;
  return `M${r2(cx)} ${r2(cy - R)}Q${r2(cx + q)} ${r2(cy - q)} ${r2(cx + R)} ${r2(cy)}Q${r2(cx + q)} ${r2(cy + q)} ${r2(cx)} ${r2(cy + R)}Q${r2(cx - q)} ${r2(cy + q)} ${r2(cx - R)} ${r2(cy)}Q${r2(cx - q)} ${r2(cy - q)} ${r2(cx)} ${r2(cy - R)}Z`;
};
export const hexPts = (cx, cy, R) => [...Array(6)].map((_, i) => { const a = ((-90 + 60 * i) * Math.PI) / 180; return [cx + R * Math.cos(a), cy + R * Math.sin(a)]; });
export const hexPath = (cx, cy, R) => "M" + hexPts(cx, cy, R).map(([x, y]) => `${r2(x)} ${r2(y)}`).join("L") + "Z";
/** Pointy-top hexagon with apothem `a` and rounded corners `rc`, centred at 0,0. */
export function roundedHex(a, rc) {
  const R = a / Math.cos(Math.PI / 6), t = rc * Math.tan(Math.PI / 6);
  const V = hexPts(0, 0, R);
  let d = "";
  V.forEach((v, i) => {
    const prev = V[(i + 5) % 6], next = V[(i + 1) % 6];
    const lp = (p) => { const dx = p[0] - v[0], dy = p[1] - v[1], l = Math.hypot(dx, dy); return [v[0] + (dx / l) * t, v[1] + (dy / l) * t]; };
    const a1 = lp(prev), a2 = lp(next);
    d += `${i ? "L" : "M"}${r2(a1[0])} ${r2(a1[1])}A${r2(rc)} ${r2(rc)} 0 0 1 ${r2(a2[0])} ${r2(a2[1])}`;
  });
  return d + "Z";
}
/** Die-cut shape outline offset outward by d (exact for these primitives). */
export function shapePath(s, d = 0) {
  if (s.type === "circle") { const r = s.r + d; return `M${-r} 0a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0Z`; }
  if (s.type === "hex") return roundedHex(s.a + d, s.rc + d);
  const w = s.w + 2 * d, h = s.h + 2 * d, rx = Math.min(s.rx + d, h / 2, w / 2);
  return `M${-w / 2 + rx} ${-h / 2}H${w / 2 - rx}A${rx} ${rx} 0 0 1 ${w / 2} ${-h / 2 + rx}V${h / 2 - rx}A${rx} ${rx} 0 0 1 ${w / 2 - rx} ${h / 2}H${-w / 2 + rx}A${rx} ${rx} 0 0 1 ${-w / 2} ${h / 2 - rx}V${-h / 2 + rx}A${rx} ${rx} 0 0 1 ${-w / 2 + rx} ${-h / 2}Z`;
}
export const shapeBox = (s) => (s.type === "circle" ? [2 * s.r, 2 * s.r] : s.type === "hex" ? [2 * s.a, (2 * s.a) / Math.cos(Math.PI / 6)] : [s.w, s.h]);

// ------------------------------------------------------------------ stars
export function rng(seed) { let s = seed % 2147483647; if (s <= 0) s += 2147483646; return () => (s = (s * 16807) % 2147483647) / 2147483647; }
/** Scatter n stars in rect [x,y,w,h]; `keep(x,y)` can veto positions. */
export function stars(n, [x, y, w, h], { seed = 1, min = 2, max = 9, keep = () => true, colors = ["#fff", "#fff", C.lilac, C.ice], sparkles = 0.04 } = {}) {
  const R = rng(seed); let out = "";
  for (let i = 0; i < n; i++) {
    const sx = x + R() * w, sy = y + R() * h;
    if (!keep(sx, sy)) continue;
    const s = min + Math.pow(R(), 3) * (max - min), c = colors[Math.floor(R() * colors.length)], o = r2(0.45 + R() * 0.55);
    out += R() < sparkles ? `<path d="${sparkle(sx, sy, s * 3.2)}" fill="${c}" opacity="${o}"/>` : `<circle cx="${r2(sx)}" cy="${r2(sy)}" r="${r2(s)}" fill="${c}" opacity="${o}"/>`;
  }
  return out;
}

// ------------------------------------------------------------------ ranks & badge glyphs (48 grid, white)
export const RANKS = [
  { name: "Stardust", levels: "1–2", grad: ["#e2e8f0", "#64748b"], icon: "stardust" },
  { name: "Comet", levels: "3–4", grad: ["#67e8f9", "#0891b2"], icon: "comet" },
  { name: "Nova", levels: "5–6", grad: ["#fde68a", "#d97706"], icon: "nova" },
  { name: "Pulsar", levels: "7–8", grad: ["#f9a8d4", "#db2777"], icon: "pulsar" },
  { name: "Quasar", levels: "9–10", grad: ["#a78bfa", "#0891b2"], icon: "quasar" },
];
export const GLYPH = {
  stardust: `<g fill="#fff" stroke="none"><circle cx="19" cy="20" r="2.6"/><circle cx="28" cy="15.5" r="1.7"/><circle cx="31" cy="26" r="3"/><circle cx="20.5" cy="30.5" r="2"/><circle cx="26" cy="34" r="1.4"/><circle cx="35" cy="33" r="1.6"/><path d="${sparkle(14.5, 34, 3.4)}"/></g>`,
  comet: `<g fill="#fff" stroke="none"><path d="M27.2 14.6Q19 23.5 12.5 36Q24.5 29.5 33.4 20.8Z" opacity=".75"/><circle cx="31" cy="17.5" r="4.6"/></g>`,
  nova: `<circle cx="24" cy="24" r="4" fill="#fff"/><path d="M24 11v6M24 31v6M11 24h6M31 24h6M15 15l4 4M29 29l4 4M33 15l-4 4M19 29l-4 4"/>`,
  pulsar: `<g transform="rotate(22 24 24)"><path d="M24 24L21 9h6zM24 24l-3 15h6z" fill="#fff" stroke="none" opacity=".9"/><ellipse cx="24" cy="24" rx="10" ry="3.6"/></g><circle cx="24" cy="24" r="3.6" fill="#fff" stroke="none"/>`,
  quasar: `<svg x="9" y="9" width="30" height="30" viewBox="0 0 64 64">${flatMarkInner({ ring: "#fff", tail: "#fff", core: "#fff", glint: "#fff", ringW: 7.5, tailW: 6 })}</svg>`,
  spark: `<path d="M24 12q1.6 8.4 10 12-8.4 1.6-10 12-1.6-10.4-10-12 8.4-3.6 10-12z" fill="#fff" stroke="none"/>`,
  compass: `<circle cx="24" cy="24" r="10"/><path d="M28.5 19.5 26 26l-6.5 2.5L22 22z" fill="#fff"/>`,
  shield: `<path d="M24 13l9 3.5v6.5c0 5.6-3.8 10-9 12-5.2-2-9-6.4-9-12v-6.5z"/><path d="m19.5 24 3.2 3.2 6-6.2"/>`,
  abacus: `<rect x="14" y="14" width="20" height="20" rx="4"/><path d="M19 20h10M19 24h4M27 24h2M19 28h10"/>`,
  gauge: `<path d="M14.5 29a10 10 0 1 1 19 0"/><path d="m24 27 5-7"/><circle cx="24" cy="27" r="1.6" fill="#fff"/>`,
  flame: `<path d="M24 12.5c1 4.5 7.5 7.4 7.5 13.5a7.5 7.5 0 0 1-15 0c0-3 1.6-5 3.4-6.4.2 2.2 1.2 3.6 2.6 4.1-.6-4.6 0-8.2 1.5-11.2z"/>`,
  bolt: `<path d="M26.5 12 17 26h7l-2.5 10L31 22h-7z" fill="#fff" stroke="none"/>`,
};
export const HUES = { violet: ["#a78bfa", "#6d4aff"], cyan: ["#67e8f9", "#0891b2"], gold: ["#fde68a", "#d97706"], green: ["#6ee7b7", "#059669"], rose: ["#fda4af", "#e11d48"] };
/** Glyph from GLYPH drawn in a 48 grid, centred on (cx, cy) at `scale`. */
export const glyph = (name, cx, cy, scale, sw = 2) => `<g transform="translate(${r2(cx - 24 * scale)} ${r2(cy - 24 * scale)}) scale(${scale})" fill="none" stroke="#fff" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">${GLYPH[name]}</g>`;
/** Game-style hex badge (48 grid) centred on (cx, cy). */
export function hexBadge(p, cx, cy, scale, [a, b], icon) {
  return `<defs><linearGradient id="${p}" x1="8" y1="4" x2="40" y2="44" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient><linearGradient id="${p}s" x1="24" y1="3" x2="24" y2="24" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#fff" stop-opacity=".38"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient></defs>` +
    `<g transform="translate(${r2(cx - 24 * scale)} ${r2(cy - 24 * scale)}) scale(${scale})"><path d="M24 2.5 42.6 13.25v21.5L24 45.5 5.4 34.75v-21.5z" fill="url(#${p})" stroke="rgba(255,255,255,.4)" stroke-width="1"/><path d="M24 2.5 42.6 13.25V24H5.4V13.25z" fill="url(#${p}s)"/>` +
    `<g fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${GLYPH[icon]}</g></g>`;
}

// ------------------------------------------------------------------ 5x7 pixel font (original)
const PX = {
  A: "01110 10001 10001 11111 10001 10001 10001", B: "11110 10001 10001 11110 10001 10001 11110", C: "01111 10000 10000 10000 10000 10000 01111",
  D: "11110 10001 10001 10001 10001 10001 11110", E: "11111 10000 10000 11110 10000 10000 11111", F: "11111 10000 10000 11110 10000 10000 10000",
  G: "01111 10000 10000 10011 10001 10001 01111", H: "10001 10001 10001 11111 10001 10001 10001", I: "11111 00100 00100 00100 00100 00100 11111",
  J: "00111 00010 00010 00010 00010 10010 01100", K: "10001 10010 10100 11000 10100 10010 10001", L: "10000 10000 10000 10000 10000 10000 11111",
  M: "10001 11011 10101 10101 10001 10001 10001", N: "10001 11001 10101 10011 10001 10001 10001", O: "01110 10001 10001 10001 10001 10001 01110",
  P: "11110 10001 10001 11110 10000 10000 10000", Q: "01110 10001 10001 10001 10101 10010 01101", R: "11110 10001 10001 11110 10100 10010 10001",
  S: "01111 10000 10000 01110 00001 00001 11110", T: "11111 00100 00100 00100 00100 00100 00100", U: "10001 10001 10001 10001 10001 10001 01110",
  V: "10001 10001 10001 10001 10001 01010 00100", W: "10001 10001 10001 10101 10101 10101 01010", X: "10001 10001 01010 00100 01010 10001 10001",
  Y: "10001 10001 01010 00100 00100 00100 00100", Z: "11111 00001 00010 00100 01000 10000 11111",
  0: "01110 10001 10011 10101 11001 10001 01110", 1: "00100 01100 00100 00100 00100 00100 01110", 2: "01110 10001 00001 00010 00100 01000 11111",
  3: "11110 00001 00001 01110 00001 00001 11110", 4: "00010 00110 01010 10010 11111 00010 00010", 5: "11111 10000 11110 00001 00001 10001 01110",
  6: "00110 01000 10000 11110 10001 10001 01110", 7: "11111 00001 00010 00100 01000 01000 01000", 8: "01110 10001 10001 01110 10001 10001 01110",
  9: "01110 10001 10001 01111 00001 00010 01100", ":": "00000 01100 01100 00000 01100 01100 00000", "!": "00100 00100 00100 00100 00100 00000 00100",
  "-": "00000 00000 00000 11111 00000 00000 00000", ".": "00000 00000 00000 00000 00000 01100 01100", ">": "01000 00100 00010 00001 00010 00100 01000",
  "<": "00010 00100 01000 10000 01000 00100 00010", "/": "00001 00010 00010 00100 01000 01000 10000", "+": "00000 00100 00100 11111 00100 00100 00000",
  "'": "00100 00100 01000 00000 00000 00000 00000", " ": "00000 00000 00000 00000 00000 00000 00000",
};
export const pixelWidth = (str, px) => (str.length * 6 - 1) * px;
/** Pixel text as one path; (x, y) = top-left unless anchor=middle (x = centre). */
export function pixelText(str, { x, y, px, fill = "#fff", anchor = "middle", attrs = "" }) {
  const x0 = anchor === "middle" ? x - pixelWidth(str, px) / 2 : anchor === "end" ? x - pixelWidth(str, px) : x;
  let d = "";
  [...str.toUpperCase()].forEach((ch, i) => {
    const rows = (PX[ch] ?? PX[" "]).split(" ");
    rows.forEach((row, ry) => [...row].forEach((b, rx) => { if (b === "1") d += `M${r2(x0 + (i * 6 + rx) * px)} ${r2(y + ry * px)}h${px}v${px}h${-px}z`; }));
  });
  return `<path d="${d}" fill="${fill}" shape-rendering="crispEdges" ${attrs}/>`;
}
/** Pixel-art Singularity Q on an N×N grid, returns { svg } drawn at (x, y) with cell `px`. */
export function pixelQ(x, y, px, N = 22) {
  const c = N / 2, groups = {};
  const add = (col, i, j) => ((groups[col] ??= "") , (groups[col] += `M${r2(x + i * px)} ${r2(y + j * px)}h${px}v${px}h${-px}z`));
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const dx = i + 0.5 - c, dy = j + 0.5 - c, d = Math.hypot(dx, dy), ang = (Math.atan2(dy, dx) * 180) / Math.PI;
    const t = (dx + dy) / Math.SQRT2, perp = Math.abs(dx - dy) / Math.SQRT2;
    if (d < 2.3) add("#ffffff", i, j);
    else if (d < 3.3) add(C.ice, i, j);
    else if (perp < 0.8 && t > 2.5 && t < c * Math.SQRT2 - 0.2) add(t < 7.5 ? "#ffffff" : t < 11 ? C.ice : C.cyan, i, j);
    else if (d > c * 0.56 && d < c * 0.92 && Math.abs(ang - 45) > 12) { const p = (dx + dy) / (2 * c * 0.9); add(p < -0.3 ? C.lilac : p < 0.3 ? C.violet : C.cyan, i, j); }
  }
  // glint: pixel sparkle top-right
  const gx = N - 3, gy = 2;
  for (const [i, j] of [[0, 0], [0, -1], [0, 1], [-1, 0], [1, 0], [0, -2], [0, 2], [-2, 0], [2, 0]]) add("#ffffff", gx + i, gy + j);
  return Object.entries(groups).map(([col, d]) => `<path d="${d}" fill="${col}" shape-rendering="crispEdges"/>`).join("");
}
export const pixelPlus = (x, y, px, fill) => `<path d="M${x} ${y - px}h${px}v${px}h${px}v${px}h${-px}v${px}h${-px}v${-px}h${-px}v${-px}h${px}z" fill="${fill}" shape-rendering="crispEdges"/>`;

export const svgDoc = (w, h, body, { title = "", desc = "" } = {}) =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">\n<title>${title}</title>\n<desc>${desc} — Original artwork © Quasaria. Text is outlined; no fonts required.</desc>\n${body}\n</svg>\n`;
