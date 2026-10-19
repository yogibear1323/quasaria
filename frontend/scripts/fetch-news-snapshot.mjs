#!/usr/bin/env node
/**
 * Stellar news pipeline (run by .github/workflows/news.yml every 3 hours and on demand).
 *
 * Fetches the public RSS / Atom feeds in src/lib/newsCore.mjs (NEWS_SOURCES) plus the Stellar status API,
 * then parses, sanitizes (plain text only), filters (Stellar relevance, hype, pre-releases), tags,
 * de-dupes, sorts newest first, keeps the latest 100 and writes ONE static JSON file.
 *
 *   node scripts/fetch-news-snapshot.mjs [outFile] [--seed file] [--strict]
 *
 *   outFile   default public/data/news.json. Its current content is the "previous snapshot": a source that
 *             fails (or returns nothing) keeps its previous items, so one flaky feed never empties the page.
 *   --seed    previous snapshot to start from when outFile doesn't exist yet (first run on the data branch).
 *   --strict  exit 1 when no source could be fetched at all (the workflow uses it so a total outage is visible).
 *
 * The file is only rewritten when the CONTENT changed (items, tags, status line), so `git diff` is empty and
 * nothing is committed when there is no news. generatedAt = when the content last changed.
 * No secrets or tokens are used or stored; every request is an anonymous GET of a public feed.
 */
import { appendFileSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { NEWS_SOURCES, STATUS_SUMMARY_URL, mergeNews, parseFeed, parseStatusSummary, sanitizeItem } from "../src/lib/newsCore.mjs";

export const SNAPSHOT_VERSION = 2;
const TIMEOUT_MS = Number(process.env.NEWS_TIMEOUT_MS || 20_000);
const RETRIES = Number(process.env.NEWS_RETRIES || 2);
const RETRY_DELAY_MS = Number(process.env.NEWS_RETRY_DELAY_MS || 1500);
const MAX_BYTES = 5_000_000;
const here = dirname(fileURLToPath(import.meta.url));
const DEFAULT_OUT = resolve(here, "../public/data/news.json");
const UA = "quasaria-news-bot/2.0 (+https://github.com/yogibear1323/quasaria)";
const log = (...a) => console.log("[news]", ...a);

async function fetchText(url, fetchImpl, accept, retries = RETRIES, retryDelayMs = RETRY_DELAY_MS) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
    try {
      const res = await fetchImpl(url, { headers: { Accept: accept, "User-Agent": UA }, redirect: "follow", signal: ctl.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      if (text.length > MAX_BYTES) throw new Error("feed too large");
      return text;
    } catch (e) {
      lastErr = e?.name === "AbortError" ? new Error("timeout") : e;
      if (attempt < retries) await new Promise((r) => setTimeout(r, retryDelayMs * (attempt + 1)));
    } finally {
      clearTimeout(t);
    }
  }
  throw lastErr;
}
const FEED_ACCEPT = "application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.9, */*;q=0.5";

/**
 * Fetch every source and build the snapshot object. `prev` = the previous snapshot (sources that fail keep
 * their previous items; a failed status API keeps the previous status line).
 */
export async function buildNewsSnapshot({ prev = null, fetchImpl = fetch, sources = NEWS_SOURCES, now = Date.now(), statusUrl = STATUS_SUMMARY_URL, retries = RETRIES, retryDelayMs = RETRY_DELAY_MS } = {}) {
  const bySource = {};
  const status = [];
  await Promise.all(
    sources.map(async (s) => {
      const prevItems = (prev?.items ?? []).filter((i) => i?.source === s.id);
      try {
        const items = parseFeed(await fetchText(s.feed, fetchImpl, FEED_ACCEPT, retries, retryDelayMs), s);
        if (items.length === 0) throw new Error("no items in feed");
        bySource[s.id] = items;
        status.push({ id: s.id, ok: true });
      } catch (e) {
        bySource[s.id] = prevItems;
        status.push({ id: s.id, ok: false, error: String(e?.message ?? e).slice(0, 120) });
      }
    }),
  );
  let networkStatus = prev?.networkStatus ?? null;
  let statusOk = false;
  if (statusUrl) {
    try {
      const ns = parseStatusSummary(JSON.parse(await fetchText(statusUrl, fetchImpl, "application/json", retries, retryDelayMs)));
      if (!ns) throw new Error("unexpected status payload");
      networkStatus = ns;
      statusOk = true;
    } catch (e) {
      log(`WARN status API failed (${e?.message ?? e}); keeping the previous status line`);
    }
  }
  const items = mergeNews(bySource, { sources, now });
  const out = sources.map((s) => {
    const st = status.find((x) => x.id === s.id);
    return { id: s.id, name: s.name, kind: s.kind, home: s.home, feed: s.feed, count: items.filter((i) => i.source === s.id).length, ok: st.ok, ...(st.ok ? {} : { error: st.error }) };
  });
  return { version: SNAPSHOT_VERSION, generatedAt: new Date(now).toISOString(), networkStatus, sources: out, items, _statusOk: statusOk };
}

/** The parts of a snapshot whose change is worth a commit (no timestamps of the run, no transient fetch errors). */
export function contentKey(snap) {
  if (!snap) return "";
  return JSON.stringify({
    items: snap.items ?? [],
    status: snap.networkStatus ? { i: snap.networkStatus.indicator, d: snap.networkStatus.description, u: snap.networkStatus.updatedAt, s: snap.networkStatus.issues, g: snap.networkStatus.degraded } : null,
    sources: (snap.sources ?? []).map((s) => [s.id, s.name, s.home]),
  });
}
export const hasChanged = (prev, next) => contentKey(prev) !== contentKey(next);

export function readSnapshot(file) {
  try {
    const j = JSON.parse(readFileSync(file, "utf8"));
    return { ...j, items: (j.items ?? []).map(sanitizeItem).filter(Boolean) };
  } catch {
    return null;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const strict = args.includes("--strict");
  const seedAt = args.indexOf("--seed");
  const seedFile = seedAt >= 0 ? args[seedAt + 1] : null;
  const positional = args.filter((a, i) => !a.startsWith("--") && i !== seedAt + 1);
  const out = resolve(positional[0] || DEFAULT_OUT);
  const existing = readSnapshot(out);
  const prev = existing ?? (seedFile ? readSnapshot(resolve(seedFile)) : null);
  const snap = await buildNewsSnapshot({ prev });
  const { _statusOk, ...file } = snap;
  const okCount = snap.sources.filter((s) => s.ok).length;
  for (const s of snap.sources) log(`${s.ok ? "ok  " : "FAIL"} ${s.id}: ${s.count} items kept${s.ok ? "" : ` (${s.error}; kept previous items)`}`);
  if (process.env.GITHUB_ACTIONS) for (const s of snap.sources) if (!s.ok) console.log(`::warning title=News source failed::${s.id}: ${s.error} (kept previous items)`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    const rows = snap.sources.map((s) => `| ${s.id} | ${s.ok ? "ok" : `FAILED: ${s.error}`} | ${s.count} |`).join("\n");
    try {
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Stellar news\n\n| source | fetch | items kept |\n|---|---|---|\n${rows}\n\nNetwork status: ${snap.networkStatus ? snap.networkStatus.description : "n/a"}. Total items: ${snap.items.length}.\n\n`);
    } catch {
      /* summary is best effort */
    }
  }
  log(`network status: ${snap.networkStatus ? `${snap.networkStatus.description} (${_statusOk ? "fresh" : "previous"})` : "n/a"}`);
  if (okCount === 0) {
    log(`WARN every feed failed; ${existing ? `keeping the previous snapshot from ${existing.generatedAt}` : "no previous snapshot exists"}`);
    if (strict) process.exitCode = 1;
    return;
  }
  if (existing && !hasChanged(existing, file)) {
    log(`no changes (${file.items.length} items); ${out} left untouched`);
    return;
  }
  mkdirSync(dirname(out), { recursive: true });
  const tmp = `${out}.tmp`;
  writeFileSync(tmp, JSON.stringify(file, null, 1) + "\n");
  renameSync(tmp, out);
  log(`wrote ${out}: ${file.items.length} items, ${okCount}/${snap.sources.length} feeds ok, generatedAt ${file.generatedAt}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((e) => {
    log(`ERROR ${e?.stack || e}`);
    process.exitCode = 1;
  });
}
