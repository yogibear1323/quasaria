/**
 * Quasaria merch catalogue (preview). Nothing here is for sale yet: there is no
 * checkout, no payment and no backend. Prices are EXAMPLES for layout only.
 * Artwork: scripts/merch/ (print files are generated outside the repo).
 */
const BASE = (import.meta.env?.BASE_URL ?? "/").replace(/\/?$/, "/");
export const merchImg = (path: string) => `${BASE}merch-assets/${path}`;

/** Optional contact address for a mailto "notify me". Leave empty to only save locally. */
export const MERCH_CONTACT_EMAIL = "";
export const NOTIFY_KEY = "quasaria.merch.notify.v1";

export type Swatch = { id: string; name: string; hex: string };
export const SWATCH: Record<string, Swatch> = {
  black: { id: "black", name: "Black", hex: "#121318" },
  navy: { id: "navy", name: "Navy", hex: "#1c2544" },
  charcoal: { id: "charcoal", name: "Heather charcoal", hex: "#3a3d46" },
  purple: { id: "purple", name: "Deep purple", hex: "#2c2152" },
};

export type Category = "tees" | "hoodies" | "caps" | "accessories";
export type Product = {
  id: string;
  name: string;
  tagline: string;
  category: Category;
  /** Example price in USD — shown with an "example price" label, never charged. */
  examplePrice: number;
  colors: Swatch[];
  sizes: string[];
  /** Mockup per colour id (first = default). */
  mockups: Record<string, string>;
  /** Extra gallery images (artwork, alternate views). */
  extras: { src: string; alt: string; art?: boolean }[];
  details: string[];
  badge?: string;
};

const TEE_SIZES = ["S", "M", "L", "XL", "2XL", "3XL"];
const tee = (n: string, colors: string[]) => Object.fromEntries(colors.map((c) => [c, merchImg(`mockups/tee-${n}-${c}.webp`)]));

export const PRODUCTS: Product[] = [
  {
    id: "singularity-tee", name: "Singularity Chest Tee", tagline: "Minimal left-chest Singularity Q + wordmark.", category: "tees", examplePrice: 28,
    colors: [SWATCH.black, SWATCH.navy, SWATCH.charcoal], sizes: TEE_SIZES, mockups: tee("01", ["black", "navy", "charcoal"]),
    extras: [{ src: merchImg("designs/tee-01-singularity-chest-5x5in.webp"), alt: "Chest print artwork", art: true }],
    details: ["5 × 5 in left-chest print", "Soft ring-spun cotton (example blank)", "Everyday, understated"], badge: "Essential",
  },
  {
    id: "quasar-core-tee", name: "Quasar Core Back-Print Tee", tagline: "An accretion disk and relativistic jets across the whole back.", category: "tees", examplePrice: 34,
    colors: [SWATCH.black], sizes: TEE_SIZES, mockups: { black: merchImg("mockups/tee-02-black-back.webp") },
    extras: [
      { src: merchImg("mockups/tee-02-black-front.webp"), alt: "Front: chest mark" },
      { src: merchImg("designs/tee-02-quasar-core-back.webp"), alt: "Back print artwork", art: true },
    ],
    details: ["15 × 18 in full-back print + small chest mark", "Designed for black tees (glows need a dark shirt)", "Nods to 3C 273, the first quasar identified (1963)"], badge: "Flagship",
  },
  {
    id: "speed-of-light-tee", name: "Speed of Light Retro Tee", tagline: "Synthwave sun, perspective grid and chrome type.", category: "tees", examplePrice: 30,
    colors: [SWATCH.black, SWATCH.purple, SWATCH.navy], sizes: TEE_SIZES, mockups: tee("03", ["black", "purple", "navy"]),
    extras: [{ src: merchImg("designs/tee-03-speed-of-light-retro.webp"), alt: "Front print artwork", art: true }],
    details: ["15 × 18 in front print", "Retro '80s typographic design"],
  },
  {
    id: "level-up-tee", name: "Level Up: Quasar Rank Tee", tagline: "Pixel-arcade Q, XP bar maxed out. Press start to learn.", category: "tees", examplePrice: 30,
    colors: [SWATCH.black, SWATCH.navy, SWATCH.purple], sizes: TEE_SIZES, mockups: tee("04", ["black", "navy", "purple"]),
    extras: [{ src: merchImg("designs/tee-04-level-up-quasar-rank-pixel.webp"), alt: "Pixel artwork", art: true }],
    details: ["15 × 18 in front print, flat colours", "Inspired by the in-app quest ranks (XP itself has no monetary value)"], badge: "Game layer",
  },
  {
    id: "stardust-quasar-tee", name: "Stardust to Quasar Tee", tagline: "The five ranks as an ascending badge ladder.", category: "tees", examplePrice: 30,
    colors: [SWATCH.black, SWATCH.charcoal, SWATCH.navy], sizes: TEE_SIZES, mockups: tee("05", ["black", "charcoal", "navy"]),
    extras: [{ src: merchImg("designs/tee-05-stardust-to-quasar-ladder.webp"), alt: "Rank ladder artwork", art: true }],
    details: ["15 × 18 in front print", "Stardust · Comet · Nova · Pulsar · Quasar"],
  },
  {
    id: "singularity-hoodie", name: "Singularity Hoodie", tagline: "Centre-chest mark with orbit rings, sleeve print up the arm.", category: "hoodies", examplePrice: 58,
    colors: [SWATCH.black, SWATCH.navy], sizes: TEE_SIZES, mockups: { black: merchImg("mockups/hoodie-black.webp"), navy: merchImg("mockups/hoodie-navy.webp") },
    extras: [
      { src: merchImg("designs/hoodie-singularity-front.webp"), alt: "Front artwork", art: true },
      { src: merchImg("designs/hoodie-singularity-sleeve-4x16in.webp"), alt: "Sleeve artwork", art: true },
    ],
    details: ["Front print + optional 4 × 16 in sleeve print", "Mid-weight fleece (example blank)"], badge: "Cosy",
  },
  {
    id: "singularity-cap", name: "Embroidered Singularity Cap", tagline: "Three-thread embroidered Q on a low-profile dad cap.", category: "caps", examplePrice: 26,
    colors: [SWATCH.black, SWATCH.navy], sizes: ["One size"], mockups: { black: merchImg("mockups/cap-black.webp"), navy: merchImg("mockups/cap-navy.webp") },
    extras: [
      { src: merchImg("mockups/cap-black-lockup.webp"), alt: "Alternative: mark + wordmark" },
      { src: merchImg("designs/cap-embroidery-mark-3color-600dpi.webp"), alt: "Embroidery artwork (3 threads)", art: true },
    ],
    details: ["Embroidery: violet, cyan, white threads", "Adjustable strap"],
  },
  {
    id: "sticker-sheet", name: "Die-cut Sticker Sheet", tagline: "Logo, rank badges, quest badges and a few in-jokes.", category: "accessories", examplePrice: 8,
    colors: [], sizes: ["8.5 × 11 in sheet"], mockups: { default: merchImg("mockups/stickers-laptop.webp") },
    extras: [
      { src: merchImg("mockups/stickers-sheet.webp"), alt: "The full sheet" },
      { src: merchImg("designs/sticker-sheet-letter-preview.webp"), alt: "Sticker artwork", art: true },
    ],
    details: ["18 die-cut vinyl stickers", "Includes the 5 rank badges and 5 quest badges"], badge: "Laptop-ready",
  },
  {
    id: "quasar-mug", name: "gm, stardust Mug", tagline: "11 oz ceramic with a full starfield wrap.", category: "accessories", examplePrice: 16,
    colors: [SWATCH.black], sizes: ["11 oz"], mockups: { black: merchImg("mockups/mug-logo.webp") },
    extras: [
      { src: merchImg("mockups/mug-ranks.webp"), alt: "Other side: gm, stardust + rank ladder" },
      { src: merchImg("designs/mug-11oz-wrap.webp"), alt: "Full mug wrap artwork", art: true },
    ],
    details: ["Full-bleed wrap", "Dishwasher & microwave safe (example blank)"],
  },
];

export const CATEGORIES: { id: "all" | Category; label: string }[] = [
  { id: "all", label: "All" },
  { id: "tees", label: "Tees" },
  { id: "hoodies", label: "Hoodies" },
  { id: "caps", label: "Caps" },
  { id: "accessories", label: "Stickers & mugs" },
];

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export type NotifyEntry = { email: string; product: string; at: number };
export function readNotify(): NotifyEntry[] {
  try {
    const v = JSON.parse(localStorage.getItem(NOTIFY_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x) => x && typeof x.email === "string" && typeof x.product === "string") : [];
  } catch {
    return [];
  }
}
/** Save a "notify me" request in this browser only. Returns false for an invalid email. */
export function saveNotify(email: string, product: string, now = Date.now()): boolean {
  const e = email.trim().toLowerCase();
  if (!EMAIL_RE.test(e)) return false;
  const list = readNotify().filter((x) => !(x.email === e && x.product === product));
  list.push({ email: e, product, at: now });
  try { localStorage.setItem(NOTIFY_KEY, JSON.stringify(list.slice(-50))); } catch { /* storage full / disabled */ }
  return true;
}
export const fmtExample = (n: number) => `$${n.toFixed(2)}`;
