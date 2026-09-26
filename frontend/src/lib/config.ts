import { Networks } from "@stellar/stellar-sdk";

/** Quasaria runtime config. TESTNET is the only supported network. */
const env = import.meta.env;

export const NETWORK = "testnet" as const;
export const NETWORK_PASSPHRASE = Networks.TESTNET;
export const HORIZON_URL = (env.VITE_HORIZON_URL as string) || "https://horizon-testnet.stellar.org";
export const RPC_URL = (env.VITE_RPC_URL as string) || "https://soroban-testnet.stellar.org";

if ((env.VITE_NETWORK as string | undefined) && env.VITE_NETWORK !== "testnet") {
  // Hard stop: this scaffold must never talk to mainnet.
  throw new Error("Quasaria scaffold is TESTNET ONLY. Set VITE_NETWORK=testnet.");
}

const list = (v?: string) => (v ? v.split(",").map((s) => s.trim()).filter(Boolean) : []);

export const CONTRACTS = {
  qfx: (env.VITE_QFX_ID as string) || "",
  router: (env.VITE_ROUTER_ID as string) || "",
  pools: list(env.VITE_POOL_IDS as string),
  staking: (env.VITE_STAKING_ID as string) || "",
  referral: (env.VITE_REFERRAL_ID as string) || "",
  vault: (env.VITE_VAULT_ID as string) || "",
  oracle: (env.VITE_ORACLE_ID as string) || "",
};

/** True when contract IDs are configured (after scripts/deploy-testnet.sh). */
export const CONTRACTS_CONFIGURED = Boolean(CONTRACTS.router && CONTRACTS.qfx);

/** Offline demo mode (no network calls at all) — used for screenshots / CI. */
export const OFFLINE_DEMO = (env.VITE_OFFLINE_DEMO as string) === "1";

/** Circle's testnet USDC issuer (classic asset on testnet). */
export const TESTNET_USDC_ISSUER = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
export const QUSD_ASSET = (env.VITE_QUSD_ASSET as string) || "";
