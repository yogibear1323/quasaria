import { useEffect, useMemo, useState } from "react";
import { PageHead, RiskWarning } from "../components/ui";
import { expertContract } from "../lib/config";
import { useChain } from "../lib/chain";
import { short } from "../lib/format";
import {
  BACK_OFFICE, STRATEGY_LABEL, applyExample, deskTally, exampleInit, exampleStep, fetchStatus, floorTape, fmtPnl, mergeDesks, readFloorOnChain, readFloorTrades, statusAge, tfLabel,
  type ChainTrade, type DeskView, type ExampleState, type StatusDoc,
} from "../lib/backOffice";
import { RobotDesk, useCountUp, useReducedMotion } from "../components/RobotDesk";
import { DemoAccount, ModeSwitch, type FloorMode } from "../components/DemoAccount";
import { useDemo } from "../lib/demo/useDemo";
import { demoViews, mirrorViews } from "../lib/demo/views";
import { useSearchParams } from "react-router-dom";
import { PERPS } from "../lib/perps";
import "../theme/back-office.css";

const EXPERT_TX = "https://stellar.expert/explorer/testnet/tx/";
const EXPERT_ACCT = "https://stellar.expert/explorer/testnet/account/";
const STATUS_TEXT = { running: "Running", paused: "Paused", halted: "Halted", unknown: "No status" } as const;
const ago = (s: number | null) => (s === null ? "—" : s < 90 ? `${Math.round(s)} s` : s < 5400 ? `${Math.round(s / 60)} min` : `${(s / 3600).toFixed(1)} h`);

function Meter({ label, value, limit }: { label: string; value: number | null; limit: number }) {
  const pct = value === null ? 0 : Math.min(100, (value / limit) * 100);
  return (
    <div className="bo-meter">
      <div className="bo-m-h"><span className="bo-lbl">{label}</span><span>{value === null ? "—" : `${value.toFixed(1)}%`} / {limit.toFixed(1)}%</span></div>
      <div className={`bo-bar ${pct > 60 ? "warn" : ""}`}><i style={{ width: `${Math.max(2, pct)}%` }} /></div>
    </div>
  );
}

function TradeRow({ t }: { t: ChainTrade }) {
  const when = new Date(t.at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  if (t.tx.startsWith("example") || t.tx.startsWith("demo"))
    return (
      <span className="bo-tr ex">
        <span className={t.kind === "open" ? "c" : (t.pnl ?? 0) >= 0 ? "g" : "r"}>{t.kind === "open" ? "OPEN" : "CLOSE"}</span>
        {t.kind === "open" ? `${(t.side ?? "").toUpperCase()} ${(t.leverage ?? 0).toFixed(1)}×` : `${fmtPnl(t.pnl ?? 0)}`}
        <em>{t.tx.startsWith("demo") ? "demo · simulated" : "example"}</em>
      </span>
    );
  return (
    <a className="bo-tr" href={EXPERT_TX + t.tx} target="_blank" rel="noreferrer">
      <span className={t.kind === "open" ? "c" : (t.pnl ?? 0) >= 0 ? "g" : "r"}>{t.kind === "open" ? "OPEN" : (t.reason ?? "close").replace("_", " ").toUpperCase().slice(0, 6)}</span>
      {t.kind === "open" ? `${(t.side ?? "").toUpperCase()} ${(t.leverage ?? 0).toFixed(1)}× @${t.price.toFixed(4)}` : `#${t.id} ${fmtPnl(t.pnl ?? 0)} @${t.price.toFixed(4)}`}
      <em>{when}</em>
    </a>
  );
}

function Panel({ d, status, example, tag }: { d: DeskView; status: StatusDoc | null; example: boolean; tag?: string }) {
  const pos = d.positions[0];
  const L = BACK_OFFICE.limits;
  const drift = d.drift;
  const dash = drift ? (drift.score / 100) * 100.5 : 0;
  const dcol = !drift ? "#7d84a6" : drift.level === "red" ? "#fb7185" : drift.level === "amber" ? "#fbbf24" : "#34d399";
  return (
    <aside className="bo-panel" aria-label={`${d.cfg.name} details`}>
      <div className="bo-p-h">
        <div>
          <span className={`bo-tag ${d.cfg.strategy}`}>{STRATEGY_LABEL[d.cfg.strategy]} · {tfLabel(d.cfg.timeframeSec)}</span>
          <h3>{d.cfg.name}{(example || tag) && <span className="bo-exchip">{example ? "example" : tag}</span>}</h3>
          <a className="bo-mut" href={EXPERT_ACCT + d.cfg.owner} target="_blank" rel="noreferrer">owner {short(d.cfg.owner)} · bot key {short(d.cfg.operator)} (cannot withdraw)</a>
        </div>
        <span className={`bo-light ${d.status}`}><i />{STATUS_TEXT[d.status]}</span>
      </div>
      {d.reason && <div className="bo-reason">{d.reason}</div>}
      <div className="bo-pos">
        <div><span className="bo-lbl">Position</span>{pos ? <b className={pos.side === "long" ? "g" : "r"}>{pos.side.toUpperCase()} XLM {pos.leverage.toFixed(1)}×</b> : <b>Flat</b>}<span>{pos ? `notional ${pos.size.toFixed(0)} · margin ${pos.margin.toFixed(0)} QUSD` : `${d.positions.length} open`}</span></div>
        <div><span className="bo-lbl">Unrealized</span><b className={(pos?.upnl ?? 0) >= 0 ? "g" : "r"}>{pos ? fmtPnl(pos.upnl) : "—"}</b><span>{pos ? `entry ${pos.entry.toFixed(4)}` : "no open position"}</span></div>
      </div>
      <div className="bo-row"><span className="bo-lbl">Risk per trade</span><b>{d.cfg.riskPct.toFixed(2)}% <small>· max {d.cfg.maxLeverage}×</small></b></div>
      <div className="bo-row"><span className="bo-lbl">Stop / take-profit</span><b>{pos?.stop ? pos.stop.toFixed(4) : "—"} <small>/ {pos?.takeProfit ? pos.takeProfit.toFixed(4) : "—"}</small></b></div>
      <div className="bo-row"><span className="bo-lbl">Running P&amp;L</span><b className={(d.pnl ?? 0) > 0.004 ? "g" : (d.pnl ?? 0) < -0.004 ? "r" : ""}>{fmtPnl(d.pnl)} <small>{d.unit ?? "QUSD"} · {(() => { const t = deskTally(d.trades); return `W ${t.wins} · L ${t.losses} · won ${t.grossWon.toFixed(2)} · lost ${t.grossLost.toFixed(2)}`; })()}</small></b></div>
      <div className="bo-row"><span className="bo-lbl">Equity</span><b>{d.equity === null ? "—" : d.equity.toFixed(2)} <small>/ {d.cfg.capital.toFixed(d.unit ? 2 : 0)} {d.unit ?? "test QUSD"}</small></b></div>
      <Meter label="Daily loss vs limit" value={d.dailyLossPct} limit={L.deskDailyLossPct} />
      <Meter label="Drawdown vs limit" value={d.drawdownPct} limit={L.deskDrawdownPct} />
      <div className="bo-drift">
        <div className="bo-ring">
          <svg viewBox="0 0 40 40"><circle cx="20" cy="20" r="16" fill="none" stroke="rgba(255,255,255,.08)" strokeWidth="4" /><circle cx="20" cy="20" r="16" fill="none" stroke={dcol} strokeWidth="4" strokeDasharray={`${dash} 100.5`} strokeLinecap="round" transform="rotate(-90 20 20)" /></svg>
          <b>{drift ? drift.score : "—"}</b>
        </div>
        <div><span className="bo-lbl">Drift score · {status?.driftMode ?? "—"}</span><b style={{ color: dcol }}>{!drift ? "No data" : drift.level === "green" ? "Normal" : drift.level === "amber" ? "Watch (half size)" : "Halt"}</b><span>{drift?.top ?? "waiting for the status feed"}</span></div>
      </div>
      <div className="bo-trades">
        <span className="bo-lbl">Recent on-chain trades</span>
        {d.trades.length ? d.trades.slice(0, 5).map((t) => <TradeRow key={`${t.tx}-${t.kind}`} t={t} />) : <span className="bo-mut">No trades in the last ~7 days of events.</span>}
      </div>
      {d.lastSignal && <div className="bo-signal"><span className="bo-lbl">Last signal</span>{d.lastSignal}</div>}
      <p className="bo-fine">Pause, flatten and kill are admin-only and run on the ops box, not in the browser. Testnet test funds; unaudited; no expected or guaranteed returns.</p>
    </aside>
  );
}

function WallBoard({ desks, price, funding, open, maxOpen, example, tag }: { desks: DeskView[]; price: number | null; funding: number | null; open: number; maxOpen: number; example: boolean; tag?: string }) {
  const reduced = useReducedMotion();
  const fleet = desks.some((d) => d.pnl !== null) ? desks.reduce((a, d) => a + (d.pnl ?? 0), 0) : null;
  const shown = useCountUp(fleet ?? 0, reduced);
  const tape = floorTape(desks);
  const items = tape.map(({ desk, t }) =>
    t.kind === "open" ? { k: `${t.tx}${t.kind}`, c: "c", s: `${desk.toUpperCase()} ${(t.side ?? "").toUpperCase()} XLM ${(t.leverage ?? 0).toFixed(1)}× @${t.price.toFixed(4)}` } : { k: `${t.tx}${t.kind}`, c: (t.pnl ?? 0) >= 0 ? "g" : "r", s: `${desk.toUpperCase()} CLOSED ${fmtPnl(t.pnl ?? 0)} ${desks[0]?.unit ?? "QUSD"}` },
  );
  return (
    <div className={`bo-board ${example ? "ex" : ""}`} aria-label="Trading floor wall board">
      <div className="bo-cells">
        <div><span>XLM</span><b className="c">{price ? price.toFixed(4) : "—"}</b></div>
        <div><span>Funding · 1h</span><b>{funding === null ? "—" : `${(funding * 100).toFixed(4)}%`}</b></div>
        <div><span>Open</span><b>{open}<small>/{maxOpen}</small></b></div>
        <div><span>Floor P&amp;L</span><b className={(fleet ?? 0) > 0.004 ? "g" : (fleet ?? 0) < -0.004 ? "r" : ""}>{fleet === null ? "—" : fmtPnl(shown)}</b></div>
        <div className="bo-tn"><span>{example ? "Example" : tag === "demo" ? "Demo" : tag === "mirror" ? "Mirror" : "Testnet"}</span><b className="am">{example || tag ? "not real money" : "test funds"}</b></div>
      </div>
      <div className="bo-tape" aria-live="polite">
        {items.length ? (
          <div className={`bo-tape-in ${items.length > 2 ? "run" : ""}`}>
            {[...items, ...(items.length > 2 ? items : [])].map((x, j) => <span key={`${x.k}-${j}`} className={x.c}>{x.s}</span>)}
          </div>
        ) : (
          <div className="bo-tape-in"><span>{tag === "demo" ? "No demo fills yet · six bots watching live XLM · simulated" : "No fills yet · six bots watching XLM-PERP · Testnet · test funds"}</span></div>
        )}
      </div>
    </div>
  );
}

const EXAMPLE_BEATS = 14;

export default function BackOffice() {
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setNonce((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);
  const chain = useChain(() => readFloorOnChain(), [nonce]);
  const [trades, setTrades] = useState<Record<string, ChainTrade[]> | null>(null);
  const [status, setStatus] = useState<StatusDoc | null>(null);
  const [statusErr, setStatusErr] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    fetchStatus().then((s) => alive && (setStatus(s), setStatusErr(null))).catch((e) => alive && setStatusErr(String(e?.message ?? e)));
    if (nonce % 4 === 0) readFloorTrades().then((t) => alive && setTrades(t)).catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [nonce]);
  const now = Date.now() / 1000;
  const { age, stale } = statusAge(status, now);
  const desks = useMemo(() => mergeDesks(BACK_OFFICE.desks, chain.data, status, trades, stale), [chain.data, status, trades, stale]);
  const [params, setParams] = useSearchParams();
  const qm = params.get("view");
  const [mode, setModeState] = useState<FloorMode>(qm === "demo" || params.get("demo") === "1" ? "demo" : qm === "mirror" ? "mirror" : "live");
  const setMode = (m: FloorMode) => {
    setModeState(m);
    const p = new URLSearchParams(params);
    p.delete("demo");
    if (m === "live") p.delete("view");
    else p.set("view", m);
    setParams(p, { replace: true });
  };
  const dm = useDemo({ oraclePrice: chain.data?.price ?? null, fundingHourly: status?.market.fundingPredictedHourly ?? 0 });
  const [ex, setEx] = useState<ExampleState | null>(null);
  const exPrice = chain.data?.price ?? status?.market.oraclePrice ?? 0.2;
  useEffect(() => {
    if (!ex) return;
    if (ex.step >= EXAMPLE_BEATS) {
      const t = setTimeout(() => setEx(null), 3500);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => setEx((s) => (s ? exampleStep(s, exPrice, Date.now()) : s)), ex.step === 0 ? 700 : 2200);
    return () => clearTimeout(t);
  }, [ex, exPrice]);
  const demoPx = dm.price ?? chain.data?.price ?? status?.market.oraclePrice ?? null;
  const sparks = useMemo(() => {
    const m = dm.market;
    if (!m) return {};
    const c = (b: { c: number }[]) => b.slice(-40).map((x) => x.c);
    return { 900: c(m.m15), 3600: c(m.h1), 14400: c(m.h4) } as Record<number, number[]>;
  }, [dm.market]);
  const base = useMemo(() => {
    if (mode === "demo" && dm.demo && demoPx) return demoViews(dm.demo, BACK_OFFICE.desks, demoPx, sparks);
    if (mode === "mirror") return mirrorViews(desks, dm.demo?.balance ?? 1000);
    return desks;
  }, [mode, dm.demo, demoPx, sparks, desks]);
  const tag = mode === "demo" && dm.demo ? "demo" : mode === "mirror" ? "mirror" : undefined;
  const view = useMemo(() => (ex ? applyExample(base, ex) : base), [base, ex]);
  const [sel, setSel] = useState(BACK_OFFICE.desks[0].id);
  const selected = view.find((d) => d.cfg.id === sel) ?? view[0];

  const totalEq = chain.data ? desks.reduce((a, d) => a + (d.equity ?? 0), 0) : status?.fleet.equity ?? null;
  const capital = BACK_OFFICE.desks.reduce((a, d) => a + d.capital, 0);
  const startEq = status?.fleet.startEquity || capital;
  const fleetPnl = totalEq === null ? null : totalEq - startEq;
  const openCount = chain.data ? desks.reduce((a, d) => a + d.positions.length, 0) : status?.fleet.openPositions ?? 0;
  const killed = status?.fleet.status === "killed" && !stale;
  const feedLabel = status ? `status feed ${ago(age)} ago${stale ? " · stale" : ""}` : statusErr ? "status feed unavailable" : "loading status…";

  return (
    <div className="bo">
      <PageHead
        kicker="Testnet · live bots · test funds"
        title="Back Office"
        right={
          <div className="bo-badges">
            <span className={`bo-b ${status && !stale ? "ok" : "warn"}`}>● {feedLabel}</span>
            <span className={`bo-b ${chain.live ? "ok" : "warn"}`}>{chain.loading && !chain.data ? "reading testnet…" : chain.live ? "● on-chain · Soroban testnet" : "on-chain read failed"}</span>
            <span className="bo-b am">Testnet</span>
          </div>
        }
      >
        Six automated perp bots trade the XLM perp on the{" "}
        <a href={expertContract(PERPS.vault)} target="_blank" rel="noreferrer">leverage vault</a>, each from its own testnet account with a bot key that can trade but never withdraw. Positions and trades are read on-chain; bot status comes from the runner's published feed.
      </PageHead>

      <section className="bo-ticker" aria-label="Fleet summary">
        <div className="bo-t"><span className="bo-lbl">Fleet PnL · since start</span><b className={(fleetPnl ?? 0) >= 0 ? "g" : "r"}>{fleetPnl === null ? "—" : fmtPnl(fleetPnl)} <small>QUSD</small></b><span>{totalEq === null ? "—" : `${totalEq.toFixed(2)} of ${startEq.toFixed(0)} test QUSD`}{status ? ` · today ${fmtPnl(status.fleet.pnlToday)}` : ""}</span></div>
        <div className="bo-t"><span className="bo-lbl">Risk used</span><b>{status ? `${status.fleet.riskUsedPct.toFixed(1)}%` : "—"} <small>/ {BACK_OFFICE.limits.fleetOpenRiskPct.toFixed(1)}%</small></b><div className="bo-bar"><i style={{ width: `${Math.min(100, ((status?.fleet.riskUsedPct ?? 0) / BACK_OFFICE.limits.fleetOpenRiskPct) * 100)}%` }} /></div></div>
        <div className="bo-t"><span className="bo-lbl">Open positions</span><b>{openCount} <small>/ {BACK_OFFICE.desks.length * BACK_OFFICE.limits.maxOpenPerDesk}</small></b><span>{status ? `net ${status.fleet.netSide} · same-side cap ${BACK_OFFICE.limits.fleetSameDirRiskPct}%` : "—"}</span></div>
        <div className="bo-t"><span className="bo-lbl">Oracle · XLM</span><b className={status?.market.oracleLevel === "halt" ? "r" : "c"}>{chain.data?.price ? chain.data.price.toFixed(4) : status ? status.market.oraclePrice.toFixed(4) : "—"}</b><span>{status ? `age ${status.market.oracleAgeSec}s · vs ref ${status.market.deviationPct === null ? "—" : `${status.market.deviationPct.toFixed(2)}%`} · ${status.market.oracleLevel}` : "independent check: —"}</span></div>
        <div className="bo-t"><span className="bo-lbl">Funding · 1h</span><b>{status ? `${(status.market.fundingPredictedHourly * 100).toFixed(4)}%` : "—"}</b><span>{status ? `${status.market.fundingPredictedHourly > 0 ? "longs pay" : status.market.fundingPredictedHourly < 0 ? "shorts pay" : "balanced"} · cap 0.05%/h` : "—"}</span></div>
        <div className={`bo-kill ${killed ? "on" : ""}`} role="status" title="The kill switch is operated on the ops box (CLI / local admin page). The public page is read-only.">
          <span className="bo-kdot" />
          <span>{killed ? "KILL ACTIVE" : "Global kill switch"}</span>
          <small>{killed ? status!.fleet.reason : "armed · admin-only, on the ops box"}</small>
        </div>
      </section>

      <ModeSwitch mode={mode} setMode={setMode} hasDemo={!!dm.demo} />
      {mode !== "live" && (
        <DemoAccount demo={dm.demo} price={demoPx} note={dm.note} runner={dm.runner} available={dm.available} create={dm.create} close={dm.close} reset={dm.reset} desks={BACK_OFFICE.desks} mode={mode} />
      )}
      {tag && <div className="bo-demobanner" role="status">{tag === "demo" ? "DEMO · simulated · not real money" : `MIRROR · live testnet fleet scaled to $${(dm.demo?.balance ?? 1000).toLocaleString("en-US")} · display only · not real money`}</div>}
      <div className={`bo-grid ${tag ? `m-${tag}` : ""}`}>
        <section className="bo-floor" aria-label="Trading floor">
          <div className="bo-floor-h">
            <h2>Trading floor</h2>
            <button className={`bo-exbtn ${ex ? "on" : ""}`} onClick={() => setEx(ex ? null : exampleInit())} aria-pressed={!!ex} title="Plays a scripted, clearly labelled example of the animations. Not real trades.">
              {ex ? "■ Stop example" : "▶ Play example animation"}
            </button>
            <div className="bo-legend">
              <span className="bo-tag trend">Trend</span><span className="bo-tag funding">Funding</span><span className="bo-tag meanrev">Mean-Rev</span>
              <span className="bo-sep" /><span className="bo-lg running"><i />running</span><span className="bo-lg paused"><i />paused</span><span className="bo-lg halted"><i />halted</span>
            </div>
          </div>
          <WallBoard
            desks={view}
            price={chain.data?.price ?? status?.market.oraclePrice ?? null}
            funding={status ? status.market.fundingPredictedHourly : null}
            open={ex ? view.reduce((a, d) => a + d.positions.length, 0) : openCount}
            maxOpen={BACK_OFFICE.desks.length * BACK_OFFICE.limits.maxOpenPerDesk}
            example={!!ex}
            tag={tag}
          />
          {ex && <div className="bo-exbanner" role="status">EXAMPLE · scripted animation, not real trades or P&amp;L · ends after {EXAMPLE_BEATS} beats</div>}
          <div className={`bo-desks ${ex ? "ex" : ""}`}>
            {view.map((d, i) => (
              <RobotDesk key={`${d.cfg.id}-${ex ? "ex" : tag ?? "live"}`} d={d} i={i} now={Date.now() / 1000} tradesLoaded={ex || tag === "demo" ? true : trades !== null} example={!!ex} tag={ex ? undefined : tag} selected={d.cfg.id === selected.cfg.id} onSelect={() => setSel(d.cfg.id)} />
            ))}
          </div>
        </section>
        <Panel d={selected} status={status} example={!!ex} tag={tag} />
      </div>

      <RiskWarning>
        These bots trade with test funds on Stellar testnet. They are experiments: unaudited code, simple rule-based strategies, oracle-priced fills, and profits capped by a finite vault reserve. Past or live results say nothing about the future, and nothing here is financial advice.
      </RiskWarning>
    </div>
  );
}
