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

/** Feeds. Every URL was checked on 2026-09-29 (HTTP 200, valid RSS). None of them sends
 * Access-Control-Allow-Origin, so browsers on github.io can't read them directly (`cors: false`);
 * they are fetched at build time. `filter: true` = general crypto feed, keep only Stellar items. */
export const NEWS_SOURCES = [
  { id: "sdf", name: "Stellar Development Foundation", home: "https://stellar.org/blog", feed: "https://stellar.org/blog/rss.xml", filter: false, cors: false },
  { id: "stellar-community", name: "Stellar Community (Medium)", home: "https://medium.com/stellar-community", feed: "https://medium.com/feed/stellar-community", filter: false, cors: false },
  { id: "cointelegraph", name: "Cointelegraph", home: "https://cointelegraph.com/tags/stellar", feed: "https://cointelegraph.com/rss/tag/stellar", filter: false, cors: false },
  { id: "coindesk", name: "CoinDesk", home: "https://www.coindesk.com", feed: "https://www.coindesk.com/arc/outboundfeeds/rss/", filter: true, cors: false },
  { id: "decrypt", name: "Decrypt", home: "https://decrypt.co", feed: "https://decrypt.co/feed", filter: true, cors: false },
];

export const EXCERPT_MAX = 200;
export const TITLE_MAX = 180;
export const MAX_PER_SOURCE = 20;
export const MAX_ITEMS = 60;
/** Items older than this are dropped. */
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
  };
}

/**
 * Raw items from several feeds → the news list: Stellar filter for `filter` sources,
 * drop undated / too old / future-dated items, de-dupe by URL and by headline
 * (first source in NEWS_SOURCES order wins), newest first, capped.
 */
export function mergeNews(itemsBySource, { sources = NEWS_SOURCES, now = Date.now(), maxItems = MAX_ITEMS, maxPerSource = MAX_PER_SOURCE, maxAgeDays = MAX_AGE_DAYS } = {}) {
  const seenUrl = new Set();
  const seenTitle = new Set();
  const out = [];
  const ids = [...new Set([...sources.map((s) => s.id), ...Object.keys(itemsBySource)])];
  for (const id of ids) {
    const src = sources.find((s) => s.id === id);
    let n = 0;
    const list = [...(itemsBySource[id] ?? [])].sort((a, b) => Date.parse(b.publishedAt ?? "") - Date.parse(a.publishedAt ?? ""));
    for (const raw of list) {
      if (n >= maxPerSource) break;
      if (src?.filter && !isStellarRelated(raw)) continue;
      const it = sanitizeItem({ ...raw, id: undefined, source: raw.source ?? id, sourceName: raw.sourceName ?? src?.name });
      if (!it) continue;
      const t = Date.parse(it.publishedAt);
      if (t > now + 3600_000 || t < now - maxAgeDays * 86_400_000) continue;
      const ku = normUrl(it.url), kt = normTitle(it.title);
      if (seenUrl.has(ku) || seenTitle.has(kt)) continue;
      seenUrl.add(ku);
      seenTitle.add(kt);
      out.push(it);
      n++;
    }
  }
  return out.sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt)).slice(0, maxItems);
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
