// Quasaria merch line — v2 ("2026"): every design as a standalone, print-ready SVG string.
// Liquid-chrome type, holographic violet→cyan→lime→coral gradients, soft grain and glow,
// oversized tight grotesk, asymmetric layouts. All artwork is original; the only brand
// asset used is our own Singularity Q (unchanged). Designs that go on several garment
// colours come in two inks: "dark" (for black) and "light" (for bone / lavender / lime).
import { r2, text, fit, measure, mark, flatMark, sparkle, stars, glyph, shapePath, shapeBox, svgDoc,
  V2, INK, chrome, holo, grain, blur, lean, pill } from "./lib.mjs";

const W = 4500, H = 5400; // 15 × 18 in @ 300 DPI (DTG full front / back)
const CAP = 0.7; // Space Grotesk cap height (em)
const TIGHT = -0.045;
const tone = (t) => INK[t];

/** v2 rank colours (brighter, warmer). */
export const RANKS2 = [
  { name: "Stardust", levels: "1–2", grad: ["#E9E4F7", "#8D86AC"], icon: "stardust" },
  { name: "Comet", levels: "3–4", grad: ["#7CF0FF", "#0EA5C6"], icon: "comet" },
  { name: "Nova", levels: "5–6", grad: ["#FFD166", "#FF8A3D"], icon: "nova" },
  { name: "Pulsar", levels: "7–8", grad: ["#FF9DB0", "#FF5E5B"], icon: "pulsar" },
  { name: "Quasar", levels: "9–10", grad: ["#9B7BFF", "#22D3EE"], icon: "quasar" },
];
const rankChip = (p, cx, cy, R, rk, ring = "") =>
  `<defs><linearGradient id="${p}" x1="${r2(cx - R)}" y1="${r2(cy - R)}" x2="${r2(cx + R)}" y2="${r2(cy + R)}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${rk.grad[0]}"/><stop offset="1" stop-color="${rk.grad[1]}"/></linearGradient>` +
  `<radialGradient id="${p}s" cx="${r2(cx - R * 0.35)}" cy="${r2(cy - R * 0.45)}" r="${r2(R * 1.1)}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#fff" stop-opacity=".55"/><stop offset=".5" stop-color="#fff" stop-opacity="0"/></radialGradient></defs>` +
  (ring ? `<circle cx="${r2(cx)}" cy="${r2(cy)}" r="${r2(R * 1.16)}" fill="none" stroke="${ring}" stroke-width="${r2(R * 0.05)}"/>` : "") +
  `<circle cx="${r2(cx)}" cy="${r2(cy)}" r="${r2(R)}" fill="url(#${p})"/><circle cx="${r2(cx)}" cy="${r2(cy)}" r="${r2(R)}" fill="url(#${p}s)"/>` + glyph(rk.icon, cx, cy, (R * 1.3) / 48, 2.4);

// ------------------------------------------------------------------ tee 01 · "Singularity" minimal chest
function chestArt(t, p) { // 1500-unit box, asymmetric: mark top-left, tight wordmark, micro line
  const k = tone(t), wm = "Quasaria", size = fit(wm, 1260, { tracking: TIGHT });
  return `${mark(95, 150, 600, p)}
${text("N°01", { w: 500, size: 64, x: 1380, y: 260, anchor: "end", tracking: 0.12, fill: k.fg2, fam: "mono" })}
<path d="${sparkle(1350, 420, 46, 0.12)}" fill="${k.warm}"/>
${text(wm, { size, x: 120, y: 1135, anchor: "start", tracking: TIGHT, fill: k.fg })}
${text("SINGULARITY SERIES", { w: 500, size: 62, x: 128, y: 1290, anchor: "start", tracking: 0.2, fill: k.warm, fam: "mono" })}
${text("— 26", { w: 500, size: 62, x: 1380, y: 1290, anchor: "end", tracking: 0.2, fill: k.fg2, fam: "mono" })}`;
}
const tee01Chest = (t) => () => svgDoc(1500, 1500, chestArt(t, `c1${t}`), { title: `Quasaria — Singularity chest print v2 (${t} garments, left chest 5×5 in)`, desc: "Singularity Q, tight wordmark, micro type" });
const tee01Front = (t) => () => svgDoc(W, H, `<g transform="translate(2500 600) scale(${1200 / 1500})">${chestArt(t, `c1f${t}`)}</g>`, { title: `Quasaria — Singularity chest print v2 on full-front canvas (${t} garments)`, desc: "Same art positioned at the wearer's left chest" });

// ------------------------------------------------------------------ tee 02 · "Quasar Core" back print
function tee02Back(t) {
  const k = tone(t), dark = t === "dark", cx = 2250, cy = 1850;
  let back = "", front = "";
  for (let i = 0; i < 9; i++) {
    const rx = 620 + i * 125, ry = rx * 0.24, sw = r2(70 - i * 5.5), op = r2(1 - i * 0.075);
    back += `<path d="M${cx - rx} ${cy}A${rx} ${ry} 0 0 1 ${cx + rx} ${cy}" fill="none" stroke="url(#t2disk${t})" stroke-width="${sw}" opacity="${op}"/>`;
    front += `<path d="M${cx + rx} ${cy}A${rx} ${ry} 0 0 1 ${cx - rx} ${cy}" fill="none" stroke="url(#t2disk${t})" stroke-width="${sw}" opacity="${op}"/>`;
  }
  const word = "QUASAR", wSize = fit(word, 4150, { tracking: -0.035 }), wy = 4180, wTop = wy - wSize * CAP;
  const keep = (x, y) => Math.hypot(x - cx, (y - cy) * 1.1) < 2050 && y < wTop - 120;
  const body = `<defs>
  ${holo(`t2disk${t}`, cx - 1700, 0, cx + 1700, 0)}
  ${chrome(`t2chr${t}`, wTop, wy, t)}
  <radialGradient id="t2halo${t}" cx="${cx}" cy="${cy}" r="900" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${dark ? "#fff" : V2.coral}" stop-opacity="${dark ? 1 : 0.55}"/><stop offset=".18" stop-color="${dark ? V2.ice : V2.orange}" stop-opacity="${dark ? 0.85 : 0.35}"/><stop offset=".5" stop-color="${V2.violet}" stop-opacity="${dark ? 0.3 : 0.12}"/><stop offset="1" stop-color="${V2.violet}" stop-opacity="0"/></radialGradient>
  <linearGradient id="t2jet${t}" x1="0" y1="${cy}" x2="0" y2="${cy - 1650}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${dark ? "#fff" : V2.violetDeep}"/><stop offset=".45" stop-color="${V2.cyan}" stop-opacity=".8"/><stop offset="1" stop-color="${V2.lime}" stop-opacity="0"/></linearGradient>
  ${blur(`t2b${t}`, 46)}
  ${grain(`t2g${t}`, [0, 0, W, 3400], { seed: 273, amount: 0.5 })}
</defs>
<g mask="url(#t2g${t})"><circle cx="${cx}" cy="${cy}" r="1500" fill="url(#t2halo${t})" opacity="${dark ? 0.55 : 0.8}"/></g>
${stars(dark ? 260 : 150, [150, 100, 4200, 3400], { seed: 2026, min: 3, max: 12, keep, colors: dark ? ["#fff", "#fff", V2.lilac, V2.ice, V2.lime] : [k.fg, k.fg, V2.violetDeep, V2.coral], sparkles: 0.06 })}
<g transform="rotate(-16 ${cx} ${cy})">
  ${dark ? `<g filter="url(#t2b${t})" opacity=".75">${back}</g>` : ""}${back}
  <path d="M${cx - 44} ${cy}L${cx - 6} ${cy - 1650}L${cx + 6} ${cy - 1650}L${cx + 44} ${cy}Z" fill="url(#t2jet${t})"/>
  <path d="M${cx - 44} ${cy}L${cx - 6} ${cy + 1350}L${cx + 6} ${cy + 1350}L${cx + 44} ${cy}Z" fill="url(#t2jet${t})" transform="rotate(180 ${cx} ${cy})" opacity=".85"/>
  <circle cx="${cx}" cy="${cy}" r="520" fill="url(#t2halo${t})"/>
  ${dark ? `<g filter="url(#t2b${t})" opacity=".6">${front}</g>` : ""}${front}
  <circle cx="${cx}" cy="${cy}" r="${dark ? 150 : 210}" fill="${dark ? "#fff" : V2.ink}"/>
  ${dark ? "" : `<circle cx="${cx}" cy="${cy}" r="250" fill="none" stroke="url(#t2disk${t})" stroke-width="22"/>`}
</g>
${dark ? `<path d="${sparkle(cx, cy, 380, 0.06)}" fill="#fff" opacity=".9"/>` : ""}
${text(word, { size: wSize, x: cx, y: wy, tracking: -0.035, fill: `url(#t2chr${t})` })}
${text("THE BRIGHTEST THING IN THE UNIVERSE.", { w: 500, size: 96, x: 175, y: 4470, anchor: "start", tracking: 0.08, fill: k.fg, fam: "mono" })}
${text("3C 273 · SPOTTED 1963", { w: 500, size: 96, x: 4325, y: 4470, anchor: "end", tracking: 0.08, fill: k.warm, fam: "mono" })}
<path d="M175 4580H4325" stroke="url(#t2disk${t})" stroke-width="10"/>
${mark(175, 4760, 300, `t2m${t}`)}
${text("Quasaria", { size: 190, x: 540, y: 4975, anchor: "start", tracking: TIGHT, fill: k.fg })}
${pill(3180, 4790, 1145, 220, "SINGULARITY SERIES", { fill: dark ? V2.lime : V2.ink, color: dark ? V2.ink : V2.bone, size: 78, tracking: 0.14, fam: "mono", w8: 700 })}`;
  return svgDoc(W, H, body, { title: `Quasaria — Quasar Core back print v2 (${t} garments)`, desc: "Holographic accretion disk, jets, grain glow, oversized liquid-chrome QUASAR" });
}
const tee02FrontChest = () => svgDoc(1500, 1500, mark(250, 250, 1000, "t2c"), { title: "Quasaria — Singularity Q chest mark (front of Quasar Core tee)", desc: "Left-chest mark, works on any garment colour" });

// ------------------------------------------------------------------ tee 03 · "Trade at the speed of light"
function tee03(t) {
  const k = tone(t), dark = t === "dark";
  const x0 = 330, s1 = "SPEED", s2 = "OF LIGHT";
  const z1 = fit(s1, 3700, { tracking: -0.05 }), y1 = 2380, z2 = fit(s2, 3300, { tracking: -0.05 }), y2 = y1 + z2 * CAP + 250;
  let streaks = "";
  [[1360, 2700, 60], [1520, 3300, 26], [1640, 2000, 40], [2560, 3000, 34], [2700, 2300, 70], [2860, 3500, 22], [3920, 2600, 30], [4050, 3100, 52]].forEach(([y, len, h], i) =>
    (streaks += `<rect x="${W - 120 - len}" y="${y}" width="${len}" height="${h}" rx="${h / 2}" fill="url(#t3st${t})" opacity="${r2(0.55 + (i % 3) * 0.15)}"/>`));
  const body = `<defs>
  <linearGradient id="t3st${t}" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${V2.coral}" stop-opacity="0"/><stop offset=".55" stop-color="${V2.coral}"/><stop offset=".85" stop-color="${V2.orange}"/><stop offset="1" stop-color="${dark ? V2.lime : V2.violetDeep}"/></linearGradient>
  <radialGradient id="t3orb${t}" cx="3350" cy="1250" r="900" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#FFE3A3"/><stop offset=".35" stop-color="${V2.orange}"/><stop offset=".7" stop-color="${V2.coral}"/><stop offset="1" stop-color="${V2.violet}"/></radialGradient>
  ${chrome(`t3c1${t}`, y1 - z1 * CAP, y1, t)}${chrome(`t3c2${t}`, y2 - z2 * CAP, y2, t)}
  ${grain(`t3g${t}`, [2400, 300, 1900, 1900], { seed: 83, amount: 0.55 })}
  ${blur(`t3b${t}`, 70)}
</defs>
${dark ? `<circle cx="3350" cy="1250" r="820" fill="url(#t3orb${t})" opacity=".45" filter="url(#t3b${t})"/>` : ""}
<g mask="url(#t3g${t})"><circle cx="3350" cy="1250" r="820" fill="url(#t3orb${t})"/></g>
${streaks}
${text("TRADE AT THE", { w: 500, size: 150, x: x0 + 10, y: 820, anchor: "start", tracking: 0.28, fill: k.fg, fam: "mono" })}
<path d="M${x0 + 10} 900h600" stroke="${k.warm}" stroke-width="16" stroke-linecap="round"/>
${lean(text(s1, { size: z1, x: x0, y: y1, anchor: "start", tracking: -0.05, fill: `url(#t3c1${t})` }), x0, y1)}
${lean(text(s2, { size: z2, x: x0 + 520, y: y2, anchor: "start", tracking: -0.05, fill: `url(#t3c2${t})` }), x0 + 520, y2)}
${text("~299,792 KM/S", { w: 500, size: 110, x: x0 + 10, y: y2 + 520, anchor: "start", tracking: 0.12, fill: k.warm, fam: "mono" })}
${text("SETTLES IN ~5 S ON STELLAR", { w: 500, size: 110, x: x0 + 10, y: y2 + 680, anchor: "start", tracking: 0.12, fill: k.fg2, fam: "mono" })}
${mark(3700, y2 + 360, 360, `t3m${t}`)}
${text("QUASARIA", { size: 104, x: 4160, y: y2 + 870, anchor: "end", tracking: 0.3, fill: k.fg })}`;
  return svgDoc(W, H, body, { title: `Quasaria — Trade at the Speed of Light v2 (${t} garments)`, desc: "Oversized leaning liquid-chrome type, grain sunset orb, coral→orange speed streaks" });
}

// ------------------------------------------------------------------ tee 04 · "Level up" (refined, no pixel art)
function tee04(t) {
  const k = tone(t), dark = t === "dark", cx = 2250, cy = 2450, R = 1150;
  const segs = 40, gapDeg = 2.6;
  let ring = "";
  for (let i = 0; i < segs; i++) {
    const a0 = -90 + (360 / segs) * i + gapDeg / 2, a1 = a0 + 360 / segs - gapDeg;
    const P = (a, r) => [r2(cx + r * Math.cos((a * Math.PI) / 180)), r2(cy + r * Math.sin((a * Math.PI) / 180))];
    const [ax, ay] = P(a0, R), [bx, by] = P(a1, R);
    ring += `<path d="M${ax} ${ay}A${R} ${R} 0 0 1 ${bx} ${by}" stroke="url(#t4ring${t})" stroke-width="110" fill="none" stroke-linecap="round"/>`;
  }
  // refined nod to pixels: an ordered halftone dot field that fades out
  let dots = "";
  for (let y = 900; y < 4100; y += 70) for (let x = 250; x < 4250; x += 70) {
    const d = Math.hypot(x - cx, y - cy);
    if (d < R + 150 || d > R + 900) continue;
    const r = r2(12 * (1 - (d - R - 150) / 750));
    if (r > 2) dots += `M${x - r} ${y}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0z`;
  }
  const h1 = "LEVEL UP", z = fit(h1, 4000, { tracking: -0.05 }), hy = 180 + z * CAP;
  const chip = (x, y, label, fillId, rot) => `<g transform="rotate(${rot} ${x} ${y})">${pill(x - 380, y - 110, 760, 220, label, { fill: `url(#${fillId})`, color: V2.ink, size: 100, tracking: 0.02, fam: "mono" })}</g>`;
  const body = `<defs>
  ${holo(`t4ring${t}`, cx - R, cy - R, cx + R, cy + R, { stops: [V2.violet, V2.cyan, V2.lime, V2.coral] })}
  ${holo(`t4chipA${t}`, 0, 0, 4500, 0, { soft: true })}
  <linearGradient id="t4chipB${t}" x1="0" y1="0" x2="4500" y2="0" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${V2.lime}"/><stop offset="1" stop-color="#E9FF9A"/></linearGradient>
  <linearGradient id="t4chipC${t}" x1="0" y1="0" x2="4500" y2="0" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#FFB199"/><stop offset="1" stop-color="${V2.coral}"/></linearGradient>
  ${chrome(`t4chr${t}`, hy - z * CAP, hy, t)}
  <linearGradient id="t4bar${t}" x1="600" y1="0" x2="3900" y2="0" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${V2.violet}"/><stop offset=".5" stop-color="${V2.cyan}"/><stop offset="1" stop-color="${V2.lime}"/></linearGradient>
  ${blur(`t4b${t}`, 60)}
</defs>
${text(h1, { size: z, x: cx, y: hy, tracking: -0.05, fill: `url(#t4chr${t})` })}
<path d="${dots}" fill="${dark ? V2.lilac : V2.violetDeep}" opacity="${dark ? 0.5 : 0.35}"/>
${dark ? `<g filter="url(#t4b${t})" opacity=".55">${ring}</g>` : ""}${ring}
${mark(cx - 720, cy - 720, 1440, `t4m${t}`)}
${chip(820, 1500, "+75 XP", `t4chipB${t}`, -8)}
${chip(3700, 1680, "QUEST DONE", `t4chipA${t}`, 7)}
${chip(3560, 3520, "+40 XP", `t4chipC${t}`, -5)}
${pill(cx - 1200, 3860, 2400, 230, "QUASAR RANK UNLOCKED", { fill: dark ? "#fff" : V2.ink, color: dark ? V2.ink : V2.bone, size: 96, tracking: 0.12, fam: "mono" })}
${text("LV 09", { w: 500, size: 100, x: 600, y: 4380, anchor: "start", tracking: 0.1, fill: k.fg2, fam: "mono" })}
${text("LV 10 · MAX", { w: 700, size: 100, x: 3900, y: 4380, anchor: "end", tracking: 0.1, fill: k.warm, fam: "mono" })}
<rect x="600" y="4450" width="3300" height="110" rx="55" fill="none" stroke="${k.fg}" stroke-opacity=".35" stroke-width="10"/>
<rect x="620" y="4470" width="3260" height="70" rx="35" fill="url(#t4bar${t})"/>
${text("Learn it. Try it once. Level up.", { w: 500, size: 170, x: cx, y: 4930, tracking: -0.02, fill: k.fg })}`;
  return svgDoc(W, H, body, { title: `Quasaria — Level Up v2 (${t} garments)`, desc: "Segmented holographic XP ring around the Singularity Q, chrome LEVEL UP, XP chips, halftone texture" });
}

// ------------------------------------------------------------------ tee 05 · "From Stardust to Quasar"
function tee05(t) {
  const k = tone(t), dark = t === "dark", x0 = 250, colW = 3050;
  const lines = [["FROM", 300, k.fg2], ["STARDUST", 700, k.fg], ["TO", 300, k.fg2], ["QUASAR", 700, `url(#t5holo${t})`]];
  let y = 900, type = "";
  const zs = lines.map(([s, w]) => Math.min(fit(s, colW, { w, tracking: TIGHT }), w === 300 ? 700 : 2000));
  lines.forEach(([s, w, fill], i) => { y += zs[i] * CAP + (i ? 150 : 0); type += text(s, { w, size: zs[i], x: x0, y, anchor: "start", tracking: TIGHT, fill }); });
  const lx = 3900, top = 1100, step = 830;
  let ladder = `<path d="M${lx} ${top}V${top + 4 * step}" stroke="url(#t5line${t})" stroke-width="14" stroke-linecap="round"/>`;
  RANKS2.forEach((rk, i) => {
    const cy = top + (4 - i) * step;
    ladder += rankChip(`t5r${t}${i}`, lx, cy, i === 4 ? 300 : 230, rk, i === 4 ? k.warm : "");
    ladder += text(rk.name.toUpperCase(), { w: 700, size: 88, x: lx, y: cy + (i === 4 ? 450 : 360), tracking: 0.14, fill: k.fg, fam: "mono" });
  });
  const body = `<defs>
  ${holo(`t5holo${t}`, x0, 0, x0 + colW, 0, dark ? {} : { stops: [V2.violetDeep, V2.cyanDeep, V2.coral, V2.orange] })}
  <linearGradient id="t5line${t}" x1="0" y1="${top + 4 * step}" x2="0" y2="${top}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${k.mute}"/><stop offset=".6" stop-color="${V2.cyan}"/><stop offset="1" stop-color="${V2.violet}"/></linearGradient>
</defs>
${stars(dark ? 90 : 60, [200, 200, 3200, 700], { seed: 5, min: 3, max: 10, colors: dark ? ["#fff", V2.lilac, V2.lime] : [k.fg, V2.violetDeep, V2.coral] })}
${type}
${ladder}
${text("LEARN · TRY ONCE · LEVEL UP", { w: 500, size: 112, x: x0 + 6, y: 4700, anchor: "start", tracking: 0.16, fill: k.warm, fam: "mono" })}
${mark(x0, 4900, 260, `t5m${t}`)}
${text("Quasaria", { size: 170, x: x0 + 320, y: 5090, anchor: "start", tracking: TIGHT, fill: k.fg })}`;
  return svgDoc(W, H, body, { title: `Quasaria — From Stardust to Quasar v2 (${t} garments)`, desc: "Oversized stacked type with a holographic QUASAR and a vertical rank ladder" });
}

// ------------------------------------------------------------------ hoodie
function hoodieFront(t) {
  const k = tone(t), dark = t === "dark", cx = 2250, my = 1250, rx = 1500, ry = 380;
  const word = "QUASARIA", z = fit(word, 3900, { tracking: -0.03 }), wy = 2900;
  const orbit = (half) => `<path d="M${cx - rx} ${my}A${rx} ${ry} 0 0 ${half} ${cx + rx} ${my}" fill="none" stroke="url(#hfo${t})" stroke-width="44" stroke-linecap="round"/>`;
  const body = `<defs>${holo(`hfo${t}`, cx - rx, 0, cx + rx, 0)}${chrome(`hfc${t}`, wy - z * CAP, wy, t)}${blur(`hfb${t}`, 40)}</defs>
<g transform="rotate(-14 ${cx} ${my})">${dark ? `<g filter="url(#hfb${t})" opacity=".6">${orbit(1)}</g>` : ""}${orbit(1)}</g>
${mark(cx - 700, my - 700, 1400, `hf${t}`)}
<g transform="rotate(-14 ${cx} ${my})">${dark ? `<g filter="url(#hfb${t})" opacity=".6">${orbit(0)}</g>` : ""}${orbit(0)}<circle cx="${cx + rx * 0.72}" cy="${my + ry * 0.69}" r="70" fill="${dark ? V2.lime : V2.coral}"/></g>
${text(word, { size: z, x: cx, y: wy, tracking: -0.03, fill: `url(#hfc${t})` })}
${text("SINGULARITY SERIES", { w: 500, size: 110, x: 300, y: 3180, anchor: "start", tracking: 0.2, fill: k.fg2, fam: "mono" })}
${text("2026", { w: 700, size: 110, x: 4200, y: 3180, anchor: "end", tracking: 0.2, fill: k.warm, fam: "mono" })}<path d="${sparkle(4200 - measure("2026", { w: 700, size: 110, tracking: 0.2, fam: "mono" }) - 110, 3142, 60, 0.12)}" fill="${k.warm}"/>`;
  return svgDoc(W, H, body, { title: `Quasaria — Singularity hoodie front v2 (${t} garments)`, desc: "Singularity Q in a holographic orbit, oversized chrome wordmark (clears the kangaroo pocket)" });
}
function hoodieSleeve(t) {
  const k = tone(t), w = 1200, h = 4800, s = "FROM STARDUST TO QUASAR";
  const z = fit(s, 3800, { tracking: -0.02 });
  const body = `<defs>${holo(`hsg${t}`, -1900, 0, 1900, 0, t === "dark" ? {} : { stops: [V2.violetDeep, V2.cyanDeep, V2.coral, V2.orange] })}</defs>
<g transform="translate(${600 + (z * CAP) / 2} 2100) rotate(-90)">${text(s, { size: z, x: 0, y: 0, tracking: -0.02, fill: `url(#hsg${t})` })}</g>
${mark(350, 4250, 500, `hs${t}`)}`;
  return svgDoc(w, h, body, { title: `Quasaria — hoodie sleeve print v2 (4×16 in, ${t} garments)`, desc: "Holographic vertical type reading up from the cuff, mark at the cuff" });
}

// ------------------------------------------------------------------ cap · embroidery (600 DPI, flat fills, ≤ 3 threads)
const capMark3 = () => svgDoc(2400, 1050, flatMark(750, 75, 900), { title: "Quasaria — cap embroidery mark, 3 threads (dark caps)", desc: "Flat fills only: violet #7C5CFF, cyan #22D3EE, white" });
const capMark1 = () => svgDoc(2400, 1050, flatMark(750, 75, 900, { ring: "#fff", tail: "#fff", core: "#fff", glint: "#fff" }), { title: "Quasaria — cap embroidery mark, 1 thread (white)", desc: "Single-colour variant for dark caps" });
const capMarkTonal = () => svgDoc(2400, 1050, flatMark(750, 75, 900, { ring: V2.violetDeep, tail: V2.violetDeep, core: V2.violetDeep, glint: V2.coral }), { title: "Quasaria — cap embroidery mark, 2 threads (light caps)", desc: "Violet #5B3DF5 + coral #FF5E5B glint, for bone / lavender caps" });
function capLockup(t) {
  const dark = t === "dark", s = "Quasaria", size = fit(s, 1600, { tracking: -0.04 });
  const m = dark ? {} : { ring: V2.violetDeep, tail: V2.cyanDeep, core: V2.ink, glint: V2.coral };
  return svgDoc(2700, 1050, flatMark(60, 175, 700, m) + text(s, { size, x: 860, y: 525 + size * 0.24, anchor: "start", tracking: -0.04, fill: dark ? "#fff" : V2.ink }),
    { title: `Quasaria — cap embroidery lockup v2 (${t} caps, 4.5 × 1.75 in @ 600 DPI)`, desc: dark ? "Violet, cyan, white threads" : "Violet, cyan, ink threads + coral glint (4)" });
}

// ------------------------------------------------------------------ stickers
const rr = (w, h, rx) => ({ type: "rrect", w, h, rx });
const fillShape = (s, fill) => `<path d="${shapePath(s)}" fill="${fill}"/>`;
export const STICKERS = [
  { id: "logo", name: "Singularity Q", shape: { type: "circle", r: 330 }, draw: (p) => `<defs>${holo(`${p}h`, -330, -330, 330, 330)}<radialGradient id="${p}bg" cx="0" cy="-60" r="420" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#231a55"/><stop offset="1" stop-color="${V2.ink}"/></radialGradient></defs>${fillShape({ type: "circle", r: 330 }, `url(#${p}h)`)}<circle r="300" fill="url(#${p}bg)"/>${mark(-240, -240, 480, p + "m")}` },
  { id: "lockup", name: "Quasaria wordmark", shape: rr(1180, 320, 160), draw: (p) => `${fillShape(rr(1180, 320, 160), V2.bone)}${mark(-530, -125, 250, p + "m")}${text("Quasaria", { size: fit("Quasaria", 790, { tracking: TIGHT }), x: -255, y: 66, anchor: "start", tracking: TIGHT, fill: V2.ink })}` },
  { id: "risk", name: "Read the risk guide", shape: rr(1180, 230, 115), draw: (p) => `${fillShape(rr(1180, 230, 115), V2.lime)}<circle cx="-470" cy="0" r="80" fill="${V2.ink}"/>${glyph("shield", -470, 0, 3.2, 2.4)}${text("READ THE RISK GUIDE", { size: fit("READ THE RISK GUIDE", 800, { tracking: 0.02 }), x: -355, y: 12, anchor: "start", tracking: 0.02, fill: V2.ink })}${text("DYOR · TESTNET FIRST", { w: 500, size: 44, x: -352, y: 74, anchor: "start", tracking: 0.16, fill: V2.ink, fam: "mono" })}` },
  ...RANKS2.map((rk) => ({ id: `rank-${rk.name.toLowerCase()}`, name: `${rk.name} rank`, shape: rr(330, 410, 120), draw: (p) => `<defs><linearGradient id="${p}g" x1="-165" y1="-205" x2="165" y2="205" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${rk.grad[0]}"/><stop offset="1" stop-color="${rk.grad[1]}"/></linearGradient><radialGradient id="${p}s" cx="-70" cy="-140" r="260" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#fff" stop-opacity=".6"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient></defs>${fillShape(rr(330, 410, 120), `url(#${p}g)`)}${fillShape(rr(330, 410, 120), `url(#${p}s)`)}${glyph(rk.icon, 0, -50, 4.4, 2.4)}${text(rk.name.toUpperCase(), { size: Math.min(60, fit(rk.name.toUpperCase(), 260, { tracking: 0.04 })), x: 0, y: 110, tracking: 0.04 })}${text(`LV ${rk.levels}`, { w: 500, size: 34, x: 0, y: 158, tracking: 0.16, fill: "#fff", fam: "mono" })}` })),
  ...[["risk-aware", "RISK AWARE", ["#C6FF3D", "#2BD99F"], "shield"], ["calculated", "CALCULATED", ["#FFD166", "#FF8A3D"], "abacus"], ["guardian", "SLIPPAGE GUARDIAN", ["#7CF0FF", "#3B82F6"], "gauge"], ["navigator", "NAVIGATOR", ["#C4B5FD", "#7C5CFF"], "compass"], ["constellation", "CONSTELLATION", ["#FFB199", "#FF5E5B"], "flame"]].map(([id, name, [a, b], icon]) => ({
    id: `badge-${id}`, name: `${name[0]}${name.slice(1).toLowerCase()} badge`, shape: { type: "circle", r: 190 },
    draw: (p) => `<defs><linearGradient id="${p}g" x1="-190" y1="-190" x2="190" y2="190" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs>${fillShape({ type: "circle", r: 190 }, `url(#${p}g)`)}<circle cx="0" cy="-40" r="92" fill="${V2.ink}"/>${glyph(icon, 0, -40, 3.2, 2.4)}${name.includes(" ") && name.length > 12 ? name.split(" ").map((ln, k) => text(ln, { size: 34, x: 0, y: 100 + k * 40, tracking: 0.04, fill: V2.ink })).join("") : text(name, { size: Math.min(40, fit(name, 250, { tracking: 0.04 })), x: 0, y: 118, tracking: 0.04, fill: V2.ink })}`,
  })),
  { id: "level-up", name: "Level up (chrome)", shape: rr(720, 270, 135), draw: (p) => `<defs>${chrome(`${p}c`, -60 - 118 * CAP + 60, 60, "dark")}${holo(`${p}h`, -360, 0, 360, 0)}</defs>${fillShape(rr(720, 270, 135), V2.ink)}<path d="${shapePath(rr(690, 240, 120))}" fill="none" stroke="url(#${p}h)" stroke-width="8"/>${text("LEVEL UP", { size: fit("LEVEL UP", 540, { tracking: -0.04 }), x: 0, y: 44, tracking: -0.04, fill: `url(#${p}c)` })}` },
  { id: "xp", name: "+75 XP chip", shape: rr(420, 200, 100), draw: (p) => `<defs><linearGradient id="${p}g" x1="-210" y1="0" x2="210" y2="0" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${V2.coral}"/><stop offset="1" stop-color="${V2.orange}"/></linearGradient></defs>${fillShape(rr(420, 200, 100), `url(#${p}g)`)}${text("+75 XP", { size: 96, x: 0, y: 34, tracking: -0.03, fill: "#fff" })}` },
  { id: "stardust-quasar", name: "From Stardust to Quasar", shape: rr(940, 180, 90), draw: (p) => `<defs>${holo(`${p}g`, -470, 0, 470, 0, { soft: true })}</defs>${fillShape(rr(940, 180, 90), `url(#${p}g)`)}${text("FROM STARDUST TO QUASAR", { size: fit("FROM STARDUST TO QUASAR", 800, { tracking: 0.01 }), x: 0, y: 24, tracking: 0.01, fill: V2.ink })}` },
  { id: "pioneer", name: "Testnet pioneer", shape: rr(940, 180, 90), draw: (p) => `${fillShape(rr(940, 180, 90), V2.ink)}<path d="${sparkle(-380, 0, 40, 0.12)}" fill="${V2.lime}"/><path d="${sparkle(380, 0, 40, 0.12)}" fill="${V2.lime}"/>${text("TESTNET PIONEER", { size: fit("TESTNET PIONEER", 620, { tracking: 0.06, fam: "mono" }), x: 0, y: 26, tracking: 0.06, fill: V2.lime, fam: "mono" })}` },
  { id: "gm", name: "gm, stardust", shape: rr(760, 230, 115), draw: (p) => `${fillShape(rr(760, 230, 115), V2.coral)}<path d="${sparkle(-270, -6, 56, 0.12)}" fill="${V2.bone}"/>${text("gm, stardust.", { size: fit("gm, stardust.", 500, { tracking: TIGHT }), x: 40, y: 34, tracking: TIGHT, fill: V2.bone })}` },
];
const SHEET_POS = { logo: [560, 530], lockup: [1730, 390], risk: [1730, 770], "level-up": [560, 2520], xp: [560, 2960], "stardust-quasar": [1720, 2430], pioneer: [1720, 2690], gm: [1720, 2990] };
RANKS2.forEach((rk, i) => (SHEET_POS[`rank-${rk.name.toLowerCase()}`] = [330 + i * 472.5, 1330]));
["risk-aware", "calculated", "guardian", "navigator", "constellation"].forEach((id, i) => (SHEET_POS[`badge-${id}`] = [330 + i * 472.5, 1965]));

/** One sticker, centred at 0,0: white die-cut border (cut at +30 px) with optional bleed + CutContour. */
export function stickerGroup(st, { cut = true, bleed = 18, border = 30 } = {}) {
  const p = `s-${st.id}`;
  return `<path d="${shapePath(st.shape, border + bleed)}" fill="#fff"/>` + st.draw(p) +
    (cut ? `<path d="${shapePath(st.shape, border)}" fill="none" stroke="#EC008C" stroke-width="2" class="cut"/>` : "");
}
export function stickerSvg(st, opts = {}) {
  const pad = 30 + (opts.bleed ?? 18) + 4, [bw, bh] = shapeBox(st.shape), w = Math.ceil(bw + 2 * pad), h = Math.ceil(bh + 2 * pad);
  return { w, h, svg: svgDoc(w, h, `<g transform="translate(${w / 2} ${h / 2})">${stickerGroup(st, opts)}</g>`, { title: `Quasaria sticker — ${st.name}`, desc: `Die-cut sticker at 300 DPI. ${opts.cut === false ? "" : "Magenta (#EC008C) hairline = CutContour; white border 30 px (2.5 mm) + 18 px bleed."}` }) };
}
function stickerSheet({ cut }) {
  const g = STICKERS.map((st) => { const [x, y] = SHEET_POS[st.id]; return `<g transform="translate(${x} ${y})">${stickerGroup(st, { cut, bleed: cut ? 18 : 0 })}</g>`; }).join("\n");
  return svgDoc(2550, 3300, g, { title: `Quasaria die-cut sticker sheet v2 (8.5 × 11 in @ 300 DPI)${cut ? " with cut lines" : ""}`, desc: "18 stickers: holo logo, bone wordmark, lime risk-guide pill, 5 rank chips, 5 quest badges, chrome LEVEL UP, +75 XP, slogans" });
}

// ------------------------------------------------------------------ mugs (11 oz wrap, 2700 × 1050; side A centred at 700, side B at 2000)
function mugGm() { // white ceramic, light wrap
  const w = 2700, h = 1050;
  const chips = RANKS2.map((rk, i) => rankChip(`mg${i}`, 1690 + i * 155, 820, 58, rk)).join("");
  const body = `<defs>
  <radialGradient id="mgsun" cx="880" cy="330" r="330" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#FFE3A3"/><stop offset=".45" stop-color="${V2.orange}"/><stop offset="1" stop-color="${V2.coral}"/></radialGradient>
  ${holo("mgholo", 380, 0, 1100, 0, { stops: [V2.violetDeep, V2.cyanDeep, V2.coral] })}
  ${grain("mgg", [500, 0, 800, 700], { seed: 9, amount: 0.55 })}
</defs>
<rect width="${w}" height="${h}" fill="#FFFFFF"/>
<g mask="url(#mgg)"><circle cx="880" cy="330" r="270" fill="url(#mgsun)"/></g>
${text("gm,", { size: 400, x: 330, y: 590, anchor: "start", tracking: -0.05, fill: V2.ink })}
${text("stardust.", { size: fit("stardust.", 780, { tracking: -0.05 }), x: 330, y: 820, anchor: "start", tracking: -0.05, fill: "url(#mgholo)" })}
${text("RISE · LEARN · LEVEL UP", { w: 500, size: 34, x: 336, y: 905, anchor: "start", tracking: 0.2, fill: "#7A7496", fam: "mono" })}
${mark(2000 - 190, 130, 380, "mgm")}
${text("Quasaria", { size: 150, x: 2000, y: 660, tracking: TIGHT, fill: V2.ink })}
${chips}`;
  return svgDoc(w, h, body, { title: "Quasaria — 'gm, stardust' mug wrap v2 (white 11 oz)", desc: "Side A: gm, stardust with a grain sunrise orb; side B: Singularity Q, wordmark, rank chips" });
}
function mugSingularity() { // black ceramic, dark wrap
  const w = 2700, h = 1050, z = fit("LEVEL UP", 820, { tracking: -0.05 });
  const body = `<defs>
  <radialGradient id="msglow" cx="700" cy="470" r="560" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${V2.violet}" stop-opacity=".55"/><stop offset=".6" stop-color="${V2.cyan}" stop-opacity=".12"/><stop offset="1" stop-color="${V2.cyan}" stop-opacity="0"/></radialGradient>
  ${chrome("mswm", 800 - 170 * CAP, 800, "dark")}${chrome("mslv", 560 - z * CAP, 560, "dark")}${holo("msline", 1600, 0, 2400, 0)}
  ${grain("msg", [0, 0, w, h], { seed: 4, amount: 0.5 })}
</defs>
<rect width="${w}" height="${h}" fill="#0B0B12"/>
<g mask="url(#msg)"><rect width="${w}" height="${h}" fill="url(#msglow)"/></g>
${stars(120, [0, 0, w, h], { seed: 11, min: 1.5, max: 5, colors: ["#fff", V2.lilac, V2.lime] })}
${mark(700 - 260, 110, 520, "msm")}
${text("Quasaria", { size: 170, x: 700, y: 800, tracking: TIGHT, fill: "url(#mswm)" })}
${text("LEVEL UP", { size: z, x: 2000, y: 560, tracking: -0.05, fill: "url(#mslv)" })}
<path d="M1600 640H2400" stroke="url(#msline)" stroke-width="10" stroke-linecap="round"/>
${RANKS2.map((rk, i) => rankChip(`ms${i}`, 1690 + i * 155, 760, 54, rk)).join("")}
${text("FROM STARDUST TO QUASAR", { w: 500, size: 36, x: 2000, y: 890, tracking: 0.2, fill: V2.lilac, fam: "mono" })}`;
  return svgDoc(w, h, body, { title: "Quasaria — 'Singularity' mug wrap v2 (black 11 oz)", desc: "Side A: Singularity Q + chrome wordmark on a grain glow; side B: chrome LEVEL UP + rank chips" });
}

// ------------------------------------------------------------------ catalogue
const both = (id, file, w, h, fn, meta) => [
  { id: `${id}-dark`, file: `${file}-on-dark`, w, h, svg: fn("dark"), ...meta, garments: meta.dark },
  { id: `${id}-light`, file: `${file}-on-light`, w, h, svg: fn("light"), ...meta, garments: meta.light },
];
export const DESIGNS = [
  ...both("tee-01-chest", "tee-01-singularity-chest-5x5in", 1500, 1500, tee01Chest, { kind: "Tee · left chest", dark: "Black", light: "Bone, Lavender", note: "5 × 5 in left-chest placement." }),
  ...both("tee-01-front", "tee-01-singularity-chest-on-front-canvas", W, H, tee01Front, { kind: "Tee · front canvas", dark: "Black", light: "Bone, Lavender", note: "Same art pre-positioned on a 15 × 18 in front canvas (wearer's left chest)." }),
  ...both("tee-02-back", "tee-02-quasar-core-back", W, H, (t) => () => tee02Back(t), { kind: "Tee · full back", dark: "Black (glow version)", light: "Bone (flat 'singularity' core)", note: "Dark version: soft glows + grain use transparency — DTG with white underbase. Light version has no glow." }),
  { id: "tee-02-chest", file: "tee-02-quasar-core-front-chest-5x5in", w: 1500, h: 1500, svg: tee02FrontChest, kind: "Tee · left chest", garments: "Black, Bone", note: "Front chest mark that pairs with the back print." },
  ...both("tee-03", "tee-03-speed-of-light", W, H, (t) => () => tee03(t), { kind: "Tee · full front", dark: "Black", light: "Bone, Electric Lime", note: "Leaning liquid-chrome type; grain orb." }),
  ...both("tee-04", "tee-04-level-up", W, H, (t) => () => tee04(t), { kind: "Tee · full front", dark: "Black", light: "Lavender, Electric Lime", note: "Refined take on the old pixel design: XP ring, halftone dots, chips." }),
  ...both("tee-05", "tee-05-stardust-to-quasar", W, H, (t) => () => tee05(t), { kind: "Tee · full front", dark: "Black", light: "Bone, Lavender", note: "Ties into the in-app rank ladder." }),
  ...both("hoodie-front", "hoodie-singularity-front", W, H, (t) => () => hoodieFront(t), { kind: "Hoodie · front", dark: "Black", light: "Bone, Lavender", note: "Art sits in the top ~60% so it clears the kangaroo pocket." }),
  ...both("hoodie-sleeve", "hoodie-singularity-sleeve-4x16in", 1200, 4800, (t) => () => hoodieSleeve(t), { kind: "Hoodie · left sleeve", dark: "Black", light: "Bone, Lavender", note: "Optional sleeve print, reads upward from the cuff." }),
  { id: "cap-mark-3c", file: "cap-embroidery-mark-3color-600dpi", w: 2400, h: 1050, svg: capMark3, kind: "Cap · embroidery", garments: "Black cap", note: "4 × 1.75 in @ 600 DPI, 3 threads: violet #7C5CFF, cyan #22D3EE, white. No gradients, no hairlines." },
  { id: "cap-mark-1c", file: "cap-embroidery-mark-1color-white-600dpi", w: 2400, h: 1050, svg: capMark1, kind: "Cap · embroidery", garments: "Any dark cap", note: "1 thread." },
  { id: "cap-mark-tonal", file: "cap-embroidery-mark-2color-light-600dpi", w: 2400, h: 1050, svg: capMarkTonal, kind: "Cap · embroidery", garments: "Bone, Lavender caps", note: "2 threads: violet #5B3DF5 + coral #FF5E5B glint." },
  { id: "cap-lockup-dark", file: "cap-embroidery-lockup-600dpi-on-dark", w: 2700, h: 1050, svg: () => capLockup("dark"), kind: "Cap · embroidery", garments: "Black", note: "4.5 × 1.75 in, tight wordmark; 3 threads." },
  { id: "cap-lockup-light", file: "cap-embroidery-lockup-600dpi-on-light", w: 2700, h: 1050, svg: () => capLockup("light"), kind: "Cap · embroidery", garments: "Bone", note: "4.5 × 1.75 in; violet, cyan, ink + coral glint (4 threads)." },
  { id: "sticker-sheet", file: "sticker-sheet-letter-print-with-cutlines", w: 2550, h: 3300, svg: () => stickerSheet({ cut: true }), kind: "Stickers · sheet", garments: "White vinyl, kiss-cut or die-cut", note: "8.5 × 11 in; magenta #EC008C hairlines = CutContour, 18 px bleed." },
  { id: "sticker-sheet-preview", file: "sticker-sheet-letter-preview", w: 2550, h: 3300, svg: () => stickerSheet({ cut: false }), kind: "Stickers · sheet", garments: "—", note: "Same sheet without cut lines/bleed (for previews and web)." },
  { id: "mug-gm", file: "mug-11oz-wrap-gm-stardust-white", w: 2700, h: 1050, svg: mugGm, kind: "Mug · 11 oz wrap", garments: "White 11 oz ceramic", note: "Side A centred at x=700, side B at x=2000. Check the provider's template; keep text 0.25 in from edges." },
  { id: "mug-singularity", file: "mug-11oz-wrap-singularity-black", w: 2700, h: 1050, svg: mugSingularity, kind: "Mug · 11 oz wrap", garments: "Black 11 oz ceramic (full-bleed dark wrap)", note: "Full-bleed; grain glow uses transparency over the dark base." },
];
export { measure };
