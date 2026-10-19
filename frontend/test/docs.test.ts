import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { reserveYearsAtCap } from "../src/lib/rewards";

const doc = (n: string) => readFileSync(new URL(`../../docs/${n}`, import.meta.url), "utf8");

describe("go-live docs", () => {
  it("mainnet switch checklist covers the gates", () => {
    const d = doc("mainnet-switch-checklist.md");
    for (const k of ["MAINNET_SIGNING", "QUASARIA_MAINNET_GO", "PAUSE", "REFERRAL_LIVE", "VITE_REWARD_ISSUER_MAINNET", "market-order confirm", "stellarchain.io/transactions", "Rollback"]) expect(d, k).toContain(k);
  });
  it("legal note names the Buy page and each merch 'Stellar' slogan", () => {
    const d = doc("legal-review.md");
    for (const k of ["Buy page", "Self-Banking on Stellar", "Level Up on Stellar", "Born on Stellar", "Stellar Development Foundation", "Coinbase, Kraken and MoonPay"]) expect(d, k).toContain(k);
  });
  it("market-order doc keeps the revisit-before-mainnet note and its history", () => {
    const d = doc("market-orders.md");
    expect(d).toContain("Before mainnet signing is enabled"); expect(d).toContain("must not return without a fresh decision");
  });
  it("tokenomics doc matches the code and uses no APY wording", () => {
    const d = doc("tokenomics.md");
    expect(d).toContain("100,000,000,000"); expect(d).toContain("5% a year"); expect(d).toContain("7% a year"); expect(d).not.toMatch(/\bAPY\b/);
    expect(d).toContain(`about ${reserveYearsAtCap().toFixed(1)} years`);
  });
  it("audit options doc is present", () => { expect(doc("audit-options.md")).toContain("Audit Bank"); });
});
