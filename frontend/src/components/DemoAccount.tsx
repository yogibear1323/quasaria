/** Demo account controls + history for the Back Office (browser-only simulation; never touches testnet funds). */
import { useMemo, useState } from "react";
import { DEMO_MAX, DEMO_MIN, DEMO_PRESETS, demoEquity, validateBalance, type DemoState } from "../lib/demo/engine";
import { botStats } from "../lib/demo/views";
import { fmtGap } from "../lib/demo/useDemo";
import type { DeskCfg } from "../lib/backOffice";
import type { CreateResult } from "../lib/demo/store";

export type FloorMode = "live" | "demo" | "mirror";
const usd = (v: number, d = 2) => `$${v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d })}`;
const signed = (v: number) => (Math.abs(v) < 0.005 ? "$0.00" : `${v > 0 ? "+" : "−"}${usd(Math.abs(v))}`);

export function ModeSwitch({ mode, setMode, hasDemo }: { mode: FloorMode; setMode: (m: FloorMode) => void; hasDemo: boolean }) {
  const opts: [FloorMode, string][] = [["live", "Live fleet · testnet"], ["demo", hasDemo ? "My demo account" : "Demo account"], ["mirror", "Mirror live fleet"]];
  return (
    <div className="bo-modes" role="tablist" aria-label="Floor view">
      {opts.map(([m, l]) => (
        <button key={m} role="tab" aria-selected={mode === m} className={mode === m ? "on" : ""} onClick={() => setMode(m)}>{l}</button>
      ))}
    </div>
  );
}

function Curve({ pts, start }: { pts: { t: number; eq: number }[]; start: number }) {
  if (pts.length < 2) return <div className="dm-curve empty">The equity curve appears after the first few minutes.</div>;
  const w = 320, h = 90;
  const lo = Math.min(start, ...pts.map((p) => p.eq)), hi = Math.max(start, ...pts.map((p) => p.eq));
  const t0 = pts[0].t, t1 = pts[pts.length - 1].t || t0 + 1;
  const x = (t: number) => ((t - t0) / (t1 - t0 || 1)) * w;
  const y = (v: number) => h - 6 - ((v - lo) / (hi - lo || 1)) * (h - 12);
  const line = "M" + pts.map((p) => `${x(p.t).toFixed(1)},${y(p.eq).toFixed(1)}`).join(" L");
  const up = pts[pts.length - 1].eq >= start;
  return (
    <svg className="dm-curve" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" role="img" aria-label="Demo equity curve">
      <line x1="0" x2={w} y1={y(start)} y2={y(start)} stroke="rgba(255,255,255,.15)" strokeDasharray="3 3" />
      <path d={`${line} L${w},${h} L0,${h} Z`} fill={up ? "#34d399" : "#fb7185"} opacity=".12" />
      <path d={line} fill="none" stroke={up ? "#34d399" : "#fb7185"} strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export function DemoAccount({ demo, price, note, runner, available, create, close, reset, desks, mode }: {
  demo: DemoState | null; price: number | null; note: string; runner: boolean; available: boolean; desks: DeskCfg[]; mode: FloorMode;
  create: (b: unknown) => Promise<CreateResult>; close: () => void; reset: () => Promise<CreateResult | null>;
}) {
  const [amount, setAmount] = useState("1000");
  const [err, setErr] = useState("");
  const [confirm, setConfirm] = useState<"" | "close" | "reset">("");
  const px = price ?? 0;
  const eq = demo && px ? demoEquity(demo, px) : demo?.balance ?? 0;
  const stats = useMemo(() => (demo && px ? botStats(demo, desks, px) : []), [demo, desks, px]);
  const v = validateBalance(amount);

  if (!demo)
    return (
      <section className="dm card-ish" aria-label="Create a demo account">
        <div className="dm-h">
          <div>
            <span className="bo-lbl">Demo account · simulated</span>
            <h3>Watch the six bots trade a demo balance</h3>
            <p className="dm-copy">Pick a starting balance. The bots run the same strategy and risk code as the live testnet fleet on live XLM prices, with simulated fills, fees, funding and slippage. Nothing is real money and nothing touches a wallet; the demo lives only in this browser.</p>
          </div>
        </div>
        <form className="dm-form" onSubmit={async (e) => { e.preventDefault(); setErr(""); const r = await create(amount); if (!r.ok) setErr(r.message); }}>
          <div className="dm-presets" role="group" aria-label="Preset balances">
            {DEMO_PRESETS.map((p) => (
              <button type="button" key={p} className={Number(amount) === p ? "on" : ""} onClick={() => setAmount(String(p))}>{usd(p, 0)}</button>
            ))}
          </div>
          <label className="dm-amt">
            <span>Starting balance (demo $)</span>
            <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} aria-invalid={!v.ok} aria-describedby="dm-hint" />
          </label>
          <button className="btn" type="submit" disabled={!v.ok || !available}>Start demo</button>
          <small id="dm-hint" className={v.ok ? "" : "bad"}>{v.ok ? `${usd(DEMO_MIN, 0)} – ${usd(DEMO_MAX, 0)} · split across the six desks like the fleet` : v.reason}</small>
          {err && <small className="bad" role="alert">{err}</small>}
        </form>
        <p className="dm-fine">Simulated results only. Past or simulated performance does not guarantee future results; there are no guaranteed returns. One demo per browser.</p>
      </section>
    );

  const pnl = eq - demo.balance;
  const away = demo.away[demo.away.length - 1];
  return (
    <section className="dm card-ish" aria-label="Your demo account">
      <div className="dm-h">
        <div>
          <span className="bo-lbl">Demo account · simulated · not real money</span>
          <h3>{usd(eq)} <small className={pnl > 0.004 ? "g" : pnl < -0.004 ? "r" : ""}>{signed(pnl)}</small></h3>
          <p className="dm-copy">Started with {usd(demo.balance)} {fmtGap(Math.max(60, Math.floor(Date.now() / 1000) - demo.createdAt))} ago · {runner ? "simulating in this tab" : "simulated by another open tab"}{demo.fleet.killed ? ` · floor stop: ${demo.fleet.killReason}` : ""}</p>
          {(note || away) && <p className="dm-note">{note || (away.mode === "caught-up" ? `caught up ${fmtGap(away.to - away.from)} from price history` : `paused while away ${fmtGap(away.to - away.from)}`)}</p>}
        </div>
        <div className="dm-actions">
          <p className="dm-one">You already have a demo open — close it to start a new one.</p>
          {confirm ? (
            <div className="dm-confirm" role="alertdialog" aria-label={`Confirm ${confirm}`}>
              <span>{confirm === "close" ? "Close this demo? Its history is deleted." : `Reset to a fresh ${usd(demo.balance)} demo?`}</span>
              <button className="btn small" onClick={async () => { const c = confirm; setConfirm(""); if (c === "close") close(); else await reset(); }}>Yes, {confirm}</button>
              <button className="btn small ghost" onClick={() => setConfirm("")}>Cancel</button>
            </div>
          ) : (
            <div className="dm-btns">
              <button className="btn small ghost" onClick={() => setConfirm("reset")}>Reset</button>
              <button className="btn small ghost danger" onClick={() => setConfirm("close")}>Close demo</button>
            </div>
          )}
        </div>
      </div>
      {mode !== "mirror" && (
        <div className="dm-body">
          <Curve pts={demo.history} start={demo.balance} />
          <table className="dm-stats">
            <thead><tr><th>Bot</th><th>Trades</th><th>Win</th><th>P&amp;L</th><th>Max DD</th><th>Status</th></tr></thead>
            <tbody>
              {stats.map((s) => (
                <tr key={s.id}>
                  <td>{s.name}</td><td>{s.trades}</td><td>{s.winRate === null ? "—" : `${Math.round(s.winRate * 100)}%`}</td>
                  <td className={s.pnl > 0.004 ? "g" : s.pnl < -0.004 ? "r" : ""}>{signed(s.pnl)}</td><td>{s.maxDd.toFixed(1)}%</td><td>{s.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="dm-fine">Simulated results only: fills, fees (10 bps), funding and slippage (5 bps) are modelled, not executed. Past or simulated performance does not guarantee future results; there are no guaranteed returns. The one-demo cap is per browser.</p>
    </section>
  );
}
