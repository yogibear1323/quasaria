import { Link } from "react-router-dom";
import data from "../config/rwa-mainnet.json";
import { CopyButton } from "./CopyButton";

const SC = "https://stellarchain.io";
type C = { name: string; status: string; id?: string; deploy_tx?: string; init_tx?: string };
const contracts = data.contracts as C[];
const mid = (s: string) => `${s.slice(0, 8)}…${s.slice(-8)}`;

function Field({ label, value, href }: { label: string; value: string; href: string }) {
  return (
    <div className="rwa-field">
      <span className="rwa-k">{label}</span>
      <a className="rwa-v mono" href={href} target="_blank" rel="noreferrer" title={value}><span className="rwa-full">{value}</span><span className="rwa-short">{mid(value)}</span></a>
      <CopyButton value={value} what={label} />
    </div>
  );
}

/** RWA yield layer Soroban contracts on MAINNET (public IDs/hashes only, from src/config/rwa-mainnet.json). */
export function RwaDeployInfo({ compact = false }: { compact?: boolean }) {
  const live = contracts.filter((c) => c.status === "deployed").length;
  if (compact) {
    return (
      <div className="card rwa-compact" data-testid="rwa-deploy-compact">
        <span className="pill green">MAINNET</span>
        <span>RWA yield layer: {live}/{contracts.length} Soroban contracts live on Stellar mainnet (unaudited).</span>
        <Link to="/deploy" className="btn ghost small">Deploy info</Link>
      </div>
    );
  }
  return (
    <section className="card rwa-deploy" data-testid="rwa-deploy">
      <h2 style={{ marginTop: 0 }}><span className="pill green">MAINNET</span> RWA yield layer contracts</h2>
      <p className="muted">Stellar mainnet. Unaudited; no deposits yet. {data.deployed ? `Deployed ${data.deployed}` : ""}{data.source_commit ? ` from commit ${data.source_commit}` : ""}.</p>
      <ul className="rwa-list">
        {contracts.map((c) => (
          <li key={c.name} className="rwa-item">
            <div className="rwa-name"><b className="mono">{c.name}</b> <span className={`pill ${c.status === "deployed" ? "green" : "gold"}`}>{c.status}</span></div>
            {c.id && <Field label="Contract ID" value={c.id} href={`${SC}/contracts/${c.id}`} />}
            {c.deploy_tx && <Field label="Deploy tx" value={c.deploy_tx} href={`${SC}/transactions/${c.deploy_tx}`} />}
            {c.init_tx && <Field label="Init tx" value={c.init_tx} href={`${SC}/transactions/${c.init_tx}`} />}
          </li>
        ))}
      </ul>
      <h3>Link calls</h3>
      <ul className="rwa-list">
        {data.links.map((l) => (
          <li key={l.tx} className="rwa-item"><Field label={l.name} value={l.tx} href={`${SC}/transactions/${l.tx}`} /></li>
        ))}
      </ul>
    </section>
  );
}
