import { useMemo, useState } from "react";
import { useWallet } from "../lib/wallet";
import { backupChallenge, challengeLabel, checkBackup, downloadText, fundWithFriendbot, generateAccount, importSecret, isValidSecret, MIN_PASSWORD, type NewAccount } from "../lib/keys";
import { NETWORK } from "../lib/config";
import { short } from "../lib/format";

type Step = "choose" | "reveal" | "verify" | "protect" | "import" | "unlock" | "done";

function Copy({ text, label = "Copy" }: { text: string; label?: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button className="btn small ghost" onClick={async () => {
      try {
        await navigator.clipboard.writeText(text);
        setOk(true);
        setTimeout(() => setOk(false), 1500);
      } catch {
        /* clipboard blocked */
      }
    }}>{ok ? "Copied ✦" : label}</button>
  );
}

/** Password + confirm, optional ("remember on this device"). */
function RememberFields({ value, onChange }: { value: { on: boolean; pw: string; pw2: string }; onChange: (v: { on: boolean; pw: string; pw2: string }) => void }) {
  return (
    <div className="card" style={{ padding: 14, marginTop: 10 }}>
      <label className="row" style={{ gap: 8, fontSize: "0.9rem" }}>
        <input type="checkbox" checked={value.on} onChange={(e) => onChange({ ...value, on: e.target.checked })} />
        Remember this key on this device (encrypted with a password)
      </label>
      {value.on && (
        <div className="grid g-2" style={{ marginTop: 10 }}>
          <div className="field"><label>Password (min {MIN_PASSWORD})</label><input className="input" type="password" autoComplete="new-password" value={value.pw} onChange={(e) => onChange({ ...value, pw: e.target.value })} /></div>
          <div className="field"><label>Confirm password</label><input className="input" type="password" autoComplete="new-password" value={value.pw2} onChange={(e) => onChange({ ...value, pw2: e.target.value })} /></div>
        </div>
      )}
      <p className="muted" style={{ fontSize: "0.75rem", margin: "6px 0 0" }}>
        Off by default: the key lives in memory and is gone when you close the tab. If on, it is encrypted in your browser (PBKDF2-SHA256, 600k iterations → AES-256-GCM) and stored only in this browser's localStorage. Anyone with your password and this device could unlock it.
      </p>
    </div>
  );
}

const rememberError = (r: { on: boolean; pw: string; pw2: string }) =>
  !r.on ? null : r.pw.length < MIN_PASSWORD ? `Password must be at least ${MIN_PASSWORD} characters.` : r.pw !== r.pw2 ? "Passwords do not match." : null;

export default function AccountModal() {
  const w = useWallet();
  const [step, setStep] = useState<Step>(w.stored ? "unlock" : "choose");
  const [acct, setAcct] = useState<NewAccount | null>(null);
  const [saved, setSaved] = useState(false);
  const [answer, setAnswer] = useState("");
  const [remember, setRemember] = useState({ on: false, pw: "", pw2: "" });
  const [importText, setImportText] = useState("");
  const [unlockPw, setUnlockPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [fund, setFund] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(true);
  const challenge = useMemo(() => backupChallenge(), [acct?.secret]); // eslint-disable-line react-hooks/exhaustive-deps

  const close = () => {
    setAcct(null);
    setImportText("");
    w.closeModal();
  };

  const finish = async (a: NewAccount, isNew: boolean) => {
    const e = rememberError(remember);
    if (e) return setErr(e);
    setBusy(true);
    setErr(null);
    try {
      await w.loginWithSecret(a.secret, remember.on ? remember.pw : undefined);
      setStep("done");
      setAcct({ publicKey: a.publicKey, secret: "" }); // keep only the address for the summary
      setImportText("");
      if (NETWORK === "testnet" && isNew) {
        setFund("Funding with Friendbot (testnet)…");
        fundWithFriendbot(a.publicKey)
          .then((r) => setFund(r.alreadyFunded ? "Already funded." : "Funded with 10,000 test XLM by Friendbot ✦"))
          .catch((x) => setFund(`Friendbot failed: ${(x as Error).message}. You can retry from friendbot.stellar.org.`));
      }
    } catch (x) {
      setErr((x as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const fileText = (a: NewAccount) =>
    `Quasaria — Stellar ${NETWORK.toUpperCase()} account backup\nCreated: ${new Date().toISOString()}\n\nPublic address (safe to share):\n${a.publicKey}\n\nSECRET KEY (never share, anyone with it controls the account):\n${a.secret}\n\nQuasaria cannot recover this key. Keep this file offline.\n`;

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Account" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="card glow modal">
        <div className="row between" style={{ marginBottom: 8 }}>
          <h2 style={{ margin: 0 }}>{step === "choose" ? "Get started" : step === "import" ? "Import secret key" : step === "unlock" ? "Unlock saved key" : step === "done" ? "You're in" : "Create account"}</h2>
          <button className="btn small ghost" onClick={close} aria-label="Close">✕</button>
        </div>
        <p className="muted" style={{ fontSize: "0.8rem", marginTop: 0 }}>Non-custodial: keys are created and used only in this browser. No server, no account database, no key logging. We cannot see, reset or recover your key.</p>

        {step === "choose" && (
          <div className="grid" style={{ gap: 10 }}>
            <button className="btn block" onClick={() => { setAcct(generateAccount()); setSaved(false); setRevealed(true); setStep("reveal"); }}>✦ Create a new account</button>
            <button className="btn block ghost" onClick={() => setStep("import")}>Import a secret key (S…)</button>
            <button className="btn block ghost" disabled={w.connecting} onClick={w.connect}>{w.connecting ? "Connecting…" : "Use Freighter extension"}</button>
            {w.stored && <button className="btn block ghost" onClick={() => setStep("unlock")}>Unlock key saved on this device ({short(w.stored.publicKey, 4)})</button>}
            {w.error && <div className="notice warn">{w.error}</div>}
            <div className="notice" style={{ fontSize: "0.78rem" }}>On testnet, new accounts are funded automatically by Friendbot. <b>On mainnet</b> a new address does not exist on the ledger until someone sends it the minimum balance (currently 1 XLM base reserve, plus 0.5 XLM per trustline/offer) — there is no Friendbot.</div>
          </div>
        )}

        {step === "reveal" && acct && (
          <>
            <div className="risk" role="alert" style={{ marginBottom: 12 }}>
              <strong>⚠ Save your secret key now — it is shown only here.</strong>
              <ul style={{ margin: "6px 0 0", paddingLeft: 18, fontSize: "0.85rem" }}>
                <li>Anyone with this key controls the account and its funds. <b>Never share it</b> — no Quasaria team member will ever ask for it.</li>
                <li>We cannot recover it. Lose it and the account is gone for good.</li>
                <li>Store it offline (password manager or paper). Don't screenshot it.</li>
              </ul>
            </div>
            <div className="field"><label>Public address (G…) — safe to share</label>
              <div className="row"><input className="input mono" readOnly value={acct.publicKey} /><Copy text={acct.publicKey} /></div>
            </div>
            <div className="field"><label>Secret key (S…) — keep private</label>
              <div className="row">
                <input className="input mono secret-value" readOnly type={revealed ? "text" : "password"} value={acct.secret} autoComplete="off" spellCheck={false} />
                <button className="btn small ghost" onClick={() => setRevealed((r) => !r)}>{revealed ? "Hide" : "Show"}</button>
                <Copy text={acct.secret} />
              </div>
            </div>
            <div className="row" style={{ marginBottom: 12 }}>
              <button className="btn small ghost" onClick={() => downloadText(`quasaria-${NETWORK}-${acct.publicKey.slice(0, 6)}.txt`, fileText(acct))}>⬇ Download backup file</button>
              <span className="muted" style={{ fontSize: "0.75rem" }}>Generated locally; never uploaded.</span>
            </div>
            <label className="row" style={{ gap: 8, fontSize: "0.88rem", marginBottom: 12 }}>
              <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} /> I have saved my secret key somewhere safe and understand it cannot be recovered.
            </label>
            <div className="row">
              <button className="btn" disabled={!saved} onClick={() => { setAnswer(""); setErr(null); setStep("verify"); }}>Continue</button>
              <button className="btn ghost" onClick={() => { setAcct(null); setStep("choose"); }}>Back</button>
            </div>
          </>
        )}

        {step === "verify" && acct && (
          <>
            <p>Backup check: type <b>{challengeLabel(challenge)}</b> of your secret key (counting the leading S as character 1).</p>
            <div className="field"><label>{challenge.length} characters</label>
              <input className="input mono secret-value" autoFocus maxLength={challenge.length} value={answer} onChange={(e) => setAnswer(e.target.value.toUpperCase())} autoComplete="off" spellCheck={false} />
            </div>
            {answer.length === challenge.length && !checkBackup(acct.secret, challenge, answer) && <div className="notice warn">That doesn't match. Check your backup.</div>}
            <RememberFields value={remember} onChange={setRemember} />
            {err && <div className="notice warn">{err}</div>}
            <div className="row" style={{ marginTop: 12 }}>
              <button className="btn" disabled={busy || !checkBackup(acct.secret, challenge, answer)} onClick={() => finish(acct, true)}>{busy ? "Securing…" : "Finish & fund on testnet"}</button>
              <button className="btn ghost" onClick={() => setStep("reveal")}>Show key again</button>
            </div>
          </>
        )}

        {step === "import" && (
          <>
            <div className="risk" style={{ marginBottom: 12 }}><strong>Only import keys on a device you trust.</strong> The key stays in this browser and is never sent anywhere.</div>
            <div className="field"><label>Secret key (S…)</label>
              <input className="input mono secret-value" type="password" autoComplete="off" spellCheck={false} value={importText} onChange={(e) => setImportText(e.target.value.trim())} placeholder="S…" />
            </div>
            {importText && !isValidSecret(importText) && <div className="notice warn">Not a valid Stellar secret key.</div>}
            <RememberFields value={remember} onChange={setRemember} />
            {err && <div className="notice warn">{err}</div>}
            <div className="row" style={{ marginTop: 12 }}>
              <button className="btn" disabled={busy || !isValidSecret(importText)} onClick={() => { try { finish(importSecret(importText), false); } catch (x) { setErr((x as Error).message); } }}>Import</button>
              <button className="btn ghost" onClick={() => setStep("choose")}>Back</button>
            </div>
          </>
        )}

        {step === "unlock" && w.stored && (
          <>
            <p>Saved on this device: <span className="mono">{short(w.stored.publicKey, 6)}</span></p>
            <div className="field"><label>Password</label><input className="input" type="password" autoComplete="current-password" value={unlockPw} onChange={(e) => setUnlockPw(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (document.getElementById("unlock-btn") as HTMLButtonElement | null)?.click()} /></div>
            {err && <div className="notice warn">{err}</div>}
            <div className="row">
              <button id="unlock-btn" className="btn" disabled={busy || !unlockPw} onClick={async () => {
                setBusy(true);
                setErr(null);
                try {
                  await w.unlockStored(unlockPw);
                  setUnlockPw("");
                  close();
                } catch (x) {
                  setErr((x as Error).message);
                } finally {
                  setBusy(false);
                }
              }}>{busy ? "Unlocking…" : "Unlock"}</button>
              <button className="btn ghost" onClick={() => setStep("choose")}>Other options</button>
              <button className="btn ghost neg" onClick={() => { if (window.confirm("Remove the encrypted key from this device? Make sure you have your secret key backed up.")) { w.forgetDevice(); setStep("choose"); } }}>Forget this device</button>
            </div>
          </>
        )}

        {step === "done" && acct && (
          <>
            <p>Signed in with an in-app key. Address: <span className="mono">{acct.publicKey}</span> <Copy text={acct.publicKey} /></p>
            {fund && <div className="notice">{fund}</div>}
            <ul className="muted" style={{ fontSize: "0.85rem", paddingLeft: 18 }}>
              <li>Transactions are signed locally in this tab — same flow as Freighter.</li>
              <li>{w.stored?.publicKey === acct.publicKey ? "Encrypted copy saved on this device. Use “Forget this device” in the account menu to remove it." : "Key kept in memory only: closing or reloading the tab signs you out."}</li>
              <li>On mainnet the account would need at least the minimum XLM balance before it exists on the ledger.</li>
            </ul>
            <button className="btn" onClick={close}>Start trading</button>
          </>
        )}
      </div>
    </div>
  );
}
