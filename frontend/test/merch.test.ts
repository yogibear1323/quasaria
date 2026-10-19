import { describe, expect, it, beforeEach } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { CATEGORIES, HERO_IMG, SWATCH, MERCH_APPLE_ICON, MERCH_FAVICON_PNG, MERCH_FAVICON_SVG, MERCH_MARK, MERCH_MARK_LG, NOTIFY_KEY, PRODUCTS, readNotify, saveNotify } from "../src/merch/catalog";

const PUBLIC = resolve(__dirname, "../public");
const local = (url: string) => resolve(PUBLIC, url.replace(/^\/+/, ""));

describe("merch catalogue (preview storefront)", () => {
  it("every product has a unique id, a category, sizes and at least one mockup", () => {
    expect(new Set(PRODUCTS.map((p) => p.id)).size).toBe(PRODUCTS.length);
    for (const p of PRODUCTS) {
      expect(CATEGORIES.some((c) => c.id === p.category)).toBe(true);
      expect(p.sizes.length).toBeGreaterThan(0);
      expect(Object.keys(p.mockups).length).toBeGreaterThan(0);
      expect(p.examplePrice).toBeGreaterThan(0);
      // swatches line up with the per-colour mockups
      for (const c of p.colors) expect(p.mockups[c.id], `${p.id}/${c.id}`).toBeTruthy();
    }
  });

  it("every referenced image exists in public/", () => {
    for (const p of PRODUCTS) for (const src of [...Object.values(p.mockups), ...p.extras.map((x) => x.src)]) {
      expect(existsSync(local(src)), src).toBe(true);
    }
  });

  it("the store carries the yeti brand mark (icons exist) and no removed-feature copy", () => {
    for (const u of [MERCH_MARK, MERCH_MARK_LG, MERCH_FAVICON_SVG, MERCH_FAVICON_PNG, MERCH_APPLE_ICON]) expect(existsSync(local(u)), u).toBe(true);
    expect(existsSync(resolve(PUBLIC, "merch-assets/brand/og-merch.jpg"))).toBe(true);
    const src = ["../src/pages/Merch.tsx", "../src/merch/catalog.ts", "../src/theme/merch.css", "../src/theme/merch-frost.css"].map((f) => readFileSync(resolve(__dirname, f), "utf8")).join("\n");
    expect(src).not.toMatch(/perps|beacon|trading bot|polybot/i);
  });

  it("colourways are the cool frost palette (no earthy swatches or copy)", () => {
    const names = Object.values(SWATCH).map((s) => s.name);
    expect(names).toEqual(["Midnight Navy", "Glacier Slate", "Glacier White"]);
    for (const sw of Object.values(SWATCH)) {
      const n = parseInt(sw.hex.slice(1), 16);
      expect(n & 255, `${sw.name} should lean blue`).toBeGreaterThan(n >> 16);
    }
    const text = JSON.stringify(PRODUCTS.map((p) => ({ n: p.name, t: p.tagline, d: p.details, c: p.colors.map((c) => c.name), x: p.extras.map((e) => e.alt) })));
    expect(text).not.toMatch(/umber|moss|sand\b|honey|clay|terracotta/i);
    for (const p of PRODUCTS) for (const src of [...Object.values(p.mockups), ...p.extras.map((x) => x.src)]) {
      expect(src, src).toMatch(/mockups-yeti|designs-yeti/);
    }
  });

  it("no public/ folder collides with an SPA route (GitHub Pages deep links)", () => {
    const cfg = readFileSync(resolve(__dirname, "../vite.config.ts"), "utf8");
    const routes = JSON.parse(cfg.match(/SPA_ROUTES = (\[[^\]]*\])/)![1]) as string[];
    expect(routes).toContain("merch");
    const app = readFileSync(resolve(__dirname, "../src/App.tsx"), "utf8");
    for (const m of app.matchAll(/path="\/([a-z-]+)"/g)) expect(routes, `route /${m[1]} missing from SPA_ROUTES`).toContain(m[1]);
    for (const name of readdirSync(PUBLIC)) {
      if (statSync(resolve(PUBLIC, name)).isDirectory()) expect(routes).not.toContain(name);
    }
  });

  describe("notify me (local only)", () => {
    const store = new Map<string, string>();
    beforeEach(() => {
      store.clear();
      (globalThis as unknown as { localStorage: Storage }).localStorage = {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, v),
        removeItem: (k: string) => void store.delete(k),
        clear: () => store.clear(),
        key: () => null,
        length: 0,
      } as Storage;
    });

    it("rejects invalid emails and de-duplicates per product", () => {
      expect(saveNotify("nope", "singularity-tee")).toBe(false);
      expect(readNotify()).toEqual([]);
      expect(saveNotify(" Me@Example.com ", "singularity-tee", 1)).toBe(true);
      expect(saveNotify("me@example.com", "singularity-tee", 2)).toBe(true);
      expect(readNotify()).toEqual([{ email: "me@example.com", product: "singularity-tee", at: 2 }]);
    });

    it("survives corrupt storage", () => {
      store.set(NOTIFY_KEY, "{bad");
      expect(readNotify()).toEqual([]);
    });
  });
});

describe("merch v4 line (minimal, logo-led)", () => {
  it("uses only the black / navy / pearl palette and leads with hoodie, pearl tee and bomber", () => {
    for (const p of PRODUCTS) for (const c of p.colors) expect(["black", "navy", "pearl"], `${p.id}/${c.id}`).toContain(c.id);
    expect(PRODUCTS.slice(0, 3).map((p) => p.id)).toEqual(["glow-hoodie", "pearl-tee", "glow-bomber"]);
    for (const id of ["speed-of-light-tee", "level-up-tee", "stardust-quasar-tee"]) expect(PRODUCTS.some((p) => p.id === id), id).toBe(true);
    const copy = JSON.stringify(PRODUCTS).toLowerCase();
    for (const w of ["bone", "lavender", "lime", "coral", "chrome", "holographic"]) expect(copy, w).not.toContain(w);
  });

  it("ships the 3-up hero banner", async () => {
    const { HERO_IMG } = await import("../src/merch/catalog");
    expect(existsSync(local(HERO_IMG))).toBe(true);
  });
});

describe("merch yeti line (yeti is the hero print, the Q is the supporting mark)", () => {
  const imgs = (p: (typeof PRODUCTS)[number]) => [...Object.values(p.mockups), ...p.extras.map((x) => x.src)];

  it("every product shows yeti imagery from mockups-yeti/ and designs-yeti/ (never the earlier Q-only folders)", () => {
    for (const p of PRODUCTS) {
      for (const src of Object.values(p.mockups)) expect(src, `${p.id} mockup`).toContain("/mockups-yeti/");
      for (const src of imgs(p)) {
        expect(src, `${p.id}: ${src}`).toMatch(/\/(mockups|designs)-yeti\//);
        expect(src).not.toMatch(/mockups-icy|designs-icy|mockups-frost|\/mockups\/|\/designs\//);
        expect(existsSync(local(src)), src).toBe(true);
      }
    }
    expect(HERO_IMG).toContain("merch-hero-v4-yeti");
    expect(existsSync(local(HERO_IMG))).toBe(true);
  });

  it("every product's copy tells you the yeti is on it (tees, hoodie, bomber, cap, mug, stickers)", () => {
    for (const p of PRODUCTS) {
      const copy = [p.tagline, ...p.details, ...p.extras.map((x) => x.alt)].join(" ");
      expect(copy, p.id).toMatch(/yeti/i);
    }
    // the five tee designs lead with the yeti; the Q is only a supporting mark on them
    for (const id of ["pearl-tee", "back-glow-tee", "sleeve-tee", "speed-of-light-tee", "level-up-tee", "stardust-quasar-tee"]) {
      const p = PRODUCTS.find((x) => x.id === id)!;
      expect(p.tagline.toLowerCase(), id).toContain("yeti");
      expect(p.tagline, `${id} tagline no longer leads with the glowing Q`).not.toMatch(/glowing Q\b/);
    }
  });

  it("the yeti cut-out source and the generated yeti print art are in place and not the raw photo", () => {
    const asset = resolve(__dirname, "../../scripts/merch/assets/yeti-bust-cutout.webp");
    expect(existsSync(asset)).toBe(true);
    const buf = readFileSync(asset);
    expect(buf.subarray(0, 4).toString()).toBe("RIFF");
    expect(buf.subarray(8, 12).toString()).toBe("WEBP");
    expect(buf.subarray(12, 16).toString(), "WebP must be VP8X so it carries an alpha channel").toBe("VP8X");
    expect(buf[20] & 0x10, "alpha flag").toBeTruthy();
    expect(statSync(asset).size).toBeLessThan(3_000_000);
    for (const f of ["glow-lockup-yeti-center-chest-12x14in", "back-glow-yeti-15x18in", "chest-yeti-badge-left-4x4in", "chest-yeti-badge-center-ink-9x9in", "bomber-chest-patch-yeti-3x3.5in", "mug-11oz-wrap-yeti-navy"]) {
      expect(existsSync(resolve(PUBLIC, `merch-assets/designs-yeti/${f}.webp`)), f).toBe(true);
    }
  });

  it("the old Q-line folders are untouched (kept as backups)", () => {
    for (const d of ["mockups-icy", "designs-icy", "mockups", "designs"]) expect(existsSync(resolve(PUBLIC, "merch-assets", d)), d).toBe(true);
  });

  it("yeti copy keeps the bans (no Beacons / perps / bots) and the cool palette", () => {
    const text = JSON.stringify(PRODUCTS);
    expect(text).not.toMatch(/beacon|perps|trading bot|polybot|umber|moss|sand\b|clay|terracotta/i);
    const page = readFileSync(resolve(__dirname, "../src/pages/Merch.tsx"), "utf8");
    expect(page).not.toMatch(/beacon|perps|trading bot|polybot/i);
    expect(page).toMatch(/Quasaria yeti/);
  });

  it("the Coming soon buttons are still disabled", () => {
    const page = readFileSync(resolve(__dirname, "../src/pages/Merch.tsx"), "utf8");
    expect(page).toMatch(/disabled/);
    expect(page).toMatch(/Coming soon/);
  });
});
