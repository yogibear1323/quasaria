import { describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StellarchainClient, loadNewestJson, savedDataLabel, snapshotLabel, type MarketSnapshot, type RawMarketAsset } from "../src/lib/stellarchain";
// @ts-expect-error plain ESM build script, no types
import { trimAsset } from "../scripts/fetch-market-snapshot.mjs";

const asset = (code: string, rank: number, network = 2): RawMarketAsset => ({
  assetKey: `${code}-GISSUER${rank}`,
  code,
  issuer: `GISSUER${rank}`,
  network,
  rankPosition: rank,
  priceXlm: "1.5",
  priceChange1h: null,
  priceChange24h: "1.0",
  priceChange7d: null,
  volumeXlm24h: "10000000",
  trades24h: 3,
  trustlinesTotal: 10,
  supply: "1",
  sparkline1h: [],
  updatedAt: "2026-09-26T14:00:00+00:00",
  tomlInfo: { documentation: { ORG_NAME: `${code} Org` } },
});

const SNAP: MarketSnapshot = {
  version: 1,
  generatedAt: "2026-09-26T14:25:43.873Z",
  overview: { mainnet: { fetchedAt: "2026-09-26T14:25:43.284Z", data: { xlmPriceUsd: "0.2177", xlmVolume24h: "0", totalTrades24h: "0", activeAssets24h: 0, trackedAssets: 405302, totalAccounts: 1, totalContracts: 2, recordedAt: "2026-09-26T14:25:01+00:00" } } },
  marketAssets: { testnet: { fetchedAt: "2026-09-26T14:25:43.500Z", totalItems: 1000, member: [asset("BBB", 2), asset("AAA", 1), asset("USDC", 3)] } },
};

const down = () => vi.fn(async () => {
  throw new TypeError("Failed to fetch (CORS)");
});
const okFetch = (body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }));

describe("build-time snapshot fallback", () => {
  it("uses the live API first", async () => {
    const snapshot = vi.fn(async () => SNAP);
    const c = new StellarchainClient({ fetch: okFetch({ totalItems: 1, member: [asset("LIVE", 1)] }) as unknown as typeof fetch, storage: null, snapshot });
    const r = await c.marketAssets({ network: "testnet" });
    expect(r.source).toBe("live");
    expect(r.assets.map((a) => a.code)).toEqual(["LIVE"]);
    expect(snapshot).not.toHaveBeenCalled();
  });
  it("falls back to the snapshot when the API is blocked, with rank order, search and paging", async () => {
    const c = new StellarchainClient({ fetch: down() as unknown as typeof fetch, storage: null, snapshot: async () => SNAP });
    const r = await c.marketAssets({ network: "testnet", itemsPerPage: 2 });
    expect(r.source).toBe("snapshot");
    expect(r.snapshotAt).toBe("2026-09-26T14:25:43.500Z");
    expect(r.assets.map((a) => a.code)).toEqual(["AAA", "BBB"]);
    expect(r.total).toBe(1000);
    const s = await c.marketAssets({ network: "testnet", search: "usdc" });
    expect(s.assets.map((a) => a.code)).toEqual(["USDC"]);
    expect(s.total).toBe(1);
    const o = await c.overview("mainnet");
    expect(o?.xlmPriceUsd).toBeCloseTo(0.2177);
    expect(o?.source).toBe("snapshot");
  });
  it("rethrows when there is neither live data nor a snapshot for that section", async () => {
    const c = new StellarchainClient({ fetch: down() as unknown as typeof fetch, storage: null, snapshot: async () => SNAP });
    await expect(c.marketAssets({ network: "mainnet" })).rejects.toThrow(/Failed to fetch/);
    const none = new StellarchainClient({ fetch: down() as unknown as typeof fetch, storage: null, snapshot: async () => null });
    await expect(none.overview()).rejects.toThrow();
  });
  it("prefers the newer of an expired browser cache and the snapshot", async () => {
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    let t = Date.parse("2026-09-27T00:00:00Z"); // cache newer than the snapshot
    await new StellarchainClient({ fetch: okFetch({ member: [{ xlmPriceUsd: "0.30", recordedAt: "2026-09-27T00:00:00Z" }] }) as unknown as typeof fetch, storage, now: () => t }).overview();
    t += 3600_000;
    const o = await new StellarchainClient({ fetch: down() as unknown as typeof fetch, storage, now: () => t, snapshot: async () => SNAP }).overview();
    expect(o?.source).toBe("cache");
    expect(o?.xlmPriceUsd).toBeCloseTo(0.3);
  });
  it("labels snapshot data with its time, and an old copy as stale rather than live", () => {
    expect(snapshotLabel("2026-09-26T14:25:43Z")).toMatch(/^snapshot, updated Sep 26, \d{1,2}:25 (AM|PM)$/);
    expect(snapshotLabel(undefined)).toBe("snapshot");
    const now = Date.parse("2026-11-08T15:30:00Z");
    expect(savedDataLabel("2026-11-08T15:10:00Z", now)).toMatch(/^snapshot, updated Nov 8/);
    expect(savedDataLabel("2026-09-26T14:25:43Z", now)).toMatch(/^stale snapshot, updated Sep 26/);
    expect(savedDataLabel(undefined, now)).toBe("saved copy, time unknown");
  });
  it("uses a saved copy under 45 minutes old without calling the API", async () => {
    const now = Date.parse("2026-11-08T10:40:00Z");
    const fresh: MarketSnapshot = { ...SNAP, overview: { mainnet: { ...SNAP.overview.mainnet!, fetchedAt: "2026-11-08T10:20:00Z" } } };
    const f = vi.fn(async () => { throw new Error("should not call the API"); });
    const c = new StellarchainClient({ fetch: f as unknown as typeof fetch, storage: null, snapshot: async () => fresh, now: () => now, preferSnapshotMaxAgeMs: 45 * 60_000 });
    const o = await c.overview("mainnet");
    expect(o?.source).toBe("snapshot");
    expect(o?.snapshotAt).toBe("2026-11-08T10:20:00Z");
    expect(f).not.toHaveBeenCalled();
  });
  it("after a CORS failure, the next call uses the saved copy and does not hit the API again", async () => {
    const f = down();
    const now = Date.parse("2026-11-08T15:30:00Z");
    const c = new StellarchainClient({ fetch: f as unknown as typeof fetch, storage: null, snapshot: async () => SNAP, now: () => now, preferSnapshotMaxAgeMs: 45 * 60_000 });
    const a = await c.overview("mainnet");
    const b = await c.overview("mainnet");
    expect(a?.source).toBe("snapshot");
    expect(b?.source).toBe("snapshot");
    expect(a?.xlmPriceUsd).toBeCloseTo(0.2177);
    expect(f).toHaveBeenCalledTimes(1);
  });
});

describe("saved market JSON", () => {
  it("picks the newer file with a simple GET (no cache mode, no custom headers)", async () => {
    const f = vi.fn(async (url: string) => {
      const branch = String(url).includes("market-data");
      const body = { version: 1, generatedAt: branch ? "2026-11-08T09:04:10.639Z" : "2026-10-12T01:47:09.934Z" };
      return new Response(JSON.stringify(body), { status: 200 });
    });
    const j = await loadNewestJson<{ version: number; generatedAt: string }>("stellarchain-snapshot.json", (x) => x.version === 1, f as unknown as typeof fetch, Date.parse("2026-11-08T15:21:00Z"));
    expect(j?.generatedAt).toBe("2026-11-08T09:04:10.639Z");
    expect(f).toHaveBeenCalledTimes(2);
    for (const [url, init] of f.mock.calls) {
      expect(String(url)).toMatch(/[?&]qzv=\d+/);
      expect(init).toBeUndefined();
    }
    expect(String(f.mock.calls[0][0])).toContain("market-data/stellarchain-snapshot.json");
    expect(String(f.mock.calls[1][0])).toContain("/data/stellarchain-snapshot.json");
  });
  it("keeps the bundled copy when the branch read fails", async () => {
    const f = vi.fn(async (url: string) => {
      if (String(url).includes("market-data")) throw new TypeError("Failed to fetch");
      return new Response(JSON.stringify({ version: 1, generatedAt: "2026-10-12T01:47:09.934Z" }), { status: 200 });
    });
    const j = await loadNewestJson<{ generatedAt: string }>("stellarchain-snapshot.json", (x) => !!x.generatedAt, f as unknown as typeof fetch, 0);
    expect(j?.generatedAt).toBe("2026-10-12T01:47:09.934Z");
  });
});

describe("fetch-market-snapshot.mjs", () => {
  it("trims assets to the fields the app reads", () => {
    const t = trimAsset({ ...asset("X", 1), tomlInfo: { image: "https://x/y.png", desc: "long…", documentation: { ORG_NAME: "Org", ORG_DBA: "drop" } }, extra: "drop" });
    expect(t.extra).toBeUndefined();
    expect(t.tomlInfo).toEqual({ image: "https://x/y.png", desc: "long…", documentation: { ORG_NAME: "Org" } }); // desc kept verbatim for the About tab
    expect(t.code).toBe("X");
  });
  it("never fails the build and keeps the previous snapshot when the API is unreachable", () => {
    const dir = mkdtempSync(join(tmpdir(), "snap-"));
    const out = join(dir, "s.json");
    writeFileSync(out, JSON.stringify(SNAP));
    const script = new URL("../scripts/fetch-market-snapshot.mjs", import.meta.url).pathname;
    // exits 0 (execFileSync throws otherwise)
    execFileSync(process.execPath, [script, out], { env: { ...process.env, STELLARCHAIN_BASE: "http://127.0.0.1:9/v1", SNAPSHOT_TIMEOUT_MS: "2000" }, stdio: "pipe" });
    expect(JSON.parse(readFileSync(out, "utf8"))).toEqual(SNAP);
  });
});
