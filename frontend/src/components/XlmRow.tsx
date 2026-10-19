import { AssetLogo } from "./AssetBits";
import { XLM_CODE, XLM_LOGO, XLM_NAME, xlmRowData } from "../lib/xlm";
import { fmt } from "../lib/format";
import XlmAbout from "./XlmAbout";

const dash = <span className="muted">—</span>;

/**
 * The native asset (XLM, no issuer) as a pinned row at the top of the Markets tables. Only fields we really have are filled:
 * price in USD and (live feed only) the 24h change. Price in XLM is 1 by definition; everything else is a dash.
 */
export default function XlmRow({ usdPerXlm, change24h = null, live, asOf, onExchange, aboutOpen = false, onAbout }: { usdPerXlm: number | null; change24h?: number | null; live: boolean; asOf?: string; onExchange: () => void; aboutOpen?: boolean; onAbout?: () => void }) {
  const d = xlmRowData({ usdPerXlm, change24h, live });
  return (
    <>
    <tr data-testid="xlm-row" data-native="true">
      <td data-label="#" className="c-rank mono muted">—</td>
      <td data-label="Asset" className="c-asset">
        <div className="row" style={{ gap: 10 }}>
          <AssetLogo code={XLM_CODE} logo={XLM_LOGO} />
          <div style={{ minWidth: 0 }}>
            <b>{XLM_CODE}</b>
            <div className="muted" style={{ fontSize: "0.7rem" }}>{XLM_NAME} · native, no issuer</div>
          </div>
        </div>
      </td>
      <td data-label="Price (XLM)" className="c-price mono">1<div className="muted" style={{ fontSize: "0.62rem" }}>base asset</div></td>
      <td data-label="≈ USD" className="c-usd mono" data-testid="xlm-usd">{d.priceUsd !== null ? `$${fmt(d.priceUsd, 4)}` : dash}</td>
      <td data-label="1h" className="c-1h mono">{dash}</td>
      <td data-label="24h" className="c-24h mono" data-testid="xlm-24h">{d.change24h === null ? dash : <span className={d.change24h >= 0 ? "pos" : "neg"}>{d.change24h >= 0 ? "+" : ""}{fmt(d.change24h, 2)}%</span>}</td>
      <td data-label="7d" className="c-7d mono">{dash}</td>
      <td data-label="Vol 24h (XLM)" className="c-vol mono">{dash}</td>
      <td data-label="Trades" className="c-trades mono">{dash}</td>
      <td data-label="Trustlines" className="c-holders mono">{dash}</td>
      <td data-label="Trend" className="c-trend">{dash}</td>
      <td data-label="As of" style={{ fontSize: "0.72rem" }} className="c-asof muted">{d.priceUsd === null ? "—" : asOf ?? (d.source === "live" ? "live" : "snapshot")}</td>
      <td data-label="" className="c-act"><div className="mk-acts"><button className="btn small ghost" onClick={onExchange} title="Opens the Exchange with XLM as the base asset">Exchange</button>
        {onAbout && <button className={`btn small ghost about-btn ${aboutOpen ? "on" : ""}`} aria-expanded={aboutOpen} aria-controls="about-xlm" onClick={onAbout} data-testid="xlm-about-btn">About</button>}</div></td>
    </tr>
    {aboutOpen && <tr className="about-row" data-testid="xlm-about-row"><td colSpan={13}><XlmAbout onClose={onAbout} /></td></tr>}
    </>
  );
}
