import { useEffect, useState } from "react";
import { PageHead, Stat, TxStatus, useTx } from "../components/ui";
import { DEMO_REFERRAL } from "../lib/demo";
import { CONTRACTS, CONTRACTS_CONFIGURED } from "../lib/config";
import { addr, invokeContract, readContract } from "../lib/soroban";
import { fmt, pct, short } from "../lib/format";

export const REF_KEY = "quasaria.ref";
const DEMO_ADDR = "GDEMOQUASARIAREFERRALXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX";

export default function Referrals() {
  const tx = useTx();
  const me = tx.wallet.address;
  const [count, setCount] = useState(DEMO_REFERRAL.count);
  const [myReferrer, setMyReferrer] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const pending = typeof localStorage !== "undefined" ? localStorage.getItem(REF_KEY) : null;
  const [refInput, setRefInput] = useState(pending ?? "");
  const link = `${window.location.origin}/?ref=${me ?? DEMO_ADDR}`;

  useEffect(() => {
    if (!CONTRACTS_CONFIGURED || !me) return;
    readContract<number>(CONTRACTS.referral, "referral_count", [addr(me)]).then(setCount).catch(() => void 0);
    readContract<string | null>(CONTRACTS.referral, "get_referrer", [addr(me)]).then(setMyReferrer).catch(() => void 0);
  }, [me]);

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
      <PageHead kicker="Scene · Constellations" title="Referrals" right={<span className="pill green">{pct(DEMO_REFERRAL.shareBps, 0)} of fees to referrers</span>}>
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
            {!me && <p className="muted" style={{ fontSize: "0.8rem" }}>Demo link shown — connect Freighter to get your own.</p>}
          </div>
          <div className="grid g-4">
            <div className="card"><Stat label="Referred traders" value={count} /></div>
            {DEMO_REFERRAL.earned.map((e) => (
              <div className="card" key={e.token}><Stat label={`Earned · ${e.token}`} value={fmt(e.amount, 2)} className="pos" sub={CONTRACTS_CONFIGURED ? "registry.earned()" : "demo"} /></div>
            ))}
          </div>
          <div className="card">
            <h2>Recent referred activity</h2>
            <table className="t">
              <thead><tr><th>Trader</th><th>When</th><th>Volume</th><th>Your cut (est.)</th></tr></thead>
              <tbody>
                {DEMO_REFERRAL.recent.map((r) => (
                  <tr key={r.who}><td className="mono">{r.who}</td><td className="muted">{r.when}</td><td className="mono">{fmt(r.volume, 0)}</td><td className="mono pos">{fmt(r.volume * 0.003 * 0.2, 2)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="card">
          <h2>Link your referrer</h2>
          {myReferrer ? (
            <p>You were referred by <span className="mono">{short(myReferrer, 6)}</span>. This is permanent.</p>
          ) : (
            <>
              {pending && <div className="notice">Invite detected from <span className="mono">{short(pending, 6)}</span> — confirm it on-chain below.</div>}
              <div className="field"><label>Referrer address (G…)</label><input className="input" value={refInput} onChange={(e) => setRefInput(e.target.value.trim())} placeholder="G..." /></div>
              <button className="btn block" disabled={tx.busy || !refInput} onClick={() => tx.run("set referrer", async () => {
                if (refInput === me) throw new Error("self-referral is not allowed");
                return (await invokeContract(me!, tx.wallet.sign, CONTRACTS.referral, "set_referrer", [addr(me!), addr(refInput)])).hash.slice(0, 10);
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
