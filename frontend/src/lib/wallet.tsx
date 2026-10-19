/**
 * Wallet state for Quasaria: keypair-only accounts.
 *
 * The site generates a random Ed25519 keypair in the browser; the public key IS the account and the user saves
 * the secret. Login is by pasting the secret. By default the key lives in memory for this tab only. If the user
 * sets a passphrase, an AES-GCM blob (PBKDF2-SHA256) is kept in this browser's localStorage so they can unlock
 * it next time; "Forget this key" removes it. There are no wallet extensions and no third-party connectors.
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { NETWORK_PASSPHRASE, HORIZON_URL } from "./config";
import { LocalKeySigner, type Signer } from "./signer";
import { decryptSecret, encryptSecret, forgetStoredKey, loadStoredKey, saveStoredKey, type EncryptedKey } from "./keys";

export type ModalIntent = "create" | "fund" | "unlock" | null;

type WalletState = {
  address: string | null;
  kind: Signer["kind"] | null;
  /** null = unknown/not checked, false = the address is not on the ledger yet (needs the minimum XLM), true = exists. */
  funded: boolean | null;
  error: string | null;
  /** Passphrase-encrypted key remembered in this browser (only the public address is readable). */
  stored: EncryptedKey | null;
  modalOpen: boolean;
  /** Open the account modal; "create" ALWAYS goes to new-key creation (even with a saved key), "unlock" to the saved-key unlock, "fund" to the QR / fund-address screen, none to the chooser. */
  openModal: (intent?: unknown) => void;
  modalIntent: ModalIntent;
  closeModal: () => void;
  /** Sign in with a pasted secret. With `passphrase`, also keep an encrypted copy in this browser. */
  loginWithSecret: (secret: string, passphrase?: string) => Promise<void>;
  unlockStored: (passphrase: string) => Promise<void>;
  /** "Forget this key": sign out and delete any encrypted copy from this browser. */
  forgetKey: () => void;
  /** Sign out of this tab (an encrypted copy, if you made one, stays for the next unlock). */
  disconnect: () => void;
  /** Re-check whether the account exists on the ledger. */
  refreshFunded: () => Promise<boolean | null>;
  sign: (xdr: string) => Promise<string>;
};

const Ctx = createContext<WalletState | null>(null);
/** Exposed for tests that need a specific wallet state (e.g. a saved key + "create" intent). */
export const WalletContext = Ctx;
export type { WalletState };

export async function accountExists(address: string, f: typeof fetch = fetch): Promise<boolean | null> {
  try {
    const r = await f(`${HORIZON_URL}/accounts/${address}`, { headers: { Accept: "application/json" } });
    if (r.status === 404) return false;
    return r.ok ? true : null;
  } catch {
    return null;
  }
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const [signer, setSigner] = useState<Signer | null>(null);
  const [funded, setFunded] = useState<boolean | null>(null);
  const [error] = useState<string | null>(null);
  const [stored, setStored] = useState<EncryptedKey | null>(() => loadStoredKey());
  const [modalOpen, setModalOpen] = useState(false);
  const [modalIntent, setModalIntent] = useState<ModalIntent>(null);
  const current = useRef<Signer | null>(null);

  const replaceSigner = useCallback((s: Signer | null) => {
    if (current.current instanceof LocalKeySigner && current.current !== s) current.current.destroy();
    current.current = s;
    setSigner(s);
    setFunded(null);
  }, []);

  useEffect(() => {
    // drop in-memory key material when the tab goes away
    const onUnload = () => current.current instanceof LocalKeySigner && current.current.destroy();
    window.addEventListener("pagehide", onUnload);
    return () => window.removeEventListener("pagehide", onUnload);
  }, []);

  const address = signer?.address ?? null;
  const refreshFunded = useCallback(async () => {
    if (!address) return null;
    const ok = await accountExists(address);
    if (current.current?.address === address) setFunded(ok);
    return ok;
  }, [address]);

  // While signed in with an unfunded account, poll until it appears on the ledger.
  useEffect(() => {
    if (!address) return;
    let alive = true;
    const tick = async () => { const ok = await accountExists(address); if (alive) setFunded(ok); return ok; };
    tick();
    const t = setInterval(async () => { if ((await tick()) === true) clearInterval(t); }, 8000);
    return () => { alive = false; clearInterval(t); };
  }, [address]);

  const loginWithSecret = useCallback(
    async (secret: string, passphrase?: string) => {
      const s = new LocalKeySigner(secret.trim(), NETWORK_PASSPHRASE);
      if (passphrase) {
        const blob = await encryptSecret(secret.trim(), passphrase);
        saveStoredKey(blob);
        setStored(blob);
      }
      replaceSigner(s);
    },
    [replaceSigner],
  );

  const unlockStored = useCallback(
    async (passphrase: string) => {
      const blob = loadStoredKey();
      if (!blob) throw new Error("No encrypted key is kept in this browser.");
      const secret = await decryptSecret(blob, passphrase);
      replaceSigner(new LocalKeySigner(secret, NETWORK_PASSPHRASE));
    },
    [replaceSigner],
  );

  const forgetKey = useCallback(() => {
    forgetStoredKey();
    setStored(null);
    replaceSigner(null);
  }, [replaceSigner]);

  const sign = useCallback(async (xdr: string) => {
    if (!current.current) throw new Error("Sign in with your key (or create one) first");
    return current.current.signTransaction(xdr);
  }, []);

  return (
    <Ctx.Provider
      value={{
        address,
        kind: signer?.kind ?? null,
        funded,
        error,
        stored,
        modalOpen,
        modalIntent,
        openModal: (intent?: unknown) => { setModalIntent(intent === "create" || intent === "fund" || intent === "unlock" ? intent : null); setModalOpen(true); },
        closeModal: () => setModalOpen(false),
        loginWithSecret,
        unlockStored,
        forgetKey,
        disconnect: () => replaceSigner(null),
        refreshFunded,
        sign,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useWallet() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useWallet outside provider");
  return v;
}
