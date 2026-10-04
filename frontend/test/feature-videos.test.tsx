import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, statSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import FeatureVideos from "../src/components/FeatureVideos";
import { FEATURE_VIDEOS, FEATURE_VIDEOS_COPY, featurePoster, featureSrc, fmtRuntime } from "../src/lib/featureVideos";

const landing = readFileSync(new URL("../src/pages/Landing.tsx", import.meta.url), "utf8");
const pub = (p: string) => new URL(`../public${p}`, import.meta.url);

describe("landing feature videos", () => {
  it("ships compressed 16:9 + 9:16 mp4s and small posters for every feature under public/media/features", () => {
    expect(FEATURE_VIDEOS.length).toBeGreaterThanOrEqual(8);
    for (const v of FEATURE_VIDEOS) {
      for (const a of ["16x9", "9x16"] as const) {
        const mp4 = pub(featureSrc(v, a, "/"));
        expect(existsSync(mp4), mp4.pathname).toBe(true);
        expect(statSync(mp4).size).toBeLessThan(4_000_000);
        const jpg = pub(featurePoster(v, a, "/"));
        expect(existsSync(jpg), jpg.pathname).toBe(true);
        expect(statSync(jpg).size).toBeLessThan(120_000);
      }
    }
    expect(featureSrc(FEATURE_VIDEOS[0], "16x9", "/quasaria/")).toBe("/quasaria/media/features/01-swaps-16x9.mp4");
  });
  it("renders a lazy poster grid (no video element, no autoplay) with title + runtime", () => {
    const html = renderToStaticMarkup(<FeatureVideos />);
    expect(html.match(/class="l-fv-card"/g)?.length).toBe(FEATURE_VIDEOS.length);
    expect(html).not.toContain("<video");
    expect(html).not.toMatch(/autoplay/i);
    expect(html).toContain('loading="lazy"');
    expect(html).toMatch(/<source media="\(max-width: 720px\)" srcSet="[^"]*-9x16-poster\.jpg"/i);
    for (const v of FEATURE_VIDEOS) expect(html).toContain(fmtRuntime(v.seconds));
    expect(html).toContain("Live on testnet");
    expect(html).not.toContain("In development");
    expect(html).toContain("Leverage amplifies losses");
  });
  it("sits between the sizzle reel and markets, with approved wording", () => {
    const watch = landing.indexOf('<Section id="watch"');
    const fv = landing.indexOf('<Section id="feature-videos"');
    const markets = landing.indexOf('<Section id="markets"');
    expect(fv).toBeGreaterThan(watch);
    expect(markets).toBeGreaterThan(fv);
    const text = JSON.stringify(FEATURE_VIDEOS_COPY) + JSON.stringify(FEATURE_VIDEOS) + renderToStaticMarkup(<FeatureVideos />);
    expect(text).not.toMatch(/bank/i);
    expect(text).toMatch(/Testnet/);
    expect(fmtRuntime(29)).toBe("0:29");
  });
});
