import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { CopyButton } from "../src/components/CopyButton";
import { TxLink } from "../src/components/TxLink";
import { NAV_KEY, NAV_MORE } from "../src/lib/nav";

const src = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

describe("wallet pieces", () => {
  it("Copy button renders and announces via a live region", () => {
    const h = renderToStaticMarkup(<CopyButton value="GABC" label="Copy address" />);
    expect(h).toContain("Copy address"); expect(h).toContain('aria-live="polite"');
    expect(src("../src/components/CopyButton.tsx")).toContain("Copied ✓");
  });
  it("tx links go to StellarChain only, new tab, noopener (testnet subdomain)", () => {
    const h = renderToStaticMarkup(<TxLink hash={"a".repeat(64)} net="testnet" />);
    expect(h).toContain(`href="https://testnet.stellarchain.io/transactions/${"a".repeat(64)}"`);
    expect(h).toContain('target="_blank"'); expect(h).toContain('rel="noopener noreferrer"');
    expect(renderToStaticMarkup(<TxLink hash={"b".repeat(64)} net="mainnet" />)).toContain(`href="https://stellarchain.io/transactions/${"b".repeat(64)}"`);
  });
  it("is wired: route, SPA fallback, key-only menu entries, keys strip link", () => {
    expect(src("../src/App.tsx")).toContain('path="/wallet"');
    expect(src("../vite.config.ts")).toMatch(/SPA_ROUTES = \[[^\]]*"wallet"/);
    expect(NAV_KEY.map((n) => n.to)).toContain("/wallet");
    expect(NAV_MORE.map((n) => n.to)).not.toContain("/wallet");
    const l = src("../src/components/Layout.tsx");
    expect(l).toContain("signedIn && NAV_KEY"); expect(l).toContain("acct-menu-link");
    expect(src("../src/pages/Landing.tsx")).toContain('to="/wallet"');
  });
  it("never reads or prints a secret", () => {
    const p = src("../src/pages/Wallet.tsx");
    expect(p).not.toMatch(/\.secret\b|getSecret|console\./);
    expect(p).toContain("w.sign(");
  });
});
