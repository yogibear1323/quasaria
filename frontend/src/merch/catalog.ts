/**
 * Quasaria merch catalogue (preview). Nothing here is for sale yet: there is no
 * checkout, no payment and no backend. Prices are EXAMPLES for layout only.
 * Artwork: scripts/merch/ (print files are generated outside the repo).
 */
const BASE = (import.meta.env?.BASE_URL ?? "/").replace(/\/?$/, "/");
export const merchImg = (path: string) => `${BASE}merch-assets/${path}`;

/** Store brand mark: square crop of the parka-yeti photo (same image as the GLACIERQ token icon). Replaces the Q on /merch. */
export const MERCH_MARK = merchImg("brand/yeti-mark-192.png");
export const MERCH_MARK_LG = merchImg("brand/yeti-mark-512.png");
export const MERCH_FAVICON_SVG = merchImg("brand/favicon-yeti.svg");
export const MERCH_FAVICON_PNG = merchImg("brand/favicon-yeti-32.png");
export const MERCH_APPLE_ICON = merchImg("brand/apple-touch-yeti.png");
export const MERCH_TITLE = "Quasaria Supply — merch preview (coming soon)";

/** Optional contact address for a mailto "notify me". Leave empty to only save locally. */
export const MERCH_CONTACT_EMAIL = "";
export const NOTIFY_KEY = "quasaria.merch.notify.v1";

export type Swatch = { id: string; name: string; hex: string };
/** Frost palette: silver / ice-blue glow on midnight navy, glacier slate and glacier white. */
export const SWATCH: Record<string, Swatch> = {
  black: { id: "black", name: "Midnight Navy", hex: "#16213B" },
  navy: { id: "navy", name: "Glacier Slate", hex: "#2F4468" },
  pearl: { id: "pearl", name: "Glacier White", hex: "#E8F0FA" },
};

export type Category = "tees" | "hoodies" | "jackets" | "caps" | "accessories";
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

const SIZES = ["S", "M", "L", "XL", "2XL", "3XL"];
/** Frost renders: cool garment colourways (midnight navy / glacier slate / glacier white), silver and ice-blue Q art, navy-steel studio backdrop. */
const mk = (name: string) => merchImg(`mockups-icy/${name}.webp`);
const per = (base: string, colors: string[]) => Object.fromEntries(colors.map((c) => [c, mk(`${base}-${c}`)]));
/** Print artwork: silver / ice-blue glow ink on a dark backdrop; `-ink` files are deep-navy ink for glacier white, shown on a light backdrop. */
const art = (file: string, alt: string) => ({ src: merchImg(`designs-icy/${file}.webp`), alt, art: true, ...(file.includes("-ink") ? { light: true } : {}) });

export const PRODUCTS: Product[] = [
  {
    id: "glow-hoodie", name: "Glow Hoodie", tagline: "The glowing Singularity Q over a clean white wordmark. Nothing else.", category: "hoodies", examplePrice: 64,
    colors: [SWATCH.black, SWATCH.navy], sizes: SIZES, mockups: per("hoodie", ["black", "navy"]),
    extras: [art("glow-lockup-center-chest-12x14in", "Centre-chest artwork: glowing Q + wordmark")],
    details: ["Centre-chest print, about 12 in wide", "Heavyweight fleece (example blank)", "White underbase so the glow stays bright on midnight navy"], badge: "Headline",
  },
  {
    id: "pearl-tee", name: "Glacier Iridescent Tee", tagline: "An oversized glacier-white tee with a shifting sheen, a small deep-ink Q on the chest and an ink wordmark on the sleeve.", category: "tees", examplePrice: 42,
    colors: [SWATCH.pearl], sizes: SIZES, mockups: { pearl: mk("pearl-tee") },
    extras: [
      art("chest-q-left-4x4in-ink", "Left-chest Singularity Q, deep ink"),
      art("sleeve-wordmark-ink-4x1.2in", "Sleeve wordmark, deep ink"),
      art("neck-label-2x0.75in", "Inside neck label"),
    ],
    details: ["Left-chest Q, about 3.5 in", "Deep-ink wordmark on the left sleeve", "Iridescent specialty blank (example); a glacier-white tee is the fallback"], badge: "Headline",
  },
  {
    id: "glow-bomber", name: "Singularity Bomber", tagline: "A glacier-slate bomber with the Q and wordmark on a chest patch and a vertical Quasaria beside the zip.", category: "jackets", examplePrice: 98,
    colors: [SWATCH.navy, SWATCH.black], sizes: SIZES, mockups: per("bomber", ["navy", "black"]),
    extras: [
      art("bomber-chest-patch-3x3.5in", "Chest patch: Q + wordmark"),
      art("bomber-chest-embroidery-4x4in-600dpi", "Chest embroidery, 3 threads"),
      art("bomber-placket-wordmark-vertical-1x4in-600dpi", "Vertical wordmark embroidery"),
    ],
    details: ["Embroidered chest (max 4 × 4 in) or a sewn-on patch", "Vertical wordmark in 1 white thread", "Sleeve utility pocket (example blank)"], badge: "New",
  },
  {
    id: "back-glow-tee", name: "Back Glow Tee", tagline: "A small Q on the chest and a large glowing Q across the back.", category: "tees", examplePrice: 34,
    colors: [SWATCH.black], sizes: SIZES, mockups: { black: mk("backglow-tee-black-back") },
    extras: [
      { src: mk("backglow-tee-black-front"), alt: "Front: left-chest Q" },
      art("back-glow-q-15x18in", "Back artwork: large glowing Q"),
      art("chest-q-left-4x4in", "Left-chest Q"),
    ],
    details: ["Full-back print + left-chest Q", "Midnight navy only, so the glow can do the work"], badge: "Essential",
  },
  {
    id: "sleeve-tee", name: "Sleeve Wordmark Tee", tagline: "A small Q on the chest and the Quasaria wordmark down the sleeve.", category: "tees", examplePrice: 30,
    colors: [SWATCH.navy, SWATCH.black], sizes: SIZES, mockups: per("sleeve-tee", ["navy", "black"]),
    extras: [art("sleeve-wordmark-white-4x1.2in", "Sleeve wordmark, white (glacier slate)"), art("sleeve-wordmark-cyan-4x1.2in", "Sleeve wordmark, ice blue (midnight navy)")],
    details: ["Left-chest Q + sleeve wordmark", "White wordmark on glacier slate, ice blue on midnight navy"],
  },
  {
    id: "speed-of-light-tee", name: "Speed of Light Tee", tagline: "The glowing Q, a single light streak and one quiet line of type.", category: "tees", examplePrice: 32,
    colors: [SWATCH.black, SWATCH.navy], sizes: SIZES, mockups: per("speed-of-light", ["black", "navy"]),
    extras: [art("speed-of-light-minimal-15x18in", "Front artwork")],
    details: ["Front print, art kept to about 11 in", "Stellar settles in about 5 seconds, which is close enough"],
  },
  {
    id: "level-up-tee", name: "Level Up Tee", tagline: "The glowing Q inside a single XP ring. Learn it, try it once, level up.", category: "tees", examplePrice: 32,
    colors: [SWATCH.black, SWATCH.pearl], sizes: SIZES, mockups: per("level-up", ["black", "pearl"]),
    extras: [art("level-up-minimal-15x18in", "Front artwork"), art("level-up-minimal-15x18in-ink", "Front artwork, deep ink (glacier white)")],
    details: ["Front print, art kept to about 11 in", "Inspired by the in-app quests (XP itself has no monetary value)"], badge: "Game layer",
  },
  {
    id: "stardust-quasar-tee", name: "Stardust to Quasar Tee", tagline: "Four specks of stardust growing into the glowing Q, with one line of type.", category: "tees", examplePrice: 32,
    colors: [SWATCH.navy, SWATCH.black], sizes: SIZES, mockups: per("stardust", ["navy", "black"]),
    extras: [art("stardust-to-quasar-minimal-15x18in", "Front artwork")],
    details: ["Front print, art kept to about 11 in", "From stardust to quasar, the five in-app ranks in one line"],
  },
  {
    id: "singularity-cap", name: "Embroidered Q Cap", tagline: "The Singularity Q in three threads on a low-profile cap. Wordmark version included.", category: "caps", examplePrice: 28,
    colors: [SWATCH.black, SWATCH.navy], sizes: ["One size"], mockups: per("cap", ["black", "navy"]),
    extras: [
      { src: mk("cap-black-lockup"), alt: "Alternative: Q + wordmark" },
      art("cap-embroidery-q-3color-600dpi", "Embroidery artwork, 3 threads"),
    ],
    details: ["Silver-blue, ice-blue and white threads (3 max)", "Adjustable strap"],
  },
  {
    id: "glow-mug", name: "Glow Mug", tagline: "Midnight navy 11 oz ceramic with the glowing Q on one side and the wordmark on the other.", category: "accessories", examplePrice: 18,
    colors: [SWATCH.black], sizes: ["11 oz"], mockups: { black: mk("mug-glow-front") },
    extras: [{ src: mk("mug-glow-back"), alt: "Other side: wordmark" }, art("mug-11oz-wrap-glow-black", "Full mug wrap artwork")],
    details: ["Full wrap on midnight navy ceramic", "Dishwasher & microwave safe (example blank)"],
  },
  {
    id: "sticker-sheet", name: "Logo Sticker Sheet", tagline: "Eight logo stickers: the glowing Q, lockups and wordmarks.", category: "accessories", examplePrice: 8,
    colors: [], sizes: ["5.5 × 8.5 in sheet"], mockups: { default: mk("stickers-laptop") },
    extras: [{ src: mk("stickers-sheet"), alt: "The full sheet" }, art("sticker-sheet-5.5x8.5in-preview", "Sticker artwork")],
    details: ["8 kiss-cut vinyl stickers", "Logo and wordmark only"], badge: "Laptop-ready",
  },
];

export const CATEGORIES: { id: "all" | Category; label: string }[] = [
  { id: "all", label: "All" },
  { id: "tees", label: "Tees" },
  { id: "hoodies", label: "Hoodies" },
  { id: "jackets", label: "Jackets" },
  { id: "caps", label: "Caps" },
  { id: "accessories", label: "Stickers & mugs" },
];

/** The 3-up store banner: Glow hoodie, glacier tee, bomber. */
export const HERO_IMG = merchImg("hero/merch-hero-v4-icy.webp");

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
