/**
 * Decision desk CLI (TESTNET research / shadow; no order path).
 *   tsx src/office/decision/cli.ts backtest --csv <coinbase_XLM-USD_900.csv> --out <report.json>
 *   tsx src/office/decision/cli.ts shadow [--once]     # paper decisions on live public data, journal -> ~/.quasaria-office/state/decision-journal.jsonl
 *   tsx src/office/decision/cli.ts review              # nightly report -> ~/.quasaria-office/nightly/decision-review-YYYY-MM-DD.json
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Candle } from "../indicators.js";
import { officeHome } from "../store.js";
import { DEFAULT_CONFIG_PATH, parseOfficeConfig } from "../config.js";
import { fitCalibrator, calibrateWith, type Calibrator } from "./calibrate.js";
import { candidates, type DecisionLog, outcome, walkForward } from "./engine.js";
import { gate, propose, riskStateFor } from "./schema.js";
import { hardCheck, hardLimitsFor, kellyRiskPct } from "./hardRisk.js";
import { PAYOFF_B } from "./engine.js";
import { computeState, type BookSnap } from "./state.js";
import { review } from "./review.js";

const argv = process.argv.slice(2);
const opt = (n: string, d?: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const TF = 900;

function readCsv(p: string): Candle[] {
  const [, ...lines] = readFileSync(p, "utf8").trim().split("\n");
  return lines.map((l) => { const [t, o, h, l2, c, v] = l.split(",").map(Number); return { t, o, h, l: l2, c, v }; }).filter((b) => b.c > 0).sort((a, b) => a.t - b.t);
}
const r4 = (x: number) => (Number.isFinite(x) ? +x.toFixed(4) : null);

function limits() {
  const cfg = parseOfficeConfig(JSON.parse(readFileSync(DEFAULT_CONFIG_PATH, "utf8")));
  return hardLimitsFor(cfg.limits, 1.0);
}

async function backtestCmd() {
  const bars = readCsv(opt("csv")!);
  const h = limits();
  const folds = walkForward(bars, TF, h);
  const all = folds.flatMap((f) => f.res.decisions), fills = folds.flatMap((f) => f.res.fills);
  const curve = folds.flatMap((f) => f.res.equityCurve);
  let peak = 500, dd = 0;
  for (const [, e] of curve) (peak = Math.max(peak, e)), (dd = Math.max(dd, (peak - e) / peak));
  const p = all.filter((d) => d.win !== undefined);
  const { brier, reliability } = await import("./calibrate.js");
  const y = p.map((d) => !!d.win), pp = p.map((d) => d.confidence);
  const base = y.filter(Boolean).length / Math.max(1, y.length);
  const gf: Record<string, number> = {};
  for (const f of folds) for (const [k, v] of Object.entries(f.res.gateFailures)) gf[k] = (gf[k] ?? 0) + v;
  const regimes: Record<string, number> = {};
  for (const f of folds) for (const [k, v] of Object.entries(f.res.regimes)) regimes[k] = (regimes[k] ?? 0) + v;
  const confHist = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (const c of pp) confHist[Math.min(9, Math.floor(c * 10))]++;
  const net = fills.reduce((a, f) => a + f.netPnl, 0);
  // DIAGNOSTIC ONLY (not the strategy): same signals with the confidence gate removed and a fixed 0.5 % risk,
  // to show whether the gate is protecting capital or merely idle.
  const diag = walkForward(bars, TF, h, { trainDays: 180, testDays: 30, startEquity: 500, kellyFraction: 0.25, diagFixedRiskPct: 0.5 });
  const dF = diag.flatMap((f) => f.res.fills), dCurve = diag.flatMap((f) => f.res.equityCurve);
  let dp = 500, ddd = 0;
  for (const [, e] of dCurve) (dp = Math.max(dp, e)), (ddd = Math.max(ddd, (dp - e) / dp));
  const ungated = { note: "diagnostic: confidence gate OFF, fixed 0.5 % risk, all hard limits ON", fired: dF.length, winRate: r4(dF.filter((f) => f.netPnl > 0).length / Math.max(1, dF.length)), netPnl: r4(dF.reduce((a, f) => a + f.netPnl, 0)), maxDrawdownPct: r4(ddd * 100), killed: diag.find((f) => f.res.stats.killed)?.res.stats.killed ?? null, stoppedAt: diag[diag.length - 1]?.res.stats.to, equityCurve: dCurve.filter((_, i) => i % 6 === 0) };
  const report = {
    kind: "decision-desk-backtest", generatedAt: Math.floor(Date.now() / 1000), network: "testnet research · paper only · no funds",
    data: { source: "Coinbase XLM-USD 15m candles (public API)", bars: bars.length, from: bars[0].t, to: bars[bars.length - 1].t + TF, book: "historical spread/imbalance are candle proxies (no historical order book)" },
    method: { walkForward: "train 180 d / test 30 d, calibrator refit each fold, labels only if resolved before the test window", entry: "next bar open", geometry: "TP 1.5 ATR / SL 1.0 ATR / 32-bar timeout", costs: "10 bps per side + full proxy spread", gate: "setup_quality >= 2 AND confidence > 0.80 AND risk_state safe AND regime != crisis", sizing: "quarter-Kelly on calibrated p, capped at 1 % risk and 1.5x notional", hard: h },
    oos: { folds: folds.length, from: folds[0]?.res.stats.from, to: folds[folds.length - 1]?.res.stats.to, candidates: p.length, fired: fills.length,
      winRate: r4(fills.length ? fills.filter((f) => f.netPnl > 0).length / fills.length : NaN), netPnl: r4(net), netPnlPct: r4((net / 500) * 100), maxDrawdownPct: r4(dd * 100),
      feesPaid: r4(folds.reduce((a, f) => a + f.res.stats.feesPaid, 0)), brier: r4(brier(pp, y)), brierClimatology: r4(base * (1 - base)), baseRate: r4(base), maxConfidence: r4(Math.max(0, ...pp)), killed: folds.find((f) => f.res.stats.killed)?.res.stats.killed ?? null },
    reliability: reliability(pp, y).map((b) => ({ ...b, meanP: r4(b.meanP), hitRate: r4(b.hitRate) })), confidenceHistogram: confHist, gateFailures: gf, regimes, ungated,
    folds: folds.map((f) => ({ from: f.res.stats.from, to: f.res.stats.to, candidates: f.res.stats.candidates, fired: f.res.stats.fired, netPnl: r4(f.res.stats.netPnl), brier: r4(f.res.stats.brierCandidates), trainN: f.cal.trainedOn.n })),
    equityCurve: curve.filter((_, i) => i % 6 === 0),
    fills: fills.slice(-50),
    recentDecisions: all.slice(-40).map((d) => ({ t: d.t, regime: d.regime, direction: d.direction, setup_quality: d.setup_quality, risk_state: d.risk_state, confidence: r4(d.confidence), fired: d.fired, failed: d.failed, win: d.win })),
  };
  writeFileSync(opt("out", "decision-backtest.json")!, JSON.stringify(report));
  // final calibrator for shadow: last 180 days
  const per = 86400 / TF;
  const cal = fitCalibrator(candidates(bars, TF, bars.length - 180 * per, bars.length, bars[bars.length - 1].t + TF));
  writeFileSync(opt("model", "decision.model.json")!, JSON.stringify(cal, null, 1));
  console.log(JSON.stringify(report.oos, null, 1));
}

async function getJson(u: string) { const r = await fetch(u, { headers: { "user-agent": "quasaria-decision-shadow" } }); if (!r.ok) throw new Error(`${r.status} ${u}`); return r.json(); }

async function shadowOnce() {
  const home = officeHome(), st = join(home, "state");
  mkdirSync(st, { recursive: true });
  const cal: Calibrator = JSON.parse(readFileSync(opt("model", "decision.model.json")!, "utf8"));
  const now = Math.floor(Date.now() / 1000);
  const raw = (await getJson(`https://api.exchange.coinbase.com/products/XLM-USD/candles?granularity=${TF}`)) as number[][];
  const bars: Candle[] = raw.map((r) => ({ t: r[0], o: r[3], h: r[2], l: r[1], c: r[4], v: r[5] })).sort((a, b) => a.t - b.t).filter((b) => b.t + TF <= now);
  const ob = (await getJson("https://api.exchange.coinbase.com/products/XLM-USD/book?level=2")) as { bids: string[][]; asks: string[][] };
  const book: BookSnap = { ts: now, bids: ob.bids.map((x) => [+x[0], +x[1]]), asks: ob.asks.map((x) => [+x[0], +x[1]]) };
  const pfFile = join(st, "decision-paper.json");
  const pf = existsSync(pfFile) ? JSON.parse(readFileSync(pfFile, "utf8")) : { equity: 500, peakEquity: 500, dayStartEquity: 500, day: -1, lastT: 0, open: null };
  const jFile = join(st, "decision-journal.jsonl");
  const i = bars.length - 1;
  if (bars[i].t + TF <= pf.lastT) return console.log("no new closed bar");
  // settle paper position + label older decisions
  const jl: DecisionLog[] = existsSync(jFile) ? readFileSync(jFile, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
  let changed = false;
  for (const d of jl) {
    if (d.win !== undefined || d.direction === "flat") continue;
    const k = bars.findIndex((b) => b.t + TF === d.t);
    if (k < 0) continue;
    const o = outcome(bars, k, d.direction === "long" ? 1 : -1, (computeState(bars, k, TF, d.t, pf) ?? { atr: 0 }).atr, d.spreadBps, TF);
    if (o) { d.win = o.win; changed = true; if (d.fired && pf.open?.t === d.t) { const pnl = pf.open.notional * o.netRet; pf.equity += pnl; d.netPnl = pnl; pf.open = null; } }
  }
  const day = Math.floor(now / 86400);
  if (day !== pf.day) (pf.day = day), (pf.dayStartEquity = pf.equity);
  pf.peakEquity = Math.max(pf.peakEquity, pf.equity);
  const s = computeState(bars, i, TF, now, { ...pf, inventory: pf.open ? 1 : 0 }, book)!;
  const h = limits();
  const dec = propose(s, riskStateFor(s, h.maxDrawdownPct, !!pf.open, pf.dayStartEquity > 0 ? Math.max(0, ((pf.dayStartEquity - pf.equity) / pf.dayStartEquity) * 100) : 0, h.maxDailyLossPct), calibrateWith(cal));
  const g = gate(dec);
  const killFlag = existsSync(join(home, "KILL")) || (existsSync(join(st, "fleet.json")) && JSON.parse(readFileSync(join(st, "fleet.json"), "utf8")).killed === true);
  const breaker = existsSync(join(st, "fleet.json")) ? JSON.parse(readFileSync(join(st, "fleet.json"), "utf8")).stale : undefined;
  const hv = hardCheck(h, { desk: { equity: pf.equity, dayStartEquity: pf.dayStartEquity, peakEquity: pf.peakEquity, lossStreak: 0, pausedUntil: 0, entryTimes: [] }, startEquity: 500, open: pf.open ? 1 : 0, now, killFlag, breaker });
  const riskPct = g.fire && hv.ok ? kellyRiskPct(dec.confidence, PAYOFF_B, 0.25, hv.riskCapPct) : 0;
  const fired = g.fire && hv.ok && riskPct > 0;
  const log: DecisionLog = { ...dec, fired, failed: g.failed, hard: hv.ok ? "ok" : hv.reason, riskPct, spreadBps: s.spreadBps, imbalance: s.imbalance, rvol: s.rvol, drawdownPct: s.drawdownPct, bookSource: s.bookSource };
  if (fired && hv.ok) { const stopPct = s.atr / bars[i].c + 0.002; pf.open = { t: dec.t, notional: Math.min((pf.equity * riskPct) / 100 / stopPct, hv.maxNotional) }; }
  jl.push(log);
  pf.lastT = dec.t;
  writeFileSync(jFile, jl.map((x) => JSON.stringify(x)).join("\n") + "\n");
  void changed;
  writeFileSync(pfFile, JSON.stringify(pf));
  writeFileSync(join(st, "decision-latest.json"), JSON.stringify({ at: now, state: s, decision: log, paper: pf, mode: "shadow · paper only · no orders" }, null, 1));
  console.log(new Date().toISOString(), dec.regime, dec.direction, `q${dec.setup_quality}`, dec.confidence.toFixed(3), fired ? "FIRE(paper)" : `skip: ${[...g.failed, hv.ok ? "" : hv.reason].filter(Boolean).join("; ")}`);
}

async function main() {
  const cmd = argv[0];
  if (cmd === "backtest") return backtestCmd();
  if (cmd === "shadow") {
    if (argv.includes("--once")) return shadowOnce();
    for (;;) {
      await shadowOnce().catch((e) => console.error(new Date().toISOString(), "shadow error", (e as Error).message));
      const n = Date.now() / 1000;
      await new Promise((r) => setTimeout(r, ((Math.ceil(n / TF) * TF + 20 - n) * 1000)));
    }
  }
  if (cmd === "export") {
    // merge the backtest report with the latest shadow journal into the Back Office snapshot
    const rep = JSON.parse(readFileSync(opt("report", "decision-backtest.json")!, "utf8"));
    const st = join(officeHome(), "state");
    const jFile = join(st, "decision-journal.jsonl"), lFile = join(st, "decision-latest.json");
    if (existsSync(lFile)) {
      const latest = JSON.parse(readFileSync(lFile, "utf8"));
      const rows: DecisionLog[] = readFileSync(jFile, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
      const fleet = existsSync(join(st, "fleet.json")) ? JSON.parse(readFileSync(join(st, "fleet.json"), "utf8")) : {};
      rep.shadow = { at: latest.at, paper: latest.paper, kill: fleet.killed === true || existsSync(join(officeHome(), "KILL")), breaker: fleet.stale?.tripped ? `tripped: ${fleet.stale.reason}` : "fresh",
        latest: { mid: latest.state.mid, spreadBps: latest.state.spreadBps, imbalance: latest.state.imbalance, rvol: latest.state.rvol, bookSource: latest.state.bookSource },
        decisions: rows.slice(-40).map((d) => ({ t: d.t, regime: d.regime, direction: d.direction, setup_quality: d.setup_quality, risk_state: d.risk_state, confidence: +d.confidence.toFixed(4), fired: d.fired, failed: d.failed, win: d.win })) };
    }
    writeFileSync(opt("out")!, JSON.stringify(rep));
    return console.log("wrote", opt("out"));
  }
  if (cmd === "review") {
    const jFile = join(officeHome(), "state", "decision-journal.jsonl");
    const rows = existsSync(jFile) ? readFileSync(jFile, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
    const rep = review(rows, Math.floor(Date.now() / 1000), Number(opt("window", "86400")));
    const dir = join(officeHome(), "nightly"); mkdirSync(dir, { recursive: true });
    const f = join(dir, `decision-review-${new Date().toISOString().slice(0, 10)}.json`);
    writeFileSync(f, JSON.stringify(rep, null, 1));
    appendFileSync(join(dir, "decision-review.log"), `${new Date().toISOString()} ${f} brier=${rep.brier} n=${rep.resolved}\n`);
    return console.log(JSON.stringify(rep, null, 1));
  }
  console.error("usage: backtest | shadow [--once] | review");
  process.exit(2);
}
main();
