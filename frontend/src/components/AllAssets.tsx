import { useCallback, useEffect, useRef, useState } from "react";
import { AssetLogo } from "./AssetBits";
import { explorerAssetUrl } from "../lib/explorer";
import { fetchAssetsPage, HORIZON_PAGE, MAINNET_ASSET_TOTAL, isAccountId, type HAsset } from "../lib/horizonAssets";
import { fmt } from "../lib/format";

const HORIZON = "https://horizon.stellar.org";

/** Every asset Horizon has, uncapped: 200 per page, "Load more" + infinite scroll until Horizon runs out. Search goes to Horizon. */
export default function AllAssets({ query, onExchange }: { query: string; onExchange: (key: string) => void }) {
  const [rows, setRows] = useState<HAsset[]>([]);
  const [next, setNext] = useState<string | null | undefined>(undefined); // undefined = first page not loaded
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [auto, setAuto] = useState(true);
  const gen = useRef(0);
  const sentinel = useRef<HTMLDivElement | null>(null);
  const q = query.trim();

  const load = useCallback(async (cursor: string | null | undefined, g: number) => {
    setLoading(true);
    setError(null);
    try {
      const p = await fetchAssetsPage(HORIZON, q, cursor ?? null);
      if (g !== gen.current) return;
      setRows((r) => (cursor ? [...r, ...p.records] : p.records));
      setNext(p.next);
    } catch (e) {
      if (g === gen.current) setError((e as Error).message);
    } finally {
      if (g === gen.current) setLoading(false);
    }
  }, [q]);

  useEffect(() => {
    const g = ++gen.current;
    setRows([]); setNext(undefined);
    const t = setTimeout(() => load(null, g), q ? 300 : 0);
    return () => clearTimeout(t);
  }, [q, load]);

  useEffect(() => {
    const el = sentinel.current;
    if (!el || !auto) return;
    const io = new IntersectionObserver((es) => { if (es[0].isIntersecting && next && !loading) load(next, gen.current); }, { rootMargin: "600px" });
    io.observe(el);
    return () => io.disconnect();
  }, [next, loading, auto, load]);

  const t = MAINNET_ASSET_TOTAL.stellarExpert;
  return (
    <div data-testid="all-assets">
      <div className="notice" style={{ fontSize: "0.82rem" }}>
        <b>All Stellar assets</b>, straight from public Horizon (<a href="https://horizon.stellar.org/assets" target="_blank" rel="noreferrer">horizon.stellar.org/assets</a>), {HORIZON_PAGE} per page, no cap: keep scrolling (or press Load more) until Horizon has no more.
        {" "}Search is sent to Horizon: an exact asset code (e.g. GLACIERQ), an issuer address (G…), or CODE:ISSUER.
        {" "}Network total: <b>{t.count.toLocaleString()}</b> assets ({t.source}, {t.asOf}). Listing ≠ endorsement: always verify the issuer.
      </div>
      <p className="mono" data-testid="all-assets-count" style={{ margin: "8px 0" }}>{rows.length.toLocaleString()} assets loaded{q ? ` for "${q}"` : ""}{next === null ? " · end of list" : ""}</p>
      <div className="mk-scroll">
        <table className="t mk-table">
          <thead><tr><th>#</th><th>Asset</th><th>Issuer</th><th>Type</th><th>Trustlines</th><th>Supply (authorized)</th><th>Pools</th><th>Home domain</th><th /></tr></thead>
          <tbody>
            {rows.map((a, i) => {
              const url = explorerAssetUrl(a.code, a.issuer, "mainnet");
              const dom = a.toml ? a.toml.replace(/^https?:\/\//, "").replace(/\/\.well-known\/stellar\.toml$/, "") : null;
              return (
                <tr key={a.pagingToken} data-testid="all-asset-row">
                  <td className="mono muted">{i + 1}</td>
                  <td><div className="row" style={{ gap: 8 }}><AssetLogo code={a.code} issuer={a.issuer} size={20} /><b>{a.code}</b></div></td>
                  <td className="mono" style={{ fontSize: "0.72rem" }}>{url ? <a href={url} target="_blank" rel="noreferrer">{a.issuer.slice(0, 6)}…{a.issuer.slice(-4)}</a> : a.issuer}</td>
                  <td className="muted" style={{ fontSize: "0.72rem" }}>{a.type.replace("credit_", "")}</td>
                  <td className="mono">{a.trustlines.toLocaleString()}</td>
                  <td className="mono">{fmt(Number(a.amount), 2)}</td>
                  <td className="mono">{a.pools}</td>
                  <td className="muted" style={{ fontSize: "0.72rem" }}>{dom ?? "—"}</td>
                  <td><button className="btn small ghost" onClick={() => onExchange(`${a.code}-${a.issuer}`)}>Exchange</button></td>
                </tr>
              );
            })}
            {!loading && !error && next === null && !rows.length && <tr><td colSpan={9} className="muted">Horizon has no asset matching "{q}"{isAccountId(q) ? " for this issuer" : " (asset codes must match exactly)"}.</td></tr>}
          </tbody>
        </table>
      </div>
      <div ref={sentinel} />
      <div className="row" style={{ gap: 10, marginTop: 10, flexWrap: "wrap" }}>
        {error && <span className="neg">Couldn't load from Horizon: {error}. </span>}
        {(next || error) && <button className="btn small" disabled={loading} onClick={() => load(error && !next ? null : next, gen.current)} data-testid="all-assets-more">{loading ? "Loading…" : error ? "Retry" : `Load ${HORIZON_PAGE} more`}</button>}
        {loading && !next && <span className="muted">Loading…</span>}
        <label className="muted l-tiny"><input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> load more automatically while scrolling</label>
      </div>
    </div>
  );
}
