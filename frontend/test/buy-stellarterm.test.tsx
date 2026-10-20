import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { Keypair } from "@stellar/stellar-sdk";
import StellarTermBuy from "../src/components/StellarTermBuy";
import Buy from "../src/pages/Buy";
import { WalletProvider } from "../src/lib/wallet";
import { STELLARTERM_BUY_USDC_URL, STELLARTERM_BUY_XLM_URL } from "../src/lib/buyProviders";

const G = Keypair.random().publicKey();
const text = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ");
const esc = (u: string) => u.replace(/[.?/&]/g, "\\$&");

describe("Buy: StellarTerm as the primary card-purchase option", () => {
  it("links to StellarTerm's verified buy page in a new tab, with no address parameter and nothing embedded", () => {
    expect(STELLARTERM_BUY_XLM_URL).toBe("https://stellarterm.com/buy-crypto?crypto=xlm&network=stellar");
    expect(STELLARTERM_BUY_USDC_URL).toBe("https://stellarterm.com/buy-crypto?crypto=usdc&network=stellar");
    const h = renderToStaticMarkup(<StellarTermBuy address={G} onCreate={() => {}} />);
    expect(h).toMatch(new RegExp(`href="${esc(STELLARTERM_BUY_XLM_URL).replace(/&/g, "&amp;")}" target="_blank" rel="noopener noreferrer"`));
    expect(text(h)).toContain("Buy XLM on StellarTerm");
    expect(h).not.toMatch(/<iframe|pk_prod_|wallets=/);
    expect(readFileSync(new URL("../src/components/StellarTermBuy.tsx", import.meta.url), "utf8")).not.toMatch(/<iframe|coindisco|pk_(prod|test)_/i);
  });
  it("shows the full address with Copy and QR, the 3 steps, the testnet note and the disclosure", () => {
    const h = renderToStaticMarkup(<StellarTermBuy address={G} onCreate={() => {}} />);
    expect((h.match(/data-testid="st-address">([^<]*)</) || [])[1]).toBe(G);
    expect(text(h)).toContain("Copy address"); expect(readFileSync(new URL("../src/components/StellarTermBuy.tsx", import.meta.url), "utf8")).toMatch(/<QrCode value=\{address\}/); // QR renders async in the browser
    const t = text(h);
    expect(t).toMatch(/Copy your Quasaria address/); expect(t).toMatch(/Buy XLM on StellarTerm with a card/); expect(t).toMatch(/Paste your Quasaria address/);
    expect(t).toMatch(/No StellarTerm account is needed/);
    expect(t).toMatch(/real mainnet XLM/);
    expect(t).toMatch(/third-party site, not affiliated with Quasaria/); expect(t).toMatch(/handle payment and ID checks/); expect(t).toMatch(/never touches your funds or card data/);
    expect(t).toMatch(/never paste your secret key into a site you don't fully trust/);
  });
  it("signed out: asks for an address first; the page keeps exchanges, USDC helper and step-1 address", () => {
    expect(renderToStaticMarkup(<StellarTermBuy address={null} onCreate={() => {}} />)).toContain('data-testid="st-signedout"');
    const page = renderToStaticMarkup(<MemoryRouter><WalletProvider><Buy /></WalletProvider></MemoryRouter>);
    expect(page.indexOf('data-testid="buy-stellarterm"')).toBeLessThan(page.indexOf('data-testid="buy-providers"'));
    expect(text(page)).toMatch(/Or buy on an exchange/);
    expect(page).not.toMatch(/moonpay/i);
  });
});
