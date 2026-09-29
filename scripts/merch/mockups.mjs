// Programmatic product mockups (v4): photographic-style studio renders in a 1000×1000 scene.
// Dark grey spotlight backdrop, garment silhouettes with procedural fabric (turbulence →
// diffuse lighting) plus hand-placed folds, the EXACT print artwork displaced by the same
// fabric so it sits in the cloth, and an iridescent sheen for the pearl tee.
const uri = (svg) => `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
export const GARMENT = { black: "#141417", navy: "#1B2446", pearl: "#E6E8EE" };
export const STUDIO_BG = "#0B0B0D";
const lum = (hex) => { const n = parseInt(hex.slice(1), 16); return (0.2126 * (n >> 16) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255; };

const studio = (id) => `<defs><radialGradient id="${id}bg" cx="500" cy="300" r="780" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#63666F"/><stop offset=".38" stop-color="#34363C"/><stop offset=".72" stop-color="#16171A"/><stop offset="1" stop-color="#0A0A0C"/></radialGradient>
<linearGradient id="${id}floor" x1="0" y1="760" x2="0" y2="1000" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".45"/></linearGradient>
<filter id="${id}soft" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="14"/></filter>
<filter id="${id}b8" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="8"/></filter>
<filter id="${id}b3" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="3"/></filter>
<filter id="${id}b20" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="22"/></filter>
<filter id="${id}noise" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" seed="3"/><feColorMatrix values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 .5 0"/><feComposite in2="SourceGraphic" operator="in"/></filter>
<filter id="${id}wr" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB"><feTurbulence type="fractalNoise" baseFrequency=".010 .004" numOctaves="3" seed="11" result="n"/><feDiffuseLighting in="n" surfaceScale="7" diffuseConstant="1.05" lighting-color="#fff"><feDistantLight azimuth="235" elevation="48"/></feDiffuseLighting></filter>
<filter id="${id}dsp" x="-5%" y="-5%" width="110%" height="110%"><feTurbulence type="fractalNoise" baseFrequency=".010 .004" numOctaves="3" seed="11" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="9" xChannelSelector="R" yChannelSelector="G"/></filter>
<filter id="${id}irid" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency=".004 .007" numOctaves="2" seed="21" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="240" xChannelSelector="R" yChannelSelector="B"/><feGaussianBlur stdDeviation="6"/></filter></defs>
<rect width="1000" height="1000" fill="url(#${id}bg)"/><rect width="1000" height="1000" fill="url(#${id}floor)"/>
<ellipse cx="500" cy="120" rx="360" ry="200" fill="#fff" opacity=".05" filter="url(#${id}b20)"/>
<rect width="1000" height="1000" fill="#fff" filter="url(#${id}noise)" opacity=".05"/>`;
const scene = (body) => `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="1000" height="1000" viewBox="0 0 1000 1000">${body}</svg>`;
const cylinder = (id, x0, x1, a = 0.42) => `<linearGradient id="${id}" x1="${x0}" y1="0" x2="${x1}" y2="0" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#000" stop-opacity="${a}"/><stop offset=".18" stop-color="#000" stop-opacity=".08"/><stop offset=".42" stop-color="#fff" stop-opacity=".06"/><stop offset=".82" stop-color="#000" stop-opacity=".12"/><stop offset="1" stop-color="#000" stop-opacity="${a}"/></linearGradient>`;
/** Procedural fabric: wrinkle light map screened (highlights) + multiplied (shadows) over the garment. */
const fabric = (id, color, k = 1) => { const L = lum(color); return `<rect width="1000" height="1000" fill="#000" filter="url(#${id}wr)" style="mix-blend-mode:multiply" opacity="${(L > 0.5 ? 0.42 : 0.8) * k}"/><rect width="1000" height="1000" fill="#000" filter="url(#${id}wr)" style="mix-blend-mode:screen" opacity="${(L > 0.5 ? 0.12 : 0.075) * k}"/>`; };
const img = (id, art, x, y, w, h, extra = "") => `<image href="${uri(art)}" x="${x}" y="${y}" width="${w}" height="${h}" preserveAspectRatio="xMidYMid meet" filter="url(#${id}dsp)" ${extra}/>`;
/** Pearl / holographic sheen: displaced pastel bands, multiplied + screened. */
const iridescent = (id) => `<linearGradient id="${id}ir" x1="150" y1="120" x2="850" y2="900" gradientUnits="userSpaceOnUse" spreadMethod="reflect">${["#F4D8EE", "#D5ECFF", "#E4DCFF", "#D3F6F0", "#F7E7DA", "#DCE3FF", "#F4D8EE"].map((c, i) => `<stop offset="${(i / 6).toFixed(3)}" stop-color="${c}"/>`).join("")}</linearGradient>`;

// ------------------------------------------------------------------ t-shirt (oversized, dropped shoulder)
const TEE = "M392 112C425 164 575 164 608 112L706 138C770 158 836 205 884 268L818 400C794 386 764 370 740 360C743 525 747 705 752 888C600 904 400 904 248 888C253 705 257 525 260 360C236 370 206 386 182 400L116 268C164 205 230 158 294 138Z";
const TEE_BACK = "M392 112C430 132 570 132 608 112L706 138C770 158 836 205 884 268L818 400C794 386 764 370 740 360C743 525 747 705 752 888C600 904 400 904 248 888C253 705 257 525 260 360C236 370 206 386 182 400L116 268C164 205 230 158 294 138Z";
/** placement: front | chest | back | none. sleeve: art on the wearer's-left sleeve. label: neck label art. */
export function tee({ color, art, placement = "front", sleeve, label, pearl = false, aspect = 5400 / 4500 }) {
  const back = placement === "back", path = back ? TEE_BACK : TEE, L = lum(color);
  const pw = placement === "chest" ? 96 : 360, ph = placement === "chest" ? 96 : pw * aspect;
  const px = placement === "chest" ? 556 : 500 - pw / 2, py = placement === "chest" ? 222 : back ? 190 : 214;
  const sh = L > 0.5 ? 0.22 : 0.36;
  const folds = `<g filter="url(#tsoft)" fill="none" stroke-linecap="round">
    <path d="M300 395C330 530 318 660 345 840" stroke="#000" stroke-opacity="${sh}" stroke-width="22"/>
    <path d="M692 410C668 548 690 708 662 868" stroke="#000" stroke-opacity="${sh * 0.9}" stroke-width="22"/>
    <path d="M268 368C330 408 382 428 432 440" stroke="#000" stroke-opacity="${sh}" stroke-width="12"/>
    <path d="M732 368C670 408 618 428 568 440" stroke="#000" stroke-opacity="${sh}" stroke-width="12"/>
    <path d="M362 300C382 480 386 660 374 870" stroke="#fff" stroke-opacity="${L > 0.5 ? 0.35 : 0.07}" stroke-width="40"/>
    <path d="M632 300C614 480 624 660 642 870" stroke="#fff" stroke-opacity="${L > 0.5 ? 0.25 : 0.05}" stroke-width="30"/>
    <path d="M430 640C470 662 530 662 578 636" stroke="#000" stroke-opacity="${sh * 0.6}" stroke-width="14"/>
    <path d="M158 300C188 332 214 352 250 364" stroke="#000" stroke-opacity="${sh * 0.8}" stroke-width="10"/>
    <path d="M842 300C812 332 786 352 750 364" stroke="#000" stroke-opacity="${sh * 0.8}" stroke-width="10"/>
  </g>`;
  const inner = L > 0.5 ? "#C9CCD6" : "#050507";
  const collar = back
    ? `<path d="M392 112C430 132 570 132 608 112" fill="none" stroke="#000" stroke-opacity=".35" stroke-width="16"/>`
    : `<path d="M410 106C450 90 550 90 590 106C575 134 425 134 410 106Z" fill="${inner}"/>` +
      (label ? `<image href="${uri(label)}" x="478" y="97" width="44" height="16.5"/>` : "") +
      `<path d="M392 112C425 164 575 164 608 112L592 106C562 148 438 148 408 106Z" fill="${color}"/><path d="M392 112C425 164 575 164 608 112L592 106C562 148 438 148 408 106Z" fill="#000" fill-opacity=".12"/><path d="M398 116C430 160 570 160 602 116" fill="none" stroke="#000" stroke-opacity=".3" stroke-width="2"/>`;
  return scene(`${studio("t")}<defs><clipPath id="tclip"><path d="${path}"/></clipPath>${cylinder("tcyl", 116, 884, L > 0.5 ? 0.25 : 0.42)}${pearl ? iridescent("t") : ""}
  <linearGradient id="tvert" x1="0" y1="110" x2="0" y2="905" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#fff" stop-opacity=".07"/><stop offset=".35" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".24"/></linearGradient></defs>
  <ellipse cx="500" cy="918" rx="330" ry="22" fill="#000" opacity=".55" filter="url(#tb20)"/>
  <path d="${path}" fill="${color}"/>
  <g clip-path="url(#tclip)"><rect width="1000" height="1000" fill="${color}"/>
    ${pearl ? `<rect x="-200" y="-200" width="1400" height="1400" fill="url(#tir)" filter="url(#tirid)" style="mix-blend-mode:multiply" opacity=".9"/>` : ""}
    ${art && placement !== "none" ? img("t", art, px, py, pw, ph, 'opacity=".97"') : ""}
    ${sleeve ? `<g transform="translate(810 322) rotate(-60)">${img("t", sleeve, -58, -17, 116, 35)}</g>` : ""}
    ${fabric("t", color)}
    ${folds}
    <rect width="1000" height="1000" fill="url(#tcyl)"/><rect width="1000" height="1000" fill="url(#tvert)"/>
    ${pearl ? `<rect x="-200" y="-200" width="1400" height="1400" fill="url(#tir)" filter="url(#tirid)" style="mix-blend-mode:screen" opacity=".35"/>` : ""}
    <path d="M294 138C279 228 262 300 260 360M706 138C721 228 738 300 740 360" fill="none" stroke="#000" stroke-opacity=".35" stroke-width="2.5"/>
    <path d="M186 378L122 268M814 378L878 268" fill="none" stroke="#fff" stroke-opacity=".06" stroke-width="2" stroke-dasharray="5 5"/>
    <path d="M252 870C400 885 600 885 748 870" fill="none" stroke="${L > 0.5 ? "#000" : "#fff"}" stroke-opacity=".1" stroke-width="2" stroke-dasharray="6 6"/>
  </g>${collar}`);
}

// ------------------------------------------------------------------ hoodie
export function hoodie({ color, art, artW = 300, artY = 236 }) {
  const body = "M360 150C420 205 580 205 640 150L720 175L746 400L748 900C600 915 400 915 252 900L254 400L280 175Z";
  const sleeveR = "M720 175C790 195 836 255 848 330L886 770L800 782L762 450L746 400Z", sleeveL = "M280 175C210 195 164 255 152 330L114 770L200 782L238 450L254 400Z";
  const cuffR = "M800 782L886 770L892 832L806 844Z", cuffL = "M200 782L114 770L108 832L194 844Z";
  const ribs = (x0, x1, y0, y1, n) => [...Array(n)].map((_, i) => { const t = (i + 0.5) / n; return `M${x0 + (x1 - x0) * t} ${y0}V${y1}`; }).join("");
  return scene(`${studio("h")}<defs><clipPath id="hclip"><path d="${body}"/></clipPath><clipPath id="hsl"><path d="${sleeveL}"/><path d="${sleeveR}"/><path d="M330 172C318 70 408 22 500 22C592 22 682 70 670 172Z"/></clipPath>${cylinder("hcyl", 250, 750, 0.5)}${cylinder("hcylS", 110, 890, 0.4)}
  <radialGradient id="hhood" cx="500" cy="60" r="200" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#fff" stop-opacity=".08"/><stop offset="1" stop-color="#000" stop-opacity=".35"/></radialGradient><linearGradient id="hin" x1="0" y1="58" x2="0" y2="205" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#1a1c24"/><stop offset="1" stop-color="#040406"/></linearGradient><linearGradient id="hvert" x1="0" y1="120" x2="0" y2="920" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#fff" stop-opacity=".07"/><stop offset=".4" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".25"/></linearGradient></defs>
  <ellipse cx="500" cy="925" rx="340" ry="22" fill="#000" opacity=".55" filter="url(#hb20)"/>
  <path d="M330 172C318 70 408 22 500 22C592 22 682 70 670 172Z" fill="${color}"/><path d="M330 172C318 70 408 22 500 22C592 22 682 70 670 172Z" fill="url(#hhood)"/>
  <path d="M382 172C378 98 436 58 500 58C564 58 622 98 618 172C584 212 416 212 382 172Z" fill="url(#hin)"/><path d="M382 172C378 98 436 58 500 58C564 58 622 98 618 172" fill="none" stroke="#fff" stroke-opacity=".1" stroke-width="3"/>
  <path d="${sleeveL}" fill="${color}"/><path d="${sleeveR}" fill="${color}"/><g clip-path="url(#hsl)"><rect width="1000" height="1000" fill="${color}"/>${fabric("h", color, 0.8)}</g><path d="${sleeveL}" fill="url(#hcylS)"/><path d="${sleeveR}" fill="url(#hcylS)"/>
  <path d="${cuffL}" fill="${color}"/><path d="${cuffR}" fill="${color}"/><path d="${cuffL}" fill="#000" fill-opacity=".22"/><path d="${cuffR}" fill="#000" fill-opacity=".22"/>
  <path d="${ribs(114, 194, 776, 840, 12)}${ribs(806, 886, 776, 840, 12)}" stroke="#000" stroke-opacity=".3" stroke-width="2"/>
  <g filter="url(#hsoft)" fill="none"><path d="M205 420C195 560 185 680 175 760" stroke="#000" stroke-opacity=".3" stroke-width="18"/><path d="M795 420C805 560 815 680 825 760" stroke="#000" stroke-opacity=".3" stroke-width="18"/></g>
  <path d="${body}" fill="${color}"/>
  <g clip-path="url(#hclip)"><rect width="1000" height="1000" fill="${color}"/>
    ${img("h", art, 500 - artW / 2, artY, artW, artW * 4200 / 3600, 'opacity=".97"')}
    <path d="M330 650L670 650L722 842L278 842Z" fill="${color}"/><path d="M330 650L670 650L722 842L278 842Z" fill="#000" fill-opacity=".12"/>
    <path d="M330 650C305 720 290 790 278 842M670 650C695 720 710 790 722 842" fill="none" stroke="#000" stroke-opacity=".5" stroke-width="4"/>
    <path d="M336 656H664" stroke="#fff" stroke-opacity=".12" stroke-width="2" stroke-dasharray="5 5"/>
    ${fabric("h", color)}
    <g filter="url(#hsoft)" fill="none"><path d="M300 420C320 560 312 700 330 860" stroke="#000" stroke-opacity=".3" stroke-width="20"/><path d="M700 420C680 560 690 700 670 860" stroke="#000" stroke-opacity=".3" stroke-width="20"/><path d="M380 320C395 480 400 560 392 640" stroke="#fff" stroke-opacity=".05" stroke-width="40"/></g>
    <rect width="1000" height="1000" fill="url(#hcyl)"/><rect width="1000" height="1000" fill="url(#hvert)"/>
    <path d="M248 848H752V920H248Z" fill="#000" fill-opacity=".22"/><path d="${ribs(252, 748, 850, 915, 70)}" stroke="#000" stroke-opacity=".25" stroke-width="2"/>
    <rect width="1000" height="1000" fill="#fff" filter="url(#hnoise)" opacity=".1" style="mix-blend-mode:overlay"/>
  </g>
  <path d="M360 150C380 205 450 228 500 232C550 228 620 205 640 150" fill="none" stroke="#000" stroke-opacity=".45" stroke-width="5"/>
  <g stroke-linecap="round"><path d="M468 214C466 290 462 340 458 402" stroke="#d9dce6" stroke-width="6" fill="none"/><path d="M532 214C534 290 538 340 542 402" stroke="#d9dce6" stroke-width="6" fill="none"/></g>
  <rect x="452" y="398" width="12" height="26" rx="4" fill="#9aa0b3"/><rect x="536" y="398" width="12" height="26" rx="4" fill="#9aa0b3"/>
  <circle cx="468" cy="214" r="6" fill="#9aa0b3"/><circle cx="532" cy="214" r="6" fill="#9aa0b3"/>`);
}

// ------------------------------------------------------------------ bomber jacket
export function bomber({ color, patch, placket, label }) {
  const body = "M322 168C372 152 414 146 438 150L562 150C586 146 628 152 678 168L738 192L754 432L760 806C600 820 400 820 240 806L246 432L262 192Z";
  const hem = "M240 800C400 814 600 814 760 800L754 866C600 880 400 880 246 866Z";
  const sleeveL = "M262 192C200 208 166 264 156 334L124 764L204 776L238 454L246 432Z", sleeveR = "M738 192C800 208 834 264 844 334L876 764L796 776L762 454L754 432Z";
  const cuffL = "M204 770L124 758L118 830L198 842Z", cuffR = "M796 770L876 758L882 830L802 842Z";
  const collar = "M392 124C446 112 554 112 608 124L622 172C562 158 438 158 378 172Z";
  const ribs = (x0, x1, y0, y1, n, skew = 0) => [...Array(n)].map((_, i) => { const t = (i + 0.5) / n, x = x0 + (x1 - x0) * t; return `M${x.toFixed(1)} ${y0}L${(x + skew).toFixed(1)} ${y1}`; }).join("");
  const teeth = [...Array(88)].map((_, i) => `M${i % 2 ? 497 : 500} ${164 + i * 8}h3`).join("");
  return scene(`${studio("b")}<defs><clipPath id="bclip"><path d="${body}"/></clipPath><clipPath id="bsl"><path d="${sleeveL}"/><path d="${sleeveR}"/></clipPath>${cylinder("bcyl", 240, 760, 0.55)}${cylinder("bcylS", 110, 890, 0.45)}
  <linearGradient id="bgloss" x1="300" y1="200" x2="700" y2="800" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#fff" stop-opacity=".12"/><stop offset=".4" stop-color="#fff" stop-opacity="0"/><stop offset=".7" stop-color="#fff" stop-opacity=".05"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
  <linearGradient id="bzip" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#6b7080"/><stop offset=".5" stop-color="#e6e8ee"/><stop offset="1" stop-color="#6b7080"/></linearGradient></defs>
  <ellipse cx="500" cy="905" rx="340" ry="22" fill="#000" opacity=".55" filter="url(#bb20)"/>
  <path d="${sleeveL}" fill="${color}"/><path d="${sleeveR}" fill="${color}"/>
  <g clip-path="url(#bsl)"><rect width="1000" height="1000" fill="${color}"/>${fabric("b", color, 0.9)}<g filter="url(#bsoft)" fill="none" stroke-linecap="round"><path d="M200 300C190 450 180 600 168 740" stroke="#fff" stroke-opacity=".07" stroke-width="22"/><path d="M225 460C205 520 190 560 170 600M215 620C200 660 185 690 160 720" stroke="#000" stroke-opacity=".4" stroke-width="12"/><path d="M790 460C810 520 825 560 845 600M800 620C815 660 830 690 855 720" stroke="#000" stroke-opacity=".4" stroke-width="12"/></g></g>
  <path d="${sleeveL}" fill="url(#bcylS)"/><path d="${sleeveR}" fill="url(#bcylS)"/>
  <g transform="rotate(8 800 330)"><rect x="770" y="280" width="62" height="96" rx="6" fill="${color}" stroke="#000" stroke-opacity=".45" stroke-width="2"/><rect x="770" y="280" width="62" height="96" rx="6" fill="#000" fill-opacity=".12"/><path d="M801 286V370" stroke="url(#bzip)" stroke-width="4"/><rect x="796" y="284" width="10" height="16" rx="2" fill="#c9ccd6"/><path d="M774 284h54" stroke="#fff" stroke-opacity=".12" stroke-width="1.5" stroke-dasharray="3 3"/></g>
  <path d="${cuffL}" fill="${color}"/><path d="${cuffR}" fill="${color}"/><path d="${cuffL}" fill="#000" fill-opacity=".25"/><path d="${cuffR}" fill="#000" fill-opacity=".25"/>
  <path d="${ribs(122, 202, 762, 836, 14)}${ribs(798, 878, 762, 836, 14)}" stroke="#000" stroke-opacity=".35" stroke-width="2"/>
  <path d="${body}" fill="${color}"/>
  <g clip-path="url(#bclip)"><rect width="1000" height="1000" fill="${color}"/>
    ${fabric("b", color, 1.1)}
    <g filter="url(#bsoft)" fill="none" stroke-linecap="round"><path d="M320 300C335 480 330 640 340 790" stroke="#000" stroke-opacity=".38" stroke-width="22"/><path d="M680 300C665 480 670 640 660 790" stroke="#000" stroke-opacity=".38" stroke-width="22"/><path d="M380 250C400 420 405 600 395 780" stroke="#fff" stroke-opacity=".08" stroke-width="36"/><path d="M270 600C330 640 400 660 470 668M730 600C670 640 600 660 530 668" stroke="#000" stroke-opacity=".3" stroke-width="14"/></g>
    <rect width="1000" height="1000" fill="url(#bcyl)"/><rect width="1000" height="1000" fill="url(#bgloss)"/>
    <path d="M490 160V812M510 160V812" stroke="#000" stroke-opacity=".35" stroke-width="3"/>
    ${placket ? img("b", placket, 452, 238, 30, 120, 'opacity=".95"') : ""}
    <rect x="566" y="250" width="124" height="138" rx="8" fill="#000" fill-opacity=".14"/>
    <rect x="566" y="250" width="124" height="138" rx="8" fill="none" stroke="#000" stroke-opacity=".45" stroke-width="2"/>
    <rect x="571" y="255" width="114" height="128" rx="6" fill="none" stroke="#fff" stroke-opacity=".14" stroke-width="1.2" stroke-dasharray="3 3"/>
    ${patch ? img("b", patch, 578, 258, 100, 120) : ""}
    <path d="M254 440C300 452 340 456 380 458M746 440C700 452 660 456 620 458" stroke="#000" stroke-opacity=".3" stroke-width="2"/>
  </g>
  <path d="${hem}" fill="${color}"/><path d="${hem}" fill="#000" fill-opacity=".25"/><path d="${ribs(248, 752, 806, 870, 90)}" stroke="#000" stroke-opacity=".35" stroke-width="2"/>
  <path d="M412 130C452 122 548 122 588 130L584 152C548 146 452 146 416 152Z" fill="#07080B"/>
  ${label ? `<image href="${uri(label)}" x="478" y="129" width="44" height="16.5"/>` : ""}
  <path d="${collar}" fill="${color}"/><path d="${collar}" fill="#000" fill-opacity=".25"/><path d="${ribs(394, 606, 122, 166, 44)}" stroke="#000" stroke-opacity=".35" stroke-width="1.6"/>
  <path d="M500 150V868" stroke="#2b2e38" stroke-width="12"/><path d="${teeth}" stroke="#c9ccd6" stroke-width="3"/>
  <rect x="493" y="176" width="14" height="30" rx="3" fill="url(#bzip)"/><rect x="496" y="204" width="8" height="22" rx="3" fill="#aeb3bf"/>
  <rect width="1000" height="1000" fill="#fff" filter="url(#bnoise)" opacity=".04"/>`);
}

// ------------------------------------------------------------------ cap
export function cap({ color, art, aspect = 1050 / 2400, width = 400 }) {
  const crown = "M250 592C250 412 352 284 500 280C648 284 750 412 750 592Z";
  const bill = "M258 582C330 566 670 566 742 582C756 640 664 706 500 712C336 706 244 640 258 582Z";
  const h = width * aspect;
  return scene(`${studio("c")}<defs><clipPath id="cclip"><path d="${crown}"/></clipPath>
  <radialGradient id="ccrown" cx="470" cy="370" r="420" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#fff" stop-opacity=".12"/><stop offset=".6" stop-color="#000" stop-opacity=".05"/><stop offset="1" stop-color="#000" stop-opacity=".5"/></radialGradient>
  <linearGradient id="cbill" x1="0" y1="560" x2="0" y2="745" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#000" stop-opacity=".45"/><stop offset=".3" stop-color="#fff" stop-opacity=".04"/><stop offset=".8" stop-color="#fff" stop-opacity=".1"/><stop offset="1" stop-color="#fff" stop-opacity=".04"/></linearGradient>
  <filter id="cemb" x="-10%" y="-10%" width="120%" height="120%">
    <feGaussianBlur in="SourceAlpha" stdDeviation="1.6" result="bl"/>
    <feSpecularLighting in="bl" surfaceScale="4" specularConstant=".7" specularExponent="16" lighting-color="#fff" result="sp"><fePointLight x="350" y="150" z="260"/></feSpecularLighting>
    <feComposite in="sp" in2="SourceAlpha" operator="in" result="spi"/>
    <feTurbulence type="fractalNoise" baseFrequency=".04 1.4" numOctaves="1" seed="7" result="n"/>
    <feColorMatrix in="n" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -.6 .5" result="nn"/>
    <feComposite in="nn" in2="SourceAlpha" operator="in" result="tex"/>
    <feComposite in="SourceGraphic" in2="spi" operator="arithmetic" k2="1" k3=".55" result="lit"/>
    <feComposite in="tex" in2="lit" operator="over" result="thr"/>
    <feComposite in="thr" in2="SourceAlpha" operator="in" result="thr2"/>
    <feOffset in="SourceAlpha" dy="2.5" result="off"/><feGaussianBlur in="off" stdDeviation="1.5" result="sh"/>
    <feFlood flood-color="#000" flood-opacity=".7"/><feComposite in2="sh" operator="in" result="shc"/>
    <feMerge><feMergeNode in="shc"/><feMergeNode in="thr2"/></feMerge>
  </filter></defs>
  <ellipse cx="500" cy="745" rx="300" ry="26" fill="#000" opacity=".55" filter="url(#cb20)"/>
  <path d="${crown}" fill="${color}"/>
  <g clip-path="url(#cclip)">
    <path d="M500 283C442 345 412 470 405 592M500 283C558 345 588 470 595 592M500 283C366 325 304 450 292 592M500 283C634 325 696 450 708 592" fill="none" stroke="#000" stroke-opacity=".45" stroke-width="3"/>
    <path d="M500 283C446 345 416 470 409 592M500 283C554 345 584 470 591 592" fill="none" stroke="#fff" stroke-opacity=".08" stroke-width="2" stroke-dasharray="4 4"/>
    <image href="${uri(art)}" x="${500 - width / 2}" y="${448 - h / 2}" width="${width}" height="${h}" filter="url(#cemb)"/>
    <rect width="1000" height="1000" fill="url(#ccrown)"/>
    <rect width="1000" height="1000" fill="#fff" filter="url(#cnoise)" opacity=".14" style="mix-blend-mode:overlay"/>
    <circle cx="338" cy="400" r="7" fill="#000" fill-opacity=".6"/><circle cx="662" cy="400" r="7" fill="#000" fill-opacity=".6"/>
  </g>
  <ellipse cx="500" cy="282" rx="24" ry="11" fill="${color}" stroke="#000" stroke-opacity=".4" stroke-width="2"/>
  <path d="M250 588C360 572 640 572 750 588" fill="none" stroke="#000" stroke-opacity=".7" stroke-width="8"/>
  <path d="${bill}" fill="${color}"/><path d="${bill}" fill="url(#cbill)"/><path d="M258 590C244 646 336 712 500 718C664 712 756 646 742 590" fill="none" stroke="#000" stroke-opacity=".6" stroke-width="6"/><path d="M262 584C250 640 338 704 500 710C662 704 750 640 738 584" fill="none" stroke="#fff" stroke-opacity=".16" stroke-width="2"/>
  ${[0, 1, 2, 3, 4].map((i) => `<path d="M${266 + i * 9} ${600 + i * 14}C${340 + i * 12} ${585 + i * 12} ${660 - i * 12} ${585 + i * 12} ${734 - i * 9} ${600 + i * 14}" fill="none" stroke="#fff" stroke-opacity=".12" stroke-width="1.6" stroke-dasharray="5 4"/>`).join("")}`);
}

// ------------------------------------------------------------------ mug (cylindrical projection of the wrap)
export function mug({ wrap, center = 700, body = "#101118", wrapW = 2700, wrapH = 1050 }) {
  const R = 190, cx = 500, top = 250, bot = 800, ry = 34, s = (2 * Math.PI * R) / wrapW, ph = wrapH * s, N = 120;
  let strips = "";
  for (let i = 0; i < N; i++) {
    const x0 = cx - R + (2 * R * i) / N, x1 = cx - R + (2 * R * (i + 1)) / N;
    const t0 = Math.asin((x0 - cx) / R), t1 = Math.asin(Math.min(1, (x1 - cx) / R)), tm = (t0 + t1) / 2;
    const u0 = center + (t0 * R) / s, u1 = center + (t1 * R) / s, dy = ry * Math.cos(tm);
    strips += `<svg x="${x0.toFixed(2)}" y="${(top + 22 + dy).toFixed(2)}" width="${(x1 - x0 + 0.7).toFixed(2)}" height="${ph.toFixed(2)}" viewBox="${u0.toFixed(2)} 0 ${(u1 - u0).toFixed(2)} ${wrapH}" preserveAspectRatio="none"><use href="#mw"/><use href="#mw" x="${-wrapW}"/><use href="#mw" x="${wrapW}"/></svg>`;
  }
  const light = parseInt(body.slice(1, 3), 16) > 0x99, inner = light ? "#CFCAD8" : "#050508";
  const bodyPath = `M${cx - R} ${top}V${bot}A${R} ${ry} 0 0 0 ${cx + R} ${bot}V${top}Z`;
  return scene(`${studio("g")}<defs><image id="mw" href="${uri(wrap)}" width="${wrapW}" height="${wrapH}"/><clipPath id="gclip"><path d="${bodyPath}"/></clipPath>
  <linearGradient id="gcyl" x1="${cx - R}" y1="0" x2="${cx + R}" y2="0" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#000" stop-opacity=".7"/><stop offset=".22" stop-color="#000" stop-opacity=".12"/><stop offset=".3" stop-color="#fff" stop-opacity=".22"/><stop offset=".36" stop-color="#fff" stop-opacity=".05"/><stop offset=".7" stop-color="#000" stop-opacity=".1"/><stop offset="1" stop-color="#000" stop-opacity=".75"/></linearGradient>
  <linearGradient id="ghandle" x1="690" y1="0" x2="840" y2="0" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#000" stop-opacity=".6"/><stop offset=".55" stop-color="#fff" stop-opacity=".12"/><stop offset="1" stop-color="#000" stop-opacity=".5"/></linearGradient></defs>
  <ellipse cx="530" cy="${bot + 30}" rx="300" ry="30" fill="#000" opacity=".55" filter="url(#gb20)"/>
  <path d="M${cx + R - 4} 350C800 335 842 410 836 528C830 650 788 712 ${cx + R - 4} 700V652C764 652 788 604 790 528C792 440 770 395 ${cx + R - 4} 398Z" fill="${body}"/>
  <path d="M${cx + R - 4} 350C800 335 842 410 836 528C830 650 788 712 ${cx + R - 4} 700V652C764 652 788 604 790 528C792 440 770 395 ${cx + R - 4} 398Z" fill="url(#ghandle)"/>
  <path d="${bodyPath}" fill="${body}"/>
  <g clip-path="url(#gclip)">${strips}<rect width="1000" height="1000" fill="url(#gcyl)"/>
    <rect x="${cx - R * 0.46}" y="${top}" width="14" height="${bot - top + 40}" fill="#fff" opacity=".22" filter="url(#gb8)"/></g>
  <ellipse cx="${cx}" cy="${top}" rx="${R}" ry="${ry}" fill="${body}"/><ellipse cx="${cx}" cy="${top + 3}" rx="${R - 12}" ry="${ry - 7}" fill="${inner}"/>
  <ellipse cx="${cx}" cy="${top}" rx="${R - 1}" ry="${ry - 1}" fill="none" stroke="#fff" stroke-opacity=".3" stroke-width="2.5"/>
  <path d="M${cx - R + 14} ${top + 6}A${R - 14} ${ry - 8} 0 0 0 ${cx + R - 14} ${top + 6}" fill="none" stroke="#000" stroke-opacity=".6" stroke-width="3"/>`);
}

// ------------------------------------------------------------------ stickers on a laptop / sticker sheet on a desk
const desk = (id) => `<defs><linearGradient id="${id}desk" x1="0" y1="0" x2="1000" y2="1000" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#3A3C43"/><stop offset="1" stop-color="#0E0E11"/></linearGradient>
<radialGradient id="${id}vig" cx="500" cy="480" r="700" gradientUnits="userSpaceOnUse"><stop offset=".55" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".6"/></radialGradient>
<filter id="${id}sh" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="2.5" stdDeviation="2.5" flood-color="#000" flood-opacity=".45"/></filter>
<filter id="${id}b20" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="22"/></filter>
<filter id="${id}noise" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency=".75" numOctaves="2" seed="5"/><feColorMatrix values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 .6 0"/><feComposite in2="SourceGraphic" operator="in"/></filter></defs>
<rect width="1000" height="1000" fill="url(#${id}desk)"/><rect width="1000" height="1000" fill="#fff" filter="url(#${id}noise)" opacity=".06"/>`;
/** stickers: [{ svg, w, h, x, y, rot }] in 300-DPI px; scale maps px → scene units. */
export function laptop({ stickers, scale = 0.24 }) {
  const items = stickers.map((s) => `<g transform="translate(${s.x} ${s.y}) rotate(${s.rot})" filter="url(#lsh)"><image href="${uri(s.svg)}" x="${(-s.w * scale) / 2}" y="${(-s.h * scale) / 2}" width="${s.w * scale}" height="${s.h * scale}"/></g>`).join("");
  return scene(`${desk("l")}<defs><linearGradient id="llid" x1="140" y1="200" x2="860" y2="820" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#5a6072"/><stop offset=".5" stop-color="#40454f"/><stop offset="1" stop-color="#2c3038"/></linearGradient>
  <linearGradient id="lsheen" x1="140" y1="200" x2="600" y2="700" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#fff" stop-opacity=".16"/><stop offset=".5" stop-color="#fff" stop-opacity="0"/></linearGradient></defs>
  <g transform="rotate(-6 500 500)">
    <rect x="130" y="205" width="740" height="500" rx="28" fill="#000" opacity=".6" filter="url(#lb20)" transform="translate(8 22)"/>
    <rect x="120" y="190" width="760" height="512" rx="28" fill="#1f2228"/>
    <rect x="124" y="192" width="752" height="506" rx="26" fill="url(#llid)"/>
    <rect x="124" y="192" width="752" height="506" rx="26" fill="#fff" filter="url(#lnoise)" opacity=".08"/>
    ${items}
    <rect x="124" y="192" width="752" height="506" rx="26" fill="url(#lsheen)"/>
    <rect x="125" y="193" width="750" height="504" rx="25" fill="none" stroke="#fff" stroke-opacity=".18" stroke-width="2"/>
  </g>
  <rect width="1000" height="1000" fill="url(#lvig)"/>`);
}
export function sheetOnDesk({ sheet, w = 2550, h = 3300 }) {
  const sc = 760 / h, sw = w * sc;
  return scene(`${desk("k")}<g transform="rotate(4 500 500)">
    <rect x="${500 - sw / 2 + 6}" y="${120 + 16}" width="${sw}" height="760" rx="6" fill="#000" opacity=".55" filter="url(#kb20)"/>
    <rect x="${500 - sw / 2}" y="120" width="${sw}" height="760" rx="6" fill="#f4f3f8"/>
    <image href="${uri(sheet)}" x="${500 - sw / 2}" y="120" width="${sw}" height="760" filter="url(#ksh)"/>
  </g><rect width="1000" height="1000" fill="url(#kvig)"/>`);
}
