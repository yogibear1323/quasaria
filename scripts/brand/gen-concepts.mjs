// Generates the three Quasaria logo concepts (mark, app icon, lockups) as crisp,
// font-independent SVGs in frontend/public/brand/. Wordmarks are converted to
// outlines from Space Grotesk (the app's display face), so they render the same
// everywhere, including inside <img> and in favicons.
//
//   npm i --no-save opentype.js@1   (run inside frontend/)
//   node scripts/brand/gen-concepts.mjs
//
// Then `node scripts/render-brand.mjs [a|b|c]` picks the active concept and
// renders favicons / OG image / previews.
import { createRequire } from "node:module";
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(resolve(root, "frontend/package.json"));
let opentype;
try { opentype = require("opentype.js"); } catch { opentype = createRequire(import.meta.url)(process.env.OPENTYPE_PATH || "opentype.js"); }
const fontDir = resolve(root, "frontend/node_modules/@fontsource/space-grotesk/files");
const font = (w) => opentype.loadSync(resolve(fontDir, `space-grotesk-latin-${w}-normal.woff`));
const out = resolve(root, "frontend/public/brand");
mkdirSync(out, { recursive: true });

// ------------------------------------------------------------------ palette
const P = {
  violetHi: "#C4B5FD", violet: "#7C5CFF", indigo: "#5B6CFF", cyan: "#22D3EE", cyanHi: "#A5F3FC",
  white: "#FFFFFF", ink: "#0B0D1A", night: "#070912", night2: "#12152B",
};
const r = (n) => Math.round(n * 100) / 100;

// ------------------------------------------------------------------ wordmark
/** Lay out text as a single SVG path. Returns { d, width }. */
function textPath(f, text, size, x, y, tracking = 0, swap = {}) {
  const scale = size / f.unitsPerEm;
  let pen = x, d = "", prev = null;
  const glyphPos = [];
  for (const ch of text) {
    const g = f.charToGlyph(swap[ch] ?? ch);
    if (prev) pen += f.getKerningValue(prev, g) * scale;
    d += g.getPath(pen, y, size).toPathData(2);
    glyphPos.push({ ch, x: pen, adv: g.advanceWidth * scale, g });
    pen += g.advanceWidth * scale + tracking * size;
    prev = g;
  }
  return { d, width: pen - tracking * size - x, glyphPos };
}

// ------------------------------------------------------------------ shared bits
/** 4-point sparkle centred on (cx, cy) with outer radius R. */
const sparkle = (cx, cy, R, k = 0.22) => {
  const i = R * k;
  return `M${r(cx)} ${r(cy - R)}Q${r(cx + i)} ${r(cy - i)} ${r(cx + R)} ${r(cy)}Q${r(cx + i)} ${r(cy + i)} ${r(cx)} ${r(cy + R)}Q${r(cx - i)} ${r(cy + i)} ${r(cx - R)} ${r(cy)}Q${r(cx - i)} ${r(cy - i)} ${r(cx)} ${r(cy - R)}Z`;
};
/** Tapered beam from (x0,y0) (half-width w0) to (x1,y1) (half-width w1). */
const beam = (x0, y0, x1, y1, w0, w1) => {
  const L = Math.hypot(x1 - x0, y1 - y0), px = -(y1 - y0) / L, py = (x1 - x0) / L;
  return `M${r(x0 + px * w0)} ${r(y0 + py * w0)}L${r(x1 + px * w1)} ${r(y1 + py * w1)}A${w1} ${w1} 0 0 0 ${r(x1 - px * w1)} ${r(y1 - py * w1)}L${r(x0 - px * w0)} ${r(y0 - py * w0)}Z`;
};

// ------------------------------------------------------------------ Concept A: "Singularity Q"
// The accretion ring is the bowl of a Q; the relativistic jet punching out of the
// bright core is the Q's tail (the ring is cut where the jet crosses, so it stays
// crisp on any background). A faint counter-jet and a glint complete the quasar.
function markA(id = "a", { glint = true } = {}) {
  return `
  <defs>
    <linearGradient id="${id}-ring" x1="10" y1="8" x2="54" y2="56" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="${P.violetHi}"/><stop offset=".42" stop-color="${P.violet}"/><stop offset="1" stop-color="${P.cyan}"/>
    </linearGradient>
    <linearGradient id="${id}-jet" x1="33" y1="33" x2="60" y2="60" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#fff"/><stop offset=".3" stop-color="${P.cyanHi}"/><stop offset=".75" stop-color="${P.cyan}"/><stop offset="1" stop-color="#0EA5E9"/>
    </linearGradient>
    <radialGradient id="${id}-core" cx="32" cy="32" r="5.4" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#fff"/><stop offset=".55" stop-color="#fff"/><stop offset=".8" stop-color="${P.cyanHi}"/><stop offset="1" stop-color="${P.cyan}"/>
    </radialGradient>
    <radialGradient id="${id}-glint" cx="47.2" cy="13.6" r="4.4" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#fff"/><stop offset=".45" stop-color="#fff"/><stop offset="1" stop-color="${P.cyan}"/>
    </radialGradient>
    <linearGradient id="${id}-cjet" x1="31" y1="31" x2="18" y2="18" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="${P.cyanHi}" stop-opacity=".95"/><stop offset="1" stop-color="${P.violet}" stop-opacity="0"/>
    </linearGradient>
    <radialGradient id="${id}-halo" cx="32" cy="32" r="12" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="${P.cyanHi}" stop-opacity=".95"/><stop offset=".45" stop-color="${P.cyan}" stop-opacity=".45"/><stop offset="1" stop-color="${P.violet}" stop-opacity="0"/>
    </radialGradient>
    <mask id="${id}-cut" maskUnits="userSpaceOnUse" x="0" y="0" width="64" height="64">
      <rect width="64" height="64" fill="#fff"/>
      <path d="${beam(32, 32, 62, 62, 5.4, 4.2)}" fill="#000"/>
    </mask>
  </defs>
  <circle cx="32" cy="32" r="19.5" fill="none" stroke="url(#${id}-ring)" stroke-width="6.5" mask="url(#${id}-cut)"/>
  <path d="${beam(31, 31, 19.5, 19.5, 1.9, 0.5)}" fill="url(#${id}-cjet)"/>
  <circle cx="32" cy="32" r="12" fill="url(#${id}-halo)"/>
  <path d="${beam(33, 33, 58.5, 58.5, 2.9, 1.5)}" fill="url(#${id}-jet)"/>
  <circle cx="32" cy="32" r="5.4" fill="url(#${id}-core)"/>
  ${glint ? `<path d="${sparkle(47.2, 13.6, 4.4)}" fill="url(#${id}-glint)"/>` : ""}`;
}

// ------------------------------------------------------------------ Concept B: "Beacon"
// A tilted accretion disk wrapped around a star-bright core, with bipolar jets
// firing perpendicular to the disk. The front half of the disk passes over the
// core, giving depth. The most "cosmic" of the three.
function markB(id = "b") {
  const rx = 25, ry = 8.2, sw = 4.4;
  return `
  <defs>
    <linearGradient id="${id}-disk" x1="7" y1="32" x2="57" y2="32" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="${P.violet}"/><stop offset=".55" stop-color="${P.indigo}"/><stop offset="1" stop-color="${P.cyan}"/>
    </linearGradient>
    <linearGradient id="${id}-jetU" x1="32" y1="30" x2="32" y2="2" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#fff"/><stop offset=".35" stop-color="${P.cyanHi}"/><stop offset="1" stop-color="${P.cyan}" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="${id}-jetD" x1="32" y1="34" x2="32" y2="62" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#fff"/><stop offset=".35" stop-color="${P.violetHi}"/><stop offset="1" stop-color="${P.violet}" stop-opacity="0"/>
    </linearGradient>
    <radialGradient id="${id}-core" cx="32" cy="32" r="3.6" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#fff"/><stop offset=".5" stop-color="#fff"/><stop offset="1" stop-color="${P.cyanHi}"/>
    </radialGradient>
    <radialGradient id="${id}-halo" cx="32" cy="32" r="15" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#fff" stop-opacity=".9"/><stop offset=".3" stop-color="${P.cyan}" stop-opacity=".5"/><stop offset="1" stop-color="${P.violet}" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <g transform="rotate(-24 32 32)">
    <path d="M${32 - rx} 32A${rx} ${ry} 0 0 1 ${32 + rx} 32" fill="none" stroke="url(#${id}-disk)" stroke-width="${sw}" stroke-linecap="round" opacity=".7"/>
    <path d="${beam(32, 30, 32, 1.5, 2.6, 0.6)}" fill="url(#${id}-jetU)"/>
    <path d="${beam(32, 34, 32, 62.5, 2.6, 0.6)}" fill="url(#${id}-jetD)"/>
    <circle cx="32" cy="32" r="15" fill="url(#${id}-halo)"/>
    <path d="${sparkle(32, 32, 10.5, 0.2)}" fill="#fff"/>
    <circle cx="32" cy="32" r="3.6" fill="url(#${id}-core)"/>
    <path d="M${32 - rx} 32A${rx} ${ry} 0 0 0 ${32 + rx} 32" fill="none" stroke="url(#${id}-disk)" stroke-width="${sw}" stroke-linecap="round"/>
  </g>`;
}

// ------------------------------------------------------------------ Concept C: "Orbit Badge"
// A solid gradient squircle with a bold white monoline Q: the tail is a jet
// leaving a sparkle core. Built for maximum legibility at 16px and on light
// backgrounds (app stores, social avatars).
function markC(id = "c") {
  return `
  <defs>
    <linearGradient id="${id}-bg" x1="4" y1="2" x2="60" y2="62" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#9B7BFF"/><stop offset=".5" stop-color="${P.indigo}"/><stop offset="1" stop-color="${P.cyan}"/>
    </linearGradient>
    <linearGradient id="${id}-shine" x1="32" y1="2" x2="32" y2="34" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#fff" stop-opacity=".28"/><stop offset="1" stop-color="#fff" stop-opacity="0"/>
    </linearGradient>
    <mask id="${id}-cut" maskUnits="userSpaceOnUse" x="0" y="0" width="64" height="64">
      <rect width="64" height="64" fill="#fff"/>
      <path d="${beam(33.5, 46, 58, 46, 6.2, 6.2)}" fill="#000"/>
    </mask>
  </defs>
  <rect x="2" y="2" width="60" height="60" rx="17" fill="url(#${id}-bg)"/>
  <rect x="2" y="2" width="60" height="30" rx="17" fill="url(#${id}-shine)"/>
  <rect x="2.5" y="2.5" width="59" height="59" rx="16.5" fill="none" stroke="#fff" stroke-opacity=".22"/>
  <circle cx="32" cy="30" r="15.5" fill="none" stroke="#fff" stroke-width="6" mask="url(#${id}-cut)"/>
  <path d="${beam(32, 42.5, 49.5, 42.5, 3, 3)}" fill="#fff"/>
  <path d="${sparkle(32, 30, 6.8, 0.2)}" fill="#fff"/>`;
}

// ------------------------------------------------------------------ wrappers
const svg = (vb, body, title, desc) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" role="img" aria-labelledby="t d">\n  <title id="t">${title}</title>\n  <desc id="d">${desc}</desc>${body}\n</svg>\n`;

/** App icon: the mark on a dark rounded square (favicon / apple-touch / PWA). */
function icon(markBody, { bleed = false } = {}) {
  const bg = `
  <defs>
    <radialGradient id="ic-bg" cx="32" cy="24" r="44" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="${P.night2}"/><stop offset="1" stop-color="${P.night}"/>
    </radialGradient>
  </defs>
  <rect width="64" height="64" rx="${bleed ? 0 : 14}" fill="url(#ic-bg)"/>
  <rect x=".5" y=".5" width="63" height="63" rx="${bleed ? 0 : 13.5}" fill="none" stroke="#fff" stroke-opacity=".08"/>`;
  return bg + `\n  <g transform="translate(3.5 3.5) scale(.890625)">${markBody}\n  </g>`;
}

const CONCEPTS = {
  a: {
    name: "Singularity Q",
    desc: "Quasaria mark: an accretion ring forms the bowl of a Q and a relativistic jet from the bright core forms its tail.",
    mark: () => markA("a"),
    small: () => markA("af", { glint: false }),
    word: (dark) => {
      const f = font(700);
      const t = textPath(f, "Quasaria", 38, 80, 45.5, -0.012);
      return { body: `<path d="${t.d}" fill="${dark ? "#F4F5FF" : P.ink}"/>`, width: 80 + t.width };
    },
  },
  b: {
    name: "Beacon",
    desc: "Quasaria mark: a star-bright core inside a tilted accretion disk, firing bipolar relativistic jets.",
    mark: () => markB("b"),
    small: () => markB("bf"),
    word: (dark) => {
      const f = font(500);
      const t = textPath(f, "QUASARIA", 29, 80, 42.2, 0.2);
      const grad = `<defs><linearGradient id="bw" x1="80" y1="0" x2="${r(80 + t.width)}" y2="0" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${dark ? "#fff" : P.ink}"/><stop offset=".55" stop-color="${dark ? P.violetHi : "#4B3BD1"}"/><stop offset="1" stop-color="${dark ? P.cyan : "#0891B2"}"/></linearGradient></defs>`;
      return { body: `${grad}<path d="${t.d}" fill="url(#bw)"/>`, width: 80 + t.width };
    },
  },
  c: {
    name: "Orbit Badge",
    desc: "Quasaria mark: a bold white Q on a violet-to-cyan badge; the tail is a jet leaving a sparkle core.",
    mark: () => markC("c"),
    small: () => markC("cf"),
    word: (dark) => {
      const f = font(700);
      const t = textPath(f, "quasaria", 44, 80, 44, -0.02, { i: "\u0131" });
      const gi = t.glyphPos.find((g) => g.ch === "i");
      const m = gi.g.getMetrics(), s = 44 / f.unitsPerEm;
      const cx = gi.x + ((m.xMin + m.xMax) / 2) * s;
      const dot = `<path d="${sparkle(cx, 44 - 30.5, 6.2, 0.2)}" fill="url(#cw)"/>`;
      const grad = `<defs><linearGradient id="cw" x1="${r(cx - 6)}" y1="8" x2="${r(cx + 6)}" y2="20" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#9B7BFF"/><stop offset="1" stop-color="${P.cyan}"/></linearGradient></defs>`;
      return { body: `${grad}<path d="${t.d}" fill="${dark ? "#F4F5FF" : P.ink}"/>${dot}`, width: 80 + t.width };
    },
  },
};

for (const [k, c] of Object.entries(CONCEPTS)) {
  const title = `Quasaria — ${c.name}`;
  writeFileSync(resolve(out, `concept-${k}-mark.svg`), svg("0 0 64 64", c.mark(), title, c.desc));
  writeFileSync(resolve(out, `concept-${k}-icon.svg`), svg("0 0 64 64", k === "c" ? c.small() : icon(c.small()), `${title} (app icon)`, c.desc));
  for (const dark of [true, false]) {
    const w = c.word(dark);
    const W = Math.ceil(w.width + 4);
    const body = `\n  <g>${c.mark().replaceAll(`id="${k}-`, `id="${k}l-`).replaceAll(`#${k}-`, `#${k}l-`)}\n  </g>\n  ${w.body}`;
    writeFileSync(resolve(out, `concept-${k}-lockup-${dark ? "dark" : "light"}.svg`), svg(`0 0 ${W} 64`, body, title, `${c.desc} With the Quasaria wordmark, for ${dark ? "dark" : "light"} backgrounds.`));
  }
  console.log("concept", k, c.name);
}
