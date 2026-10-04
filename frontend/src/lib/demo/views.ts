/** Map demo simulator state (and the optional live-fleet mirror) onto the robot floor's DeskView model. */
import type { ChainPos, ChainTrade, DeskCfg, DeskView } from "../backOffice";
import { deskEquity, type DemoState } from "./engine";
import { profileOf } from "./profiles";
import { dailyLossPct, drawdownPct } from "../../../../bot/src/office/risk";

export const DEMO_UNIT = "demo $";

export function demoViews(st: DemoState, desks: DeskCfg[], price: number, spark: Record<number, number[]> = {}): DeskView[] {
  const pc = profileOf(st.profile).cfg;
  return desks.map((cfg0) => {
    const pd = pc.desks.find((x) => x.id === cfg0.id);
    const cfg = pd ? { ...cfg0, timeframeSec: pd.timeframeSec } : cfg0;
    const s = st.desks[cfg.id];
    const eq = deskEquity(s, price);
    const positions: ChainPos[] = s.positions.map((p) => {
      const pnl = ((p.side === "long" ? price - p.entry : p.entry - price) / p.entry) * p.size;
      return { id: p.id, side: p.side, margin: p.margin, size: p.size, leverage: p.size / p.margin, entry: p.entry, stop: p.stopLoss, takeProfit: p.takeProfit, pendingFunding: p.pendingFunding, upnl: pnl - p.pendingFunding };
    });
    const trades: ChainTrade[] = s.trades.map((t) => ({ kind: t.kind, id: t.id, side: t.side, leverage: t.leverage, price: t.price, pnl: t.pnl, reason: t.reason, ledger: t.seq, at: new Date(t.at * 1000).toISOString(), tx: `demo-${t.seq}` }));
    const rs = { equity: eq, dayStartEquity: s.dayStart.equity, peakEquity: s.peak, lossStreak: s.lossStreak, pausedUntil: s.pausedUntil, entryTimes: s.entryTimes };
    return {
      cfg: { ...cfg, capital: s.startEquity },
      status: st.fleet.killed ? "halted" : s.status,
      reason: st.fleet.killed ? `demo floor stop: ${st.fleet.killReason}` : s.statusReason,
      equity: eq,
      pnl: eq - s.startEquity,
      positions,
      trades,
      drift: s.drift,
      dailyLossPct: dailyLossPct(rs),
      drawdownPct: drawdownPct(rs),
      lastSignal: s.lastSignal,
      spark: spark[cfg.timeframeSec] ?? [],
      unit: DEMO_UNIT,
      watching: s.watching,
    };
  });
}

/** "Mirror the live testnet fleet": the real fleet's desks scaled to a notional balance (display-only, no simulation). */
export function mirrorViews(live: DeskView[], balance: number): DeskView[] {
  const base = live.reduce((a, d) => a + d.cfg.capital, 0) || 1;
  const k = balance / base;
  return live.map((d) => ({
    ...d,
    cfg: { ...d.cfg, capital: d.cfg.capital * k },
    equity: d.equity === null ? null : d.equity * k,
    pnl: d.pnl === null ? null : d.pnl * k,
    positions: d.positions.map((p) => ({ ...p, margin: p.margin * k, size: p.size * k, upnl: p.upnl * k, pendingFunding: p.pendingFunding * k })),
    trades: d.trades.map((t) => (t.pnl === undefined ? t : { ...t, pnl: t.pnl * k })),
    unit: "mirror $",
  }));
}

export interface BotStats {
  id: string;
  name: string;
  trades: number;
  wins: number;
  winRate: number | null;
  frameSec: number;
  pnl: number;
  maxDd: number;
  status: string;
}
export function botStats(st: DemoState, desks: DeskCfg[], price: number): BotStats[] {
  const pc = profileOf(st.profile).cfg;
  return desks.map((d) => {
    const s = st.desks[d.id];
    const closes = s.trades.filter((t) => t.kind === "close");
    const wins = closes.filter((t) => (t.pnl ?? 0) > 0).length;
    return { id: d.id, name: d.name, frameSec: pc.desks.find((x) => x.id === d.id)?.timeframeSec ?? d.timeframeSec, trades: closes.length, wins, winRate: closes.length ? wins / closes.length : null, pnl: deskEquity(s, price) - s.startEquity, maxDd: s.maxDd, status: st.fleet.killed ? "halted" : s.status };
  });
}
