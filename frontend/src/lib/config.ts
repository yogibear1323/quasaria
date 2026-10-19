import { Networks } from "@stellar/stellar-sdk";
import deployment from "../config/testnet.json";

/**
 * Quasaria runtime config. TESTNET is the only network that can sign.
 * Quasaria is ledger-native: order-book swaps, native liquidity pools and plain-payment rewards.
 * There are no Quasaria smart contracts on the site. The committed deployment file only supplies the
 * testnet Horizon URL and passphrase check.
 */
const env = import.meta.env;

export const NETWORK = "testnet" as const;
export const NETWORK_PASSPHRASE = Networks.TESTNET;
export const HORIZON_URL = (env.VITE_HORIZON_URL as string) || deployment.horizonUrl || "https://horizon-testnet.stellar.org";
export const RPC_URL = (env.VITE_RPC_URL as string) || deployment.rpcUrl || "https://soroban-testnet.stellar.org";

if (deployment.networkPassphrase !== Networks.TESTNET || (env.VITE_NETWORK && env.VITE_NETWORK !== "testnet")) {
  // Hard stop: this scaffold must never talk to mainnet.
  throw new Error("Quasaria scaffold is TESTNET ONLY.");
}

/** Offline demo mode (no network calls at all) — used for CI / offline screenshots. */
export const OFFLINE_DEMO = (env.VITE_OFFLINE_DEMO as string) === "1";

/** Circle's testnet USDC issuer (classic asset on testnet). */
export const TESTNET_USDC_ISSUER = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
