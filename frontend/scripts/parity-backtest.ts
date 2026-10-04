/**
 * Research parity harness (not shipped): run ONE Active desk through the real demo engine `step()` on cached candles
 * (/tmp/parity_bars.json from research/parity_dump.py), single-desk config, $500 desk, funding 0. Prints trades as JSON.
 *   cd bot && npx tsx ../frontend/scripts/parity-backtest.ts <deskId>
 */
import { readFileSync } from "node:fs";
import { aggregate, type Candle } from "../../bot/src/office/indicators";
import { SIM, closedBy, deskEquity, newDemo, step } from "../src/lib/demo/engine";
import { ACTIVE } from "../src/lib/demo/profiles";

const deskId = process.argv[2] ?? "vega";
const J = JSON.parse(readFileSync("/tmp/parity_bars.json", "utf8"));
const m1: Candle[] = J["60"], m5: Candle[] = J["300"], m15: Candle[] = J["900"], m30 = aggregate(m15, 900, 2);
const desk = ACTIVE.desks.find((d) => d.id === deskId)!;
const cfg = { ...ACTIVE, desks: [desk] };
let st = newDemo(500, J.start, "parity", "active");
st = { ...st, desks: { [deskId]: { ...st.desks[deskId], free: 500, startEquity: 500, dayStart: { day: Math.floor(J.start / 86400), equity: 500 }, peak: 500 } } };
const closes: unknown[] = [];
for (const b of m1) {
  const t = b.t + 60;
  if (t <= J.start) continue;
  const bars: Record<number, Candle[]> = { 60: closedBy(m1, 60, t).slice(-300), 300: closedBy(m5, 300, t).slice(-300), 900: closedBy(m15, 900, t).slice(-300), 1800: closedBy(m30, 1800, t).slice(-300) };
  st = step(st, { now: t, price: b.c, hi: b.h, lo: b.l, bars, fundingHourly: 0, extSkew: 0 }, cfg, {}, SIM);
}
const s = st.desks[deskId];
const lastPx = m1[m1.length - 1].c;
console.log(JSON.stringify({ desk: deskId, closed: s.closed.length, trades: s.trades.slice().reverse().map((x) => ({ k: x.kind, side: x.side, at: x.at, px: x.price, pnl: x.pnl, reason: x.reason.slice(0, 30) })), net: deskEquity(s, lastPx) - 500, status: s.status, why: s.statusReason }));
