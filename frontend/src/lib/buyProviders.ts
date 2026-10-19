/** Plain outbound links to third-party XLM purchase pages (checked 2026-10-18). Nothing is embedded or sent anywhere. */
export const BUY_PROVIDERS = [
  { id: "coinbase", name: "Coinbase", url: "https://www.coinbase.com/price/stellar" },
  { id: "kraken", name: "Kraken", url: "https://www.kraken.com/buy/xlm" },
  { id: "moonpay", name: "MoonPay", url: "https://www.moonpay.com/buy/xlm" },
] as const;

export const BUY_NOTE = "These are third-party sites, not affiliated with Quasaria. Check their fees, limits, availability in your country and ID checks before you buy.";
