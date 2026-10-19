import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
const css = readFileSync(new URL("../src/theme/frost.css", import.meta.url), "utf8");
const main = readFileSync(new URL("../src/main.tsx", import.meta.url), "utf8");
const block = (name: string) => css.match(new RegExp(`@keyframes ${name} \\{[^]*?\\}\\s*\\}?\\n`))?.[0] ?? "";
describe("yeti background motion", () => {
  it("breathes 1.00-1.015 and uses only transform-type properties", () => {
    for (const k of ["wb-yeti-breathe", "wb-yeti-sway", "wb-yeti-shimmer"]) {
      const b = block(k);
      expect(b.length).toBeGreaterThan(0);
      expect(b).not.toMatch(/(top|left|right|bottom|width|height|margin|filter|background)\s*:/);
    }
    expect(block("wb-yeti-breathe")).toMatch(/scale: 1\.015/);
  });
  it("is static under prefers-reduced-motion and paused when the tab is hidden", () => {
    expect(css).toMatch(/prefers-reduced-motion: reduce\) \{ html\.frost \.wb-yeti, html\.frost \.wb-yeti::after \{ animation: none/);
    expect(css).toMatch(/html\.tab-hidden \.world-bg \*[^{]*\{ animation-play-state: paused/);
    expect(main).toMatch(/visibilitychange/);
  });
  it("never captures pointer events", () => {
    expect(css).toMatch(/\.wb-yeti::after \{[^}]*pointer-events: none/);
  });
});
