import { Networks } from "@stellar/stellar-sdk";
import deployment from "../config/testnet.json";

/**
 * Quasaria runtime config. TESTNET is the only supported network.
 * Contract IDs come from the committed public deployment file
 * (src/config/testnet.json, written by scripts/deploy-testnet.sh); any
 * VITE_* env var overrides it.
 */
const env = import.meta.env;

/**
 * Active network, chosen at build time by VITE_NETWORK ("mainnet" | "testnet").
 * The Pages deploy builds with VITE_NETWORK=mainnet (go-live 2026-10-19). Local
 * dev and tests default to testnet.
 */
export const NETWORK: "testnet" | "mainnet" = env.VITE_NETWORK === "mainnet" ? "mainnet" : "testnet";
export const IS_MAINNET = NETWORK === "mainnet";
export const NETWORK_PASSPHRASE = IS_MAINNET ? Networks.PUBLIC : Networks.TESTNET;
export const NETWORK_LABEL = IS_MAINNET ? "Mainnet" : "Testnet";
export const HORIZON_URL = (env.VITE_HORIZON_URL as string) || (IS_MAINNET ? "https://horizon.stellar.org" : deployment.horizonUrl || "https://horizon-testnet.stellar.org");
export const RPC_URL = (env.VITE_RPC_URL as string) || (IS_MAINNET ? "" : deployment.rpcUrl || "https://soroban-testnet.stellar.org");

if (!IS_MAINNET && deployment.networkPassphrase !== Networks.TESTNET) {
  throw new Error("Testnet build pointed at a non-testnet deployment file.");
}

const list = (v?: string) => (v ? v.split(",").map((s) => s.trim()).filter(Boolean) : []);
const d = deployment.contracts;

export const CONTRACTS = {
  qfx: (env.VITE_QFX_ID as string) || d.qfx,
  router: (env.VITE_ROUTER_ID as string) || d.router,
  pools: list(env.VITE_POOL_IDS as string).length ? list(env.VITE_POOL_IDS as string) : [d.poolXlmQusd, d.poolQfxQusd],
  staking: (env.VITE_STAKING_ID as string) || d.staking,
  referral: (env.VITE_REFERRAL_ID as string) || d.referral,
  oracle: (env.VITE_ORACLE_ID as string) || d.oracle,
  xlmSac: d.xlmSac,
  qusdSac: d.qusdSac,
};


/** Offline demo mode (no network calls at all) — used for CI / offline screenshots. */
export const OFFLINE_DEMO = (env.VITE_OFFLINE_DEMO as string) === "1";

/** True when contract IDs are configured and we may read the chain. */
/** The Soroban contracts (QFX, router, ...) exist on testnet only, so they are never read on mainnet. */
export const CONTRACTS_CONFIGURED = !IS_MAINNET && Boolean(CONTRACTS.router && CONTRACTS.qfx) && !OFFLINE_DEMO;

/** Public seeded accounts shown in read-only mode (no secrets, testnet only). */
export const DEMO_ACCOUNTS = {
  /** Seeded trader: public seeded account. */
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

/** Circle's testnet USDC issuer (classic asset on testnet). */
export const TESTNET_USDC_ISSUER = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
/** Circle's mainnet USDC issuer (centre.io). */
export const MAINNET_USDC_ISSUER_ADDR = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
/** USDC issuer on the active network. */
export const USDC_ISSUER = IS_MAINNET ? MAINNET_USDC_ISSUER_ADDR : TESTNET_USDC_ISSUER;
export const QUSD_ASSET = (env.VITE_QUSD_ASSET as string) || deployment.assets.QUSD;
