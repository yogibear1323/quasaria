/**
 * Stellar news: feed parsing, sanitizing, filtering and de-duplication.
 *
 * Plain dependency-free ESM so the SAME code runs in the build-time script
 * (scripts/fetch-news-snapshot.mjs, Node 22) and in the browser (src/lib/news.ts).
 * Types: newsCore.d.mts.
 *
 * Output is always PLAIN TEXT (tags stripped, entities decoded, control chars
 * removed) plus http(s)-only URLs. Only the headline, source, date, a short
 * excerpt (<= EXCERPT_MAX chars, taken from the feed's own summary) and an
 * optional thumbnail are kept: full articles are never stored or republished.
 */

/**
 * Feeds. Every URL below was probed on 2026-10-18 (HTTP 200, valid RSS/Atom, fresh items). None sends
 * Access-Control-Allow-Origin for github.io (except the status API, read live in the browser), so the
 * scheduled "Stellar news" workflow (scripts/fetch-news-snapshot.mjs) fetches them and commits news.json.
 *
 *  kind "blog"    editorial posts (RSS)             kind "release"  GitHub release notes (Atom)
 *  kind "status"  Stellar status incidents (Atom)   kind "outlet"   third-party crypto press (RSS)
 *  filter: true   keep only items that are about Stellar / XLM / Soroban
 *  tags           category tags every item of the source gets (more are added from keywords)
 *  maxAgeDays / maxItems  per-source freshness window and cap, so busy sources can't flood the list
 *
 * Sources that were probed and DROPPED (see docs/news-pipeline.md): developers.stellar.org blog feed (404),
 * stellar-protocol releases (no releases published), soroban-examples (last release 2025), the Stellar
 * Community Fund site (no feed; SCF recaps come through the Stellar Community Medium feed), X/Twitter via
 * Nitter (410 Gone, no public RSS), r/Stellar (user posts, price chatter, blocks CI IPs).
 */
export const NEWS_SOURCES = [
  { id: "sdf", name: "Stellar Development Foundation", home: "https://stellar.org/blog", feed: "https://stellar.org/blog/rss.xml", kind: "blog", filter: false, tags: [], maxAgeDays: 365, maxItems: 20 },
  { id: "sdf-dev", name: "Stellar Developers blog", home: "https://stellar.org/blog/developers", feed: "https://stellar.org/blog/developers/rss.xml", kind: "blog", filter: false, tags: ["developers"], maxAgeDays: 365, maxItems: 20 },
  { id: "stellar-core", name: "stellar-core releases", label: "Stellar Core", home: "https://github.com/stellar/stellar-core/releases", feed: "https://github.com/stellar/stellar-core/releases.atom", kind: "release", filter: false, tags: ["protocol"], maxAgeDays: 150, maxItems: 5 },
  { id: "stellar-horizon", name: "Horizon releases", label: "Horizon", home: "https://github.com/stellar/stellar-horizon/releases", feed: "https://github.com/stellar/stellar-horizon/releases.atom", kind: "release", filter: false, tags: ["protocol"], maxAgeDays: 150, maxItems: 4 },
  { id: "stellar-rpc", name: "Stellar RPC releases", label: "Stellar RPC", home: "https://github.com/stellar/stellar-rpc/releases", feed: "https://github.com/stellar/stellar-rpc/releases.atom", kind: "release", filter: false, tags: ["protocol", "developers"], maxAgeDays: 150, maxItems: 4 },
  { id: "soroban-sdk", name: "Soroban Rust SDK releases", label: "Soroban Rust SDK", home: "https://github.com/stellar/rs-soroban-sdk/releases", feed: "https://github.com/stellar/rs-soroban-sdk/releases.atom", kind: "release", filter: false, tags: ["developers"], maxAgeDays: 120, maxItems: 4 },
  { id: "js-stellar-sdk", name: "JavaScript Stellar SDK releases", label: "JS Stellar SDK", home: "https://github.com/stellar/js-stellar-sdk/releases", feed: "https://github.com/stellar/js-stellar-sdk/releases.atom", kind: "release", filter: false, tags: ["developers"], maxAgeDays: 120, maxItems: 4 },
  { id: "stellar-cli", name: "Stellar CLI releases", label: "Stellar CLI", home: "https://github.com/stellar/stellar-cli/releases", feed: "https://github.com/stellar/stellar-cli/releases.atom", kind: "release", filter: false, tags: ["developers"], maxAgeDays: 120, maxItems: 3 },
  { id: "stellar-status", name: "Stellar Status", home: "https://status.stellar.org", feed: "https://status.stellar.org/history.atom", kind: "status", filter: false, tags: ["network-status"], maxAgeDays: 180, maxItems: 8 },
  { id: "stellar-community", name: "Stellar Community (Medium)", home: "https://medium.com/stellar-community", feed: "https://medium.com/feed/stellar-community", kind: "blog", filter: false, tags: ["ecosystem"], maxAgeDays: 365, maxItems: 12 },
  { id: "cointelegraph", name: "Cointelegraph", home: "https://cointelegraph.com/tags/stellar", feed: "https://cointelegraph.com/rss/tag/stellar", kind: "outlet", filter: true, tags: ["ecosystem"], maxAgeDays: 120, maxItems: 8 },
  { id: "coindesk", name: "CoinDesk", home: "https://www.coindesk.com", feed: "https://www.coindesk.com/arc/outboundfeeds/rss/", kind: "outlet", filter: true, tags: ["ecosystem"], maxAgeDays: 120, maxItems: 5 },
  { id: "decrypt", name: "Decrypt", home: "https://decrypt.co", feed: "https://decrypt.co/feed", kind: "outlet", filter: true, tags: ["ecosystem"], maxAgeDays: 120, maxItems: 5 },
];

/** Where the live status line comes from (Atlassian Statuspage JSON; sends CORS *). */
export const STATUS_SUMMARY_URL = "https://status.stellar.org/api/v2/summary.json";
export const STATUS_PAGE_URL = "https://status.stellar.org";

/** Category tags (chip order). */
export const NEWS_TAGS = [
  { id: "protocol", label: "Protocol" },
  { id: "developers", label: "Developers" },
  { id: "ecosystem", label: "Ecosystem" },
  { id: "mainnet", label: "Mainnet events" },
  { id: "network-status", label: "Network status" },
];
const TAG_IDS = new Set(NEWS_TAGS.map((t) => t.id));
const KINDS = new Set(["blog", "release", "status", "outlet"]);

export const EXCERPT_MAX = 200;
export const TITLE_MAX = 180;
export const MAX_PER_SOURCE = 20;
export const MAX_ITEMS = 100;
/** Items older than this are dropped (a source can set a shorter window). */
export const MAX_AGE_DAYS = 365;

// ---------------------------------------------------------------- text
const NAMED = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", hellip: "…", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", laquo: "«", raquo: "»", bull: "•", middot: "·", copy: "©", reg: "®", trade: "™", euro: "€", pound: "£", yen: "¥", cent: "¢", deg: "°", times: "×", eacute: "é", egrave: "è", aacute: "á", agrave: "à", oacute: "ó", uacute: "ú", iacute: "í", ntilde: "ñ", ouml: "ö", uuml: "ü", auml: "ä", ccedil: "ç", szlig: "ß" };

/** Decode one level of HTML/XML character references. Unknown named entities are left as-is. */
export function decodeEntities(s) {
  return String(s ?? "").replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z][a-z0-9]{1,31});/gi, (m, e) => {
    if (e[0] === "#") {
      const cp = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      if (!Number.isFinite(cp) || cp <= 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return "";
      return String.fromCodePoint(cp);
    }
    const v = NAMED[e.toLowerCase()];
    return v === undefined ? m : v;
  });
}

const unCdata = (s) => String(s ?? "").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");

/**
 * Feed field (raw XML text or HTML) → plain text: unwrap CDATA, decode XML entities,
 * drop script/style/comments, strip every tag, decode HTML entities (feeds often
 * double-encode), remove control characters and collapse whitespace.
 */
export function toPlainText(raw) {
  let s = unCdata(raw);
  s = decodeEntities(s);
  s = s.replace(/<!--[\s\S]*?-->/g, " ").replace(/<(script|style|iframe|noscript|svg|object)\b[\s\S]*?<\/\1\s*>/gi, " ");
  s = s.replace(/<\/?(p|div|br|li|h[1-6]|figure|figcaption|blockquote|tr)\b[^>]*>/gi, " ");
  s = s.replace(/<[^>]*>/g, "").replace(/<[^>]*$/, "");
  s = decodeEntities(s);
  // eslint-disable-next-line no-control-regex
  s = s.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, " ");
  return s.replace(/\s+/g, " ").trim();
}

/** Shorten plain text to `max` chars at a word boundary, with an ellipsis. */
export function truncate(s, max) {
  const t = String(s ?? "").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const sp = cut.lastIndexOf(" ");
  return `${(sp > max * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s,;:.–—-]+$/, "")}…`;
}

/** Only absolute http(s) URLs survive (no javascript:, data:, relative or credentialed URLs). Drops utm_* and Medium's source=rss… tracking params. */
export function safeUrl(raw, base) {
  const s = toPlainText(raw);
  if (!s) return null;
  let u;
  try {
    u = base ? new URL(s, base) : new URL(s);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  if (u.username || u.password) return null;
  for (const [k, v] of [...u.searchParams.entries()]) if (/^utm_/i.test(k) || (k === "source" && /^rss/i.test(v))) u.searchParams.delete(k);
  return u.href;
}

// ---------------------------------------------------------------- XML (tolerant, regex based: no DOM in Node)
const esc = (n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function tagText(block, names) {
  for (const n of names) {
    const m = new RegExp(`<${esc(n)}(?:\\s[^>]*)?>([\\s\\S]*?)</${esc(n)}\\s*>`, "i").exec(block);
    if (m && m[1].trim()) return m[1];
  }
  return "";
}
function attr(tag, name) {
  const m = new RegExp(`\\s${esc(name)}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i").exec(tag);
  return m ? decodeEntities(m[2] ?? m[3] ?? "") : "";
}
function tags(block, name) {
  return block.match(new RegExp(`<${esc(name)}\\b[^>]*>`, "gi")) ?? [];
}

function itemLink(block, base) {
  // Atom: <link rel="alternate" href="..."/> (rel defaults to alternate)
  for (const t of tags(block, "link")) {
    const href = attr(t, "href");
    const rel = attr(t, "rel") || "alternate";
    if (href && rel === "alternate") return safeUrl(href, base);
  }
  const text = tagText(block, ["link"]);
  if (text) return safeUrl(text, base);
  const g = /<guid\b([^>]*)>([\s\S]*?)<\/guid>/i.exec(block);
  if (g && !/isPermaLink\s*=\s*["']false/i.test(g[1])) return safeUrl(g[2], base);
  return null;
}

function itemImage(block, base) {
  const candidates = [];
  for (const t of tags(block, "media:thumbnail")) candidates.push(attr(t, "url"));
  for (const t of tags(block, "media:content")) {
    const type = attr(t, "type"), medium = attr(t, "medium");
    if (medium === "image" || /^image\//i.test(type)) candidates.push(attr(t, "url"));
  }
  for (const t of tags(block, "enclosure")) if (/^image\//i.test(attr(t, "type"))) candidates.push(attr(t, "url"));
  const html = decodeEntities(unCdata(tagText(block, ["description", "summary", "content:encoded", "content"])));
  for (const img of (html.match(/<img\b[^>]*>/gi) ?? []).slice(0, 5)) candidates.push(attr(img, "src"));
  for (const c of candidates) {
    const u = c && safeUrl(c, base);
    if (u && u.startsWith("https://")) return u; // https only for images (no mixed content)
  }
  return null;
}

function parseDate(s) {
  const t = Date.parse(toPlainText(s));
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

/**
 * Parse an RSS 2.0 / RSS 1.0 / Atom document into raw items (plain text, safe URLs).
 * Never throws; returns [] for anything that isn't a feed.
 */
export function parseFeed(xml, source) {
  const doc = String(xml ?? "");
  const base = source?.home || undefined;
  const blocks = doc.match(/<item\b[\s\S]*?<\/item>/gi) ?? doc.match(/<entry\b[\s\S]*?<\/entry>/gi) ?? [];
  const out = [];
  for (const b of blocks) {
    const title = truncate(toPlainText(tagText(b, ["title"])), TITLE_MAX);
    const url = itemLink(b, base);
    const publishedAt = parseDate(tagText(b, ["pubDate", "published", "dc:date", "updated", "atom:updated"]));
    if (!title || !url) continue;
    const summary = toPlainText(tagText(b, ["description", "summary", "media:description", "dc:description"])) || toPlainText(tagText(b, ["content:encoded", "content"]));
    const categories = (b.match(/<(?:category|dc:subject)\b[^>]*>[\s\S]*?<\/(?:category|dc:subject)>/gi) ?? []).map((c) => toPlainText(c)).filter(Boolean);
    for (const t of tags(b, "category")) {
      const term = attr(t, "term");
      if (term) categories.push(toPlainText(term));
    }
    out.push({
      title,
      url,
      publishedAt,
      excerpt: truncate(summary, EXCERPT_MAX),
      image: itemImage(b, base),
      categories,
      source: source?.id ?? "unknown",
      sourceName: source?.name ?? "Unknown",
    });
  }
  return out;
}

// ---------------------------------------------------------------- filtering
/** Adjective uses of "stellar" ("a stellar quarter") are not about the network. */
const ADJECTIVE_NEXT = /^(?:quarter|year|month|week|day|run|performance|results?|rally|gains?|returns?|debut|growth|earnings|start|season|showing|numbers|reviews?|record|jobs?|report|figures)\b/i;
const STRONG = /\b(?:XLM|Soroban|Stellar\s+Lumens?|Stellar\s+Development\s+Foundation|Stellar\s+Community\s+Fund)\b/i;

/** Is this item about Stellar / XLM / Soroban? Used for general crypto feeds. */
export function isStellarRelated(item) {
  const cats = (item.categories ?? []).join(" | ");
  if (/\b(?:stellar|xlm|soroban)\b/i.test(cats)) return true;
  const text = `${item.title ?? ""} . ${item.excerpt ?? ""}`;
  if (STRONG.test(text)) return true;
  // Capitalised "Stellar" (the network), not followed by an adjective-use noun.
  const re = /\bStellar\b(?:['’]s)?\s*([A-Za-z-]*)/g;
  let m;
  while ((m = re.exec(text))) {
    if (!ADJECTIVE_NEXT.test(m[1] ?? "")) return true;
  }
  return false;
}

/**
 * Off-message items we never publish, whatever the source: leverage / futures-trading promotion,
 * "moon" hype and price-prediction clickbait. Deliberately narrow ("leverage" alone is a normal verb).
 */
const HYPE = [
  /\bperps?\b/i,
  /\bperpetual(?:s)?\b/i,
  /\bleverag(?:e|ed|ing)[- ](?:trad\w*|position\w*|long|short|up to)\b/i,
  /\b\d{1,3}\s?x\s+leverage\b/i,
  /\bmargin[- ]trad\w*\b/i,
  /\bfutures?\s+(?:trad\w*|contracts?|market|exchange)\b/i,
  /\b(?:long|short)[- ]?(?:squeeze|liquidations?)\b/i,
  /\bliquidations?\b.*\b(?:longs?|shorts?)\b/i,
  /\bprice\s+(?:prediction|forecast|target|analysis)s?\b/i,
  /\b(?:to the moon|moon(?:ing|shot)|pump(?:ing)?\s+(?:and|&)\s+dump|100x|1000x|get rich|guaranteed (?:returns?|profits?)|trading signals?|airdrop alert)\b/i,
  /\bwill (?:XLM|Stellar)\b.*\b(?:hit|reach|surge|explode|soar|crash)\b/i,
  /\bXLM\b.*\b(?:vs\.?|versus)\b.*\b(?:XRP|SOL|ADA)\b/i,
];
/** Is this item promotional / speculative noise? */
export function isHype(item) {
  const text = `${item?.title ?? ""} . ${item?.excerpt ?? ""}`;
  return HYPE.some((re) => re.test(text));
}

/** GitHub tags like v29.0.0-rc.1, 28.0.0-internal, archive-node-beta are not announcements. */
export function isPrerelease(item) {
  const tag = decodeURIComponent(String(item?.url ?? "").split("/tag/")[1] ?? "");
  const t = `${tag} ${item?.title ?? ""}`;
  return /(?:^|[-_.\s])(?:rc|alpha|beta|preview|pre|internal|nightly|snapshot|dev)(?:[-_.\d\s]|$)/i.test(t);
}

/** "v30.0.0" → "Stellar Core v30.0.0 released" (release sources only). */
export function releaseTitle(rawTitle, label) {
  const t = String(rawTitle ?? "").trim();
  if (!label) return t;
  const ver = t.replace(new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*`, "i"), "").replace(/^V(?=\d)/, "v");
  const v = /^\d/.test(ver) ? `v${ver}` : ver;
  return `${label} ${v} released`;
}

/** Strip the generic heading GitHub release bodies start with. */
export function releaseSummary(text) {
  return String(text ?? "")
    .replace(/^(?:#+\s*)?(?:what(?:['’]s| is)?\s+changed|release\s+notes|changelog|stellar[- ]cli\s+v?[\d.]+\s*[—-]\s*release notes)\s*/i, "")
    .replace(/^(?:fixed|added|changed|security|removed|deprecated|features|bug fixes|stability improvements|highlights)\s+(?=[A-Z])/, "")
    .replace(/\s+/g, " ")
    .trim();
}

const MAINNET_RE = /\bmainnet\b|\b(?:now|is|are|goes?|went) live on stellar\b|\bupgrade vote\b|\bvalidators? (?:vote|voted)\b|\bprotocol\s*\d{2}\b.*\b(?:upgrade|vote|activat\w+|go(?:es)? live)\b|\bnetwork upgrade\b/i;
const PROTOCOL_RE = /\bprotocol\s*\d{2}\b|\bCAP-\d{3,4}\b|\bSEP-\d{2,4}\b|\bstellar[- ]core\b|\bconsensus\b|\bvalidators?\b|\bnetwork upgrade\b|\bhorizon\b|\bsoroban (?:host|env)\b/i;
const DEV_RE = /\b(?:SDK|CLI|API|RPC|smart contracts?|developer preview|dev tools?|Soroban)\b/i;

/** Category tags for one item: the source's own tags plus keyword- and URL-derived ones. Always >= 1. */
export function tagItem(item, source) {
  const tags = new Set(source?.tags ?? []);
  const text = `${item.title ?? ""} . ${item.excerpt ?? ""}`;
  const path = (() => {
    try {
      return new URL(item.url).pathname;
    } catch {
      return "";
    }
  })();
  if (/\/blog\/developers\//.test(path)) tags.add("developers");
  if (/\/blog\/(?:ecosystem|foundation-news|case-studies|community)\//.test(path)) tags.add("ecosystem");
  if (source?.kind === "status") tags.add("network-status");
  if (source?.kind !== "release") {
    if (PROTOCOL_RE.test(text)) tags.add("protocol");
    if (source?.kind === "blog" && DEV_RE.test(item.title ?? "")) tags.add("developers");
  }
  if (source?.kind === "release" && /\bprotocol\s*\d{2}\b/i.test(text)) tags.add("protocol");
  if (MAINNET_RE.test(text)) tags.add("mainnet");
  if (!tags.size) tags.add("ecosystem");
  return NEWS_TAGS.map((t) => t.id).filter((id) => tags.has(id));
}

// ---------------------------------------------------------------- merge
const normTitle = (t) => String(t).toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, " ").trim();
function normUrl(u) {
  try {
    const x = new URL(u);
    return `${x.hostname.replace(/^www\./, "")}${x.pathname.replace(/\/+$/, "")}`.toLowerCase();
  } catch {
    return String(u);
  }
}
const hash = (s) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
};

/** Validate + re-sanitize one stored item (defence in depth for anything read from JSON). */
export function sanitizeItem(x) {
  if (!x || typeof x !== "object") return null;
  const url = safeUrl(x.url);
  const title = truncate(toPlainText(x.title), TITLE_MAX);
  const t = Date.parse(x.publishedAt);
  if (!url || !title || !Number.isFinite(t)) return null;
  const img = x.image ? safeUrl(x.image) : null;
  return {
    id: typeof x.id === "string" && /^[a-z0-9-]{1,40}$/.test(x.id) ? x.id : hash(normUrl(url)),
    title,
    url,
    publishedAt: new Date(t).toISOString(),
    excerpt: truncate(toPlainText(x.excerpt), EXCERPT_MAX),
    image: img && img.startsWith("https://") ? img : null,
    source: toPlainText(x.source).slice(0, 40) || "unknown",
    sourceName: toPlainText(x.sourceName).slice(0, 60) || "Unknown",
    kind: KINDS.has(x.kind) ? x.kind : "blog",
    tags: (Array.isArray(x.tags) ? x.tags : []).map((t) => String(t)).filter((t) => TAG_IDS.has(t)).filter((t, i, a) => a.indexOf(t) === i),
  };
}

/**
 * Raw items from several feeds → the news list. Per source: Stellar filter (general feeds), hype filter,
 * pre-releases dropped, release titles/summaries normalised, undated / too old (per-source window) /
 * future-dated items dropped, capped per source. Across sources: de-duped by URL and by headline
 * (first source in NEWS_SOURCES order wins), tagged, sorted newest first, capped at maxItems.
 */
export function mergeNews(itemsBySource, { sources = NEWS_SOURCES, now = Date.now(), maxItems = MAX_ITEMS, maxPerSource = MAX_PER_SOURCE, maxAgeDays = MAX_AGE_DAYS } = {}) {
  const seenUrl = new Set();
  const seenTitle = new Set();
  const out = [];
  const ids = [...new Set([...sources.map((s) => s.id), ...Object.keys(itemsBySource)])];
  for (const id of ids) {
    const src = sources.find((s) => s.id === id);
    const cap = Math.min(src?.maxItems ?? maxPerSource, maxPerSource);
    const ageDays = Math.min(src?.maxAgeDays ?? maxAgeDays, maxAgeDays);
    let n = 0;
    const list = [...(itemsBySource[id] ?? [])].sort((a, b) => Date.parse(b.publishedAt ?? "") - Date.parse(a.publishedAt ?? ""));
    for (const raw of list) {
      if (n >= cap) break;
      const isRelease = src?.kind === "release";
      if (isRelease && isPrerelease(raw)) continue;
      let r = raw;
      if (isRelease) r = { ...raw, title: releaseTitle(raw.title, src.label), excerpt: truncate(releaseSummary(raw.excerpt), EXCERPT_MAX) };
      if (src?.filter && !isStellarRelated(r)) continue;
      // Hype in the headline: always dropped. Hype only in the blurb: third-party outlets are dropped, but an
      // official post (SDF blog, releases, status) keeps its headline and loses the blurb, so a real network
      // event (e.g. "Chainlink is now live on Stellar") isn't lost over one word in its summary.
      if (isHype({ title: r.title })) continue;
      if (isHype({ excerpt: r.excerpt })) {
        if (src?.kind === "outlet" || !src) continue;
        r = { ...r, excerpt: "" };
      }
      if (src?.kind === "release" || src?.kind === "status") r = { ...r, image: null };
      const it = sanitizeItem({ ...r, id: undefined, source: raw.source ?? id, sourceName: raw.sourceName ?? src?.name, kind: src?.kind, tags: tagItem(r, src) });
      if (!it) continue;
      const t = Date.parse(it.publishedAt);
      if (t > now + 3600_000 || t < now - ageDays * 86_400_000) continue;
      const ku = normUrl(it.url), kt = normTitle(it.title);
      if (seenUrl.has(ku) || seenTitle.has(kt)) continue;
      seenUrl.add(ku);
      seenTitle.add(kt);
      out.push(it);
      n++;
    }
  }
  return out.sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt) || a.id.localeCompare(b.id)).slice(0, maxItems);
}

/** Atlassian Statuspage summary.json → the one-line network status (or null when it isn't a valid summary). */
export function parseStatusSummary(j) {
  const ind = String(j?.status?.indicator ?? "");
  const desc = toPlainText(j?.status?.description);
  if (!["none", "minor", "major", "critical", "maintenance"].includes(ind) || !desc) return null;
  const upd = Date.parse(j?.page?.updated_at);
  const issues = [
    ...(Array.isArray(j?.incidents) ? j.incidents : []),
    ...(Array.isArray(j?.scheduled_maintenances) ? j.scheduled_maintenances.filter((m) => m?.status === "in_progress") : []),
  ]
    .map((i) => truncate(toPlainText(i?.name), 90))
    .filter(Boolean)
    .slice(0, 3);
  const bad = (Array.isArray(j?.components) ? j.components : [])
    .filter((c) => c && c.group !== true && c.status && c.status !== "operational")
    .map((c) => truncate(toPlainText(c.name), 60))
    .slice(0, 5);
  return { indicator: ind, description: truncate(desc, 80), updatedAt: Number.isFinite(upd) ? new Date(upd).toISOString() : null, url: "https://status.stellar.org", issues, degraded: bad };
}

/** "just now", "5m ago", "2h ago", "3d ago", else a short date. */
export function relativeTime(iso, now = Date.now()) {
  const t = typeof iso === "number" ? iso : Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const s = Math.round((now - t) / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
