import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import Calculators from "../src/pages/Calculators";
import { DISTRICTS } from "../src/lib/world";

const STALE = /beacons?\b|\bperps?\b|perpetual|trading bots?|freighter|\bQFX\b|\bQLP\b|stellar\.?expert\.io|soroban testnet/i;
const text = renderToStaticMarkup(<MemoryRouter><Calculators /></MemoryRouter>).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("final live-site pass", () => {
  it("the calculator is native-pool and manual: no Soroban, QFX or QLP wording, fixed 0.30% fee", () => {
    expect(text).toMatch(/Pool fees & impermanent loss|Pool fees &amp; impermanent loss/);
    expect(text).not.toMatch(STALE);
    expect(text).toMatch(/0\.30%/);
  });
  it("home map blurbs no longer say 'coming soon' for pages that exist", () => {
    for (const d of DISTRICTS) expect(d.blurb, d.id).not.toMatch(/coming soon/i);
  });
  it("landing, merch and calculator sources hold no removed-feature words and no /trade link", () => {
    for (const f of ["src/pages/Landing.tsx", "src/pages/Merch.tsx", "src/pages/Calculators.tsx", "src/components/calc/LpCalculator.tsx", "src/lib/world.ts"]) {
      const s = readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
      expect(s, f).not.toMatch(STALE);
      expect(s, f).not.toMatch(/to="\/trade"/);
    }
  });
});
