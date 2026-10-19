/**
 * One place that says which network the site is running on, so the About page (and anything else that wants a status line)
 * follows the config instead of hard-coding words. Mainnet is "on" only when signing is enabled AND the reward issuer exists
 * for mainnet; until then the site is a testnet app (mainnet data may be browsed read-only).
 */
export type NetworkStatus = { net: "testnet" | "mainnet"; line: string };

export function networkStatus(opts: { mainnetSigning: boolean; mainnetBrowse?: boolean }): NetworkStatus {
  if (opts.mainnetSigning) return { net: "mainnet", line: "Currently running on mainnet. Transactions are real; you sign each one with your own key." };
  return {
    net: "testnet",
    line: `Currently running on testnet. Testnet XLM and tokens have no value. Mainnet is not switched on yet${opts.mainnetBrowse ? " (mainnet data is read-only)" : ""}.`,
  };
}
