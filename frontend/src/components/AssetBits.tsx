import { useEffect, useRef, useState } from "react";
import type { MarketRow } from "../lib/markets";

/** Asset logo from stellarchain tomlInfo (https only), with a monogram fallback. */
export function AssetLogo({ code, logo, size = 24 }: { code: string; logo?: string | null; size?: number }) {
  const [broken, setBroken] = useState(false);
  if (logo && !broken)
    return <img src={logo} alt="" width={size} height={size} loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(true)} style={{ borderRadius: "50%", background: "#0b0f24", objectFit: "contain", flex: "none" }} />;
  return (
    <span aria-hidden style={{ width: size, height: size, borderRadius: "50%", display: "inline-grid", placeItems: "center", flex: "none", fontSize: size * 0.42, fontWeight: 700, background: "linear-gradient(135deg, rgba(56,243,255,.35), rgba(255,61,203,.35))", color: "#fff" }}>
      {code.slice(0, 2).toUpperCase()}
    </span>
  );
}

export function Sparkline({ values, width = 96, height = 26 }: { values: number[]; width?: number; height?: number }) {
  if (values.length < 2) return <span className="muted" style={{ fontSize: "0.7rem" }}>—</span>;
  const min = Math.min(...values), max = Math.max(...values);
  const flat = max === min;
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * width},${flat ? height / 2 : height - 2 - ((v - min) / (max - min)) * (height - 4)}`).join(" ");
  const up = values[values.length - 1] >= values[0];
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-label="1h sparkline">
      <polyline points={pts} fill="none" stroke={flat ? "var(--haze)" : up ? "var(--aurora, #3dffb0)" : "var(--plasma)"} strokeWidth={1.6} />
    </svg>
  );
}

export type PickerOption = { key: string; code: string; sub?: string | null; logo?: string | null };

export const toOption = (r: MarketRow): PickerOption => ({ key: r.key, code: r.code, sub: r.orgName ?? r.homeDomain ?? `${r.issuer.slice(0, 4)}…${r.issuer.slice(-4)}`, logo: r.logo });

/** Dropdown asset picker with logos and org names. */
export function AssetPicker({ value, options, onChange, label }: { value: PickerOption; options: PickerOption[]; onChange: (o: PickerOption) => void; label?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);
  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button className="btn ghost small row" style={{ gap: 8 }} onClick={() => setOpen((o) => !o)} aria-haspopup="listbox" aria-label={label ?? "Pick asset"}>
        <AssetLogo code={value.code} logo={value.logo} size={20} />
        <b>{value.code}</b>
        <span className="muted" style={{ fontSize: "0.7rem", maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{value.sub}</span>
        <span>▾</span>
      </button>
      {open && (
        <div role="listbox" className="card" style={{ position: "absolute", zIndex: 30, top: "110%", left: 0, width: 300, maxHeight: 360, overflow: "auto", padding: 6 }}>
          {options.map((o) => (
            <div key={o.key} role="option" aria-selected={o.key === value.key} className="row" onClick={() => { onChange(o); setOpen(false); }}
              style={{ gap: 10, padding: "7px 8px", borderRadius: 8, cursor: "pointer", background: o.key === value.key ? "rgba(56,243,255,.08)" : undefined }}>
              <AssetLogo code={o.code} logo={o.logo} size={22} />
              <div style={{ minWidth: 0 }}>
                <div><b>{o.code}</b></div>
                <div className="muted" style={{ fontSize: "0.7rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{o.sub}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
