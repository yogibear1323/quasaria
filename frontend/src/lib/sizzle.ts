/**
 * The 34-second Quasaria sizzle reel. The mp4s (~13 MB each) are hosted on the
 * public promo site and referenced by URL; only the small poster frames
 * (taken at ~5 s) are committed, under public/media/.
 */
export const PROMO_PAGE_URL = "https://yogibear1323.github.io/promo/";

export type SizzleCut = { id: "wide" | "vertical"; label: string; src: string; poster: string; width: number; height: number };

const base = (): string => (import.meta.env?.BASE_URL as string | undefined) ?? "/";

export function sizzleCuts(b: string = base()): SizzleCut[] {
  return [
    { id: "wide", label: "Widescreen · 16:9", src: `${PROMO_PAGE_URL}quasaria-sizzle-16x9.mp4`, poster: `${b}media/quasaria-sizzle-16x9-poster.jpg`, width: 1920, height: 1080 },
    { id: "vertical", label: "Vertical · 9:16", src: `${PROMO_PAGE_URL}quasaria-sizzle-9x16.mp4`, poster: `${b}media/quasaria-sizzle-9x16-poster.jpg`, width: 1080, height: 1920 },
  ];
}

export const SIZZLE_COPY = {
  kicker: "Watch",
  headline: "See Quasaria in 34 seconds.",
  pitch: "Swaps, liquidity pools, lending, quests, and keys that stay yours, all settled on Stellar.",
} as const;

/** Widescreen cut is shown from this width up; below it, only the vertical cut. */
export const SIZZLE_WIDE_QUERY = "(min-width: 721px)";
