import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { OfficeConfig } from "./types.js";

export const DEFAULT_CONFIG_PATH = fileURLToPath(new URL("../../office.config.json", import.meta.url));

export function parseOfficeConfig(raw: unknown): OfficeConfig {
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
  }
  for (const d of c.calibrated ?? []) {
    if (ids.has(d.id)) fail(`duplicate desk ${d.id}`);
    ids.add(d.id);
    if (!["shadow", "paper", "desk"].includes(d.mode)) fail(`${d.id}: mode must be shadow|paper|desk`);
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

export const loadOfficeConfig = (path = DEFAULT_CONFIG_PATH) => parseOfficeConfig(JSON.parse(readFileSync(path, "utf8")));
