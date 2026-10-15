import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { WalletProvider } from "../src/lib/wallet";
import BeaconsStake, { explain } from "../src/components/BeaconsStake";

describe("Beacons testnet staking", () => {
  it("asks for a wallet and keeps the testnet label", () => {
    const html = renderToStaticMarkup(<WalletProvider><MemoryRouter><BeaconsStake /></MemoryRouter></WalletProvider>);
    expect(html).toContain("Stake on testnet");
    expect(html).toContain("Testnet · unaudited");
    expect(html).toContain("Connect a testnet wallet to stake");
  });
  it("explains contract errors in plain words", () => {
    expect(explain("simulation failed: stake (HostError: Error(Contract, #7))")).toMatch(/Peg monitor has paused new stakes/);
    expect(explain("Error(Contract, #3)")).toMatch(/Add to stake/);
    expect(explain("Error(Contract, #5)")).toMatch(/Still locked/);
    expect(explain("something else")).toBe("something else");
  });
});
