/**
 * Back Office trading-floor desk: a small SVG yeti trader seated at an office desk with a monitor showing the live mini chart.
 * Pose and motion are driven only by real data (bot status, on-chain positions/close events); the page's labelled
 * EXAMPLE mode feeds scripted views through the same component.
 * Motion is CSS-only (transform/opacity) and is disabled under prefers-reduced-motion.
 */
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { STELLAR } from "./SpaceYeti";
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
function fluff(cx: number, cy: number, rx: number, ry: number, n: number, tuft: number): string {
  const pt = (a: number, k: number) => [cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k];
  let d = "";
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2, am = (a0 + a1) / 2;
    const [x0, y0] = pt(a0, 1), [x1, y1] = pt(a1, 1), [xm, ym] = pt(am, 1 + tuft);
    d += `${i ? "" : `M${x0.toFixed(1)} ${y0.toFixed(1)}`} Q${xm.toFixed(1)} ${ym.toFixed(1)} ${x1.toFixed(1)} ${y1.toFixed(1)}`;
  }
  return d + "Z";
}
const HEAD = fluff(60, 41, 22, 19.5, 16, 0.16);
const BODY = fluff(60, 88, 24, 22, 18, 0.12);

/** Per-bot accessory (the old robots differed by antenna; the yetis get a small prop each). */
function Accessory({ id }: { id: string }) {
  if (id === "vega") // headset
    return (<g className="yt-acc"><path className="yt-band" d="M38 38 Q60 12 82 38" /><rect className="yt-cup" x="34" y="35" width="7" height="11" rx="3" /><rect className="yt-cup" x="79" y="35" width="7" height="11" rx="3" /><path className="yt-band thin" d="M37 45 Q42 55 52 53" /><circle className="rb-bulb" cx="53" cy="53" r="2" /></g>);
  if (id === "rigel") // knit beanie with pom-pom
    return (<g className="yt-acc"><path className="yt-hat" d="M40 33 Q41 15 60 14 Q79 15 80 33 Z" /><rect className="yt-hat-rim" x="38" y="29" width="44" height="7" rx="3.5" /><path className="yt-knit" d="M46 29 V18 M53 29 V15.5 M60 29 V14.5 M67 29 V15.5 M74 29 V18" /><circle className="rb-bulb" cx="60" cy="12" r="4" /></g>);
  if (id === "lyra") // goggles pushed up on the forehead
    return (<g className="yt-acc"><path className="yt-band" d="M39 31 Q60 25 81 31" /><circle className="yt-lens" cx="52" cy="29" r="5.5" /><circle className="yt-lens" cx="68" cy="29" r="5.5" /><circle className="rb-bulb" cx="50.5" cy="27.5" r="1.4" /></g>);
  if (id === "nova") // scarf
    return (<g className="yt-acc"><path className="yt-scarf" d="M42 60 Q60 67 78 60 L78 66 Q60 73 42 66 Z" /><path className="yt-scarf" d="M68 64 L72 80 L65 80 L63 66 Z" /><path className="yt-knit" d="M66 74 H71 M65.5 77 H71.5" /></g>);
  if (id === "echo") // round reading glasses
    return (<g className="yt-acc"><circle className="yt-glass" cx="54" cy="42" r="5" /><circle className="yt-glass" cx="66" cy="42" r="5" /><path className="yt-glass" d="M59 42 H61 M49 41 L43 39 M71 41 L77 39" /></g>);
  if (id === "halo") // earmuffs
    return (<g className="yt-acc"><path className="yt-band" d="M40 34 Q60 14 80 34" /><circle className="yt-muff" cx="39" cy="40" r="6.5" /><circle className="yt-muff" cx="81" cy="40" r="6.5" /><circle className="rb-bulb" cx="60" cy="21" r="1.8" /></g>);
  return null;
}

function YetiHead({ id }: { id: string }) {
  return (
    <>
      <circle className="rb-ear" cx="39" cy="33" r="5" /><circle className="rb-ear" cx="81" cy="33" r="5" />
      <path className="rb-shell" d={HEAD} />
      <path className="yt-tuft" d="M54 23 Q57 17 60 22 Q63 16 66 23" />
      <ellipse className="rb-face" cx="60" cy="45" rx="14" ry="10.5" />
      <path className="yt-brow" d="M50.5 37.6 Q54 36 57 37.4 M63 37.4 Q66 36 69.5 37.6" />
      <circle className="rb-eye" cx="54" cy="41.5" r="2.5" /><circle className="rb-eye" cx="66" cy="41.5" r="2.5" />
      <circle className="yt-glint" cx="54.8" cy="40.7" r=".8" /><circle className="yt-glint" cx="66.8" cy="40.7" r=".8" />
      <ellipse className="yt-cheek" cx="49" cy="47" rx="2.6" ry="1.6" /><ellipse className="yt-cheek" cx="71" cy="47" rx="2.6" ry="1.6" />
      <path className="yt-nose" d="M57.4 44.6 Q60 43.4 62.6 44.6 Q60 47.6 57.4 44.6 Z" />
      <Accessory id={id} />
    </>
  );
}

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
          <g className="bo-beacon">
            <circle className="bo-halo" cx="17" cy="17" r="9" />
            <rect x="10" y="18" width="14" height="4" rx="1.5" fill="#2a2f4c" />
            <path className="bo-dome" d="M11.5 18 a5.5 5.5 0 0 1 11 0z" />
          </g>
          <g className="rb-lean">
            <rect className="rb-chair" x="27" y="54" width="66" height="54" rx="12" />
            <g className="rb-body">
              <path className="rb-torso" d={BODY} />
              <g transform="translate(52 81) scale(0.52)"><path className="yt-mark" fillRule="evenodd" clipRule="evenodd" d={STELLAR} /></g><path className="yt-hem" d="M37 104 Q60 114 83 104" />
              <circle className="rb-led" cx="49" cy="78" r="2.4" /><rect className="rb-bars" x="45.5" y="81.5" width="7" height="2" rx="1" /><rect className="rb-bars b2" x="46.5" y="84.5" width="5" height="2" rx="1" />
              <path className="yt-hood" d="M34 50 Q32 14 60 12 Q88 14 86 50 Q84 66 60 70 Q36 66 34 50 Z" />
              <g className="rb-hd">
                <YetiHead id={d.cfg.id} />
                <path className="rb-mouth m-n" d="M53 48.5 Q60 51 67 48.5" />
                <path className="rb-mouth m-w" d="M51 47 Q60 54 69 47" />
                <path className="rb-mouth m-l" d="M53 51 Q60 46.5 67 51" />
                <text className="rb-alert" x="60" y="44">!</text>
              </g>
              <g className="rb-a1"><path className="rb-arm" d="M42 76 Q33 92 63 100" /><path className="yt-arm-fur" d="M42 76 Q33 92 63 100" /><ellipse className="rb-hand" cx="66" cy="100" rx="5" ry="3.8" /><path className="yt-claw" d="M68 98 v3 M65.5 98.3 v3" /></g>
              <g className="rb-a2"><path className="rb-arm" d="M78 76 Q92 90 99 100" /><path className="yt-arm-fur" d="M78 76 Q92 90 99 100" /><rect className="yt-patch" x="84" y="80" width="6" height="6" rx="1" transform="rotate(40 87 83)" /><ellipse className="rb-hand" cx="101" cy="100" rx="5" ry="3.8" /><path className="yt-claw" d="M103 98 v3 M100.5 98.3 v3" /></g>
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
