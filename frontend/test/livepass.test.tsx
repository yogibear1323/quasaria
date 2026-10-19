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

import { usdUnit, tvlUsd, type PoolRow } from "../src/lib/nativePools";
import { TESTNET_USDC_ISSUER } from "../src/lib/config";
describe("testnet never shows dollar values", () => {
  it("usdUnit is null on testnet even for XLM and the USDC stand-in; mainnet XLM still prices", () => {
    expect(usdUnit("testnet", { code: "XLM", issuer: null }, { xlmUsd: 0.18 })).toBeNull();
    expect(usdUnit("testnet", { code: "USDC", issuer: TESTNET_USDC_ISSUER }, { xlmUsd: 0.18 })).toBeNull();
    expect(usdUnit("mainnet", { code: "XLM", issuer: null }, { xlmUsd: 0.18 })).toBe(0.18);
    const p = { net: "testnet", a: { code: "XLM", issuer: null }, b: { code: "USDC", issuer: TESTNET_USDC_ISSUER }, reserveA: 1e6, reserveB: 1e6 } as unknown as PoolRow;
    expect(tvlUsd(p, { xlmUsd: 0.18 })).toBeNull();
  });
});
