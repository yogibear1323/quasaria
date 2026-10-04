/** Live XLM market data for the demo simulator: public Coinbase XLM-USD candles + trades (Kraken ticker fallback). */
import { aggregate, type Candle } from "../../../../bot/src/office/indicators";

const CB = "https://api.exchange.coinbase.com/products/XLM-USD";

async function json(url: string, f: typeof fetch) {
  const r = await f(url, { cache: "no-store" });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}
export async function candles(gran: 60 | 300 | 900 | 3600, f: typeof fetch = fetch): Promise<Candle[]> {
  const rows = (await json(`${CB}/candles?granularity=${gran}`, f)) as number[][];
  return rows.map((r) => ({ t: r[0], l: r[1], h: r[2], o: r[3], c: r[4] })).sort((a, b) => a.t - b.t);
}

export type FeedSource = "oracle" | "coinbase" | "kraken" | "candles" | "trades";
export const FEED_LABEL: Record<FeedSource, string> = { oracle: "Oracle · Soroban testnet", coinbase: "Coinbase XLM-USD ticker", kraken: "Kraken XLM/USD ticker", candles: "Coinbase candle", trades: "Coinbase XLM-USD trades" };

export async function ticker(f: typeof fetch = fetch): Promise<{ price: number; source: FeedSource } | null> {
  try {
    const p = Number(((await json(`${CB}/ticker`, f)) as { price?: string }).price);
    if (p > 0) return { price: p, source: "coinbase" };
  } catch {
    /* fall through */
  }
  try {
    const j = (await json("https://api.kraken.com/0/public/Ticker?pair=XLMUSD", f)) as { result?: Record<string, { c: [string] }> };
    const v = j.result && Object.values(j.result)[0];
    const p = Number(v?.c?.[0]);
    return p > 0 ? { price: p, source: "kraken" } : null;
  } catch {
    return null;
  }
}

export interface DemoMarket {
  bars: Record<number, Candle[]>; // REST candles per frame (incl. the forming one; filter with closedBy)
  base: number; // catch-up replay frame
  at: number;
}
/** Strict profile: the fleet's 15m / 1h / 4h frames. */
export async function loadMarket(now: number, f: typeof fetch = fetch): Promise<DemoMarket> {
  const [m15, h1] = await Promise.all([candles(900, f), candles(3600, f)]);
  return { bars: { 900: m15, 3600: h1, 14400: aggregate(h1, 3600, 4) }, base: 900, at: now };
}
/** Active profile: 1m / 5m / 15m candles (+30m aggregated); 15s / 30s bars come from the live trade tape. */
export async function loadActiveMarket(now: number, f: typeof fetch = fetch): Promise<DemoMarket> {
  const [m1, m5, m15] = await Promise.all([candles(60, f), candles(300, f), candles(900, f)]);
  return { bars: { 60: m1, 300: m5, 900: m15, 1800: aggregate(m15, 900, 2) }, base: 60, at: now };
}

/** Pick the tick price like the fleet: the on-chain oracle when fresh (< 15 min), else the public reference feed. */
export async function pickPrice(oracle: { price: number | null; ts: number | null }, now: number, m: DemoMarket | null, f: typeof fetch = fetch): Promise<{ price: number; source: FeedSource } | null> {
  if (oracle.price && oracle.price > 0 && oracle.ts && now - oracle.ts < 900) return { price: oracle.price, source: "oracle" };
  const t = await ticker(f);
  if (t) return t;
  const b = m?.bars[m.base];
  const c = b?.[b.length - 1]?.c;
  return c ? { price: c, source: "candles" } : null;
}

/** Feed freshness for the readout: fresh < 90 s, amber < 180 s, red after (or never ticked). */
export const feedLevel = (ageSec: number | null): "fresh" | "stale" | "down" => (ageSec === null ? "down" : ageSec < 90 ? "fresh" : ageSec < 180 ? "stale" : "down");

export interface Trade {
  id: number;
  t: number; // unix seconds (fractional)
  price: number;
  size: number;
}
export async function fetchTrades(limit = 100, f: typeof fetch = fetch): Promise<Trade[]> {
  const rows = (await json(`${CB}/trades?limit=${limit}`, f)) as { trade_id: number; price: string; size: string; time: string }[];
  return rows.map((r) => ({ id: r.trade_id, t: Date.parse(r.time) / 1000, price: Number(r.price), size: Number(r.size) })).filter((x) => x.price > 0 && Number.isFinite(x.t));
}

/** Rolling tape of public trades -> sub-minute OHLC bars (gaps filled flat at the previous close). */
export class TradeTape {
  trades: Trade[] = [];
  add(ts: Trade[]) {
    const seen = new Set(this.trades.map((x) => x.id));
    const fresh = ts.filter((x) => !seen.has(x.id));
    if (!fresh.length) return 0;
    this.trades = [...this.trades, ...fresh].sort((a, b) => a.id - b.id).slice(-6000);
    return fresh.length;
  }
  last(): Trade | undefined {
    return this.trades[this.trades.length - 1];
  }
  /** closed bars of `gran` seconds up to `now` */
  bars(gran: number, now: number, max = 300): Candle[] {
    if (!this.trades.length) return [];
    const out: Candle[] = [];
    const end = Math.floor(now / gran) * gran; // first still-forming bucket
    let i = 0;
    let prev: number | null = null;
    for (let t = Math.floor(this.trades[0].t / gran) * gran; t < end; t += gran) {
      let o = NaN, h = -Infinity, l = Infinity, c = NaN;
      while (i < this.trades.length && this.trades[i].t < t + gran) {
        const p = this.trades[i++].price;
        if (Number.isNaN(o)) o = p;
        h = Math.max(h, p);
        l = Math.min(l, p);
        c = p;
      }
      if (Number.isNaN(o)) {
        if (prev === null) continue;
        out.push({ t, o: prev, h: prev, l: prev, c: prev });
      } else {
        out.push({ t, o, h, l, c });
        prev = c;
      }
    }
    return out.slice(-max);
  }
}
