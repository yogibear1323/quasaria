import type { Candle } from "./indicators.js";
export type Side = "long" | "short";
export type StrategyKind = "trend" | "funding" | "meanrev" | "supertrend" | "liqpocket";
export type DeskStatus = "running" | "paused" | "halted";
export type DriftMode = "strict" | "standard";

export interface DeskConfig {
  id: string; // vega, rigel, …
  name: string;
  strategy: StrategyKind;
  timeframeSec: number; // bar size the strategy decides on
  riskPct: number; // % of desk equity per trade
  maxLeverage: number;
  capital: number; // initial test QUSD
  params: Record<string, number>;
  /** config-level pause (reason): the desk takes no new entries but still manages and closes anything it holds. */
  paused?: string;
  /** optional display label, e.g. "Experimental · liquidity pockets · simulated/testnet". */
  label?: string;
}

export interface LimitsConfig {
  hardMaxRiskPct: number; // 2
  maxMarginPct: number; // 25
  maxNotionalX: number; // 1.5 × desk equity
  maxOpenPerDesk: number; // 2
  minStopPct: number; // 0.8
  maxStopPct: number; // 7.5
  feeBufferPct: number; // 0.25
  deskDailyLossPct: number; // 3
  deskDrawdownPct: number; // 10
  lossStreak: number; // 5
  lossStreakPauseSec: number; // 4h
  entriesPerDeskDay: number; // 6
  fundingGuardHourly: number; // 0.0003 (0.03 %/h)
  fleetOpenRiskPct: number; // 5
  fleetSameDirRiskPct: number; // 3.5
  fleetNetNotionalX: number; // 1.5
  fleetGrossNotionalX: number; // 2
  fleetReserveFrac: number; // 0.5
  fleetDailyLossPct: number; // 4
  fleetDrawdownPct: number; // 12
  entriesPerFleetDay: number; // 24
}

export interface OfficeConfig {
  loopSec: number;
  driftMode: DriftMode;
  strictUntil?: string; // ISO; strict thresholds until then (then standard)
  oracle: { warnAgeSec: number; haltAgeSec: number; staleFlatSec: number; warnDevPct: number; haltDevPct: number; killAfterBadSec: number };
  limits: LimitsConfig;
  desks: DeskConfig[];
}

/** Market snapshot shared by all desks in one loop. */
export interface MarketSnapshot {
  now: number;
  oraclePrice: number;
  oracleTs: number;
  referencePrice: number | null;
  reserve: number; // vault liquidity (counterparty reserve)
  longOi: number;
  shortOi: number;
  funding: { k: number; skewScale: number; maxPremium: number; capPerHour: number; interestPerInterval: number; interval: number; predictedHourly: number };
  bars: Record<number, Candle[]>; // closed bars by timeframe (reference market)
}

export interface ChainPosition {
  id: number;
  side: Side;
  margin: number;
  size: number;
  entry: number;
  openedAt: number;
  stopLoss: number;
  takeProfit: number;
  pendingFunding: number; // > 0 owes
}

export interface Signal {
  side: Side;
  stop: number;
  takeProfit: number; // 0 = none
  reason: string;
}
