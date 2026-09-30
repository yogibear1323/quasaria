#!/usr/bin/env node
/**
 * Build-time Stellar news snapshot (runs in the GitHub Pages workflow before `vite build`,
 * on every push AND on the workflow's schedule, so the news stays current without commits).
 *
 * None of the feeds sends CORS headers for github.io, so the browser can't read them.
 * This script fetches the public RSS feeds in src/lib/newsCore.mjs (NEWS_SOURCES),
 * parses, sanitizes, filters (general crypto feeds → Stellar/XLM/Soroban only) and
 * de-dupes them, and writes public/data/news-snapshot.json, which Vite copies into the
 * build. Only headline, source, date, a short excerpt from the feed's own summary,
 * an optional thumbnail URL and the article link are kept.
 *
 * NEVER fails the build: a source that fails keeps its items from the previous
 * (committed / last built) snapshot, and the script always exits 0.
 *
 *   node scripts/fetch-news-snapshot.mjs [outFile]
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { NEWS_SOURCES, mergeNews, parseFeed, sanitizeItem } from "../src/lib/newsCore.mjs";

const TIMEOUT_MS = Number(process.env.NEWS_TIMEOUT_MS || 20_000);
const MAX_BYTES = 5_000_000;
const here = dirname(fileURLToPath(import.meta.url));
const DEFAULT_OUT = resolve(here, "../public/data/news-snapshot.json");
const log = (...a) => console.log("[news-snapshot]", ...a);

async function fetchText(url, fetchImpl) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetchImpl(url, {
      headers: { Accept: "application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.9, */*;q=0.5", "User-Agent": "quasaria-pages-build/1.0 (+https://github.com/yogibear1323/quasaria)" },
      redirect: "follow",
      signal: ctl.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    if (text.length > MAX_BYTES) throw new Error("feed too large");
    return text;
  } finally {
    clearTimeout(t);
  }
}

/**
 * Fetch every source and build the snapshot. `prev` = the previous snapshot:
 * a source that fails (or returns no items) keeps its previous items.
 */
export async function buildNewsSnapshot({ prev = null, fetchImpl = fetch, sources = NEWS_SOURCES, now = Date.now() } = {}) {
  const bySource = {};
  const status = [];
  await Promise.all(
    sources.map(async (s) => {
      const prevItems = (prev?.items ?? []).filter((i) => i?.source === s.id);
      const prevStatus = (prev?.sources ?? []).find((x) => x?.id === s.id);
      try {
        const items = parseFeed(await fetchText(s.feed, fetchImpl), s);
        if (items.length === 0) throw new Error("no items in feed");
        bySource[s.id] = items;
        status.push({ id: s.id, name: s.name, home: s.home, feed: s.feed, ok: true, fetchedAt: new Date(now).toISOString() });
      } catch (e) {
        bySource[s.id] = prevItems;
        status.push({ id: s.id, name: s.name, home: s.home, feed: s.feed, ok: false, error: String(e?.message ?? e).slice(0, 120), fetchedAt: prevStatus?.fetchedAt ?? null });
      }
    }),
  );
  const items = mergeNews(bySource, { sources, now });
  const ordered = sources.map((s) => status.find((x) => x.id === s.id)).map((x) => ({ ...x, count: items.filter((i) => i.source === x.id).length }));
  return { version: 1, generatedAt: new Date(now).toISOString(), sources: ordered, items };
}

function readPrevious(out) {
  try {
    const j = JSON.parse(readFileSync(out, "utf8"));
    return { ...j, items: (j.items ?? []).map(sanitizeItem).filter(Boolean) };
  } catch {
    return null;
  }
}

async function main() {
  const out = resolve(process.argv[2] || DEFAULT_OUT);
  const prev = readPrevious(out);
  const snap = await buildNewsSnapshot({ prev });
  const okCount = snap.sources.filter((s) => s.ok).length;
  for (const s of snap.sources) log(`${s.ok ? "ok  " : "WARN"} ${s.id}: ${s.count} items${s.ok ? "" : ` (failed: ${s.error}; kept previous)`}`);
  if (okCount === 0) {
    log(prev ? `all feeds failed; keeping the previous snapshot from ${prev.generatedAt}` : "all feeds failed and no previous snapshot exists");
    return;
  }
  mkdirSync(dirname(out), { recursive: true });
  const tmp = `${out}.tmp`;
  writeFileSync(tmp, JSON.stringify(snap) + "\n");
  renameSync(tmp, out);
  log(`wrote ${out} (${snap.items.length} items, ${okCount}/${snap.sources.length} feeds ok, generatedAt ${snap.generatedAt})`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main()
    .catch((e) => log(`WARN unexpected error, keeping previous snapshot: ${e?.stack || e}`))
    .finally(() => process.exit(0));
}
