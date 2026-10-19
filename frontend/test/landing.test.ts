import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parseOutline } from "../src/lib/landingCopy";

const md = readFileSync(new URL("../../docs/landing-outline.md", import.meta.url), "utf8");

describe("landing outline (approved copy)", () => {
  const s = parseOutline(md);
  it("has all 12 sections with headline, pitch and visual notes", () => {
    expect(s.map((x) => x.n)).toEqual(Array.from({ length: 12 }, (_, i) => i + 1));
    for (const x of s) {
      expect(x.headline.length).toBeGreaterThan(5);
      expect(x.pitch.length).toBeGreaterThan(20);
      expect(x.visual.length).toBeGreaterThan(10);
    }
  });
  it("keeps the approved text verbatim", () => {
    expect(s[0].headline).toBe("Trade on the Stellar Decentralized Exchange.");
    expect(s[0].pitch).toBe("Quasaria is a client for the Stellar network. Send, receive, and trade assets on the Stellar network easily with Quasaria.");
    expect(s[3].headline).toBe("Your keys never leave your browser.");
    expect(s[10].headline).toBe("Your first trade is a few clicks away.");
    expect(s[11].headline).toBe("Latest from Stellar.");
    expect(s[6].headline).toBe("Hold GLACIERQ, get paid daily.");
    expect(s[8].pitch).toContain("Every Quasaria contract is public on the Stellar ledger");
  });
  it("ignores text before the first numbered section", () => {
    expect(parseOutline("# Title\nHeadline: stray\n1. A\nHeadline: H\nPitch: P\nVisual: V")).toEqual([{ n: 1, title: "A", headline: "H", pitch: "P", visual: "V" }]);
  });
  it("moves 'Your keys, your XLM' out of the hero into a strip directly beneath it, and updates title, description, OG and twitter tags", () => {
    const land = readFileSync(new URL("../src/pages/Landing.tsx", import.meta.url), "utf8");
    const heroEnd = land.indexOf("</section>", land.indexOf('className="l-hero"'));
    const hero = land.slice(land.indexOf('className="l-hero"'), heroEnd);
    expect(hero).not.toMatch(/Your keys, your XLM/);
    expect(hero).not.toContain("hero-custody-note");
    expect(land.slice(heroEnd, heroEnd + 120)).toMatch(/<KeysStrip \/>/);
    expect(land).toMatch(/<h2 id="keys-strip-h" className="l-h2">Your keys, your XLM\.<\/h2>/);
    const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
    const T = "Quasaria — Trade on the Stellar Decentralized Exchange";
    const D = "Quasaria is a client for the Stellar network. Send, receive, and trade assets on the Stellar network easily with Quasaria.";
    expect(html).toContain(`<title>${T}</title>`);
    for (const k of ['name="description"', 'property="og:description"', 'name="twitter:description"']) expect(html).toMatch(new RegExp(`${k} content="${D.replace(/[.]/g, "\\.")}`));
    for (const k of ['property="og:title"', 'name="twitter:title"']) expect(html).toContain(`${k} content="${T}"`);
    expect(html).not.toMatch(/Your keys, your XLM|speed of light/);
    expect(land).toContain(`document.title = "${T}"`);
    expect(land).not.toMatch(/speed of light/);
  });
});
