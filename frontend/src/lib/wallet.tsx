/**
 * Freighter wallet integration. The app works read-only (demo) without a
 * wallet; connecting enables signing on TESTNET.
 */
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { getAddress, getNetworkDetails, isConnected, requestAccess, signTransaction } from "@stellar/freighter-api";
import { NETWORK_PASSPHRASE } from "./config";

type WalletState = {
  address: string | null;
  available: boolean;
  wrongNetwork: boolean;
  connecting: boolean;
  error: string | null;
  connect: () => Promise<void>;
  disconnect: () => void;
  sign: (xdr: string) => Promise<string>;
};

const Ctx = createContext<WalletState | null>(null);

export function WalletProvider({ children }: { children: ReactNode }) {
  const [address, setAddress] = useState<string | null>(null);
  const [available, setAvailable] = useState(false);
  const [wrongNetwork, setWrongNetwork] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    isConnected()
      .then((r) => alive && setAvailable(Boolean(r.isConnected)))
      .catch(() => alive && setAvailable(false));
    return () => {
      alive = false;
    };
  }, []);

  const checkNetwork = useCallback(async () => {
    try {
      const n = await getNetworkDetails();
      setWrongNetwork(Boolean(n.networkPassphrase) && n.networkPassphrase !== NETWORK_PASSPHRASE);
    } catch {
      /* ignore */
    }
  }, []);

  const connect = useCallback(async () => {
    setConnecting(true);
    setError(null);
    try {
      const c = await isConnected();
      if (!c.isConnected) {
        setError("Freighter not detected — install it from freighter.app and switch it to TESTNET.");
        return;
      }
      const r = await requestAccess();
      if (r.error) throw new Error(String(r.error.message ?? r.error));
      const a = r.address || (await getAddress()).address;
      setAddress(a);
      await checkNetwork();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setConnecting(false);
    }
  }, [checkNetwork]);

  const sign = useCallback(
    async (xdr: string) => {
      if (!address) throw new Error("Connect a wallet first");
      const r = await signTransaction(xdr, { networkPassphrase: NETWORK_PASSPHRASE, address });
      if (r.error) throw new Error(String(r.error.message ?? r.error));
      return r.signedTxXdr;
    },
    [address],
  );

  return (
    <Ctx.Provider value={{ address, available, wrongNetwork, connecting, error, connect, disconnect: () => setAddress(null), sign }}>
      {children}
    </Ctx.Provider>
  );
}

export function useWallet() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useWallet outside provider");
  return v;
}
