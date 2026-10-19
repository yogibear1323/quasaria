import { useEffect, useState } from "react";
import { XLM_CODE, XLM_LOGO, XLM_NAME } from "../lib/xlm";
import { loadXlmAbout, type LedgerFacts, type SupplySnapshot } from "../lib/xlmAbout";
import { explorerAssetUrl, explorerLedgerUrl } from "../lib/explorer";

const dash = "—";
const bil = (n: number) => `${(n / 1e9).toFixed(2)}B XLM`;
const ext = { target: "_blank", rel: "noopener noreferrer" } as const;

/**
 * About panel for the native asset. Same panel pattern as AssetAbout (about-panel / about-head / about-desc / about-facts), but there is no issuer,
 * stellar.toml or trustline for XLM, so the facts come from Horizon (live) and the SDF Dashboard API (saved copy). Dash = not available.
 */
export default function XlmAbout({ onClose, ledger: ledgerIn, supply: supplyIn }: { onClose?: () => void; ledger?: LedgerFacts | null; supply?: SupplySnapshot | null }) {
  const preset = ledgerIn !== undefined || supplyIn !== undefined;
  const [d, setD] = useState<{ ledger: LedgerFacts | null; supply: SupplySnapshot | null } | null>(preset ? { ledger: ledgerIn ?? null, supply: supplyIn ?? null } : null);
  useEffect(() => {
    if (preset) return;
    let alive = true;
    loadXlmAbout().then((x) => alive && setD(x));
    return () => { alive = false; };
  }, [preset]);
  const l = d?.ledger ?? null, s = d?.supply ?? null;
  const assetUrl = explorerAssetUrl(XLM_CODE, null, "mainnet");
  const ledgerUrl = l ? explorerLedgerUrl(l.sequence, "mainnet") : null;
  return (
    <div className="about-panel" role="region" aria-label="About XLM" data-testid="xlm-about" id="about-xlm">
      <div className="about-head">
        <img src={XLM_LOGO} alt="" width={36} height={36} />
        <div>
          <b>{XLM_NAME}</b> <span className="muted mono">{XLM_CODE}</span>
          <div className="muted" style={{ fontSize: "0.75rem" }}>Native asset of the Stellar network · stellar.org</div>
        </div>
        {onClose && <button className="btn small ghost" onClick={onClose} aria-label="Close About XLM">Close</button>}
      </div>

      <h4 style={{ margin: "6px 0 4px" }}>What XLM is</h4>
      <p className="about-desc" data-testid="xlm-about-what">
        XLM, or Stellar Lumens, is the native asset of the Stellar network. It is the only asset that needs no issuer and no trustline. It pays every transaction fee, and a small amount of it must be held as a reserve for every account and every trustline, offer, signer or data entry the account owns. Fees and reserves exist to keep the ledger from being spammed.
      </p>

      <h4 style={{ margin: "6px 0 4px" }}>The Stellar network</h4>
      <p className="about-desc" data-testid="xlm-about-network">
        Stellar is an open-source, public ledger. It launched in 2014 and was relaunched on the Stellar Consensus Protocol in 2015. Ledgers close about every 5 seconds, fees are a fraction of a cent, and the exchange (order books) and CAP-38 liquidity pools are built into the protocol itself, which is what Quasaria's Exchange, Swap and Pools use. The Stellar Development Foundation (SDF) is the non-profit, incorporated in 2014, that supports the network's development and growth.
      </p>

      {!d ? <p className="muted">Loading live ledger facts from Horizon…</p> : (
        <dl className="about-facts" data-testid="xlm-about-facts">
          <dt>Code</dt><dd className="mono">XLM (native)</dd>
          <dt>Issuer</dt><dd>none: native asset</dd>
          <dt>Home domain</dt><dd><a href="https://stellar.org" {...ext}>stellar.org</a></dd>
          <dt>Trustlines</dt><dd>n/a (no trustline needed)</dd>
          <dt>Base reserve</dt><dd className="mono" data-testid="xlm-about-reserve">{l?.baseReserveXlm != null ? `${l.baseReserveXlm} XLM` : dash}</dd>
          <dt>Minimum balance</dt><dd className="mono">{l?.baseReserveXlm != null ? `${l.baseReserveXlm * 2} XLM (2 base reserves) + ${l.baseReserveXlm} XLM per trustline, offer, signer or data entry` : dash}</dd>
          <dt>Base fee</dt><dd className="mono">{l?.baseFeeStroops != null ? `${l.baseFeeStroops} stroops (${l.baseFeeStroops / 1e7} XLM) per operation` : dash}</dd>
          <dt>Ledger close time</dt><dd className="mono" data-testid="xlm-about-close">{l?.avgCloseSeconds != null ? `${l.avgCloseSeconds} s (average of the last ${5} closes)` : dash}</dd>
          <dt>Latest ledger</dt><dd className="mono">{l ? (ledgerUrl ? <a href={ledgerUrl} {...ext}>#{l.sequence.toLocaleString("en-US")}</a> : `#${l.sequence}`) : dash}{l?.protocol != null ? ` · protocol ${l.protocol}` : ""}</dd>
          <dt>Total supply</dt><dd className="mono" data-testid="xlm-about-total">{s?.totalSupply != null ? bil(s.totalSupply) : dash}</dd>
          <dt>Circulating supply</dt><dd className="mono" data-testid="xlm-about-circ">{s?.circulatingSupply != null ? bil(s.circulatingSupply) : dash}</dd>
          <dt>Explorer</dt><dd>{assetUrl ? <a href={assetUrl} {...ext}>XLM on StellarChain.io</a> : dash}</dd>
        </dl>
      )}
      <p className="muted" style={{ fontSize: "0.7rem", margin: 0 }} data-testid="xlm-about-sources">
        Sources: <a href="https://horizon.stellar.org" {...ext}>Horizon mainnet</a> (ledger, reserve, fee, close time, live) · supply from the <a href="https://developers.stellar.org/docs/learn/fundamentals/lumens" {...ext}>SDF Dashboard API</a>{s ? ` (saved copy, ${new Date(s.savedAt).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })})` : " (unavailable)"} · <a href="https://stellar.org/foundation" {...ext}>stellar.org</a>. Information only, not financial advice. Quasaria is independent software, not affiliated with, sponsored or endorsed by the Stellar Development Foundation.
      </p>
    </div>
  );
}
