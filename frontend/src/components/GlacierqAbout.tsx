import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { CopyButton } from "./CopyButton";
import { GLACIERQ_ICON_128, REWARD_ASSET_CODE, REWARD_ISSUER } from "../lib/rewards";
import { explorerAccountUrl, explorerAssetUrl } from "../lib/explorer";

const HORIZON = "https://horizon.stellar.org";
const HOME = "yogibear1323.github.io";
const TOML = `https://${HOME}/.well-known/stellar.toml`;
const ext = { target: "_blank", rel: "noopener noreferrer" } as const;
type Facts = { supply: number | null; trustlines: number | null; locked: boolean | null; homeDomain: string | null };

/** About panel for GLACIERQ (same about-panel pattern as XlmAbout / AssetAbout). Supply, trustlines and the issuer lock are read live from Horizon. */
export default function GlacierqAbout({ onClose }: { onClose?: () => void }) {
  const issuer = REWARD_ISSUER.mainnet!;
  const [f, setF] = useState<Facts | null>(null);
  useEffect(() => {
    let alive = true;
    Promise.allSettled([
      fetch(`${HORIZON}/assets?asset_code=${REWARD_ASSET_CODE}&asset_issuer=${issuer}`).then((r) => r.json()),
      fetch(`${HORIZON}/accounts/${issuer}`).then((r) => r.json()),
    ]).then(([a, acc]) => {
      if (!alive) return;
      const rec = a.status === "fulfilled" ? a.value?._embedded?.records?.[0] : null;
      const ac = acc.status === "fulfilled" ? acc.value : null;
      const locked = ac?.signers ? ac.signers.every((s: { weight: number }) => s.weight === 0) : null;
      setF({ supply: rec ? Number(rec.balances?.authorized ?? rec.amount) : null, trustlines: rec?.accounts?.authorized ?? null, locked, homeDomain: ac?.home_domain ?? null });
    });
    return () => { alive = false; };
  }, [issuer]);
  const dash = "—";
  return (
    <div className="about-panel" role="region" aria-label="About GLACIERQ" data-testid="glacierq-about" id="about-glacierq">
      <div className="about-head">
        <img src={GLACIERQ_ICON_128} alt="" width={36} height={36} style={{ borderRadius: "50%" }} />
        <div>
          <b>Glacier</b> <span className="muted mono">{REWARD_ASSET_CODE}</span>
          <div className="muted" style={{ fontSize: "0.75rem" }}>Quasaria's token on Stellar · {HOME}</div>
        </div>
        {onClose && <button className="btn small ghost" onClick={onClose} aria-label="Close About GLACIERQ">Close</button>}
      </div>
      <p className="about-desc">
        GLACIERQ (Glacier) is Quasaria's token, a classic Stellar asset that trades on the Stellar DEX. Holders earn daily rewards of 1% a month (12% a year) on balances of 1 million GLACIERQ and up, the same rate from 10 million, nothing under 1 million, paid from a fixed reward reserve. Rewards are not guaranteed and can be capped. <Link to="/holders">How holder rewards work →</Link>
      </p>
      <dl className="about-facts" data-testid="glacierq-about-facts">
        <dt>Code</dt><dd className="mono">{REWARD_ASSET_CODE}</dd>
        <dt>Issuer</dt><dd className="mono" style={{ wordBreak: "break-all" }}>{issuer} <CopyButton value={issuer} what="issuer" /> {explorerAccountUrl(issuer, "mainnet") && <a href={explorerAccountUrl(issuer, "mainnet")!} {...ext}>StellarChain.io ↗</a>}</dd>
        <dt>Supply</dt><dd className="mono">{f?.supply != null ? `${f.supply.toLocaleString("en-US")} GLACIERQ` : "100,000,000,000 GLACIERQ"} (fixed)</dd>
        <dt>Issuer locked</dt><dd data-testid="glacierq-about-locked">{f == null ? "checking…" : f.locked ? "Yes: issuer signing weight is 0, so no more GLACIERQ can ever be issued" : f.locked === false ? "No" : dash}</dd>
        <dt>Home domain (on-chain)</dt><dd><a href={`https://${f?.homeDomain ?? HOME}`} {...ext}>{f?.homeDomain ?? HOME}</a> <span className="muted" style={{ fontSize: "0.7rem" }}>(issuer locked, can't change)</span></dd>
        <dt>stellar.toml</dt><dd><a href="https://quasaria.online/.well-known/stellar.toml" {...ext}>quasaria.online/.well-known/stellar.toml</a> <span className="muted" style={{ fontSize: "0.7rem" }}>(mirror; original at <a href={TOML} {...ext}>{HOME}/.well-known/stellar.toml</a>)</span></dd>
        <dt>Trustlines</dt><dd className="mono" data-testid="glacierq-about-trustlines">{f?.trustlines != null ? f.trustlines.toLocaleString("en-US") : f ? dash : "…"}</dd>
        <dt>Holder rewards</dt><dd>1% a month (12% a year) from 1M · same rate from 10M · paid daily · <Link to="/holders">Holders page</Link></dd>
        <dt>Explorer</dt><dd>{explorerAssetUrl(REWARD_ASSET_CODE, issuer, "mainnet") ? <a href={explorerAssetUrl(REWARD_ASSET_CODE, issuer, "mainnet")!} {...ext}>GLACIERQ on StellarChain.io</a> : dash}</dd>
      </dl>
    </div>
  );
}
