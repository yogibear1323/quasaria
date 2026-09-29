import { describe, expect, it, beforeEach } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { CATEGORIES, NOTIFY_KEY, PRODUCTS, readNotify, saveNotify } from "../src/merch/catalog";

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
