/**
 * USD prices for the lending oracle, seeded from LIVE MAINNET Horizon (read-only) and pushed
 * to the TESTNET mock oracle. Same method as scripts/verify-mainnet-assets.ts and the
 * frontend's liveMarkets: units-per-XLM from the SDEX mid (tight books), else the largest
 * native AMM pool, else the last 1h candle; USD/XLM from Circle USDC. Stablecoins with only a
 * weak quote fall back to the public FX reference for their peg. Off-peg stablecoins keep
 * their (strong) MARKET price — they are never forced to 1.00.
 *
 * Mainnet would use a Reflector (SEP-40) feed instead of this script. SEP-38 anchor quotes are
 * never used for collateral pricing.
 */
export const MAINNET_HORIZON = "https://horizon.stellar.org";
export const MAINNET_USDC_ISSUER = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";

export type FeedAsset = {
  id: string;
  category: string;
  peg: string | null;
  offPeg: boolean;
  mainnet: { code: string; issuer: string } | null; // null = native XLM
  sac: string;
  snapshotPerXlm: number; // fallback: units per XLM from the last snapshot
};
export type Quote = { perXlm: number | null; source: string };
export type UsdPrice = { id: string; sac: string; usd: number; source: string };

type Json = Record<string, any>;
export type Fetcher = (url: string) => Promise<Json | null>;

export const defaultFetcher: Fetcher = async (url) => {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      if (r.ok) return (await r.json()) as Json;
      if (r.status === 404 || r.status === 400) return null;
    } catch {
      /* retry */
    }
    await new Promise((res) => setTimeout(res, 800 * (i + 1)));
  }
  return null;
};

const qs = (p: string, code: string, issuer: string) =>
  `${p}_asset_type=${code.length <= 4 ? "credit_alphanum4" : "credit_alphanum12"}&${p}_asset_code=${code}&${p}_asset_issuer=${issuer}`;

export const STRONG = new Set(["sdex-mid", "native-lp", "last-1h-candle(7d)"]);

/** Units of `code:issuer` per 1 XLM on mainnet. */
export async function quoteXlm(code: string, issuer: string, get: Fetcher, horizon = MAINNET_HORIZON): Promise<Quote> {
  const ob = await get(`${horizon}/order_book?selling_asset_type=native&${qs("buying", code, issuer)}&limit=1`);
  const bid = ob?.bids?.[0] ? Number(ob.bids[0].price) : null;
  const ask = ob?.asks?.[0] ? Number(ob.asks[0].price) : null;
  if (bid && ask && (ask - bid) / ((ask + bid) / 2) < 0.08) return { perXlm: (bid + ask) / 2, source: "sdex-mid" };
  const lp = await get(`${horizon}/liquidity_pools?reserves=native,${code}:${issuer}&limit=5`);
  const recs: Json[] = lp?._embedded?.records ?? [];
  const rec = [...recs].sort((a, b) => Number(b.total_shares) - Number(a.total_shares))[0];
  if (rec) {
    const x = Number(rec.reserves.find((r: Json) => r.asset === "native")?.amount ?? 0);
    const s = Number(rec.reserves.find((r: Json) => r.asset !== "native")?.amount ?? 0);
    if (x > 1000 && s > 0) return { perXlm: s / x, source: "native-lp" };
  }
  const end = Date.now();
  const ag = await get(`${horizon}/trade_aggregations?base_asset_type=native&${qs("counter", code, issuer)}&resolution=3600000&start_time=${end - 7 * 86_400_000}&end_time=${end}&order=desc&limit=1`);
  const close = ag?._embedded?.records?.[0]?.close;
  if (close) return { perXlm: Number(close), source: "last-1h-candle(7d)" };
  if (bid && ask) return { perXlm: (bid + ask) / 2, source: "sdex-mid(wide)" };
  if (bid || ask) return { perXlm: (bid ?? ask)!, source: "sdex-one-side" };
  return { perXlm: null, source: "none" };
}

/**
 * Pure: turn per-XLM quotes into USD prices.
 * - usdPerXlm: USDC units per XLM (live), else snapshot.
 * - stablecoins with a weak/no quote use the FX reference (1 / rates[peg] USD) when known.
 * - anything still unpriced falls back to the snapshot ratio (source "snapshot").
 */
export function toUsd(assets: FeedAsset[], quotes: Map<string, Quote>, usdPerXlm: number, fx: Record<string, number> | null): UsdPrice[] {
  const out: UsdPrice[] = [];
  for (const a of assets) {
    if (!a.mainnet) {
      out.push({ id: a.id, sac: a.sac, usd: usdPerXlm, source: "xlm/usdc" });
      continue;
    }
    const q = quotes.get(a.id);
    const strong = q?.perXlm && STRONG.has(q.source);
    if (strong) {
      out.push({ id: a.id, sac: a.sac, usd: usdPerXlm / q!.perXlm!, source: `mainnet:${q!.source}${a.offPeg ? " (off-peg, market price)" : ""}` });
      continue;
    }
    const rate = a.category === "stablecoin" && a.peg && fx ? fx[a.peg] : undefined;
    if (rate && rate > 0) {
      out.push({ id: a.id, sac: a.sac, usd: 1 / rate, source: `fx-reference:${a.peg}` });
      continue;
    }
    if (q?.perXlm) {
      out.push({ id: a.id, sac: a.sac, usd: usdPerXlm / q.perXlm, source: `mainnet:${q.source}` });
      continue;
    }
    out.push({ id: a.id, sac: a.sac, usd: usdPerXlm / a.snapshotPerXlm, source: "snapshot" });
  }
  return out;
}

async function pool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const res: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) {
        const k = i++;
        res[k] = await fn(items[k]);
      }
    }),
  );
  return res;
}

/** Fetch live mainnet quotes for all assets and convert to USD. */
export async function fetchUsdPrices(assets: FeedAsset[], opts: { get?: Fetcher; snapshotUsdPerXlm: number; horizon?: string }): Promise<{ prices: UsdPrice[]; usdPerXlm: number; usdSource: string }> {
  const get = opts.get ?? defaultFetcher;
  const usdc = await quoteXlm("USDC", MAINNET_USDC_ISSUER, get, opts.horizon);
  const live = usdc.perXlm && STRONG.has(usdc.source);
  const usdPerXlm = live ? usdc.perXlm! : opts.snapshotUsdPerXlm;
  const fxDoc = await get("https://open.er-api.com/v6/latest/USD");
  const fx = (fxDoc?.rates as Record<string, number> | undefined) ?? null;
  const quoted = assets.filter((a) => a.mainnet);
  const qs2 = await pool(quoted, 4, (a) => quoteXlm(a.mainnet!.code, a.mainnet!.issuer, get, opts.horizon).catch(() => ({ perXlm: null, source: "error" }) as Quote));
  const quotes = new Map(quoted.map((a, i) => [a.id, qs2[i]]));
  if (live) quotes.set("USDC", usdc);
  return { prices: toUsd(assets, quotes, usdPerXlm, fx), usdPerXlm, usdSource: live ? "mainnet USDC sdex" : "snapshot" };
}

/** USD float → oracle integer with `decimals` (14 for the Quasaria mock). */
export function toOracleInt(usd: number, decimals = 14): bigint {
  if (!(usd > 0) || !Number.isFinite(usd)) throw new Error(`bad price ${usd}`);
  const [m, e] = usd.toExponential(12).split("e");
  const digits = m.replace(".", "").replace("-", "");
  const exp = Number(e) - 12 + decimals;
  return exp >= 0 ? BigInt(digits) * 10n ** BigInt(exp) : BigInt(digits) / 10n ** BigInt(-exp);
}

/** Load feed assets from deployments/testnet-assets.json (XLM + the 41 curated assets; QUSD excluded). */
export function feedAssetsFrom(doc: { assets: Array<Record<string, any>> }, ids?: Set<string>): FeedAsset[] {
  return doc.assets
    .filter((a) => a.id !== "QUSD" && a.testnet?.sac && (!ids || ids.has(a.id)))
    .map((a) => ({
      id: a.id,
      category: a.category,
      peg: a.peg ?? null,
      offPeg: Boolean(a.offPeg),
      mainnet: a.mainnet ? { code: a.mainnet.code, issuer: a.mainnet.issuer } : null,
      sac: a.testnet.sac,
      snapshotPerXlm: Number(a.pricePerXlm),
    }));
}

/**
 * Fast perps-market price (XLM/USD only): one mainnet SDEX USDC order-book read, cross-checked against an independent
 * public reference (Coinbase XLM-USD ticker) when that is reachable. Returns null price when the quote is not live.
 */
export async function fetchXlmUsdFast(get: Fetcher = defaultFetcher, horizon = MAINNET_HORIZON): Promise<{ usd: number | null; source: string; reference: number | null }> {
  const ob = await get(`${horizon}/order_book?selling_asset_type=native&${qs("buying", "USDC", MAINNET_USDC_ISSUER)}&limit=1`);
  const bid = ob?.bids?.[0] ? Number(ob.bids[0].price) : null;
  const ask = ob?.asks?.[0] ? Number(ob.asks[0].price) : null;
  const usd = bid && ask && (ask - bid) / ((ask + bid) / 2) < 0.02 ? (bid + ask) / 2 : null;
  const ref = await get("https://api.exchange.coinbase.com/products/XLM-USD/ticker").catch(() => null);
  const reference = ref?.price ? Number(ref.price) : null;
  return { usd, source: usd ? "mainnet USDC sdex-mid" : "none", reference: reference && reference > 0 ? reference : null };
}

export type PushDecision = { push: true } | { push: false; reason: string };

/**
 * Never publish a stale or suspicious price as fresh:
 *  - the XLM/USD quote must be live (not the cached snapshot fallback);
 *  - when an independent reference is available it must agree within `maxDevPct`;
 *  - a jump of more than `maxJumpPct` vs the last pushed price within one fast interval is held back once
 *    (pushed only if the next read confirms it).
 */
export function decideXlmPush(p: { usd: number | null; source: string; reference: number | null; lastPushed: number | null; pendingJump: number | null }, maxDevPct = 1.5, maxJumpPct = 5): PushDecision & { pendingJump?: number | null } {
  if (!p.usd || !(p.usd > 0) || p.source === "snapshot" || p.source === "none") return { push: false, reason: `no live XLM/USD quote (${p.source})` };
  if (p.reference) {
    const dev = (Math.abs(p.usd - p.reference) / p.reference) * 100;
    if (dev > maxDevPct) return { push: false, reason: `XLM/USD ${p.usd.toFixed(5)} deviates ${dev.toFixed(2)}% from reference ${p.reference.toFixed(5)} (> ${maxDevPct}%)` };
  }
  if (p.lastPushed) {
    const jump = (Math.abs(p.usd - p.lastPushed) / p.lastPushed) * 100;
    if (jump > maxJumpPct) {
      const confirmed = p.pendingJump && Math.abs(p.usd - p.pendingJump) / p.pendingJump < 0.01;
      if (!confirmed) return { push: false, reason: `jump ${jump.toFixed(2)}% vs last push; waiting for confirmation`, pendingJump: p.usd };
    }
  }
  return { push: true, pendingJump: null };
}

/** Drop prices that came from the cached snapshot; refuse the whole batch if XLM/USD itself is the snapshot. */
export function filterFreshPrices(prices: UsdPrice[], usdSource: string): { fresh: UsdPrice[]; skipped: string[]; refused?: string } {
  if (usdSource === "snapshot") return { fresh: [], skipped: prices.map((p) => p.id), refused: "XLM/USD fell back to the cached snapshot: nothing pushed" };
  const fresh = prices.filter((p) => p.source !== "snapshot");
  return { fresh, skipped: prices.filter((p) => p.source === "snapshot").map((p) => p.id) };
}

// ---------------------------------------------------------------- multi-source XLM/USD + deviation-triggered pushes
/** Single attempt, short timeout: the fast loop polls every ~2 s and must never stall on one slow venue. */
export const quickFetcher: Fetcher = async (url) => {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(2_500), headers: { "user-agent": "quasaria-oracle-feed (testnet)" } });
    return r.ok ? ((await r.json()) as Json) : null;
  } catch {
    return null;
  }
};

export type SourceQuote = { source: string; usd: number | null };
const mid = (b: unknown, a: unknown) => {
  const bid = Number(b), ask = Number(a);
  return bid > 0 && ask > 0 && ask >= bid && (ask - bid) / ((ask + bid) / 2) < 0.01 ? (bid + ask) / 2 : null;
};

/** Independent public XLM/USD venues (best bid/ask mid; null when unreachable or the book is crossed/wide). */
export const XLM_SOURCES: Record<string, { url: string; parse: (j: Json) => number | null }> = {
  coinbase: { url: "https://api.exchange.coinbase.com/products/XLM-USD/ticker", parse: (j) => mid(j.bid, j.ask) },
  kraken: { url: "https://api.kraken.com/0/public/Ticker?pair=XLMUSD", parse: (j) => { const r = j.result && (Object.values(j.result)[0] as Json | undefined); return r ? mid(r.b?.[0], r.a?.[0]) : null; } },
  bitstamp: { url: "https://www.bitstamp.net/api/v2/ticker/xlmusd/", parse: (j) => mid(j.bid, j.ask) },
};

export async function fetchXlmSources(get: Fetcher = quickFetcher, names = Object.keys(XLM_SOURCES)): Promise<SourceQuote[]> {
  return Promise.all(
    names.map(async (n) => {
      const j = await get(XLM_SOURCES[n].url).catch(() => null);
      let usd: number | null = null;
      try {
        usd = j ? XLM_SOURCES[n].parse(j) : null;
      } catch {
        usd = null;
      }
      return { source: n, usd: usd && Number.isFinite(usd) && usd > 0 ? usd : null };
    }),
  );
}

const median = (v: number[]) => {
  const s = [...v].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export type CrossCheck = { ok: true; usd: number; used: string[]; outliers: string[] } | { ok: false; reason: string; outliers: string[] };
/**
 * Cross-check independent sources: the price is the median of the sources within `maxSpreadPct` of the overall median,
 * and at least `minSources` must agree. Fewer live sources, or no agreeing pair, -> no price (the push is skipped and
 * flagged; the vault then rejects trading once the on-chain price is older than max_price_age — fail closed).
 */
export function crossCheck(quotes: SourceQuote[], maxSpreadPct = 0.5, minSources = 2): CrossCheck {
  const live = quotes.filter((q): q is { source: string; usd: number } => q.usd !== null && q.usd > 0);
  if (live.length < minSources) return { ok: false, reason: `only ${live.length} live source(s) (${live.map((q) => q.source).join(", ") || "none"}); need ${minSources}`, outliers: [] };
  const m = median(live.map((q) => q.usd));
  const agree = live.filter((q) => (Math.abs(q.usd - m) / m) * 100 <= maxSpreadPct);
  const outliers = live.filter((q) => !agree.includes(q)).map((q) => `${q.source} ${q.usd.toFixed(5)} (${(((q.usd - m) / m) * 100).toFixed(2)}%)`);
  if (agree.length < minSources) return { ok: false, reason: `sources disagree by more than ${maxSpreadPct}%: ${live.map((q) => `${q.source} ${q.usd.toFixed(5)}`).join(", ")}`, outliers };
  return { ok: true, usd: median(agree.map((q) => q.usd)), used: agree.map((q) => q.source), outliers };
}

export type FastDecision = { push: true; why: "first" | "deviation" | "heartbeat"; movePct: number; pendingJump: null } | { push: false; reason: string; pendingJump: number | null };
/**
 * When to push XLM/USD: immediately when the cross-checked price moved >= `devPct` from the last pushed price
 * (deviation trigger), otherwise every `heartbeatSec` (keeps the on-chain age well under the vault's 90 s).
 * A move > `maxJumpPct` within one poll is held until the next read confirms it.
 */
export function decideFastPush(p: { usd: number; lastPushed: number | null; lastPushAt: number; now: number; pendingJump: number | null }, devPct = 0.12, heartbeatSec = 20, maxJumpPct = 5): FastDecision {
  if (!p.lastPushed) return { push: true, why: "first", movePct: 0, pendingJump: null };
  const move = (Math.abs(p.usd - p.lastPushed) / p.lastPushed) * 100;
  if (move > maxJumpPct) {
    const confirmed = p.pendingJump && Math.abs(p.usd - p.pendingJump) / p.pendingJump < 0.01;
    if (!confirmed) return { push: false, reason: `jump ${move.toFixed(2)}% vs last push; waiting for confirmation`, pendingJump: p.usd };
  }
  if (move >= devPct) return { push: true, why: "deviation", movePct: move, pendingJump: null };
  if (p.now - p.lastPushAt >= heartbeatSec) return { push: true, why: "heartbeat", movePct: move, pendingJump: null };
  return { push: false, reason: "within band", pendingJump: null };
}
