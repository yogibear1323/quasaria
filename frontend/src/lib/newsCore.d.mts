export interface NewsSource {
  id: string;
  name: string;
  home: string;
  feed: string;
  /** general crypto feed: keep only Stellar / XLM / Soroban items */
  filter: boolean;
  /** feed sends Access-Control-Allow-Origin, so the browser may fetch it directly */
  cors: boolean;
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
}
export const NEWS_SOURCES: NewsSource[];
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
export function sanitizeItem(x: unknown): NewsItem | null;
export function mergeNews(
  itemsBySource: Record<string, Partial<RawNewsItem>[]>,
  opts?: { sources?: NewsSource[]; now?: number; maxItems?: number; maxPerSource?: number; maxAgeDays?: number },
): NewsItem[];
export function relativeTime(iso: string | number, now?: number): string;
