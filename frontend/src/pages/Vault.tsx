import { Link } from "react-router-dom";
import data from "../config/rwa-mainnet.json";
import ExplainerVideo from "../components/ExplainerVideo";
import { YieldVaultCard } from "../components/YieldVaultCard";
import { SavingsJars } from "../components/SavingsJars";
import { RwaHoldings } from "../components/RwaHoldings";
import "./vault.css";

const B = import.meta.env.BASE_URL;
const FLOW = [
  { n: "1", t: "Deposit XLM", d: "Deposit any amount of XLM; you receive vault shares." },
  { n: "2", t: "Vault allocates", d: "Split between the lending pool, the RWA wrapper and an idle buffer." },
  { n: "3", t: "Withdraw", d: "Idle XLM returns instantly; RWA-held XLM goes through a redemption wait." },
];

const TRANSCRIPT = ['The Quasaria Yield Vault is the home of the RWA yield layer, built on Stellar.', 'You deposit XLM into the vault, and it gives you vault shares. Your shares track your part of everything the vault holds.', 'The vault is designed to route deposits into the RWA yield layer: a lending pool, and tokenized real-world assets.', 'There is no deposit cap. You choose how much XLM to deposit, and you can see your shares any time.', 'Savings Jars let you set goals, like a trip or a rainy day fund. Jars are tracked in your browser, on top of your vault shares, and have no deposit cap.', "To withdraw, you redeem shares. Withdrawals are paid from the vault's idle XLM.", 'The vault runs on standard Stellar Soroban contracts. The yield sources are not connected yet, so the vault is not earning yield today.', 'Open the Yield Vault tab on Quasaria to see your shares, and check every contract yourself on StellarChain.io.'];

/** Yield Vault: its own top-level tab for the mainnet RWA yield vault. */
export default function Vault() {
  const contracts = data.contracts as { name: string; status: string }[];
  return (
    <div className="vault-page" data-testid="vault-page">
      <section className="vault-hero" style={{ backgroundImage: `url(${B}frost/mountains.svg)` }}>
        <div className="vault-hero-text">
          <div className="vault-kicker">RWA yield layer · Stellar mainnet</div>
          <h1>Yield Vault</h1>
          <p>Park XLM in a Soroban vault that routes it into lending and tokenized real-world assets.</p>
          <p className="vault-desc" data-testid="vault-desc">You deposit XLM, and the vault routes it into Quasaria's RWA yield layer (a lending pool and tokenized real-world assets) to earn yield. The operator makes no deposits of its own. The yield sources aren't connected yet, so the vault isn't earning yield today.</p>
          <div className="vault-badges">
            <span className="vault-badge">{contracts.filter((c) => c.status === "deployed").length}/{contracts.length} contracts live</span>
          </div>
        </div>
        <img className="vault-yeti" src={`${B}frost/yeti-cutout.webp`} alt="" aria-hidden />
      </section>
      <div className="vault-layout">
        <YieldVaultCard />
        <aside className="vault-flow">
          <h3>How it works</h3>
          <ol>{FLOW.map((f) => <li key={f.n}><span className="vault-step">{f.n}</span><div><b>{f.t}</b><p>{f.d}</p></div></li>)}</ol>
          <Link to="/deploy" className="btn ghost small">Contract IDs &amp; deploy info</Link>
        </aside>
      </div>
      <RwaHoldings />
      <ExplainerVideo name="quasaria-yield-vault" title="How the Yield Vault works" testid="vault-video" note="About 1 minute · captions are part of the video." style={{ marginTop: 16 }} />
      <details className="card" data-testid="vault-video-transcript" style={{ marginTop: 8 }}><summary style={{ cursor: "pointer" }}>Video transcript</summary>{TRANSCRIPT.map((t, i) => <p key={i} className="muted">{t}</p>)}</details>
      <SavingsJars />
    </div>
  );
}
