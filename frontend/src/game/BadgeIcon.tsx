import type { ReactElement } from "react";
import type { Badge, BadgeIcon as IconKind } from "./engine";

const HUES: Record<Badge["hue"], [string, string]> = {
  violet: ["#a78bfa", "#6d4aff"],
  cyan: ["#67e8f9", "#0891b2"],
  gold: ["#fde68a", "#d97706"],
  green: ["#6ee7b7", "#059669"],
  rose: ["#fda4af", "#e11d48"],
};

/** Glyphs drawn on a 48×48 grid, centred on (24, 24). Stroke-based, white. */
const GLYPHS: Record<IconKind, ReactElement> = {
  spark: <path d="M24 12q1.6 8.4 10 12-8.4 1.6-10 12-1.6-10.4-10-12 8.4-3.6 10-12z" fill="#fff" stroke="none" />,
  compass: <><circle cx="24" cy="24" r="10" /><path d="M28.5 19.5 26 26l-6.5 2.5L22 22z" fill="#fff" /></>,
  shield: <><path d="M24 13l9 3.5v6.5c0 5.6-3.8 10-9 12-5.2-2-9-6.4-9-12v-6.5z" /><path d="m19.5 24 3.2 3.2 6-6.2" /></>,
  abacus: <><rect x="14" y="14" width="20" height="20" rx="4" /><path d="M19 20h10M19 24h4M27 24h2M19 28h10" /></>,
  gauge: <><path d="M14.5 29a10 10 0 1 1 19 0" /><path d="m24 27 5-7" /><circle cx="24" cy="27" r="1.6" fill="#fff" /></>,
  bolt: <path d="M26.5 12 17 26h7l-2.5 10L31 22h-7z" fill="#fff" stroke="none" />,
  forge: <><circle cx="24" cy="24" r="9" /><path d="M24 19v10M20.5 21.5c0-1.4 1.6-2.5 3.5-2.5s3.5 1 3.5 2.4-1.6 2.1-3.5 2.6-3.5 1.2-3.5 2.6 1.6 2.4 3.5 2.4 3.5-1.1 3.5-2.5" strokeWidth="1.8" /></>,
  drop: <><path d="M24 12.5c4.5 5.6 8 9.8 8 14a8 8 0 0 1-16 0c0-4.2 3.5-8.4 8-14z" /><path d="M20.5 27.5a3.8 3.8 0 0 0 3.5 3.3" /></>,
  orbit: <><ellipse cx="24" cy="24" rx="12" ry="5.5" transform="rotate(-25 24 24)" /><circle cx="24" cy="24" r="4" fill="#fff" /><circle cx="34" cy="19.5" r="1.8" fill="#fff" /></>,
  flame: <path d="M24 12.5c1 4.5 7.5 7.4 7.5 13.5a7.5 7.5 0 0 1-15 0c0-3 1.6-5 3.4-6.4.2 2.2 1.2 3.6 2.6 4.1-.6-4.6 0-8.2 1.5-11.2z" />,
  nova: <><circle cx="24" cy="24" r="4" fill="#fff" /><path d="M24 11v6M24 31v6M11 24h6M31 24h6M15 15l4 4M29 29l4 4M33 15l-4 4M19 29l-4 4" /></>,
  crown: <><path d="m14 31 2-12 5 5 3-8 3 8 5-5 2 12z" /><path d="M14 34.5h20" /></>,
};

/** Hexagonal achievement badge. Locked badges render as a muted outline. */
export default function BadgeIcon({ badge, unlocked, size = 64 }: { badge: Badge; unlocked: boolean; size?: number }) {
  const [a, b] = HUES[badge.hue];
  const id = `bg-${badge.id}`;
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden className={`badge-icon ${unlocked ? "on" : "off"}`}>
      <defs>
        <linearGradient id={id} x1="8" y1="4" x2="40" y2="44" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={a} />
          <stop offset="1" stopColor={b} />
        </linearGradient>
        <linearGradient id={`${id}-s`} x1="24" y1="3" x2="24" y2="24" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#fff" stopOpacity=".35" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d="M24 2.5 42.6 13.25v21.5L24 45.5 5.4 34.75v-21.5z" fill={unlocked ? `url(#${id})` : "rgba(255,255,255,0.04)"} stroke={unlocked ? "rgba(255,255,255,0.35)" : "rgba(255,255,255,0.14)"} strokeWidth="1" />
      {unlocked && <path d="M24 2.5 42.6 13.25V24H5.4V13.25z" fill={`url(#${id}-s)`} />}
      <g fill="none" stroke={unlocked ? "#fff" : "rgba(255,255,255,0.3)"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" opacity={unlocked ? 1 : 0.8}>
        {GLYPHS[badge.icon]}
      </g>
    </svg>
  );
}
