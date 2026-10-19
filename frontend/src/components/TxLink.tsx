import { useState } from "react";
import { explorerAccountUrl, explorerTxUrl, type ExplorerNet } from "../lib/explorer";

/** Transaction hash as a StellarChain link (new tab, noopener) with a copy button. Never links to another explorer. */
export function TxLink({ hash, net = "testnet", chars = 8 }: { hash: string; net?: ExplorerNet; chars?: number }) {
  const [ok, setOk] = useState(false);
  const url = explorerTxUrl(hash, net);
  const label = `${hash.slice(0, chars)}…`;
  return (
    <span className="txlink" style={{ whiteSpace: "nowrap" }}>
      {url ? <a className="mono" href={url} target="_blank" rel="noopener noreferrer" title={`${hash} on StellarChain`}>{label} ↗</a> : <span className="mono" title={hash}>{label}</span>}
      <button className="btn small ghost" style={{ padding: "0 6px", marginLeft: 4 }} aria-label="Copy transaction hash" onClick={async () => { try { await navigator.clipboard.writeText(hash); setOk(true); setTimeout(() => setOk(false), 1200); } catch { /* blocked */ } }}>{ok ? "✓" : "⧉"}</button>
    </span>
  );
}

export function AccountLink({ address, net = "testnet", children }: { address: string; net?: ExplorerNet; children?: React.ReactNode }) {
  const url = explorerAccountUrl(address, net);
  const label = children ?? `${address.slice(0, 4)}…${address.slice(-4)}`;
  return url ? <a className="mono" href={url} target="_blank" rel="noopener noreferrer" title={`${address} on StellarChain`}>{label}</a> : <span className="mono">{label}</span>;
}
