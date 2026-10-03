import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, statSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import SizzleReel from "../src/components/SizzleReel";
import { PROMO_PAGE_URL, SIZZLE_COPY, sizzleCuts } from "../src/lib/sizzle";

const landing = readFileSync(new URL("../src/pages/Landing.tsx", import.meta.url), "utf8");

describe("landing sizzle reel", () => {
  it("references both cuts by their public promo URLs (mp4s are not committed)", () => {
    const cuts = sizzleCuts("/quasaria/");
    expect(cuts.map((c) => c.src)).toEqual([
      "https://yogibear1323.github.io/promo/quasaria-sizzle-16x9.mp4",
      "https://yogibear1323.github.io/promo/quasaria-sizzle-9x16.mp4",
    ]);
    expect(cuts.map((c) => c.poster)).toEqual(["/quasaria/media/quasaria-sizzle-16x9-poster.jpg", "/quasaria/media/quasaria-sizzle-9x16-poster.jpg"]);
    expect(existsSync(new URL("../public/media/quasaria-sizzle-16x9.mp4", import.meta.url))).toBe(false);
  });
  it("ships small poster frames in public/media", () => {
    for (const c of sizzleCuts("/")) {
      const f = new URL(`../public${c.poster}`, import.meta.url);
      expect(existsSync(f), c.poster).toBe(true);
      expect(statSync(f).size).toBeLessThan(200_000);
    }
  });
  it("renders click-to-play videos (controls, playsinline, metadata preload, poster, no autoplay) and the promo link", () => {
    const html = renderToStaticMarkup(<SizzleReel />);
    expect(html.match(/<video /g)?.length).toBe(2);
    expect(html).toContain('preload="metadata"');
    expect(html).toMatch(/<video [^>]*playsinline/i);
    expect(html).toContain("controls");
    expect(html).toMatch(/poster="[^"]*quasaria-sizzle-16x9-poster\.jpg"/);
    expect(html).toMatch(/poster="[^"]*quasaria-sizzle-9x16-poster\.jpg"/);
    expect(html).not.toMatch(/autoplay/i);
    expect(html).toContain(`href="${PROMO_PAGE_URL}"`);
    expect(html).toContain("Watch on the promo page");
  });
  it("sits directly below the hero and uses approved wording", () => {
    const hero = landing.indexOf("</section>", landing.indexOf('className="l-hero"'));
    const watch = landing.indexOf('<Section id="watch"');
    const markets = landing.indexOf('<Section id="markets"');
    expect(hero).toBeGreaterThan(0);
    expect(watch).toBeGreaterThan(hero);
    expect(markets).toBeGreaterThan(watch);
    expect(landing.slice(hero, watch)).not.toMatch(/<Section /);
    expect(SIZZLE_COPY.headline).toBe("See Quasaria in 34 seconds.");
    const text = JSON.stringify(SIZZLE_COPY) + renderToStaticMarkup(<SizzleReel />);
    expect(text).not.toMatch(/bank/i);
  });
});
