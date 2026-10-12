import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useNavigate } from "react-router-dom";
import { AUTOPAY, DISTRICTS, project, type District } from "../lib/world";

const TILT = 16;
const HUE = { violet: "#7c3aed", cyan: "#0891b2", magenta: "#c026d3" } as const;

function useReducedMotion() {
  const [r, setR] = useState(() => typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
  useEffect(() => {
    const m = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!m) return;
    const f = () => setR(m.matches);
    m.addEventListener?.("change", f);
    return () => m.removeEventListener?.("change", f);
  }, []);
  return r;
}

/** Graticule as projected polylines; back-facing segments are dropped. */
function graticule(rot: number, R: number) {
  const paths: string[] = [];
  const line = (pts: [number, number][]) => {
    let d = "", pen = false;
    for (const [la, lo] of pts) {
      const p = project(la, lo, rot, TILT);
      if (p.z < 0) { pen = false; continue; }
      d += `${pen ? "L" : "M"}${(p.x * R).toFixed(1)} ${(p.y * R).toFixed(1)}`;
      pen = true;
    }
    if (d) paths.push(d);
  };
  for (let la = -60; la <= 60; la += 30) line(Array.from({ length: 73 }, (_, i) => [la, -180 + i * 5] as [number, number]));
  for (let lo = -180; lo < 180; lo += 30) line(Array.from({ length: 37 }, (_, i) => [-90 + i * 5, lo] as [number, number]));
  return paths;
}

/**
 * Quasaria world globe: an SVG orthographic sphere with a clickable, labelled district per feature.
 * Drag to spin; Tab focuses districts (the globe turns to face the focused one); Enter opens it.
 * The always-present <nav> list below is the mobile / screen-reader fallback.
 */
export default function Globe({ compact = false, current, onNavigate }: { compact?: boolean; current?: string; onNavigate?: () => void }) {
  const nav = useNavigate();
  const reduced = useReducedMotion();
  const [rot, setRot] = useState(() => {
    const c = DISTRICTS.find((d) => d.id === current);
    return c ? -c.lon : 10;
  });
  const [hover, setHover] = useState<string | null>(null);
  const target = useRef<number | null>(null);
  const drag = useRef<{ x: number; r: number; moved: boolean } | null>(null);
  const paused = useRef(false);
  const R = compact ? 118 : 200;
  const size = R * 2 + (compact ? 70 : 120);

  useEffect(() => {
    let raf = 0, last = performance.now();
    const tick = (t: number) => {
      const dt = Math.min(64, t - last); last = t;
      setRot((r) => {
        if (target.current != null) {
          let diff = ((target.current - r + 540) % 360) - 180;
          if (Math.abs(diff) < 0.3) { target.current = null; return r + diff; }
          return r + diff * (reduced ? 1 : 0.12);
        }
        if (reduced || paused.current || drag.current) return r;
        return r + dt * 0.006;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [reduced]);

  const grid = useMemo(() => graticule(rot, R), [rot, R]);
  const pts = DISTRICTS.map((d) => ({ d, p: project(d.lat, d.lon, rot, TILT) })).sort((a, b) => a.p.z - b.p.z);

  const go = (d: District) => { onNavigate?.(); nav(d.to); };
  const onKey = (e: KeyboardEvent, d: District) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(d); } };
  const face = (d: District) => { target.current = -d.lon; };
  const half = size / 2;

  return (
    <div className={`globe ${compact ? "compact" : ""}`}>
      <svg
        className="globe-svg"
        viewBox={`${-half} ${-half} ${size} ${size}`}
        role="group"
        aria-label="Quasaria world map. Tab through districts; Enter opens one."
        onPointerDown={(e) => { drag.current = { x: e.clientX, r: rot, moved: false }; target.current = null; }}
        onPointerMove={(e) => { const g = drag.current; if (!g) return; const dx = e.clientX - g.x; if (Math.abs(dx) > 3) g.moved = true; setRot(g.r + dx * 0.4); }}
        onPointerUp={() => { setTimeout(() => (drag.current = null), 0); }}
        onPointerLeave={() => { drag.current = null; paused.current = false; setHover(null); }}
        onPointerEnter={() => (paused.current = true)}
      >
        <defs>
          <radialGradient id="g-body" cx="-0.25" cy="-0.35" r="1.25" gradientUnits="objectBoundingBox" fx="0.35" fy="0.3">
            <stop offset="0" stopColor="#ffffff" />
            <stop offset="0.45" stopColor="#eef0ff" />
            <stop offset="0.8" stopColor="#d9d4ff" />
            <stop offset="1" stopColor="#b9b0ff" />
          </radialGradient>
          <radialGradient id="g-atmo" r="0.5">
            <stop offset="0.78" stopColor="#a78bfa" stopOpacity="0" />
            <stop offset="0.86" stopColor="#22d3ee" stopOpacity="0.35" />
            <stop offset="1" stopColor="#e879f9" stopOpacity="0" />
          </radialGradient>
        </defs>
        <circle r={R * 1.18} fill="url(#g-atmo)" />
        {/* orbit ring + Autopay moon */}
        <ellipse className="globe-orbit" rx={R * 1.32} ry={R * 0.36} transform="rotate(-12)" />
        <circle r={R} fill="url(#g-body)" className="globe-body" />
        <g className="globe-grid">{grid.map((d, i) => <path key={i} d={d} />)}</g>
        <ellipse className="globe-equator" rx={R} ry={R * Math.sin(TILT * Math.PI / 180)} />
        {pts.map(({ d, p }) => {
          const front = p.z > 0.05;
          const x = p.x * R, y = p.y * R;
          const on = hover === d.id || current === d.id;
          const sc = 0.6 + 0.4 * Math.max(0, p.z);
          const showLabel = front && (!compact || on || p.z > 0.55);
          return (
            <g
              key={d.id}
              className={`district ${front ? "front" : "back"} ${on ? "on" : ""} ${current === d.id ? "here" : ""}`}
              transform={`translate(${x.toFixed(1)} ${y.toFixed(1)}) scale(${sc.toFixed(3)})`}
              role="link"
              tabIndex={0}
              aria-label={`${d.label}: ${d.district}. ${d.blurb}`}
              aria-current={current === d.id ? "page" : undefined}
              onFocus={() => { face(d); setHover(d.id); }}
              onBlur={() => setHover(null)}
              onMouseEnter={() => setHover(d.id)}
              onMouseLeave={() => setHover((h) => (h === d.id ? null : h))}
              onClick={() => { if (!drag.current?.moved) (front ? go(d) : face(d)); }}
              onKeyDown={(e) => onKey(e, d)}
              style={{ ["--hue" as string]: HUE[d.hue] }}
            >
              <circle className="d-glow" r={compact ? 12 : 18} />
              <circle className="d-plate" r={compact ? 5.5 : 8} />
              <circle className="d-core" r={compact ? 2 : 3} />
              {showLabel && (
                <g className="d-label" transform={`translate(${compact ? 8 : 12} ${compact ? -6 : -10})`}>
                  <rect x={-4} y={compact ? -11 : -14} rx={6} width={(compact ? 6.2 : 7.6) * d.label.length + 10} height={compact ? 16 : 21} />
                  <text x={1} y={compact ? 1 : 1.5}>{d.label}</text>
                </g>
              )}
            </g>
          );
        })}
        <a href={AUTOPAY.href} className="moon" aria-label={`${AUTOPAY.label}: ${AUTOPAY.blurb}`}>
          <g transform={`translate(${(R * 1.26).toFixed(0)} ${(-R * 0.62).toFixed(0)})`}>
            <circle r={compact ? 11 : 17} className="moon-body" />
            <text y={compact ? 24 : 34} textAnchor="middle" className="moon-text">{AUTOPAY.label} ↗</text>
          </g>
        </a>
      </svg>
      {hover && !compact && (() => {
        const d = DISTRICTS.find((x) => x.id === hover)!;
        return <p className="globe-tip" aria-hidden><b>{d.label}</b> · {d.district} — {d.blurb}</p>;
      })()}
    </div>
  );
}
