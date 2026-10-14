/** Decorative Stellar parka yeti (frost theme): white shaggy fur, blue-gray face, deep-navy Stellar parka with a
 *  fur-lined hood, navy beanie, fur mittens and cuffs, the official Stellar mark on the chest and a sleeve patch.
 *  Same placements / props as before. aria-hidden, pointer-events none; hidden when there's no room. */
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
const HEAD = fluff(60, 46, 17, 16, 16, 0.14);
const HOOD = fluff(60, 45, 25, 24, 20, 0.12);
const BEARD = fluff(60, 60, 13, 9, 12, 0.22);
const HEM = fluff(60, 141, 25, 5, 14, 0.4);
const MIT = (x: number, y: number) => fluff(x, y, 7, 6.5, 9, 0.3);
export const STELLAR = "M26.8975 3.39946L23.1266 5.28446L4.91708 14.3845C4.8555 13.9237 4.82452 13.4595 4.82433 12.9948C4.82682 11.1406 5.32299 9.31916 6.2637 7.71099C7.20441 6.10282 8.55702 4.76368 10.1875 3.82621C11.8181 2.88874 13.6699 2.38547 15.5597 2.36626C17.4494 2.34704 19.3115 2.81255 20.9615 3.71666L23.1199 2.63766L23.4419 2.47646C21.4646 1.06842 19.1291 0.224162 16.6934 0.0370048C14.2577 -0.150153 11.8166 0.327075 9.64006 1.41594C7.46349 2.50481 5.63616 4.16292 4.36001 6.20702C3.08386 8.25111 2.4086 10.6016 2.40885 12.9987C2.40885 13.3297 2.42166 13.6595 2.44728 13.988C2.48315 14.4531 2.37801 14.9183 2.14507 15.3249C1.91213 15.7316 1.5618 16.0616 1.13818 16.2734L0 16.8428V19.4987L3.35093 17.823L4.4361 17.2796L5.50538 16.7453L24.702 7.14866L26.8591 6.07096L31.3177 3.84146V1.18686L26.8975 3.39946ZM31.3177 6.49985L6.59585 18.8499L4.43875 19.9302L0 22.1493V24.8026L4.40828 22.5991L8.17922 20.7141L26.4073 11.6011C26.4689 12.0649 26.4999 12.5321 26.5 12.9999C26.4988 14.8562 26.0028 16.68 25.0612 18.2901C24.1195 19.9002 22.7651 21.2407 21.1322 22.1785C19.4993 23.1162 17.6448 23.6187 15.7529 23.6359C13.8609 23.6531 11.9973 23.1845 10.3469 22.2767L10.2144 22.3456L7.87448 23.5156C9.85128 24.9236 12.1864 25.7681 14.6217 25.9557C17.057 26.1434 19.4978 25.6668 21.6744 24.5786C23.851 23.4905 25.6786 21.8332 26.9553 19.7898C28.232 17.7465 28.9081 15.3966 28.9089 12.9999C28.9089 12.6658 28.8956 12.3317 28.8704 12.0015C28.8346 11.5365 28.9396 11.0715 29.1723 10.6649C29.405 10.2582 29.7549 9.92815 30.1782 9.71605L31.3177 9.14665V6.49985Z";

export type YetiProp = "none" | "coin" | "chart" | "flag" | "mug" | "wrench" | "trophy" | "bag" | "paper" | "seed";
/** Small page-relevant prop held in the free (left) glove. Frost palette. */
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
          {/* legs: navy cargo trousers + boots (crossed, casual lean) */}
          <path className="my-pants" d="M50 140 L44 182 L56 183 L61 146 Z" />
          <path className="my-pants" d="M64 142 L74 180 L62 184 L57 150 Z" />
          <path className="my-strap" d="M53 150 V172" />
          <rect className="my-boot" x="38" y="178" width="20" height="10" rx="4" />
          <rect className="my-boot" x="60" y="178" width="20" height="10" rx="4" transform="rotate(-6 70 183)" />
          {/* parka body */}
          <path className="my-suit" d="M36 86 Q60 74 84 86 L86 140 Q60 148 34 140 Z" />
          <path className="my-zip" d="M60 80 V142" />
          <path className="my-seam" d="M42 120 L50 121 M78 120 L70 121" />
          <path className="my-frost" d="M40 96 l3 1 M76 92 l2 2 M48 130 l2 -1 M72 134 l3 0 M66 112 l2 1" />
          {/* fur hem */}
          <path className="my-fur" d={HEM} />
          {/* chest logo: official Stellar mark */}
          <g transform="translate(52 96) scale(0.52)"><path className="my-mark-w" fillRule="evenodd" clipRule="evenodd" d={STELLAR} /></g>
          <path className="my-word" d="M52 113 H68 M54 116.5 H66" />
          {/* left arm hanging, right arm resting on the tabs (leaning); navy sleeves, fur cuffs + mittens */}
          <path className="my-arm-edge" d="M39 90 Q27 112 33 128" />
          <path className="my-arm-edge" d="M81 90 Q101 104 108 120" />
          <path className="my-arm" d="M39 90 Q27 112 33 128" />
          <path className="my-arm" d="M81 90 Q101 104 108 120" />
          <path className="my-cuff" d="M28 124 Q33 130 39 126 M103 117 Q109 122 113 116" />
          <rect className="my-sleeve-patch" x="86" y="96" width="9" height="9" rx="1.2" transform="rotate(32 90 100)" />
          <g transform="translate(87.6 97.6) rotate(32) scale(0.2)"><path className="my-mark-w" fillRule="evenodd" clipRule="evenodd" d={STELLAR} /></g>
          <path className="my-fur" d={MIT(33, 134)} />
          <path className="my-fur" d={MIT(111, 126)} />
          {/* fur-lined hood around the head */}
          <path className="my-hood" d={HOOD} />
          <ellipse className="my-hood-fur" cx="60" cy="47" rx="21" ry="20" />
          <path className="my-fur" d={HEAD} />
          <path className="my-fur" d={BEARD} />
          <ellipse className="my-face" cx="60" cy="50" rx="11" ry="8.5" />
          <path className="my-brow" d="M52 44 Q55 42.4 57.6 43.6 M62.4 43.6 Q65 42.4 68 44" />
          <circle className="my-eye" cx="55.5" cy="47.5" r="2.1" /><circle className="my-eye" cx="64.5" cy="47.5" r="2.1" />
          <circle className="my-glint" cx="56.1" cy="46.9" r=".65" /><circle className="my-glint" cx="65.1" cy="46.9" r=".65" />
          <path className="my-nose" d="M57.4 50.4 Q60 49.2 62.6 50.4 Q60 53.2 57.4 50.4 Z" />
          <path className="my-smile" d="M57 55 Q60 56.6 63 55" />
          {/* navy beanie with the Stellar mark */}
          <path className="my-beanie" d="M43 39 Q44 24 60 23 Q76 24 77 39 Q60 34 43 39 Z" />
          <path className="my-beanie-rim" d="M43 39 Q60 33 77 39" />
          <g transform="translate(56.4 28.2) scale(0.23)"><path className="my-mark-w" fillRule="evenodd" clipRule="evenodd" d={STELLAR} /></g>
          {/* hood drawstrings */}
          <path className="my-cord" d="M52 70 L50 84 M68 70 L70 84" />
          <Prop kind={prop} />
        </g>
      </svg>
    </div>
  );
}
