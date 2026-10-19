import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import About, { ABOUT_TAGLINE } from "../src/pages/About";
import { networkStatus } from "../src/lib/networkStatus";
import { DISTRICTS } from "../src/lib/world";

const html = renderToStaticMarkup(<MemoryRouter><About /></MemoryRouter>);
const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("About page", () => {
  it("opens with the anchor line", () => {
    expect(ABOUT_TAGLINE).toBe("Quasaria is a self-banking decentralized exchange on Stellar where you trade, earn, and stay in full control of your keys.");
    expect(text).toContain(ABOUT_TAGLINE);
  });
  it("covers the six sections", () => {
    for (const id of ["keys", "swaps", "pools", "rewards", "referral", "yeti"]) expect(html).toContain(`data-testid="about-${id}"`);
    expect(text).toMatch(/Your keys, your XLM/);
    expect(text).toMatch(/Nobody, including us, can recover or reset it/);
    expect(text).toMatch(/Swap fees go to the pool providers/);
  });
  it("uses only the confirmed reward numbers and makes no promises", () => {
    expect(text).toMatch(/5% a year/);
    expect(text).toMatch(/7% a year/);
    expect(text).toMatch(/100B/);
    expect(text).toMatch(/50B sit in a reward reserve/);
    expect(text).toMatch(/10,000,000/);
    expect(text).toMatch(/10%.*of their daily reward on top for a year/);
    expect(text).toMatch(/6 months/);
    expect(text).toMatch(/goes live after the first mainnet holder-reward run/i);
    expect(text).toMatch(/not guaranteed/);
    expect(text).not.toMatch(/\bAPY\b|guaranteed (return|yield|income)|risk-free/i);
  });
  it("does not mention products that are not on the site", () => {
    expect(text).not.toMatch(/beacon|perp|trading bot|vault|lending|staking|QFX|leverage|soroban|freighter/i);
  });
  it("shows the network status line from the config (testnet until mainnet is on)", () => {
    expect(text).toMatch(/Currently running on testnet/);
    expect(networkStatus({ mainnetSigning: false }).net).toBe("testnet");
    expect(networkStatus({ mainnetSigning: true })).toMatchObject({ net: "mainnet" });
    expect(networkStatus({ mainnetSigning: true }).line).toMatch(/running on mainnet/);
    expect(networkStatus({ mainnetSigning: false, mainnetBrowse: true }).line).toMatch(/read-only/);
  });
  it("is reachable from the world map / mobile menu", () => {
    expect(DISTRICTS.find((d) => d.to === "/about")?.label).toBe("About");
  });
});
