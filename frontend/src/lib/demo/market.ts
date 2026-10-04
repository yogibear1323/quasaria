/** Live XLM market data for the demo simulator: the same public Coinbase XLM-USD feed the fleet uses (Kraken ticker fallback). */
import { aggregate, type Candle } from "../../../../bot/src/office/indicators";

const CB = "https://api.exchange.coinbase.com/products/XLM-USD";

async function json(url: string, f: typeof fetch) {
  const r = await f(url, { cache: "no-store" });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}
export async function candles(gran: 900 | 3600, f: typeof fetch = fetch): Promise<Candle[]> {
  const rows = (await json(`${CB}/candles?granularity=${gran}`, f)) as number[][];
  return rows.map((r) => ({ t: r[0], l: r[1], h: r[2], o: r[3], c: r[4] })).sort((a, b) => a.t - b.t);
}
export async function ticker(f: typeof fetch = fetch): Promise<number | null> {
  try {
    const p = Number(((await json(`${CB}/ticker`, f)) as { price?: string }).price);
    if (p > 0) return p;
  } catch {
    /* fall through */
  }
  try {
    const j = (await json("https://api.kraken.com/0/public/Ticker?pair=XLMUSD", f)) as { result?: Record<string, { c: [string] }> };
    const v = j.result && Object.values(j.result)[0];
    const p = Number(v?.c?.[0]);
    return p > 0 ? p : null;
  } catch {
    return null;
  }
}
export interface DemoMarket {
  m15: Candle[];
  h1: Candle[];
  h4: Candle[];
  at: number;
}
export async function loadMarket(now: number, f: typeof fetch = fetch): Promise<DemoMarket> {
  const [m15, h1] = await Promise.all([candles(900, f), candles(3600, f)]);
  return { m15, h1, h4: aggregate(h1, 3600, 4), at: now };
}
