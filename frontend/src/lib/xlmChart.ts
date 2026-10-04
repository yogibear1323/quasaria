/**
 * Live XLM chart data (Perps → "Live XLM chart").
 *
 * History: public Coinbase Exchange XLM-USD candles (Kraken OHLC as backup), the same mainnet
 * market data the demo engine (lib/demo/market.ts) and the bot fleet use.
 * Live: the last candle is rolled forward from the Coinbase ticker (Kraken ticker as backup),
 * polled every few seconds; the candle history is re-fetched every minute so volume stays honest.
 * Overlays: the on-chain oracle price (vault.oracle() → lastprice) and the vault's mark_price(),
 * read from the configured Soroban testnet vault. Pure helpers are exported for tests.
 */
import { CONTRACTS } from "./config";
import { readContract } from "./soroban";
import { PERPS, fundingView, marketKeyScVal, parseFundingConfig, parseFundingState } from "./perps";

export type Timeframe = "1m" | "5m" | "15m" | "1h" | "4h" | "1D";
export type Bar = { t: number; o: number; h: number; l: number; c: number; v: number };
export type FeedSource = "Coinbase" | "Kraken";

/** Coinbase serves 60/300/900/3600/21600/86400 s candles; 4h is aggregated from 1h. Kraken has every interval natively. */
export const TIMEFRAMES: { tf: Timeframe; sec: number; cb: number; cbAgg: number; kraken: number }[] = [
  { tf: "1m", sec: 60, cb: 60, cbAgg: 1, kraken: 1 },
  { tf: "5m", sec: 300, cb: 300, cbAgg: 1, kraken: 5 },
  { tf: "15m", sec: 900, cb: 900, cbAgg: 1, kraken: 15 },
  { tf: "1h", sec: 3600, cb: 3600, cbAgg: 1, kraken: 60 },
  { tf: "4h", sec: 14400, cb: 3600, cbAgg: 4, kraken: 240 },
  { tf: "1D", sec: 86400, cb: 86400, cbAgg: 1, kraken: 1440 },
];
export const tfInfo = (tf: Timeframe) => TIMEFRAMES.find((x) => x.tf === tf) ?? TIMEFRAMES[1];

const CB = "https://api.exchange.coinbase.com/products/XLM-USD";
const KR = "https://api.kraken.com/0/public";
/** Ticker older than this (or failing) → "stale" badge; the chart keeps showing the last data. */
export const STALE_AFTER_SEC = 45;

async function json(url: string, f: typeof fetch): Promise<unknown> {
  const r = await f(url, { cache: "no-store" });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

/** Coinbase rows: [time, low, high, open, close, volume], newest first. */
export function parseCoinbase(rows: unknown): Bar[] {
  if (!Array.isArray(rows)) throw new Error("bad candles");
  return (rows as number[][])
    .map((r) => ({ t: Number(r[0]), l: Number(r[1]), h: Number(r[2]), o: Number(r[3]), c: Number(r[4]), v: Number(r[5]) || 0 }))
    .filter((b) => b.t > 0 && b.c > 0)
    .sort((a, b) => a.t - b.t);
}

/** Kraken OHLC: { result: { PAIR: [[time, o, h, l, c, vwap, volume, count], …], last } }, oldest first. */
export function parseKraken(j: unknown): Bar[] {
  const res = (j as { error?: string[]; result?: Record<string, unknown> })?.result;
  const rows = res && Object.entries(res).find(([k, v]) => k !== "last" && Array.isArray(v))?.[1];
  if (!Array.isArray(rows)) throw new Error("bad kraken ohlc");
  return (rows as (string | number)[][])
    .map((r) => ({ t: Number(r[0]), o: Number(r[1]), h: Number(r[2]), l: Number(r[3]), c: Number(r[4]), v: Number(r[6]) || 0 }))
    .filter((b) => b.t > 0 && b.c > 0)
    .sort((a, b) => a.t - b.t);
}

/** Merge consecutive `srcSec` bars into `srcSec × factor` buckets aligned to the epoch (UTC). */
export function aggregateBars(bars: Bar[], srcSec: number, factor: number): Bar[] {
  if (factor <= 1) return bars.slice();
  const size = srcSec * factor;
  const out: Bar[] = [];
  for (const b of bars) {
    const t = Math.floor(b.t / size) * size;
    const cur = out[out.length - 1];
    if (cur && cur.t === t) {
      cur.h = Math.max(cur.h, b.h);
      cur.l = Math.min(cur.l, b.l);
      cur.c = b.c;
      cur.v += b.v;
    } else out.push({ ...b, t });
  }
  return out;
}

/**
 * Roll a live price into the series: same bucket → update high/low/close; new bucket → open a
 * candle at the previous close (no gap) and the new price. Returns a new array; never mutates.
 */
export function applyTick(bars: Bar[], price: number, nowSec: number, tfSec: number): Bar[] {
  if (!(price > 0)) return bars;
  const t = Math.floor(nowSec / tfSec) * tfSec;
  const last = bars[bars.length - 1];
  if (!last) return [{ t, o: price, h: price, l: price, c: price, v: 0 }];
  if (t < last.t) return bars; // late tick for an older bucket
  if (t === last.t) return [...bars.slice(0, -1), { ...last, h: Math.max(last.h, price), l: Math.min(last.l, price), c: price }];
  const o = last.c;
  return [...bars, { t, o, h: Math.max(o, price), l: Math.min(o, price), c: price, v: 0 }];
}

/** Fresh history replaces old, but keep a live-updated last candle if it is newer than the fetched one. */
export function mergeHistory(fresh: Bar[], prev: Bar[]): Bar[] {
  const pl = prev[prev.length - 1], fl = fresh[fresh.length - 1];
  if (!pl || !fl || pl.t <= fl.t) return fresh;
  return [...fresh, pl];
}

export async function fetchBars(tf: Timeframe, f: typeof fetch = fetch): Promise<{ bars: Bar[]; source: FeedSource }> {
  const i = tfInfo(tf);
  try {
    const raw = parseCoinbase(await json(`${CB}/candles?granularity=${i.cb}`, f));
    const bars = aggregateBars(raw, i.cb, i.cbAgg);
    if (bars.length) return { bars, source: "Coinbase" };
    throw new Error("no candles");
  } catch {
    const bars = parseKraken(await json(`${KR}/OHLC?pair=XLMUSD&interval=${i.kraken}`, f));
    if (!bars.length) throw new Error("no candles from Coinbase or Kraken");
    return { bars: bars.slice(-300), source: "Kraken" };
  }
}

export type Tick = { price: number; source: FeedSource; at: number; tradeAt: number | null };
/** Last trade: Coinbase ticker, else Kraken ticker. `at` = when we received it (freshness); `tradeAt` = exchange trade time when given. */
export async function fetchTick(f: typeof fetch = fetch, now = () => Date.now() / 1000): Promise<Tick> {
  try {
    const j = (await json(`${CB}/ticker`, f)) as { price?: string; time?: string };
    const p = Number(j.price);
    if (p > 0) {
      const t = j.time ? Date.parse(j.time) / 1000 : NaN;
      return { price: p, source: "Coinbase", at: now(), tradeAt: Number.isFinite(t) ? t : null };
    }
  } catch {
    /* fall through */
  }
  const j = (await json(`${KR}/Ticker?pair=XLMUSD`, f)) as { result?: Record<string, { c: [string] }> };
  const v = j.result && Object.values(j.result)[0];
  const p = Number(v?.c?.[0]);
  if (!(p > 0)) throw new Error("no XLM ticker from Coinbase or Kraken");
  return { price: p, source: "Kraken", at: now(), tradeAt: null };
}

/** 24h open (Coinbase stats; Kraken: first hourly close ≥ 24h ago). */
export async function fetchOpen24h(f: typeof fetch = fetch, nowSec = Date.now() / 1000): Promise<number | null> {
  try {
    const o = Number(((await json(`${CB}/stats`, f)) as { open?: string }).open);
    if (o > 0) return o;
  } catch {
    /* fall through */
  }
  try {
    return open24hFromBars(parseKraken(await json(`${KR}/OHLC?pair=XLMUSD&interval=60`, f)), nowSec);
  } catch {
    return null;
  }
}
export function open24hFromBars(bars: Bar[], nowSec: number): number | null {
  const cut = nowSec - 86_400;
  let b: Bar | undefined;
  for (const x of bars) if (x.t <= cut) b = x;
  return b && cut - b.t < 7200 ? b.o : null;
}

export const change = (price: number | null, open: number | null) => (price && open ? (price - open) / open : null);

/** Source freshness: age in seconds and whether it is stale. */
export function freshness(at: number | null, nowSec: number, staleAfter = STALE_AFTER_SEC) {
  if (at == null) return { age: null as number | null, stale: true };
  const age = Math.max(0, nowSec - at);
  return { age, stale: age > staleAfter };
}
export function fmtAgeShort(s: number | null) {
  if (s == null) return "—";
  if (s < 60) return `${Math.round(s)}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86400) return `${(s / 3600).toFixed(1)}h`;
  return `${(s / 86400).toFixed(1)}d`;
}

export type Overlay = { oracle: number | null; oracleTs: number | null; mark: number | null; fundingHourly: number | null; maxAge: number | null; at: number };
/** Oracle + mark (+ funding) straight from the testnet vault: oracle(), decimals, lastprice, mark_price, funding_config/state. */
export async function readOverlay(read: <T>(c: string, m: string, a?: unknown[]) => Promise<T> = readContract as never, vault = PERPS.vault, nowSec = Date.now() / 1000): Promise<Overlay> {
  const market = PERPS.markets.find((m) => m.code === "XLM") ?? PERPS.markets[0];
  const asset = marketKeyScVal(market.key);
  const safe = async <T>(p: Promise<T>) => p.then((v) => v as T | null).catch(() => null);
  const [oracleId, cfg] = await Promise.all([safe(read<string>(vault, "oracle")), safe(read<Record<string, bigint>>(vault, "config"))]);
  const oracle = oracleId ?? CONTRACTS.oracle;
  const decimals = Number(await read<number>(oracle, "decimals"));
  const scale = 10 ** decimals;
  const [pd, mk, fc, fs] = await Promise.all([
    safe(read<{ price: bigint; timestamp: bigint } | null>(oracle, "lastprice", [asset])),
    safe(read<bigint>(vault, "mark_price", [asset])),
    safe(read<Record<string, bigint | number>>(vault, "funding_config", [asset])),
    safe(read<Record<string, bigint | number>>(vault, "funding_state", [asset])),
  ]);
  let fundingHourly: number | null = null;
  if (fc && fs) {
    const v = fundingView(parseFundingConfig(fc), parseFundingState(fs), nowSec);
    fundingHourly = v.off ? 0 : v.currentHourly;
  }
  return {
    oracle: pd ? Number(pd.price) / scale : null,
    oracleTs: pd ? Number(pd.timestamp) : null,
    mark: mk != null ? Number(mk) / scale : null,
    fundingHourly,
    maxAge: cfg ? Number(cfg.max_price_age) : null,
    at: nowSec,
  };
}

// ---- last-good cache (memory + localStorage) so a feed outage still shows the last chart
const mem = new Map<Timeframe, { bars: Bar[]; source: FeedSource; at: number }>();
const LS = (tf: Timeframe) => `qx:xlmchart:${tf}`;
export function saveBars(tf: Timeframe, v: { bars: Bar[]; source: FeedSource; at: number }) {
  mem.set(tf, v);
  try {
    localStorage.setItem(LS(tf), JSON.stringify({ ...v, bars: v.bars.slice(-300) }));
  } catch {
    /* storage full / unavailable */
  }
}
export function loadBars(tf: Timeframe): { bars: Bar[]; source: FeedSource; at: number } | null {
  const m = mem.get(tf);
  if (m) return m;
  try {
    const s = localStorage.getItem(LS(tf));
    if (!s) return null;
    const v = JSON.parse(s);
    return Array.isArray(v?.bars) && v.bars.length ? v : null;
  } catch {
    return null;
  }
}
