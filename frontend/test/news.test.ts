import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { EXCERPT_MAX, NEWS_SOURCES, NEWS_TAGS, decodeEntities, isHype, isPrerelease, isStellarRelated, mergeNews, parseFeed, parseStatusSummary, relativeTime, releaseSummary, releaseTitle, safeUrl, sanitizeItem, tagItem, toPlainText, truncate, type NewsSource } from "../src/lib/newsCore.mjs";
import { filterByTag, pickStrip, itemTime, loadNews, localTime, parseNewsSnapshot, tagCounts, NEWS_CACHE_KEY } from "../src/lib/news";
// @ts-expect-error plain ESM build script, no types
import { buildNewsSnapshot, contentKey, hasChanged } from "../scripts/fetch-news-snapshot.mjs";

const NOW = Date.parse("2026-09-29T20:00:00Z");
const src = (id: string, extra: Partial<NewsSource> = {}): NewsSource => ({ id, name: id.toUpperCase(), home: `https://${id}.example`, feed: `https://${id}.example/rss`, kind: "blog", tags: [], filter: false, ...extra });

const RSS = `<?xml version="1.0"?><rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/" xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel><title>Feed</title>
<item>
  <title><![CDATA[Soroban Rust SDK v28 &amp; more]]></title>
  <link>https://stellar.org/blog/developers/soroban-rust-sdk-v28?utm_source=rss&amp;x=1</link>
  <pubDate>Mon, 28 Sep 2026 16:20:46 GMT</pubDate>
  <description><![CDATA[<p style="float:right"><img src="https://img.example/a.png" alt="x"></p><p>What contract developers <b>need</b> to know.</p><script>alert(1)</script>]]></description>
  <enclosure url="https://cdn.example/cover.png" length="0" type="image/png"/>
</item>
<item>
  <title>Cboe&#39;s New S&amp;amp;P Deal</title>
  <link>https://decrypt.co/379619/cboe</link>
  <pubDate>Tue, 29 Sep 2026 21:16:04 +0000</pubDate>
  <description>Escaped &lt;i&gt;HTML&lt;/i&gt; &amp;amp; entities</description>
  <media:thumbnail url="https://cdn.example/thumb.jpg" />
</item>
<item><title>No link</title><pubDate>Tue, 29 Sep 2026 10:00:00 GMT</pubDate></item>
<item><title>Bad link</title><link>javascript:alert(1)</link><pubDate>Tue, 29 Sep 2026 10:00:00 GMT</pubDate></item>
<item><title>Medium post</title><link>https://medium.com/stellar-community/p-1?source=rss----89c---4</link><guid isPermaLink="false">https://medium.com/p/1</guid>
  <pubDate>Wed, 23 Sep 2026 21:05:56 GMT</pubDate><category><![CDATA[stellar]]></category>
  <content:encoded><![CDATA[<figure><img src="http://insecure.example/x.png"/><img src="https://cdn-images-1.medium.com/y.png"/></figure><p>${"Long text about the Stellar Community Fund. ".repeat(20)}</p>]]></content:encoded></item>
</channel></rss>`;

const ATOM = `<?xml version="1.0" encoding="utf-8"?><feed xmlns="http://www.w3.org/2005/Atom"><title>A</title>
<entry><title type="html">Atom &lt;em&gt;entry&lt;/em&gt;</title><link rel="self" href="https://a.example/self"/><link href="/posts/1"/>
<published>2026-09-27T08:00:00Z</published><summary>Short summary</summary><category term="Soroban"/></entry></feed>`;

describe("news: text sanitizing", () => {
  it("strips tags, scripts and styles, decodes entities (also double-encoded), removes control chars", () => {
    expect(toPlainText("<p>Hello <b>world</b></p><script>alert('x')</script><style>p{}</style>")).toBe("Hello world");
    expect(toPlainText("S&amp;amp;P &#39;500&#39; &#x2014; &hellip;")).toBe("S&P '500' — …");
    expect(toPlainText("&lt;img src=x onerror=alert(1)&gt;safe")).toBe("safe");
    expect(toPlainText("a\u0000b\u202ec\u200bd")).toBe("a b c d");
    expect(toPlainText("<![CDATA[<i>cdata</i>]]>")).toBe("cdata");
    expect(toPlainText("unclosed <a href='x' ")).toBe("unclosed");
    expect(decodeEntities("&unknown; &#0; &#xD800;")).toBe("&unknown;  ");
  });
  it("truncates excerpts at a word boundary with an ellipsis", () => {
    const t = truncate("word ".repeat(100), EXCERPT_MAX);
    expect(t.length).toBeLessThanOrEqual(EXCERPT_MAX);
    expect(t.endsWith("word…")).toBe(true);
    expect(truncate("short", 200)).toBe("short");
  });
  it("only allows absolute http(s) URLs and drops tracking params", () => {
    expect(safeUrl("javascript:alert(1)")).toBeNull();
    expect(safeUrl("JaVaScRiPt:alert(1)")).toBeNull();
    expect(safeUrl("data:text/html,<script>")).toBeNull();
    expect(safeUrl("vbscript:x")).toBeNull();
    expect(safeUrl("//evil.example/x")).toBeNull();
    expect(safeUrl("https://user:pw@evil.example/")).toBeNull();
    expect(safeUrl("/rel")).toBeNull();
    expect(safeUrl("/rel", "https://base.example/blog")).toBe("https://base.example/rel");
    expect(safeUrl("https://x.example/a?utm_source=rss&utm_medium=y&id=2")).toBe("https://x.example/a?id=2");
    expect(safeUrl("https://medium.com/p?source=rss----1")).toBe("https://medium.com/p");
    expect(safeUrl("http://x.example/")).toBe("http://x.example/");
  });
});

describe("news: feed parsing", () => {
  it("parses RSS 2.0 items: plain-text title/excerpt, safe link, date, thumbnail", () => {
    const items = parseFeed(RSS, src("sdf"));
    expect(items.map((i) => i.title)).toEqual(["Soroban Rust SDK v28 & more", "Cboe's New S&P Deal", "Medium post"]);
    const [a, b, m] = items;
    expect(a.url).toBe("https://stellar.org/blog/developers/soroban-rust-sdk-v28?x=1");
    expect(a.publishedAt).toBe("2026-09-28T16:20:46.000Z");
    expect(a.excerpt).toBe("What contract developers need to know.");
    expect(a.excerpt).not.toMatch(/alert|</);
    expect(a.image).toBe("https://cdn.example/cover.png"); // enclosure preferred over inline <img>
    expect(b.excerpt).toBe("Escaped HTML & entities");
    expect(b.image).toBe("https://cdn.example/thumb.jpg");
    expect(m.url).toBe("https://medium.com/stellar-community/p-1");
    expect(m.excerpt.length).toBeLessThanOrEqual(EXCERPT_MAX);
    expect(m.image).toBe("https://cdn-images-1.medium.com/y.png"); // http image skipped
    expect(m.categories).toContain("stellar");
    expect(a.source).toBe("sdf");
  });
  it("parses Atom entries (alternate link resolved against the source home)", () => {
    const [e] = parseFeed(ATOM, src("atom", { home: "https://a.example/blog" }));
    expect(e).toMatchObject({ title: "Atom entry", url: "https://a.example/posts/1", publishedAt: "2026-09-27T08:00:00.000Z", excerpt: "Short summary", image: null });
    expect(e.categories).toContain("Soroban");
  });
  it("returns [] for junk instead of throwing", () => {
    expect(parseFeed("<html><body>not a feed</body></html>", src("x"))).toEqual([]);
    expect(parseFeed("", src("x"))).toEqual([]);
  });
});

describe("news: Stellar filter", () => {
  it("keeps Stellar / XLM / Soroban stories and skips adjective uses and unrelated news", () => {
    expect(isStellarRelated({ title: "Stellar tokenized RWA market quadruples" })).toBe(true);
    expect(isStellarRelated({ title: "Why is XLM up 50%?" })).toBe(true);
    expect(isStellarRelated({ title: "New Soroban SDK", excerpt: "" })).toBe(true);
    expect(isStellarRelated({ title: "US Bank pilots stablecoin", excerpt: "The payment ran on the public Stellar blockchain." })).toBe(true);
    expect(isStellarRelated({ title: "Payments firm", categories: ["Stellar"] })).toBe(true);
    expect(isStellarRelated({ title: "Coinbase posts a stellar quarter" })).toBe(false);
    expect(isStellarRelated({ title: "Bitcoin Miners Report Stellar Quarter" })).toBe(false);
    expect(isStellarRelated({ title: "Robinhood adds AI agents", excerpt: "Weekend trading arrives." })).toBe(false);
    expect(isStellarRelated({ title: "Axelar launches bridge" })).toBe(false);
  });
});

describe("news: merge, dedupe, sanitize", () => {
  const item = (o: Record<string, unknown>) => ({ title: "T", url: "https://a.example/1", publishedAt: "2026-09-29T10:00:00Z", excerpt: "", image: null, categories: [], ...o });
  const sources = [src("sdf"), src("ct"), src("gen", { filter: true })];
  it("filters general feeds, dedupes by URL and headline (first source wins), sorts newest first", () => {
    const out = mergeNews({
      sdf: [item({ title: "Stellar ships Protocol 28", url: "https://stellar.org/p28", source: "sdf" })],
      ct: [
        item({ title: "Stellar ships protocol 28!", url: "https://ct.example/other", source: "ct" }), // same headline
        item({ title: "Different", url: "https://www.stellar.org/p28/?utm_source=x", source: "ct" }), // same URL
        item({ title: "Newest", url: "https://ct.example/new", publishedAt: "2026-09-29T19:00:00Z", source: "ct" }),
      ],
      gen: [item({ title: "XLM jumps", url: "https://gen.example/1", source: "gen" }), item({ title: "Bitcoin ETF flows", url: "https://gen.example/2", source: "gen" })],
    }, { sources, now: NOW });
    expect(out.map((i) => i.title)).toEqual(["Newest", "Stellar ships Protocol 28", "XLM jumps"]);
    expect(out[1].source).toBe("sdf");
  });
  it("drops undated, too-old and future items, and caps per source and in total", () => {
    const many = Array.from({ length: 30 }, (_, i) => item({ title: `n${i}`, url: `https://a.example/n${i}` }));
    const out = mergeNews({
      sdf: [
        item({ title: "undated", url: "https://a.example/u", publishedAt: null }),
        item({ title: "old", url: "https://a.example/o", publishedAt: "2024-01-01T00:00:00Z" }),
        item({ title: "future", url: "https://a.example/f", publishedAt: "2026-10-05T00:00:00Z" }),
        ...many,
      ],
    }, { sources, now: NOW, maxPerSource: 5 });
    expect(out).toHaveLength(5);
    expect(out.some((i) => ["undated", "old", "future"].includes(i.title))).toBe(false);
    expect(mergeNews({ sdf: many }, { sources, now: NOW, maxItems: 7 })).toHaveLength(7);
  });
  it("honours a per-source freshness window and item cap", () => {
    const s2 = [src("rel", { maxAgeDays: 30, maxItems: 2 })];
    const out = mergeNews({ rel: [item({ title: "a", url: "https://a.example/a" }), item({ title: "b", url: "https://a.example/b" }), item({ title: "c", url: "https://a.example/c" }), item({ title: "stale", url: "https://a.example/s", publishedAt: "2026-06-01T00:00:00Z" })] }, { sources: s2, now: NOW });
    expect(out.map((i) => i.title).sort()).toEqual(["a", "b"]);
    expect(mergeNews({ rel: [item({ title: "stale", url: "https://a.example/s", publishedAt: "2026-06-01T00:00:00Z" })] }, { sources: s2, now: NOW })).toEqual([]);
  });
  it("is deterministic: same input, same order, ties broken by id", () => {
    const input = { sdf: [item({ title: "A", url: "https://a.example/a" }), item({ title: "B", url: "https://a.example/b" })] };
    expect(mergeNews(input, { sources, now: NOW })).toEqual(mergeNews({ sdf: [...input.sdf].reverse() }, { sources, now: NOW }));
  });
  it("sanitizeItem re-sanitizes stored JSON (HTML, bad links, http images, unknown tags)", () => {
    const s = sanitizeItem({ title: "<img src=x onerror=alert(1)>Hi <b>there</b>", url: "https://ok.example/a", publishedAt: "2026-09-29T10:00:00Z", excerpt: "<script>x()</script>" + "y".repeat(400), image: "http://insecure.example/i.png", source: "sdf", sourceName: "<b>SDF</b>", tags: ["protocol", "<b>x</b>", "protocol", "mainnet"] });
    expect(s).toMatchObject({ title: "Hi there", image: null, sourceName: "SDF", tags: ["protocol", "mainnet"] });
    expect(s!.excerpt.length).toBeLessThanOrEqual(EXCERPT_MAX);
    expect(s!.excerpt).not.toContain("script");
    expect(sanitizeItem({ title: "x", url: "javascript:alert(1)", publishedAt: "2026-09-29T10:00:00Z" })).toBeNull();
    expect(sanitizeItem({ title: "x", url: "https://a.example", publishedAt: "not a date" })).toBeNull();
    expect(sanitizeItem(null)).toBeNull();
  });
  it("relative times", () => {
    expect(relativeTime("2026-09-29T19:59:30Z", NOW)).toBe("just now");
    expect(relativeTime("2026-09-29T19:15:00Z", NOW)).toBe("45m ago");
    expect(relativeTime("2026-09-29T18:00:00Z", NOW)).toBe("2h ago");
    expect(relativeTime("2026-09-26T20:00:00Z", NOW)).toBe("3d ago");
    expect(relativeTime("2026-06-01T20:00:00Z", NOW)).toMatch(/Jun 1, 2026/);
    expect(relativeTime("nope", NOW)).toBe("");
  });
});

describe("news: relevance, hype and release handling", () => {
  const item = (o: Record<string, unknown>) => ({ title: "T", url: "https://a.example/1", publishedAt: "2026-09-29T10:00:00Z", excerpt: "", image: null, categories: [], ...o });
  it("detects leverage / futures hype and price-prediction clickbait without hitting normal wording", () => {
    for (const t of ["Trade XLM perps with 50x leverage", "Stellar perpetual futures launch", "XLM price prediction: will it hit $1?", "Leverage trading comes to Stellar", "Long squeeze wipes out XLM shorts", "XLM to the moon"]) expect(isHype({ title: t }), t).toBe(true);
    for (const t of ["Developers leverage Soroban to build lending", "Stellar Core v30.0.0 released", "Chainlink is now live on Stellar", "A bank-issued stablecoin moves real money on Stellar"]) expect(isHype({ title: t }), t).toBe(false);
  });
  it("drops hype headlines everywhere; hype only in a blurb drops third-party items but keeps official posts without the blurb", () => {
    const sources = [src("sdf", { kind: "blog" }), src("press", { kind: "outlet", filter: true })];
    const out = mergeNews({
      sdf: [
        item({ title: "Chainlink is now live on Stellar", url: "https://stellar.org/c", excerpt: "Data feeds for lending, perps, and more.", source: "sdf" }),
        item({ title: "Stellar perps exchange opens", url: "https://stellar.org/p", source: "sdf" }),
      ],
      press: [
        item({ title: "XLM news", url: "https://press.example/1", excerpt: "traders can open 20x leverage positions", source: "press" }),
        item({ title: "XLM payments news", url: "https://press.example/2", excerpt: "ok", source: "press" }),
      ],
    }, { sources, now: NOW });
    expect(out.map((i) => i.title).sort()).toEqual(["Chainlink is now live on Stellar", "XLM payments news"]);
    expect(out.find((i) => i.url.endsWith("/c"))!.excerpt).toBe("");
    expect(JSON.stringify(out)).not.toMatch(/perps|leverage/i);
  });
  it("skips pre-releases and formats release titles and summaries", () => {
    expect(isPrerelease({ url: "https://github.com/stellar/stellar-core/releases/tag/v29.0.0-internal", title: "v29.0.0-internal" })).toBe(true);
    expect(isPrerelease({ url: "https://github.com/stellar/rs-soroban-sdk/releases/tag/v28.0.0-rc.2", title: "28.0.0-rc.2" })).toBe(true);
    expect(isPrerelease({ url: "https://github.com/stellar/stellar-rpc/releases/tag/archive-node-beta", title: "archive-node-beta" })).toBe(true);
    expect(isPrerelease({ url: "https://github.com/stellar/stellar-core/releases/tag/v30.0.0", title: "v30.0.0" })).toBe(false);
    expect(releaseTitle("v30.0.0", "Stellar Core")).toBe("Stellar Core v30.0.0 released");
    expect(releaseTitle("Horizon v29.0.0", "Horizon")).toBe("Horizon v29.0.0 released");
    expect(releaseTitle("29.0.1", "Soroban Rust SDK")).toBe("Soroban Rust SDK v29.0.1 released");
    expect(releaseTitle("V16.3.1", "JS Stellar SDK")).toBe("JS Stellar SDK v16.3.1 released");
    expect(releaseSummary("What's Changed Improve DEX offer crossing")).toBe("Improve DEX offer crossing");
    const rel = src("core", { kind: "release", label: "Stellar Core", tags: ["protocol"] });
    const out = mergeNews({ core: [item({ title: "v30.0.0", url: "https://github.com/stellar/stellar-core/releases/tag/v30.0.0", excerpt: "Release Notes This release bumps the protocol to version 30", image: "https://avatars.example/a.png" }), item({ title: "v30.0.0-rc.1", url: "https://github.com/stellar/stellar-core/releases/tag/v30.0.0-rc.1" })] }, { sources: [rel], now: NOW });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ title: "Stellar Core v30.0.0 released", excerpt: "This release bumps the protocol to version 30", image: null, tags: ["protocol"] });
  });
  it("tags items: source tags + URL/keyword tags, always at least one, only known ids", () => {
    const blog = src("sdf");
    expect(tagItem({ title: "Soroban Rust SDK v28", url: "https://stellar.org/blog/developers/x" }, blog)).toEqual(["developers"]);
    expect(tagItem({ title: "USDT0 is now live on Stellar", url: "https://stellar.org/blog/foundation-news/x" }, blog)).toEqual(["ecosystem", "mainnet"]);
    expect(tagItem({ title: "Protocol 28 upgrade guide", url: "https://stellar.org/blog/developers/y" }, blog)).toEqual(expect.arrayContaining(["protocol", "developers", "mainnet"]));
    expect(tagItem({ title: "Pubnet validator maintenance", url: "https://status.stellar.org/i/1" }, src("st", { kind: "status", tags: ["network-status"] }))).toEqual(expect.arrayContaining(["network-status", "protocol"]));
    expect(tagItem({ title: "A story", url: "https://x.example/1" }, src("plain"))).toEqual(["ecosystem"]);
    const ids = NEWS_TAGS.map((t) => t.id);
    for (const t of tagItem({ title: "Mainnet SDK protocol 30 CAP-0084", url: "https://x.example" }, blog)) expect(ids).toContain(t);
  });
  it("parses the Stellar status summary into one line (and rejects junk)", () => {
    const ok = parseStatusSummary({ page: { updated_at: "2026-10-19T00:34:23.716Z" }, status: { indicator: "none", description: "All Systems Operational" }, components: [{ name: "Horizon", status: "operational" }], incidents: [] });
    expect(ok).toMatchObject({ indicator: "none", description: "All Systems Operational", updatedAt: "2026-10-19T00:34:23.716Z", issues: [], degraded: [] });
    const bad = parseStatusSummary({ status: { indicator: "major", description: "Partial <b>Outage</b>" }, components: [{ name: "Stellar RPC", status: "partial_outage" }, { name: "Dashboard", status: "operational" }], incidents: [{ name: "RPC ingestion issues" }] });
    expect(bad).toMatchObject({ indicator: "major", description: "Partial Outage", issues: ["RPC ingestion issues"], degraded: ["Stellar RPC"] });
    expect(parseStatusSummary({ status: { indicator: "weird", description: "x" } })).toBeNull();
    expect(parseStatusSummary("nope")).toBeNull();
  });
});

describe("news: pipeline script", () => {
  const sources = [src("sdf"), src("gen", { filter: true })];
  const feeds: Record<string, string> = {
    "https://sdf.example/rss": RSS,
    "https://gen.example/rss": `<rss><channel><item><title>XLM jumps</title><link>https://gen.example/x</link><pubDate>Tue, 29 Sep 2026 12:00:00 GMT</pubDate></item><item><title>ETH news</title><link>https://gen.example/e</link><pubDate>Tue, 29 Sep 2026 12:00:00 GMT</pubDate></item></channel></rss>`,
  };
  const STATUS_URL = "https://status.example/summary.json";
  const STATUS = JSON.stringify({ page: { updated_at: "2026-09-29T18:00:00Z" }, status: { indicator: "none", description: "All Systems Operational" } });
  const route = (over: Record<string, Response | Error> = {}) =>
    vi.fn(async (u: string) => {
      const o = over[u];
      if (o instanceof Error) throw o;
      if (o) return o;
      if (u === STATUS_URL) return new Response(STATUS);
      return new Response(feeds[u], { status: 200 });
    });
  it("fetches, filters, tags and merges every source, plus the network status", async () => {
    const f = route();
    const snap = await buildNewsSnapshot({ fetchImpl: f, sources, now: NOW, statusUrl: STATUS_URL, retries: 0 });
    expect(f).toHaveBeenCalledTimes(3);
    expect(snap.items.map((i: { title: string }) => i.title)).toContain("XLM jumps");
    expect(snap.items.map((i: { title: string }) => i.title)).not.toContain("ETH news");
    expect(snap.items.every((i: { tags: string[] }) => i.tags.length > 0)).toBe(true);
    expect(snap.sources.map((s: { id: string; ok: boolean }) => [s.id, s.ok])).toEqual([["sdf", true], ["gen", true]]);
    expect(snap).toMatchObject({ version: 2, generatedAt: new Date(NOW).toISOString(), networkStatus: { indicator: "none", description: "All Systems Operational" } });
  });
  it("keeps a failed source's previous items and a failed status API's previous status line", async () => {
    const prev = { generatedAt: "2026-09-29T10:00:00Z", networkStatus: { indicator: "minor", description: "Degraded", updatedAt: null, url: "https://status.stellar.org", issues: [], degraded: [] }, items: [{ id: "old1", title: "Earlier XLM story", url: "https://gen.example/old", publishedAt: "2026-09-28T10:00:00Z", excerpt: "", image: null, source: "gen", sourceName: "GEN", tags: ["ecosystem"] }] };
    const f = route({ "https://gen.example/rss": new Response("down", { status: 503 }), [STATUS_URL]: new Response("x", { status: 500 }) });
    const snap = await buildNewsSnapshot({ prev, fetchImpl: f, sources, now: NOW, statusUrl: STATUS_URL, retries: 0 });
    expect(snap.sources.find((s: { id: string }) => s.id === "gen")).toMatchObject({ ok: false, error: "HTTP 503", count: 1 });
    expect(snap.items.some((i: { title: string }) => i.title === "Earlier XLM story")).toBe(true);
    expect(snap.networkStatus.description).toBe("Degraded");
  });
  it("retries a flaky feed once before giving up", async () => {
    let n = 0;
    const f = vi.fn(async (u: string) => {
      if (u === "https://sdf.example/rss" && n++ === 0) throw new TypeError("fetch failed");
      return u === STATUS_URL ? new Response(STATUS) : new Response(feeds[u]);
    });
    const snap = await buildNewsSnapshot({ fetchImpl: f, sources, now: NOW, statusUrl: STATUS_URL, retries: 1, retryDelayMs: 1 });
    expect(snap.sources[0].ok).toBe(true);
  });
  it("an empty or non-feed response counts as a failure (never wipes the previous items)", async () => {
    const f = route({ "https://sdf.example/rss": new Response("<html>maintenance</html>") });
    const snap = await buildNewsSnapshot({ fetchImpl: f, sources, now: NOW, statusUrl: STATUS_URL, retries: 0 });
    expect(snap.sources[0]).toMatchObject({ ok: false, error: "no items in feed" });
  });
  it("change detection ignores run timestamps, only content changes count", async () => {
    const a = await buildNewsSnapshot({ fetchImpl: route(), sources, now: NOW, statusUrl: STATUS_URL, retries: 0 });
    const b = await buildNewsSnapshot({ fetchImpl: route(), sources, now: NOW + 600_000, statusUrl: STATUS_URL, retries: 0 });
    expect(b.generatedAt).not.toBe(a.generatedAt);
    expect(hasChanged(a, b)).toBe(false);
    const c = { ...b, items: b.items.slice(1) };
    expect(hasChanged(a, c)).toBe(true);
    expect(hasChanged(a, { ...b, networkStatus: { ...b.networkStatus, indicator: "major", description: "Outage" } })).toBe(true);
    expect(contentKey(null)).toBe("");
  });
  it("the committed news.json is valid, sanitized, tagged, newest first and free of off-message items", () => {
    const j = JSON.parse(readFileSync(new URL("../public/data/news.json", import.meta.url), "utf8"));
    const s = parseNewsSnapshot(j)!;
    expect(j.version).toBe(2);
    expect(s.items.length).toBe(j.items.length);
    expect(s.items.length).toBeGreaterThan(10);
    expect(s.items.length).toBeLessThanOrEqual(100);
    const ts = s.items.map((i) => Date.parse(i.publishedAt));
    expect([...ts].sort((x, y) => y - x)).toEqual(ts);
    expect(new Set(s.items.map((i) => i.url)).size).toBe(s.items.length);
    for (const i of s.items) {
      expect(i.url).toMatch(/^https?:\/\//);
      expect(i.title).not.toMatch(/[<>]/);
      expect(i.excerpt.length).toBeLessThanOrEqual(EXCERPT_MAX);
      expect(i.tags.length).toBeGreaterThan(0);
      expect(isHype(i)).toBe(false);
    }
    expect(j.sources.map((x: { id: string }) => x.id)).toEqual(NEWS_SOURCES.map((x) => x.id));
    expect(j.networkStatus.description).toBeTruthy();
    expect(JSON.stringify(j)).not.toMatch(/ghp_|gho_|github_pat_|BEGIN [A-Z ]*PRIVATE KEY|Authorization/i);
  });
});

describe("news: browser loader + fallback", () => {
  const mk = (generatedAt: string, title: string) => ({ version: 2, generatedAt, networkStatus: { indicator: "none", description: "All Systems Operational", updatedAt: null, url: "x", issues: [], degraded: [] }, sources: [{ id: "sdf", name: "SDF", home: "https://stellar.org/blog", kind: "blog" }, { id: "x", name: "X", home: "javascript:x", kind: "blog" }], items: [
    { id: "a", title, url: "https://stellar.org/a", publishedAt: "2026-09-29T09:00:00Z", excerpt: "e", image: null, source: "sdf", sourceName: "SDF", tags: ["protocol"] },
    { id: "b", title: "Second", url: "https://stellar.org/b", publishedAt: "2026-09-29T10:00:00Z", excerpt: "e", image: null, source: "x", sourceName: "X", tags: ["ecosystem", "mainnet"] },
    { id: "c", title: "evil", url: "javascript:alert(1)", publishedAt: "2026-09-29T09:00:00Z", source: "sdf" },
  ] });
  const STATUS = { page: { updated_at: "2026-09-29T19:59:00Z" }, status: { indicator: "minor", description: "Minor Service Outage" }, components: [], incidents: [] };
  const mem = () => {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
  };
  const urls = { liveUrl: "https://raw.example/news.json", bundledUrl: "/data/news.json", statusUrl: "https://status.example/s.json" };
  const respond = (map: Record<string, unknown>) =>
    vi.fn(async (u: string) => {
      if (!(u in map) || map[u] instanceof Error) throw map[u] instanceof Error ? map[u] : new TypeError("Failed to fetch");
      return new Response(JSON.stringify(map[u]), { status: 200 });
    });

  it("prefers the data-branch file when it is newer than the bundled copy, drops unsafe items, shows the live status", async () => {
    const f = respond({ [urls.liveUrl]: mk("2026-09-29T19:30:00Z", "Live story"), [urls.bundledUrl]: mk("2026-09-29T12:00:00Z", "Bundled story"), [urls.statusUrl]: STATUS });
    const s = await loadNews({ fetchImpl: f, ...urls, storage: mem() });
    expect(s).toMatchObject({ status: "ready", origin: "live", updatedAt: "2026-09-29T19:30:00.000Z", statusLive: true });
    expect(s.networkStatus).toMatchObject({ indicator: "minor", description: "Minor Service Outage" });
    expect(s.items.map((i) => i.title)).toEqual(["Second", "Live story"]); // newest first; javascript: link dropped
    expect(s.sources.find((x) => x.id === "x")!.home).toBeNull();
  });
  it("uses the bundled copy when it is newer or the live file is unreachable", async () => {
    const newer = await loadNews({ fetchImpl: respond({ [urls.liveUrl]: mk("2026-09-29T08:00:00Z", "Old live"), [urls.bundledUrl]: mk("2026-09-29T12:00:00Z", "Bundled story") }), ...urls, storage: mem() });
    expect(newer.origin).toBe("site");
    expect(newer.items.map((i) => i.title)).toContain("Bundled story");
    const down = await loadNews({ fetchImpl: respond({ [urls.bundledUrl]: mk("2026-09-29T12:00:00Z", "Bundled story") }), ...urls, storage: mem() });
    expect(down).toMatchObject({ status: "ready", origin: "site", statusLive: false });
    expect(down.networkStatus!.description).toBe("All Systems Operational"); // status from the JSON when the live status call fails
  });
  it("falls back to this browser's last good copy when every fetch fails, and errors only when there is nothing", async () => {
    const storage = mem();
    await loadNews({ fetchImpl: respond({ [urls.liveUrl]: mk("2026-09-29T19:30:00Z", "Live story") }), ...urls, storage });
    expect(storage.getItem(NEWS_CACHE_KEY)).toContain("Live story");
    const offline = await loadNews({ fetchImpl: respond({}), ...urls, storage });
    expect(offline).toMatchObject({ status: "ready", origin: "cached" });
    expect(offline.items.map((i) => i.title)).toContain("Live story");
    const nothing = await loadNews({ fetchImpl: vi.fn(async () => new Response("nope", { status: 404 })), ...urls, storage: mem() });
    expect(nothing).toMatchObject({ status: "error", items: [] });
    expect(parseNewsSnapshot({ items: "x" })).toBeNull();
    storage.setItem(NEWS_CACHE_KEY, "{not json");
    expect((await loadNews({ fetchImpl: respond({}), ...urls, storage })).status).toBe("error");
  });
  it("ignores a corrupt data-branch file and keeps the bundled one", async () => {
    const f = respond({ [urls.liveUrl]: { generatedAt: "nope", items: [] }, [urls.bundledUrl]: mk("2026-09-29T12:00:00Z", "Bundled story") });
    expect((await loadNews({ fetchImpl: f, ...urls, storage: mem() })).origin).toBe("site");
  });
});

describe("news: UI helpers", () => {
  const items = [
    { id: "1", title: "a", url: "https://x.example/1", publishedAt: "2026-09-29T10:00:00Z", excerpt: "", image: null, source: "s", sourceName: "S", tags: ["protocol", "developers"] },
    { id: "2", title: "b", url: "https://x.example/2", publishedAt: "2026-09-28T10:00:00Z", excerpt: "", image: null, source: "s", sourceName: "S", tags: ["ecosystem"] },
  ] as Parameters<typeof tagCounts>[0];
  it("filters by category and counts chips (empty categories hidden, order fixed)", () => {
    expect(filterByTag(items, "all")).toHaveLength(2);
    expect(filterByTag(items, "developers").map((i) => i.title)).toEqual(["a"]);
    expect(filterByTag(items, "mainnet")).toEqual([]);
    expect(tagCounts(items).map((c) => [c.id, c.count])).toEqual([["protocol", 1], ["developers", 1], ["ecosystem", 1]]);
  });
  it("home strip caps GitHub release notes so announcements stay visible", () => {
    const mk = (id: string, kind: string) => ({ id, title: id, url: `https://x.example/${id}`, publishedAt: "2026-09-29T10:00:00Z", excerpt: "", image: null, source: "s", sourceName: "S", kind, tags: ["ecosystem"] });
    const list = [mk("r1", "release"), mk("r2", "release"), mk("r3", "release"), mk("b1", "blog"), mk("b2", "blog"), mk("b3", "blog"), mk("b4", "blog"), mk("b5", "blog")] as Parameters<typeof pickStrip>[0];
    expect(pickStrip(list).map((i) => i.id)).toEqual(["r1", "r2", "b1", "b2", "b3", "b4"]);
    expect(pickStrip(list, 6, 6).map((i) => i.id)).toEqual(["r1", "r2", "r3", "b1", "b2", "b3"]);
  });
  it("formats times in the viewer's local zone", () => {
    const iso = "2026-09-29T19:05:00Z";
    expect(localTime(iso)).toBe(new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }));
    expect(localTime(iso, true)).toMatch(/[A-Z]{2,5}|GMT|UTC/);
    expect(localTime(null)).toBe("—");
    expect(itemTime("2025-10-31T20:29:00Z", NOW)).toMatch(/2025/);
    expect(itemTime(iso, NOW)).not.toMatch(/2026/);
  });
});

describe("news: workflow wiring", () => {
  const wf = readFileSync(new URL("../../.github/workflows/news.yml", import.meta.url), "utf8");
  const pages = readFileSync(new URL("../../.github/workflows/pages.yml", import.meta.url), "utf8");
  it("runs every 3 hours and on demand, commits only on change with [skip ci], and never references secrets", () => {
    expect(wf).toMatch(/cron:\s*"\d+ \*\/3 \* \* \*"/);
    expect(wf).toContain("workflow_dispatch");
    expect(wf).toContain("[skip ci]");
    expect(wf).toContain("git diff --cached --quiet");
    expect(wf).not.toMatch(/secrets\.(?!GITHUB_TOKEN)/);
  });
  it("the Pages build picks the data branch up", () => {
    expect(pages).toContain("news-data");
    expect(pages).toContain("data/news.json");
  });
});
