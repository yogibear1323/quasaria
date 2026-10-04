/**
 * Perps (Warp leverage vault + funding module) — read model and pure helpers.
 *
 * Source of truth: contracts/leverage-vault/src/lib.rs and contracts/pricing.
 * Only methods the contract actually exposes are called:
 *   always (deployed vault):  config, paused, liquidity, oracle, open_position_count,
 *                             open_position_ids_page, user_positions, position,
 *                             free_collateral, liquidation_price, health_factor
 *   funding module (new wasm): funding_config, funding_state, mark_price, pending_funding
 *   oracle (Reflector API):    decimals, lastprice
 * Funding methods are feature-detected: a vault whose wasm predates the funding
 * module answers "non-existent contract function", and the UI then shows
 * "Funding: not live yet" instead of numbers. Nothing here is ever faked.
 *
 * The vault id comes from the normal app config (CONTRACTS.vault, i.e.
 * src/config/testnet.json `contracts.vault`, overridable with VITE_VAULT_ID),
 * so pointing the page at a fresh testnet vault is a one-line config change.
 */
import { xdr } from "@stellar/stellar-sdk";
import { CONTRACTS, DEPLOYMENT } from "./config";
import { addr, assetOther, readContract, sym, u32, u64 } from "./soroban";
import { fromUnits } from "./format";

export const RATE_SCALE = 1e12;
export const HOUR = 3_600;
export const BPS = 10_000;
/** Above this gap between the oracle and the external reference the price is flagged. */
export const MAX_REFERENCE_DEVIATION = 0.05;
/** Positions scanned to derive open interest when the vault has no funding_state (old wasm). */
export const OI_SCAN_LIMIT = 100;
export const FUNDING_NOT_LIVE = "Funding: not live yet — in development · testnet";

/**
 * Vault `Asset` key of a market: Reflector-style `Stellar(Address)` or `Other(Symbol)`.
 * The halted first-generation vault keyed XLM as `Other("XLM")` (a price the
 * oracle feed no longer updates); fresh vaults key it as `Stellar(native XLM SAC)`.
 */
export type MarketKey = { type: "Stellar"; id: string } | { type: "Other"; code: string };
export type MarketSpec = { code: string; key: MarketKey };

/** First-generation Warp vault (no funding module, halted on a stale `Other("XLM")` price). */
export const LEGACY_VAULTS = ["CAKUVSFDQXQGGBO2ZYQEQH6HMRMMDV6DDF4HMGRKK4Y3O2TGFWDAM55V"];

type PerpsCfg = { markets?: { code: string; stellar?: string; other?: string }[]; collateralSymbol?: string };
const perpsCfg = ((DEPLOYMENT as unknown as { perps?: PerpsCfg }).perps ?? {}) as PerpsCfg;

/** Default market list for `vault` (markets cannot be enumerated on-chain: set_market has no list view). */
export function defaultMarkets(vault: string, cfg: PerpsCfg = perpsCfg, xlmSac = CONTRACTS.xlmSac): MarketSpec[] {
  if (cfg.markets?.length)
    return cfg.markets.map((m) => ({ code: m.code, key: m.stellar ? { type: "Stellar", id: m.stellar } : { type: "Other", code: m.other ?? m.code } }));
  return [{ code: "XLM", key: LEGACY_VAULTS.includes(vault) ? { type: "Other", code: "XLM" } : { type: "Stellar", id: xlmSac } }];
}

export const marketKeyScVal = (k: MarketKey) => (k.type === "Other" ? assetOther(k.code) : xdr.ScVal.scvVec([sym("Stellar"), addr(k.id)]));

/** Decoded `Asset` (["Stellar", "C…"] / ["Other", "XLM"]) → market code. */
export function codeOfAsset(a: unknown, markets: MarketSpec[]): string {
  const [t, v] = Array.isArray(a) ? [String(a[0]), String(a[1])] : ["", String(a)];
  const m = markets.find((x) => (x.key.type === "Stellar" ? t === "Stellar" && v === x.key.id : t === "Other" && v === x.key.code));
  if (m) return m.code;
  return t === "Stellar" ? `${v.slice(0, 4)}…${v.slice(-4)}` : v;
}

/** Perps settings: the vault id is the app's normal contract config (testnet.json `contracts.vault` / VITE_VAULT_ID). */
export const PERPS = {
  vault: CONTRACTS.vault,
  fallbackOracle: CONTRACTS.oracle,
  markets: defaultMarkets(CONTRACTS.vault),
  collateral: perpsCfg.collateralSymbol ?? "QUSD",
};

// ---------------------------------------------------------------- errors / feature detection

export type ReadFailure = "missing" | "stale" | "no-price" | "not-found" | "error";

/** Classify a failed read (message from readContract / simulation). */
export function classifyError(e: unknown): ReadFailure {
  const m = e instanceof Error ? e.message : String(e);
  if (/non-existent contract function|MissingValue/i.test(m)) return "missing";
  if (/Error\(Contract, #7\)/.test(m)) return "stale";
  if (/Error\(Contract, #6\)/.test(m)) return "no-price";
  if (/Error\(Contract, #8\)/.test(m)) return "not-found";
  return "error";
}

export type Opt<T> = { ok: true; value: T } | { ok: false; reason: ReadFailure; message: string };

export async function optional<T>(fn: () => Promise<T>): Promise<Opt<T>> {
  try {
    return { ok: true, value: await fn() };
  } catch (e) {
    return { ok: false, reason: classifyError(e), message: e instanceof Error ? e.message : String(e) };
  }
}

export const failureText: Record<ReadFailure, string> = {
  missing: "not on the deployed vault",
  stale: "oracle price stale — vault refuses",
  "no-price": "no oracle price",
  "not-found": "not found",
  error: "RPC error",
};

// ---------------------------------------------------------------- funding math (mirrors contracts/pricing)

export type FundingConfig = { interval: number; k: number; skewScale: number; maxPremium: number; maxFundingRatePerHour: number; interestPerInterval: number; maxCatchupIntervals: number };
export type FundingState = { longOi: number; shortOi: number; index: number; lastFundingTs: number; premium: number; premiumAcc: number; accStart: number; lastSampleTs: number };

/** All rates as fractions (0.0001 = 0.01 %); OI in collateral units. */
export function parseFundingConfig(c: Record<string, bigint | number>): FundingConfig {
  return {
    interval: Number(c.interval),
    k: Number(c.k) / RATE_SCALE,
    skewScale: fromUnits(c.skew_scale),
    maxPremium: Number(c.max_premium) / RATE_SCALE,
    maxFundingRatePerHour: Number(c.max_funding_rate_per_hour) / RATE_SCALE,
    interestPerInterval: Number(c.interest_per_interval) / RATE_SCALE,
    maxCatchupIntervals: Number(c.max_catchup_intervals),
  };
}

export function parseFundingState(s: Record<string, bigint | number>): FundingState {
  return {
    longOi: fromUnits(s.long_oi),
    shortOi: fromUnits(s.short_oi),
    index: Number(s.index) / RATE_SCALE,
    lastFundingTs: Number(s.last_funding_ts),
    premium: Number(s.premium) / RATE_SCALE,
    premiumAcc: Number(s.premium_acc) / RATE_SCALE,
    accStart: Number(s.acc_start),
    lastSampleTs: Number(s.last_sample_ts),
  };
}

const clamp = (v: number, b: number) => Math.max(-Math.max(0, b), Math.min(Math.max(0, b), v));

/** clamp(k * (long - short) / skew_scale, ±max_premium). */
export function skewPremium(longOi: number, shortOi: number, c: FundingConfig) {
  if (c.skewScale <= 0 || c.k === 0) return 0;
  return clamp((c.k * (longOi - shortOi)) / c.skewScale, c.maxPremium);
}

export const markFromPremium = (oracle: number, premium: number) => oracle * (1 + premium);

/** Per-interval rate cap = max_funding_rate_per_hour * interval / 1h. */
export const maxRatePerInterval = (c: FundingConfig) => (c.maxFundingRatePerHour * c.interval) / HOUR;

export const fundingRate = (premiumTwap: number, c: FundingConfig) => clamp(premiumTwap + c.interestPerInterval, maxRatePerInterval(c));

/** Normalise a per-interval rate to per hour. */
export const hourly = (ratePerInterval: number, interval: number) => (interval > 0 ? (ratePerInterval * HOUR) / interval : 0);

/** True when the vault's funding parameters are all zero (constructor default: funding switched off). */
export const fundingOff = (c: FundingConfig) => c.k === 0 && c.maxFundingRatePerHour === 0 && c.interestPerInterval === 0;

/**
 * Funding view for one market at `now` (unix s):
 *  - current: rate implied by the premium in force right now (instantaneous);
 *  - predicted: rate the next `update_funding` would charge — TWAP of the
 *    premium accumulated so far this interval, plus interest, clamped (what
 *    the contract computes, projected to `now`);
 *  - nextAt: end of the current interval.
 */
export function fundingView(c: FundingConfig, s: FundingState, now: number) {
  const premium = skewPremium(s.longOi, s.shortOi, c);
  const acc = s.premiumAcc + s.premium * Math.max(0, now - s.lastSampleTs);
  const elapsed = Math.max(0, now - s.accStart);
  const twap = elapsed > 0 ? acc / elapsed : s.premium;
  const current = fundingRate(premium, c);
  const predicted = fundingRate(twap, c);
  const nextAt = c.interval > 0 ? s.lastFundingTs + (Math.floor(Math.max(0, now - s.lastFundingTs) / c.interval) + 1) * c.interval : 0;
  return {
    premium,
    twap,
    currentPerInterval: current,
    predictedPerInterval: predicted,
    currentHourly: hourly(current, c.interval),
    predictedHourly: hourly(predicted, c.interval),
    nextAt,
    off: fundingOff(c),
  };
}

/** Signed funding owed by a position (> 0 pays). index values as fractions of notional. */
export const fundingOwed = (isLong: boolean, size: number, entryIndex: number, index: number) => size * (isLong ? index - entryIndex : entryIndex - index);

/** "+0.0125 %" with sign; "—" for non-finite. */
export function fmtRate(r: number | null | undefined, digits = 4) {
  if (r === null || r === undefined || !Number.isFinite(r)) return "—";
  const p = r * 100;
  return `${p > 0 ? "+" : p < 0 ? "−" : ""}${Math.abs(p).toFixed(digits)}%`;
}

/** Who pays at a given signed rate. */
export const payerText = (rate: number) => (rate > 0 ? "longs pay shorts" : rate < 0 ? "shorts pay longs" : "no transfer");

// ---------------------------------------------------------------- position math (mirrors contracts/leverage-vault)

export function pnl(isLong: boolean, size: number, entry: number, price: number) {
  if (entry <= 0) return 0;
  return (size * (isLong ? price - entry : entry - price)) / entry;
}

/** Price at which HF hits 1.0, with pending funding (> 0 owed) taken out of the margin like the contract. */
export function liquidationPrice(isLong: boolean, margin: number, size: number, entry: number, mmBps: number, pendingFunding = 0) {
  if (size <= 0) return NaN;
  const maint = (size * mmBps) / BPS;
  const delta = ((margin - pendingFunding - maint) * entry) / size;
  return isLong ? entry - delta : entry + delta;
}

export function healthFactor(margin: number, size: number, pnlV: number, mmBps: number, pendingFunding = 0) {
  const equity = margin - pendingFunding + pnlV;
  if (equity <= 0) return 0;
  const maint = (size * mmBps) / BPS;
  return maint > 0 ? equity / maint : Infinity;
}

/** Pre-trade estimate for the open form. `hourlyRate` null = funding not live (no estimate). */
export function estimateOpen(p: { isLong: boolean; margin: number; leverage: number; price: number; mmBps: number; openFeeBps: number; hourlyRate: number | null }) {
  const size = p.margin * p.leverage;
  const fee = (size * p.openFeeBps) / BPS;
  const liq = p.price > 0 && size > 0 ? liquidationPrice(p.isLong, p.margin, size, p.price, p.mmBps) : NaN;
  const distance = p.price > 0 && Number.isFinite(liq) ? Math.abs(p.price - liq) / p.price : NaN;
  // positive rate: longs pay, shorts receive. > 0 = the trader pays.
  const fundingPerHour = p.hourlyRate === null ? null : size * p.hourlyRate * (p.isLong ? 1 : -1);
  return { size, fee, need: p.margin + fee, liq, distance, fundingPerHour };
}

// ---------------------------------------------------------------- oracle freshness

/**
 * Staleness check. The vault rejects prices older than `max_price_age`, but the
 * mock oracle feed can restamp an old price as current, so the oracle is also
 * compared with an external reference (live XLM/USD from mainnet Horizon).
 */
export function priceHealth(p: { price: number | null; timestamp: number | null; now: number; maxAge: number; reference?: number | null; maxDeviation?: number }) {
  const reasons: string[] = [];
  if (p.price === null || p.timestamp === null) return { ageSec: null, stale: true, deviation: null, deviates: false, reasons: ["No oracle price for this market."] };
  const ageSec = Math.max(0, p.now - p.timestamp);
  const stale = ageSec > p.maxAge;
  if (stale) reasons.push(`Oracle price is ${fmtAge(ageSec)} old (vault max age ${fmtAge(p.maxAge)}): opening, closing and liquidations revert until the feed updates.`);
  let deviation: number | null = null;
  let deviates = false;
  if (p.reference && p.reference > 0) {
    deviation = (p.price - p.reference) / p.reference;
    deviates = Math.abs(deviation) > (p.maxDeviation ?? MAX_REFERENCE_DEVIATION);
    if (deviates) reasons.push(`Oracle price is ${fmtRate(deviation, 1)} away from the live reference ($${p.reference.toFixed(4)}); the testnet mock feed may be serving an old price.`);
  }
  return { ageSec, stale, deviation, deviates, reasons };
}

export function fmtAge(s: number) {
  if (!Number.isFinite(s)) return "—";
  if (s < 90) return `${Math.round(s)} s`;
  if (s < 5400) return `${Math.round(s / 60)} min`;
  if (s < 172_800) return `${(s / 3600).toFixed(1)} h`;
  return `${(s / 86_400).toFixed(1)} d`;
}

/** Open-interest totals from raw positions (fallback when funding_state is unavailable). */
export function oiFromPositions(ps: { asset: string; isLong: boolean; size: number }[], market: string) {
  let long = 0;
  let short = 0;
  for (const p of ps) if (p.asset === market) (p.isLong ? (long += p.size) : (short += p.size));
  return { long, short };
}

// ---------------------------------------------------------------- chain reads

export type Reader = <T>(contractId: string, method: string, args?: xdr.ScVal[]) => Promise<T>;

type RawPos = { id: bigint; owner: string; asset: [string, string | unknown]; is_long: boolean; margin: bigint; size: bigint; entry_price: bigint; stop_loss: bigint; take_profit: bigint; opened_at: bigint };

export type PerpsPosition = {
  id: number; owner: string; asset: string; isLong: boolean; margin: number; size: number; leverage: number; entry: number; sl: number; tp: number; openedAt: number;
  /** Vault's own liquidation_price view (includes projected funding on the funding wasm). */
  liqOnChain: number | null;
  /** pending_funding view (> 0 owes); null when not available. */
  pendingFunding: Opt<number>;
  /** health_factor view (bps → ratio); fails while the oracle is stale. */
  hfOnChain: Opt<number>;
};

export type PerpsMarket = {
  code: string;
  key: MarketKey;
  price: number | null;
  priceTs: number | null;
  fundingConfig: Opt<FundingConfig>;
  fundingState: Opt<FundingState>;
  markOnChain: Opt<number>;
  oi: { long: number; short: number; source: "funding_state" | "positions" | "none"; partial: boolean };
};

export type PerpsData = {
  vault: string;
  oracle: string;
  decimals: number;
  config: { maxLeverage: number; mmBps: number; liqBonusBps: number; openFeeBps: number; maxPriceAge: number; minMargin: number; maxPositionsPerUser: number; maxOpenPositions: number };
  paused: boolean;
  liquidity: number;
  openCount: number;
  markets: PerpsMarket[];
  positions: PerpsPosition[];
  free: number;
  /** Funding module present on the deployed wasm? */
  fundingLive: boolean;
  readAt: number;
};

function toPosition(p: RawPos, scale: number, markets: MarketSpec[]): Omit<PerpsPosition, "liqOnChain" | "pendingFunding" | "hfOnChain"> {
  const margin = fromUnits(p.margin);
  const size = fromUnits(p.size);
  return {
    id: Number(p.id), owner: String(p.owner), asset: codeOfAsset(p.asset, markets), isLong: p.is_long, margin, size, leverage: margin > 0 ? size / margin : 0,
    entry: Number(p.entry_price) / scale, sl: Number(p.stop_loss) / scale, tp: Number(p.take_profit) / scale, openedAt: Number(p.opened_at),
  };
}

/** Read everything the Perps page shows. `read` is injectable for tests. */
export async function readPerps(viewer: string, read: Reader = readContract as Reader, vault = PERPS.vault, markets: MarketSpec[] = PERPS.markets, now = Date.now() / 1000): Promise<PerpsData> {
  const [cfg, liquidity, openCount, paused, oracleOpt] = await Promise.all([
    read<Record<string, bigint | number>>(vault, "config"),
    read<bigint>(vault, "liquidity"),
    read<number>(vault, "open_position_count"),
    optional(() => read<boolean>(vault, "paused")),
    optional(() => read<string>(vault, "oracle")),
  ]);
  const oracle = oracleOpt.ok ? oracleOpt.value : PERPS.fallbackOracle;
  const decimals = Number(await read<number>(oracle, "decimals"));
  const scale = 10 ** decimals;

  // viewer positions
  const ids = viewer ? await optional(() => read<bigint[]>(vault, "user_positions", [addr(viewer)])) : ({ ok: true, value: [] } as Opt<bigint[]>);
  const positions: PerpsPosition[] = [];
  for (const id of ids.ok ? ids.value : []) {
    const raw = await optional(() => read<RawPos>(vault, "position", [u64(id)]));
    if (!raw.ok) continue;
    const base = toPosition(raw.value, scale, markets);
    const [liq, pend, hf] = await Promise.all([
      optional(() => read<bigint>(vault, "liquidation_price", [u64(id)])),
      optional(() => read<bigint>(vault, "pending_funding", [u64(id)])),
      optional(() => read<bigint>(vault, "health_factor", [u64(id)])),
    ]);
    positions.push({
      ...base,
      liqOnChain: liq.ok ? Number(liq.value) / scale : null,
      pendingFunding: pend.ok ? { ok: true, value: fromUnits(pend.value) } : pend,
      hfOnChain: hf.ok ? { ok: true, value: Number(hf.value) / BPS } : hf,
    });
  }

  // markets
  let scanned: { asset: string; isLong: boolean; size: number }[] | null = null;
  let scanPartial = false;
  const out: PerpsMarket[] = [];
  for (const { code, key } of markets) {
    const asset = marketKeyScVal(key);
    const pd = await optional(() => read<{ price: bigint; timestamp: bigint } | null>(oracle, "lastprice", [asset]));
    const price = pd.ok && pd.value ? Number(pd.value.price) / scale : null;
    const priceTs = pd.ok && pd.value ? Number(pd.value.timestamp) : null;
    const [fc, fs, mk] = await Promise.all([
      optional(() => read<Record<string, bigint | number>>(vault, "funding_config", [asset])),
      optional(() => read<Record<string, bigint | number>>(vault, "funding_state", [asset])),
      optional(() => read<bigint>(vault, "mark_price", [asset])),
    ]);
    const fundingConfig: Opt<FundingConfig> = fc.ok ? { ok: true, value: parseFundingConfig(fc.value) } : fc;
    const fundingState: Opt<FundingState> = fs.ok ? { ok: true, value: parseFundingState(fs.value) } : fs;
    let oi: PerpsMarket["oi"] = { long: 0, short: 0, source: "none", partial: false };
    if (fundingState.ok) oi = { long: fundingState.value.longOi, short: fundingState.value.shortOi, source: "funding_state", partial: false };
    else {
      if (!scanned) {
        scanned = [];
        const n = Math.min(Number(openCount), OI_SCAN_LIMIT);
        scanPartial = Number(openCount) > OI_SCAN_LIMIT;
        for (let start = 0; start < n; start += 100) {
          const page = await optional(() => read<bigint[]>(vault, "open_position_ids_page", [u32(start), u32(Math.min(100, n - start))]));
          if (!page.ok) break;
          for (const id of page.value) {
            const r = await optional(() => read<RawPos>(vault, "position", [u64(id)]));
            if (r.ok) scanned.push({ asset: codeOfAsset(r.value.asset, markets), isLong: r.value.is_long, size: fromUnits(r.value.size) });
          }
        }
      }
      oi = { ...oiFromPositions(scanned, code), source: "positions", partial: scanPartial };
    }
    out.push({ code, key, price, priceTs, fundingConfig, fundingState, markOnChain: mk.ok ? { ok: true, value: Number(mk.value) / scale } : mk, oi });
  }

  const free = viewer ? await optional(() => read<bigint>(vault, "free_collateral", [addr(viewer)])) : null;
  const fundingLive = out.some((m) => m.fundingConfig.ok || (!m.fundingConfig.ok && m.fundingConfig.reason !== "missing"));
  return {
    vault,
    oracle,
    decimals,
    config: {
      maxLeverage: Number(cfg.max_leverage_bps) / BPS,
      mmBps: Number(cfg.maintenance_margin_bps),
      liqBonusBps: Number(cfg.liquidation_bonus_bps),
      openFeeBps: Number(cfg.open_fee_bps),
      maxPriceAge: Number(cfg.max_price_age),
      minMargin: fromUnits(cfg.min_margin as bigint),
      maxPositionsPerUser: Number(cfg.max_positions_per_user),
      maxOpenPositions: Number(cfg.max_open_positions),
    },
    paused: paused.ok ? paused.value : false,
    liquidity: fromUnits(liquidity),
    openCount: Number(openCount),
    markets: out,
    positions,
    free: free && free.ok ? fromUnits(free.value) : 0,
    fundingLive,
    readAt: now,
  };
}

// ---------------------------------------------------------------- funding history (events)

export type FundingEvent = { ledger: number; when: string; market: string; intervals: number; charged: number; premiumTwap: number; rate: number; index: number };

/** Decode `funding_upd` events (FundingUpdated). */
export function decodeFundingEvent(e: { ledger: number; ledgerClosedAt: string; topic: unknown[]; value: Record<string, bigint | number> }, markets: MarketSpec[] = PERPS.markets): FundingEvent {
  return {
    ledger: e.ledger,
    when: e.ledgerClosedAt,
    market: codeOfAsset(e.topic[1], markets),
    intervals: Number(e.value.intervals),
    charged: Number(e.value.charged),
    premiumTwap: Number(e.value.premium_twap) / RATE_SCALE,
    rate: Number(e.value.rate) / RATE_SCALE,
    index: Number(e.value.index) / RATE_SCALE,
  };
}
