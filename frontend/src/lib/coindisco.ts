/**
 * Coindisco on-ramp aggregator widget (the approach StellarTerm ships). Coindisco bundles several card providers;
 * the provider handles payment, KYC and delivery. Quasaria runs no backend for it and never touches funds or card data.
 *
 * Embedding needs a *publishable* widget key from a Coindisco business account (pk_test_ = sandbox, pk_prod_ = live)
 * with this site's origin on its allowed-origins list. It is read from VITE_COINDISCO_PUBLIC_KEY (a public value,
 * not a secret). With no key the Buy page shows "Card purchase coming soon". Never paste another site's key here.
 * Params: https://coindisco.gitbook.io/coindisco/business-integration-guide/business/overview/configuration-parameters
 */
export const COINDISCO_ORIGIN = "https://widget.coindisco.com";
export const COINDISCO_KEY_RE = /^pk_(test|prod)_[A-Za-z0-9]{8,}$/;

export function coindiscoKey(raw: unknown = import.meta.env.VITE_COINDISCO_PUBLIC_KEY): string | null {
  const k = typeof raw === "string" ? raw.trim() : "";
  return COINDISCO_KEY_RE.test(k) ? k : null;
}

export type BuyAsset = "xlm" | "usdc";
/** Coindisco identifiers for Stellar assets (as used by StellarTerm's live links: crypto=xlm|usdc&network=stellar). */
export const BUY_ASSETS: Record<BuyAsset, { label: string; asset: string; network: string }> = {
  xlm: { label: "XLM", asset: "xlm", network: "stellar" },
  usdc: { label: "USDC (Stellar)", asset: "usdc", network: "stellar" },
};

/** Frost-theme colours (hex without #). */
const THEME = { theme: "dark", borders: "soft", backgroundColor: "0B1220", backgroundCard: "111A2C", borderColor: "2A3A55", buttonBackground: "C9D8EF", invertTextColor: "0B1220", textColor: "EEF3FA", secondTextColor: "9FB0C8", iconsColor: "C9D8EF", focusColor: "8FB4E6", hoverColor: "1A2740" };

/**
 * Widget URL. The address is pre-filled only on mainnet: card purchases deliver mainnet assets, so a testnet
 * preview never pre-fills (the user would otherwise think the purchase shows up here).
 */
export function coindiscoUrl(o: { key: string; asset: BuyAsset; address?: string | null; network: "testnet" | "mainnet" }): string {
  const a = BUY_ASSETS[o.asset];
  const p = new URLSearchParams({ publicKey: o.key, operationMode: "buy", defaultAsset: a.asset, defaultNetwork: a.network, defaultFiat: "USD", ...THEME });
  if (o.network === "mainnet" && o.address && /^G[A-Z2-7]{55}$/.test(o.address)) p.set("wallets", `stellar:${o.address}`);
  return `${COINDISCO_ORIGIN}/?${p.toString()}`;
}

/** Only what the hosted checkout needs: scripts + its own storage, forms, provider popups/redirects on a user click. */
export const IFRAME_SANDBOX = "allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-top-navigation-by-user-activation";
/** Clipboard (copy order IDs), payment (Apple/Google Pay), camera (provider ID checks). */
export const IFRAME_ALLOW = "clipboard-write; payment; camera";

export const BUY_WIDGET_DISCLOSURE =
  "Card purchases are handled by Coindisco and the third-party provider you pick there. They handle payment and ID checks under their own terms and fees. Quasaria never touches your funds or card data.";
export const COMING_SOON_LINE = "Card purchases through our partner widget are coming soon. Use the links below for now.";
