import { describe, expect, it, vi } from "vitest";
import type { MarketSnapshot, RawMarketAsset } from "../src/lib/stellarchain";
import {
  aggUrl,
  assetStats,
  bookMid,
  Fetcher,
  hms,
  latestTradePrices,
  LiveMarketsFeed,
  MAINNET_USDC_ISSUER,
  priceStats,
  REFRESH_MS,
  snapshotAssets,
  toCandles,
  tradesUrl,
  tradeVsXlm,
  USDC_KEY,
  type RawAgg,
  type RawTrade,
} from "../src/lib/liveMarkets";

const HOUR = 3600_000;
const DAY = 24 * HOUR;
const NOW = Date.UTC(2026, 8, 29, 23, 30, 0);
const H = (hAgo: number) => Math.floor((NOW - hAgo * HOUR) / HOUR) * HOUR; // start of the candle hAgo hours ago

const agg = (t: number, open: number, close: number, n = 1, cv = 10): RawAgg => ({ timestamp: String(t), trade_count: String(n), counter_volume: String(cv), open: String(open), close: String(close) });
const trade = (o: { tok: string; at: number; base?: [string, string] | null; counter?: [string, string] | null; ba: number; ca: number }): RawTrade => ({
  paging_token: o.tok,
  ledger_close_time: new Date(o.at).toISOString(),
  base_asset_type: o.base ? "credit_alphanum4" : "native",
  base_asset_code: o.base?.[0],
  base_asset_issuer: o.base?.[1],
  base_amount: String(o.ba),
  counter_asset_type: o.counter ? "credit_alphanum4" : "native",
  counter_asset_code: o.counter?.[0],
  counter_asset_issuer: o.counter?.[1],
  counter_amount: String(o.ca),
});

const raw = (code: string, rank: number, extra: Partial<RawMarketAsset> = {}): RawMarketAsset => ({
  assetKey: `${code}-G${code}ISSUER`,
  code,
  issuer: `G${code}ISSUER`,
  network: 1,
  rankPosition: rank,
  priceXlm: "2.5",
  priceChange1h: "0.1",
  priceChange24h: "1.5",
  priceChange7d: "3.0",
  volumeXlm24h: "50000000", // 5 XLM in stroops
  trades24h: 7,
  trustlinesTotal: 1234,
  supply: "1",
  sparkline1h: ["1", "2"],
  updatedAt: "2026-09-11T02:50:01+00:00",
  imageUrl: `https://img.example/${code}.png`,
  tomlInfo: { documentation: { ORG_NAME: `${code} Org` } },
  ...extra,
});
const usdcRaw = raw("USDC", 4, { assetKey: USDC_KEY, issuer: MAINNET_USDC_ISSUER });

const SNAP: MarketSnapshot = {
  version: 1,
  generatedAt: "2026-09-26T14:25:43.873Z",
  marketAssets: {
    mainnet: { fetchedAt: "2026-09-26T14:25:43.872Z", totalItems: 998, member: [raw("BBB", 2), raw("AAA", 1), raw("CCC", 3), usdcRaw] },
    testnet: { fetchedAt: "2026-09-26T14:25:43.500Z", member: [raw("TST", 1, { network: 2 })] },
  },
};

describe("Horizon → market row mapping", () => {
  const candles = toCandles([
    agg(H(8 * 24), 1.0, 1.0, 1, 5), // 8 days ago
    agg(H(30), 1.8, 2.0, 2, 20), // 30h ago → price 24h ago = 2.0
    agg(H(5), 2.1, 2.2, 3, 50), // → price 1h ago = 2.2
    agg(H(0), 2.25, 2.4, 5, 25), // current hour
  ].reverse());
  it("derives price, 1h/24h/7d change, 24h volume/trades and a 24-point sparkline from hourly candles", () => {
    const s = priceStats(candles, NOW);
    expect(s.price).toBe(2.4);
    expect(s.priceKind).toBe("trade");
    expect(s.change1h).toBeCloseTo((2.4 / 2.2 - 1) * 100, 6);
    expect(s.change24h).toBeCloseTo(20, 6); // 2.0 → 2.4
    expect(s.change7d).toBeCloseTo(140, 6); // 1.0 → 2.4
    expect(s.volumeXlm24h).toBe(75); // only candles inside 24h
    expect(s.trades24h).toBe(8);
    expect(s.sparkline).toHaveLength(24);
    expect(s.sparkline[0]).toBe(2.0);
    expect(s.sparkline[23]).toBe(2.4);
    expect(s.lastTradeAt).toBe(H(0));
    expect(s.lastTradeExact).toBe(false);
  });
  it("a newer live trade overrides the last candle close (and moves the changes)", () => {
    const s = priceStats(candles, NOW, { price: 2.2, at: NOW - 60_000 });
    expect(s.price).toBe(2.2);
    expect(s.change24h).toBeCloseTo(10, 6);
    expect(s.change1h).toBeCloseTo(0, 6);
    expect(s.sparkline[23]).toBe(2.2);
    expect(s.lastTradeAt).toBe(NOW - 60_000);
    expect(s.lastTradeExact).toBe(true);
    // an older trade than the last candle is ignored
    expect(priceStats(candles, NOW, { price: 9, at: H(3) }).price).toBe(2.4);
  });
  it("no trade in 24h: order-book mid as price, no 1h/24h change; no candles at all: nulls", () => {
    const quiet = toCandles([agg(H(72), 1, 1.5)]);
    const s = priceStats(quiet, NOW, null, 1.6);
    expect(s).toMatchObject({ price: 1.6, priceKind: "book", change1h: null, change24h: null, volumeXlm24h: 0, trades24h: 0 });
    expect(priceStats([], NOW)).toMatchObject({ price: null, priceKind: null, change7d: null, sparkline: [] });
  });
  it("maps network-wide trades to XLM prices both ways, skipping dust and outliers", () => {
    const A: [string, string] = ["AAA", "GAAAISSUER"];
    expect(tradeVsXlm(trade({ tok: "1", at: NOW, base: A, counter: null, ba: 10, ca: 25 }))).toMatchObject({ key: "AAA-GAAAISSUER", price: 2.5, xlm: 25 });
    expect(tradeVsXlm(trade({ tok: "2", at: NOW, base: null, counter: A, ba: 50, ca: 20 }))).toMatchObject({ key: "AAA-GAAAISSUER", price: 2.5, xlm: 50 });
    expect(tradeVsXlm(trade({ tok: "3", at: NOW, base: A, counter: ["BBB", "GB"], ba: 1, ca: 1 }))).toBeNull();
    const m = latestTradePrices(
      [
        trade({ tok: "10", at: NOW - 20_000, base: A, counter: null, ba: 10, ca: 24 }),
        trade({ tok: "11", at: NOW - 10_000, base: A, counter: null, ba: 10, ca: 26 }), // latest
        trade({ tok: "12", at: NOW - 5_000, base: A, counter: null, ba: 0.01, ca: 0.05 }), // dust
        trade({ tok: "13", at: NOW - 1_000, base: A, counter: null, ba: 1, ca: 900 }), // outlier vs ref 2.5
        trade({ tok: "14", at: NOW, base: ["ZZZ", "GZ"], counter: null, ba: 1, ca: 1 }), // not tracked
      ],
      new Set(["AAA-GAAAISSUER"]),
      () => 2.5,
    );
    expect([...m]).toEqual([["AAA-GAAAISSUER", { price: 2.6, at: NOW - 10_000 }]]);
  });
  it("order-book mid, /assets holders + supply, URLs and the snapshot's top-N list", () => {
    expect(bookMid({ bids: [{ price: "1.0" }], asks: [{ price: "1.2" }] })).toBeCloseTo(1.1);
    expect(bookMid({ bids: [], asks: [{ price: "3" }] })).toBe(3);
    expect(bookMid({ bids: [], asks: [] })).toBeNull();
    const st = assetStats({
      asset_code: "USDC",
      asset_issuer: MAINNET_USDC_ISSUER,
      accounts: { authorized: 100, authorized_to_maintain_liabilities: 5, unauthorized: 1 },
      balances: { authorized: "1000.5", authorized_to_maintain_liabilities: "0", unauthorized: "0" },
      claimable_balances_amount: "10",
      liquidity_pools_amount: "20",
      contracts_amount: "30",
    });
    expect(st).toEqual({ holders: 105, supply: 1060.5 });
    expect(assetStats(null)).toEqual({ holders: null, supply: null });
    const u = new URL(aggUrl({ code: "USDC", issuer: MAINNET_USDC_ISSUER }, "native", NOW));
    expect(u.origin + u.pathname).toBe("https://horizon.stellar.org/trade_aggregations");
    expect(u.searchParams.get("base_asset_type")).toBe("credit_alphanum4");
    expect(u.searchParams.get("counter_asset_type")).toBe("native");
    expect(u.searchParams.get("resolution")).toBe(String(HOUR));
    expect(Number(u.searchParams.get("start_time")) % HOUR).toBe(0);
    expect((Number(u.searchParams.get("end_time")) - Number(u.searchParams.get("start_time"))) / HOUR).toBeLessThanOrEqual(200);
    expect(aggUrl({ code: "GStart", issuer: "GX" }, "native", NOW)).toContain("base_asset_type=credit_alphanum12");
    expect(tradesUrl(null)).toBe("https://horizon.stellar.org/trades?order=desc&limit=200");
    expect(tradesUrl("123-4")).toBe("https://horizon.stellar.org/trades?cursor=123-4&order=asc&limit=200");
    const { assets, at } = snapshotAssets(SNAP, 2);
    expect(assets.map((a) => a.code)).toEqual(["AAA", "BBB"]);
    expect(at).toBe("2026-09-26T14:25:43.872Z");
    expect(snapshotAssets(null).assets).toEqual([]);
    expect(hms(new Date(2026, 0, 1, 7, 5, 9).getTime())).toBe("07:05:09");
  });
});

// ---------------------------------------------------------------- mocked Horizon
type Out = Response | "throw" | "hang";
type Kind = "trades" | "agg" | "assets" | "book";
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });
const page = (records: unknown[]) => ({ _embedded: { records } });
const codeOf = (u: URL) => u.searchParams.get("base_asset_code") ?? u.searchParams.get("asset_code") ?? u.searchParams.get("selling_asset_code");

function defaults(kind: Kind, u: URL): Response {
  const code = codeOf(u);
  if (kind === "trades")
    return json(page(u.searchParams.get("cursor") ? [] : [trade({ tok: "900", at: NOW - 5_000, base: ["AAA", "GAAAISSUER"], counter: null, ba: 10, ca: 45 })]));
  if (kind === "agg") {
    if (code === "CCC") return json(page([agg(H(72), 1, 1)])); // quiet asset
    if (code === "USDC") return json(page([agg(H(30), 4.4, 4.4), agg(H(0), 4.5, 4.5)]));
    return json(page([agg(H(30), 4, 4), agg(H(0), 4, 4.4, 3, 300)]));
  }
  if (kind === "assets") return json(page([{ asset_code: code, asset_issuer: `G${code}ISSUER`, accounts: { authorized: 42 }, balances: { authorized: "1000" } }]));
  return json({ bids: [{ price: "0.9" }], asks: [{ price: "1.1" }] });
}

function horizon(over: Partial<Record<Kind, (u: URL) => Out>> = {}) {
  const calls: string[] = [];
  let inflight = 0;
  let maxInflight = 0;
  const f = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const u = new URL(String(input));
    calls.push(u.toString());
    inflight++;
    maxInflight = Math.max(maxInflight, inflight);
    try {
      await new Promise((r) => setTimeout(r, 1));
      const kind: Kind = u.pathname === "/trades" ? "trades" : u.pathname === "/trade_aggregations" ? "agg" : u.pathname === "/assets" ? "assets" : "book";
      const out = over[kind]?.(u) ?? defaults(kind, u);
      if (out === "throw") throw new TypeError("Failed to fetch");
      if (out === "hang") return await new Promise<Response>((_, rej) => init?.signal?.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" }))));
      return out;
    } finally {
      inflight--;
    }
  });
  return { f: f as unknown as typeof fetch, calls, maxInflight: () => maxInflight, count: (p: string) => calls.filter((c) => new URL(c).pathname === p).length };
}
const feedWith = (f: typeof fetch, o: { timeoutMs?: number; now?: () => number } = {}) => new LiveMarketsFeed({ fetch: f, loadSnapshot: async () => SNAP, now: o.now ?? (() => NOW), timeoutMs: o.timeoutMs, storage: null });

describe("live feed + fallback (mocked Horizon)", () => {
  it("loads every snapshot asset live: trade feed price, candle stats, holders, supply, XLM/USD", async () => {
    const h = horizon();
    const feed = feedWith(h.f);
    const s = await feed.tick();
    expect(s.mode).toBe("live");
    expect(s.updatedAt).toBe(NOW);
    expect(s.rows.map((r) => r.code)).toEqual(["AAA", "BBB", "CCC", "USDC"]); // snapshot rank order
    expect(s.rows.every((r) => r.source === "live")).toBe(true);
    const [a, b, c] = s.rows;
    expect(a).toMatchObject({ priceXlm: 4.5, priceKind: "trade", lastTradeAt: NOW - 5_000, volumeXlm24h: 300, trades24h: 3, holders: 42, supply: 1000, orgName: "AAA Org", logo: "https://img.example/AAA.png", snapshotFields: [] });
    expect(a.change24h).toBeCloseTo(12.5); // 4 → 4.5 (live trade)
    expect(b.priceXlm).toBe(4.4); // no live trade: last candle close
    expect(c).toMatchObject({ priceXlm: 1, priceKind: "book", change24h: null }); // no trade in 24h → book mid
    expect(s.xlmUsd?.price).toBeCloseTo(1 / 4.5);
    expect(s.snapshotRows).toBe(0);
    expect(h.maxInflight()).toBeLessThanOrEqual(4);
    expect(h.calls.every((u) => u.startsWith("https://horizon.stellar.org/"))).toBe(true);
    expect(h.count("/trades")).toBe(1);
    expect(h.count("/trade_aggregations")).toBe(4); // one per asset on first load
    expect(feed.nextDelay()).toBe(REFRESH_MS);
  });

  it("stays within Horizon's candle limit: later ticks poll /trades and refresh only a few stale candles", async () => {
    let t = NOW;
    const h = horizon();
    const feed = feedWith(h.f, { now: () => t });
    await feed.tick();
    const aggs0 = h.count("/trade_aggregations");
    for (let i = 0; i < 9; i++) {
      t += REFRESH_MS; // 4.5 min
      expect((await feed.tick()).mode).toBe("live");
    }
    expect(h.count("/trade_aggregations")).toBe(aggs0); // nothing is due yet (10 min TTL)
    expect(h.count("/trades")).toBe(10 + 0); // one cursor page per tick (empty = caught up)
    t += 6 * 60_000; // past the TTL → at most 3 per tick
    await feed.tick();
    expect(h.count("/trade_aggregations") - aggs0).toBe(3);
  });

  it("falls back to the whole saved snapshot when Horizon is unreachable, then switches back to live automatically", async () => {
    let down = true;
    const h = horizon({ trades: () => (down ? "throw" : null!) });
    const feed = feedWith(h.f);
    const s1 = await feed.tick();
    expect(s1.mode).toBe("fallback");
    expect(s1.snapshotAt).toBe("2026-09-26T14:25:43.872Z");
    expect(s1.rows.every((r) => r.source === "snapshot")).toBe(true);
    expect(s1.rows[0]).toMatchObject({ code: "AAA", priceXlm: 2.5, priceKind: "snapshot", volumeXlm24h: 5, holders: 1234, change24h: 1.5 });
    expect(s1.snapshotRows).toBe(4);
    expect(s1.error).toMatch(/Failed to fetch/);
    expect(h.calls).toHaveLength(2); // probe + one retry: no burst of doomed requests
    expect(feed.nextDelay()).toBe(REFRESH_MS); // retry after ~30s…
    await feed.tick();
    expect(feed.nextDelay()).toBe(2 * REFRESH_MS); // …then exponential backoff
    down = false;
    const s3 = await feed.tick();
    expect(s3.mode).toBe("live");
    expect(s3.error).toBeNull();
    expect(s3.rows.every((r) => r.source === "live")).toBe(true);
    expect(feed.nextDelay()).toBe(REFRESH_MS);
  });

  it("retries a transient probe failure once before falling back", async () => {
    let n = 0;
    const h = horizon({ trades: () => (n++ === 0 ? "throw" : null!) });
    expect((await feedWith(h.f).tick()).mode).toBe("live");
    expect(n).toBe(2);
  });

  it("treats a timeout (~8s budget, shortened here) as a failure and shows the snapshot", async () => {
    const h = horizon({ trades: () => "hang" });
    const s = await feedWith(h.f, { timeoutMs: 20 }).tick();
    expect(s.mode).toBe("fallback");
    expect(s.error).toMatch(/timeout/);
  });

  it("per-asset fallback: only the asset whose candles failed shows snapshot values", async () => {
    const h = horizon({ agg: (u) => (codeOf(u) === "BBB" ? json({ status: 500 }, 500) : null!) });
    const s = await feedWith(h.f).tick();
    expect(s.mode).toBe("live");
    expect(s.snapshotRows).toBe(1);
    const byCode = Object.fromEntries(s.rows.map((r) => [r.code, r]));
    expect(byCode.BBB).toMatchObject({ source: "snapshot", priceXlm: 2.5, priceKind: "snapshot" });
    expect(byCode.AAA.source).toBe("live");
    expect(s.error).toMatch(/1 of 4/);
  });

  it("marks holders as snapshot data when /assets fails", async () => {
    const h = horizon({ assets: () => "throw" });
    const s = await feedWith(h.f).tick();
    expect(s.mode).toBe("live");
    expect(s.rows[0]).toMatchObject({ source: "live", holders: 1234, supply: null, snapshotFields: ["holders"] });
  });

  it("rate limits: a 429 (or CORS-less failure) on candles backs that endpoint off; all candles failing → snapshot", async () => {
    let t = NOW;
    const h = horizon({ agg: () => new Response("", { status: 429, headers: { "X-RateLimit-Reset": "300" } }) });
    const feed = feedWith(h.f, { now: () => t });
    const s = await feed.tick();
    expect(s.mode).toBe("fallback");
    expect(s.rateLimited).toBe(true);
    expect(s.error).toMatch(/rate-limited/);
    const n = h.count("/trade_aggregations");
    expect(feed.fetcher.coolingUntil("/trade_aggregations")).toBe(NOW + 300_000);
    t += 60_000; // still cooling down: no candle requests at all
    await feed.tick();
    expect(h.count("/trade_aggregations")).toBe(n);
  });

  it("limits concurrency in the request gate", async () => {
    let active = 0;
    let peak = 0;
    const f = vi.fn(async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      return json({ ok: 1 });
    });
    const g = new Fetcher({ fetch: f as unknown as typeof fetch, concurrency: 3 });
    await Promise.all(Array.from({ length: 12 }, (_, i) => g.json(`https://horizon.stellar.org/x/${i}`)));
    expect(f).toHaveBeenCalledTimes(12);
    expect(peak).toBe(3);
  });
});
