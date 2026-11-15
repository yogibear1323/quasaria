import { describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { WalletProvider } from "../src/lib/wallet";
import Landing from "../src/pages/Landing";
import Pools from "../src/pages/Pools";
import Calculators from "../src/pages/Calculators";

vi.mock("../src/lib/config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/config")>();
  return { ...actual, NETWORK: "mainnet" as const, IS_MAINNET: true };
});

const ADDED = [
  "XLM / USTRY",
  "XLM / CETES",
  "XLM / TESOURO",
  "USDC / USTRY",
  "USDC / CETES",
  "XLM / EURC (Mykobo)",
  "EURC (Mykobo) / USDC",
];

function render(node: ReactNode) {
  return renderToStaticMarkup(<MemoryRouter><WalletProvider>{node}</WalletProvider></MemoryRouter>);
}

function pairOptions(html: string): string[] {
  const select = html.match(/<select[^>]*data-testid="lp-pair"[^>]*>([\s\S]*?)<\/select>/);
  expect(select, "liquidity calculator drop-down").toBeTruthy();
  return [...select![1].matchAll(/<option[^>]*>([^<]*)<\/option>/g)].map((m) => m[1]);
}

describe("liquidity calculator drop-down on each placement", () => {
  it("lists the treasury and Mykobo pools on the full /calculators page", () => {
    const html = render(<Calculators />);
    expect(html).toContain('data-testid="lp-pool-id"');
    const options = pairOptions(html);
    for (const label of ADDED) expect(options).toContain(label);
    expect(options).toContain("XLM / EURC");
    expect(options).toContain("EURC / USDC");
    expect(options.filter((o) => o.includes("EURC (Mykobo)"))).toHaveLength(2);
    expect(options).not.toContain("USDC / TESOURO");
    expect(options).not.toContain("TESOURO / USDC");
    expect(options.some((o) => o.includes("BENJI") || o.includes("USDY"))).toBe(false);
  });

  it("lists the same pools on the compact Landing calculator", () => {
    const html = render(<Landing />);
    expect(html).toContain('data-testid="lp-pair"');
    expect(html).not.toContain('data-testid="lp-pool-id"');
    const options = pairOptions(html);
    for (const label of ADDED) expect(options).toContain(label);
  });

  it("lists the same pools on the compact Pools calculator and leaves Verified pairs in place", () => {
    const html = render(<Pools />);
    expect(html).toContain("Verified pairs");
    expect(html).toContain('data-testid="pool-table"');
    expect(html).not.toContain('data-testid="lp-pool-id"');
    const options = pairOptions(html);
    for (const label of ADDED) expect(options).toContain(label);
  });
});
