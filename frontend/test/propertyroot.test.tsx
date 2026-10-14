import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { WalletProvider } from "../src/lib/wallet";
import PropertyRoot from "../src/pages/PropertyRoot";
import { DEMO_CAP_USD, PR, estimateYield, simulateAppraisal, workingCap } from "../src/lib/propertyRoot";
import { DISTRICTS } from "../src/lib/world";
import { readFileSync } from "node:fs";

describe("PropertyRoot logic", () => {
  it("simulated appraisal is deterministic, within ±8% of $/unit × size, and capped", () => {
    const a = simulateAppraisal({ address: "123 Mesa Verde Rd", type: "single-family", size: 2000 });
    expect(a).toEqual(simulateAppraisal({ address: "123 mesa verde rd ", type: "single-family", size: 2000 }));
    expect(a.value).toBeGreaterThanOrEqual(285 * 2000 * 0.92 - 100);
    expect(a.value).toBeLessThanOrEqual(285 * 2000 * 1.08 + 100);
    expect(a.titleVerified).toBe(true);
    expect(simulateAppraisal({ address: "x", type: "farmland", size: 10_000 }).value).toBe(DEMO_CAP_USD);
    expect(simulateAppraisal({ address: "", type: "condo", size: 900 }).titleVerified).toBe(false);
  });
  it("working value uses the deployed LTV", () => { expect(workingCap(300_000)).toBe(300_000 * PR.params.ltvBps / 10_000); });
  it("yield estimate compounds monthly and beats simple interest", () => {
    const r = estimateYield({ value: 400_000, ltvPct: 50, workPct: 50, aprPct: 6, years: 1 });
    expect(r.working).toBe(100_000);
    expect(r.earned).toBeCloseTo(100_000 * (Math.pow(1.005, 12) - 1), 4);
    expect(r.compoundBonus).toBeGreaterThan(0);
    expect(estimateYield({ value: 1, ltvPct: 50, workPct: 50, aprPct: 0, years: 3 }).earned).toBe(0);
  });
  it("deployment is testnet and points at Blend + Reflector", () => {
    expect(PR.network).toBe("testnet");
    for (const id of [PR.contracts.attestationRegistry, PR.contracts.propertyVault, PR.contracts.blendAdapter, PR.external.blendPool, PR.external.reflector]) expect(id).toMatch(/^C[A-Z2-7]{55}$/);
  });
  it("is a district on the world globe", () => { expect(DISTRICTS.find((d) => d.to === "/propertyroot")?.label).toBe("PropertyRoot"); });
});

describe("PropertyRoot page", () => {
  const html = renderToStaticMarkup(<WalletProvider><MemoryRouter><PropertyRoot /></MemoryRouter></WalletProvider>);
  it("has disclaimers: testnet, not legal title, simulated, lending yield", () => {
    expect(html).toContain("not legal title");
    expect(html).toContain("Simulated");
    expect(html).toContain("This is lending yield");
    expect(html).toContain("Estimate only");
  });
  it("has the 3 steps, risks, waitlist and Freighter connect", () => {
    for (const t of ["Appraise &amp; verify", "Tokenize", "Earn compounded lending yield", "Legal", "Appraisal", "Oracle", "Liquidation", "Join the waitlist", "Connect"]) expect(html).toContain(t);
    expect(html).toContain("Nothing is sent anywhere");
  });
  it("uses the earthy theme without purple/neon", () => {
    const css = readFileSync("src/theme/propertyroot.css", "utf8").toLowerCase();
    for (const bad of ["#8b5cf6", "#6d28d9", "#d946ef", "#22d3ee", "#06b6d4", "violet", "magenta", "--grad-button"]) expect(css).not.toContain(bad);
    expect(css).toContain("#b8603a");
  });
});

import { bytes32 } from "../src/lib/propertyRoot";
describe("PropertyRoot encoding", () => {
  it("encodes a sha256 hex as 32 raw bytes", () => {
    const v = bytes32("ab".repeat(32));
    // ScVal type 13 (bytes), length 32, then the raw bytes
    expect(v.toXDR("base64")).toBe("AAAADQAAACCrq6urq6urq6urq6urq6urq6urq6urq6urq6urq6urqw==");
  });
});
