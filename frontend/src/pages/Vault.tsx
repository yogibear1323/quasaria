import { Link } from "react-router-dom";
import data from "../config/rwa-mainnet.json";
import { YieldVaultCard, VAULT_DEPOSIT_CAP_XLM } from "../components/YieldVaultCard";
import { SavingsJars } from "../components/SavingsJars";
import "./vault.css";

const B = import.meta.env.BASE_URL;
const FLOW = [
  { n: "1", t: "Deposit XLM", d: `Up to ${VAULT_DEPOSIT_CAP_XLM} XLM per deposit; you receive vault shares.` },
  { n: "2", t: "Vault allocates", d: "Split between the lending pool, the RWA wrapper and an idle buffer." },
  { n: "3", t: "Withdraw", d: "Idle XLM returns instantly; RWA-held XLM goes through a redemption wait." },
];

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
          <p className="vault-desc" data-testid="vault-desc">You deposit XLM, and the vault routes it into Quasaria's RWA yield layer (a lending pool and tokenized real-world assets) to earn yield. Each deposit is capped at {VAULT_DEPOSIT_CAP_XLM} XLM while the contracts are unaudited. The operator makes no deposits of its own. The yield sources aren't connected yet, so the vault isn't earning yield today.</p>
          <div className="vault-badges">
            <span className="vault-badge warn">Unaudited</span>
            <span className="vault-badge">{VAULT_DEPOSIT_CAP_XLM} XLM cap / deposit</span>
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
      <SavingsJars />
    </div>
  );
}
