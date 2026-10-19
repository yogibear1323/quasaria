import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { Holdings, Rewards } from "../src/pages/Account";
import { parseAccount } from "../src/lib/account";
import { TESTNET_USDC_ISSUER } from "../src/lib/config";
import { NAV_KEY } from "../src/lib/nav";

const src = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const R = (el: React.ReactElement) => renderToStaticMarkup(<MemoryRouter>{el}</MemoryRouter>);
const view = parseAccount({ subentry_count: 3, balances: [
  { asset_type: "native", balance: "250.5", selling_liabilities: "0" },
  { asset_type: "credit_alphanum4", asset_code: "USDC", asset_issuer: TESTNET_USDC_ISSUER, balance: "12.5" },
  { asset_type: "credit_alphanum4", asset_code: "USDC", asset_issuer: "G" + "C".repeat(55), balance: "3" },
] }, "testnet", 0.5);

describe("Account page", () => {
  it("shows XLM with reserve and available, verified trustline labels, and the issuer for unknown assets", () => {
    const h = R(<Holdings view={view} loading={false} />);
    expect(h).toContain('data-testid="xlm-reserve"'); expect(h).toContain(">2.5<"); expect(h).toContain(">248<"); // (2+3)×0.5 reserve, 250.5−2.5 available
    expect(h).toContain("USDC · Circle testnet issuer (verified, no value)");
    expect(h).toContain("Unverified issuer");
    expect(h).toContain(`https://testnet.stellarchain.io/assets/USDC-${"G" + "C".repeat(55)}`);
    expect((h.match(/data-testid="row-trustline"/g) ?? []).length).toBe(2);
  });
  it("uses dashes, not invented numbers, when there is no data", () => {
    const h = R(<Holdings view={null} loading={false} />);
    expect(h).toContain("—"); expect(h).not.toContain("data-testid=\"row-trustline\"");
    expect(R(<Holdings view={{ exists: false }} loading={false} />)).toContain("Nothing to show until the account is on the network");
    expect(R(<Rewards view={null} />)).toContain("—");
  });
  it("GLACIERQ tier status on the page", () => {
    const h = R(<Rewards view={view} />);
    expect(h).toContain("Below 1M"); expect(h).toContain("Not guaranteed"); expect(h).not.toMatch(/APY/i);
  });
  it("is wired and never touches the secret", () => {
    expect(NAV_KEY.map((n) => n.to)).toEqual(["/account", "/wallet"]);
    expect(src("../src/App.tsx")).toContain('path="/account"');
    expect(src("../vite.config.ts")).toMatch(/SPA_ROUTES = \[[^\]]*"account"/);
    const p = src("../src/pages/Account.tsx");
    expect(p).not.toMatch(/\.secret\b|getSecret|console\./);
    expect(p).toContain("Copy address"); expect(p).toContain("Forget this key"); expect(p).toContain('to="/buy"'); expect(p).toContain("explorerAccountUrl");
    expect(src("../src/components/CopyButton.tsx")).toContain("Copied");
  });
  it("labels the network", () => { expect(src("../src/pages/Account.tsx")).toContain('NET_LABEL = "Testnet"'); });
});
