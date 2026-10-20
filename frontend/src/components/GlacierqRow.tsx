import { useEffect, useState } from "react";
import { AssetLogo } from "./AssetBits";
import { GLACIERQ_ICON_128, REWARD_ASSET_CODE, REWARD_ISSUER } from "../lib/rewards";
import { explorerAssetUrl } from "../lib/explorer";
import { fmt } from "../lib/format";

const HORIZON = "https://horizon.stellar.org";
const dash = <span className="muted">—</span>;
export const GLACIERQ_HOME = "yogibear1323.github.io";
export const glacierqMatches = (q: string) => {
  const s = q.trim().toLowerCase();
  const iss = (REWARD_ISSUER.mainnet ?? "").toLowerCase();
  return !s || "glacierq".includes(s) || s.includes("glacier") || "glacier".startsWith(s) || (!!iss && (iss.startsWith(s) || s === iss));
};

type Stats = { trustlines: number | null; priceXlm: number | null; verified: boolean | null };

/** GLACIERQ pinned right under XLM (mainnet). Price is the GLACIERQ/XLM book mid; "— / no trades yet" when there is no market. */
export default function GlacierqRow({ usdPerXlm, onExchange }: { usdPerXlm: number | null; onExchange: (key: string) => void }) {
  const issuer = REWARD_ISSUER.mainnet;
  const [s, setS] = useState<Stats>({ trustlines: null, priceXlm: null, verified: null });
  useEffect(() => {
    if (!issuer) return;
    let alive = true;
    const a = `selling_asset_type=credit_alphanum12&selling_asset_code=${REWARD_ASSET_CODE}&selling_asset_issuer=${issuer}&buying_asset_type=native`;
    Promise.allSettled([
      fetch(`${HORIZON}/assets?asset_code=${REWARD_ASSET_CODE}&asset_issuer=${issuer}`).then((r) => r.json()),
      fetch(`${HORIZON}/order_book?${a}&limit=1`).then((r) => r.json()),
      fetch(`https://${GLACIERQ_HOME}/.well-known/stellar.toml`).then((r) => (r.ok ? r.text() : "")),
    ]).then(([as, ob, toml]) => {
      if (!alive) return;
      const rec = as.status === "fulfilled" ? as.value?._embedded?.records?.[0] : null;
      let price: number | null = null;
      if (ob.status === "fulfilled") {
        const bid = Number(ob.value?.bids?.[0]?.price), ask = Number(ob.value?.asks?.[0]?.price);
        price = bid > 0 && ask > 0 ? (bid + ask) / 2 : null;
      }
      const t = toml.status === "fulfilled" ? toml.value : "";
      setS({ trustlines: rec?.accounts?.authorized ?? null, priceXlm: price, verified: t ? t.includes(issuer) && t.includes(`code = "${REWARD_ASSET_CODE}"`) : false });
    });
    return () => { alive = false; };
  }, [issuer]);
  if (!issuer) return null;
  const url = explorerAssetUrl(REWARD_ASSET_CODE, issuer, "mainnet");
  return (
    <tr data-testid="glacierq-row" className="mk-pinned">
      <td data-label="#" className="c-rank mono muted">📌</td>
      <td data-label="Asset" className="c-asset">
        <div className="row" style={{ gap: 10 }}>
          <AssetLogo code={REWARD_ASSET_CODE} issuer={issuer} logo={GLACIERQ_ICON_128} />
          <div style={{ minWidth: 0 }}>
            <b>{REWARD_ASSET_CODE}</b>{" "}
            {s.verified && <span className="pill green" style={{ fontSize: "0.6rem", padding: "1px 6px" }} title={`Listed in ${GLACIERQ_HOME}/.well-known/stellar.toml`} data-testid="glacierq-verified">✓ verified</span>}
            <div className="muted" style={{ fontSize: "0.7rem" }}>Glacier · {url ? <a href={url} target="_blank" rel="noreferrer" className="mono">{issuer.slice(0, 4)}…{issuer.slice(-4)}</a> : issuer} · {GLACIERQ_HOME}</div>
          </div>
        </div>
      </td>
      <td data-label="Price (XLM)" className="c-price mono" data-testid="glacierq-price">{s.priceXlm !== null ? fmt(s.priceXlm, 7) : <span className="muted">— / no trades yet</span>}</td>
      <td data-label="≈ USD" className="c-usd mono">{s.priceXlm !== null && usdPerXlm ? `$${(s.priceXlm * usdPerXlm).toPrecision(3)}` : dash}</td>
      <td data-label="1h" className="mono">{dash}</td><td data-label="24h" className="mono">{dash}</td><td data-label="7d" className="mono">{dash}</td>
      <td data-label="Vol 24h (XLM)" className="mono">{dash}</td><td data-label="Trades" className="mono">{dash}</td>
      <td data-label="Trustlines" className="c-holders mono">{s.trustlines ?? dash}</td>
      <td data-label="Trend">{dash}</td>
      <td data-label="As of" className="c-asof muted" style={{ fontSize: "0.72rem" }}>live</td>
      <td data-label="" className="c-act"><div className="mk-acts"><button className="btn small ghost" onClick={() => onExchange(`${REWARD_ASSET_CODE}-${issuer}`)}>Exchange</button></div></td>
    </tr>
  );
}
