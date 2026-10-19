import { useState } from "react";
import { Link } from "react-router-dom";
import { PageHead } from "../components/ui";
import QrCode from "../components/QrCode";
import { CopyButton } from "../components/CopyButton";
import { TxLink } from "../components/TxLink";
import { useWallet } from "../lib/wallet";
import { useAccount } from "../lib/useAccount";
import { fetchBaseReserve, fetchRawAccount } from "../lib/account";
import { buildSendTx, planSend, validDestination, MEMO_MAX_BYTES, memoBytes, type SendAsset } from "../lib/send";
import { TRUSTLINE_NOTE, buildTrustlineTx, usdcIssuer } from "../lib/trustline";
import { NETS } from "../lib/nativePools";
import { NETWORK_PASSPHRASE } from "../lib/config";
import { explorerAccountUrl } from "../lib/explorer";
import { fmt, short } from "../lib/format";
import { submitSignedXdr } from "../lib/stellar";

const NET = "testnet" as const; // mainnet signing stays off until it is switched on deliberately

type Result = { kind: "ok"; hash: string; what: string } | { kind: "err"; msg: string } | null;
const keyOf = (a: SendAsset) => (a.issuer ? `${a.code}:${a.issuer}` : "XLM");

export default function Wallet() {
  const w = useWallet();
  const acct = useAccount(NET, w.address);
  const [tab, setTab] = useState<"receive" | "send">("receive");

  if (!w.address) {
    return (
      <>
        <PageHead kicker="Wallet" title="Send &amp; receive">Your keys stay in this browser. Create a keypair or sign in with your secret key to send and receive.</PageHead>
        <div className="card glow" data-testid="wallet-signedout">
          <h2 style={{ marginTop: 0 }}>No key active</h2>
          <p className="muted">Quasaria never holds your secret key. It is generated in your browser, and only you can sign.</p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className="btn" onClick={() => w.openModal("create")}>Create a keypair</button>
            <button className="btn ghost" onClick={() => w.openModal()}>Sign in with secret key</button>
          </div>
        </div>
      </>
    );
  }
  const funded = acct.view?.exists ?? w.funded;
  return (
    <>
      <PageHead kicker="Wallet" title="Send &amp; receive" right={<span className="pill gold">Testnet · no real value</span>}>
        Send XLM or any asset you hold, and share your address to receive. Transactions are signed here with your key and go straight to the Stellar network.
      </PageHead>
      <div className="tabs" role="tablist" style={{ marginBottom: 16 }}>
        <button role="tab" aria-selected={tab === "receive"} className={tab === "receive" ? "on" : ""} onClick={() => setTab("receive")} data-testid="tab-receive">Receive</button>
        <button role="tab" aria-selected={tab === "send"} className={tab === "send" ? "on" : ""} onClick={() => setTab("send")} data-testid="tab-send">Send</button>
      </div>
      {tab === "receive" ? <Receive address={w.address} funded={funded} acct={acct} /> : <Send address={w.address} acct={acct} funded={funded} />}
    </>
  );
}

export function Receive({ address, funded, acct }: { address: string; funded: boolean | null; acct: ReturnType<typeof useAccount> }) {
  const w = useWallet();
  const [res, setRes] = useState<Result>(null);
  const [busy, setBusy] = useState(false);
  const issuer = usdcIssuer(NET);
  const hasUsdc = acct.view?.exists ? acct.view.holdings.some((h) => h.code === "USDC" && h.issuer === issuer) : false;
  const addTrust = async () => {
    setBusy(true); setRes(null);
    try {
      const raw = await fetchRawAccount(NET, address);
      if (!raw) throw new Error("Your account is not funded on this network yet.");
      const seq = (raw as unknown as { sequence: string }).sequence;
      const signed = await w.sign(buildTrustlineTx({ source: address, sequence: seq, code: "USDC", issuer, passphrase: NETWORK_PASSPHRASE }));
      const r = await submitSignedXdr(signed);
      setRes({ kind: "ok", hash: r.hash, what: "USDC trustline added" });
      acct.reload();
    } catch (e) { setRes({ kind: "err", msg: e instanceof Error ? e.message : String(e) }); } finally { setBusy(false); }
  };
  return (
    <div className="grid g-2">
      <div className="card glow" data-testid="receive-card">
        <h2 style={{ marginTop: 0 }}>Receive</h2>
        <p className="muted l-tiny">Your public address. Share it freely: it can only receive.</p>
        <div className="addr-full mono" data-testid="receive-address">{address}</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "10px 0 14px" }}>
          <CopyButton value={address} label="Copy address" />
          <a className="btn small ghost" href={explorerAccountUrl(address, NET) ?? undefined} target="_blank" rel="noopener noreferrer">View on StellarChain ↗</a>
        </div>
        <div style={{ display: "flex", justifyContent: "center" }}><QrCode value={address} size={176} label="QR code of your public address" /></div>
        {funded === false && (
          <div className="notice" style={{ marginTop: 14 }} data-testid="receive-unfunded">
            This address is not on the network yet. It appears once it receives its first {NETS[NET].label === "Testnet" ? "XLM (at least 1 XLM)" : "XLM"}. <button className="btn small" onClick={() => w.openModal("fund")}>Fund it</button>
          </div>
        )}
      </div>
      <div className="card" data-testid="trustline-card">
        <h2 style={{ marginTop: 0 }}>Receive USDC</h2>
        <p className="muted">{TRUSTLINE_NOTE}</p>
        <div className="muted l-tiny" style={{ wordBreak: "break-all" }}>Verified issuer (Circle, testnet): <span className="mono">{short(issuer, 6)}</span></div>
        <p style={{ marginTop: 12 }}>
          {hasUsdc ? <span className="pill cyan">USDC trustline active</span>
            : <button className="btn" disabled={busy || funded !== true} onClick={addTrust} data-testid="add-usdc">{busy ? "Waiting…" : "Add USDC trustline"}</button>}
        </p>
        {funded !== true && <p className="muted l-tiny">Fund your account first; a trustline needs the 0.5 XLM reserve.</p>}
        <ResultNote res={res} />
      </div>
    </div>
  );
}

function ResultNote({ res }: { res: Result }) {
  if (!res) return null;
  return res.kind === "ok"
    ? <div className="notice tx-ok" role="status" data-testid="tx-result" style={{ marginTop: 12 }}>{res.what}. <TxLink hash={res.hash} net={NET} chars={10} /></div>
    : <div className="notice" role="alert" data-testid="tx-error" style={{ marginTop: 12 }}>{res.msg}</div>;
}

function Send({ address, acct, funded }: { address: string; acct: ReturnType<typeof useAccount>; funded: boolean | null }) {
  const w = useWallet();
  const view = acct.view?.exists ? acct.view : null;
  const assets: SendAsset[] = [{ code: "XLM", issuer: null }, ...(view?.holdings ?? []).map((h) => ({ code: h.code, issuer: h.issuer }))];
  const [ak, setAk] = useState("XLM");
  const [dest, setDest] = useState("");
  const [amount, setAmount] = useState("");
  const [memo, setMemo] = useState("");
  const [step, setStep] = useState<"edit" | "review">("edit");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<Result>(null);
  const asset = assets.find((a) => keyOf(a) === ak) ?? assets[0];
  const held = view?.holdings.find((h) => h.code === asset.code && h.issuer === asset.issuer);
  const avail = asset.issuer === null ? view?.native.available ?? null : held?.balance ?? null;

  const review = async () => {
    setErr(null); setRes(null);
    if (!validDestination(dest)) { setErr("That is not a valid Stellar address (it starts with G and is 56 characters)."); return; }
    setBusy(true);
    try {
      const [src, d, reserve] = await Promise.all([fetchRawAccount(NET, address), fetchRawAccount(NET, dest.trim()), fetchBaseReserve(NET)]);
      const plan = planSend({ source: address, asset, amount, destination: dest, memo, src, baseReserve: reserve, dest: d });
      if (!plan.ok) { setErr(plan.error); return; }
      setPlanned(plan); setSeq((src as unknown as { sequence: string }).sequence); setStep("review");
    } catch (e) { setErr(`Could not reach Horizon: ${e instanceof Error ? e.message : String(e)}`); } finally { setBusy(false); }
  };
  const [planned, setPlanned] = useState<Extract<ReturnType<typeof planSend>, { ok: true }> | null>(null);
  const [seq, setSeq] = useState("");
  const confirm = async () => {
    if (!planned) return;
    setBusy(true); setErr(null);
    try {
      const xdr = buildSendTx(planned, { source: address, sequence: seq, destination: dest, asset, memo, passphrase: NETWORK_PASSPHRASE });
      const signed = await w.sign(xdr);
      const r = await submitSignedXdr(signed);
      setRes({ kind: "ok", hash: r.hash, what: `Sent ${planned.amountText} ${asset.code}` });
      setStep("edit"); setAmount(""); setMemo(""); setPlanned(null);
      acct.reload();
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); setStep("edit"); } finally { setBusy(false); }
  };

  if (funded === false) {
    return <div className="card" data-testid="send-unfunded"><h2 style={{ marginTop: 0 }}>Send</h2><p className="muted">Your account is not on the network yet, so there is nothing to send. Fund it first.</p><button className="btn" onClick={() => w.openModal("fund")}>Fund it</button> <Link className="btn ghost" to="/buy">Buy XLM</Link></div>;
  }
  return (
    <div className="grid g-2">
      <div className="card glow" data-testid="send-card">
        <h2 style={{ marginTop: 0 }}>Send</h2>
        {step === "edit" ? (
          <>
            <div className="field"><label htmlFor="s-asset">Asset</label>
              <select id="s-asset" className="input" value={ak} onChange={(e) => setAk(e.target.value)} data-testid="send-asset">
                {assets.map((a) => <option key={keyOf(a)} value={keyOf(a)}>{a.code}{a.issuer ? ` · ${short(a.issuer, 4)}` : " · native"}</option>)}
              </select>
              <span className="muted l-tiny">Available: <span className="mono">{avail === null ? "—" : fmt(avail, 7).replace(/\.?0+$/, "")}</span> {asset.code}{asset.issuer === null ? " (after reserve)" : ""}</span>
            </div>
            <div className="field"><label htmlFor="s-dest">To (Stellar address)</label>
              <input id="s-dest" className="input mono" placeholder="G…" value={dest} onChange={(e) => setDest(e.target.value.trim())} spellCheck={false} autoComplete="off" data-testid="send-dest" /></div>
            <div className="field"><label htmlFor="s-amt">Amount</label>
              <div style={{ display: "flex", gap: 8 }}>
                <input id="s-amt" className="input mono" inputMode="decimal" placeholder="0.0" value={amount} onChange={(e) => setAmount(e.target.value)} data-testid="send-amount" style={{ flex: 1 }} />
                <button type="button" className="btn small ghost" disabled={avail === null} onClick={() => avail !== null && setAmount(String(Math.max(0, asset.issuer === null ? avail - 0.00001 : avail).toFixed(7)).replace(/\.?0+$/, ""))}>Max</button>
              </div></div>
            <div className="field"><label htmlFor="s-memo">Memo (optional, text)</label>
              <input id="s-memo" className="input" value={memo} onChange={(e) => setMemo(e.target.value)} data-testid="send-memo" />
              <span className="muted l-tiny">{memoBytes(memo)}/{MEMO_MAX_BYTES} bytes. Exchanges often need a memo to credit you.</span></div>
            {err && <div className="notice" role="alert" data-testid="send-error">{err}</div>}
            <button className="btn block" onClick={review} disabled={busy || !dest || !amount} data-testid="send-review">{busy ? "Checking…" : "Review"}</button>
          </>
        ) : planned && (
          <div data-testid="send-confirm">
            <dl className="kv" style={{ margin: "0 0 10px" }}>
              <div><dt>You send</dt><dd className="mono">{planned.amountText} {asset.code}</dd></div>
              <div><dt>To</dt><dd className="mono wrap">{dest}</dd></div>
              <div><dt>Memo</dt><dd>{memo.trim() || "none"}</dd></div>
              <div><dt>Network fee</dt><dd className="mono">{planned.fee}</dd></div>
            </dl>
            {planned.notes.map((n) => <div className="notice" key={n} style={{ marginTop: 10 }}>{n}</div>)}
            <p className="muted l-tiny">Transactions on Stellar cannot be reversed. Check the address before you confirm.</p>
            {err && <div className="notice" role="alert">{err}</div>}
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn" onClick={confirm} disabled={busy} data-testid="send-confirm-btn">{busy ? "Signing…" : "Confirm and sign"}</button>
              <button className="btn ghost" onClick={() => setStep("edit")} disabled={busy}>Back</button>
            </div>
          </div>
        )}
        <ResultNote res={res} />
      </div>
      <div className="card" data-testid="send-help">
        <h2 style={{ marginTop: 0 }}>Before you send</h2>
        <ul className="muted" style={{ paddingLeft: 18, lineHeight: 1.6, margin: 0 }}>
          <li>Network: <b>Testnet</b>. Test tokens have no value.</li>
          <li>Your account keeps a small XLM reserve, so “available” is below your balance.</li>
          <li>Sending to an address that is new on the network creates it (needs 1 XLM or more).</li>
          <li>Non-XLM assets can only be received by addresses with a matching trustline.</li>
        </ul>
      </div>
    </div>
  );
}
