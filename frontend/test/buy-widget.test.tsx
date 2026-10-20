import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { Keypair } from "@stellar/stellar-sdk";
import BuyWidget from "../src/components/BuyWidget";
import Buy from "../src/pages/Buy";
import { WalletProvider } from "../src/lib/wallet";
import { COINDISCO_KEY_RE, IFRAME_ALLOW, IFRAME_SANDBOX, coindiscoKey, coindiscoUrl } from "../src/lib/coindisco";

const FAKE = "pk_test_0000000000000000"; // obviously-fake placeholder, not anyone's key
const G = Keypair.random().publicKey();
const r = (el: JSX.Element) => renderToStaticMarkup(<MemoryRouter>{el}</MemoryRouter>);
const text = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("Buy: Coindisco widget", () => {
  it("only accepts publishable pk_test_/pk_prod_ keys from config", () => {
    expect(coindiscoKey(undefined)).toBeNull(); expect(coindiscoKey("")).toBeNull();
    expect(coindiscoKey("wl_prod_abcdefgh123")).toBeNull(); // a secret White Label key is never accepted
    expect(coindiscoKey(" pk_prod_abcDEF123456 ")).toBe("pk_prod_abcDEF123456");
    expect(COINDISCO_KEY_RE.test(FAKE)).toBe(true);
    expect(readFileSync(new URL("../src/lib/coindisco.ts", import.meta.url), "utf8")).toMatch(/import\.meta\.env\.VITE_COINDISCO_PUBLIC_KEY/);
  });
  it("no repository source embeds a real Coindisco key", () => {
    for (const f of ["../src/lib/coindisco.ts", "../src/components/BuyWidget.tsx", "../src/pages/Buy.tsx", "../.env.example", "../../.github/workflows/pages.yml"])
      expect(readFileSync(new URL(f, import.meta.url), "utf8"), f).not.toMatch(/pk_prod_[A-Za-z0-9]{8,}/);
  });
  it("without a key: a prominent Coming soon badge + line, and the exchange links/address/USDC still render", () => {
    const h = r(<BuyWidget address={null} publicKey={null} network="testnet" />);
    expect(h).toContain('data-testid="soon-badge"'); expect(text(h)).toMatch(/Coming soon/);
    expect(text(h)).toContain("Card purchases through our partner widget are coming soon. Use the links below for now.");
    expect(h).not.toMatch(/<iframe/);
    // On the page itself the Coindisco panel is hidden entirely while no key is configured (StellarTerm is primary).
    const page = r(<WalletProvider><Buy /></WalletProvider>);
    expect(page).not.toContain('data-testid="buy-widget"');
    for (const id of ["buy-stellarterm", "buy-providers", "buy-coinbase", "buy-kraken", "buy-usdc", "buy-signedout"]) expect(page, id).toContain(`data-testid="${id}"`);
  });
  it("disclosure: third-party provider handles payment and ID checks; Quasaria never touches funds or card data", () => {
    const t = text(r(<BuyWidget address={null} publicKey={FAKE} network="mainnet" />));
    expect(t).toMatch(/third-party provider/); expect(t).toMatch(/payment and ID checks/); expect(t).toMatch(/never touches your funds or card data/);
  });
  it("URL defaults to XLM on Stellar (USDC option), pre-fills the address on mainnet only", () => {
    const x = new URL(coindiscoUrl({ key: FAKE, asset: "xlm", address: G, network: "mainnet" }));
    expect(x.origin).toBe("https://widget.coindisco.com");
    expect(x.searchParams.get("publicKey")).toBe(FAKE); expect(x.searchParams.get("operationMode")).toBe("buy");
    expect(x.searchParams.get("defaultAsset")).toBe("xlm"); expect(x.searchParams.get("defaultNetwork")).toBe("stellar");
    expect(x.searchParams.get("wallets")).toBe(`stellar:${G}`);
    expect(new URL(coindiscoUrl({ key: FAKE, asset: "usdc", address: G, network: "mainnet" })).searchParams.get("defaultAsset")).toBe("usdc");
    expect(new URL(coindiscoUrl({ key: FAKE, asset: "xlm", address: G, network: "testnet" })).searchParams.has("wallets")).toBe(false);
    expect(new URL(coindiscoUrl({ key: FAKE, asset: "xlm", address: "nope", network: "mainnet" })).searchParams.has("wallets")).toBe(false);
  });
  it("testnet shows the mainnet-only note; the iframe is lazy, sandboxed and least-privilege", () => {
    const h = r(<BuyWidget address={G} publicKey={FAKE} network="testnet" />);
    expect(text(h)).toMatch(/deliver real mainnet assets only/); expect(text(h)).toMatch(/not pre-filled/);
    expect(h).toContain('data-testid="buy-asset-xlm"'); expect(h).toContain('data-testid="buy-asset-usdc"');
    expect(h).not.toMatch(/<iframe/); // not loaded until the panel scrolls into view
    expect(IFRAME_SANDBOX).not.toMatch(/allow-top-navigation(?!-by-user-activation)|allow-modals|allow-downloads/);
    expect(IFRAME_ALLOW).not.toMatch(/microphone|geolocation|usb|accelerometer|gyroscope/);
    const src = readFileSync(new URL("../src/components/BuyWidget.tsx", import.meta.url), "utf8");
    expect(src).toMatch(/sandbox=\{IFRAME_SANDBOX\}/); expect(src).toMatch(/loading="lazy"/); expect(src).toMatch(/IntersectionObserver/);
  });
});
