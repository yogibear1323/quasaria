import { describe, expect, it, vi } from "vitest";
import { DEFAULT_CONFIG, discoverStablecoins, fetchFeed, parseTomlCurrencies, pegOf, screen, verifyIssuer, memoryCache, type FeedAsset, type FetchLike } from "../../shared/stablecoins";

const G = (tag: string) => `G${tag.toUpperCase().replace(/[^A-Z2-7]/g, "A").padEnd(55, "A").slice(0, 55)}`;
const asset = (code: string, tag: string, domain: string | null, holders: number, trades: number, toml: FeedAsset["tomlInfo"] = {}): FeedAsset => ({
  assetKey: `${code}-${G(tag)}`, code, issuer: G(tag), trustlinesTotal: holders, trades24h: trades, homeDomain: domain, updatedAt: "2026-09-11T02:50:01+00:00",
  tomlInfo: toml === null ? null : { home_domain: domain ?? undefined, ...toml },
});
const fiat = (peg: string, anchored: boolean | undefined = true) => ({ anchor_asset_type: "fiat", anchor_asset: peg, is_asset_anchored: anchored });

// Fixtures modelled on the real 2026-09-11 stellarchain snapshot (issuers are synthetic).
const F = {
  usdc: asset("USDC", "circle", "circle.com", 2_394_128, 33_118, fiat("USD")),
  eurcCircle: asset("EURC", "circleeur", "circle.com", 35_483, 3_058, fiat("EUR")),
  eurcMykobo: asset("EURC", "mykobo", "mykobo.co", 12_807, 158, fiat("EUR")),
  arst: asset("ARST", "latamex", "pubnet-sep.latamex.com", 328_633, 148, fiat("ARS", undefined)),
  pyusd: asset("PYUSD", "paxos", "token-metadata.paxos.com", 9_847, 694, {}),
  usdt0: asset("USDT0", "usdtzero", "usdt0.to", 13_345, 201, { anchor_asset_type: "crypto", anchor_asset: "USDT", is_asset_anchored: true }),
  idrt: asset("IDRT", "kbtrading", "kbtrading.org", 8_837, 58, fiat("IDRT")),
  // impostors / junk
  pyusdQfs: asset("PYUSD", "qfs", "pyusd-qfs.com", 265, 6, { anchor_asset_type: "crypto" }),
  usdt0Fake: asset("USDT0", "fakezero", "stellarusdtzero.com", 281, 2, { is_asset_anchored: true }),
  usdtNoDomain: asset("USDT", "nodomain", null, 41, 35, null),
  usdtApay: asset("USDT", "apay", "dead.apay.io", 7_595, 44, { anchor_asset_type: "crypto", anchor_asset: "USD", is_asset_anchored: true }),
  aeUsdc: asset("aeUSDC", "allbridgefake", "stellarallbridge.io", 36, 13, { anchor_asset_type: "crypto", anchor_asset: "USDC", is_asset_anchored: true }),
  ousd: asset("OUSD", "qmaga", "q-maga.com", 1_185, 11, fiat("USD", undefined)),
  mgusd: asset("MGUSD", "mgusd", "mgusdstellar.org", 1_219, 8, fiat("USD", undefined)),
  usdv: asset("USDV", "valtorum", "valtorum.com", 18, 184, fiat("USD")),
  yusdc: asset("yUSDC", "ultracap", "ultracapital.xyz", 34_859, 1_779, { anchor_asset_type: "crypto", anchor_asset: "USDC", is_asset_anchored: true, desc: "interest earning USDC" }),
  sslx: asset("SSLX", "sslx", "sslx.sl8.online", 21_792, 1_349, { anchor_asset_type: "crypto", anchor_asset: "USDC", is_asset_anchored: true }),
  aqua: asset("AQUA", "aqua", "aqua.network", 190_000, 5_000, { anchor_asset_type: "crypto" }),
};

const toml = (entries: FeedAsset[]) => entries.map((a) => `[[CURRENCIES]]\ncode = "${a.code}"\nissuer = "${a.issuer}" # comment\ndisplay_decimals = 2\n`).join("\n");
const TOMLS: Record<string, string | number> = {
  "circle.com": toml([F.usdc, F.eurcCircle]),
  "mykobo.co": "<!DOCTYPE html><html><title>One moment, please...</title></html>", // bot wall with HTTP 200
  "pubnet-sep.latamex.com": toml([F.arst]),
  "token-metadata.paxos.com": toml([F.pyusd]),
  "usdt0.to": toml([F.usdt0]),
  "kbtrading.org": `VERSION="2.0"\n[DOCUMENTATION]\nORG_NAME="KB"\n\n[[CURRENCIES]]\ncode='IDRT'\nissuer='${F.idrt.issuer}'\n`,
  "pyusd-qfs.com": toml([F.pyusdQfs]),
  "valtorum.com": 500,
};
const tomlFetch = vi.fn<FetchLike>(async (url: string) => {
  const d = new URL(url).hostname;
  const body = TOMLS[d];
  if (body === undefined) throw new TypeError("getaddrinfo ENOTFOUND");
  if (typeof body === "number") return { ok: false, status: body, text: async () => "", json: async () => ({}) };
  return { ok: true, status: 200, text: async () => body, json: async () => ({}) };
});

describe("parseTomlCurrencies", () => {
  it("reads code/issuer from [[CURRENCIES]] only", () => {
    const t = `[DOCUMENTATION]\ncode="NOPE"\n[[CURRENCIES]]\ncode = "USDC"\nissuer = "GA"\n[[CURRENCIES]]\ncode="X" # c\nissuer="GB"\n[[VALIDATORS]]\ncode="Z"\nissuer="GC"`;
    expect(parseTomlCurrencies(t)).toEqual([{ code: "USDC", issuer: "GA" }, { code: "X", issuer: "GB" }]);
  });
});

describe("static screening", () => {
  const cfg = DEFAULT_CONFIG;
  it("derives peg currencies from stellar.toml", () => {
    expect(pegOf(F.usdc)).toBe("USD");
    expect(pegOf(F.idrt)).toBe("IDR");
    expect(pegOf(F.usdt0)).toBe("USD");
    expect(pegOf(F.pyusd)).toBe("USD"); // no anchor metadata, major stablecoin code
    expect(pegOf(F.aqua)).toBeNull();
  });
  it.each([
    ["usdc", []],
    ["arst", []],
    ["pyusd", []],
    ["usdt0", []],
    ["eurcMykobo", []],
  ] as const)("passes legit %s", (k, want) => expect(screen(F[k], cfg).reasons).toEqual(want));
  it.each([
    ["pyusdQfs", /impersonates PYUSD|suspicious home domain|denylisted/],
    ["usdt0Fake", /impersonates USDT0|denylisted/],
    ["usdtNoDomain", /no home_domain/],
    ["usdtApay", /denylisted|no official Stellar issuer/],
    ["aeUsdc", /wrapped|denylisted/],
    ["ousd", /maga|denylisted/],
    ["mgusd", /denylisted|trades24h/],
    ["usdv", /holders 18 < 1000/],
    ["yusdc", /yield-bearing/],
    ["sslx", /not named as a USD stablecoin/],
  ] as const)("rejects impostor/junk %s", (k, re) => {
    const r = screen(F[k], cfg).reasons;
    expect(r.length).toBeGreaterThan(0);
    expect(r.join("; ")).toMatch(re);
  });
  it("USDT from any domain is rejected (Tether does not issue on Stellar)", () => {
    expect(screen(F.usdtApay, { ...cfg, deny: [] }).reasons.join()).toMatch(/no official Stellar issuer/);
  });
  it("thresholds are configurable", () => {
    expect(screen(F.usdv, { ...cfg, minTrustlines: 10 }).reasons).toEqual([]);
    expect(screen(F.usdc, { ...cfg, minTrades24h: 50_000 }).reasons.join()).toMatch(/trades24h/);
  });
  it("allow/deny overrides", () => {
    expect(screen(F.usdc, { ...cfg, deny: ["USDC@circle.com"] }).reasons).toContain("denylisted");
    expect(screen(F.usdc, { ...cfg, deny: [`USDC:${F.usdc.issuer}`] }).reasons).toContain("denylisted");
    const a = screen(F.usdv, { ...cfg, allow: ["@valtorum.com"] });
    expect(a.allowlisted).toBe(true);
    expect(a.reasons).toEqual([]);
  });
});

describe("issuer verification", () => {
  it("verified / not-listed / fetch-failed / bot wall / cached", async () => {
    const cache = memoryCache();
    const deps = { fetch: tomlFetch, cache };
    expect(await verifyIssuer("circle.com", "USDC", F.usdc.issuer, deps)).toBe("verified");
    expect(await verifyIssuer("circle.com", "USDC", F.pyusdQfs.issuer, deps)).toBe("not-listed");
    expect(await verifyIssuer("valtorum.com", "USDV", F.usdv.issuer, deps)).toBe("fetch-failed");
    expect(await verifyIssuer("nowhere.example", "X", "G", deps)).toBe("fetch-failed");
    expect(await verifyIssuer("mykobo.co", "EURC", F.eurcMykobo.issuer, deps)).toBe("fetch-failed");
    expect(await verifyIssuer(null, "X", "G", deps)).toBe("no-domain");
    const n = tomlFetch.mock.calls.length;
    await verifyIssuer("circle.com", "EURC", F.eurcCircle.issuer, deps);
    expect(tomlFetch.mock.calls.length).toBe(n); // served from cache
  });
});

describe("discoverStablecoins", () => {
  it("builds XLM pairs, flags duplicates, picks the most-held verified primary, hides impostors", async () => {
    const res = await discoverStablecoins({ assets: Object.values(F) }, {}, { fetch: tomlFetch });
    const pairs = res.pairs.map((p) => `${p.code}@${p.domain}:${p.verified ? "v" : "u"}${p.primary ? "*" : ""}${p.duplicate ? "d" : ""}`);
    expect(pairs).toEqual([
      "USDC@circle.com:v*", "ARST@pubnet-sep.latamex.com:v*", "EURC@circle.com:v*d", "USDT0@usdt0.to:v*", "PYUSD@token-metadata.paxos.com:v*", "IDRT@kbtrading.org:v*",
      "EURC@mykobo.co:ud",
    ]);
    expect(res.pairs.every((p) => p.base === "XLM" && p.asOf === "2026-09-11T02:50:01+00:00")).toBe(true);
    const rejectedCodes = res.rejected.map((r) => `${r.code}@${r.domain}`);
    for (const k of ["pyusdQfs", "usdt0Fake", "usdtNoDomain", "usdtApay", "aeUsdc", "ousd", "mgusd", "usdv", "yusdc", "sslx"] as const) {
      expect(rejectedCodes).toContain(`${F[k].code}@${F[k].homeDomain}`);
    }
    expect(rejectedCodes).not.toContain("AQUA@aqua.network"); // not a stablecoin → silently ignored
  });
  it("rejects an issuer its own domain does not list", async () => {
    const fake = { ...F.usdc, issuer: G("notcircle"), assetKey: "USDC-x" };
    const res = await discoverStablecoins({ assets: [fake] }, {}, { fetch: tomlFetch });
    expect(res.pairs).toHaveLength(0);
    expect(res.rejected[0].reasons[0]).toMatch(/not listed/);
  });
  it("allowlisted assets count as verified when the toml cannot be fetched", async () => {
    const res = await discoverStablecoins({ assets: [F.eurcMykobo] }, { allow: [`EURC:${F.eurcMykobo.issuer}`] }, { fetch: tomlFetch });
    expect(res.pairs[0]).toMatchObject({ verified: true, verification: "allowlisted", primary: true });
  });
});

describe("fetchFeed", () => {
  it("pages with the JSON-LD Accept header until a short page", async () => {
    const f = vi.fn<FetchLike>(async (url: string) => {
      const page = Number(new URL(url).searchParams.get("page"));
      const member = page < 3 ? [F.usdc, F.arst] : [F.pyusd];
      return { ok: true, status: 200, text: async () => "", json: async () => ({ member, totalItems: 5 }) };
    });
    const all = await fetchFeed({ network: "mainnet", itemsPerPage: 2, maxPages: 10 }, f);
    expect(all).toHaveLength(5);
    expect(f).toHaveBeenCalledTimes(3);
    expect(f.mock.calls[0][1]?.headers?.Accept).toBe("application/ld+json");
  });
});
