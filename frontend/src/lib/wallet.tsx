/**
 * Wallet state for Quasaria. Two interchangeable signers:
 *   - in-app key (generated or imported in the browser, held in memory), and
 *   - the Freighter extension.
 * Both implement `Signer`, so every transaction path is identical. The app
 * works read-only without any signer.
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { getAddress, getNetworkDetails, isConnected, requestAccess } from "@stellar/freighter-api";
import { NETWORK_PASSPHRASE } from "./config";
import { FreighterSigner, LocalKeySigner, type Signer } from "./signer";
import { decryptSecret, encryptSecret, forgetStoredKey, loadStoredKey, saveStoredKey, type EncryptedKey } from "./keys";

type WalletState = {
  address: string | null;
  kind: Signer["kind"] | null;
  available: boolean;
  wrongNetwork: boolean;
  connecting: boolean;
  error: string | null;
  /** Encrypted key remembered on this device (public address only is readable). */
  stored: EncryptedKey | null;
  /** Account modal visibility (create / import / Freighter / unlock). */
  modalOpen: boolean;
  /** Open the account modal; pass "create" to jump straight into new-account creation. */
  openModal: (intent?: unknown) => void;
  modalIntent: "create" | null;
  closeModal: () => void;
  connect: () => Promise<void>;
  loginWithSecret: (secret: string, rememberWithPassword?: string) => Promise<void>;
  unlockStored: (password: string) => Promise<void>;
  forgetDevice: () => void;
  disconnect: () => void;
  sign: (xdr: string) => Promise<string>;
};

const Ctx = createContext<WalletState | null>(null);

export function WalletProvider({ children }: { children: ReactNode }) {
  const [signer, setSigner] = useState<Signer | null>(null);
  const [available, setAvailable] = useState(false);
  const [wrongNetwork, setWrongNetwork] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stored, setStored] = useState<EncryptedKey | null>(() => loadStoredKey());
  const [modalOpen, setModalOpen] = useState(false);
  const [modalIntent, setModalIntent] = useState<"create" | null>(null);
  const current = useRef<Signer | null>(null);

  const replaceSigner = useCallback((s: Signer | null) => {
    if (current.current instanceof LocalKeySigner && current.current !== s) current.current.destroy();
    current.current = s;
    setSigner(s);
  }, []);

  useEffect(() => {
    let alive = true;
    isConnected()
      .then((r) => alive && setAvailable(Boolean(r.isConnected)))
      .catch(() => alive && setAvailable(false));
    // drop in-memory key material when the tab goes away
    const onUnload = () => current.current instanceof LocalKeySigner && current.current.destroy();
    window.addEventListener("pagehide", onUnload);
    return () => {
      alive = false;
      window.removeEventListener("pagehide", onUnload);
    };
  }, []);

  const connect = useCallback(async () => {
    setConnecting(true);
    setError(null);
    try {
      const c = await isConnected();
      if (!c.isConnected) {
        setError("Freighter not detected — install it from freighter.app and switch it to TESTNET, or create an in-app account instead.");
        return;
      }
      const r = await requestAccess();
      if (r.error) throw new Error(String(r.error.message ?? r.error));
      const a = r.address || (await getAddress()).address;
      replaceSigner(new FreighterSigner(a, NETWORK_PASSPHRASE));
      try {
        const n = await getNetworkDetails();
        setWrongNetwork(Boolean(n.networkPassphrase) && n.networkPassphrase !== NETWORK_PASSPHRASE);
      } catch {
        /* ignore */
      }
      setModalOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setConnecting(false);
    }
  }, [replaceSigner]);

  const loginWithSecret = useCallback(
    async (secret: string, rememberWithPassword?: string) => {
      const s = new LocalKeySigner(secret, NETWORK_PASSPHRASE);
      if (rememberWithPassword) {
        const blob = await encryptSecret(secret, rememberWithPassword);
        saveStoredKey(blob);
        setStored(blob);
      }
      setWrongNetwork(false);
      setError(null);
      replaceSigner(s);
    },
    [replaceSigner],
  );

  const unlockStored = useCallback(
    async (password: string) => {
      const blob = loadStoredKey();
      if (!blob) throw new Error("No key is remembered on this device.");
      const secret = await decryptSecret(blob, password);
      replaceSigner(new LocalKeySigner(secret, NETWORK_PASSPHRASE));
      setError(null);
    },
    [replaceSigner],
  );

  const forgetDevice = useCallback(() => {
    forgetStoredKey();
    setStored(null);
    if (current.current?.kind === "local") replaceSigner(null);
  }, [replaceSigner]);

  const sign = useCallback(async (xdr: string) => {
    if (!current.current) throw new Error("Connect a wallet or create an account first");
    return current.current.signTransaction(xdr);
  }, []);

  return (
    <Ctx.Provider
      value={{
        address: signer?.address ?? null,
        kind: signer?.kind ?? null,
        available,
        wrongNetwork,
        connecting,
        error,
        stored,
        modalOpen,
        modalIntent,
        openModal: (intent?: unknown) => { setModalIntent(intent === "create" ? "create" : null); setModalOpen(true); },
        closeModal: () => setModalOpen(false),
        connect,
        loginWithSecret,
        unlockStored,
        forgetDevice,
        disconnect: () => replaceSigner(null),
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
