/**
 * Stellar news for the landing "Latest from Stellar" strip and the /news page.
 *
 * Data: ONE static JSON (news.json, schema v2) written by the scheduled "Stellar news" workflow
 * (scripts/fetch-news-snapshot.mjs, every 3 hours) and committed to the `news-data` branch. The browser reads
 *  1. that file straight from raw.githubusercontent.com (CORS *, ~5 min cache), so new items show up within
 *     minutes of a workflow run without a redeploy, and
 *  2. the copy bundled into the Pages build (data/news.json), same origin, as the fallback,
 * and shows whichever is newer. The last good copy is also kept in localStorage, so the page still renders
 * if both fail (offline, blocked network). The network status line is read live from status.stellar.org
 * (CORS *) and falls back to the one stored in the JSON. No CORS proxies, no third-party scripts.
 * Every item is re-sanitized here (plain text, http(s) links, https images).
 */
import { useEffect, useState } from "react";
import { NEWS_TAGS, STATUS_SUMMARY_URL, parseStatusSummary, sanitizeItem, type NetworkStatus, type NewsItem, type NewsTagId } from "./newsCore.mjs";

export { relativeTime, NEWS_TAGS } from "./newsCore.mjs";
export type { NewsItem, NewsTagId, NetworkStatus } from "./newsCore.mjs";

export const NEWS_LIVE_URL = (import.meta.env.VITE_NEWS_URL as string | undefined) || "https://raw.githubusercontent.com/yogibear1323/quasaria/news-data/news.json";
export const NEWS_BUNDLED_URL = `${import.meta.env.BASE_URL}data/news.json`;
export const NEWS_CACHE_KEY = "qz.news.v2";
export const NEWS_REFRESH_MS = 10 * 60_000;
export const NEWS_TIMEOUT_MS = 10_000;

export interface NewsSourceInfo {
  id: string;
  name: string;
  home: string | null;
  kind: string;
  count: number;
}
export interface NewsSnapshot {
  generatedAt: string;
  networkStatus: NetworkStatus | null;
  sources: NewsSourceInfo[];
  items: NewsItem[];
}
export type NewsOrigin = "live" | "site" | "cached";
export interface NewsState {
  status: "loading" | "ready" | "error";
  /** live = data branch, site = bundled with the deploy, cached = this browser's last good copy */
  origin: NewsOrigin | null;
  items: NewsItem[];
  sources: NewsSourceInfo[];
  networkStatus: NetworkStatus | null;
  /** true when the status line came from status.stellar.org just now (not from the JSON) */
  statusLive: boolean;
  /** ISO time the news content was last updated (written by the workflow) */
  updatedAt: string | null;
  error: string | null;
}
export const INITIAL_NEWS: NewsState = { status: "loading", origin: null, items: [], sources: [], networkStatus: null, statusLive: false, updatedAt: null, error: null };

const httpUrl = (u: unknown): string | null => {
  try {
    const x = new URL(String(u));
    return x.protocol === "https:" || x.protocol === "http:" ? x.href : null;
  } catch {
    return null;
  }
};

/** Validate the news.json payload; items are re-sanitized, bad ones dropped. */
export function parseNewsSnapshot(j: unknown): NewsSnapshot | null {
  if (!j || typeof j !== "object") return null;
  const o = j as { generatedAt?: unknown; sources?: unknown; items?: unknown; networkStatus?: unknown };
  if (typeof o.generatedAt !== "string" || !Number.isFinite(Date.parse(o.generatedAt)) || !Array.isArray(o.items)) return null;
  const items = o.items.map(sanitizeItem).filter((x): x is NewsItem => !!x).sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
  const sources = (Array.isArray(o.sources) ? o.sources : [])
    .filter((s): s is Record<string, unknown> => !!s && typeof s === "object" && typeof (s as { id?: unknown }).id === "string")
    .map((s) => ({ id: String(s.id).slice(0, 40), name: String(s.name ?? s.id).replace(/[<>]/g, "").slice(0, 60), home: httpUrl(s.home), kind: String(s.kind ?? "").slice(0, 12), count: items.filter((i) => i.source === s.id).length }));
  const ns = o.networkStatus && typeof o.networkStatus === "object" ? parseStoredStatus(o.networkStatus as Record<string, unknown>) : null;
  return { generatedAt: new Date(Date.parse(o.generatedAt)).toISOString(), networkStatus: ns, sources, items };
}

function parseStoredStatus(s: Record<string, unknown>): NetworkStatus | null {
  const ind = String(s.indicator);
  if (!["none", "minor", "major", "critical", "maintenance"].includes(ind)) return null;
  const strs = (v: unknown) => (Array.isArray(v) ? v.map((x) => String(x).replace(/[<>]/g, "").slice(0, 90)).slice(0, 5) : []);
  const t = Date.parse(String(s.updatedAt));
  return { indicator: ind as NetworkStatus["indicator"], description: String(s.description ?? "").replace(/[<>]/g, "").slice(0, 80), updatedAt: Number.isFinite(t) ? new Date(t).toISOString() : null, url: "https://status.stellar.org", issues: strs(s.issues), degraded: strs(s.degraded) };
}

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

async function getJson(fetchImpl: FetchLike, url: string, init: RequestInit = {}): Promise<unknown> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), NEWS_TIMEOUT_MS);
  try {
    const r = await fetchImpl(url, { ...init, signal: ctl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}

export interface LoadNewsOptions {
  fetchImpl?: FetchLike;
  liveUrl?: string;
  bundledUrl?: string;
  statusUrl?: string | null;
  storage?: Pick<Storage, "getItem" | "setItem"> | null;
}

const defaultStorage = (): Storage | null => {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
};

/**
 * One load: live data branch + bundled copy (newest valid one wins), falling back to this browser's last good copy;
 * plus the live status line. Resolves with an "error" state only when nothing at all is available.
 */
export async function loadNews({ fetchImpl = (u, i) => fetch(u, i), liveUrl = NEWS_LIVE_URL, bundledUrl = NEWS_BUNDLED_URL, statusUrl = STATUS_SUMMARY_URL, storage = defaultStorage() }: LoadNewsOptions = {}): Promise<NewsState> {
  const [liveR, siteR, statusR] = await Promise.allSettled([
    getJson(fetchImpl, liveUrl, { cache: "no-cache" }).then(parseNewsSnapshot),
    getJson(fetchImpl, bundledUrl, { cache: "no-cache" }).then(parseNewsSnapshot),
    statusUrl ? getJson(fetchImpl, statusUrl, { cache: "no-store" }).then(parseStatusSummary) : Promise.resolve(null),
  ]);
  const live = liveR.status === "fulfilled" ? liveR.value : null;
  const site = siteR.status === "fulfilled" ? siteR.value : null;
  let snap: NewsSnapshot | null = null;
  let origin: NewsOrigin | null = null;
  if (live && (!site || Date.parse(live.generatedAt) >= Date.parse(site.generatedAt))) [snap, origin] = [live, "live"];
  else if (site) [snap, origin] = [site, "site"];
  if (snap && storage) {
    try {
      storage.setItem(NEWS_CACHE_KEY, JSON.stringify({ generatedAt: snap.generatedAt, sources: snap.sources, items: snap.items, networkStatus: snap.networkStatus }));
    } catch {
      /* private mode / quota: ignore */
    }
  }
  if (!snap && storage) {
    try {
      const raw = storage.getItem(NEWS_CACHE_KEY);
      const cached = raw ? parseNewsSnapshot(JSON.parse(raw)) : null;
      if (cached) [snap, origin] = [cached, "cached"];
    } catch {
      /* corrupt cache: ignore */
    }
  }
  const liveStatus = statusR.status === "fulfilled" ? statusR.value : null;
  if (!snap) {
    const why = liveR.status === "rejected" ? String((liveR.reason as Error)?.message ?? liveR.reason) : "invalid news data";
    return { ...INITIAL_NEWS, status: "error", networkStatus: liveStatus, statusLive: !!liveStatus, error: why };
  }
  return { status: "ready", origin, items: snap.items, sources: snap.sources, networkStatus: liveStatus ?? snap.networkStatus, statusLive: !!liveStatus, updatedAt: snap.generatedAt, error: null };
}

// Shared between the landing strip and /news (one request per refresh window).
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

/** Local-time label for the viewer, e.g. "Oct 18, 6:54 PM MST" (withZone) or "Oct 18, 6:54 PM". */
export function localTime(iso: string | null | undefined, withZone = false): string {
  if (!iso || !Number.isFinite(Date.parse(iso))) return "—";
  return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", ...(withZone ? { timeZoneName: "short" as const } : {}) });
}
/** Local calendar year label when the item isn't from this year: "Oct 31, 2025, 1:29 PM". */
export function itemTime(iso: string, now = Date.now()): string {
  const d = new Date(iso);
  const sameYear = d.getFullYear() === new Date(now).getFullYear();
  return d.toLocaleString(undefined, { month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" as const }), hour: "numeric", minute: "2-digit" });
}

/** Items filtered by a category tag ("all" = everything). */
export function filterByTag(items: NewsItem[], tag: NewsTagId | "all"): NewsItem[] {
  return tag === "all" ? items : items.filter((i) => i.tags.includes(tag));
}
/** Per-tag counts for the chips (tags with no items are omitted). */
export function tagCounts(items: NewsItem[]): { id: NewsTagId; label: string; count: number }[] {
  return NEWS_TAGS.map((t) => ({ ...t, count: items.filter((i) => i.tags.includes(t.id)).length })).filter((t) => t.count > 0);
}

/**
 * The home-page strip: the newest `n` stories, but GitHub release notes (frequent, terse) are capped at `maxReleases`
 * so announcements and ecosystem news stay visible. With a category selected, plain newest-first.
 */
export function pickStrip(items: NewsItem[], n = 6, maxReleases = 2): NewsItem[] {
  const out: NewsItem[] = [];
  let rel = 0;
  for (const it of items) {
    if (it.kind === "release" && rel++ >= maxReleases) continue;
    out.push(it);
    if (out.length >= n) break;
  }
  return out;
}
