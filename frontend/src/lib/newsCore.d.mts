export type NewsKind = "blog" | "release" | "status" | "outlet";
export type NewsTagId = "protocol" | "developers" | "ecosystem" | "mainnet" | "network-status";
export interface NewsSource {
  id: string;
  name: string;
  /** release sources: product label used in generated titles ("Stellar Core v30.0.0 released") */
  label?: string;
  home: string;
  feed: string;
  kind: NewsKind;
  /** general crypto feed: keep only Stellar / XLM / Soroban items */
  filter: boolean;
  tags: NewsTagId[];
  maxAgeDays?: number;
  maxItems?: number;
}
export interface RawNewsItem {
  title: string;
  url: string;
  publishedAt: string | null;
  excerpt: string;
  image: string | null;
  categories: string[];
  source: string;
  sourceName: string;
}
export interface NewsItem {
  id: string;
  title: string;
  url: string;
  publishedAt: string;
  excerpt: string;
  image: string | null;
  source: string;
  sourceName: string;
  kind: NewsKind;
  tags: NewsTagId[];
}
export interface NetworkStatus {
  indicator: "none" | "minor" | "major" | "critical" | "maintenance";
  description: string;
  updatedAt: string | null;
  url: string;
  issues: string[];
  degraded: string[];
}
export const NEWS_SOURCES: NewsSource[];
export const NEWS_TAGS: { id: NewsTagId; label: string }[];
export const STATUS_SUMMARY_URL: string;
export const STATUS_PAGE_URL: string;
export const EXCERPT_MAX: number;
export const TITLE_MAX: number;
export const MAX_PER_SOURCE: number;
export const MAX_ITEMS: number;
export const MAX_AGE_DAYS: number;
export function decodeEntities(s: string): string;
export function toPlainText(raw: unknown): string;
export function truncate(s: string, max: number): string;
export function safeUrl(raw: unknown, base?: string): string | null;
export function parseFeed(xml: string, source?: Partial<NewsSource>): RawNewsItem[];
export function isStellarRelated(item: { title?: string; excerpt?: string; categories?: string[] }): boolean;
export function isHype(item: { title?: string; excerpt?: string }): boolean;
export function isPrerelease(item: { url?: string; title?: string }): boolean;
export function releaseTitle(rawTitle: string, label?: string): string;
export function releaseSummary(text: string): string;
export function tagItem(item: { title?: string; excerpt?: string; url?: string }, source?: Partial<NewsSource>): NewsTagId[];
export function sanitizeItem(x: unknown): NewsItem | null;
export function mergeNews(
  itemsBySource: Record<string, Partial<RawNewsItem>[]>,
  opts?: { sources?: NewsSource[]; now?: number; maxItems?: number; maxPerSource?: number; maxAgeDays?: number },
): NewsItem[];
export function parseStatusSummary(j: unknown): NetworkStatus | null;
export function relativeTime(iso: string | number, now?: number): string;
