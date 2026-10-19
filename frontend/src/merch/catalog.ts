/**
 * Quasaria merch catalogue (preview). Nothing here is for sale yet: there is no
 * checkout, no payment and no backend. Prices are EXAMPLES for layout only.
 * Artwork: scripts/merch/ (print files are generated outside the repo). Yeti line: scripts/merch/yeti.mjs.
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
  /** Tee slogan: one small line of type (2 to 4 words, no price / yield / investment claims). */
  slogan?: string;
  badge?: string;
};

const SIZES = ["S", "M", "L", "XL", "2XL", "3XL"];
/** Yeti-line renders: cool garment colourways (midnight navy / glacier slate / glacier white), the parka yeti as the hero print with the Q as a small supporting mark, navy-steel studio backdrop. (mockups-icy/ = the earlier Q line, kept.) */
const mk = (name: string) => merchImg(`mockups-yeti/${name}.webp`);
const per = (base: string, colors: string[]) => Object.fromEntries(colors.map((c) => [c, mk(`${base}-${c}`)]));
/** Print artwork: the frost-lit yeti on a dark backdrop; `-ink` files are the light-garment (navy badge / deep ink) versions for glacier white, shown on a light backdrop. */
const art = (file: string, alt: string) => ({ src: merchImg(`designs-yeti/${file}.webp`), alt, art: true, ...(file.includes("-ink") ? { light: true } : {}) });

export const PRODUCTS: Product[] = [
  {
    id: "glow-hoodie", name: "Glow Hoodie", tagline: "The glowing yeti in its frost-lit parka over a clean white wordmark. Nothing else.", category: "hoodies", examplePrice: 64,
    colors: [SWATCH.black, SWATCH.navy], sizes: SIZES, mockups: per("hoodie", ["black", "navy"]),
    extras: [art("glow-lockup-yeti-center-chest-12x14in", "Centre-chest artwork: glowing yeti + wordmark")],
    details: ["Centre-chest yeti print, about 12 in wide", "Heavyweight fleece (example blank)", "White underbase so the glow stays bright on midnight navy"], badge: "Headline",
  },
  {
    id: "pearl-tee", name: "Glacier Iridescent Tee", tagline: "An oversized glacier-white tee with a shifting sheen, a navy yeti badge on the chest and a small Q with an ink wordmark on the sleeve.", category: "tees", examplePrice: 42,
    colors: [SWATCH.pearl], sizes: SIZES, mockups: { pearl: mk("pearl-tee") },
    extras: [
      art("chest-yeti-badge-center-slogan-ink-9x10in", "Centre-chest yeti badge with the small line “Self-Banking on Stellar”, deep ink"),
      art("chest-yeti-badge-center-ink-9x9in", "Centre-chest yeti badge, navy disc for glacier white (no line of type)"),
      art("sleeve-q-wordmark-ink-4x1.2in", "Sleeve Q + wordmark, deep ink"),
      art("neck-label-2x0.75in", "Inside neck label"),
    ],
    details: ["Centre-chest yeti badge, about 9 in, with a small deep-ink line under it: “Self-Banking on Stellar”", "Deep-ink Q and wordmark on the left sleeve", "Iridescent specialty blank (example); a glacier-white tee is the fallback"], badge: "Headline", slogan: "Self-Banking on Stellar",
  },
  {
    id: "glow-bomber", name: "Singularity Bomber", tagline: "A glacier-slate bomber with the yeti and wordmark on a chest patch and a vertical Quasaria beside the zip.", category: "jackets", examplePrice: 98,
    colors: [SWATCH.navy, SWATCH.black], sizes: SIZES, mockups: per("bomber", ["navy", "black"]),
    extras: [
      art("bomber-chest-patch-yeti-3x3.5in", "Chest patch: yeti + wordmark"),
      art("bomber-chest-embroidery-4x4in-600dpi", "Alternative chest embroidery: the Q, 3 threads"),
      art("bomber-placket-wordmark-vertical-1x4in-600dpi", "Vertical wordmark embroidery"),
    ],
    details: ["Sewn-on yeti chest patch (or a 3-thread Q embroidery, max 4 × 4 in)", "Vertical wordmark in 1 white thread", "Sleeve utility pocket (example blank)"], badge: "New",
  },
  {
    id: "back-glow-tee", name: "Back Glow Tee", tagline: "A small yeti badge on the chest and a large glowing yeti across the back.", category: "tees", examplePrice: 34,
    colors: [SWATCH.black], sizes: SIZES, mockups: { black: mk("backglow-tee-black-back") },
    extras: [
      { src: mk("backglow-tee-black-front"), alt: "Front: left-chest yeti badge" },
      art("back-glow-yeti-15x18in", "Back artwork: large glowing yeti"),
      art("chest-yeti-badge-left-4x4in", "Left-chest yeti badge"),
    ],
    details: ["Full-back yeti print + left-chest yeti badge", "A small line under the back print: “Your Keys. Your XLM.”", "Midnight navy only, so the glow can do the work"], badge: "Essential", slogan: "Your Keys. Your XLM.",
  },
  {
    id: "sleeve-tee", name: "Sleeve Wordmark Tee", tagline: "A small yeti badge on the chest and the Q with the Quasaria wordmark down the sleeve.", category: "tees", examplePrice: 30,
    colors: [SWATCH.navy, SWATCH.black], sizes: SIZES, mockups: per("sleeve-tee", ["navy", "black"]),
    extras: [{ src: mk("sleeve-tee-navy-back"), alt: "Back: small “Order Book Climber” line under the collar (yeti badge on the chest)" }, art("back-neck-slogan-white-4x0.6in", "Back-neck line “Order Book Climber”, white"), art("sleeve-q-wordmark-white-4x1.2in", "Sleeve Q + wordmark, white (glacier slate)"), art("sleeve-q-wordmark-cyan-4x1.2in", "Sleeve Q + wordmark, ice blue (midnight navy)")],
    details: ["Left-chest yeti badge + sleeve Q and wordmark", "White wordmark on glacier slate, ice blue on midnight navy", "A small line under the back collar: “Order Book Climber”"], slogan: "Order Book Climber",
  },
  {
    id: "speed-of-light-tee", name: "Speed of Light Tee", tagline: "The glowing yeti, a single light streak and one quiet line of type.", category: "tees", examplePrice: 32,
    colors: [SWATCH.black, SWATCH.navy], sizes: SIZES, mockups: per("speed-of-light", ["black", "navy"]),
    extras: [art("speed-of-light-yeti-15x18in", "Front artwork: yeti")],
    details: ["Front yeti print, art kept to about 11 in", "Stellar settles in about 5 seconds, which is close enough", "One small line of type: “Swap at Light Speed”"], slogan: "Swap at Light Speed",
  },
  {
    id: "level-up-tee", name: "Level Up Tee", tagline: "The yeti inside a single XP ring. Learn it, try it once, level up.", category: "tees", examplePrice: 32,
    colors: [SWATCH.black, SWATCH.pearl], sizes: SIZES, mockups: per("level-up", ["black", "pearl"]),
    extras: [art("level-up-yeti-15x18in", "Front artwork: yeti in an XP ring"), art("level-up-yeti-15x18in-ink", "Front artwork, navy yeti badge (glacier white)")],
    details: ["Front yeti print, art kept to about 11 in", "One small line of type: “Level Up on Stellar”", "Inspired by the in-app quests (XP itself has no monetary value)"], badge: "Game layer", slogan: "Level Up on Stellar",
  },
  {
    id: "stardust-quasar-tee", name: "Stardust to Quasar Tee", tagline: "Four specks of stardust growing into the glowing yeti, with one line of type.", category: "tees", examplePrice: 32,
    colors: [SWATCH.navy, SWATCH.black], sizes: SIZES, mockups: per("stardust", ["navy", "black"]),
    extras: [art("stardust-to-quasar-yeti-15x18in", "Front artwork: yeti")],
    details: ["Front yeti print, art kept to about 11 in", "One small line of type: “Born on Stellar”", "Stardust is the first of the five in-app ranks"], slogan: "Born on Stellar",
  },
  {
    id: "singularity-cap", name: "Embroidered Q Cap", tagline: "The Singularity Q in three threads on a low-profile cap, with a round yeti patch version and a wordmark version.", category: "caps", examplePrice: 28,
    colors: [SWATCH.black, SWATCH.navy], sizes: ["One size"], mockups: per("cap", ["black", "navy"]),
    extras: [
      { src: mk("cap-black-yeti-patch"), alt: "Alternative: round yeti patch" },
      { src: mk("cap-black-lockup"), alt: "Alternative: Q + wordmark" },
      art("cap-patch-yeti-3in-round", "Yeti patch artwork, 3 in round"),
      art("cap-embroidery-q-3color-600dpi", "Embroidery artwork, 3 threads"),
    ],
    details: ["Silver-blue, ice-blue and white threads (3 max)", "Yeti photo patch option (woven or sublimated)", "Adjustable strap"],
  },
  {
    id: "glow-mug", name: "Glow Mug", tagline: "Midnight navy 11 oz ceramic with the glowing yeti on one side and the Q over the wordmark on the other.", category: "accessories", examplePrice: 18,
    colors: [SWATCH.black], sizes: ["11 oz"], mockups: { black: mk("mug-glow-front") },
    extras: [{ src: mk("mug-glow-back"), alt: "Other side: Q + wordmark" }, art("mug-11oz-wrap-yeti-navy", "Full mug wrap artwork: yeti + Q")],
    details: ["Full wrap on midnight navy ceramic", "Dishwasher & microwave safe (example blank)"],
  },
  {
    id: "sticker-sheet", name: "Logo Sticker Sheet", tagline: "Eight logo stickers: two yeti badges, the Q, lockups and wordmarks.", category: "accessories", examplePrice: 8,
    colors: [], sizes: ["5.5 × 8.5 in sheet"], mockups: { default: mk("stickers-laptop") },
    extras: [{ src: mk("stickers-sheet"), alt: "The full sheet" }, art("sticker-sheet-5.5x8.5in-preview", "Sticker artwork: yeti badges + Q")],
    details: ["8 kiss-cut vinyl stickers", "Yeti badges, Q and wordmark only"], badge: "Laptop-ready",
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

/** The 3-up store banner: yeti hoodie, glacier tee, bomber. */
export const HERO_IMG = merchImg("hero/merch-hero-v4-yeti.webp");

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
