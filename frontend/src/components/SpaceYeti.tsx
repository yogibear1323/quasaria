/** Decorative astronaut yeti for /markets: same style as the Back Office yeti traders (cream fur, tan face,
 *  rosy cheeks), in an earthy Stellar spacesuit (sand/stone suit, clay + honey trim) with the helmet ON and the
 *  visor flipped open so the face shows. Chest patch = the official Stellar mark (same unaltered path as the
 *  XLM coins). Leans on the page tabs. aria-hidden, pointer-events none; hidden when there's no room. */
function fluff(cx: number, cy: number, rx: number, ry: number, n: number, tuft: number): string {
  const pt = (a: number, k: number) => [cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k];
  let d = "";
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2, am = (a0 + a1) / 2;
    const [x0, y0] = pt(a0, 1), [x1, y1] = pt(a1, 1), [xm, ym] = pt(am, 1 + tuft);
    d += `${i ? "" : `M${x0.toFixed(1)} ${y0.toFixed(1)}`} Q${xm.toFixed(1)} ${ym.toFixed(1)} ${x1.toFixed(1)} ${y1.toFixed(1)}`;
  }
  return d + "Z";
}
const HEAD = fluff(60, 46, 19, 17, 16, 0.14);
const STELLAR = "M26.8975 3.39946L23.1266 5.28446L4.91708 14.3845C4.8555 13.9237 4.82452 13.4595 4.82433 12.9948C4.82682 11.1406 5.32299 9.31916 6.2637 7.71099C7.20441 6.10282 8.55702 4.76368 10.1875 3.82621C11.8181 2.88874 13.6699 2.38547 15.5597 2.36626C17.4494 2.34704 19.3115 2.81255 20.9615 3.71666L23.1199 2.63766L23.4419 2.47646C21.4646 1.06842 19.1291 0.224162 16.6934 0.0370048C14.2577 -0.150153 11.8166 0.327075 9.64006 1.41594C7.46349 2.50481 5.63616 4.16292 4.36001 6.20702C3.08386 8.25111 2.4086 10.6016 2.40885 12.9987C2.40885 13.3297 2.42166 13.6595 2.44728 13.988C2.48315 14.4531 2.37801 14.9183 2.14507 15.3249C1.91213 15.7316 1.5618 16.0616 1.13818 16.2734L0 16.8428V19.4987L3.35093 17.823L4.4361 17.2796L5.50538 16.7453L24.702 7.14866L26.8591 6.07096L31.3177 3.84146V1.18686L26.8975 3.39946ZM31.3177 6.49985L6.59585 18.8499L4.43875 19.9302L0 22.1493V24.8026L4.40828 22.5991L8.17922 20.7141L26.4073 11.6011C26.4689 12.0649 26.4999 12.5321 26.5 12.9999C26.4988 14.8562 26.0028 16.68 25.0612 18.2901C24.1195 19.9002 22.7651 21.2407 21.1322 22.1785C19.4993 23.1162 17.6448 23.6187 15.7529 23.6359C13.8609 23.6531 11.9973 23.1845 10.3469 22.2767L10.2144 22.3456L7.87448 23.5156C9.85128 24.9236 12.1864 25.7681 14.6217 25.9557C17.057 26.1434 19.4978 25.6668 21.6744 24.5786C23.851 23.4905 25.6786 21.8332 26.9553 19.7898C28.232 17.7465 28.9081 15.3966 28.9089 12.9999C28.9089 12.6658 28.8956 12.3317 28.8704 12.0015C28.8346 11.5365 28.9396 11.0715 29.1723 10.6649C29.405 10.2582 29.7549 9.92815 30.1782 9.71605L31.3177 9.14665V6.49985Z";

export type YetiProp = "none" | "coin" | "chart" | "flag" | "mug" | "wrench" | "trophy" | "bag" | "paper" | "seed";
/** Small page-relevant prop held in the free (left) glove. Earthy colours only. */
function Prop({ kind }: { kind: YetiProp }) {
  const g = "translate(34 134)";
  if (kind === "coin") return <g transform={g}><circle className="my-coin" r="8" /><g transform="translate(-4.6 -3.8) scale(0.29)"><path className="my-mark" fillRule="evenodd" clipRule="evenodd" d={STELLAR} /></g></g>;
  if (kind === "chart") return <g transform={g}><rect className="my-card" x="-9" y="-16" width="18" height="14" rx="2" /><path className="my-line" d="M-6 -5 L-2 -9 L1 -7 L6 -13" /></g>;
  if (kind === "flag") return <g transform={g}><path className="my-pole" d="M0 6 V-30" /><path className="my-flag" d="M0 -30 L14 -25 L0 -20 Z" /></g>;
  if (kind === "mug") return <g transform={g}><rect className="my-card" x="-6" y="-12" width="11" height="12" rx="2" /><path className="my-pole" d="M5 -9 Q9 -6 5 -3" /></g>;
  if (kind === "wrench") return <g transform={g}><path className="my-pole" d="M0 4 L0 -18" /><circle className="my-flagless" cx="0" cy="-20" r="4" /></g>;
  if (kind === "trophy") return <g transform={g}><path className="my-coin" d="M-7 -18 H7 Q7 -8 0 -6 Q-7 -8 -7 -18 Z" /><path className="my-pole" d="M0 -6 V0 M-4 0 H4" /></g>;
  if (kind === "bag") return <g transform={g}><rect className="my-flag" x="-7" y="-14" width="14" height="13" rx="2" /><path className="my-pole" d="M-3 -14 Q0 -20 3 -14" /></g>;
  if (kind === "paper") return <g transform={g}><rect className="my-card" x="-8" y="-18" width="14" height="18" rx="1.5" /><path className="my-pole" d="M-5 -13 H3 M-5 -9 H3 M-5 -5 H1" /></g>;
  if (kind === "seed") return <g transform={g}><path className="my-leaf" d="M0 2 Q-10 -10 0 -20 Q10 -10 0 2 Z" /><path className="my-pole" d="M0 2 V-16" /></g>;
  return null;
}

export default function SpaceYeti({ prop = "none", mirror = false, className = "" }: { prop?: YetiProp; mirror?: boolean; className?: string }) {
  return (
    <div className={`space-yeti ${mirror ? "is-mirror" : ""} ${className}`} aria-hidden="true">
      <svg viewBox="0 0 120 200" focusable="false">
        <g className="my-bob">
          {/* legs + boots (crossed, casual lean) */}
          <path className="my-suit" d="M50 140 L44 182 L56 183 L61 146 Z" />
          <path className="my-suit" d="M64 142 L74 180 L62 184 L57 150 Z" />
          <rect className="my-boot" x="38" y="178" width="20" height="10" rx="4" />
          <rect className="my-boot" x="60" y="178" width="20" height="10" rx="4" transform="rotate(-6 70 183)" />
          {/* torso */}
          <path className="my-suit" d="M38 84 Q60 74 82 84 L84 140 Q60 150 36 140 Z" />
          <path className="my-trim" d="M37 132 Q60 142 83 132" />
          <path className="my-zip" d="M60 82 V144" />
          {/* life-support pack strap */}
          <path className="my-strap" d="M42 84 L46 136" />
          {/* chest patch: official Stellar mark */}
          <circle className="my-patch" cx="70" cy="102" r="9" />
          <g transform="translate(64.5 97.6) scale(0.34)"><path className="my-mark" fillRule="evenodd" clipRule="evenodd" d={STELLAR} /></g>
          {/* left arm hanging, right arm resting on the tabs (leaning) */}
          <path className="my-arm" d="M40 90 Q30 112 34 132" />
          <circle className="my-glove" cx="34" cy="134" r="6" />
          <path className="my-arm" d="M80 90 Q100 104 110 124" />
          <circle className="my-glove" cx="111" cy="126" r="6" />
          {/* collar ring */}
          <ellipse className="my-ring" cx="60" cy="80" rx="22" ry="6" />
          {/* helmet shell (worn) */}
          <circle className="my-helmet" cx="60" cy="48" r="30" />
          {/* yeti head inside */}
          <circle className="my-ear" cx="43" cy="40" r="4.5" /><circle className="my-ear" cx="77" cy="40" r="4.5" />
          <path className="my-fur" d={HEAD} />
          <path className="my-tuft" d="M55 30 Q58 25 60 29 Q62 24 65 30" />
          <ellipse className="my-face" cx="60" cy="49" rx="12.5" ry="9.5" />
          <path className="my-brow" d="M51.5 42 Q54.5 40.6 57.2 41.8 M62.8 41.8 Q65.5 40.6 68.5 42" />
          <circle className="my-eye" cx="55" cy="46" r="2.3" /><circle className="my-eye" cx="65" cy="46" r="2.3" />
          <circle className="my-glint" cx="55.7" cy="45.3" r=".7" /><circle className="my-glint" cx="65.7" cy="45.3" r=".7" />
          <ellipse className="my-cheek" cx="50.5" cy="51" rx="2.4" ry="1.5" /><ellipse className="my-cheek" cx="69.5" cy="51" rx="2.4" ry="1.5" />
          <path className="my-nose" d="M57.6 48.8 Q60 47.7 62.4 48.8 Q60 51.5 57.6 48.8 Z" />
          <path className="my-smile" d="M57 53.5 Q60 55.5 63 53.5" />
          {/* visor flipped OPEN, up on top of the helmet */}
          <path className="my-visor" d="M34 34 Q60 6 86 34 Q60 22 34 34 Z" />
          <path className="my-helmet-rim" d="M31 50 Q31 18 60 18 Q89 18 89 50" />
          <circle className="my-lamp" cx="60" cy="19" r="2.6" />
          <Prop kind={prop} />
        </g>
      </svg>
    </div>
  );
}
