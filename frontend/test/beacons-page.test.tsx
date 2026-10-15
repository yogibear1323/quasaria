import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { WalletProvider } from "../src/lib/wallet";
import Beacons from "../src/pages/Beacons";

describe("Beacons preview page", () => {
  const html = renderToStaticMarkup(<WalletProvider><MemoryRouter><Beacons /></MemoryRouter></WalletProvider>);
  it("is labelled testnet / unaudited and lists the live testnet contracts", () => {
    expect(html).toContain("Testnet · unaudited");
    expect(html).toContain("Live on testnet");
    expect(html).not.toContain("mainnet contract");
    expect(html).toContain("not a guaranteed return");
  });
  it("shows all six tiers, default simulator result and no fake balance", () => {
    for (const t of ["Spark", "Flare", "Beacon", "Pulsar", "Quasar", "Singularity"]) expect(html).toContain(t);
    expect(html).toContain("4.58%");
    expect(html).toContain("Connect a wallet to see your QFX balance");
    expect(html.toLowerCase()).not.toContain("bank");
  });
});
