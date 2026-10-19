import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import Buy from "../src/pages/Buy";
import { WalletProvider } from "../src/lib/wallet";
import { BUY_PROVIDERS } from "../src/lib/buyProviders";

const src = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const html = renderToStaticMarkup(<MemoryRouter><WalletProvider><Buy /></WalletProvider></MemoryRouter>);

describe("Buy page", () => {
  it("lists exactly the two verified exchange pages (Coinbase, Kraken; no MoonPay) as plain new-tab links", () => {
    expect(BUY_PROVIDERS.map((p) => p.url)).toEqual(["https://www.coinbase.com/price/stellar", "https://www.kraken.com/buy/xlm"]);
    expect(src("../src/pages/Buy.tsx") + src("../src/lib/buyProviders.ts") + src("../src/lib/coindisco.ts") + src("../src/components/BuyWidget.tsx")).not.toMatch(/moonpay/i);
    for (const p of BUY_PROVIDERS) expect(html).toMatch(new RegExp(`href="${p.url.replace(/[./]/g, "\\$&")}" target="_blank" rel="noopener noreferrer"`));
  });
  it("carries the neutral third-party note and the network heads-up", () => {
    expect(html).toContain("third-party sites, not affiliated with Quasaria");
    expect(html).toContain("fees, limits, availability in your country and ID checks");
    expect(html).toContain('data-testid="buy-network-note"');
  });
  it("shows the verified USDC issuers", () => {
    expect(html).toContain("GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN");
    expect(html).toContain("GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5");
  });
  it("has no affiliate/referral params, rewards wording or backend calls; the only embed is the Coindisco widget", () => {
    const all = src("../src/pages/Buy.tsx") + src("../src/lib/buyProviders.ts") + src("../src/lib/coindisco.ts") + src("../src/components/BuyWidget.tsx");
    expect(all).not.toMatch(/<script|fetch\(|affiliate(?!d)|referral|[?&]ref=|utm_|GLACIERQ|\bAPY\b|wl_(test|prod)_|signature/i);
    expect(src("../src/pages/Buy.tsx")).not.toMatch(/iframe/);
    expect(html).not.toMatch(/GLACIERQ|referral/i);
  });
});
