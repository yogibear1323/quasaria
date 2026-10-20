/** Plain outbound links to third-party XLM purchase pages (checked 2026-10-18). Nothing is embedded or sent anywhere. */
export const BUY_PROVIDERS = [
  { id: "coinbase", name: "Coinbase", url: "https://www.coinbase.com/price/stellar" },
  { id: "kraken", name: "Kraken", url: "https://www.kraken.com/buy/xlm" },
] as const;

export const BUY_NOTE = "These are third-party sites, not affiliated with Quasaria. Check their fees, limits, availability in your country and ID checks before you buy.";

/** StellarTerm's public Buy crypto page (verified 2026-10-19). Its URL takes crypto + network only; no address parameter. */
export const STELLARTERM_BUY_XLM_URL = "https://stellarterm.com/buy-crypto?crypto=xlm&network=stellar";
export const STELLARTERM_BUY_USDC_URL = "https://stellarterm.com/buy-crypto?crypto=usdc&network=stellar";
export const STELLARTERM_DISCLOSURE = "StellarTerm is a third-party site, not affiliated with Quasaria. StellarTerm and the card provider you pick there handle payment and ID checks under their own terms and fees. Quasaria never touches your funds or card data.";
