import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parseOutline } from "../src/lib/landingCopy";

const md = readFileSync(new URL("../../docs/landing-outline.md", import.meta.url), "utf8");

describe("landing outline (approved copy)", () => {
  const s = parseOutline(md);
  it("has all 14 sections with headline, pitch and visual notes", () => {
    expect(s.map((x) => x.n)).toEqual(Array.from({ length: 14 }, (_, i) => i + 1));
    for (const x of s) {
      expect(x.headline.length).toBeGreaterThan(5);
      expect(x.pitch.length).toBeGreaterThan(20);
      expect(x.visual.length).toBeGreaterThan(10);
    }
  });
  it("keeps the approved text verbatim", () => {
    expect(s[0].headline).toBe("Trade at the speed of light.");
    expect(s[3].headline).toBe("Your keys never leave your browser.");
    expect(s[13].headline).toBe("Your first trade is a few clicks away.");
    expect(s[11].pitch).toContain("Every Quasaria contract is public on the Stellar ledger");
  });
  it("ignores text before the first numbered section", () => {
    expect(parseOutline("# Title\nHeadline: stray\n1. A\nHeadline: H\nPitch: P\nVisual: V")).toEqual([{ n: 1, title: "A", headline: "H", pitch: "P", visual: "V" }]);
  });
});
