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
  black: { id: "black", name: "Black", hex: "#141418" },
  bone: { id: "bone", name: "Bone", hex: "#ECE6DA" },
  lavender: { id: "lavender", name: "Lavender", hex: "#C9BEF2" },
  lime: { id: "lime", name: "Electric lime", hex: "#D4F75A" },
  white: { id: "white", name: "White", hex: "#F7F6F2" },
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
  extras: { src: string; alt: string; art?: boolean; light?: boolean }[];
  details: string[];
  badge?: string;
};

const TEE_SIZES = ["S", "M", "L", "XL", "2XL", "3XL"];
const tee = (n: string, colors: string[]) => Object.fromEntries(colors.map((c) => [c, merchImg(`mockups/tee-${n}-${c}.webp`)]));
/** Print artwork; dark-ink files ("-on-light", the white mug wrap) are shown on a bone backdrop. */
const art = (file: string, alt: string) => ({ src: merchImg(`designs/${file}.webp`), alt, art: true, light: /-on-light$|-white$|-light-/.test(file) });

export const PRODUCTS: Product[] = [
  {
    id: "singularity-tee", name: "Singularity Chest Tee", tagline: "The Singularity Q, a tight wordmark and a little coral spark. Clean enough for every day.", category: "tees", examplePrice: 28,
    colors: [SWATCH.black, SWATCH.bone, SWATCH.lavender], sizes: TEE_SIZES, mockups: tee("01", ["black", "bone", "lavender"]),
    extras: [art("tee-01-singularity-chest-5x5in-on-dark", "Chest artwork, light ink (for black)"), art("tee-01-singularity-chest-5x5in-on-light", "Chest artwork, dark ink (for bone and lavender)")],
    details: ["5 × 5 in left-chest print", "Two inks, matched to the shirt colour", "Soft ring-spun cotton (example blank)"], badge: "Essential",
  },
  {
    id: "quasar-core-tee", name: "Quasar Core Back-Print Tee", tagline: "A holographic accretion disk over an oversized liquid-chrome QUASAR. The brightest thing in the universe.", category: "tees", examplePrice: 34,
    colors: [SWATCH.black, SWATCH.bone], sizes: TEE_SIZES, mockups: { black: merchImg("mockups/tee-02-black-back.webp"), bone: merchImg("mockups/tee-02-bone-back.webp") },
    extras: [
      { src: merchImg("mockups/tee-02-black-front.webp"), alt: "Front: chest mark" },
      art("tee-02-quasar-core-back-on-dark", "Back artwork with glow (for black)"),
      art("tee-02-quasar-core-back-on-light", "Back artwork with a dark 'singularity' core (for bone)"),
    ],
    details: ["15 × 18 in full-back print + small chest mark", "Black gets the glow edition; bone gets a crisp dark-core edition", "Nods to 3C 273, the first quasar identified (1963)"], badge: "Flagship",
  },
  {
    id: "speed-of-light-tee", name: "Speed of Light Tee", tagline: "Trade at the speed of light: leaning chrome type, a grainy sunset orb and coral speed streaks.", category: "tees", examplePrice: 30,
    colors: [SWATCH.black, SWATCH.bone, SWATCH.lime], sizes: TEE_SIZES, mockups: tee("03", ["black", "bone", "lime"]),
    extras: [art("tee-03-speed-of-light-on-dark", "Front artwork, light ink"), art("tee-03-speed-of-light-on-light", "Front artwork, dark ink")],
    details: ["15 × 18 in front print", "Liquid-chrome type with soft grain", "Stellar settles in about 5 seconds, which is close enough"], badge: "New",
  },
  {
    id: "level-up-tee", name: "Level Up Tee", tagline: "The Singularity Q inside a holographic XP ring, with +XP chips. Learn it, try it once, level up.", category: "tees", examplePrice: 30,
    colors: [SWATCH.black, SWATCH.lavender, SWATCH.lime], sizes: TEE_SIZES, mockups: tee("04", ["black", "lavender", "lime"]),
    extras: [art("tee-04-level-up-on-dark", "Front artwork, light ink"), art("tee-04-level-up-on-light", "Front artwork, dark ink")],
    details: ["15 × 18 in front print", "A modern take on the old arcade design: XP ring and halftone dots, no pixel art", "Inspired by the in-app quests (XP itself has no monetary value)"], badge: "Game layer",
  },
  {
    id: "stardust-quasar-tee", name: "Stardust to Quasar Tee", tagline: "Oversized stacked type with a holographic QUASAR, and the five ranks climbing up the side.", category: "tees", examplePrice: 30,
    colors: [SWATCH.black, SWATCH.bone, SWATCH.lavender], sizes: TEE_SIZES, mockups: tee("05", ["black", "bone", "lavender"]),
    extras: [art("tee-05-stardust-to-quasar-on-dark", "Front artwork, light ink"), art("tee-05-stardust-to-quasar-on-light", "Front artwork, dark ink")],
    details: ["15 × 18 in front print", "Stardust · Comet · Nova · Pulsar · Quasar"],
  },
  {
    id: "singularity-hoodie", name: "Singularity Orbit Hoodie", tagline: "The Q in a holographic orbit over an oversized chrome wordmark, with a gradient sleeve print.", category: "hoodies", examplePrice: 58,
    colors: [SWATCH.black, SWATCH.bone, SWATCH.lavender], sizes: TEE_SIZES, mockups: { black: merchImg("mockups/hoodie-black.webp"), bone: merchImg("mockups/hoodie-bone.webp"), lavender: merchImg("mockups/hoodie-lavender.webp") },
    extras: [
      art("hoodie-singularity-front-on-dark", "Front artwork, light ink"),
      art("hoodie-singularity-front-on-light", "Front artwork, dark ink"),
      art("hoodie-singularity-sleeve-4x16in-on-dark", "Sleeve artwork: From Stardust to Quasar"),
    ],
    details: ["Front print + optional 4 × 16 in sleeve print", "Mid-weight fleece (example blank)"], badge: "Cosy",
  },
  {
    id: "singularity-cap", name: "Embroidered Singularity Cap", tagline: "The Singularity Q embroidered in 2–3 threads on a low-profile dad cap. Wordmark version included.", category: "caps", examplePrice: 26,
    colors: [SWATCH.black, SWATCH.bone], sizes: ["One size"], mockups: { black: merchImg("mockups/cap-black.webp"), bone: merchImg("mockups/cap-bone.webp") },
    extras: [
      { src: merchImg("mockups/cap-black-lockup.webp"), alt: "Alternative: mark + wordmark on black" },
      { src: merchImg("mockups/cap-bone-lockup.webp"), alt: "Alternative: mark + wordmark on bone" },
      art("cap-embroidery-mark-3color-600dpi", "Embroidery artwork, 3 threads"),
    ],
    details: ["Black: violet, cyan and white threads", "Bone: violet with a coral glint", "Adjustable strap"],
  },
  {
    id: "sticker-sheet", name: "Die-cut Sticker Sheet", tagline: "A holo logo, rank chips, quest badges, a chrome LEVEL UP and a few in-jokes.", category: "accessories", examplePrice: 8,
    colors: [], sizes: ["8.5 × 11 in sheet"], mockups: { default: merchImg("mockups/stickers-laptop.webp") },
    extras: [
      { src: merchImg("mockups/stickers-sheet.webp"), alt: "The full sheet" },
      art("sticker-sheet-letter-preview", "Sticker artwork"),
    ],
    details: ["18 die-cut vinyl stickers", "Includes the 5 rank chips and 5 quest badges"], badge: "Laptop-ready",
  },
  {
    id: "quasar-mug", name: "gm, stardust Mug", tagline: "White 11 oz ceramic: a big gm with a grainy sunrise on one side, the Q and rank chips on the other.", category: "accessories", examplePrice: 16,
    colors: [SWATCH.white], sizes: ["11 oz"], mockups: { white: merchImg("mockups/mug-gm-front.webp") },
    extras: [
      { src: merchImg("mockups/mug-gm-back.webp"), alt: "Other side: Singularity Q + rank chips" },
      art("mug-11oz-wrap-gm-stardust-white", "Full mug wrap artwork"),
    ],
    details: ["Full wrap on white ceramic", "Dishwasher & microwave safe (example blank)"],
  },
  {
    id: "singularity-mug", name: "Singularity Mug", tagline: "Black 11 oz ceramic: a glowing Q and chrome wordmark, with LEVEL UP on the back.", category: "accessories", examplePrice: 16,
    colors: [SWATCH.black], sizes: ["11 oz"], mockups: { black: merchImg("mockups/mug-singularity-front.webp") },
    extras: [
      { src: merchImg("mockups/mug-singularity-back.webp"), alt: "Other side: LEVEL UP + rank chips" },
      art("mug-11oz-wrap-singularity-black", "Full mug wrap artwork"),
    ],
    details: ["Full-bleed dark wrap with soft grain", "Dishwasher & microwave safe (example blank)"], badge: "New",
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
