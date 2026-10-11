import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { OfficeConfig } from "./types.js";

export const DEFAULT_CONFIG_PATH = fileURLToPath(new URL("../../office.config.json", import.meta.url));

/** GitHub issue #30: revisit Orion's failed gate before any bigger rollout. */
export const ISSUE_30 = "https://github.com/yogibear1323/quasaria/issues/30";
export const ORION_SLICE_MAX_USD = 100;
export const ISSUE_30_PAUSED_DESKS = ["echo", "nova"];
export interface ConfigOptions {
  /** `--ack-issue-30`: allow raising Orion's live slice above $100 or unpausing Echo/Nova (issue #30). */
  ackIssue30?: boolean;
}

export function parseOfficeConfig(raw: unknown, opts: ConfigOptions = {}): OfficeConfig {
  const c = raw as OfficeConfig;
  const L = c.limits;
  const fail = (m: string) => {
    throw new Error(`office config: ${m}`);
  };
  if (!Array.isArray(c.desks) || c.desks.length === 0) fail("no desks");
  const ids = new Set<string>();
  for (const d of c.desks) {
    if (ids.has(d.id)) fail(`duplicate desk ${d.id}`);
    ids.add(d.id);
    if (!["trend", "funding", "meanrev", "supertrend", "liqpocket"].includes(d.strategy)) fail(`${d.id}: unknown strategy ${d.strategy}`);
    if (!(d.riskPct > 0 && d.riskPct <= L.hardMaxRiskPct)) fail(`${d.id}: riskPct must be in (0, ${L.hardMaxRiskPct}]`);
    if (!(d.maxLeverage >= 1 && d.maxLeverage <= 10)) fail(`${d.id}: maxLeverage must be 1..10 (vault cap)`);
    if (![900, 3600, 14400].includes(d.timeframeSec)) fail(`${d.id}: timeframe must be 900/3600/14400`);
    if (ISSUE_30_PAUSED_DESKS.includes(d.id) && !d.paused && !opts.ackIssue30)
      fail(`${d.id}: unpausing ${d.name} is blocked by issue #30 (${ISSUE_30}); pass --ack-issue-30 to override`);
  }
  for (const d of c.calibrated ?? []) {
    if (ids.has(d.id)) fail(`duplicate desk ${d.id}`);
    ids.add(d.id);
    if (!["shadow", "paper", "desk", "live"].includes(d.mode)) fail(`${d.id}: mode must be shadow|paper|desk|live`);
    if (d.mode === "live" || d.mode === "desk") {
      if (d.liveOverride !== undefined && d.liveOverride !== "testnet-tiny") fail(`${d.id}: liveOverride must be "testnet-tiny"`);
      if (d.capital > ORION_SLICE_MAX_USD && !opts.ackIssue30)
        fail(`${d.id}: live slice ${d.capital} > $${ORION_SLICE_MAX_USD} is blocked by issue #30 (${ISSUE_30}); pass --ack-issue-30 to override`);
      if (d.liveOverride === "testnet-tiny") {
        const lv = d.live;
        if (!d.liveApproval) fail(`${d.id}: liveOverride needs liveApproval (who approved, when)`);
        if (!lv) fail(`${d.id}: liveOverride needs live slice limits`);
        if (!(d.riskPct <= 0.25)) fail(`${d.id}: tiny slice riskPct must be <= 0.25`);
        if (!(d.maxLeverage <= 2)) fail(`${d.id}: tiny slice maxLeverage must be <= 2`);
        if (!(lv!.maxOpen === 1)) fail(`${d.id}: tiny slice maxOpen must be 1`);
        if (!(lv!.maxEntriesPerDay >= 1 && lv!.maxEntriesPerDay <= 4)) fail(`${d.id}: tiny slice maxEntriesPerDay must be 1..4`);
        if (!(lv!.dailyLossUsd > 0 && lv!.dailyLossUsd <= 0.02 * d.capital)) fail(`${d.id}: tiny slice dailyLossUsd must be in (0, 2 % of capital]`);
        if (!(lv!.killDrawdownUsd > 0 && lv!.killDrawdownUsd <= 0.05 * d.capital)) fail(`${d.id}: tiny slice killDrawdownUsd must be in (0, 5 % of capital]`);
      }
    }
    if (!(d.riskPct > 0 && d.riskPct <= 1 && d.riskPct <= L.hardMaxRiskPct)) fail(`${d.id}: calibrated riskPct must be in (0, 1] (1 % target, ${L.hardMaxRiskPct} % hard cap)`);
    if (!(d.maxLeverage >= 1 && d.maxLeverage <= 5)) fail(`${d.id}: maxLeverage must be 1..5`);
    if (![900, 3600, 14400].includes(d.timeframeSec)) fail(`${d.id}: timeframe must be 900/3600/14400`);
    if (!d.model) fail(`${d.id}: model path required`);
  }
  if (L.hardMaxRiskPct > 2) fail("hardMaxRiskPct > 2 not allowed");
  if (!(c.loopSec >= 15)) fail("loopSec must be >= 15");
  if (!["strict", "standard"].includes(c.driftMode)) fail("driftMode");
  return c;
}

export const loadOfficeConfig = (path = DEFAULT_CONFIG_PATH, opts: ConfigOptions = {}) => parseOfficeConfig(JSON.parse(readFileSync(path, "utf8")), opts);
