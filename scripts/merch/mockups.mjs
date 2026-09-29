// Programmatic product mockups: SVG garment/product silhouettes with shading,
// the real print file composited on top. All in a 1000×1000 scene.
const uri = (svg) => `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
export const GARMENT = { black: "#121318", navy: "#1c2544", charcoal: "#3a3d46", purple: "#2c2152" };

const studio = (id) => `<defs><radialGradient id="${id}bg" cx="500" cy="420" r="720" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#454a68"/><stop offset=".55" stop-color="#262a3e"/><stop offset="1" stop-color="#12141f"/></radialGradient>
<filter id="${id}soft" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="14"/></filter>
<filter id="${id}b8" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="8"/></filter>
<filter id="${id}b20" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="22"/></filter>
<filter id="${id}noise" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" seed="3"/><feColorMatrix values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 .5 0"/><feComposite in2="SourceGraphic" operator="in"/></filter></defs>
<rect width="1000" height="1000" fill="url(#${id}bg)"/>`;
const scene = (body) => `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="1000" height="1000" viewBox="0 0 1000 1000">${body}</svg>`;
const cylinder = (id, x0, x1, a = 0.42) => `<linearGradient id="${id}" x1="${x0}" y1="0" x2="${x1}" y2="0" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#000" stop-opacity="${a}"/><stop offset=".18" stop-color="#000" stop-opacity=".08"/><stop offset=".45" stop-color="#fff" stop-opacity=".05"/><stop offset=".82" stop-color="#000" stop-opacity=".1"/><stop offset="1" stop-color="#000" stop-opacity="${a}"/></linearGradient>`;

// ------------------------------------------------------------------ t-shirt
const TEE_FRONT = "M392 118C425 172 575 172 608 118L700 142C760 162 830 205 880 262L812 392C790 378 760 362 735 352C738 520 742 700 748 885C600 900 400 900 252 885C258 700 262 520 265 352C240 362 210 378 188 392L120 262C170 205 240 162 300 142Z";
const TEE_BACK = "M392 118C430 138 570 138 608 118L700 142C760 162 830 205 880 262L812 392C790 378 760 362 735 352C738 520 742 700 748 885C600 900 400 900 252 885C258 700 262 520 265 352C240 362 210 378 188 392L120 262C170 205 240 162 300 142Z";
/** placement: "front" (15×18 in), "chest" (5×5 in, wearer's left), "back". */
export function tee({ color, art, placement = "front", aspect = 5400 / 4500 }) {
  const back = placement === "back", path = back ? TEE_BACK : TEE_FRONT;
  const pw = placement === "chest" ? 112 : 352, ph = placement === "chest" ? 112 : pw * aspect;
  const px = placement === "chest" ? 548 : 500 - pw / 2, py = placement === "chest" ? 218 : back ? 188 : 206;
  const folds = `<g filter="url(#tsoft)" fill="none" stroke-linecap="round">
    <path d="M300 385C330 520 318 650 345 830" stroke="#000" stroke-opacity=".32" stroke-width="20"/>
    <path d="M690 400C668 540 690 700 662 860" stroke="#000" stroke-opacity=".28" stroke-width="20"/>
    <path d="M270 362C330 400 380 420 430 432" stroke="#000" stroke-opacity=".3" stroke-width="12"/>
    <path d="M730 362C670 400 620 420 570 432" stroke="#000" stroke-opacity=".3" stroke-width="12"/>
    <path d="M360 300C380 480 385 650 372 860" stroke="#fff" stroke-opacity=".07" stroke-width="36"/>
    <path d="M630 300C612 480 622 650 640 860" stroke="#fff" stroke-opacity=".05" stroke-width="30"/>
    <path d="M430 620C470 640 530 640 575 615" stroke="#000" stroke-opacity=".18" stroke-width="14"/>
    <path d="M160 300C190 330 215 350 250 360" stroke="#000" stroke-opacity=".25" stroke-width="10"/>
    <path d="M840 300C810 330 785 350 750 360" stroke="#000" stroke-opacity=".25" stroke-width="10"/>
  </g>`;
  const collar = back
    ? `<path d="M392 118C430 138 570 138 608 118" fill="none" stroke="#000" stroke-opacity=".35" stroke-width="16"/><path d="M398 124C432 142 568 142 602 124" fill="none" stroke="#fff" stroke-opacity=".08" stroke-width="3"/>`
    : `<path d="M410 112C450 96 550 96 590 112C575 140 425 140 410 112Z" fill="#000" fill-opacity=".55"/><path d="M392 118C425 172 575 172 608 118L592 112C562 154 438 154 408 112Z" fill="${color}"/><path d="M392 118C425 172 575 172 608 118L592 112C562 154 438 154 408 112Z" fill="#fff" fill-opacity=".06"/><path d="M398 122C430 168 570 168 602 122" fill="none" stroke="#000" stroke-opacity=".35" stroke-width="2"/>`;
  return scene(`${studio("t")}<defs><clipPath id="tclip"><path d="${path}"/></clipPath>${cylinder("tcyl", 120, 880)}
  <linearGradient id="tvert" x1="0" y1="110" x2="0" y2="900" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#fff" stop-opacity=".07"/><stop offset=".35" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".22"/></linearGradient></defs>
  <ellipse cx="500" cy="915" rx="320" ry="24" fill="#000" opacity=".45" filter="url(#tb20)"/>
  <path d="${path}" fill="${color}"/>
  <g clip-path="url(#tclip)">
    <image href="${uri(art)}" x="${px}" y="${py}" width="${pw}" height="${ph}" preserveAspectRatio="xMidYMin meet" opacity=".96"/>
    ${folds}
    <rect width="1000" height="1000" fill="url(#tcyl)"/><rect width="1000" height="1000" fill="url(#tvert)"/>
    <rect width="1000" height="1000" fill="#fff" filter="url(#tnoise)" opacity=".12" style="mix-blend-mode:overlay"/>
    <path d="M300 142C285 230 268 300 265 352M700 142C715 230 732 300 735 352" fill="none" stroke="#000" stroke-opacity=".4" stroke-width="2.5"/>
    <path d="M200 372L130 262M800 372L870 262" fill="none" stroke="#fff" stroke-opacity=".06" stroke-width="2" stroke-dasharray="5 5"/>
    <path d="M256 868C400 882 600 882 744 868" fill="none" stroke="#fff" stroke-opacity=".1" stroke-width="2" stroke-dasharray="6 6"/>
    <path d="${path}" fill="none" stroke="#fff" stroke-opacity=".16" stroke-width="3"/>
  </g>${collar}`);
}

// ------------------------------------------------------------------ hoodie
export function hoodie({ color, art }) {
  const body = "M360 150C420 205 580 205 640 150L720 175L746 400L748 900C600 915 400 915 252 900L254 400L280 175Z";
  const sleeveR = "M720 175C790 195 836 255 848 330L886 770L800 782L762 450L746 400Z", sleeveL = "M280 175C210 195 164 255 152 330L114 770L200 782L238 450L254 400Z";
  const cuffR = "M800 782L886 770L892 832L806 844Z", cuffL = "M200 782L114 770L108 832L194 844Z";
  const ribs = (x0, x1, y0, y1, n) => [...Array(n)].map((_, i) => { const t = (i + 0.5) / n; return `M${x0 + (x1 - x0) * t} ${y0}V${y1}`; }).join("");
  return scene(`${studio("h")}<defs><clipPath id="hclip"><path d="${body}"/></clipPath>${cylinder("hcyl", 250, 750, 0.5)}${cylinder("hcylS", 110, 890, 0.4)}
  <radialGradient id="hhood" cx="500" cy="60" r="200" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#fff" stop-opacity=".08"/><stop offset="1" stop-color="#000" stop-opacity=".35"/></radialGradient><linearGradient id="hin" x1="0" y1="58" x2="0" y2="205" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#1a1c24"/><stop offset="1" stop-color="#040406"/></linearGradient><linearGradient id="hvert" x1="0" y1="120" x2="0" y2="920" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#fff" stop-opacity=".07"/><stop offset=".4" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".25"/></linearGradient></defs>
  <ellipse cx="500" cy="925" rx="340" ry="24" fill="#000" opacity=".45" filter="url(#hb20)"/>
  <path d="M330 172C318 70 408 22 500 22C592 22 682 70 670 172Z" fill="${color}"/><path d="M330 172C318 70 408 22 500 22C592 22 682 70 670 172Z" fill="url(#hhood)"/>
  <path d="M382 172C378 98 436 58 500 58C564 58 622 98 618 172C584 212 416 212 382 172Z" fill="url(#hin)"/><path d="M382 172C378 98 436 58 500 58C564 58 622 98 618 172" fill="none" stroke="#fff" stroke-opacity=".1" stroke-width="3"/>
  <path d="${sleeveL}" fill="${color}"/><path d="${sleeveR}" fill="${color}"/><path d="${sleeveL}" fill="url(#hcylS)"/><path d="${sleeveR}" fill="url(#hcylS)"/>
  <path d="${cuffL}" fill="${color}"/><path d="${cuffR}" fill="${color}"/><path d="${cuffL}" fill="#000" fill-opacity=".22"/><path d="${cuffR}" fill="#000" fill-opacity=".22"/>
  <path d="${ribs(114, 194, 776, 840, 12)}${ribs(806, 886, 776, 840, 12)}" stroke="#000" stroke-opacity=".3" stroke-width="2"/>
  <g filter="url(#hsoft)" fill="none"><path d="M205 420C195 560 185 680 175 760" stroke="#000" stroke-opacity=".3" stroke-width="18"/><path d="M795 420C805 560 815 680 825 760" stroke="#000" stroke-opacity=".3" stroke-width="18"/></g>
  <path d="${body}" fill="${color}"/>
  <g clip-path="url(#hclip)">
    <image href="${uri(art)}" x="${500 - 175}" y="258" width="350" height="420" preserveAspectRatio="xMidYMin meet" opacity=".96"/>
    <path d="M330 650L670 650L722 842L278 842Z" fill="${color}"/><path d="M330 650L670 650L722 842L278 842Z" fill="#000" fill-opacity=".12"/>
    <path d="M330 650C305 720 290 790 278 842M670 650C695 720 710 790 722 842" fill="none" stroke="#000" stroke-opacity=".5" stroke-width="4"/>
    <path d="M336 656H664" stroke="#fff" stroke-opacity=".12" stroke-width="2" stroke-dasharray="5 5"/>
    <g filter="url(#hsoft)" fill="none"><path d="M300 420C320 560 312 700 330 860" stroke="#000" stroke-opacity=".3" stroke-width="20"/><path d="M700 420C680 560 690 700 670 860" stroke="#000" stroke-opacity=".3" stroke-width="20"/><path d="M380 320C395 480 400 560 392 640" stroke="#fff" stroke-opacity=".06" stroke-width="40"/></g>
    <rect width="1000" height="1000" fill="url(#hcyl)"/><rect width="1000" height="1000" fill="url(#hvert)"/>
    <path d="M248 848H752V920H248Z" fill="#000" fill-opacity=".22"/><path d="${ribs(252, 748, 850, 915, 70)}" stroke="#000" stroke-opacity=".25" stroke-width="2"/>
    <rect width="1000" height="1000" fill="#fff" filter="url(#hnoise)" opacity=".12" style="mix-blend-mode:overlay"/>
    <path d="${body}" fill="none" stroke="#fff" stroke-opacity=".14" stroke-width="3"/>
  </g>
  <path d="M360 150C380 205 450 228 500 232C550 228 620 205 640 150" fill="none" stroke="#000" stroke-opacity=".45" stroke-width="5"/>
  <path d="M362 156C384 206 452 226 500 229C548 226 616 206 638 156" fill="none" stroke="#fff" stroke-opacity=".1" stroke-width="2"/>
  <g stroke-linecap="round"><path d="M468 214C466 290 462 340 458 402" stroke="#d9dce6" stroke-width="6" fill="none"/><path d="M532 214C534 290 538 340 542 402" stroke="#d9dce6" stroke-width="6" fill="none"/></g>
  <rect x="452" y="398" width="12" height="26" rx="4" fill="#9aa0b3"/><rect x="536" y="398" width="12" height="26" rx="4" fill="#9aa0b3"/>
  <circle cx="468" cy="214" r="6" fill="#9aa0b3"/><circle cx="532" cy="214" r="6" fill="#9aa0b3"/>`);
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
  <ellipse cx="500" cy="745" rx="300" ry="26" fill="#000" opacity=".5" filter="url(#cb20)"/>
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
  <ellipse cx="${cx}" cy="${top}" rx="${R}" ry="${ry}" fill="${body}"/><ellipse cx="${cx}" cy="${top + 3}" rx="${R - 12}" ry="${ry - 7}" fill="#050508"/>
  <ellipse cx="${cx}" cy="${top}" rx="${R - 1}" ry="${ry - 1}" fill="none" stroke="#fff" stroke-opacity=".3" stroke-width="2.5"/>
  <path d="M${cx - R + 14} ${top + 6}A${R - 14} ${ry - 8} 0 0 0 ${cx + R - 14} ${top + 6}" fill="none" stroke="#000" stroke-opacity=".6" stroke-width="3"/>`);
}

// ------------------------------------------------------------------ stickers on a laptop / sticker sheet on a desk
const desk = (id) => `<defs><linearGradient id="${id}desk" x1="0" y1="0" x2="1000" y2="1000" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#2b2f45"/><stop offset="1" stop-color="#11131d"/></linearGradient>
<radialGradient id="${id}vig" cx="500" cy="480" r="700" gradientUnits="userSpaceOnUse"><stop offset=".55" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".55"/></radialGradient>
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
