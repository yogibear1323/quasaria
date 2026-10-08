/** Independent reference market data (public, read-only): Coinbase XLM-USD candles/ticker, Kraken ticker fallback. */
import type { Candle } from "./indicators.js";
import { aggregate } from "./indicators.js";

type Fetch = typeof fetch;

export interface ReferenceFeed {
  ticker(): Promise<number | null>;
  /** closed bars at `gran` seconds (900, 3600, 14400 supported), oldest -> newest */
  closedBars(gran: number, now: number): Promise<Candle[]>;
  /** optional: public L2 book summary (spread, depth imbalance within 0.5 % of mid). Logged, not a model input. */
  book?(): Promise<{ spreadBps: number; imbalance: number } | null>;
}

async function getJson(f: Fetch, url: string, timeoutMs = 8000): Promise<unknown> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await f(url, { signal: ctl.signal, headers: { "user-agent": "quasaria-back-office/0.1 (testnet bot)" } });
    if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}

export class PublicReferenceFeed implements ReferenceFeed {
  private cache = new Map<string, { at: number; v: Candle[] }>();
  constructor(private readonly f: Fetch = fetch, private readonly ttlSec = 55) {}

  async ticker(): Promise<number | null> {
    try {
      const j = (await getJson(this.f, "https://api.exchange.coinbase.com/products/XLM-USD/ticker")) as { price?: string };
      const p = Number(j.price);
      if (p > 0) return p;
    } catch {
      /* fall through */
    }
    try {
      const j = (await getJson(this.f, "https://api.kraken.com/0/public/Ticker?pair=XLMUSD")) as { result?: Record<string, { c: [string] }> };
      const v = j.result && Object.values(j.result)[0];
      const p = Number(v?.c?.[0]);
      return p > 0 ? p : null;
    } catch {
      return null;
    }
  }

  private async coinbase(gran: number, start?: number, end?: number): Promise<Candle[]> {
    const q = start && end ? `&start=${new Date(start * 1000).toISOString()}&end=${new Date(end * 1000).toISOString()}` : "";
    const rows = (await getJson(this.f, `https://api.exchange.coinbase.com/products/XLM-USD/candles?granularity=${gran}${q}`)) as number[][];
    // [time, low, high, open, close, volume], newest first
    return rows.map((r) => ({ t: r[0], l: r[1], h: r[2], o: r[3], c: r[4], v: r[5] })).sort((a, b) => a.t - b.t);
  }

  async closedBars(gran: number, now: number): Promise<Candle[]> {
    const key = String(gran);
    const hit = this.cache.get(key);
    let bars: Candle[];
    if (hit && now - hit.at < this.ttlSec) bars = hit.v;
    else {
      bars = gran === 14_400 ? aggregate(await this.coinbase(3600), 3600, 4) : await this.coinbase(gran);
      this.cache.set(key, { at: now, v: bars });
    }
    return bars.filter((b) => b.t + gran <= now);
  }

  async book(): Promise<{ spreadBps: number; imbalance: number } | null> {
    try {
      const j = (await getJson(this.f, "https://api.exchange.coinbase.com/products/XLM-USD/book?level=2")) as { bids?: string[][]; asks?: string[][] };
      const bids = (j.bids ?? []).map((r) => [Number(r[0]), Number(r[1])]), asks = (j.asks ?? []).map((r) => [Number(r[0]), Number(r[1])]);
      if (!bids.length || !asks.length) return null;
      const mid = (bids[0][0] + asks[0][0]) / 2;
      const bd = bids.filter(([p]) => p >= mid * 0.995).reduce((a, [p, q]) => a + p * q, 0);
      const ad = asks.filter(([p]) => p <= mid * 1.005).reduce((a, [p, q]) => a + p * q, 0);
      return { spreadBps: ((asks[0][0] - bids[0][0]) / mid) * 10_000, imbalance: bd + ad > 0 ? (bd - ad) / (bd + ad) : 0 };
    } catch {
      return null;
    }
  }

  /** Long history for backtests (paged, 300 bars per request). */
  async history(gran: number, from: number, to: number): Promise<Candle[]> {
    const base = gran === 14_400 ? 3600 : gran;
    const out = new Map<number, Candle>();
    for (let s = from; s < to; s += base * 300) {
      const e = Math.min(to, s + base * 300);
      for (const c of await this.coinbase(base, s, e)) out.set(c.t, c);
      await new Promise((r) => setTimeout(r, 350));
    }
    const bars = [...out.values()].sort((a, b) => a.t - b.t);
    return gran === 14_400 ? aggregate(bars, 3600, 4) : bars;
  }
}
