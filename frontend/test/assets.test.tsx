import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { StrKey } from "@stellar/stellar-sdk";
import mainnet from "../../config/assets.mainnet.json";
import testnet from "../src/config/testnet-assets.json";
import { ASSET_LIST, POOL_LIST, RETIRED_POOLS, assetById, badgeOf, filterAssets, findPool, findRoute, groupAssets, ilRisk, mainnetUrl, poolsWith, testnetKey, assetByTestnetKey } from "../src/lib/assets";
import { AssetSelectList } from "../src/components/AssetSelect";

type M = (typeof mainnet.assets)[number];
const M_ASSETS = mainnet.assets as M[];
const verified = M_ASSETS.filter((a) => a.verified);

describe("config/assets.mainnet.json (mainnet reference list)", () => {
  it("every row has a valid issuer and code; verified rows name their proof", () => {
    for (const a of M_ASSETS) {
      expect(StrKey.isValidEd25519PublicKey(a.issuer), a.code).toBe(true);
      expect(a.code).toMatch(/^[A-Za-z0-9]{1,12}$/);
      expect(["stablecoin", "popular"]).toContain(a.category);
    }
    for (const a of verified) {
      expect(a.verifiedVia, a.code).toMatch(/^https:\/\//);
      expect(["toml-verified", "toml-verified(domain)", "issuer-doc-verified"]).toContain(a.verification);
    }
  });
  it("pins the well-known issuers (not look-alikes)", () => {
    const iss = (code: string) => verified.find((a) => a.code === code)?.issuer;
    expect(iss("USDC")).toBe("GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN");
    expect(iss("EURC")).toBe("GDHU6WRG4IEQXM5NZ4BMPKOXHW76MZM4Y2IEMFDVXBSDP6SJY4ITNPP2");
    expect(iss("EURCV")).toBe("GCEYGIVOLAVBF2TG2RUSGTUJCIN75KEX3NGLMY4VPL4GFE5L355AXW3G"); // SG-FORGE white paper, NOT the most-held GAUQKYP3… impostor
    expect(iss("SHX")).toBe("GDSTRSHXHGJ7ZIVRBXEYE5Q74XUVCUSEKEBR7UCHEUUEK72N7I7KJ6JH");
    expect(iss("AQUA")).toBe("GBNZILSTVQZ4R7IKQDGHYGY2QXL5QOFJYQMXPKWRRM5PAV7Y4M67AQUA");
    expect(verified.find((a) => a.code === "SHX")?.homeDomain).toBe("stronghold.co");
  });
  it("covers the requested stablecoins and popular assets", () => {
    const codes = new Set(verified.map((a) => a.code));
    for (const c of ["USDC", "EURC", "PYUSD", "USDGLO", "EURCV", "BRL", "ARST", "NGNC"]) expect(codes.has(c), c).toBe(true);
    for (const c of ["SHX", "AQUA", "yXLM", "yUSDC", "BTC", "ETH", "VELO"]) expect(codes.has(c), c).toBe(true);
    expect(verified.filter((a) => a.category === "stablecoin").every((a) => a.peg)).toBe(true);
    expect(verified.every((a) => (a.pricePerXlm ?? 0) > 0)).toBe(true);
  });
});

describe("src/config/testnet-assets.json (testnet list + v3 pools)", () => {
  it("is testnet-only and every listed mainnet asset matches the verified reference", () => {
    expect(testnet.network).toBe("testnet");
    expect(testnet.generation).toBe("v3");
    for (const a of ASSET_LIST.filter((x) => x.mainnet)) {
      const ref = verified.find((m) => m.code === a.mainnet!.code);
      expect(ref, a.id).toBeTruthy();
      expect(a.mainnet!.issuer).toBe(ref!.issuer);
    }
    const unverified = M_ASSETS.filter((a) => !a.verified).map((a) => a.code);
    expect(ASSET_LIST.filter((a) => unverified.includes(a.id) && a.mainnet?.issuer === M_ASSETS.find((m) => m.code === a.id && !m.verified)?.issuer)).toEqual([]);
  });
  it("labels mirrors and uses only legitimate real testnet issuers", () => {
    const mirrors = Object.values(testnet.mirrorIssuers).map((m) => m.address);
    for (const a of ASSET_LIST) {
      if (a.testnet.kind === "mirror") {
        expect(a.testnet.code).toBe(`mk${a.code}`.slice(0, 12));
        expect(mirrors).toContain(a.testnet.issuer);
        expect(a.testnet.label).toMatch(/Testnet mirror of/);
        expect(badgeOf(a).text).toBe(`testnet mirror of ${a.code}`);
        expect(mainnetUrl(a)).toMatch(/^https:\/\/stellar\.expert\/explorer\/public\/asset\//);
      }
      if (a.testnet.kind === "real") expect({ USDC: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5", EURC: "GB3Q6QDZYTHWT7E5PVS3W7FUT5GVAFC5KSZFFLPU25GO7VTC3NM2ZTVO" }[a.id]).toBe(a.testnet.issuer);
      expect(a.testnet.sac).toMatch(/^C[A-Z2-7]{55}$/);
    }
    for (const m of Object.values(testnet.mirrorIssuers)) expect(m.homeDomain).toMatch(/\.quasaria\.invalid$/);
  });
  it("deploys the priority pools and keeps retired v2 pools out of the live list", () => {
    const pairs = new Set(POOL_LIST.map((p) => p.pair));
    for (const s of ASSET_LIST.filter((a) => a.category === "stablecoin")) expect(pairs.has(`${s.id}/XLM`), s.id).toBe(true);
    for (const p of ["EURC/USDC", "SHX/XLM", "AQUA/XLM", "yXLM/XLM"]) expect(pairs.has(p), p).toBe(true);
    for (const p of POOL_LIST) {
      expect(p.pool).toMatch(/^C[A-Z2-7]{55}$/);
      expect(p.seeded!.a).toBeGreaterThan(0);
      expect(p.seeded!.b).toBeGreaterThan(0);
      expect(p.tokenA).toBe(assetById(p.assetA)!.testnet.sac);
      expect(p.tokenB).toBe(assetById(p.assetB)!.testnet.sac);
    }
    expect(RETIRED_POOLS.length).toBeGreaterThanOrEqual(21);
    const live = new Set(POOL_LIST.map((p) => p.pool));
    expect(RETIRED_POOLS.filter((r) => live.has(r.pool))).toEqual([]);
  });
});

describe("lib/assets helpers", () => {
  it("search ranks code matches first and filters by category", () => {
    expect(filterAssets(ASSET_LIST, "shx")[0].id).toBe("SHX");
    expect(filterAssets(ASSET_LIST, "stronghold").map((a) => a.id)).toContain("SHX");
    expect(filterAssets(ASSET_LIST, "EUR").map((a) => a.id)).toEqual(expect.arrayContaining(["EURC", "EURCV"]));
    const pop = filterAssets(ASSET_LIST, "", "popular");
    expect(pop.length).toBeGreaterThan(5);
    expect(pop.every((a) => a.category === "popular")).toBe(true);
    expect(filterAssets(ASSET_LIST, "", "stablecoin").some((a) => a.id === "USDC")).toBe(true);
    expect(filterAssets(ASSET_LIST, "zzzz-nothing")).toEqual([]);
    expect(groupAssets(ASSET_LIST).map((g) => g.label)).toEqual(["Base", "Stablecoins", "Popular assets"]);
  });
  it("finds pools in either order and routes through hubs", () => {
    expect(findPool("XLM", "USDC")?.pair).toBe("USDC/XLM");
    expect(findPool("USDC", "EURC")?.pair).toBe("EURC/USDC");
    expect(poolsWith("SHX").map((p) => p.pair)).toContain("SHX/XLM");
    expect(findRoute("XLM", "SHX")?.pools).toHaveLength(1);
    const r = findRoute("SHX", "AQUA")!;
    expect(r.via).toEqual(["XLM"]);
    expect(r.pools).toEqual([findPool("SHX", "XLM")!.pool, findPool("XLM", "AQUA")!.pool]);
    expect(findRoute("XLM", "XLM")).toBeNull();
  });
  it("testnet keys round-trip for the Trade pickers", () => {
    const usdc = assetById("USDC")!;
    expect(testnetKey(usdc)).toBe("USDC-GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5");
    expect(assetByTestnetKey(testnetKey(assetById("SHX")!))?.id).toBe("SHX");
    expect(testnetKey(assetById("XLM")!)).toBe("XLM");
  });
  it("flags stable-vs-volatile pairs as higher impermanent-loss risk", () => {
    expect(ilRisk(assetById("USDC"), assetById("XLM"))).toBe("high");
    expect(ilRisk(assetById("SHX"), assetById("XLM"))).toBe("high");
    expect(ilRisk(assetById("EURC"), assetById("USDC"))).toBe("high"); // cross-currency
    expect(ilRisk(assetById("PYUSD"), assetById("USDC"))).toBe("low");
  });
});

describe("AssetSelectList (picker)", () => {
  const html = (props: Partial<Parameters<typeof AssetSelectList>[0]> = {}) => renderToStaticMarkup(<AssetSelectList query="" category="all" onPick={() => void 0} {...props} />);
  it("groups into Stablecoins and Popular assets with real/mirror badges", () => {
    const h = html();
    expect(h).toContain("Stablecoins");
    expect(h).toContain("Popular assets");
    expect(h).toContain("testnet mirror of SHX");
    expect(h).toContain("REAL testnet");
    expect((h.match(/role="option"/g) ?? []).length).toBe(ASSET_LIST.length);
  });
  it("filters by category and search, and excludes the other side", () => {
    const pop = html({ category: "popular" });
    expect(pop).toContain('data-asset="AQUA"');
    expect(pop).not.toContain('data-asset="PYUSD"');
    const q = html({ query: "aqua" });
    expect(q).toContain('data-asset="AQUA"');
    expect(q).not.toContain('data-asset="SHX"');
    expect(html({ exclude: "USDC" })).not.toContain('data-asset="USDC"');
    expect(html({ query: "nope-nothing" })).toContain("No asset matches");
  });
  it("marks the selected option", () => {
    expect(html({ value: "SHX" })).toMatch(/aria-selected="true"[^>]*data-asset="SHX"/);
  });
});
