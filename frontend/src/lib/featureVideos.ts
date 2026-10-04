/**
 * Feature tour videos (one per exchange feature, ~30 s each). Compressed 720p
 * copies live in public/media/features/ so the Pages build serves them
 * same-origin; full-resolution masters are kept out of the repo.
 */
export type FeatureVideo = {
  id: string; // file stem, e.g. "01-swaps"
  title: string;
  seconds: number;
  /** extra on-card label, e.g. for features that are not live */
  tag?: string;
};

export const FEATURE_VIDEOS: FeatureVideo[] = [
  { id: "01-swaps", title: "Swaps", seconds: 27 },
  { id: "02-liquidity-pools", title: "Liquidity pools", seconds: 30 },
  { id: "03-lending-market", title: "Lending market", seconds: 27 },
  { id: "04-warp-leverage-vault", title: "Warp leverage vault", seconds: 29, tag: "Leverage risk" },
  { id: "05-stop-loss-take-profit-liquidations", title: "Stop-loss, take-profit & liquidations", seconds: 29, tag: "Leverage risk" },
  { id: "06-oracle-pricing", title: "Oracle pricing & staleness guards", seconds: 30 },
  { id: "07-qfx-staking-referrals", title: "QFX, staking, referrals & calculators", seconds: 29 },
  { id: "08-xp-ranks-quests", title: "XP ranks & Quests", seconds: 29 },
  { id: "09-markets-news", title: "Markets & Stellar news", seconds: 28 },
  { id: "10-governance-security", title: "Governance & security", seconds: 28 },
  { id: "11-perps-funding-live", title: "Perps funding", seconds: 29, tag: "Live on testnet" },
];

export const FEATURE_VIDEOS_COPY = {
  kicker: "Feature videos",
  headline: "Every feature, in about 30 seconds.",
  pitch: "Short tours of the exchange, captured on testnet. Pick a feature to play it.",
  note: "Testnet beta · unaudited · testnet tokens have no value. Rates and rewards shown are illustrative and variable. Leverage amplifies losses and carries liquidation risk.",
} as const;

const base = (): string => (import.meta.env?.BASE_URL as string | undefined) ?? "/";

export type Aspect = "16x9" | "9x16";
export const featureSrc = (v: FeatureVideo, a: Aspect, b: string = base()) => `${b}media/features/${v.id}-${a}.mp4`;
export const featurePoster = (v: FeatureVideo, a: Aspect, b: string = base()) => `${b}media/features/${v.id}-${a}-poster.jpg`;
export const fmtRuntime = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
