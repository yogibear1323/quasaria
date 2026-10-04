/**
 * Backtest of the demo "Active" profile on recent REAL XLM data (Coinbase public API), using the demo engine itself
 * (same strategy / sizing / risk / drift code as the fleet, simulated fills). Not shipped in the app bundle.
 *   cd bot && npx tsx ../frontend/scripts/active-backtest.ts [days=3] [tradeHours=6] [--write-baselines]
 * 1m/5m/15m/30m desks run over `days`; the 15s/30s desks only over the last `tradeHours` (built from public trades).
 */
import { writeFileSync } from "node:fs";
import { aggregate, type Candle } from "../../bot/src/office/indicators";
import { SIM, closedBy, deskEquity, newDemo, stepDemo, type DemoState, type SimParams } from "../src/lib/demo/engine";
import { ACTIVE, OFFICE } from "../src/lib/demo/profiles";
import { TradeTape, type Trade } from "../src/lib/demo/market";

const CB = "https://api.exchange.coinbase.com/products/XLM-USD";
const days = Number(process.argv[2] ?? 3), tradeHours = Number(process.argv[3] ?? 6), writeB = process.argv.includes("--write-baselines");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function get(url: string) {
  for (let k = 0; k < 4; k++) {
    const r = await fetch(url, { headers: { "user-agent": "quasaria-demo-backtest" } });
    if (r.ok) return { j: await r.json(), h: r.headers };
    await sleep(800);
  }
  throw new Error(url);
}
async function hist(gran: number, from: number, to: number): Promise<Candle[]> {
  const out = new Map<number, Candle>();
  for (let s = from; s < to; s += gran * 300) {
    const e = Math.min(to, s + gran * 300);
    const { j } = await get(`${CB}/candles?granularity=${gran}&start=${new Date(s * 1000).toISOString()}&end=${new Date(e * 1000).toISOString()}`);
    for (const r of j as number[][]) out.set(r[0], { t: r[0], l: r[1], h: r[2], o: r[3], c: r[4] });
    await sleep(250);
  }
  return [...out.values()].sort((a, b) => a.t - b.t);
}
async function tradesSince(since: number): Promise<Trade[]> {
  const all: Trade[] = [];
  let after: string | null = null;
  for (let page = 0; page < 40; page++) {
    const { j, h } = await get(`${CB}/trades?limit=1000${after ? `&after=${after}` : ""}`);
    const rows = (j as { trade_id: number; price: string; size: string; time: string }[]).map((r) => ({ id: r.trade_id, t: Date.parse(r.time) / 1000, price: Number(r.price), size: Number(r.size) }));
    all.push(...rows);
    after = h.get("cb-after");
    if (!rows.length || rows[rows.length - 1].t < since || !after) break;
    await sleep(250);
  }
  return all.filter((x) => x.t >= since - 3600);
}

const now = Math.floor(Date.now() / 1000);
const start = now - days * 86_400;
const warm = 60 * 300;
console.error("fetching candles…");
const [m1, m5, m15] = [await hist(60, start - warm, now), await hist(300, start - 300 * 60, now), await hist(900, start - 900 * 60, now)];
const m30 = aggregate(m15, 900, 2);
console.error(`1m ${m1.length} · 5m ${m5.length} · 15m ${m15.length}; fetching trades for ${tradeHours} h…`);
const tStart = now - tradeHours * 3600;
const tape = new TradeTape();
tape.add(await tradesSince(tStart));
const b15 = tape.bars(15, now, 100_000), b30 = tape.bars(30, now, 100_000);
console.error(`trades ${tape.trades.length} (from ${new Date(tape.trades[0].t * 1000).toISOString()}) · 15s bars ${b15.length} · 30s bars ${b30.length}`);

// timeline: 1m closes before the trade window, 15s closes inside it
const times: { t: number; bar: Candle }[] = [];
for (const b of m1) if (b.t + 60 > start && b.t + 60 <= tStart && b.t + 60 <= now) times.push({ t: b.t + 60, bar: b });
for (const b of b15) if (b.t + 15 > tStart && b.t + 15 <= now) times.push({ t: b.t + 15, bar: b });
times.sort((a, b) => a.t - b.t);

function run(sim: SimParams, from = start): DemoState {
  let st = newDemo(500, from, "bt", "active");
  for (const { t, bar } of times) {
    if (t <= from) continue;
    const bars: Record<number, Candle[]> = { 60: closedBy(m1, 60, t).slice(-300), 300: closedBy(m5, 300, t).slice(-300), 900: closedBy(m15, 900, t).slice(-300), 1800: closedBy(m30, 1800, t).slice(-300) };
    if (t > tStart) (bars[15] = closedBy(b15, 15, t).slice(-300)), (bars[30] = closedBy(b30, 30, t).slice(-300));
    st = stepDemo(st, { now: t, price: bar.c, hi: bar.h, lo: bar.l, bars, fundingHourly: 0, extSkew: 0 }, sim);
  }
  return st;
}
const withFees = run(SIM);
const noFees = run({ ...SIM, openFeeBps: 0, slippageBps: 0 });
const lastPx = times[times.length - 1].bar.c;
const rows = ACTIVE.desks.map((d) => {
  const a = withFees.desks[d.id], b = noFees.desks[d.id];
  const closes = a.trades.filter((x) => x.kind === "close");
  const opens = a.trades.filter((x) => x.kind === "open");
  const win = closes.filter((x) => (x.pnl ?? 0) > 0).length;
  const window = d.timeframeSec < 60 ? `${tradeHours}h` : `${days}d`;
  return {
    desk: d.name, strategy: d.strategy + (d.params.proxy ? " (skew proxy)" : ""), frame: d.timeframeSec < 60 ? `${d.timeframeSec}s` : `${d.timeframeSec / 60}m`, window,
    entries: opens.length, closes: closes.length, winRate: closes.length ? Math.round((win / closes.length) * 100) : null,
    pnlNet: +(deskEquity(a, lastPx) - a.startEquity).toFixed(2), pnlBeforeCosts: +(deskEquity(b, lastPx) - b.startEquity).toFixed(2),
    entriesNoFeeRun: b.trades.filter((x) => x.kind === "open").length, status: a.status, watching: a.watching,
  };
});
// a FRESH demo started at the beginning of the trade window (all six desks incl. 15s/30s, own daily caps)
const fresh = run(SIM, tStart);
const freshRows = ACTIVE.desks.map((d) => {
  const o = fresh.desks[d.id].trades.filter((x) => x.kind === "open");
  return { desk: d.name, entries: o.length, firstEntryMin: o.length ? Math.round((o[o.length - 1].at - tStart) / 60) : null, pnlNet: +(deskEquity(fresh.desks[d.id], lastPx) - fresh.desks[d.id].startEquity).toFixed(2) };
});
console.log(JSON.stringify({ generatedAt: new Date().toISOString(), startBalance: 500, days, tradeHours, sim: SIM, note: "1m+ desks over the full window; 15s/30s desks only inside the trade window. Entries capped by the unchanged 6/desk/day and 24/floor/day limits (in the multi-day run the four 1m+ desks use the 24/floor/day budget before the 15s/30s desks get a turn; see freshDemo for a fresh start).", rows, freshDemo: { startedAt: new Date(tStart * 1000).toISOString(), hours: tradeHours, rows: freshRows } }, null, 1));

if (writeB) {
  const desks: Record<string, unknown> = {};
  for (const d of ACTIVE.desks) {
    const c = withFees.desks[d.id].closed;
    const wins = c.filter((x) => x.pnl > 0), losses = c.filter((x) => x.pnl <= 0);
    const avg = (v: number[]) => (v.length ? v.reduce((x, y) => x + y, 0) / v.length : 0);
    const hrs = d.timeframeSec < 60 ? tradeHours : days * 24;
    const perDay = (c.length / hrs) * 24;
    desks[d.id] = {
      winRate: c.length ? wins.length / c.length : 0.4, rSamples: c.map((x) => Math.round(x.r * 1000) / 1000), payoff: losses.length && wins.length ? avg(wins.map((x) => x.r)) / Math.abs(avg(losses.map((x) => x.r))) : 1,
      tradesPerDayP95: Math.max(OFFICE.limits.entriesPerDeskDay, Math.ceil(perDay * 1.5)), source: `demo Active backtest ${d.timeframeSec}s, ${hrs}h of Coinbase data to ${new Date(now * 1000).toISOString()}, ${c.length} closed trades`,
    };
  }
  writeFileSync(new URL("../src/lib/demo/active-baselines.json", import.meta.url), JSON.stringify({ note: "Drift baselines for the demo Active profile (frame-specific backtests on recent real XLM data; illustrative, not a forecast). tradesPerDayP95 is floored at the 6 entries/desk/day cap so the frequency check never fires below the entry cap.", generatedAt: new Date().toISOString(), desks }, null, 1) + "\n");
  console.error("wrote active-baselines.json");
}
