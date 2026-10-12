import { useEffect, useState } from "react";
import "../theme/decision-desk.css";

/** Decision desk (testnet research · shadow/paper only). Reads a static snapshot built by bot/src/office/decision/cli.ts. */
type Rel = { lo: number; hi: number; n: number; meanP: number; hitRate: number };
type Dec = { t: number; regime: string; direction: string; setup_quality: number; risk_state: string; confidence: number; fired: boolean; failed: string[]; win?: boolean };
export interface DecisionDoc {
  generatedAt: number;
  data: { bars: number; from: number; to: number; book: string };
  method: { walkForward: string; costs: string; gate: string; sizing: string; geometry: string; hard: { maxDrawdownPct: number; maxDailyLossPct: number; maxPositionX: number; riskCapPct: number; killSwitchArmed: boolean } };
  oos: { folds: number; from: number; to: number; candidates: number; fired: number; winRate: number | null; netPnl: number; maxDrawdownPct: number; feesPaid: number; brier: number; brierClimatology: number; baseRate: number; maxConfidence: number; killed: string | null };
  ungated: { fired: number; winRate: number; netPnl: number; maxDrawdownPct: number; killed: string | null; equityCurve: [number, number][] };
  reliability: Rel[];
  confidenceHistogram: number[];
  gateFailures: Record<string, number>;
  regimes: Record<string, number>;
  recentDecisions: Dec[];
  shadow?: { at: number; decisions: Dec[]; paper: { equity: number; peakEquity: number }; breaker: string; kill: boolean; latest?: { spreadBps: number; imbalance: number; rvol: number; mid: number; bookSource: string } } | null;
}

const BASE = (import.meta.env?.BASE_URL ?? "/").replace(/\/?$/, "/");
export const DECISION_URL = `${BASE}data/decision-desk.json`;
const d8 = (t: number) => new Date(t * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
const hm = (t: number) => new Date(t * 1000).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
const pct = (v: number | null | undefined, k = 0) => (v === null || v === undefined || !Number.isFinite(v) ? "—" : `${(v * 100).toFixed(k)}%`);

function Reliability({ rel }: { rel: Rel[] }) {
  const W = 220, H = 220;
  return (
    <svg className="dd-rel" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Calibration: predicted vs actual win rate">
      {[0.25, 0.5, 0.75].map((g) => <line key={g} x1={g * W} x2={g * W} y1={0} y2={H} className="dd-grid" />)}
      {[0.25, 0.5, 0.75].map((g) => <line key={`h${g}`} y1={H - g * H} y2={H - g * H} x1={0} x2={W} className="dd-grid" />)}
      <line x1={0} y1={H} x2={W} y2={0} className="dd-diag" />
      <line x1={0.8 * W} x2={0.8 * W} y1={0} y2={H} className="dd-thr" />
      <text x={0.8 * W + 3} y={12} className="dd-ax">0.80 gate</text>
      {rel.map((b) => <circle key={b.lo} cx={b.meanP * W} cy={H - b.hitRate * H} r={Math.max(3, Math.min(11, Math.sqrt(b.n) / 8))} className="dd-dot"><title>{`predicted ${pct(b.meanP)} · actual ${pct(b.hitRate)} · n=${b.n}`}</title></circle>)}
      <text x={4} y={H - 4} className="dd-ax">predicted →</text>
    </svg>
  );
}

function Curve({ pts }: { pts: [number, number][] }) {
  if (pts.length < 2) return null;
  const W = 320, H = 90, t0 = pts[0][0], t1 = pts[pts.length - 1][0];
  const lo = Math.min(...pts.map((p) => p[1])), hi = Math.max(...pts.map((p) => p[1]), 500);
  const d = pts.map((p, i) => `${i ? "L" : "M"}${(((p[0] - t0) / (t1 - t0)) * W).toFixed(1)},${(H - ((p[1] - lo) / (hi - lo || 1)) * H).toFixed(1)}`).join("");
  const y500 = H - ((500 - lo) / (hi - lo || 1)) * H;
  return (
    <svg className="dd-curve" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-label="Diagnostic equity curve">
      <line x1={0} x2={W} y1={y500} y2={y500} className="dd-grid" />
      <path d={d} className="dd-line" />
    </svg>
  );
}

export function DecisionDesk({ doc: initial }: { doc?: DecisionDoc | null }) {
  const [doc, setDoc] = useState<DecisionDoc | null>(initial ?? null);
  const [err, setErr] = useState("");
  useEffect(() => {
    if (initial) return;
    fetch(DECISION_URL, { cache: "no-cache" }).then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status))))).then(setDoc).catch((e) => setErr(e.message));
  }, [initial]);
  if (!doc) return err ? null : <section className="dd" aria-busy="true"><p className="dd-sub">Loading decision desk…</p></section>;
  const o = doc.oos, h = doc.method.hard;
  const shadow = doc.shadow;
  const decs = (shadow?.decisions?.length ? shadow.decisions : doc.recentDecisions).slice(-12).reverse();
  const totalFail = Object.values(doc.gateFailures).reduce((a, b) => a + b, 0) || 1;
  return (
    <section className="dd" aria-label="Decision desk">
      <div className="dd-h">
        <h2>Decision desk</h2>
        <span className="dd-chip">testnet research</span>
        <span className="dd-chip gold">shadow · paper only · no orders</span>
        <span className="dd-chip warn">gate never fired out-of-sample</span>
      </div>
      <p className="dd-sub">
        Every 15-minute candle: a deterministic state engine (mid, spread, order-book imbalance, realized vol, inventory, drawdown) feeds a typed decision —
        regime, direction, setup quality 0–3, risk state, calibrated confidence. Code then decides: it fires only if setup ≥ 2, confidence &gt; 0.80 and risk is safe,
        sizes at quarter-Kelly or less, and a hard risk layer the model cannot touch can block or kill.
      </p>

      <div className="dd-grid4">
        <div className="dd-card"><span className="dd-lbl">Out-of-sample trades</span><b>{o.fired}</b><em>{o.candidates.toLocaleString()} candidates · {o.folds} monthly folds · {d8(o.from)} – {d8(o.to)}</em></div>
        <div className="dd-card"><span className="dd-lbl">Net PnL after fees</span><b>{o.netPnl.toFixed(2)} QUSD</b><em>win rate {pct(o.winRate)} · drawdown {o.maxDrawdownPct.toFixed(1)}%</em></div>
        <div className="dd-card"><span className="dd-lbl">Brier score</span><b>{o.brier.toFixed(4)}</b><em>base-rate guess {o.brierClimatology.toFixed(4)} · lower is better</em></div>
        <div className="dd-card"><span className="dd-lbl">Highest confidence seen</span><b>{pct(o.maxConfidence)}</b><em>gate needs &gt; 80% · actual win base rate {pct(o.baseRate)}</em></div>
      </div>

      <div className="dd-row">
        <div className="dd-card dd-wide">
          <h3>Calibration</h3>
          <Reliability rel={doc.reliability} />
          <p className="dd-note">Dots on the diagonal = honest confidence. All out-of-sample confidence sits between 30 % and 46 %, and actual wins stay near 40 % whatever the score: the signals have no measurable edge after fees, so the gate correctly stays shut.</p>
        </div>
        <div className="dd-card dd-wide">
          <h3>Why candidates were rejected</h3>
          <ul className="dd-bars">
            {Object.entries(doc.gateFailures).sort((a, b) => b[1] - a[1]).map(([k, v]) => (
              <li key={k}><span>{k.replace("hard:", "hard risk · ").replace("_", " ")}</span><i style={{ width: `${Math.max(2, (v / totalFail) * 100)}%` }} /><b>{v.toLocaleString()}</b></li>
            ))}
          </ul>
          <h3>Diagnostic: gate removed</h3>
          <p className="dd-note">Same signals, confidence gate off, fixed 0.5 % risk, hard limits on: {doc.ungated.fired} trades, win rate {pct(doc.ungated.winRate)}, {doc.ungated.netPnl.toFixed(2)} QUSD, drawdown {doc.ungated.maxDrawdownPct.toFixed(1)}%{doc.ungated.killed ? ` — hard risk layer killed it (${doc.ungated.killed})` : doc.ungated.maxDrawdownPct >= (doc.method.hard.maxDrawdownPct * 2) / 3 - 0.5 ? ` — risk state went to "reduce" at that drawdown and blocked every new entry after it` : ""}.</p>
          <Curve pts={doc.ungated.equityCurve} />
        </div>
      </div>

      <div className="dd-row">
        <div className="dd-card dd-wide">
          <h3>Hard risk layer <span className="dd-chip gold">armed</span></h3>
          <ul className="dd-limits">
            <li><span>Max drawdown → kill</span><b>{h.maxDrawdownPct}%</b></li>
            <li><span>Max daily loss → block</span><b>{h.maxDailyLossPct}%</b></li>
            <li><span>Max position</span><b>{h.maxPositionX}× equity</b></li>
            <li><span>Max risk per trade</span><b>{h.riskCapPct}%</b></li>
            <li><span>Kill switch + stale-data breaker</span><b>{shadow ? (shadow.kill ? "KILLED" : shadow.breaker || "fresh") : "wired"}</b></li>
            <li><span>Orion live slice</span><b>unchanged · stricter limits win</b></li>
          </ul>
          <p className="dd-note">Existing desk limits are merged in and the stricter number always wins (the fleet's 10 % desk drawdown halt is tighter than 15 %). Issue #30 holds: Orion stays at its $100 test slice, Echo and Nova stay paused.</p>
        </div>
        <div className="dd-card dd-wide">
          <h3>{shadow ? `Shadow decisions · live data · ${hm(shadow.at)}` : "Latest out-of-sample decisions"}</h3>
          {shadow?.latest && <p className="dd-note">mid {shadow.latest.mid.toFixed(5)} · spread {shadow.latest.spreadBps.toFixed(1)} bps · imbalance {shadow.latest.imbalance.toFixed(2)} · vol {(shadow.latest.rvol * 100).toFixed(0)}%/yr · book {shadow.latest.bookSource}</p>}
          <table className="dd-tbl">
            <thead><tr><th>Time</th><th>Regime</th><th>Dir</th><th>Q</th><th>Risk</th><th>Conf</th><th>Gate</th></tr></thead>
            <tbody>
              {decs.map((d) => (
                <tr key={d.t}>
                  <td>{hm(d.t)}</td><td>{d.regime.replace("_", " ")}</td><td>{d.direction}</td><td>{d.setup_quality}</td><td>{d.risk_state.replace("_", " ")}</td>
                  <td>{pct(d.confidence)}</td>
                  <td className={d.fired ? "ok" : "no"} title={d.failed.join("; ")}>{d.fired ? "fire (paper)" : d.direction === "flat" ? "flat" : "blocked"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <p className="dd-foot">Testnet research only · no real funds · paper fills · nightly review writes a report and never changes settings on its own · {doc.data.book} · snapshot {hm(doc.generatedAt)}</p>
    </section>
  );
}
