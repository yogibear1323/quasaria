/**
 * Native Stellar liquidity-pool fee estimate.
 * Pure: no network, no placeholders. A missing, truncated, failed, or stale
 * 24h trade window withholds fee amounts and the annualized rate.
 * A zero is returned only for a complete window whose measured volume is zero.
 * The 30-day figure in USD uses that same fee. The fee asset is priced directly
 * when it is XLM or a USD-pegged stable. Otherwise, if the other asset has a
 * USD price, the fee asset is valued at this pool's reserve ratio. If neither
 * asset has a USD price, the monthly USD figure is unavailable. An incomplete
 * window withholds it. A complete window with no swaps is $0.00.
 *
 * Fee base: each pool trade is counted once, in one asset (the unit). The
 * protocol fee is `feeBp` / 10_000 of swap input; using the unit-asset amount
 * on that trade is the same convention as the Pools list.
 */
import { impermanentLoss, lpVsHold } from "./calc";
import { feeAmount } from "./fees";
import { sameAsset, type AssetRef } from "./nativePools";

export const WINDOW_MS = 86_400_000;
export const WINDOW_MAX_AGE_MS = 15 * 60_000;
export const TRADE_WINDOW_MAX_PAGES = 8;
export const MONTH_DAYS = 30;
export const YEAR_DAYS = 365;

export type WindowKind = "complete" | "truncated" | "unavailable" | "stale";

export type UnitTrade = {
  atMs: number;
  base: AssetRef;
  baseAmount: number;
  counter: AssetRef;
  counterAmount: number;
};

/** Amount of `unit` on this trade, counted on one side only. Null if the trade is not in `unit` or an amount is unusable. */
export function volumeOfTrade(t: UnitTrade, unit: AssetRef): number | null {
  const baseHit = sameAsset(t.base, unit);
  const counterHit = sameAsset(t.counter, unit);
  if (!baseHit && !counterHit) return null;
  const raw = baseHit ? t.baseAmount : t.counterAmount;
  if (!Number.isFinite(raw) || raw < 0) return null;
  return raw;
}

export type VolumeWalk = {
  ok: boolean;
  truncated: boolean;
  reachedCutoff: boolean;
  volumeInUnit: number;
  tradesInWindow: number;
  fetchedAtMs: number;
  newestTradeMs: number | null;
  oldestInWindowMs: number | null;
  pages: number;
};

export function emptyWalk(fetchedAtMs: number, ok = false): VolumeWalk {
  return { ok, truncated: false, reachedCutoff: false, volumeInUnit: 0, tradesInWindow: 0, fetchedAtMs, newestTradeMs: null, oldestInWindowMs: null, pages: 0 };
}

export type WalkState = {
  volumeInUnit: number;
  tradesInWindow: number;
  newestTradeMs: number | null;
  oldestInWindowMs: number | null;
  reachedCutoff: boolean;
  bad: boolean;
};

export const emptyWalkState = (): WalkState => ({
  volumeInUnit: 0, tradesInWindow: 0, newestTradeMs: null, oldestInWindowMs: null, reachedCutoff: false, bad: false,
});

/** Fold one Horizon page, oldest-stop at `nowMs - windowMs`. Trades must be newest-first, as Horizon returns them. */
export function consumePage(state: WalkState, trades: (UnitTrade | null)[], unit: AssetRef, nowMs: number, windowMs = WINDOW_MS): WalkState {
  if (state.bad || state.reachedCutoff) return state;
  const next: WalkState = { ...state };
  const cutoff = nowMs - windowMs;
  for (const t of trades) {
    if (!t || !Number.isFinite(t.atMs)) { next.bad = true; break; }
    if (next.newestTradeMs === null) next.newestTradeMs = t.atMs;
    if (t.atMs < cutoff) { next.reachedCutoff = true; break; }
    const vol = volumeOfTrade(t, unit);
    if (vol === null) { next.bad = true; break; }
    next.volumeInUnit += vol;
    next.tradesInWindow += 1;
    next.oldestInWindowMs = t.atMs;
  }
  return next;
}

export function finishWalk(state: WalkState, meta: { pages: number; maxPages: number; exhausted: boolean; fetchedAtMs: number }): VolumeWalk {
  if (state.bad || !Number.isFinite(meta.fetchedAtMs)) return { ...emptyWalk(meta.fetchedAtMs, false), pages: meta.pages };
  const reached = state.reachedCutoff || meta.exhausted;
  const truncated = !reached && meta.pages >= meta.maxPages;
  return {
    ok: true,
    truncated,
    reachedCutoff: reached,
    volumeInUnit: state.volumeInUnit,
    tradesInWindow: state.tradesInWindow,
    fetchedAtMs: meta.fetchedAtMs,
    newestTradeMs: state.newestTradeMs,
    oldestInWindowMs: state.oldestInWindowMs,
    pages: meta.pages,
  };
}

export function windowKind(walk: VolumeWalk | null, nowMs: number, maxAgeMs = WINDOW_MAX_AGE_MS): WindowKind {
  if (!walk || !walk.ok || !Number.isFinite(walk.fetchedAtMs) || !Number.isFinite(nowMs)) return "unavailable";
  const age = nowMs - walk.fetchedAtMs;
  if (age < -60_000) return "unavailable";
  if (age > maxAgeMs) return "stale";
  if (walk.truncated || !walk.reachedCutoff) return "truncated";
  return "complete";
}

/** Ratio-matched deposit. Share is after this deposit is inside the pool. */
export function matchedDeposit(reserveA: number, reserveB: number, driver: "A" | "B", amount: number): { amountA: number; amountB: number; share: number } | null {
  if (!(amount > 0) || !Number.isFinite(amount)) return null;
  if (!(reserveA > 0) || !(reserveB > 0) || !Number.isFinite(reserveA) || !Number.isFinite(reserveB)) return null;
  const amountA = driver === "A" ? amount : amount * (reserveA / reserveB);
  const amountB = driver === "B" ? amount : amount * (reserveB / reserveA);
  const share = amountA / (reserveA + amountA);
  if (!Number.isFinite(share) || share <= 0 || share >= 1) return null;
  return { amountA, amountB, share };
}

/** Value of both sides in the unit asset, using the pool's own reserve ratio. One unit, no second copy of the trade. */
export function valueInUnit(amountA: number, amountB: number, reserveA: number, reserveB: number, unitIsA: boolean): number | null {
  if (!(reserveA > 0) || !(reserveB > 0)) return null;
  const v = unitIsA ? amountA + amountB * (reserveA / reserveB) : amountB + amountA * (reserveB / reserveA);
  return Number.isFinite(v) && v > 0 ? v : null;
}

export type FeeLines = { code: string; amount: number }[];

export function platformFeeLines(amountA: number, codeA: string, amountB: number, codeB: string, fee: { enabled: boolean; bps: number }): { enabled: boolean; bps: number; deposit: FeeLines; withdraw: FeeLines } {
  if (!fee.enabled || !(fee.bps > 0)) return { enabled: false, bps: 0, deposit: [], withdraw: [] };
  const line = (amount: number, code: string) => ({ code, amount: feeAmount(amount, fee.bps) });
  const lines = [line(amountA, codeA), line(amountB, codeB)];
  return { enabled: true, bps: fee.bps, deposit: lines, withdraw: lines.map((l) => ({ ...l })) };
}

/**
 * Pre-deposit pool fee APR in percent (12.5 means 12.5%) for the pools table.
 * Truncation and missing inputs withhold the rate instead of annualizing a partial or unknown volume.
 */
export function tableFeeApr(volumeUsd: number | null, tvl: number | null, truncated: boolean, volumePending: boolean, feeBp = 30): number | "loading" | "incomplete" | "unknown" {
  if (volumePending) return "loading";
  if (truncated) return "incomplete";
  if (volumeUsd == null || !Number.isFinite(volumeUsd) || volumeUsd < 0 || !(tvl != null && tvl > 0) || !(feeBp > 0) || feeBp > 100) return "unknown";
  return (volumeUsd * (feeBp / 10_000) * 365 / tvl) * 100;
}

export type NativePoolSide = { reserveA: number; reserveB: number; feeBp: number; codeA: string; codeB: string };

export type MonthlyUsdVia = "unit" | "pool-ratio";

const finiteUsd = (p: number | null | undefined): number | null => (p != null && Number.isFinite(p) && p > 0 ? p : null);

/**
 * USD price of one unit of the asset the fee figure is already denominated in.
 * Direct when that asset's own price was supplied (live XLM, or $1 for a USD-pegged stable).
 * If only the other asset has a USD price, convert at this pool's reserve ratio
 * (other reserve / fee-asset reserve) and then that price. Null when neither asset
 * has a USD price. This does not invent a second fee or add a holder reward.
 */
export function feeAssetUsdPerUnit(
  unitIsA: boolean,
  reserveA: number,
  reserveB: number,
  usdA: number | null,
  usdB: number | null,
): { usdPerUnit: number; via: MonthlyUsdVia } | null {
  const direct = finiteUsd(unitIsA ? usdA : usdB);
  if (direct != null) return { usdPerUnit: direct, via: "unit" };
  const other = finiteUsd(unitIsA ? usdB : usdA);
  if (other == null) return null;
  const reserveUnit = unitIsA ? reserveA : reserveB;
  const reserveOther = unitIsA ? reserveB : reserveA;
  if (!(reserveUnit > 0) || !(reserveOther > 0) || !Number.isFinite(reserveUnit) || !Number.isFinite(reserveOther)) return null;
  const usdPerUnit = (reserveOther / reserveUnit) * other;
  if (!Number.isFinite(usdPerUnit) || !(usdPerUnit > 0)) return null;
  return { usdPerUnit, via: "pool-ratio" };
}

/**
 * USD value of the existing 30-day fee (already share × 24h fees × 30).
 * A zero fee is $0.00 with no price required. A non-zero fee with no price path is null.
 */
export function monthlyFeeUsd(
  monthlyInUnit: number,
  unitIsA: boolean,
  reserveA: number,
  reserveB: number,
  usdA: number | null,
  usdB: number | null,
): { usd: number; via: MonthlyUsdVia | null } | null {
  if (!Number.isFinite(monthlyInUnit) || monthlyInUnit < 0) return null;
  const px = feeAssetUsdPerUnit(unitIsA, reserveA, reserveB, usdA, usdB);
  if (monthlyInUnit === 0) return { usd: 0, via: px?.via ?? null };
  if (!px) return null;
  const usd = monthlyInUnit * px.usdPerUnit;
  if (!Number.isFinite(usd) || usd < 0) return null;
  return { usd, via: px.via };
}

export type NativeLpQuote = {
  window: WindowKind | "none";
  asOfIso: string | null;
  windowStartIso: string | null;
  windowEndIso: string | null;
  trades: number | null;
  pages: number | null;
  windowProblem: string | null;
  inputProblem: string | null;
  share: number | null;
  amountA: number | null;
  amountB: number | null;
  codeA: string;
  codeB: string;
  depositValue: { amount: number; code: string; usd: number | null } | null;
  usdUnavailable: boolean;
  fees: null | {
    daily: number;
    monthly: number;
    yearly: number;
    /** Fraction, e.g. 0.12 = 12% a year, simple. */
    apr: number;
    code: string;
    /** Direct USD price of the fee asset only. Null when that asset itself has no USD price. */
    usdPerUnit: number | null;
    /** Existing 30-day fee in USD. Null when the window is complete but neither leg can be priced. */
    monthlyUsd: number | null;
    /** Null when monthlyUsd is unavailable, or when the fee is zero and neither leg has a USD price. */
    monthlyUsdVia: MonthlyUsdVia | null;
    zeroVolume: boolean;
  };
  feeBp: number | null;
  platform: { enabled: boolean; bps: number; deposit: FeeLines; withdraw: FeeLines };
  il: null | { changePct: number; k: number; ilPct: number; hold: number; lp: number; loss: number; code: string };
};

const iso = (ms: number | null | undefined) => (ms != null && Number.isFinite(ms) ? new Date(ms).toISOString() : null);

const WINDOW_TEXT: Record<WindowKind, string> = {
  complete: "",
  truncated: "The 24 hour trade list was cut off before the window finished, so daily, monthly, yearly fees, the monthly USD estimate, and the annualized rate are withheld.",
  unavailable: "The 24 hour pool trades could not be read, so daily, monthly, yearly fees, the monthly USD estimate, and the annualized rate are withheld.",
  stale: "This read is older than 15 minutes, so daily, monthly, yearly fees, the monthly USD estimate, and the annualized rate are withheld. Refresh for a new window.",
};

export function quoteNativeLp(i: {
  pool: NativePoolSide | null;
  walk: VolumeWalk | null;
  nowMs: number;
  maxAgeMs?: number;
  deposit: number;
  driver: "A" | "B";
  unitCode: string;
  unitIsA: boolean;
  usdPerUnit: number | null;
  /**
   * Direct USD price of each pool asset (XLM live price, or 1 for a USD-pegged stable).
   * When omitted, only `usdPerUnit` is used, and only for the fee asset.
   */
  assetUsd?: { a: number | null; b: number | null };
  platform: { enabled: boolean; bps: number };
  priceChangePct: number;
}): NativeLpQuote {
  const codeA = i.pool?.codeA ?? "A";
  const codeB = i.pool?.codeB ?? "B";
  const base: NativeLpQuote = {
    window: "none", asOfIso: null, windowStartIso: null, windowEndIso: null, trades: null, pages: null,
    windowProblem: null, inputProblem: null, share: null, amountA: null, amountB: null, codeA, codeB,
    depositValue: null, usdUnavailable: !(i.usdPerUnit != null && Number.isFinite(i.usdPerUnit) && i.usdPerUnit > 0),
    fees: null, feeBp: null, platform: { enabled: false, bps: 0, deposit: [], withdraw: [] }, il: null,
  };
  if (!i.pool) {
    base.windowProblem = "This pair has no native pool on the ledger, so there is no fee estimate.";
    return base;
  }
  const feeBp = i.pool.feeBp;
  if (!Number.isFinite(feeBp) || feeBp <= 0 || feeBp > 100) {
    base.windowProblem = "The pool did not report a usable fee rate, so fee estimates are withheld.";
    return base;
  }
  base.feeBp = feeBp;
  if (!(i.pool.reserveA > 0) || !(i.pool.reserveB > 0)) {
    base.windowProblem = "This pool has no reserves, so a deposit share and a fee rate are withheld.";
    return base;
  }
  const kind = windowKind(i.walk, i.nowMs, i.maxAgeMs ?? WINDOW_MAX_AGE_MS);
  base.window = kind;
  const endMs = i.walk?.fetchedAtMs;
  base.asOfIso = iso(endMs);
  base.windowEndIso = iso(endMs);
  base.windowStartIso = endMs != null && Number.isFinite(endMs) ? iso(endMs - WINDOW_MS) : null;
  base.trades = i.walk?.ok ? i.walk.tradesInWindow : null;
  base.pages = i.walk?.pages ?? null;
  if (kind !== "complete") base.windowProblem = WINDOW_TEXT[kind];

  const dep = matchedDeposit(i.pool.reserveA, i.pool.reserveB, i.driver, i.deposit);
  if (!dep) {
    base.inputProblem = "Enter an amount of one asset greater than zero. Both sides are filled from the pool ratio.";
    return base;
  }
  base.share = dep.share;
  base.amountA = dep.amountA;
  base.amountB = dep.amountB;
  const value = valueInUnit(dep.amountA, dep.amountB, i.pool.reserveA, i.pool.reserveB, i.unitIsA);
  const usdPer = base.usdUnavailable ? null : i.usdPerUnit;
  if (value != null) base.depositValue = { amount: value, code: i.unitCode, usd: usdPer != null ? value * usdPer : null };
  base.platform = platformFeeLines(dep.amountA, codeA, dep.amountB, codeB, i.platform);

  const k = 1 + i.priceChangePct / 100;
  if (k > 0 && Number.isFinite(k)) {
    const vs = lpVsHold(dep.amountA, dep.amountB, k);
    base.il = { changePct: i.priceChangePct, k, ilPct: impermanentLoss(k), hold: vs.holdValueB, lp: vs.lpValueB, loss: vs.ilValueB, code: codeB };
  }

  if (kind !== "complete" || !i.walk) return base;
  const daily = i.walk.volumeInUnit * (feeBp / 10_000) * dep.share;
  if (!Number.isFinite(daily) || daily < 0 || value == null) {
    base.windowProblem = "The fee figure could not be valued in one asset, so the annualized rate and the monthly USD estimate are withheld.";
    base.fees = null;
    return base;
  }
  const apr = (daily * YEAR_DAYS) / value;
  const monthly = daily * MONTH_DAYS;
  const usdA = i.assetUsd ? i.assetUsd.a : (i.unitIsA ? usdPer : null);
  const usdB = i.assetUsd ? i.assetUsd.b : (i.unitIsA ? null : usdPer);
  const converted = monthlyFeeUsd(monthly, i.unitIsA, i.pool.reserveA, i.pool.reserveB, usdA, usdB);
  base.fees = {
    daily, monthly, yearly: daily * YEAR_DAYS, apr, code: i.unitCode, usdPerUnit: usdPer,
    monthlyUsd: converted?.usd ?? null, monthlyUsdVia: converted?.via ?? null, zeroVolume: i.walk.volumeInUnit === 0,
  };
  return base;
}
