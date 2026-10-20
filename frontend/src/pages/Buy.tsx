import { NETWORK, IS_MAINNET, USDC_ISSUER } from "../lib/config";
import { Link } from "react-router-dom";
import { PageHead } from "../components/ui";
import { useWallet } from "../lib/wallet";
import { useAccount } from "../lib/useAccount";
import { BUY_NOTE, BUY_PROVIDERS } from "../lib/buyProviders";
import { MAINNET_USDC_ISSUER } from "../lib/liveMarkets";
import { Receive } from "./Wallet";
import BuyWidget from "../components/BuyWidget";
import StellarTermBuy from "../components/StellarTermBuy";
import { coindiscoKey } from "../lib/coindisco";

export default function Buy() {
  const w = useWallet();
  const acct = useAccount(NETWORK, w.address);
  const funded = acct.view?.exists ?? w.funded;
  return (
    <>
      <PageHead kicker="Buy" title="Buy XLM">
        XLM is the coin that pays Stellar network fees and sits in your account as its small reserve. Get some into your own Quasaria address in three steps: copy your address, buy XLM from a provider and withdraw it to that address, then (optionally) allow USDC.
      </PageHead>

      <h2 className="buy-step" style={{ margin: "4px 0 8px" }}>1. Your address</h2>
      {w.address ? <Receive address={w.address} funded={funded} acct={acct} /> : (
        <div className="card glow" data-testid="buy-signedout">
          <p style={{ marginTop: 0 }}>You need an address first. Quasaria never holds your secret key: a keypair is made in your browser and only you can sign.</p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className="btn" onClick={() => w.openModal("create")}>Create a keypair</button>
            <button className="btn ghost" onClick={() => w.openModal()}>Sign in with secret key</button>
          </div>
        </div>
      )}

      <h2 className="buy-step" style={{ margin: "22px 0 8px" }}>2. Buy with a card</h2>
      <StellarTermBuy address={w.address} onCreate={() => w.openModal("create")} />
      {/* Coindisco widget stays behind its config key: hidden entirely until VITE_COINDISCO_PUBLIC_KEY is set. */}
      {coindiscoKey() && <div style={{ marginTop: 12 }}><BuyWidget address={w.address} /></div>}

      <h3 style={{ margin: "18px 0 8px" }}>Or buy on an exchange</h3>
      <div className="card" data-testid="buy-providers">
        <p style={{ marginTop: 0 }}>Pick a provider, buy XLM, then withdraw or send it to the address above. Copy the address from step 1 and paste it, and check the first few and last few characters before you confirm.</p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {BUY_PROVIDERS.map((p) => (
            <a key={p.id} className="btn ghost" href={p.url} target="_blank" rel="noopener noreferrer" data-testid={`buy-${p.id}`}>{p.name} ↗</a>
          ))}
        </div>
        <p className="muted" style={{ fontSize: "0.82rem", marginBottom: 0 }} data-testid="buy-note">{BUY_NOTE}</p>
      </div>
      <div className="notice" role="note" style={{ marginTop: 12, fontSize: "0.84rem" }} data-testid="buy-network-note">
        <b>Heads up:</b> during this preview Quasaria runs on the Stellar <b>test network</b>, which uses free test XLM with no value. XLM you buy from these providers is real XLM on the main network, and it lands on the same address (one key works on both) but will not show here until Quasaria goes live. To try Quasaria now, {w.address ? <button className="btn small" onClick={() => w.openModal("fund")}>get free test XLM</button> : "create a keypair and use the free test XLM option"}.
      </div>

      <h2 className="buy-step" style={{ margin: "22px 0 8px" }}>3. Optional: USDC</h2>
      <div className="card" data-testid="buy-usdc">
        <p style={{ marginTop: 0 }}>USDC is a dollar stablecoin issued by Circle. To hold it your account first adds a <b>trustline</b> to the real issuer (button in step 1 once your account is funded). Always check the issuer address; look-alike assets with the same name exist.</p>
        <dl className="kv">
          <div><dt>Mainnet issuer (Circle)</dt><dd className="mono" style={{ wordBreak: "break-all" }} data-testid="usdc-main-issuer">{MAINNET_USDC_ISSUER}</dd></div>
          <div><dt>{IS_MAINNET ? "Issuer" : "Testnet issuer"}</dt><dd className="mono" style={{ wordBreak: "break-all" }}>{USDC_ISSUER}</dd></div>
        </dl>
        <p className="muted" style={{ fontSize: "0.82rem", marginBottom: 0 }}>Once you hold XLM you can use <Link to="/swap">Swap</Link> to trade it for other assets, or <Link to="/wallet">Send / receive</Link>.</p>
      </div>
    </>
  );
}
