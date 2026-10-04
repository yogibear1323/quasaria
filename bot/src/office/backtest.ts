/** Bar-by-bar backtest of an office strategy with the live sizing + stop rules (pure). Produces drift baselines. */
import type { Baseline } from "./drift.js";
import type { Candle } from "./indicators.js";
import { clampStop, sizePosition } from "./sizing.js";
import { createOfficeStrategy } from "./strategies.js";
import type { ChainPosition, DeskConfig, LimitsConfig } from "./types.js";

export interface BtTrade {
  side: "long" | "short";
  entry: number;
  exit: number;
  pnl: number;
  r: number;
  openedAt: number;
  closedAt: number;
  reason: string;
}
export interface BtResult {
  trades: BtTrade[];
  winRate: number;
  payoff: number;
  tradesPerDayP95: number;
  totalR: number;
  maxDrawdownPct: number;
  endEquity: number;
  days: number;
}

const FEE = 0.001; // vault open fee 10 bps

export function backtest(d: DeskConfig, bars: Candle[], L: LimitsConfig, startEquity = 500, warmup = 60): BtResult {
  const strat = createOfficeStrategy(d);
  let equity = startEquity, peak = startEquity, maxDd = 0;
  let pos: (ChainPosition & { risk: number }) | null = null;
  const trades: BtTrade[] = [];
  const closeAt = (price: number, t: number, reason: string) => {
    if (!pos) return;
    const raw = ((pos.side === "long" ? price - pos.entry : pos.entry - price) / pos.entry) * pos.size;
    const pnl = Math.max(raw, -pos.margin) - pos.size * FEE;
    equity += pnl;
    trades.push({ side: pos.side, entry: pos.entry, exit: price, pnl, r: pnl / pos.risk, openedAt: pos.openedAt, closedAt: t, reason });
    pos = null;
    peak = Math.max(peak, equity);
    maxDd = Math.max(maxDd, ((peak - equity) / peak) * 100);
  };
  for (let i = warmup; i < bars.length; i++) {
    const b = bars[i];
    const hist = bars.slice(Math.max(0, i - 299), i + 1); // the bar at i is now closed
    if (pos) {
      // intra-bar stop / take-profit (stop first when both touch — conservative)
      const p: ChainPosition & { risk: number } = pos;
      const slHit = p.side === "long" ? b.l <= p.stopLoss : b.h >= p.stopLoss;
      const tpHit = p.takeProfit > 0 && (p.side === "long" ? b.h >= p.takeProfit : b.l <= p.takeProfit);
      if (slHit) closeAt(p.side === "long" ? Math.min(p.stopLoss, b.o) : Math.max(p.stopLoss, b.o), b.t, "stop_loss");
      else if (tpHit) closeAt(p.takeProfit, b.t, "take_profit");
    }
    const ctx = { bars: hist, price: b.c, now: b.t + (bars[1].t - bars[0].t), fundingExtHourly: 0, fundingSamples: [], externalSkew: 0, trendBreakoutRecent: false };
    if (pos) {
      const mg = strat.manage(ctx, pos);
      if (mg.exit) closeAt(b.c, b.t, mg.exit);
      else if (mg.newStop) pos.stopLoss = mg.newStop;
      continue;
    }
    const sig = strat.entry(ctx);
    if (!sig) continue;
    const stop = clampStop(sig.side, b.c, sig.stop, L.minStopPct, L.maxStopPct);
    if (!stop) continue;
    const sz = sizePosition({ equity, riskPct: d.riskPct, hardMaxRiskPct: L.hardMaxRiskPct, entry: b.c, stop, maxLeverage: d.maxLeverage, maxMarginPct: L.maxMarginPct, maxNotionalX: L.maxNotionalX, minMargin: 10, feeBufferPct: L.feeBufferPct, mmBps: 500 });
    if (!sz.ok) continue;
    pos = { id: i, side: sig.side, margin: sz.margin, size: sz.notional, entry: b.c, openedAt: ctx.now, stopLoss: stop, takeProfit: sig.takeProfit, pendingFunding: 0, risk: sz.riskAmount };
  }
  const wins = trades.filter((t) => t.pnl > 0), losses = trades.filter((t) => t.pnl <= 0);
  const avg = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0);
  const days = bars.length > 1 ? (bars[bars.length - 1].t - bars[0].t) / 86_400 : 0;
  const perDay = new Map<number, number>();
  for (const t of trades) perDay.set(Math.floor(t.openedAt / 86_400), (perDay.get(Math.floor(t.openedAt / 86_400)) ?? 0) + 1);
  const counts = Array.from({ length: Math.max(1, Math.ceil(days)) }, (_, k) => perDay.get(Math.floor(bars[0].t / 86_400) + k) ?? 0).sort((a, b) => a - b);
  const p95 = counts[Math.min(counts.length - 1, Math.floor(counts.length * 0.95))];
  return {
    trades, winRate: trades.length ? wins.length / trades.length : 0, payoff: Math.abs(avg(losses.map((t) => t.r))) > 0 ? avg(wins.map((t) => t.r)) / Math.abs(avg(losses.map((t) => t.r))) : 0,
    tradesPerDayP95: p95, totalR: trades.reduce((a, t) => a + t.r, 0), maxDrawdownPct: maxDd, endEquity: equity, days,
  };
}

export function toBaseline(r: BtResult, source: string): Baseline {
  return { winRate: r.winRate, rSamples: r.trades.map((t) => Math.round(t.r * 1000) / 1000), tradesPerDayP95: Math.max(2, r.tradesPerDayP95), payoff: r.payoff, source }; // p95 floored at 2 so one busy day on a thin sample cannot trip the D-5 halt
}
