import { useEffect, useState } from "react";
import { useWallet, type ModalIntent } from "../lib/wallet";
import { downloadText, fundWithFriendbot, generateAccount, importSecret, isValidSecret, MIN_PASSWORD, type NewAccount } from "../lib/keys";
import { NETWORK } from "../lib/config";
import { short } from "../lib/format";
import QrCode from "./QrCode";

type Step = "choose" | "reveal" | "protect" | "import" | "unlock" | "fund";

export const NONCUSTODIAL_NOTE =
  "Quasaria never holds your keys or your XLM when you trade. Your browser creates the keypair, you save the secret, and you sign every transaction yourself.";

function Copy({ text, label = "Copy" }: { text: string; label?: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button className="btn small ghost" onClick={async () => {
      try { await navigator.clipboard.writeText(text); setOk(true); setTimeout(() => setOk(false), 1500); } catch { /* clipboard blocked */ }
    }} data-testid="copy-btn">{ok ? "Copied ✦" : label}</button>
  );
}

/** Optional passphrase: leave off for a session-only key (the default). */
function PassphraseFields({ value, onChange }: { value: { on: boolean; pw: string; pw2: string }; onChange: (v: { on: boolean; pw: string; pw2: string }) => void }) {
  return (
    <div className="card" style={{ padding: 14, marginTop: 10 }}>
      <label className="row" style={{ gap: 8, fontSize: "0.9rem" }}>
        <input type="checkbox" checked={value.on} onChange={(e) => onChange({ ...value, on: e.target.checked })} data-testid="remember-toggle" />
        Keep an encrypted copy in this browser (protect it with a passphrase)
      </label>
      {value.on && (
        <div className="grid g-2" style={{ marginTop: 10 }}>
          <div className="field"><label>Passphrase (min {MIN_PASSWORD})</label><input className="input" type="password" autoComplete="new-password" value={value.pw} onChange={(e) => onChange({ ...value, pw: e.target.value })} /></div>
          <div className="field"><label>Confirm passphrase</label><input className="input" type="password" autoComplete="new-password" value={value.pw2} onChange={(e) => onChange({ ...value, pw2: e.target.value })} /></div>
        </div>
      )}
      <p className="muted" style={{ fontSize: "0.75rem", margin: "6px 0 0" }}>
        Off by default: the key lives in memory and is gone when you close the tab, so you paste your secret to sign in next time. If on, it is encrypted in your browser (WebCrypto: PBKDF2-SHA256, 600k iterations → AES-256-GCM) and stored only in this browser. It still does not replace saving your secret: clearing browser data or forgetting the passphrase loses it.
      </p>
    </div>
  );
}

const passError = (r: { on: boolean; pw: string; pw2: string }) =>
  !r.on ? null : r.pw.length < MIN_PASSWORD ? `Passphrase must be at least ${MIN_PASSWORD} characters.` : r.pw !== r.pw2 ? "Passphrases do not match." : null;

/**
 * Which screen the modal opens on. "Create" ALWAYS starts a new keypair, even when an encrypted key from an
 * earlier session is saved in this browser; the unlock screen only opens for an explicit "unlock" intent.
 * (Bug: a saved key used to send every Create click to "Unlock saved key", so the new secret never appeared.)
 */
export function initialModalState(intent: ModalIntent, hasStored: boolean, address: string | null, gen: () => NewAccount = generateAccount): { step: Step; acct: NewAccount | null } {
  if (intent === "fund" && address) return { step: "fund", acct: { publicKey: address, secret: "" } };
  if (intent === "create") {
    try { return { step: "reveal", acct: gen() }; } catch { /* no Web Crypto: the chooser shows the error on click */ }
  }
  if (intent === "unlock" && hasStored) return { step: "unlock", acct: null };
  return { step: "choose", acct: null };
}

/** A full key, wrapped in monospace so all 56 characters fit at 390 px. */
function KeyBlock({ value, testid, masked = false }: { value: string; testid: string; masked?: boolean }) {
  return <code className={`key-block mono${masked ? " masked" : ""}`} data-testid={testid}>{masked ? "•".repeat(value.length) : value}</code>;
}

export default function AccountModal() {
  const w = useWallet();
  const [initial] = useState<{ step: Step; acct: NewAccount | null }>(() => initialModalState(w.modalIntent, !!w.stored, w.address));
  const [step, setStep] = useState<Step>(initial.step);
  const [acct, setAcct] = useState<NewAccount | null>(initial.acct);
  const [saved, setSaved] = useState(false);
  const [pass, setPass] = useState({ on: false, pw: "", pw2: "" });
  const [importText, setImportText] = useState("");
  const [unlockPw, setUnlockPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [fund, setFund] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(true);

  const close = () => { setAcct(null); setImportText(""); w.closeModal(); };

  const login = async (a: NewAccount, isNew: boolean) => {
    const e = passError(pass);
    if (e) return setErr(e);
    setBusy(true);
    setErr(null);
    try {
      await w.loginWithSecret(a.secret, pass.on ? pass.pw : undefined);
      setAcct({ publicKey: a.publicKey, secret: "" }); // from here on only the address is kept in the modal
      setImportText("");
      setPass({ on: false, pw: "", pw2: "" });
      setStep("fund");
      if (NETWORK === "testnet" && isNew) {
        setFund("Funding with Friendbot (testnet)…");
        fundWithFriendbot(a.publicKey)
          .then((r) => { setFund(r.alreadyFunded ? "Already funded." : "Funded with 10,000 test XLM by Friendbot ✦"); w.refreshFunded(); })
          .catch((x) => setFund(`Friendbot failed: ${(x as Error).message}. You can retry from friendbot.stellar.org.`));
      }
    } catch (x) {
      setErr((x as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // The fund screen closes itself once the account exists and the user has nothing left to do.
  useEffect(() => { if (step === "fund") w.refreshFunded(); }, [step]); // eslint-disable-line react-hooks/exhaustive-deps

  const fileText = (a: NewAccount) =>
    `Quasaria — Stellar ${NETWORK.toUpperCase()} account backup\nCreated: ${new Date().toISOString()}\n\nPublic address (safe to share):\n${a.publicKey}\n\nSECRET KEY (never share, anyone with it controls the account):\n${a.secret}\n\nQuasaria cannot recover this key. Keep this file offline.\n`;

  const title = step === "choose" ? "Get started" : step === "import" ? "Sign in with your secret key" : step === "unlock" ? "Unlock saved key" : step === "fund" ? "Fund your account" : step === "protect" ? "Protect this browser copy" : "Create account";
  const addrForFund = acct?.publicKey ?? w.address ?? "";

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Account" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="card glow modal">
        <div className="row between" style={{ marginBottom: 8 }}>
          <h2 style={{ margin: 0 }}>{title}</h2>
          <button className="btn small ghost" onClick={close} aria-label="Close">✕</button>
        </div>
        <p className="notice" style={{ fontSize: "0.8rem", marginTop: 0 }} data-testid="wallet-noncustodial-note"><b>Your keys, your XLM.</b> {NONCUSTODIAL_NOTE} We cannot see, reset or recover your key.</p>

        {step === "choose" && (
          <div className="grid" style={{ gap: 10 }}>
            <button className="btn block" onClick={() => { try { setAcct(generateAccount()); setSaved(false); setRevealed(true); setErr(null); setStep("reveal"); } catch (x) { setErr((x as Error).message); } }}>✦ Create a new keypair</button>
            <button className="btn block ghost" onClick={() => setStep("import")}>Sign in with a secret key (S…)</button>
            {w.stored && <button className="btn block ghost" onClick={() => { setErr(null); setStep("unlock"); }} data-testid="choose-unlock">Unlock saved key ({short(w.stored.publicKey, 4)})</button>}
            {err && <div className="notice warn">{err}</div>}
            <div className="notice" style={{ fontSize: "0.78rem" }}>{NETWORK === "testnet" ? <>On testnet, new accounts are funded automatically by Friendbot. <b>On mainnet</b> a new address does not exist on the ledger until someone sends it the minimum balance (1 XLM base reserve, plus 0.5 XLM per trustline or offer). There is no Friendbot.</> : <>A new address does not exist on the ledger until someone sends it the minimum balance (1 XLM base reserve, plus 0.5 XLM per trustline or offer).</>}</div>
          </div>
        )}

        {step === "reveal" && acct && (
          <>
            {w.stored && (
              <div className="notice warn" data-testid="stored-key-note" style={{ fontSize: "0.82rem" }}>
                A saved key for <span className="mono">{short(w.stored.publicKey, 4)}</span> is kept in this browser. This new account does <b>not</b> replace it unless you choose to keep an encrypted copy of the new key on the next step.
              </div>
            )}
            <div className="field"><label>Public address (G…) — this is your account, safe to share</label>
              <KeyBlock value={acct.publicKey} testid="new-address" />
              <div className="row" style={{ marginTop: 6 }}><Copy text={acct.publicKey} label="Copy address" /></div>
            </div>
            <div className="secret-panel" data-testid="secret-panel" role="alert">
              <strong>⚠ Your secret key (S…). Save it now. It is shown only here, once.</strong>
              <KeyBlock value={acct.secret} testid="secret-value" masked={!revealed} />
              <div className="row" style={{ marginTop: 6 }}>
                <button className="btn small ghost" onClick={() => setRevealed((r) => !r)} data-testid="reveal-toggle">{revealed ? "Hide" : "Reveal"}</button>
                <Copy text={acct.secret} label="Copy secret" />
              </div>
              <ul style={{ margin: "8px 0 0", paddingLeft: 18, fontSize: "0.85rem" }}>
                <li>Anyone with this key controls the account and its funds. <b>Never share it.</b> No Quasaria team member will ever ask for it.</li>
                <li><b>It cannot be recovered.</b> Quasaria never sees it. Lose it and the account is gone for good.</li>
                <li>Store it offline (password manager or paper). Don't screenshot it.</li>
              </ul>
            </div>
            <div className="row" style={{ marginBottom: 12 }}>
              <button className="btn small ghost" onClick={() => downloadText(`quasaria-${NETWORK}-${acct.publicKey.slice(0, 6)}.txt`, fileText(acct))}>⬇ Download backup file</button>
              <span className="muted" style={{ fontSize: "0.75rem" }}>Generated locally; never uploaded.</span>
            </div>
            <label className="row" style={{ gap: 8, fontSize: "0.88rem", marginBottom: 12 }}>
              <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} data-testid="saved-checkbox" /> I saved my secret key somewhere safe. I understand it cannot be recovered.
            </label>
            <div className="row">
              <button className="btn" disabled={!saved} onClick={() => { setErr(null); setStep("protect"); }}>Continue</button>
              <button className="btn ghost" onClick={() => { setAcct(null); setStep("choose"); }}>Back</button>
            </div>
          </>
        )}

        {step === "protect" && acct && (
          <>
            <p style={{ marginTop: 0 }}>By default your key stays in memory for this tab only (session-only). Optionally keep an encrypted copy in this browser.</p>
            <PassphraseFields value={pass} onChange={setPass} />
            {w.stored && w.stored.publicKey !== acct.publicKey && (
              <div className="notice warn" style={{ fontSize: "0.8rem" }} data-testid="replace-note">
                {pass.on ? <>Saving replaces the encrypted key for <span className="mono">{short(w.stored.publicKey, 4)}</span> kept in this browser. Make sure you have that account's secret key.</> : <>The saved key for <span className="mono">{short(w.stored.publicKey, 4)}</span> stays in this browser unchanged.</>}
              </div>
            )}
            {err && <div className="notice warn">{err}</div>}
            <div className="row" style={{ marginTop: 12 }}>
              <button className="btn" disabled={busy} onClick={() => login(acct, true)}>{busy ? "Securing…" : pass.on ? "Encrypt & continue" : "Continue (session only)"}</button>
              <button className="btn ghost" onClick={() => setStep("reveal")}>Show key again</button>
            </div>
          </>
        )}

        {step === "import" && (
          <>
            <div className="risk" style={{ marginBottom: 12 }}><strong>Only paste your key on a device you trust.</strong> It stays in this browser and is never sent anywhere.</div>
            <div className="field"><label>Secret key (S…)</label>
              <input className="input mono secret-value" type="password" autoComplete="off" spellCheck={false} value={importText} onChange={(e) => setImportText(e.target.value.trim())} placeholder="S…" data-testid="paste-secret" />
            </div>
            {importText && !isValidSecret(importText) && <div className="notice warn">Not a valid Stellar secret key.</div>}
            <PassphraseFields value={pass} onChange={setPass} />
            {err && <div className="notice warn">{err}</div>}
            <div className="row" style={{ marginTop: 12 }}>
              <button className="btn" disabled={busy || !isValidSecret(importText)} onClick={() => { try { login(importSecret(importText), false); } catch (x) { setErr((x as Error).message); } }}>Sign in</button>
              <button className="btn ghost" onClick={() => setStep("choose")}>Back</button>
            </div>
          </>
        )}

        {step === "unlock" && w.stored && (
          <>
            <p>Encrypted key in this browser: <span className="mono">{short(w.stored.publicKey, 6)}</span></p>
            <div className="field"><label>Passphrase</label><input className="input" type="password" autoComplete="current-password" value={unlockPw} onChange={(e) => setUnlockPw(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (document.getElementById("unlock-btn") as HTMLButtonElement | null)?.click()} /></div>
            {err && <div className="notice warn">{err}</div>}
            <div className="row" style={{ flexWrap: "wrap" }} data-testid="unlock-actions">
              <button id="unlock-btn" className="btn" disabled={busy || !unlockPw} onClick={async () => {
                setBusy(true); setErr(null);
                try { await w.unlockStored(unlockPw); setUnlockPw(""); close(); } catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
              }}>{busy ? "Unlocking…" : "Unlock"}</button>
              <button className="btn ghost" onClick={() => { setErr(null); setStep("choose"); }} data-testid="unlock-other">Use a different account / Create new</button>
              <button className="btn ghost neg" data-testid="forget-saved" onClick={() => { if (window.confirm("Forget the saved key? The encrypted copy is deleted from this browser. It cannot be recovered without its secret key (S…), so make sure you saved it.")) { w.forgetKey(); setStep("choose"); } }}>Forget saved key</button>
            </div>
          </>
        )}

        {step === "fund" && addrForFund && (
          <div data-testid="fund-screen">
            <p style={{ marginTop: 0 }}>You're signed in. Your account is the address below:</p>
            <div className="row" style={{ alignItems: "flex-start", gap: 16, flexWrap: "wrap" }}>
              <QrCode value={addrForFund} label="QR code of your Stellar address" />
              <div style={{ flex: 1, minWidth: 220 }}>
                <div className="field"><label>Your address (G…)</label>
                  <KeyBlock value={addrForFund} testid="fund-address" /><div className="row" style={{ marginTop: 6 }}><Copy text={addrForFund} label="Copy address" /></div>
                </div>
                <p className="muted" style={{ fontSize: "0.8rem" }}>
                  Status: {w.funded === true ? <b className="pos">on the ledger ✦ ready to use</b> : w.funded === false ? <b className="neg">not on the ledger yet. It is created by the first XLM sent to it</b> : "checking…"}
                </p>
                {NETWORK === "testnet" ? (
                  <>
                    {fund && <div className="notice" style={{ fontSize: "0.8rem" }}>{fund}</div>}
                    {w.funded === false && <button className="btn small" onClick={() => { setFund("Funding with Friendbot (testnet)…"); fundWithFriendbot(addrForFund).then(() => { setFund("Funded by Friendbot ✦"); w.refreshFunded(); }).catch((x) => setFund(`Friendbot failed: ${(x as Error).message}`)); }}>Fund with Friendbot (testnet)</button>}
                  </>
                ) : null}
                <p className="muted" style={{ fontSize: "0.78rem" }}>Send at least 2 XLM to open the account (1 XLM base reserve, plus 0.5 XLM for each trustline or offer you add). Only send XLM or Stellar assets to this address.</p>
              </div>
            </div>
            <div className="row" style={{ marginTop: 12 }}><button className="btn" onClick={close}>Done</button></div>
            <ul className="muted" style={{ fontSize: "0.82rem", paddingLeft: 18 }}>
              <li>Transactions are signed locally in this tab with your key.</li>
              <li>{w.stored?.publicKey === addrForFund ? "An encrypted copy is kept in this browser. “Forget this key” in the account menu deletes it." : "Session-only: closing or reloading the tab signs you out. Paste your secret to sign in again."}</li>
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
