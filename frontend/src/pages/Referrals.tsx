import { useState } from "react";
import { PageHead, SourceTag, Stat, TxStatus, ViewerNote, useTx } from "../components/ui";
import { DEMO_REFERRAL } from "../lib/demo";
import { CONTRACTS, DEMO_ACCOUNTS, symbolOf } from "../lib/config";
import { addr, invokeContract } from "../lib/soroban";
import { readReferrals, readReferrerOf, useChain, useViewer } from "../lib/chain";
import { fmt, pct, short } from "../lib/format";

type Row = { key: string; who: string; when: string; token: string; amount: number };

function ago(iso: string) {
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m ago`;
  if (s < 86_400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86_400)}d ago`;
}

export const REF_KEY = "quasaria.ref";
const DEMO_ADDR = "GDEMOQUASARIAREFERRALXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX";

export default function Referrals() {
  const tx = useTx();
  const me = tx.wallet.address;
  // Referrer view: your account, or the seeded deployer (the demo trader's referrer).
  const viewer = useViewer("lp");
  const [copied, setCopied] = useState(false);
  const pending = typeof localStorage !== "undefined" ? localStorage.getItem(REF_KEY) : null;
  const [refInput, setRefInput] = useState(pending ?? "");
  const [nonce, setNonce] = useState(0);
  const link = `${window.location.origin}${import.meta.env.BASE_URL}?ref=${viewer.address || DEMO_ADDR}`;

  const chain = useChain(async () => {
    const r = await readReferrals(viewer.address);
    const myReferrer = await readReferrerOf(me ?? DEMO_ACCOUNTS.trader);
    return { ...r, myReferrer };
  }, [viewer.address, me, nonce]);

  const count = chain.data?.count ?? DEMO_REFERRAL.count;
  const shareBps = chain.data?.shareBps ?? DEMO_REFERRAL.shareBps;
  const earned = chain.data ? chain.data.earned.map((e) => ({ token: symbolOf(e.token), amount: e.amount })) : DEMO_REFERRAL.earned;
  const rows: Row[] = chain.data
    ? chain.data.recent.map((r, i) => ({ key: `${r.ledger}-${i}`, who: `${symbolOf(r.source).startsWith("QLP") ? "AMM " + symbolOf(r.source).slice(4) : r.source === CONTRACTS.vault ? "Leverage vault" : short(r.source)}`, when: ago(r.when), token: symbolOf(r.token), amount: r.amount }))
    : DEMO_REFERRAL.recent.map((r) => ({ key: r.who, who: r.who, when: r.when, token: "QUSD", amount: r.volume * 0.003 * 0.2 }));
  const myReferrer = me ? chain.data?.myReferrer ?? null : null;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked */
    }
  };

  return (
    <>
      <PageHead kicker="Scene · Constellations" title="Referrals" right={<div className="row"><SourceTag {...chain} /><span className="pill green">{pct(shareBps, 0)} of fees to referrers</span></div>}>
        Grow your constellation. Anyone who links to you on-chain sends you a share of every swap fee and leverage opening fee they pay — forever.
      </PageHead>
      <div className="grid g-main-side">
        <div className="grid" style={{ alignContent: "start" }}>
          <div className="card glow">
            <h2>Your shareable link</h2>
            <div className="row">
              <input className="input" readOnly value={link} />
              <button className="btn" onClick={copy}>{copied ? "Copied ✦" : "Copy"}</button>
            </div>
            {!me && (chain.live ? <ViewerNote {...viewer} role="referrer (deployer)" /> : <p className="muted" style={{ fontSize: "0.8rem" }}>Demo link shown — create an account or connect a wallet to get your own.</p>)}
          </div>
          <div className="grid g-4">
            <div className="card"><Stat label="Referred traders" value={count} /></div>
            {earned.map((e) => (
              <div className="card" key={e.token}><Stat label={`Earned · ${e.token}`} value={fmt(e.amount, e.amount && e.amount < 1 ? 4 : 2)} className="pos" sub={chain.live ? "registry.earned()" : "demo"} /></div>
            ))}
          </div>
          <div className="card">
            <h2>Recent referral payouts</h2>
            <table className="t">
              <thead><tr><th>Fee source</th><th>When</th><th>Token</th><th>Your cut</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.key}><td className="mono">{r.who}</td><td className="muted">{r.when}</td><td>{r.token}</td><td className="mono pos">{fmt(r.amount, 4)}</td></tr>
                ))}
                {!rows.length && <tr><td colSpan={4} className="muted">No referral_paid events in the RPC retention window.</td></tr>}
              </tbody>
            </table>
            {chain.live && <p className="muted" style={{ fontSize: "0.78rem" }}>From on-chain <span className="mono">referral_paid</span> events (Soroban RPC keeps ~7 days).</p>}
          </div>
        </div>
        <div className="card">
          <h2>Link your referrer</h2>
          {!me && chain.data?.myReferrer && <div className="notice">On-chain example: the demo trader <span className="mono">{short(DEMO_ACCOUNTS.trader, 6)}</span> is linked to referrer <span className="mono">{short(chain.data.myReferrer, 6)}</span>.</div>}
          {myReferrer ? (
            <p>You were referred by <span className="mono">{short(myReferrer, 6)}</span>. This is permanent.</p>
          ) : (
            <>
              {pending && <div className="notice">Invite detected from <span className="mono">{short(pending, 6)}</span> — confirm it on-chain below.</div>}
              <div className="field"><label>Referrer address (G…)</label><input className="input" value={refInput} onChange={(e) => setRefInput(e.target.value.trim())} placeholder="G..." /></div>
              <button className="btn block" disabled={tx.busy || !refInput} onClick={() => tx.run("set referrer", async () => {
                if (refInput === me) throw new Error("self-referral is not allowed");
                const h = (await invokeContract(me!, tx.wallet.sign, CONTRACTS.referral, "set_referrer", [addr(me!), addr(refInput)])).hash.slice(0, 10);
                setNonce((n) => n + 1);
                return h;
              })}>Set referrer (one time)</button>
            </>
          )}
          <TxStatus status={tx.status} />
          <h3 style={{ marginTop: 18 }}>On-chain rules</h3>
          <ul className="muted" style={{ fontSize: "0.85rem", paddingLeft: 18 }}>
            <li>Set once — can never be changed.</li>
            <li>No self-referral; no cycles (ancestor chain checked on-chain).</li>
            <li>Only approved pools/vault can record earnings; referrers are paid instantly in the fee token.</li>
          </ul>
        </div>
      </div>
    </>
  );
}
