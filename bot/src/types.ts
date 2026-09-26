export type Side = "long" | "short";

export interface Position {
  id: number;
  owner: string;
  asset: string;
  side: Side;
  margin: number;
  size: number;
  entryPrice: number;
  openedAt: number;
  stopLoss: number; // 0 = unset (absolute price)
  takeProfit: number; // 0 = unset (absolute price)
  strategyId?: string;
}

export type Action =
  | { kind: "open"; strategyId: string; asset: string; side: Side; margin: number; leverage: number; stopLossPct: number; takeProfitPct: number; reason: string }
  | { kind: "close"; positionId: number; reason: string };

export interface Tick {
  time: number; // unix seconds
  price: number;
}

export interface StrategyContext {
  tick: Tick;
  positions: Position[]; // this strategy's open positions
}

export interface Strategy {
  readonly id: string;
  onTick(ctx: StrategyContext): Action[];
}
