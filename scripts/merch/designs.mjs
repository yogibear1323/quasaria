// Quasaria merch line — every design as a standalone, print-ready SVG string.
// All artwork is original; the only brand asset used is our own Singularity Q.
import { C, r2, text, fit, measure, mark, flatMark, flatMarkInner, sparkle, hexPath, stars, RANKS, glyph, hexBadge, HUES,
  pixelText, pixelWidth, pixelQ, pixelPlus, shapePath, shapeBox, svgDoc, rng } from "./lib.mjs";

const W = 4500, H = 5400; // 15 × 18 in @ 300 DPI (DTG full front / back)

// ------------------------------------------------------------------ tee 01 · minimal chest
function chestArt(ox, oy, s, p) { // 1500-unit box
  const k = s / 1500;
  return `<g transform="translate(${ox} ${oy}) scale(${k})">${mark(400, 170, 700, p)}${text("Quasaria", { size: fit("Quasaria", 1140, { tracking: -0.01 }), x: 750, y: 1270, tracking: -0.01 })}</g>`;
}
const tee01Chest = () => svgDoc(1500, 1500, chestArt(0, 0, 1500, "c1"), { title: "Quasaria — Singularity chest print (left chest, 5×5 in)", desc: "Mark + wordmark for a left-chest placement" });
const tee01Front = () => svgDoc(W, H, chestArt(2500, 600, 1200, "c1"), { title: "Quasaria — Singularity chest print on full-front canvas", desc: "Same art positioned at the wearer's left chest" });

// ------------------------------------------------------------------ tee 02 · big quasar back print
function tee02Back() {
  const cx = 2250, cy = 2150;
  let back = "", front = "";
  for (let i = 0; i < 11; i++) {
    const rx = 560 + i * 92, ry = rx * 0.25, sw = 64 - i * 4.2, op = r2(0.95 - i * 0.07);
    back += `<path d="M${cx - rx} ${cy}A${rx} ${ry} 0 0 1 ${cx + rx} ${cy}" fill="none" stroke="url(#t2disk)" stroke-width="${sw}" opacity="${op}"/>`;
    front += `<path d="M${cx + rx} ${cy}A${rx} ${ry} 0 0 1 ${cx - rx} ${cy}" fill="none" stroke="url(#t2disk)" stroke-width="${sw}" opacity="${op}"/>`;
  }
  const keep = (x, y) => Math.hypot(x - cx, (y - cy) * 0.85) < 2150 && y < 3950;
  const body = `<defs>
  <linearGradient id="t2disk" x1="${cx - 1500}" y1="0" x2="${cx + 1500}" y2="0" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${C.lilac}"/><stop offset=".35" stop-color="${C.violet}"/><stop offset=".62" stop-color="#5b8cff"/><stop offset="1" stop-color="${C.cyan}"/></linearGradient>
  <linearGradient id="t2jetU" x1="0" y1="${cy}" x2="0" y2="${cy - 2050}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#fff"/><stop offset=".25" stop-color="${C.ice}"/><stop offset=".7" stop-color="${C.cyan}" stop-opacity=".7"/><stop offset="1" stop-color="${C.violet}" stop-opacity="0"/></linearGradient>
  <linearGradient id="t2jetD" x1="0" y1="${cy}" x2="0" y2="${cy + 1750}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#fff"/><stop offset=".25" stop-color="${C.ice}"/><stop offset=".7" stop-color="${C.cyan}" stop-opacity=".6"/><stop offset="1" stop-color="${C.violet}" stop-opacity="0"/></linearGradient>
  <radialGradient id="t2halo" cx="${cx}" cy="${cy}" r="820" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#fff"/><stop offset=".12" stop-color="${C.ice}" stop-opacity=".9"/><stop offset=".4" stop-color="${C.cyan}" stop-opacity=".35"/><stop offset="1" stop-color="${C.violet}" stop-opacity="0"/></radialGradient>
  <radialGradient id="t2neb" cx="${cx}" cy="${cy}" r="1900" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${C.violet}" stop-opacity=".32"/><stop offset=".55" stop-color="${C.violet}" stop-opacity=".1"/><stop offset="1" stop-color="${C.violet}" stop-opacity="0"/></radialGradient>
  <linearGradient id="t2word" x1="600" y1="0" x2="3900" y2="0" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#fff"/><stop offset=".5" stop-color="${C.lilac}"/><stop offset="1" stop-color="${C.ice}"/></linearGradient>
  <filter id="t2blur" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="38"/></filter>
</defs>
<circle cx="${cx}" cy="${cy}" r="1900" fill="url(#t2neb)"/>
${stars(620, [150, 100, 4200, 3900], { seed: 273, min: 3, max: 15, keep })}
<g transform="rotate(-18 ${cx} ${cy})">
  <g filter="url(#t2blur)" opacity=".7">${back}</g>${back}
  <path d="M${cx - 70} ${cy}L${cx - 9} ${cy - 2050}L${cx + 9} ${cy - 2050}L${cx + 70} ${cy}Z" fill="url(#t2jetU)"/>
  <path d="M${cx - 70} ${cy}L${cx - 9} ${cy + 1750}L${cx + 9} ${cy + 1750}L${cx + 70} ${cy}Z" fill="url(#t2jetD)"/>
  <path d="M${cx - 170} ${cy}L${cx - 30} ${cy - 1500}L${cx + 30} ${cy - 1500}L${cx + 170} ${cy}Z" fill="url(#t2jetU)" opacity=".35" filter="url(#t2blur)"/>
  <circle cx="${cx}" cy="${cy}" r="820" fill="url(#t2halo)"/>
  <g filter="url(#t2blur)" opacity=".6">${front}</g>${front}
  <ellipse cx="${cx}" cy="${cy}" rx="360" ry="92" fill="none" stroke="#fff" stroke-width="26" opacity=".9"/>
  <circle cx="${cx}" cy="${cy}" r="120" fill="#fff"/>
</g>
<path d="${sparkle(cx, cy, 420, 0.07)}" fill="#fff" opacity=".85"/>
${mark(2250 - 170, 3990, 340, "t2m")}
${text("QUASARIA", { size: fit("QUASARIA", 3500, { tracking: 0.16 }), x: 2250, y: 4800, tracking: 0.16, fill: "url(#t2word)" })}
${text("THE BRIGHTEST OBJECTS IN THE UNIVERSE", { w: 500, size: fit("THE BRIGHTEST OBJECTS IN THE UNIVERSE", 3500, { w: 500, tracking: 0.22 }), x: 2250, y: 5040, tracking: 0.22, fill: C.lilac })}
${text("3C 273 · THE FIRST QUASAR IDENTIFIED · 1963", { w: 500, size: 92, x: 2250, y: 5260, tracking: 0.3, fill: C.cyan, attrs: 'opacity=".85"' })}`;
  return svgDoc(W, H, body, { title: "Quasaria — Quasar Core back print", desc: "Full-back illustration: accretion disk, relativistic jets, starfield, wordmark" });
}
const tee02FrontChest = () => svgDoc(1500, 1500, mark(250, 250, 1000, "t2c"), { title: "Quasaria — Singularity Q chest mark (front of Quasar Core tee)", desc: "Left-chest mark" });

// ------------------------------------------------------------------ tee 03 · retro 'Trade at the speed of light'
function tee03() {
  const cx = 2250, sunY = 2380, sunR = 1300, hz = 3300;
  let stripes = "";
  for (let k = 0; k < 9; k++) { const y = 2450 + k * 95 + k * k * 4, h = 14 + k * 9; stripes += `<rect x="0" y="${y}" width="${W}" height="${h}" fill="#000"/>`; }
  let grid = "";
  for (let k = 1; k <= 9; k++) { const y = hz + 1100 * Math.pow(k / 9, 1.9); grid += `<path d="M0 ${r2(y)}H${W}"/>`; }
  for (let k = -12; k <= 12; k++) grid += `<path d="M${cx} ${hz}L${cx + k * 520} ${hz + 1100}"/>`;
  const speed = "SPEED", sSize = fit(speed, 3950, { tracking: 0.02 }), light = "OF LIGHT", lSize = fit(light, 3500, { tracking: 0.04 });
  const layered = (str, size, y, tr) => [["#2a1b6e", 64], [C.violet, 40], [C.cyan, 18]].map(([c, o]) => text(str, { size, x: cx + o, y: y + o, tracking: tr, fill: c })).join("") + text(str, { size, x: cx, y, tracking: tr, fill: "url(#t3chrome)" });
  let streaks = "";
  const R = rng(1983);
  for (let i = 0; i < 7; i++) { const y = 700 + i * 70, l = 300 + R() * 600; streaks += `<path d="M${260} ${y}h${l}" /><path d="M${4240} ${y}h${-l}"/>`; }
  const body = `<defs>
  <linearGradient id="t3sun" x1="0" y1="${sunY - sunR}" x2="0" y2="${hz}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${C.warm}"/><stop offset=".45" stop-color="${C.pink}"/><stop offset="1" stop-color="${C.violet}"/></linearGradient>
  <linearGradient id="t3chrome" x1="0" y1="1700" x2="0" y2="2520" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#fff"/><stop offset=".5" stop-color="#e0e7ff"/><stop offset=".52" stop-color="${C.lilac}"/><stop offset="1" stop-color="${C.ice}"/></linearGradient>
  <linearGradient id="t3gridfade" x1="0" y1="${hz}" x2="0" y2="${hz + 1100}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#fff" stop-opacity=".15"/><stop offset=".35" stop-color="#fff"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
  <mask id="t3mask" maskUnits="userSpaceOnUse" x="0" y="0" width="${W}" height="${H}"><rect width="${W}" height="${hz}" fill="#fff"/>${stripes}</mask>
  <mask id="t3gm" maskUnits="userSpaceOnUse" x="0" y="0" width="${W}" height="${H}"><rect x="200" y="${hz}" width="4100" height="1100" fill="url(#t3gridfade)"/></mask>
</defs>
<circle cx="${cx}" cy="${sunY}" r="${sunR}" fill="url(#t3sun)" mask="url(#t3mask)"/>
<g mask="url(#t3gm)" stroke="${C.cyan}" stroke-width="12" fill="none">${grid}</g>
<path d="M200 ${hz}H4300" stroke="${C.ice}" stroke-width="14"/>
<g stroke="${C.ice}" stroke-width="22" stroke-linecap="round" opacity=".8">${streaks}</g>
${text("TRADE AT THE", { size: fit("TRADE AT THE", 2500, { tracking: 0.24 }), x: cx, y: 1080, tracking: 0.24, fill: "#fff" })}
${layered(speed, sSize, 2480, 0.02)}
${layered(light, lSize, 3680, 0.04).replaceAll("url(#t3chrome)", "url(#t3chrome2)")}
<defs><linearGradient id="t3chrome2" x1="0" y1="3050" x2="0" y2="3680" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#fff"/><stop offset=".5" stop-color="#e0e7ff"/><stop offset=".52" stop-color="${C.lilac}"/><stop offset="1" stop-color="${C.ice}"/></linearGradient></defs>
${mark(cx - 1060, 4560, 300, "t3m")}
${text("QUASARIA · EST. 2026", { w: 500, size: 150, x: cx - 700, y: 4765, anchor: "start", tracking: 0.3, fill: C.lilac })}`;
  return svgDoc(W, H, body, { title: "Quasaria — Trade at the Speed of Light (retro)", desc: "Retro synthwave sunset, perspective grid and chrome type" });
}

// ------------------------------------------------------------------ tee 04 · pixel arcade 'Level up: Quasar rank'
function tee04() {
  const cx = 2250;
  const lvl = "LEVEL UP!", px1 = 62, qpx = 80, qN = 22;
  let plus = "";
  const R = rng(8);
  const spots = [[520, 1500], [3950, 1400], [700, 2700], [3800, 2850], [1000, 1150], [3500, 1100], [420, 2100], [4080, 2150], [1250, 3050], [3300, 3000]];
  spots.forEach(([x, y], i) => (plus += pixelPlus(x, y, i % 3 === 0 ? 40 : 28, [C.gold, "#fff", C.cyan][i % 3])));
  for (let i = 0; i < 70; i++) { const x = 250 + Math.floor(R() * 4000 / 20) * 20, y = 1100 + Math.floor(R() * 2100 / 20) * 20; if (Math.abs(x - cx) < 1000 && y > 1150 && y < 3100) continue; plus += `<rect x="${x}" y="${y}" width="20" height="20" fill="${R() < 0.5 ? "#fff" : C.lilac}" opacity="${r2(0.4 + R() * 0.6)}"/>`; }
  const barX = 760, barY = 3900, barW = 2980, barH = 230, segs = 10, gap = 22, pad = 50, segW = (barW - 2 * pad - (segs - 1) * gap) / segs;
  const lerp = (a, b, t) => "#" + [0, 2, 4].map((o) => Math.round(parseInt(a.slice(1 + o, 3 + o), 16) * (1 - t) + parseInt(b.slice(1 + o, 3 + o), 16) * t).toString(16).padStart(2, "0")).join("");
  let bar = `<rect x="${barX}" y="${barY}" width="${barW}" height="${barH}" fill="none" stroke="#fff" stroke-width="28" shape-rendering="crispEdges"/>`;
  for (let i = 0; i < segs; i++) bar += `<rect x="${r2(barX + pad + i * (segW + gap))}" y="${barY + pad}" width="${r2(segW)}" height="${barH - 2 * pad}" fill="${lerp("#22D3EE", "#7C5CFF", i / (segs - 1))}" shape-rendering="crispEdges"/>`;
  const body = `${plus}
${pixelText("PLAYER 1", { x: 300, y: 260, px: 26, anchor: "start", fill: C.cyan })}
${pixelText("STAGE 09", { x: 4200, y: 260, px: 26, anchor: "end", fill: C.cyan })}
${pixelText(lvl, { x: cx, y: 560 + px1, px: px1, fill: "#4c2fd6" })}
${pixelText(lvl, { x: cx, y: 560, px: px1, fill: C.gold })}
${pixelQ(cx - (qN * qpx) / 2, 1250, qpx, qN)}
${pixelText("RANK: QUASAR", { x: cx + 40, y: 3240 + 40, px: 46, fill: "#2a1b6e" })}
${pixelText("RANK: QUASAR", { x: cx, y: 3240, px: 46, fill: "#fff" })}
${pixelText("XP", { x: barX, y: barY - 190, px: 22, anchor: "start", fill: C.lilac })}
${pixelText("MAX", { x: barX + barW, y: barY - 190, px: 22, anchor: "end", fill: C.gold })}
${bar}
${pixelText(">", { x: cx - pixelWidth("PRESS START TO LEARN", 28) / 2 - 120, y: 4500, px: 28, anchor: "start", fill: C.gold })}
${pixelText("PRESS START TO LEARN", { x: cx, y: 4500, px: 28, fill: "#fff" })}
${pixelText("QUASARIA", { x: cx, y: 4900, px: 30, fill: C.violet })}`;
  return svgDoc(W, H, body, { title: "Quasaria — Level Up: Quasar Rank (pixel arcade)", desc: "Pixel-art Singularity Q, original 5×7 pixel type, XP bar" });
}

// ------------------------------------------------------------------ tee 05 · 'Stardust to Quasar' rank ladder
function rankHex(p, cx, cy, R, rank) {
  const [a, b] = rank.grad;
  return `<defs><linearGradient id="${p}" x1="${cx - R}" y1="${cy - R}" x2="${cx + R}" y2="${cy + R}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient><linearGradient id="${p}s" x1="0" y1="${cy - R}" x2="0" y2="${cy}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#fff" stop-opacity=".4"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient></defs>` +
    `<path d="${hexPath(cx, cy, R)}" fill="url(#${p})" stroke="#fff" stroke-opacity=".45" stroke-width="${r2(R * 0.035)}"/>` +
    `<path d="M${cx} ${r2(cy - R)}L${r2(cx + R * 0.866)} ${r2(cy - R / 2)}V${cy}H${r2(cx - R * 0.866)}V${r2(cy - R / 2)}Z" fill="url(#${p}s)"/>` + glyph(rank.icon, cx, cy, (R * 1.35) / 48, 2.2);
}
function tee05() {
  const cx = 2250, R = 290;
  const pos = RANKS.map((_, i) => ({ x: i % 2 ? 3050 : 1450, y: 4600 - i * 640 }));
  const path = "M" + pos.map((p) => `${p.x} ${p.y}`).join("L");
  let items = "";
  RANKS.forEach((rk, i) => {
    const { x, y } = pos[i], right = i % 2 === 0, lx = right ? x + R + 130 : x - R - 130, anchor = right ? "start" : "end";
    items += rankHex(`t5r${i}`, x, y, R, rk);
    items += text(rk.name.toUpperCase(), { size: 230, x: lx, y: y + 40, anchor, tracking: 0.06 });
    items += text(`LEVEL ${rk.levels}`, { w: 500, size: 115, x: lx, y: y + 200, anchor, tracking: 0.2, fill: C.lilac });
  });
  const body = `<defs><linearGradient id="t5head" x1="900" y1="0" x2="3600" y2="0" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${C.lilac}"/><stop offset=".5" stop-color="${C.violet}"/><stop offset="1" stop-color="${C.cyan}"/></linearGradient>
<linearGradient id="t5line" x1="0" y1="4600" x2="0" y2="1700" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${C.lilac}" stop-opacity=".35"/><stop offset="1" stop-color="${C.cyan}"/></linearGradient></defs>
${stars(160, [200, 1500, 4100, 3500], { seed: 55, min: 3, max: 10 })}
${mark(cx - 520, 250, 170, "t5m")}
${text("QUASARIA", { w: 500, size: 120, x: cx - 310, y: 380, anchor: "start", tracking: 0.5, fill: C.lilac })}
${text("FROM STARDUST", { size: fit("FROM STARDUST", 3900, { tracking: 0.02 }), x: cx, y: 1000, tracking: 0.02 })}
${text("TO QUASAR", { size: fit("FROM STARDUST", 3900, { tracking: 0.02 }), x: cx, y: 1530, tracking: 0.02, fill: "url(#t5head)" })}
<path d="${path}" fill="none" stroke="url(#t5line)" stroke-width="22" stroke-dasharray="2 70" stroke-linecap="round"/>
${items}
${text("LEARN · TRY ONCE · LEVEL UP", { w: 500, size: 130, x: cx, y: 5180, tracking: 0.3, fill: C.cyan })}`;
  return svgDoc(W, H, body, { title: "Quasaria — From Stardust to Quasar (rank ladder)", desc: "The five Quasaria ranks as an ascending badge ladder" });
}

// ------------------------------------------------------------------ hoodie
function hoodieFront() {
  const cx = 2250, my = 1250;
  const body = `${stars(140, [300, 200, 3900, 2300], { seed: 9, min: 3, max: 11, keep: (x, y) => Math.hypot(x - cx, y - my) > 820 })}
<g fill="none" stroke="${C.lilac}" transform="rotate(-18 ${cx} ${my})"><ellipse cx="${cx}" cy="${my}" rx="1250" ry="400" stroke-width="12" opacity=".45"/><ellipse cx="${cx}" cy="${my}" rx="1560" ry="520" stroke-width="10" opacity=".25" stroke-dasharray="6 46" stroke-linecap="round"/></g>
<circle cx="${cx + 1060}" cy="${my - 620}" r="34" fill="${C.cyan}" transform="rotate(-18 ${cx} ${my})"/>
${mark(cx - 750, my - 750, 1500, "hf")}
${text("QUASARIA", { size: fit("QUASARIA", 3400, { tracking: 0.16 }), x: cx, y: 2800, tracking: 0.16 })}
<path d="M1300 2960H3200" stroke="${C.violet}" stroke-width="10"/>
${text("SINGULARITY SERIES · 2026", { w: 500, size: 130, x: cx, y: 3170, tracking: 0.42, fill: C.lilac })}`;
  return svgDoc(W, H, body, { title: "Quasaria — Singularity hoodie front", desc: "Centre-chest mark with orbit rings and wordmark (kept above the kangaroo pocket)" });
}
function hoodieSleeve() {
  const w = 1200, h = 4800, s = "FROM STARDUST TO QUASAR";
  const body = `<g transform="translate(600 2150) rotate(-90)">${text(s, { size: fit(s, 3700, { tracking: 0.2 }), x: 0, y: 80, tracking: 0.2, fill: "#fff" })}</g>
${mark(350, 4250, 500, "hs")}`;
  return svgDoc(w, h, body, { title: "Quasaria — hoodie sleeve print (4×16 in)", desc: "Vertical text reading up from the cuff, mark at the cuff" });
}

// ------------------------------------------------------------------ cap · embroidery (600 DPI, 4 × 1.75 in)
const capMark3 = () => svgDoc(2400, 1050, flatMark(750, 75, 900), { title: "Quasaria — cap embroidery mark, 3 thread colours", desc: "Flat fills only: violet #7C5CFF, cyan #22D3EE, white. Min detail ≥ 1.2 mm at 1.5 in tall" });
const capMark1 = () => svgDoc(2400, 1050, flatMark(750, 75, 900, { ring: "#fff", tail: "#fff", core: "#fff", glint: "#fff" }), { title: "Quasaria — cap embroidery mark, 1 thread colour (white)", desc: "Single-colour variant for tonal or budget embroidery" });
function capLockup() {
  const t = "Quasaria", size = fit(t, 1550, { tracking: -0.01 });
  return svgDoc(2700, 1050, flatMark(80, 175, 700) + text(t, { size, x: 900, y: 525 + size * 0.24, anchor: "start", tracking: -0.01, fill: "#fff" }), { title: "Quasaria — cap embroidery lockup (4.5 × 1.75 in @ 600 DPI)", desc: "3-colour flat mark + white wordmark" });
}

// ------------------------------------------------------------------ stickers
const dark = (p) => `<defs><radialGradient id="${p}bg" cx="0" cy="-80" r="520" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#1c1542"/><stop offset="1" stop-color="${C.base}"/></radialGradient></defs>`;
export const STICKERS = [
  { id: "logo", name: "Singularity Q", shape: { type: "circle", r: 330 }, draw: (p) => `${dark(p)}<path d="${shapePath({ type: "circle", r: 330 })}" fill="url(#${p}bg)"/>${stars(40, [-300, -300, 600, 600], { seed: 4, min: 2, max: 5, keep: (x, y) => Math.hypot(x, y) < 300 && Math.hypot(x, y) > 250 })}<circle r="298" fill="none" stroke="${C.lilac}" stroke-opacity=".35" stroke-width="6"/>${mark(-250, -250, 500, p + "m")}` },
  { id: "lockup", name: "Quasaria wordmark", shape: { type: "rrect", w: 1180, h: 320, rx: 160 }, draw: (p) => `<path d="${shapePath({ type: "rrect", w: 1180, h: 320, rx: 160 })}" fill="${C.base}"/>${mark(-520, -120, 240, p + "m")}${text("Quasaria", { size: fit("Quasaria", 760, { tracking: -0.01 }), x: -250, y: 62, anchor: "start", tracking: -0.01 })}` },
  { id: "risk", name: "Read the risk guide", shape: { type: "rrect", w: 1180, h: 230, rx: 115 }, draw: (p) => `<path d="${shapePath({ type: "rrect", w: 1180, h: 230, rx: 115 })}" fill="#07231c"/>${hexBadge(p + "b", -470, 0, 3.6, HUES.green, "shield")}${text("READ THE RISK GUIDE", { size: fit("READ THE RISK GUIDE", 780, { tracking: 0.08 }), x: -350, y: 8, anchor: "start", tracking: 0.08 })}${text("DYOR · TESTNET FIRST", { w: 500, size: 46, x: -350, y: 72, anchor: "start", tracking: 0.24, fill: "#6ee7b7" })}` },
  ...RANKS.map((rk, i) => ({ id: `rank-${rk.name.toLowerCase()}`, name: `${rk.name} rank`, shape: { type: "hex", a: 180, rc: 34 }, draw: (p) => `<defs><linearGradient id="${p}g" x1="-180" y1="-200" x2="180" y2="200" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${rk.grad[0]}"/><stop offset="1" stop-color="${rk.grad[1]}"/></linearGradient><linearGradient id="${p}s" x1="0" y1="-210" x2="0" y2="0" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#fff" stop-opacity=".35"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient></defs><path d="${shapePath({ type: "hex", a: 180, rc: 34 })}" fill="url(#${p}g)"/><path d="${shapePath({ type: "hex", a: 180, rc: 34 })}" fill="url(#${p}s)"/>${glyph(rk.icon, 0, -45, 4.6, 2.3)}${text(rk.name.toUpperCase(), { size: Math.min(62, fit(rk.name.toUpperCase(), 290, { tracking: 0.08 })), x: 0, y: 105, tracking: 0.08 })}${text(`LV ${rk.levels}`, { w: 500, size: 34, x: 0, y: 152, tracking: 0.2, fill: "#fff", attrs: 'opacity=".8"' })}`, i })),
  ...[["risk-aware", "RISK AWARE", "green", "shield"], ["calculated", "CALCULATED", "gold", "abacus"], ["guardian", "SLIPPAGE GUARDIAN", "cyan", "gauge"], ["navigator", "NAVIGATOR", "violet", "compass"], ["constellation", "CONSTELLATION", "rose", "flame"]].map(([id, name, hue, icon]) => ({
    id: `badge-${id}`, name: `${name[0]}${name.slice(1).toLowerCase()} badge`, shape: { type: "circle", r: 190 },
    draw: (p) => `<path d="${shapePath({ type: "circle", r: 190 })}" fill="${C.ink}"/><circle r="172" fill="none" stroke="${HUES[hue][0]}" stroke-opacity=".5" stroke-width="5"/>${hexBadge(p + "b", 0, -42, 4.2, HUES[hue], icon)}${name.length > 12 && name.includes(" ") ? name.split(" ").map((ln, k) => text(ln, { size: 36, x: 0, y: 108 + k * 44, tracking: 0.1 })).join("") : text(name, { size: Math.min(40, fit(name, 260, { tracking: 0.1 })), x: 0, y: 124, tracking: 0.1 })}`,
  })),
  { id: "level-up", name: "Level up! pixel", shape: { type: "rrect", w: 720, h: 270, rx: 44 }, draw: (p) => `<path d="${shapePath({ type: "rrect", w: 720, h: 270, rx: 44 })}" fill="#120b2e"/>${pixelText("LEVEL UP!", { x: 11, y: -95 + 11, px: 11, fill: C.violet })}${pixelText("LEVEL UP!", { x: 0, y: -95, px: 11, fill: C.gold })}${pixelText("QUASAR RANK", { x: 0, y: 30, px: 7.5, fill: C.cyan })}` },
  { id: "pixel-q", name: "Pixel Q", shape: { type: "rrect", w: 360, h: 360, rx: 64 }, draw: (p) => `<path d="${shapePath({ type: "rrect", w: 360, h: 360, rx: 64 })}" fill="${C.ink}"/>${pixelQ(-143, -143, 13, 22)}` },
  { id: "stardust-quasar", name: "From Stardust to Quasar", shape: { type: "rrect", w: 940, h: 180, rx: 90 }, draw: (p) => `<defs><linearGradient id="${p}g" x1="-470" y1="0" x2="470" y2="0" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#6d4aff"/><stop offset="1" stop-color="#0891b2"/></linearGradient></defs><path d="${shapePath({ type: "rrect", w: 940, h: 180, rx: 90 })}" fill="url(#${p}g)"/>${text("FROM STARDUST TO QUASAR", { size: fit("FROM STARDUST TO QUASAR", 780, { tracking: 0.08 }), x: 0, y: 22, tracking: 0.08 })}` },
  { id: "pioneer", name: "Testnet pioneer", shape: { type: "rrect", w: 940, h: 180, rx: 90 }, draw: (p) => `<path d="${shapePath({ type: "rrect", w: 940, h: 180, rx: 90 })}" fill="${C.base}"/><path d="${shapePath({ type: "rrect", w: 900, h: 140, rx: 70 })}" fill="none" stroke="${C.cyan}" stroke-width="6"/><path d="${sparkle(-370, 0, 34)}" fill="${C.cyan}"/><path d="${sparkle(370, 0, 34)}" fill="${C.cyan}"/>${text("TESTNET PIONEER", { size: fit("TESTNET PIONEER", 600, { tracking: 0.14 }), x: 0, y: 24, tracking: 0.14, fill: C.cyan })}` },
  { id: "gm", name: "gm, stardust", shape: { type: "rrect", w: 760, h: 230, rx: 115 }, draw: (p) => `<defs><linearGradient id="${p}g" x1="-380" y1="-115" x2="380" y2="115" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#ede9fe"/><stop offset="1" stop-color="${C.lilac}"/></linearGradient></defs><path d="${shapePath({ type: "rrect", w: 760, h: 230, rx: 115 })}" fill="url(#${p}g)"/><path d="${sparkle(-265, -8, 52)}" fill="${C.violet}"/>${text("gm, stardust.", { size: fit("gm, stardust.", 480), x: 40, y: 34, fill: "#1e1250" })}` },
];
const SHEET_POS = { logo: [560, 530], lockup: [1730, 390], risk: [1730, 770], "level-up": [560, 2520], "pixel-q": [560, 2970], "stardust-quasar": [1720, 2430], pioneer: [1720, 2690], gm: [1720, 2990] };
RANKS.forEach((rk, i) => (SHEET_POS[`rank-${rk.name.toLowerCase()}`] = [330 + i * 472.5, 1330]));
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
  return svgDoc(2550, 3300, g, { title: `Quasaria die-cut sticker sheet (8.5 × 11 in @ 300 DPI)${cut ? " with cut lines" : ""}`, desc: "18 stickers: logo, wordmark, risk-guide pill, 5 rank badges, 5 quest badges, pixel stickers and slogans" });
}

// ------------------------------------------------------------------ mug wrap (11 oz, 2700 × 1050)
function mugWrap() {
  const w = 2700, h = 1050;
  const hexes = RANKS.map((rk, i) => rankHex(`mw${i}`, 1640 + i * 180, 555, 78, rk) + (i < 4 ? `<path d="M${1640 + i * 180 + 82} 555l16 -14v28z" fill="${C.lilac}" opacity=".7"/>` : "")).join("");
  const body = `<defs><linearGradient id="mwbg" x1="0" y1="0" x2="0" y2="${h}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#0d0b24"/><stop offset="1" stop-color="${C.base}"/></linearGradient>
<radialGradient id="mwglow" cx="700" cy="420" r="520" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${C.violet}" stop-opacity=".35"/><stop offset="1" stop-color="${C.violet}" stop-opacity="0"/></radialGradient></defs>
<rect width="${w}" height="${h}" fill="url(#mwbg)"/>
<rect width="${w}" height="${h}" fill="url(#mwglow)"/>
${stars(260, [0, 0, w, h], { seed: 11, min: 1.5, max: 5.5 })}
${mark(700 - 250, 130, 500, "mwm")}
${text("Quasaria", { size: fit("Quasaria", 640, { tracking: -0.01 }), x: 700, y: 850, tracking: -0.01 })}
${text("gm, stardust.", { size: 150, x: 2000, y: 370 })}
${hexes}
${text("FROM STARDUST TO QUASAR", { w: 500, size: 52, x: 2000, y: 760, tracking: 0.3, fill: C.lilac })}
<path d="M1350 160V890" stroke="${C.lilac}" stroke-opacity=".12" stroke-width="3" stroke-dasharray="2 18" stroke-linecap="round"/>`;
  return svgDoc(w, h, body, { title: "Quasaria — 11 oz mug wrap (2700 × 1050 px)", desc: "Full-bleed wrap: logo side + 'gm, stardust' rank side" });
}

// ------------------------------------------------------------------ catalogue
export const DESIGNS = [
  { id: "tee-01-singularity-chest", file: "tee-01-singularity-chest-5x5in", w: 1500, h: 1500, svg: tee01Chest, kind: "Tee · left chest", garments: "Black, Navy, Heather Charcoal (any dark tee)", note: "5 × 5 in left-chest placement." },
  { id: "tee-01-singularity-front", file: "tee-01-singularity-chest-on-front-canvas", w: W, h: H, svg: tee01Front, kind: "Tee · front canvas", garments: "Black, Navy, Heather Charcoal", note: "Same art pre-positioned on a 15 × 18 in front canvas (wearer's left chest) for providers that only take a full-front file." },
  { id: "tee-02-quasar-core-back", file: "tee-02-quasar-core-back", w: W, h: H, svg: tee02Back, kind: "Tee · full back", garments: "Black only (glows need a dark shirt)", note: "Soft glows use transparency — ask for DTG with white underbase; keep 'transparent pixels as garment colour'." },
  { id: "tee-02-quasar-core-chest", file: "tee-02-quasar-core-front-chest-5x5in", w: 1500, h: 1500, svg: tee02FrontChest, kind: "Tee · left chest", garments: "Black", note: "Front chest mark that pairs with the back print." },
  { id: "tee-03-speed-of-light", file: "tee-03-speed-of-light-retro", w: W, h: H, svg: tee03, kind: "Tee · full front", garments: "Black, Deep Purple, Navy", note: "Synthwave sun + chrome type." },
  { id: "tee-04-level-up-arcade", file: "tee-04-level-up-quasar-rank-pixel", w: W, h: H, svg: tee04, kind: "Tee · full front", garments: "Black, Navy, Deep Purple", note: "Pure flat colour pixel art — also works as a 5-colour screen print." },
  { id: "tee-05-stardust-to-quasar", file: "tee-05-stardust-to-quasar-ladder", w: W, h: H, svg: tee05, kind: "Tee · full front", garments: "Black, Heather Charcoal, Navy", note: "Ties into the in-app rank ladder." },
  { id: "hoodie-front", file: "hoodie-singularity-front", w: W, h: H, svg: hoodieFront, kind: "Hoodie · front", garments: "Black, Navy", note: "Art sits in the top ~60% so it clears the kangaroo pocket." },
  { id: "hoodie-sleeve", file: "hoodie-singularity-sleeve-4x16in", w: 1200, h: 4800, svg: hoodieSleeve, kind: "Hoodie · left sleeve", garments: "Black, Navy", note: "Optional sleeve print, reads upward from the cuff." },
  { id: "cap-mark-3c", file: "cap-embroidery-mark-3color-600dpi", w: 2400, h: 1050, svg: capMark3, kind: "Cap · embroidery", garments: "Black, Navy dad cap / structured snapback", note: "4 × 1.75 in @ 600 DPI, 3 threads: violet #7C5CFF, cyan #22D3EE, white. No gradients, no hairlines." },
  { id: "cap-mark-1c", file: "cap-embroidery-mark-1color-white-600dpi", w: 2400, h: 1050, svg: capMark1, kind: "Cap · embroidery", garments: "Any dark cap (tonal: swap white for a matching thread)", note: "1 thread." },
  { id: "cap-lockup", file: "cap-embroidery-lockup-600dpi", w: 2700, h: 1050, svg: capLockup, kind: "Cap · embroidery", garments: "Black, Navy", note: "4.5 × 1.75 in; wordmark cap-height ≈ 0.45 in (well above the 0.25 in embroidery minimum)." },
  { id: "sticker-sheet", file: "sticker-sheet-letter-print-with-cutlines", w: 2550, h: 3300, svg: () => stickerSheet({ cut: true }), kind: "Stickers · sheet", garments: "White vinyl, kiss-cut or die-cut", note: "8.5 × 11 in; magenta #EC008C hairlines = CutContour, 18 px bleed." },
  { id: "sticker-sheet-preview", file: "sticker-sheet-letter-preview", w: 2550, h: 3300, svg: () => stickerSheet({ cut: false }), kind: "Stickers · sheet", garments: "—", note: "Same sheet without cut lines/bleed (for previews and web)." },
  { id: "mug-wrap", file: "mug-11oz-wrap", w: 2700, h: 1050, svg: mugWrap, kind: "Mug · 11 oz wrap", garments: "Black or white 11 oz ceramic (full-bleed dark wrap)", note: "Check the provider's current template; keep text 0.25 in from edges." },
];
export { measure };
