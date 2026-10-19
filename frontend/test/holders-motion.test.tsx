import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { CountUp, ReserveGauge, Snowfield, TierProgress } from "../src/components/HoldersMotion";
import { tierProgress } from "../src/lib/motion";
import Holders from "../src/pages/Holders";
import { WalletProvider } from "../src/lib/wallet";

const css = readFileSync(new URL("../src/theme/global.css", import.meta.url), "utf8");
const block = css.slice(css.indexOf("/* ---- Holders motion"));

describe("Holders motion", () => {
  it("unknown values keep their dash/ellipsis; nothing fake is rendered or animated", () => {
    expect(renderToStaticMarkup(<CountUp value={null} format={(n) => n.toFixed(2)} />)).toContain(">–<");
    expect(renderToStaticMarkup(<CountUp value={null} format={(n) => n.toFixed(2)} placeholder="…" />)).toContain(">…<");
    expect(renderToStaticMarkup(<CountUp value={1234.5} format={(n) => n.toFixed(2)} />)).toContain('data-final="1234.50"');
    expect(tierProgress(null)).toBeNull();
    expect(renderToStaticMarkup(<TierProgress balance={null} />)).toMatch(/scaleX\(0\)[^>]*data-p=""/);
    expect(renderToStaticMarkup(<ReserveGauge fraction={null} />)).toContain('data-f=""');
  });
  it("tier progress maps real balances onto the 1M / 10M marks", () => {
    expect(tierProgress(0)).toBe(0); expect(tierProgress(500_000)).toBe(0.25); expect(tierProgress(1_000_000)).toBe(0.5);
    expect(tierProgress(5_500_000)).toBeCloseTo(0.75); expect(tierProgress(10_000_000)).toBe(1); expect(tierProgress(9e9)).toBe(1);
  });
  it("animations are transform/opacity only, pause when hidden, and are static with reduced motion", () => {
    for (const kf of block.match(/@keyframes [\w-]+ \{[^@]*?\} \}/g) ?? []) expect(kf, kf).not.toMatch(/\b(width|height|top|left|margin|padding)\s*:/);
    expect(block).toMatch(/html\[data-tab-hidden\] \.holders-anim \*[^{]*\{ animation-play-state: paused/);
    expect(block).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*animation: none !important; transition: none !important/);
    expect(readFileSync(new URL("../src/lib/motion.ts", import.meta.url), "utf8")).toMatch(/prefersReducedMotion\(\)/);
    expect(renderToStaticMarkup(<Snowfield />)).toMatch(/class="snowfield" aria-hidden="true"/);
  });
  it("the page keeps all functional sections and adds the motion pieces without new dependencies", () => {
    const h = renderToStaticMarkup(<MemoryRouter><WalletProvider><Holders /></WalletProvider></MemoryRouter>);
    for (const id of ["holders-disclosure", "my-rewards", "reserve-status", "payment-history", "tier-table", "tier-cards", "how-it-works", "tokenomics", "snowfield"]) expect(h, id).toContain(`data-testid="${id}"`);
    expect(h).toMatch(/5% a year/); expect(h).toMatch(/7% a year/);
    expect(h).not.toMatch(/class="tier-card current"/); // signed out: no tier is marked as yours
    const pkg = readFileSync(new URL("../package.json", import.meta.url), "utf8");
    expect(pkg).not.toMatch(/framer-motion|gsap|lottie|animejs|react-spring/);
  });
});
