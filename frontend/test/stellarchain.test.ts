import { describe, expect, it, vi } from "vitest";
import { StellarchainClient, StellarchainError, asOf, isStale, normalizeMarketAsset, normalizeOverview, type RawMarketAsset } from "../src/lib/stellarchain";

const RAW_ASSET: RawMarketAsset = {
  assetKey: "USDC-GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
  code: "USDC",
  issuer: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
  network: 1,
  rankPosition: 1,
  priceXlm: "5.69914553",
  priceChange1h: "0.0000",
  priceChange24h: "2.6211",
  priceChange7d: null,
  volumeXlm24h: "42434031240433.0000000",
  trades24h: 33118,
  trustlinesTotal: 2394128,
  supply: "3530516123768999",
  sparkline1h: ["5.6", "5.7", null, "bad"],
  updatedAt: "2026-09-11T02:50:01+00:00",
  tomlInfo: { image: "https://www.circle.com/usdc-icon", home_domain: "circle.com", documentation: { ORG_NAME: "Circle Internet Financial, LLC" } },
  imageUrl: null,
};

function mockFetch(body: unknown, status = 200) {
  return vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/ld+json" } }));
}

describe("normalizers", () => {
  it("normalizes a market asset (numbers, stroops→XLM, logo, org)", () => {
    const a = normalizeMarketAsset(RAW_ASSET);
    expect(a.priceXlm).toBeCloseTo(5.69914553);
    expect(a.change24h).toBeCloseTo(2.6211);
    expect(a.change7d).toBeNull();
    expect(a.volumeXlm24h).toBeCloseTo(4_243_403.124, 2);
    expect(a.sparkline).toEqual([5.6, 5.7]);
    expect(a.logo).toBe("https://www.circle.com/usdc-icon");
    expect(a.orgName).toBe("Circle Internet Financial, LLC");
    expect(a.network).toBe("mainnet");
  });
  it("drops non-https logos and maps network 2 to testnet", () => {
    const a = normalizeMarketAsset({ ...RAW_ASSET, network: 2, imageUrl: "javascript:alert(1)", tomlInfo: null, priceXlm: null });
    expect(a.logo).toBeNull();
    expect(a.network).toBe("testnet");
    expect(a.priceXlm).toBeNull();
  });
  it("normalizes the overview", () => {
    const o = normalizeOverview({ xlmPriceUsd: "0.2203410000", xlmVolume24h: "0", totalTrades24h: "0", activeAssets24h: 0, trackedAssets: 405292, totalAccounts: 10967234, totalContracts: 94825, recordedAt: "2026-09-26T01:25:01+00:00" });
    expect(o.xlmPriceUsd).toBeCloseTo(0.220341);
    expect(o.trades24h).toBe(0);
    expect(o.updatedAt).toBe("2026-09-26T01:25:01+00:00");
  });
});

describe("staleness", () => {
  const now = Date.parse("2026-09-26T01:30:00Z");
  it("flags old / missing snapshots", () => {
    expect(isStale("2026-09-11T02:50:01+00:00", 24 * 3600_000, now)).toBe(true);
    expect(isStale("2026-09-26T01:25:01+00:00", 24 * 3600_000, now)).toBe(false);
    expect(isStale(undefined, 1, now)).toBe(true);
    expect(isStale("garbage", 1, now)).toBe(true);
  });
  it("formats as-of labels", () => {
    expect(asOf("2026-09-26T01:25:01+00:00", now)).toBe("5 min ago");
    expect(asOf("2026-09-11T02:50:01+00:00", now)).toBe("15 days ago");
  });
});

describe("StellarchainClient", () => {
  it("sends Accept: application/ld+json and parses Hydra members", async () => {
    const f = mockFetch({ totalItems: 1, member: [RAW_ASSET] });
    const c = new StellarchainClient({ fetch: f as unknown as typeof fetch, storage: null });
    const r = await c.marketAssets({ network: "mainnet", itemsPerPage: 5, search: "USDC" });
    expect(r.total).toBe(1);
    expect(r.assets[0].code).toBe("USDC");
    const [url, init] = f.mock.calls[0];
    expect(url).toBe("https://api.stellarchain.io/v1/market/assets?network=mainnet&itemsPerPage=5&search=USDC");
    expect((init!.headers as Record<string, string>).Accept).toBe("application/ld+json");
  });
  it("caches responses within the TTL and refetches after", async () => {
    let t = 0;
    const f = mockFetch({ member: [] });
    const c = new StellarchainClient({ fetch: f as unknown as typeof fetch, storage: null, ttlMs: 1000, now: () => t });
    await c.projects();
    await c.projects();
    expect(f).toHaveBeenCalledTimes(1);
    t = 2000;
    await c.projects();
    expect(f).toHaveBeenCalledTimes(2);
  });
  it("persists to storage and serves stale cache when the API is down", async () => {
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    let t = 0;
    const ok = mockFetch({ member: [{ xlmPriceUsd: "0.22", recordedAt: "2026-09-26T01:25:01+00:00" }] });
    await new StellarchainClient({ fetch: ok as unknown as typeof fetch, storage, now: () => t }).overview();
    t = 10 * 60_000; // expired
    const down = vi.fn(async () => {
      throw new TypeError("network down");
    });
    const o = await new StellarchainClient({ fetch: down as unknown as typeof fetch, storage, now: () => t }).overview();
    expect(down).toHaveBeenCalledTimes(1);
    expect(o?.xlmPriceUsd).toBeCloseTo(0.22);
  });
  it("throws a typed error on HTTP errors (e.g. 406) with no cache", async () => {
    const c = new StellarchainClient({ fetch: mockFetch({ title: "Not Acceptable" }, 406) as unknown as typeof fetch, storage: null });
    await expect(c.overview()).rejects.toBeInstanceOf(StellarchainError);
  });
});
