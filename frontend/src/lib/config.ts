import { Networks } from "@stellar/stellar-sdk";
import deployment from "../config/testnet.json";

/**
 * Quasaria runtime config. TESTNET is the only supported network.
 * Contract IDs come from the committed public deployment file
 * (src/config/testnet.json, written by scripts/deploy-testnet.sh); any
 * VITE_* env var overrides it.
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

const list = (v?: string) => (v ? v.split(",").map((s) => s.trim()).filter(Boolean) : []);
const d = deployment.contracts;

export const CONTRACTS = {
  qfx: (env.VITE_QFX_ID as string) || d.qfx,
  router: (env.VITE_ROUTER_ID as string) || d.router,
  pools: list(env.VITE_POOL_IDS as string).length ? list(env.VITE_POOL_IDS as string) : [d.poolXlmQusd, d.poolQfxQusd],
  staking: (env.VITE_STAKING_ID as string) || d.staking,
  referral: (env.VITE_REFERRAL_ID as string) || d.referral,
  vault: (env.VITE_VAULT_ID as string) || d.vault,
  oracle: (env.VITE_ORACLE_ID as string) || d.oracle,
  xlmSac: d.xlmSac,
  qusdSac: d.qusdSac,
};

/** Offline demo mode (no network calls at all) — used for CI / offline screenshots. */
export const OFFLINE_DEMO = (env.VITE_OFFLINE_DEMO as string) === "1";

/** True when contract IDs are configured and we may read the chain. */
export const CONTRACTS_CONFIGURED = Boolean(CONTRACTS.router && CONTRACTS.qfx) && !OFFLINE_DEMO;

/** Public seeded accounts shown in read-only mode (no secrets, testnet only). */
export const DEMO_ACCOUNTS = {
  /** Seeded trader: holds QFX, stakes, has leveraged positions, was referred. */
  trader: (deployment as { demoTrader?: string }).demoTrader ?? "",
  /** Deployer/admin: the seeded LP and the trader's referrer. */
  lp: deployment.admin,
};

/** Symbol lookup for known token contracts. */
export const TOKEN_SYMBOLS: Record<string, string> = {
  [d.xlmSac]: "XLM",
  [d.qusdSac]: "QUSD",
  [d.qfx]: "QFX",
  [d.poolXlmQusd]: "QLP XLM/QUSD",
  [d.poolQfxQusd]: "QLP QFX/QUSD",
};
export const symbolOf = (id: string) => TOKEN_SYMBOLS[id] ?? `${id.slice(0, 4)}…${id.slice(-4)}`;

export const DEPLOYMENT = deployment;
export const expertContract = (id: string) => `https://stellar.expert/explorer/testnet/contract/${id}`;
export const expertAccount = (id: string) => `https://stellar.expert/explorer/testnet/account/${id}`;

/** Circle's testnet USDC issuer (classic asset on testnet). */
export const TESTNET_USDC_ISSUER = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
export const QUSD_ASSET = (env.VITE_QUSD_ASSET as string) || deployment.assets.QUSD;
