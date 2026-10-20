import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
describe("frost primary buttons", () => {
  it("keep dark text on hover so light-gradient CTAs stay readable", () => {
    const css = readFileSync(new URL("../src/theme/frost.css", import.meta.url), "utf8");
    expect(css).toMatch(/html\.frost \.btn:not\(\.ghost\)[^{]*:hover \{ color: #0f1a33; \}/);
  });
});
