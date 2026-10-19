/**
 * The ONE place that builds explorer links. Quasaria links to StellarChain.io only (no other explorer).
 * Verified against live pages: https://stellarchain.io/transactions/<hash> and
 * https://testnet.stellarchain.io/transactions/<hash> (also /accounts/<G…> and /assets/<CODE-ISSUER>)
 * all load; testnet has its own subdomain.
 */
export type ExplorerNet = "testnet" | "mainnet";

export const EXPLORER_HOST: Record<ExplorerNet, string> = {
  mainnet: "https://stellarchain.io",
  testnet: "https://testnet.stellarchain.io",
};

const TX_HASH = /^[0-9a-f]{64}$/i;
const G_KEY = /^G[A-Z2-7]{55}$/;

export const explorerTxUrl = (hash: string, net: ExplorerNet = "testnet"): string | null =>
  TX_HASH.test(hash.trim()) ? `${EXPLORER_HOST[net]}/transactions/${hash.trim().toLowerCase()}` : null;

export const explorerAccountUrl = (account: string, net: ExplorerNet = "testnet"): string | null =>
  G_KEY.test(account.trim()) ? `${EXPLORER_HOST[net]}/accounts/${account.trim()}` : null;

/** Asset page: `/assets/XLM` for native, otherwise `/assets/CODE-ISSUER`. */
export const explorerAssetUrl = (code: string, issuer: string | null | undefined, net: ExplorerNet = "testnet"): string | null => {
  if (!issuer) return code === "XLM" ? `${EXPLORER_HOST[net]}/assets/XLM` : null;
  return G_KEY.test(issuer) && /^[A-Za-z0-9]{1,12}$/.test(code) ? `${EXPLORER_HOST[net]}/assets/${code}-${issuer}` : null;
};
