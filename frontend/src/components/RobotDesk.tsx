/**
 * Back Office trading-floor desk: a small SVG yeti trader seated at an office desk with a monitor showing the live mini chart.
 * Pose and motion are driven only by real data (bot status, on-chain positions/close events); the page's labelled
 * EXAMPLE mode feeds scripted views through the same component.
 * Motion is CSS-only (transform/opacity) and is disabled under prefers-reduced-motion.
 */
import { useEffect, useRef, useState, type CSSProperties } from "react";
const YETI_BASE: string = ((import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? "/").replace(/\/?$/, "/");
import {
  STRATEGY_LABEL, STRATEGY_SHORT, bubbleFor, deskTally, fmtPnl, pnlTone, reactionFor, sparkPath, tfLabel,
  type DeskView,
} from "../lib/backOffice";

const STATUS_TEXT = { running: "Running", paused: "Paused", halted: "Halted", unknown: "No status" } as const;

export function useReducedMotion(): boolean {
  const [r, setR] = useState(false);
  useEffect(() => {
    const m = typeof window !== "undefined" && window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
    if (!m) return;
    const f = () => setR(m.matches);
    f();
    m.addEventListener?.("change", f);
    return () => m.removeEventListener?.("change", f);
  }, []);
  return r;
}

/** Odometer-style count toward `target` (ease-out, ~0.9 s); jumps straight there under reduced motion. */
export function useCountUp(target: number, reduced: boolean): number {
  const [v, setV] = useState(target);
  const cur = useRef(target);
  useEffect(() => {
    if (reduced || typeof requestAnimationFrame === "undefined") {
      cur.current = target;
      setV(target);
      return;
    }
    const a = cur.current, t0 = performance.now();
    let raf = 0;
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / 900);
      const x = a + (target - a) * (1 - (1 - k) ** 3);
      cur.current = x;
      setV(x);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, reduced]);
  return v;
}

/** Fluffy outline: a circle-ish blob with scalloped fur tufts (deterministic, no randomness). */
interface Fx {
  id: number;
  kind: "open" | "win" | "loss";
  text: string;
}

export function RobotDesk({ d, i, now, selected, onSelect, tradesLoaded, example, tag }: { d: DeskView; i: number; now: number; selected: boolean; onSelect: () => void; tradesLoaded: boolean; example: boolean; tag?: string }) {
  const reduced = useReducedMotion();
  const unit = d.unit ?? "QUSD";
  const label = tag ?? (example ? "example" : null);
  const pnl = d.pnl;
  const shown = useCountUp(pnl ?? 0, reduced);
  const tone = d.status === "halted" ? "dn" : pnlTone(pnl);
  const pos = d.positions[0];
  const tally = deskTally(d.trades);
  const upnl = d.positions.reduce((a, p) => a + p.upnl, 0);
  const bubble = bubbleFor(d.trades, now);

  // Trade effects: popups/coins only for trades that arrive while the page is open (never replayed on load).
  const head = d.trades[0];
  const key = head ? `${head.tx}:${head.kind}:${head.id}` : "";
  const prev = useRef<string | null>(null);
  const [fx, setFx] = useState<Fx[]>([]);
  useEffect(() => {
    if (!tradesLoaded) return;
    if (prev.current === null) {
      prev.current = key;
      return;
    }
    if (!key || key === prev.current) return;
    prev.current = key;
    const t = d.trades[0];
    const id = Date.now() + Math.random();
    const e: Fx = t.kind === "open" ? { id, kind: "open", text: `${(t.side ?? "").toUpperCase()} ${(t.leverage ?? 0).toFixed(1)}×` } : { id, kind: (t.pnl ?? 0) >= 0 ? "win" : "loss", text: `${fmtPnl(t.pnl ?? 0)} ${unit}` };
    setFx((f) => [...f.slice(-3), e]);
    const tm = setTimeout(() => setFx((f) => f.filter((x) => x.id !== id)), 2800);
    return () => clearTimeout(tm);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, tradesLoaded]);
  const lastFx = fx[fx.length - 1];
  const rx = lastFx && lastFx.kind !== "open" ? lastFx.kind : reactionFor(d.trades, now);

  const sp = sparkPath(d.spark, 86, 30);
  const scr = tone === "dn" ? "#e8836a" : "#a9c47f";
  const style = { "--d": `${(i * 0.73) % 4}s` } as CSSProperties;
  return (
    <button
      className={`bo-desk ${d.cfg.strategy} st-${d.status} t-${tone} ${rx ? `rx-${rx}` : ""} ${selected ? "sel" : ""}`}
      style={style}
      onClick={onSelect}
      aria-pressed={selected}
      aria-label={`${d.cfg.name} desk: ${STATUS_TEXT[d.status]}, P&L ${fmtPnl(pnl)} ${unit}`}
    >
      <span className="bo-top">
        <span className="bo-nm">{d.cfg.name}</span>
        <span className="bo-tf" title={`trades on ${tfLabel(d.cfg.timeframeSec)} bars`}>{tfLabel(d.cfg.timeframeSec)}</span>
        <span className="bo-tag" title={STRATEGY_LABEL[d.cfg.strategy]}>{STRATEGY_SHORT[d.cfg.strategy]} · {tfLabel(d.cfg.timeframeSec)}</span>
        <span className="bo-light"><i />{STATUS_TEXT[d.status]}</span>
      </span>
      {d.cfg.paused ? (
        <span className="bo-note paused" title={d.cfg.paused}>Paused · {d.cfg.paused}</span>
      ) : d.cfg.label ? (
        <span className="bo-note exp" title={d.cfg.label}>{d.cfg.label}</span>
      ) : d.cfg.lpFilterBars ? (
        <span className="bo-note" title={`entries need a liquidity sweep + reclaim within ${d.cfg.lpFilterBars} bars`}>+ liquidity-pocket filter (≤{d.cfg.lpFilterBars} bars)</span>
      ) : null}

      <span className="bo-scene">
        <svg className="bo-svg" viewBox="0 0 240 156" aria-hidden>
          <rect className="bo-wall" x="3" y="4" width="234" height="102" rx="10" />
          <g className="bo-lamp">
            <circle className="bo-halo" cx="17" cy="17" r="9" />
            <rect x="10" y="18" width="14" height="4" rx="1.5" fill="#2a2f4c" />
            <path className="bo-dome" d="M11.5 18 a5.5 5.5 0 0 1 11 0z" />
          </g>
          <g className="rb-lean">
            <rect className="rb-chair" x="27" y="54" width="66" height="54" rx="12" />
            <g className="rb-body">
              <image className="yt-photo" href={`${YETI_BASE}frost/yeti-desk.webp`} x="16" y="8" width="96" height="91" preserveAspectRatio="xMidYMax meet" />
              <g className="rb-hd"><text className="rb-alert" x="60" y="20">!</text></g>
            </g>
          </g>
          <polygon className="bo-top-s" points="5,104 235,104 229,112 11,112" />
          <rect className="bo-front" x="11" y="112" width="218" height="42" rx="3" />
          <line className="bo-glowline" x1="14" y1="112.5" x2="226" y2="112.5" />
          <rect className="bo-kb" x="70" y="99" width="52" height="6" rx="2" />
          <path className="bo-keys" d="M74 101.5 H118 M76 103.3 H116" />
          <g className="bo-mug"><rect x="200" y="93" width="10" height="11" rx="2" /><path d="M210 96 h2.5 a2.5 2.5 0 0 1 0 5 h-2.5" /><path className="bo-steam" d="M203 90 q-2 -3 0 -6 M207 90 q2 -3 0 -6" /></g>
          <rect className="bo-stand" x="165" y="88" width="9" height="16" />
          <rect className="bo-foot" x="151" y="102" width="37" height="3" rx="1.5" />
          <rect className="bo-mon" x="118" y="14" width="104" height="76" rx="6" />
          <rect className="bo-scr" x="123" y="19" width="94" height="66" rx="3" />
          <text className="bo-st" x="127" y="28">XLM-PERP</text>
          <text className="bo-st b" x="213" y="28" textAnchor="end" fill={tone === "flat" ? "#d8c7a8" : scr}>{d.status === "halted" ? "HALT" : fmtPnl(pnl)}</text>
          {sp.line ? (
            <g transform="translate(127 34)">
              <path d={sp.area} fill={scr} opacity=".14" />
              <path d={sp.line} fill="none" stroke={scr} strokeWidth="1.3" />
              {sp.last && <circle className="bo-dot" cx={sp.last[0]} cy={sp.last[1]} r="2" />}
            </g>
          ) : (
            <text className="bo-st" x="170" y="52" textAnchor="middle">waiting for bars</text>
          )}
          <text className="bo-st b" x="127" y="74">{d.status === "halted" ? "HALTED" : pos ? `${pos.side.toUpperCase()} ${pos.leverage.toFixed(1)}× · ${pos.margin.toFixed(0)}m` : "FLAT"}</text>
          <text className="bo-st" x="127" y="81">{pos ? `entry ${pos.entry.toFixed(4)} · uPnL ${fmtPnl(pos.upnl)}` : (d.lastSignal || "watching XLM").slice(0, 26)}</text>
          {d.status === "unknown" && <rect className="bo-off" x="123" y="19" width="94" height="66" rx="3" />}
        </svg>

        {bubble && <span className={`bo-bubble ${bubble.tone}`}>{bubble.text}<i /></span>}
        {d.status === "paused" && <span className="bo-zzz" aria-hidden><i>z</i><i>z</i><i>Z</i></span>}
        <span className={`bo-odo ${tone}`} title={`Running P&L (realized + unrealized), ${unit}`}>
          {label && <em>{label}</em>}
          <b>{pnl === null ? "···" : fmtPnl(shown)}</b><small>{unit}</small>
        </span>
        {fx.map((e) => (
          <span key={e.id} className="bo-fx" aria-hidden>
            <span className={`bo-pop ${e.kind}`}>{e.text}</span>
            <i className={`bo-coin ${e.kind}`} />
          </span>
        ))}
      </span>

      <span className="bo-tally">
        <span><b className={tally.wins ? "g" : ""}>W {tally.wins}</b> · <b className={tally.losses ? "r" : ""}>L {tally.losses}</b></span>
        <span>won <b className={tally.grossWon ? "g" : ""}>{tally.grossWon ? `+${tally.grossWon.toFixed(2)}` : "0.00"}</b></span>
        <span>lost <b className={tally.grossLost ? "r" : ""}>{tally.grossLost ? `−${tally.grossLost.toFixed(2)}` : "0.00"}</b></span>
        <span>uPnL <b className={pos ? (upnl >= 0 ? "g" : "r") : ""}>{pos ? fmtPnl(upnl) : "—"}</b></span>
      </span>
      {d.watching && <span className="bo-watch" title={d.watching}><i>watching</i> {d.watching}</span>}
    </button>
  );
}
