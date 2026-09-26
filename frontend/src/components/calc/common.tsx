import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useXlmUsd } from "../../lib/markets";
import { fmt } from "../../lib/format";

/** Loose numeric parse for text inputs ("1,000" → 1000, junk → 0). */
export const num = (s: string) => {
  const n = Number(String(s).replace(/[, _]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/** Human number with sensible precision for token amounts. */
export function fmtAmt(n: number) {
  if (!Number.isFinite(n)) return "—";
  const a = Math.abs(n);
  if (a === 0) return "0";
  if (a >= 1e9) return `${fmt(n / 1e9, 2)}B`;
  if (a >= 1e6) return `${fmt(n / 1e6, 2)}M`;
  if (a >= 1000) return fmt(n, 2);
  if (a >= 1) return fmt(n, 4);
  if (a >= 0.0001) return fmt(n, 6);
  return n.toExponential(2);
}

export function fmtUsd(n: number | null) {
  if (n === null || !Number.isFinite(n)) return "";
  const a = Math.abs(n);
  const d = a >= 1 ? 2 : a >= 0.01 ? 4 : 6;
  return `≈ ${n < 0 ? "−" : ""}$${a.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d })}`;
}

export function fmtDays(d: number) {
  if (!Number.isFinite(d)) return "never (no emission)";
  if (d > 36_500) return "> 100 years";
  if (d >= 730) return `${fmt(d / 365, 1)} years`;
  if (d >= 1) return `${fmt(d, d < 10 ? 1 : 0)} days`;
  return `${fmt(d * 24, 1)} hours`;
}

/** Whole or one-decimal days ("7", "0.5"). */
export const fmtD = (d: number) => fmt(d, Number.isInteger(Math.round(d * 10) / 10) ? 0 : 1);

export const pctStr = (f: number, d = 2) => (Number.isFinite(f) ? `${fmt(f * 100, d)}%` : "—");

/** XLM/USD for the "≈ USD" columns (existing ticker source: stellarchain.io → Horizon fallback). */
export function useUsd() {
  const x = useXlmUsd();
  const price = x?.price ?? null;
  return {
    price,
    /** USD value of an amount measured in XLM. */
    ofXlm: (xlm: number) => (price !== null && Number.isFinite(xlm) ? xlm * price : null),
    label: price ? `XLM/USD $${price.toFixed(4)} (${x?.source === "stellarchain" ? "stellarchain.io mainnet reference" : "testnet SDEX"})` : "XLM/USD unavailable",
  };
}

/** "123.45 QFX" + "≈ $1.23" line. */
export function TokenUsd({ amount, symbol, usd, className }: { amount: number; symbol: string; usd: number | null; className?: string }) {
  return (
    <>
      <span className={className}>{fmtAmt(amount)} <small className="muted">{symbol}</small></span>
      {usd !== null && <span className="calc-usd">{fmtUsd(usd)}</span>}
    </>
  );
}

export function CalcStat({ label, children, tone, testId }: { label: string; children: ReactNode; tone?: "gold" | "pos" | "neg" | "cyan"; testId?: string }) {
  return (
    <div className={`calc-stat ${tone ?? ""}`} data-testid={testId}>
      <span className="label">{label}</span>
      <span className="value">{children}</span>
    </div>
  );
}

export function CalcDisclaimer() {
  return (
    <p className="calc-disclaimer" role="note" data-testid="calc-disclaimer">
      <b>Estimates only · not financial advice.</b> Rates, reserves, volume and prices are variable and can change or stop at any time;
      past on-chain activity does not predict the future. Stellar <b>testnet</b> only: tokens have no value. Contracts are <b>unaudited</b>.
    </p>
  );
}

export function AmountField({ label, value, onChange, unit, hint, testId }: { label: string; value: string; onChange: (v: string) => void; unit: string; hint?: ReactNode; testId?: string }) {
  return (
    <div className="field">
      <label>{label}</label>
      <div className="calc-input">
        <input className="input mono" inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value)} data-testid={testId} aria-label={label} />
        <span className="unit">{unit}</span>
      </div>
      {hint && <div className="calc-hint">{hint}</div>}
    </div>
  );
}

const PRESETS = [7, 30, 90, 180, 365];

export function DurationField({ days, onChange, max = 1095, marks = PRESETS }: { days: number; onChange: (d: number) => void; max?: number; marks?: number[] }) {
  return (
    <div className="field">
      <label>Duration: <b className="mono">{days}</b> days{days >= 365 ? ` (${fmt(days / 365, 2)} y)` : ""}</label>
      <input type="range" min={1} max={max} value={Math.min(days, max)} onChange={(e) => onChange(Number(e.target.value))} aria-label="Duration in days" />
      <div className="calc-chips">
        {marks.filter((m) => m <= max).map((m) => (
          <button key={m} type="button" className={`chip ${m === days ? "on" : ""}`} onClick={() => onChange(m)}>{m >= 365 ? `${m / 365}y` : `${m}d`}</button>
        ))}
        <input className="input mono chip-input" type="number" min={1} max={max} value={days} onChange={(e) => onChange(Math.max(1, Math.min(max, Math.round(Number(e.target.value) || 1))))} aria-label="Days" />
      </div>
    </div>
  );
}

export function CalcHead({ icon, title, kicker, right, id }: { icon: string; title: string; kicker: string; right?: ReactNode; id?: string }) {
  return (
    <div className="calc-head" id={id}>
      <div>
        <div className="kicker">{kicker}</div>
        <h2 style={{ margin: 0 }}><span className="calc-icon" aria-hidden>{icon}</span>{title}</h2>
      </div>
      <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>{right}</div>
    </div>
  );
}

export const CalcLink = ({ to, children = "Calculator →" }: { to: string; children?: ReactNode }) => (
  <Link to={to} className="btn ghost small calc-link">{children}</Link>
);

// ---------------------------------------------------------------- chart
export type Series = { name: string; color: string; points: { x: number; y: number }[]; dashed?: boolean; fill?: boolean; width?: number };
export type Marker = { x: number; label: string; color?: string };

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(640);
  useLayoutEffect(() => {
    if (ref.current) setW(ref.current.clientWidth || 640);
  }, []);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setW(el.clientWidth || 640));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

const niceTicks = (lo: number, hi: number, n = 4) => {
  if (!(hi > lo)) return [lo];
  const raw = (hi - lo) / n;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) out.push(Math.abs(v) < step * 1e-9 ? 0 : v);
  return out;
};

/** Responsive neon line chart (pixel-exact via ResizeObserver so labels stay legible on phones). */
/** Short axis label: 3 significant digits, compact for large values. */
export function fmtAxis(v: number) {
  if (v === 0) return "0";
  const a = Math.abs(v);
  if (a >= 1000) return Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(v);
  return String(Number(v.toPrecision(3)));
}

export function ProjectionChart({ series, markers = [], height = 220, xFmt = (x) => `${Math.round(x)}d`, yFmt = fmtAxis, zeroLine, testId, yMin }: {
  series: Series[]; markers?: Marker[]; height?: number; xFmt?: (x: number) => string; yFmt?: (y: number) => string; zeroLine?: boolean; testId?: string; yMin?: number;
}) {
  const [ref, W] = useWidth<HTMLDivElement>();
  const pts = series.flatMap((s) => s.points).filter((p) => Number.isFinite(p.y));
  if (!pts.length) return null;
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  let y0 = yMin ?? Math.min(0, ...ys), y1 = Math.max(...ys);
  if (y1 - y0 < 1e-12) { y1 = y0 + 1; }
  y1 += (y1 - y0) * 0.06;
  const yt = niceTicks(y0, y1, 4), xt = niceTicks(x0, x1, W < 420 ? 3 : 5);
  const H = height, padR = 14, padT = 12, padB = 26;
  const padL = Math.max(28, Math.max(...yt.map((v) => yFmt(v).length)) * 6.6 + 12);
  const X = (x: number) => padL + ((x - x0) / (x1 - x0 || 1)) * (W - padL - padR);
  const Y = (y: number) => padT + (1 - (y - y0) / (y1 - y0)) * (H - padT - padB);
  const path = (s: Series) => s.points.filter((p) => Number.isFinite(p.y)).map((p, i) => `${i ? "L" : "M"}${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`).join(" ");
  const gid = `cg-${testId ?? "c"}`;
  return (
    <div ref={ref} className="calc-chart" data-testid={testId}>
      <svg width={W} height={H} role="img" aria-label={series.map((s) => s.name).join(", ")}>
        <defs>
          {series.map((s, i) => (
            <linearGradient key={i} id={`${gid}-${i}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={s.color} stopOpacity="0.32" /><stop offset="1" stopColor={s.color} stopOpacity="0" /></linearGradient>
          ))}
          <filter id={`${gid}-glow`}><feGaussianBlur stdDeviation="2.5" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
        </defs>
        {yt.map((v) => (
          <g key={`y${v}`}>
            <line x1={padL} x2={W - padR} y1={Y(v)} y2={Y(v)} stroke="#2a2160" strokeDasharray="3 6" />
            <text x={padL - 6} y={Y(v) + 4} textAnchor="end" className="calc-axis">{yFmt(v)}</text>
          </g>
        ))}
        {xt.map((v) => (
          <text key={`x${v}`} x={X(v)} y={H - 8} textAnchor="middle" className="calc-axis">{xFmt(v)}</text>
        ))}
        {zeroLine && y0 < 0 && y1 > 0 && <line x1={padL} x2={W - padR} y1={Y(0)} y2={Y(0)} stroke="#a9a6d8" strokeOpacity={0.5} />}
        {series.map((s, i) => s.fill && (
          <path key={`f${i}`} d={`${path(s)} L${X(s.points[s.points.length - 1].x)},${Y(Math.max(y0, 0))} L${X(s.points[0].x)},${Y(Math.max(y0, 0))} Z`} fill={`url(#${gid}-${i})`} />
        ))}
        {series.map((s, i) => (
          <path key={`s${i}`} d={path(s)} fill="none" stroke={s.color} strokeWidth={s.width ?? 2.5} strokeDasharray={s.dashed ? "6 6" : undefined} filter={s.dashed ? undefined : `url(#${gid}-glow)`} strokeLinejoin="round" />
        ))}
        {markers.filter((m) => m.x >= x0 && m.x <= x1).map((m, i) => (
          <g key={`m${i}`}>
            <line x1={X(m.x)} x2={X(m.x)} y1={padT} y2={H - padB} stroke={m.color ?? "#ff4d6d"} strokeDasharray="4 4" />
            <text x={X(m.x) > W * 0.7 ? X(m.x) - 4 : X(m.x) + 4} y={padT + 12 + i * 14} textAnchor={X(m.x) > W * 0.7 ? "end" : "start"} className="calc-axis" style={{ fill: m.color ?? "#ff4d6d" }}>{m.label}</text>
          </g>
        ))}
      </svg>
      <div className="calc-legend">
        {series.map((s) => (
          <span key={s.name}><i style={{ background: s.dashed ? "transparent" : s.color, borderColor: s.color }} className={s.dashed ? "dashed" : ""} />{s.name}</span>
        ))}
      </div>
    </div>
  );
}
