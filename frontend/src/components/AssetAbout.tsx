import { useEffect, useState } from "react";
import { loadAbout, type AboutData } from "../lib/marketsFull";
import { fmtCompact } from "../lib/format";
import { explorerAssetUrl } from "../lib/explorer";

const s = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const yes = (v: boolean | undefined) => (v ? "yes" : "no");

/** About panel for one asset: issuer-published SEP-1 text + on-chain facts. Loaded on open, cached. */
export default function AssetAbout({ code, issuer, homeDomain, snapshotDesc, onClose }: { code: string; issuer: string; homeDomain: string | null; snapshotDesc?: string | null; onClose?: () => void }) {
  const [d, setD] = useState<AboutData | null>(null);
  useEffect(() => {
    let alive = true;
    loadAbout({ code, issuer, homeDomain, snapshotDesc }).then((x) => alive && setD(x));
    return () => { alive = false; };
  }, [code, issuer, homeDomain, snapshotDesc]);
  const c = d?.currency ?? null;
  const desc = s(c?.desc) ?? s(d?.snapshotDesc);
  const fromSnap = !s(c?.desc) && !!s(d?.snapshotDesc);
  const img = s(c?.image);
  return (
    <div className="about-panel" role="region" aria-label={`About ${code}`} data-testid="asset-about">
      <div className="about-head">
        {img && /^https:\/\//.test(img) && <img src={img} alt="" width={36} height={36} referrerPolicy="no-referrer" />}
        <div>
          <b>{s(c?.name) ?? code}</b> <span className="muted mono">{code}</span>
          <div className="muted" style={{ fontSize: "0.75rem" }}>{d?.orgName ?? ""}{d?.homeDomain ? `${d?.orgName ? " · " : ""}${d.homeDomain}` : ""}</div>
        </div>
        {onClose && <button className="btn small ghost" onClick={onClose} aria-label={`Close About ${code}`}>Close</button>}
      </div>
      {!d ? <p className="muted">Loading the issuer's stellar.toml and Horizon data…</p> : (
        <>
          {desc ? (
            <p className="about-desc">{desc}{fromSnap && <span className="muted" style={{ fontSize: "0.7rem" }}> (issuer's stellar.toml, saved at the last refresh)</span>}</p>
          ) : (
            <p className="about-desc muted" data-testid="about-none">The issuer hasn't published a description.</p>
          )}
          {s(c?.conditions) && <p className="muted" style={{ fontSize: "0.8rem" }}><b>Conditions:</b> {s(c?.conditions)}</p>}
          <dl className="about-facts">
            <dt>Code</dt><dd className="mono">{code}</dd>
            <dt>Issuer</dt><dd className="mono" style={{ wordBreak: "break-all" }}><a href={explorerAssetUrl(code, issuer, "mainnet") ?? undefined} target="_blank" rel="noopener noreferrer">{issuer}</a></dd>
            <dt>Home domain</dt><dd>{d.homeDomain ?? "—"}</dd>
            {c?.is_asset_anchored !== undefined && <><dt>Anchored</dt><dd>{String(c.is_asset_anchored) === "true" ? `yes${s(c.anchor_asset) ? ` · ${s(c.anchor_asset)}` : ""}${s(c.anchor_asset_type) ? ` (${s(c.anchor_asset_type)})` : ""}` : "no"}</dd></>}
            {d.horizon && <><dt>Holders (authorized trustlines)</dt><dd className="mono">{d.horizon.holders !== null ? fmtCompact(d.horizon.holders) : "—"}</dd>
              <dt>Supply (authorized)</dt><dd className="mono">{d.horizon.supply !== null ? fmtCompact(d.horizon.supply) : "—"}</dd>
              {d.horizon.flags && <><dt>Issuer flags</dt><dd>auth required {yes(d.horizon.flags.auth_required)} · revocable {yes(d.horizon.flags.auth_revocable)} · clawback {yes(d.horizon.flags.auth_clawback_enabled)} · immutable {yes(d.horizon.flags.auth_immutable)}</dd></>}
              {d.horizon.contract && <><dt>Stellar Asset Contract</dt><dd className="mono" style={{ wordBreak: "break-all" }}>{d.horizon.contract}</dd></>}</>}
          </dl>
          <p className="muted" style={{ fontSize: "0.7rem", margin: 0 }}>
            Sources: {d.tomlUrl ? <a href={d.tomlUrl} target="_blank" rel="noreferrer">issuer's stellar.toml</a> : "issuer's stellar.toml"}{d.tomlError ? ` (${d.tomlError})` : ""} · Horizon mainnet. Not financial advice. Anyone can issue an asset with any name: verify the issuer before you trade.
          </p>
        </>
      )}
    </div>
  );
}
