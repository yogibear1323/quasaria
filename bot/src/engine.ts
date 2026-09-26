import type { BotConfig } from "./config.js";
import type { TradingVenue } from "./exchange.js";
import { triggerPrices, triggerHit } from "./math.js";
import { RiskManager } from "./risk.js";
import { createStrategy, GridStrategy } from "./strategies/index.js";
import type { Strategy, Tick } from "./types.js";

export interface EngineEvent {
  time: number;
  type: "open" | "close" | "reject" | "error";
  strategyId?: string;
  detail: string;
}

/**
 * Drives strategies on each price tick: collect actions -> risk checks ->
 * execute on the venue -> attach on-chain SL/TP triggers. Also enforces SL/TP
 * off-chain as a backup to the keeper.
 */
export class BotEngine {
  readonly strategies: Strategy[];
  readonly risk: RiskManager;
  readonly events: EngineEvent[] = [];
  realizedPnl = 0;

  constructor(cfg: BotConfig, private readonly venue: TradingVenue, private readonly owner: string, startingEquity: number) {
    this.strategies = cfg.strategies.map(createStrategy);
    this.risk = new RiskManager(cfg.risk, startingEquity);
  }

  private emit(e: EngineEvent) {
    this.events.push(e);
  }

  async tick(asset: string, tick: Tick) {
    const all = await this.venue.positions(this.owner);
    // 1) off-chain SL/TP backup
    for (const p of all) {
      if (p.asset !== asset) continue;
      const hit = triggerHit(p, tick.price);
      if (hit) await this.close(p.id, hit, tick.time, p.strategyId);
    }
    // 2) strategies
    for (const s of this.strategies) {
      const mine = (await this.venue.positions(this.owner)).filter((p) => p.strategyId === s.id && p.asset === asset);
      const actions = s.onTick({ tick, positions: mine });
      for (const a of actions) {
        const open = (await this.venue.positions(this.owner)).length;
        const reject = this.risk.check(a, open, tick.time);
        if (reject) {
          this.emit({ time: tick.time, type: "reject", strategyId: s.id, detail: reject });
          continue;
        }
        try {
          if (a.kind === "open") {
            const p = await this.venue.open({ owner: this.owner, asset: a.asset, side: a.side, margin: a.margin, leverage: a.leverage, strategyId: a.strategyId });
            const t = triggerPrices(a.side, p.entryPrice, a.stopLossPct, a.takeProfitPct);
            await this.venue.setTriggers(p.id, t.stopLoss, t.takeProfit);
            if (s instanceof GridStrategy) s.onOpened(p.id, p.entryPrice);
            this.emit({ time: tick.time, type: "open", strategyId: s.id, detail: `#${p.id} ${a.side} ${a.leverage}x margin ${a.margin} @ ${p.entryPrice.toFixed(6)} (${a.reason})` });
          } else {
            await this.close(a.positionId, a.reason, tick.time, s.id);
          }
        } catch (e) {
          this.emit({ time: tick.time, type: "error", strategyId: s.id, detail: (e as Error).message });
        }
      }
    }
  }

  private async close(id: number, reason: string, time: number, strategyId?: string) {
    try {
      const r = await this.venue.close(id, reason);
      this.realizedPnl += r.pnl;
      this.risk.recordRealized(r.pnl, time);
      this.emit({ time, type: "close", strategyId, detail: `#${id} ${reason} pnl ${r.pnl.toFixed(4)}` });
    } catch (e) {
      this.emit({ time, type: "error", strategyId, detail: `close #${id}: ${(e as Error).message}` });
    }
  }
}

/** Deterministic geometric random walk for paper trading. */
export function* randomWalk(start: number, steps: number, volPerStep = 0.004, seed = 1, t0 = 1_760_000_000, dt = 3600): Generator<Tick> {
  let s = seed >>> 0;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  let p = start;
  for (let i = 0; i < steps; i++) {
    const z = Math.sqrt(-2 * Math.log(rnd() || 1e-9)) * Math.cos(2 * Math.PI * rnd());
    p = p * Math.exp(volPerStep * z);
    yield { time: t0 + i * dt, price: p };
  }
}
