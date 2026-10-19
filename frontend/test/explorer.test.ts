import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { EXPLORER_HOST, explorerAccountUrl, explorerAssetUrl, explorerLedgerUrl, explorerTxUrl } from "../src/lib/explorer";

const H = "8a1fe0345ca490fe42a4aac054d9d4b4d0362b8bf40727e98cb2a0a9776a1afb";
const G = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
const walk = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });

describe("explorer links (StellarChain only)", () => {
  it("builds transaction links in the verified format", () => {
    expect(explorerTxUrl(H, "mainnet")).toBe(`https://stellarchain.io/transactions/${H}`);
    expect(explorerTxUrl(H, "testnet")).toBe(`https://testnet.stellarchain.io/transactions/${H}`);
    expect(explorerTxUrl(H.toUpperCase())).toBe(`https://testnet.stellarchain.io/transactions/${H}`);
  });
  it("rejects bad hashes instead of building a broken link", () => {
    for (const bad of ["", "abc", H.slice(1), `${H}0`, "z".repeat(64)]) expect(explorerTxUrl(bad)).toBeNull();
  });
  it("account and asset links", () => {
    expect(explorerAccountUrl(G, "mainnet")).toBe(`https://stellarchain.io/accounts/${G}`);
    expect(explorerAccountUrl(G)).toBe(`https://testnet.stellarchain.io/accounts/${G}`);
    expect(explorerAccountUrl("nope")).toBeNull();
    expect(explorerAssetUrl("XLM", null, "mainnet")).toBe("https://stellarchain.io/assets/XLM");
    expect(explorerAssetUrl("USDC", G, "mainnet")).toBe(`https://stellarchain.io/assets/USDC-${G}`);
    expect(explorerAssetUrl("BAD CODE", G)).toBeNull();
  });
  it("ledger links", () => {
    expect(explorerLedgerUrl(65018555, "mainnet")).toBe("https://stellarchain.io/ledgers/65018555");
    expect(explorerLedgerUrl(0)).toBeNull();
    expect(explorerLedgerUrl(1.5)).toBeNull();
  });
  it("only the StellarChain hosts exist", () => {
    expect(Object.values(EXPLORER_HOST).every((h) => /^https:\/\/(testnet\.)?stellarchain\.io$/.test(h))).toBe(true);
  });
  it("no other explorer is linked (href) anywhere in the app source", () => {
    const files = walk(new URL("../src", import.meta.url).pathname).filter((f) => /\.(tsx?|mjs)$/.test(f));
    for (const f of files) expect(readFileSync(f, "utf8"), f).not.toMatch(/href=\{?[`"']https:\/\/(stellar\.expert|stellarscan|lumenscan|steexp)/i);
  });
});
