import { useEffect, useMemo, useRef, useState } from "react";
import { AssetLogo } from "./AssetBits";
import { ASSET_LIST, badgeOf, filterAssets, groupAssets, mainnetUrl, type AssetCategory, type ListedAsset } from "../lib/assets";

const CATS: { v: AssetCategory | "all"; label: string }[] = [
  { v: "all", label: "All" },
  { v: "stablecoin", label: "Stablecoins" },
  { v: "popular", label: "Popular assets" },
];

export function AssetBadge({ a, small }: { a: ListedAsset; small?: boolean }) {
  const b = badgeOf(a);
  return <span className={`pill ${b.tone}`} data-testid="asset-badge" title={a.testnet.label} style={{ fontSize: small ? "0.62rem" : "0.7rem", padding: small ? "1px 6px" : undefined, whiteSpace: "nowrap" }}>{b.text}</span>;
}

/** The searchable, categorised list (also rendered on its own in tests). */
export function AssetSelectList({ value, onPick, assets = ASSET_LIST, exclude, query, category }: { value?: string; onPick: (a: ListedAsset) => void; assets?: ListedAsset[]; exclude?: string; query: string; category: AssetCategory | "all" }) {
  const list = useMemo(() => filterAssets(assets.filter((a) => a.id !== exclude), query, category), [assets, exclude, query, category]);
  const groups = query.trim() ? [{ category: "all", label: `${list.length} match${list.length === 1 ? "" : "es"}`, items: list }] : groupAssets(list);
  return (
    <div role="listbox" data-testid="asset-options">
      {!list.length && <div className="muted" style={{ padding: 10, fontSize: "0.8rem" }}>No asset matches “{query}”.</div>}
      {groups.map((g) => (
        <div key={g.category}>
          <div className="muted" style={{ fontSize: "0.66rem", textTransform: "uppercase", letterSpacing: "0.08em", padding: "8px 8px 4px" }}>{g.label}</div>
          {g.items.map((a) => (
            <div key={a.id} role="option" aria-selected={a.id === value} data-asset={a.id} className="row asset-opt" onClick={() => onPick(a)}
              style={{ gap: 10, padding: "7px 8px", borderRadius: 8, cursor: "pointer", background: a.id === value ? "rgba(56,243,255,.08)" : undefined }}>
              <AssetLogo code={a.code} logo={a.logo} size={24} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="row" style={{ gap: 6 }}><b>{a.code}</b>{a.peg && a.category === "stablecoin" && <span className="muted mono" style={{ fontSize: "0.66rem" }}>{a.peg}</span>}</div>
                <div className="muted" style={{ fontSize: "0.68rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.org ?? a.name ?? a.mainnet?.homeDomain ?? a.testnet.label}{a.mainnet?.homeDomain ? ` · ${a.mainnet.homeDomain}` : ""}</div>
              </div>
              <AssetBadge a={a} small />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/** Button + popover asset picker: search, logos, categories, real/mirror badge. */
export default function AssetSelect({ value, onChange, exclude, label, testId }: { value: ListedAsset | undefined; onChange: (a: ListedAsset) => void; exclude?: string; label: string; testId?: string }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<AssetCategory | "all">("all");
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);
  const url = value ? mainnetUrl(value) : null;
  return (
    <div ref={ref} style={{ position: "relative" }} data-testid={testId}>
      <div className="muted" style={{ fontSize: "0.7rem", marginBottom: 4 }}>{label}</div>
      <button type="button" className="btn ghost row" style={{ gap: 8, width: "100%", justifyContent: "flex-start" }} onClick={() => setOpen((o) => !o)} aria-haspopup="listbox" aria-label={label}>
        {value ? <><AssetLogo code={value.code} logo={value.logo} size={22} /><b>{value.code}</b><AssetBadge a={value} small /></> : <span className="muted">Choose asset</span>}
        <span style={{ marginLeft: "auto" }}>▾</span>
      </button>
      {value && (
        <div className="muted" style={{ fontSize: "0.66rem", marginTop: 4, minHeight: "1em" }}>
          {value.testnet.kind === "mirror" ? <>testnet mirror of {url ? <a href={url} target="_blank" rel="noreferrer">{value.code} on mainnet ↗</a> : value.code}</> : value.testnet.kind === "real" ? <>real testnet asset{url && <> · <a href={url} target="_blank" rel="noreferrer">mainnet {value.code} ↗</a></>}</> : value.testnet.label}
        </div>
      )}
      {open && (
        <div className="card" style={{ position: "absolute", zIndex: 40, top: "100%", left: 0, width: 360, maxWidth: "90vw", padding: 8, marginTop: 4, background: "#0b0e1c", boxShadow: "0 18px 50px rgba(0,0,0,.6)" }}>
          <input className="input" autoFocus placeholder="Search code, issuer org, domain, peg…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search assets" data-testid="asset-search" />
          <div className="row" style={{ gap: 4, margin: "8px 0 4px", flexWrap: "wrap" }}>
            {CATS.map((c) => <button type="button" key={c.v} className={`btn small ${cat === c.v ? "" : "ghost"}`} onClick={() => setCat(c.v)} data-testid={`asset-cat-${c.v}`}>{c.label}</button>)}
          </div>
          <div style={{ maxHeight: 340, overflow: "auto" }}>
            <AssetSelectList value={value?.id} exclude={exclude} query={q} category={cat} onPick={(a) => { onChange(a); setOpen(false); setQ(""); }} />
          </div>
        </div>
      )}
    </div>
  );
}
