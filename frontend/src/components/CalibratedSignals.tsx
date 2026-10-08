import type { CalibratedStatus } from "../lib/backOffice";
import { tfLabel } from "../lib/backOffice";

const pct = (v: number) => `${(v * 100).toFixed(0)}%`;
const hhmm = (t: number) => new Date(t * 1000).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
const Q: { k: keyof CalibratedStatus["thresholds"]; label: string; title: string }[] = [
  { k: "setup", label: "Setup", title: "P(trade with this stop/target closes in profit after fees)" },
  { k: "direction", label: "Dir", title: "P(price higher/lower T bars ahead, on the chosen side)" },
  { k: "pressure", label: "Flow", title: "P(net buying pressure on the chosen side)" },
  { k: "regime", label: "Trend", title: "P(trending regime)" },
  { k: "risk", label: "Calm", title: "P(no volatility expansion)" },
];

/** Signal log of the calibrated desk(s): every candle's probabilities, confidence, action and result. Read-only. */
function modeChip(d: CalibratedStatus) {
  if (d.mode === "shadow") return "shadow · no orders";
  if (d.mode === "paper") return d.model.gatePassed ? "paper · simulated fills" : "paper · failed gate";
  return "desk";
}

export function CalibratedSignals({ desks, stale }: { desks: CalibratedStatus[] | undefined; stale: boolean }) {
  if (!desks?.length) return null;
  return (
    <section className="bo-cal" aria-label="Calibrated desk signals">
      {desks.map((d) => {
        const wins = d.paperWins, n = d.paperTrades;
        return (
          <div key={d.id} className="bo-cal-desk">
            <div className="bo-cal-h">
              <h2>{d.name} <span className="bo-tf">{tfLabel(d.timeframeSec)}</span></h2>
              <span className="bo-cal-chip">testnet / simulated</span>
              <span className={`bo-cal-chip ${d.mode === "desk" ? "" : "sh"}`}>{modeChip(d)}</span>
              <span className={`bo-cal-chip st-${d.status}`}>{d.status}{d.reason ? ` · ${d.reason}` : ""}</span>
              {stale && <span className="bo-cal-chip st-halted">feed stale</span>}
            </div>
            <p className="bo-cal-sub">
              Three layers: research and nightly review offline; a calibrated scorer that answers five fixed questions every candle; deterministic code that owns
              thresholds, sizing and risk vetoes. The model advises, the code decides. {d.model.gate}.
            </p>
            <div className="bo-cal-stats">
              <div><span className="bo-lbl">Paper equity</span><b>{d.equity.toFixed(2)}</b><small>of {d.startEquity} simulated</small></div>
              <div><span className="bo-lbl">Paper trades</span><b>{n}</b><small>{n ? `${wins} won · ${n - wins} lost` : "none yet"}</small></div>
              <div><span className="bo-lbl">Sizing</span><b className="sm">{d.sizing}</b><small>caps: 1% target · 2% hard</small></div>
              <div><span className="bo-lbl">Fires when</span><b className="sm">{Q.map((q) => `${q.label} ≥ ${d.thresholds[q.k]}`).join(" · ")}</b><small>every threshold must clear</small></div>
              <div>
                <span className="bo-lbl">Live calibration (Brier)</span>
                <b className="sm">{["setup_long", "setup_short", "direction"].map((q) => { const c = d.calibrationLive[q]; return `${q.replace("_", " ")} ${c?.brier ?? "—"}`; }).join(" · ")}</b>
                <small>{d.calibrationLive.direction?.n ? `${d.calibrationLive.direction.n} resolved · lower is better; climatology ${d.calibrationLive.direction.climatology}` : "resolves after the outcome horizon"}</small>
              </div>
            </div>
            {d.open && <div className="bo-cal-open">Open paper {d.open.side} @ {d.open.entry.toFixed(5)} · stop {d.open.stop.toFixed(5)} · target {d.open.takeProfit.toFixed(5)} · notional {d.open.notional}</div>}
            <div className="bo-cal-tbl" role="table" aria-label={`${d.name} signals`}>
              <div className="bo-cal-row hd" role="row">
                <span>Candle</span><span>Side</span>{Q.map((q) => <span key={q.k} title={q.title}>{q.label}</span>)}<span title="weighted combination of the five probabilities">Conf.</span><span>Action</span><span>Result</span>
              </div>
              {d.decisions.length === 0 && <div className="bo-cal-row"><span className="bo-mut">Waiting for the first closed candle.</span></div>}
              {d.decisions.map((s) => (
                <div key={s.t} className={`bo-cal-row ${s.fired ? "fired" : ""}`} role="row">
                  <span>{hhmm(s.t)}</span>
                  <span className={s.side === "long" ? "g" : "r"}>{s.side}</span>
                  {Q.map((q) => <span key={q.k} className={s.p[q.k] >= d.thresholds[q.k] ? "ok" : "no"}>{pct(s.p[q.k])}</span>)}
                  <span>{pct(s.score)}</span>
                  <span className="act" title={s.action}>{s.action}</span>
                  <span className={s.pnl === null ? "" : s.pnl > 0 ? "g" : "r"}>{s.result ?? "pending"}</span>
                </div>
              ))}
            </div>
            <p className="bo-fine">Simulated paper trades on public XLM-USD candles with fees, slippage and funding. Paper and shadow modes never place an on-chain order. Not a forecast; no expected or guaranteed returns.</p>
          </div>
        );
      })}
    </section>
  );
}
