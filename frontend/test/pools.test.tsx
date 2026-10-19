import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import Pools from "../src/pages/Pools";
import { WalletProvider } from "../src/lib/wallet";

const src = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

describe("Pools page", () => {
  it("renders the native pools browser with both tabs and the search box", () => {
    const h = renderToStaticMarkup(<MemoryRouter><WalletProvider><Pools /></WalletProvider></MemoryRouter>);
    expect(h).toContain("Liquidity pools");
    expect(h).toContain("Verified pairs"); expect(h).toContain("Any asset");
    expect(h).toContain('data-testid="pool-search"');
    expect(h).toContain("not a Quasaria contract");
    expect(h).not.toMatch(/\bAPY\b/);
  });
  it("signs with the keypair, bounds deposits/withdrawals by a slippage limit, and has no Soroban deps", () => {
    const s = src("../src/pages/Pools.tsx");
    expect(s).toContain("submitSignedXdr"); expect(s).toContain("slippageBps");
    expect(s).not.toMatch(/soroban|chain"|calcData|demo/i);
    expect(s).toMatch(/unverified/); // look-alike / unverified flags
  });
  it("tx result links go through the shared StellarChain helper (TxStatus)", () => {
    expect(src("../src/pages/Pools.tsx")).toContain("TxStatus");
    expect(src("../src/pages/Pools.tsx")).not.toMatch(/stellar\.expert|stellarchain\.io/);
  });
});
