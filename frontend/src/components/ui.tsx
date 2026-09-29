import { useEffect, useRef, useState, type ReactNode } from "react";
import { useWallet } from "../lib/wallet";
import { CONTRACTS_CONFIGURED } from "../lib/config";
import { snapshotLabel, type DataSource } from "../lib/stellarchain";
import { TX_EVENT } from "../game/GameProvider";
import { CountUpText } from "../game/widgets";
import { burst } from "../game/fx";

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
      <span className={`value ${className ?? ""}`}>{typeof value === "string" ? <CountUpText text={value} /> : value}</span>
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
      setStatus("Read-only mode: create an in-app account or connect Freighter (TESTNET) to sign this transaction.");
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
      // Cosmetic only: lets the quest layer mark one-time "try it" quests (see game/engine.ts questForTx).
      window.dispatchEvent(new CustomEvent(TX_EVENT, { detail: { label } }));
    } catch (e) {
      setStatus(`${label} failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };
  return { status, busy, run, wallet: w };
}

export function TxStatus({ status }: { status: string | null }) {
  const ok = !!status && /: confirmed/.test(status);
  const el = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Satisfying (but light) success moment: a small particle burst from the check mark.
    const r = ok ? el.current?.querySelector(".tx-ok-ico")?.getBoundingClientRect() : null;
    if (r) burst(r.left + r.width / 2, r.top + r.height / 2, 40);
  }, [ok, status]);
  if (!status) return null;
  return (
    <div ref={el} className={`notice ${ok ? "tx-ok" : ""}`} style={{ marginTop: 12 }} role="status">
      {ok && (
        <span className="tx-ok-ico" aria-hidden>
          <svg viewBox="0 0 24 24" width="22" height="22"><circle cx="12" cy="12" r="10" /><path d="m7.5 12.5 3 3 6-7" /></svg>
        </span>
      )}
      <span>{status}</span>
    </div>
  );
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

/** Small badge telling the user where a panel's numbers come from. */
export function SourceTag({ live, loading, error, what }: { live: boolean; loading?: boolean; error?: string | null; what?: string }) {
  if (loading) return <span className="pill">⟳ reading testnet…</span>;
  if (live) return <span className="pill green" title={what}>● live · Soroban testnet</span>;
  return <span className="pill pink" title={error ?? "contracts not configured"}>demo data{error ? " (RPC error)" : ""}</span>;
}

/** "Viewing public demo account" note for read-only mode. */
export function ViewerNote({ address, isDemo, role }: { address: string; isDemo: boolean; role: string }) {
  if (!isDemo || !address) return null;
  return (
    <p className="muted" style={{ fontSize: "0.78rem", margin: "6px 0 0" }}>
      Read-only: showing the public seeded {role} account{" "}
      <a className="mono" href={`https://stellar.expert/explorer/testnet/account/${address}`} target="_blank" rel="noreferrer">{address.slice(0, 6)}…{address.slice(-4)}</a>. Create an account or connect a wallet to see your own.
    </p>
  );
}

/** Market-data provenance: live stellarchain.io, expired browser cache, or the build-time snapshot. */
export function FeedBadge({ source, snapshotAt }: { source?: DataSource; snapshotAt?: string }) {
  if (!source) return null;
  if (source === "live") return <span className="pill green" data-testid="feed-badge">● live · stellarchain.io</span>;
  const label = source === "snapshot" ? snapshotLabel(snapshotAt) : snapshotLabel(snapshotAt).replace("snapshot", "cached");
  return (
    <span className="pill gold" data-testid="feed-badge" title={source === "snapshot" ? `stellarchain.io data fetched at build time (${snapshotAt ?? "unknown"}); the live API is not reachable from this site` : `last live response, cached in this browser (${snapshotAt ?? "unknown"})`}>
      {label}
    </span>
  );
}
