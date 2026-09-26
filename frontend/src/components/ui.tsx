import { useState, type ReactNode } from "react";
import { useWallet } from "../lib/wallet";
import { CONTRACTS_CONFIGURED } from "../lib/config";

export function PageHead({ kicker, title, children, right }: { kicker: string; title: string; children?: ReactNode; right?: ReactNode }) {
  return (
    <div className="page-head">
      <div>
        <div className="kicker">{kicker}</div>
        <h1>{title}</h1>
        {children && <p>{children}</p>}
      </div>
      {right}
    </div>
  );
}

export function Stat({ label, value, sub, className }: { label: string; value: ReactNode; sub?: ReactNode; className?: string }) {
  return (
    <div className="stat">
      <span className="label">{label}</span>
      <span className={`value ${className ?? ""}`}>{value}</span>
      {sub && <span className="sub">{sub}</span>}
    </div>
  );
}

export function Tabs<T extends string>({ value, options, onChange }: { value: T; options: { v: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="tabs">
      {options.map((o) => (
        <button key={o.v} className={o.v === value ? "on" : ""} onClick={() => onChange(o.v)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Wraps a transaction action with wallet / config guards and status text.
 * `needsContracts` = the action calls Soroban contracts (vs classic SDEX ops).
 */
export function useTx(needsContracts = true) {
  const w = useWallet();
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (label: string, fn: () => Promise<string | void>) => {
    if (!w.address) {
      setStatus("Demo mode: connect Freighter (TESTNET) to sign this transaction.");
      return;
    }
    if (needsContracts && !CONTRACTS_CONFIGURED) {
      setStatus("Contracts not configured. Run scripts/deploy-testnet.sh and restart the dev server.");
      return;
    }
    setBusy(true);
    setStatus(`${label}: awaiting signature…`);
    try {
      const r = await fn();
      setStatus(`${label}: confirmed ${r ? `(${r})` : ""}`);
    } catch (e) {
      setStatus(`${label} failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };
  return { status, busy, run, wallet: w };
}

export function TxStatus({ status }: { status: string | null }) {
  if (!status) return null;
  return <div className="notice" style={{ marginTop: 12 }}>{status}</div>;
}

export function RiskWarning({ children }: { children?: ReactNode }) {
  return (
    <div className="risk" role="alert">
      <strong>⚠ HIGH RISK — EXPERIMENTAL, UNAUDITED, TESTNET ONLY</strong>
      <div style={{ marginTop: 6, fontSize: "0.9rem" }}>
        {children ??
          "Leveraged trading can lose more than you expect, very fast. Positions are liquidated when the health factor drops below 1.0. Automated bots can malfunction, act on stale oracle prices, or trade into losses. Nothing here is financial advice; leveraged derivatives may be restricted or illegal where you live."}
      </div>
    </div>
  );
}
