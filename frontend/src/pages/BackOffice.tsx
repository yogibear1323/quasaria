import { useEffect, useMemo, useState } from "react";
import { PageHead, RiskWarning } from "../components/ui";
import { expertContract } from "../lib/config";
import { useChain } from "../lib/chain";
import { short } from "../lib/format";
import {
  BACK_OFFICE, STRATEGY_LABEL, fetchStatus, mergeDesks, readFloorOnChain, readFloorTrades, sparkPath, statusAge, tfLabel,
  type ChainTrade, type DeskView, type StatusDoc,
} from "../lib/backOffice";
import { PERPS } from "../lib/perps";
import "../theme/back-office.css";

const EXPERT_TX = "https://stellar.expert/explorer/testnet/tx/";
const EXPERT_ACCT = "https://stellar.expert/explorer/testnet/account/";
const sgn = (v: number, d = 2) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(d)}`;
const STATUS_TEXT = { running: "Running", paused: "Paused", halted: "Halted", unknown: "No status" } as const;
const ago = (s: number | null) => (s === null ? "—" : s < 90 ? `${Math.round(s)} s` : s < 5400 ? `${Math.round(s / 60)} min` : `${(s / 3600).toFixed(1)} h`);

function Spark({ values, up, id }: { values: number[]; up: boolean; id: string }) {
  const p = sparkPath(values);
  const color = up ? "#34d399" : "#fb7185";
  if (!p.line) return <div className="bo-spark bo-spark-empty">waiting for bars</div>;
  return (
    <svg className="bo-spark" viewBox="0 0 150 46" preserveAspectRatio="none" aria-hidden>
      <defs>
        <linearGradient id={`bo-g-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity=".35" />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={p.area} fill={`url(#bo-g-${id})`} />
      <path d={p.line} fill="none" stroke={color} strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
      {p.last && <circle cx={p.last[0]} cy={p.last[1]} r="2.4" fill="#fff" />}
    </svg>
  );
}

function bubbleFor(d: DeskView, now: number): string | null {
  const t = d.trades.find((x) => x.kind === "open");
  if (!t || now - Date.parse(t.at) / 1000 > 3 * 3600) return null;
  return `${(t.side ?? "").toUpperCase()} XLM ${(t.leverage ?? 0).toFixed(1)}×`;
}

function Desk({ d, selected, onSelect, now, i }: { d: DeskView; selected: boolean; onSelect: () => void; now: number; i: number }) {
  const pnl = d.pnl ?? 0;
  const up = pnl >= 0 && d.status !== "halted";
  const pos = d.positions[0];
  const bubble = bubbleFor(d, now);
  return (
    <button className={`bo-desk ${d.cfg.strategy} ${d.status} ${selected ? "sel" : ""} ${up ? "up" : "dn"}`} onClick={onSelect} aria-pressed={selected} aria-label={`${d.cfg.name} desk`}>
      {bubble && <span className={`bo-bubble ${i % 2 ? "l" : ""}`}>{bubble}<i /></span>}
      <span className="bo-top">
        <span className="bo-tag">{STRATEGY_LABEL[d.cfg.strategy]} · {tfLabel(d.cfg.timeframeSec)}</span>
        <span className="bo-light"><i />{STATUS_TEXT[d.status]}</span>
      </span>
      <span className="bo-laptop">
        <span className="bo-screen">
          <span className="bo-scr-h"><span>XLM-PERP</span><span className={up ? "g" : "r"}>{d.pnl === null ? "—" : sgn(pnl)}</span></span>
          <Spark values={d.spark} up={up} id={d.cfg.id} />
          <span className="bo-scr-f">
            {d.status === "halted" ? <b className="r">HALTED</b> : pos ? <b>{pos.side.toUpperCase()} {pos.leverage.toFixed(1)}× · {pos.margin.toFixed(0)} m</b> : <b>FLAT</b>}
            <span>{pos ? `entry ${pos.entry.toFixed(4)} · stop ${pos.stop ? pos.stop.toFixed(4) : "—"}` : d.lastSignal ? d.lastSignal.slice(0, 34) : "waiting for a signal"}</span>
          </span>
        </span>
        <span className="bo-base" />
      </span>
      <span className="bo-surface" />
      <span className="bo-plate"><span className="bo-nm">{d.cfg.name}</span><span className="bo-pnl">{d.pnl === null ? "—" : sgn(pnl)} <small>QUSD</small></span></span>
    </button>
  );
}

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
  return (
    <a className="bo-tr" href={EXPERT_TX + t.tx} target="_blank" rel="noreferrer">
      <span className={t.kind === "open" ? "c" : (t.pnl ?? 0) >= 0 ? "g" : "r"}>{t.kind === "open" ? "OPEN" : (t.reason ?? "close").replace("_", " ").toUpperCase().slice(0, 6)}</span>
      {t.kind === "open" ? `${(t.side ?? "").toUpperCase()} ${(t.leverage ?? 0).toFixed(1)}× @${t.price.toFixed(4)}` : `#${t.id} ${sgn(t.pnl ?? 0)} @${t.price.toFixed(4)}`}
      <em>{when}</em>
    </a>
  );
}

function Panel({ d, status }: { d: DeskView; status: StatusDoc | null }) {
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
          <h3>{d.cfg.name}</h3>
          <a className="bo-mut" href={EXPERT_ACCT + d.cfg.owner} target="_blank" rel="noreferrer">owner {short(d.cfg.owner)} · bot key {short(d.cfg.operator)} (cannot withdraw)</a>
        </div>
        <span className={`bo-light ${d.status}`}><i />{STATUS_TEXT[d.status]}</span>
      </div>
      {d.reason && <div className="bo-reason">{d.reason}</div>}
      <div className="bo-pos">
        <div><span className="bo-lbl">Position</span>{pos ? <b className={pos.side === "long" ? "g" : "r"}>{pos.side.toUpperCase()} XLM {pos.leverage.toFixed(1)}×</b> : <b>Flat</b>}<span>{pos ? `notional ${pos.size.toFixed(0)} · margin ${pos.margin.toFixed(0)} QUSD` : `${d.positions.length} open`}</span></div>
        <div><span className="bo-lbl">Unrealized</span><b className={(pos?.upnl ?? 0) >= 0 ? "g" : "r"}>{pos ? sgn(pos.upnl) : "—"}</b><span>{pos ? `entry ${pos.entry.toFixed(4)}` : "no open position"}</span></div>
      </div>
      <div className="bo-row"><span className="bo-lbl">Risk per trade</span><b>{d.cfg.riskPct.toFixed(2)}% <small>· max {d.cfg.maxLeverage}×</small></b></div>
      <div className="bo-row"><span className="bo-lbl">Stop / take-profit</span><b>{pos?.stop ? pos.stop.toFixed(4) : "—"} <small>/ {pos?.takeProfit ? pos.takeProfit.toFixed(4) : "—"}</small></b></div>
      <div className="bo-row"><span className="bo-lbl">Equity</span><b>{d.equity === null ? "—" : d.equity.toFixed(2)} <small>/ {d.cfg.capital} test QUSD</small></b></div>
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
  const [sel, setSel] = useState(BACK_OFFICE.desks[0].id);
  const selected = desks.find((d) => d.cfg.id === sel) ?? desks[0];

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
        <div className="bo-t"><span className="bo-lbl">Fleet PnL · since start</span><b className={(fleetPnl ?? 0) >= 0 ? "g" : "r"}>{fleetPnl === null ? "—" : sgn(fleetPnl)} <small>QUSD</small></b><span>{totalEq === null ? "—" : `${totalEq.toFixed(2)} of ${startEq.toFixed(0)} test QUSD`}{status ? ` · today ${sgn(status.fleet.pnlToday)}` : ""}</span></div>
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

      <div className="bo-grid">
        <section className="bo-floor" aria-label="Trading floor">
          <div className="bo-floor-h">
            <h2>Trading floor</h2>
            <div className="bo-legend">
              <span className="bo-tag trend">Trend</span><span className="bo-tag funding">Funding</span><span className="bo-tag meanrev">Mean-Rev</span>
              <span className="bo-sep" /><span className="bo-lg running"><i />running</span><span className="bo-lg paused"><i />paused</span><span className="bo-lg halted"><i />halted</span>
            </div>
          </div>
          <div className="bo-desks">
            {desks.map((d, i) => <Desk key={d.cfg.id} d={d} i={i} now={now} selected={d.cfg.id === selected.cfg.id} onSelect={() => setSel(d.cfg.id)} />)}
          </div>
        </section>
        <Panel d={selected} status={status} />
      </div>

      <RiskWarning>
        These bots trade with test funds on Stellar testnet. They are experiments: unaudited code, simple rule-based strategies, oracle-priced fills, and profits capped by a finite vault reserve. Past or live results say nothing about the future, and nothing here is financial advice.
      </RiskWarning>
    </div>
  );
}
