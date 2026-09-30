/**
 * Stellar news for the landing "Latest from Stellar" section and the /news page.
 *
 * Where the items come from (see src/lib/newsCore.mjs for the feed list):
 *  1. Build-time snapshot: public/data/news-snapshot.json, written by
 *     scripts/fetch-news-snapshot.mjs in the Pages workflow on every push and on
 *     its 30-minute schedule (the site is rebuilt + redeployed, no commits).
 *  2. Live, in the browser: sources that send CORS headers (`cors: true`) are
 *     fetched directly and replace their part of the snapshot. None of today's
 *     feeds do (checked 2026-09-29), and we never use third-party CORS proxies.
 *  3. While the page stays open, the snapshot is re-fetched every 10 minutes
 *     (cache: "no-cache"), so a scheduled redeploy shows up without a reload.
 * Every item is re-sanitized here (plain text, http(s) links, https images).
 */
import { useEffect, useState } from "react";
import { NEWS_SOURCES, mergeNews, parseFeed, sanitizeItem, type NewsItem, type NewsSource, type RawNewsItem } from "./newsCore.mjs";

export { relativeTime, NEWS_SOURCES, EXCERPT_MAX } from "./newsCore.mjs";
export type { NewsItem, NewsSource } from "./newsCore.mjs";

export const NEWS_SNAPSHOT_URL = `${import.meta.env.BASE_URL}data/news-snapshot.json`;
export const NEWS_REFRESH_MS = 10 * 60_000;
export const NEWS_TIMEOUT_MS = 10_000;

export interface NewsSourceStatus {
  id: string;
  name: string;
  home: string | null;
  ok: boolean;
  count: number;
}
export interface NewsSnapshot {
  generatedAt: string;
  sources: NewsSourceStatus[];
  items: NewsItem[];
}
export interface NewsState {
  status: "loading" | "ready" | "error";
  /** "live" = at least one source was read directly by the browser; "snapshot" = build-time file only. */
  mode: "live" | "snapshot" | null;
  items: NewsItem[];
  sources: NewsSourceStatus[];
  /** ISO time the shown data was fetched (snapshot build time, or now when live). */
  updatedAt: string | null;
  error: string | null;
}
export const INITIAL_NEWS: NewsState = { status: "loading", mode: null, items: [], sources: [], updatedAt: null, error: null };

const httpUrl = (u: unknown): string | null => {
  try {
    const x = new URL(String(u));
    return x.protocol === "https:" || x.protocol === "http:" ? x.href : null;
  } catch {
    return null;
  }
};

/** Validate the snapshot JSON; items are re-sanitized, bad ones dropped. */
export function parseNewsSnapshot(j: unknown): NewsSnapshot | null {
  if (!j || typeof j !== "object") return null;
  const o = j as { generatedAt?: unknown; sources?: unknown; items?: unknown };
  if (typeof o.generatedAt !== "string" || !Number.isFinite(Date.parse(o.generatedAt)) || !Array.isArray(o.items)) return null;
  const items = o.items.map(sanitizeItem).filter((x): x is NewsItem => !!x).sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
  const sources = (Array.isArray(o.sources) ? o.sources : [])
    .filter((s): s is Record<string, unknown> => !!s && typeof s === "object" && typeof (s as { id?: unknown }).id === "string")
    .map((s) => ({ id: String(s.id).slice(0, 40), name: String(s.name ?? s.id).replace(/[<>]/g, "").slice(0, 60), home: httpUrl(s.home), ok: s.ok !== false, count: items.filter((i) => i.source === s.id).length }));
  return { generatedAt: new Date(Date.parse(o.generatedAt)).toISOString(), sources, items };
}

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

async function getWithTimeout(fetchImpl: FetchLike, url: string, init: RequestInit = {}): Promise<Response> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), NEWS_TIMEOUT_MS);
  try {
    const r = await fetchImpl(url, { ...init, signal: ctl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r;
  } finally {
    clearTimeout(t);
  }
}

export interface LoadNewsOptions {
  fetchImpl?: FetchLike;
  snapshotUrl?: string;
  sources?: NewsSource[];
  now?: number;
}

/** One load: live CORS sources (if any) + the snapshot, merged; snapshot-only or error on failure. */
export async function loadNews({ fetchImpl = (u, i) => fetch(u, i), snapshotUrl = NEWS_SNAPSHOT_URL, sources = NEWS_SOURCES, now = Date.now() }: LoadNewsOptions = {}): Promise<NewsState> {
  const liveSources = sources.filter((s) => s.cors);
  const [snapR, ...liveR] = await Promise.allSettled([
    getWithTimeout(fetchImpl, snapshotUrl, { cache: "no-cache" }).then((r) => r.json()).then(parseNewsSnapshot),
    ...liveSources.map((s) => getWithTimeout(fetchImpl, s.feed).then((r) => r.text()).then((x) => parseFeed(x, s))),
  ]);
  const snap = snapR.status === "fulfilled" ? snapR.value : null;
  const live: Record<string, RawNewsItem[]> = {};
  liveSources.forEach((s, i) => {
    const r = liveR[i];
    if (r.status === "fulfilled" && r.value.length) live[s.id] = r.value;
  });

  if (Object.keys(live).length) {
    const bySource: Record<string, Partial<RawNewsItem>[]> = {};
    for (const s of sources) bySource[s.id] = live[s.id] ?? (snap?.items.filter((i) => i.source === s.id) ?? []);
    const items = mergeNews(bySource, { sources, now });
    const statuses = sources.map((s) => {
      const prev = snap?.sources.find((x) => x.id === s.id);
      return { id: s.id, name: s.name, home: s.home, ok: !!live[s.id] || (prev?.ok ?? false), count: items.filter((i) => i.source === s.id).length };
    });
    return { status: "ready", mode: "live", items, sources: statuses, updatedAt: new Date(now).toISOString(), error: null };
  }
  if (snap) return { status: "ready", mode: "snapshot", items: snap.items, sources: snap.sources, updatedAt: snap.generatedAt, error: null };
  const why = snapR.status === "rejected" ? String((snapR.reason as Error)?.message ?? snapR.reason) : "invalid news snapshot";
  return { ...INITIAL_NEWS, status: "error", error: why };
}

// Shared between the landing section and /news (one request per refresh window).
let cached: { at: number; p: Promise<NewsState> } | null = null;
export function loadNewsShared(maxAgeMs = NEWS_REFRESH_MS): Promise<NewsState> {
  const now = Date.now();
  if (!cached || now - cached.at >= maxAgeMs) {
    const p = loadNews().catch((e): NewsState => ({ ...INITIAL_NEWS, status: "error", error: String(e?.message ?? e) }));
    cached = { at: now, p };
    p.then((s) => {
      if (s.status === "error" && cached?.p === p) cached = null; // retry sooner next time
    });
  }
  return cached.p;
}

/** News state; refreshes every `refreshMs` while the tab is visible. Keeps showing the last good data if a refresh fails. */
export function useNews(refreshMs = NEWS_REFRESH_MS, disabled = false): NewsState & { now: number } {
  const [state, setState] = useState<NewsState>(INITIAL_NEWS);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (disabled) return;
    let alive = true;
    const go = () => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      loadNewsShared(refreshMs).then((s) => {
        if (!alive) return;
        setNow(Date.now());
        setState((prev) => (s.status === "error" && prev.status === "ready" ? prev : s));
      });
    };
    go();
    const t = setInterval(go, refreshMs);
    const clock = setInterval(() => setNow(Date.now()), 60_000);
    const onVis = () => document.visibilityState === "visible" && go();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      alive = false;
      clearInterval(t);
      clearInterval(clock);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [refreshMs, disabled]);
  return { ...state, now };
}

/** "Sep 29, 6:14 PM" (local time) for "Updated …". */
export function updatedLabel(iso: string | null | undefined): string {
  if (!iso || !Number.isFinite(Date.parse(iso))) return "—";
  return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}
