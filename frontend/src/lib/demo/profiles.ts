/**
 * Demo trading profiles.
 *  - active (default for new demos): the live testnet fleet's desks and SLOWER settings (bot/office.config.json):
 *    Vega 1h Supertrend 10×3, Regal 4h trend, Halo 1h mean-reversion (each with the liquidity-pocket entry filter),
 *    Lyra 1h liquidity pockets (experimental), Echo and Nova paused. Ticks every few seconds on live prices (stops on
 *    1-minute highs/lows) with standard drift thresholds. Risk per trade, desk/floor caps, daily loss, drawdown halt,
 *    loss-streak pause, min margin and fees are the fleet's.
 *  - strict: identical config, fleet drift mode (strict until the date in office.config.json), 15-minute ticks.
 * The earlier fast 15s–30m Active overrides were removed after the walk-forward study found them net negative
 * out-of-sample.
 */
import officeJson from "../../../../bot/office.config.json";
import baselineJson from "../../../../bot/office.baselines.json";
import type { Baseline } from "../../../../bot/src/office/drift";
import type { DeskConfig, OfficeConfig } from "../../../../bot/src/office/types";

export type Profile = "active" | "strict";
export const OFFICE = officeJson as unknown as OfficeConfig;
export const BASELINES = (baselineJson as unknown as { desks: Record<string, Baseline> }).desks;
export const ACTIVE_BASELINES = BASELINES;

/** Per-desk overrides for Active (keyed by internal desk id; "rigel" is displayed as Regal). Empty: Active runs the fleet settings. */
export const ACTIVE_DESKS: Record<string, Pick<DeskConfig, "timeframeSec" | "params">> = {};

/** Fleet rule: mean-rev desks stand aside for 4 h after any trend / Supertrend entry (same in both profiles). */
export const ACTIVE_TREND_GUARD_SEC = 4 * 3600;

export const ACTIVE: OfficeConfig = {
  ...OFFICE,
  driftMode: "standard",
  strictUntil: undefined,
  desks: OFFICE.desks.map((d) => ({ ...d, ...ACTIVE_DESKS[d.id], params: { ...d.params, ...ACTIVE_DESKS[d.id]?.params } })),
};

export const PROFILES: Record<Profile, { cfg: OfficeConfig; baselines: Record<string, Baseline>; label: string; blurb: string }> = {
  active: { cfg: ACTIVE, baselines: ACTIVE_BASELINES, label: "Active", blurb: "the fleet's slower 1h–4h settings, live price ticks every few seconds, same risk limits" },
  strict: { cfg: OFFICE, baselines: BASELINES, label: "Strict", blurb: "identical to the live testnet fleet (1h–4h frames, fleet drift mode)" },
};
export const profileOf = (p: Profile | undefined) => PROFILES[p ?? "strict"];

/** Frames the Active profile needs from the market layer. */
export const ACTIVE_FRAMES = [...new Set(ACTIVE.desks.map((d) => d.timeframeSec))].sort((a, b) => a - b);
