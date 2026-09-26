import type { Side } from "./types.js";

/** Hard ceiling mirrored from the vault contract (HARD_MAX_LEVERAGE_BPS = 20x). */
export const HARD_MAX_LEVERAGE = 20;

interface BaseStrategyConfig {
  id: string;
  asset: string;
  side: Side;
  leverage: number;
  margin: number;
  stopLossPct: number;
  takeProfitPct: number;
}
export interface GridConfig extends BaseStrategyConfig { type: "grid"; lower: number; upper: number; levels: number }
export interface DcaConfig extends BaseStrategyConfig { type: "dca"; intervalSec: number; maxOrders: number }
export interface MomentumConfig extends BaseStrategyConfig { type: "momentum"; fastPeriod: number; slowPeriod: number }
export type StrategyConfig = GridConfig | DcaConfig | MomentumConfig;

export interface BotConfig {
  network: "testnet";
  strategies: StrategyConfig[];
  risk: { maxLeverage: number; maxOpenPositions: number; maxDailyLossPct: number };
  keeper: { enabled: boolean; intervalSec: number };
}

export class ConfigError extends Error {}

const num = (v: unknown, name: string, min: number, max = Number.POSITIVE_INFINITY) => {
  if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max) throw new ConfigError(`${name} must be a number in [${min}, ${max}] (got ${String(v)})`);
  return v;
};

/** Validate an untrusted JSON config (e.g. exported from the UI). */
export function parseConfig(raw: unknown): BotConfig {
  if (!raw || typeof raw !== "object") throw new ConfigError("config must be an object");
  const c = raw as Record<string, unknown>;
  if (c.network !== "testnet") throw new ConfigError("network must be 'testnet' — mainnet is not supported by this scaffold");
  const risk = (c.risk ?? {}) as Record<string, unknown>;
  const maxLeverage = num(risk.maxLeverage ?? 5, "risk.maxLeverage", 1, HARD_MAX_LEVERAGE);
  const cfg: BotConfig = {
    network: "testnet",
    risk: {
      maxLeverage,
      maxOpenPositions: num(risk.maxOpenPositions ?? 5, "risk.maxOpenPositions", 1, 100),
      maxDailyLossPct: num(risk.maxDailyLossPct ?? 10, "risk.maxDailyLossPct", 0.1, 100),
    },
    keeper: {
      enabled: Boolean((c.keeper as Record<string, unknown> | undefined)?.enabled ?? true),
      intervalSec: num((c.keeper as Record<string, unknown> | undefined)?.intervalSec ?? 30, "keeper.intervalSec", 5),
    },
    strategies: [],
  };
  if (!Array.isArray(c.strategies)) throw new ConfigError("strategies must be an array");
  const ids = new Set<string>();
  for (const [i, s0] of c.strategies.entries()) {
    const s = s0 as Record<string, unknown>;
    const p = `strategies[${i}]`;
    const id = typeof s.id === "string" && s.id ? s.id : `${String(s.type)}-${i}`;
    if (ids.has(id)) throw new ConfigError(`${p}.id duplicated: ${id}`);
    ids.add(id);
    if (s.side !== "long" && s.side !== "short") throw new ConfigError(`${p}.side must be long|short`);
    const base = {
      id,
      asset: typeof s.asset === "string" ? s.asset : "XLM",
      side: s.side as Side,
      leverage: num(s.leverage, `${p}.leverage`, 1, maxLeverage),
      margin: num(s.margin, `${p}.margin`, 0.0000001),
      stopLossPct: num(s.stopLossPct, `${p}.stopLossPct`, 0.1, 100),
      takeProfitPct: num(s.takeProfitPct, `${p}.takeProfitPct`, 0.1, 10_000),
    };
    if (s.type === "grid") {
      const lower = num(s.lower, `${p}.lower`, 0);
      const upper = num(s.upper, `${p}.upper`, lower);
      if (upper <= lower) throw new ConfigError(`${p}: upper must be > lower`);
      cfg.strategies.push({ ...base, type: "grid", lower, upper, levels: num(s.levels, `${p}.levels`, 2, 200) });
    } else if (s.type === "dca") {
      cfg.strategies.push({ ...base, type: "dca", intervalSec: num(s.intervalSec, `${p}.intervalSec`, 60), maxOrders: num(s.maxOrders, `${p}.maxOrders`, 1, 1000) });
    } else if (s.type === "momentum") {
      const fast = num(s.fastPeriod, `${p}.fastPeriod`, 2, 500);
      const slow = num(s.slowPeriod, `${p}.slowPeriod`, fast + 1, 1000);
      cfg.strategies.push({ ...base, type: "momentum", fastPeriod: fast, slowPeriod: slow });
    } else throw new ConfigError(`${p}.type must be grid|dca|momentum`);
  }
  return cfg;
}
