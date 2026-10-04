/**
 * Demo trading profiles.
 *  - strict: exactly the live testnet fleet (bot/office.config.json, 15m–4h frames, fleet drift baselines).
 *  - active (default for new demos): every bot on its OWN shorter frame (15s … 30m) with looser entry thresholds so a
 *    fresh demo trades within minutes. Risk per trade, desk/floor caps, daily loss, drawdown halt, loss-streak pause,
 *    min margin and fees are unchanged. Demo only; the live fleet never loads this file.
 * Funding desks: real testnet funding is ~0, so in Active they run a "skew proxy" (candle buy/sell pressure on their own
 * frame, mapped onto the funding strategy's rate/skew inputs) — a contrarian flow variant, labelled as such, NOT funding.
 */
import officeJson from "../../../../bot/office.config.json";
import baselineJson from "../../../../bot/office.baselines.json";
import activeBaselineJson from "./active-baselines.json";
import type { Baseline } from "../../../../bot/src/office/drift";
import type { DeskConfig, OfficeConfig } from "../../../../bot/src/office/types";

export type Profile = "active" | "strict";
export const OFFICE = officeJson as unknown as OfficeConfig;
export const BASELINES = (baselineJson as unknown as { desks: Record<string, Baseline> }).desks;
export const ACTIVE_BASELINES = (activeBaselineJson as unknown as { desks: Record<string, Baseline> }).desks;

/** Per-desk overrides for Active (keyed by internal desk id; "rigel" is displayed as Regal): own timeframe + looser entry parameters (riskPct / maxLeverage untouched). */
export const ACTIVE_DESKS: Record<string, Pick<DeskConfig, "timeframeSec" | "params">> = {
  echo: { timeframeSec: 15, params: { bbK: 1.5, rsiLow: 40, rsiHigh: 60, maxAdx: 35, timeStopBars: 20 } },
  halo: { timeframeSec: 30, params: { bbK: 1.6, rsiLow: 38, rsiHigh: 62, maxAdx: 32, timeStopBars: 16 } },
  lyra: { timeframeSec: 60, params: { proxy: 1, proxyBars: 10, minRateHourly: 0.0001, exitRateHourly: 0.00002, minExternalSkew: 10_000, maxAbsReturnPct: 0.6, stopPct: 0.8, takeProfitPct: 1.0, maxHoldSec: 1_800 } },
  vega: { timeframeSec: 300, params: { breakout: 10, fast: 9, slow: 21 } },
  rigel: { timeframeSec: 900, params: { breakout: 10, fast: 9, slow: 21 } },
  nova: { timeframeSec: 1_800, params: { proxy: 1, proxyBars: 4, minRateHourly: 0.00009, exitRateHourly: 0.00002, minExternalSkew: 9_000, maxAbsReturnPct: 1.2, stopPct: 1.0, takeProfitPct: 1.5, maxHoldSec: 4 * 3600 } },
};

/** Fleet rule: mean-rev desks stand aside for 4 h after any trend entry. On Active's 5m/15m trend frames that would
 *  silence the 15s/30s mean-rev desks all day, so Active scales the guard to 20 min (~80 / 40 of their bars). */
export const ACTIVE_TREND_GUARD_SEC = 20 * 60;

export const ACTIVE: OfficeConfig = {
  ...OFFICE,
  driftMode: "standard", // documented relaxation: standard thresholds + frame-specific baselines (see active-baselines.json)
  strictUntil: undefined,
  desks: OFFICE.desks.map((d) => ({ ...d, ...ACTIVE_DESKS[d.id], params: { ...d.params, ...ACTIVE_DESKS[d.id]?.params } })),
};

export const PROFILES: Record<Profile, { cfg: OfficeConfig; baselines: Record<string, Baseline>; label: string; blurb: string }> = {
  active: { cfg: ACTIVE, baselines: ACTIVE_BASELINES, label: "Active", blurb: "each bot on its own 15s–30m frame, looser entries, same risk limits" },
  strict: { cfg: OFFICE, baselines: BASELINES, label: "Strict", blurb: "identical to the live testnet fleet (15m–4h frames)" },
};
export const profileOf = (p: Profile | undefined) => PROFILES[p ?? "strict"];

/** Frames the Active profile needs from the market layer. */
export const ACTIVE_FRAMES = [...new Set(ACTIVE.desks.map((d) => d.timeframeSec))].sort((a, b) => a - b);
