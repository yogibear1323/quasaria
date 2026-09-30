import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { EXCERPT_MAX, NEWS_SOURCES, decodeEntities, isStellarRelated, mergeNews, parseFeed, relativeTime, safeUrl, sanitizeItem, toPlainText, truncate, type NewsSource } from "../src/lib/newsCore.mjs";
import { loadNews, parseNewsSnapshot } from "../src/lib/news";
// @ts-expect-error plain ESM build script, no types
import { buildNewsSnapshot } from "../scripts/fetch-news-snapshot.mjs";

const NOW = Date.parse("2026-09-29T20:00:00Z");
const src = (id: string, extra: Partial<NewsSource> = {}): NewsSource => ({ id, name: id.toUpperCase(), home: `https://${id}.example`, feed: `https://${id}.example/rss`, filter: false, cors: false, ...extra });

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
      gen: [item({ title: "Robinhood adds perps", url: "https://gen.example/1", source: "gen" }), item({ title: "XLM rallies", url: "https://gen.example/2", source: "gen" })],
    }, { sources, now: NOW });
    expect(out.map((i) => i.title)).toEqual(["Newest", "Stellar ships Protocol 28", "XLM rallies"]);
    expect(out[1].source).toBe("sdf");
  });
  it("drops undated, too-old and future items, and caps per source", () => {
    const out = mergeNews({
      sdf: [
        item({ title: "undated", url: "https://a.example/u", publishedAt: null }),
        item({ title: "old", url: "https://a.example/o", publishedAt: "2024-01-01T00:00:00Z" }),
        item({ title: "future", url: "https://a.example/f", publishedAt: "2026-10-05T00:00:00Z" }),
        ...Array.from({ length: 30 }, (_, i) => item({ title: `n${i}`, url: `https://a.example/n${i}` })),
      ],
    }, { sources, now: NOW, maxPerSource: 5 });
    expect(out).toHaveLength(5);
    expect(out.some((i) => ["undated", "old", "future"].includes(i.title))).toBe(false);
  });
  it("sanitizeItem re-sanitizes stored JSON (HTML, bad links, http images)", () => {
    const s = sanitizeItem({ title: "<img src=x onerror=alert(1)>Hi <b>there</b>", url: "https://ok.example/a", publishedAt: "2026-09-29T10:00:00Z", excerpt: "<script>x()</script>" + "y".repeat(400), image: "http://insecure.example/i.png", source: "sdf", sourceName: "<b>SDF</b>" });
    expect(s).toMatchObject({ title: "Hi there", image: null, sourceName: "SDF" });
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

describe("news: build-time snapshot script", () => {
  const sources = [src("sdf"), src("gen", { filter: true })];
  const feeds: Record<string, string> = {
    "https://sdf.example/rss": RSS,
    "https://gen.example/rss": `<rss><channel><item><title>XLM jumps</title><link>https://gen.example/x</link><pubDate>Tue, 29 Sep 2026 12:00:00 GMT</pubDate></item><item><title>ETH news</title><link>https://gen.example/e</link><pubDate>Tue, 29 Sep 2026 12:00:00 GMT</pubDate></item></channel></rss>`,
  };
  it("fetches, filters and merges every source", async () => {
    const f = vi.fn(async (u: string) => new Response(feeds[u], { status: 200 }));
    const snap = await buildNewsSnapshot({ fetchImpl: f, sources, now: NOW });
    expect(f).toHaveBeenCalledTimes(2);
    expect(snap.items.map((i: { title: string }) => i.title)).toContain("XLM jumps");
    expect(snap.items.map((i: { title: string }) => i.title)).not.toContain("ETH news");
    expect(snap.sources.map((s: { id: string; ok: boolean }) => [s.id, s.ok])).toEqual([["sdf", true], ["gen", true]]);
    expect(snap.generatedAt).toBe(new Date(NOW).toISOString());
  });
  it("keeps a failed source's previous items (per source fallback)", async () => {
    const prev = { generatedAt: "2026-09-29T10:00:00Z", sources: [{ id: "gen", fetchedAt: "2026-09-29T10:00:00Z" }], items: [{ id: "old1", title: "Earlier XLM story", url: "https://gen.example/old", publishedAt: "2026-09-28T10:00:00Z", excerpt: "", image: null, source: "gen", sourceName: "GEN" }] };
    const f = vi.fn(async (u: string) => (u.startsWith("https://gen") ? new Response("down", { status: 503 }) : new Response(feeds[u], { status: 200 })));
    const snap = await buildNewsSnapshot({ prev, fetchImpl: f, sources, now: NOW });
    const gen = snap.sources.find((s: { id: string }) => s.id === "gen");
    expect(gen).toMatchObject({ ok: false, error: "HTTP 503", fetchedAt: "2026-09-29T10:00:00Z", count: 1 });
    expect(snap.items.some((i: { title: string }) => i.title === "Earlier XLM story")).toBe(true);
  });
  it("the committed snapshot is valid and sanitized", () => {
    const j = JSON.parse(readFileSync(new URL("../public/data/news-snapshot.json", import.meta.url), "utf8"));
    const s = parseNewsSnapshot(j)!;
    expect(s.items.length).toBe(j.items.length);
    expect(s.items.length).toBeGreaterThan(5);
    for (const i of s.items) {
      expect(i.url).toMatch(/^https?:\/\//);
      expect(i.title).not.toMatch(/[<>]/);
      expect(i.excerpt.length).toBeLessThanOrEqual(EXCERPT_MAX);
    }
    expect(j.sources.map((x: { id: string }) => x.id)).toEqual(NEWS_SOURCES.map((x) => x.id));
  });
});

describe("news: browser loader + fallback", () => {
  const SNAP = { version: 1, generatedAt: "2026-09-29T19:30:00Z", sources: [{ id: "sdf", name: "SDF", home: "https://stellar.org/blog", ok: true }, { id: "live", name: "Live", home: "javascript:x", ok: true }], items: [
    { id: "a", title: "Snapshot story", url: "https://stellar.org/a", publishedAt: "2026-09-29T09:00:00Z", excerpt: "e", image: null, source: "sdf", sourceName: "SDF" },
    { id: "b", title: "Old live-source story", url: "https://live.example/old", publishedAt: "2026-09-28T09:00:00Z", excerpt: "e", image: null, source: "live", sourceName: "Live" },
    { id: "c", title: "evil", url: "javascript:alert(1)", publishedAt: "2026-09-29T09:00:00Z", source: "sdf" },
  ] };
  const LIVE_RSS = `<rss><channel><item><title>Fresh live story</title><link>https://live.example/new</link><pubDate>Tue, 29 Sep 2026 19:50:00 GMT</pubDate></item></channel></rss>`;
  const sources = [src("sdf"), src("live", { cors: true, feed: "https://live.example/rss" })];

  it("uses the snapshot when no source allows CORS (today's setup)", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify(SNAP), { status: 200 }));
    const s = await loadNews({ fetchImpl: f, snapshotUrl: "/data/news-snapshot.json", sources: [src("sdf")], now: NOW });
    expect(f).toHaveBeenCalledTimes(1);
    expect(s).toMatchObject({ status: "ready", mode: "snapshot", updatedAt: "2026-09-29T19:30:00.000Z" });
    expect(s.items.map((i) => i.title)).toEqual(["Snapshot story", "Old live-source story"]); // javascript: link dropped
    expect(s.sources.find((x) => x.id === "live")!.home).toBeNull();
  });
  it("merges a live CORS source over its snapshot items", async () => {
    const f = vi.fn(async (u: string) => (u.includes("live.example") ? new Response(LIVE_RSS) : new Response(JSON.stringify(SNAP))));
    const s = await loadNews({ fetchImpl: f, snapshotUrl: "/snap.json", sources, now: NOW });
    expect(s.mode).toBe("live");
    expect(s.updatedAt).toBe(new Date(NOW).toISOString());
    expect(s.items.map((i) => i.title)).toEqual(["Fresh live story", "Snapshot story"]);
  });
  it("falls back to the snapshot when the live fetch fails (CORS / network)", async () => {
    const f = vi.fn(async (u: string) => {
      if (u.includes("live.example")) throw new TypeError("Failed to fetch");
      return new Response(JSON.stringify(SNAP));
    });
    const s = await loadNews({ fetchImpl: f, snapshotUrl: "/snap.json", sources, now: NOW });
    expect(s.mode).toBe("snapshot");
    expect(s.items).toHaveLength(2);
  });
  it("reports an error when neither live nor the snapshot is available", async () => {
    const f = vi.fn(async () => new Response("nope", { status: 404 }));
    const s = await loadNews({ fetchImpl: f, snapshotUrl: "/snap.json", sources, now: NOW });
    expect(s).toMatchObject({ status: "error", items: [] });
    expect(parseNewsSnapshot({ items: "x" })).toBeNull();
  });
});
