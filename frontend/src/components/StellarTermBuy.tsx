import { CopyButton } from "./CopyButton";
import QrCode from "./QrCode";
import { NETWORK } from "../lib/config";
import { STELLARTERM_BUY_USDC_URL, STELLARTERM_BUY_XLM_URL, STELLARTERM_DISCLOSURE } from "../lib/buyProviders";

/**
 * Primary card-purchase option: an outbound link to StellarTerm's public "Buy crypto" page (checked 2026-10-19).
 * Nothing is embedded. StellarTerm's URL only takes crypto/network, not an address (it pre-fills only for a wallet
 * signed in to StellarTerm), so the user pastes their Quasaria address into the purchase form themselves.
 */
export default function StellarTermBuy({ address, onCreate }: { address: string | null; onCreate: () => void }) {
  return (
    <div className="card glow" data-testid="buy-stellarterm">
      <h3 style={{ marginTop: 0 }}>Buy XLM with a card on StellarTerm</h3>
      <ol className="st-steps" data-testid="st-steps">
        <li><b>Copy your Quasaria address</b> (below).</li>
        <li><b>Buy XLM on StellarTerm with a card.</b> No StellarTerm account is needed: their form asks for a Stellar wallet address.</li>
        <li><b>Paste your Quasaria address</b> as the wallet address so the XLM is delivered straight to it. Check the first and last few characters before you pay.</li>
      </ol>
      {address ? (
        <div className="st-addr" data-testid="st-address-block">
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="muted l-tiny">Your Quasaria address</div>
            <code className="key-block mono" data-testid="st-address">{address}</code>
            <div style={{ marginTop: 6 }}><CopyButton value={address} label="Copy address" /></div>
          </div>
          <QrCode value={address} size={120} label="QR code of your Stellar address" />
        </div>
      ) : (
        <p className="muted" data-testid="st-signedout">You need an address first. <button className="btn small" onClick={onCreate}>Create a keypair</button></p>
      )}
      <div className="row" style={{ gap: 8, flexWrap: "wrap", marginTop: 12 }}>
        <a className="btn" href={STELLARTERM_BUY_XLM_URL} target="_blank" rel="noopener noreferrer" data-testid="buy-stellarterm-xlm">Buy XLM on StellarTerm ↗</a>
        <a className="btn ghost small" href={STELLARTERM_BUY_USDC_URL} target="_blank" rel="noopener noreferrer" data-testid="buy-stellarterm-usdc">Buy USDC (Stellar) ↗</a>
      </div>
      {NETWORK === "testnet" && (
        <p className="notice" style={{ fontSize: "0.8rem", margin: "12px 0 0" }} data-testid="buy-mainnet-only">
          Card purchases deliver <b>real mainnet</b> XLM. Quasaria is on the test network for now, so it will reach your address on mainnet but will not show up here yet.
        </p>
      )}
      <p className="muted" style={{ fontSize: "0.8rem", margin: "10px 0 0" }}>
        If you have a StellarTerm wallet you can also buy into it and send the XLM to your Quasaria address. StellarTerm lets you log in with a secret key, but you don't need to for this, and never paste your secret key into a site you don't fully trust. Quasaria will never ask you to.
      </p>
      <p className="muted" style={{ fontSize: "0.8rem", margin: "8px 0 0" }} data-testid="st-disclosure">{STELLARTERM_DISCLOSURE}</p>
    </div>
  );
}
