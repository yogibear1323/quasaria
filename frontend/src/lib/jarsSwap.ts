/**
 * XLM → USTRY auto-swap for XLM-funded jars. A user-signed Stellar path payment (strict send) from the user to
 * themselves: Horizon picks the best SDEX + native-AMM route (typically XLM→USDC→USTRY). The tx carries a
 * minimum-received bound so it fails rather than filling worse than the slippage limit.
 * Nothing is sent without the user reviewing the quote and signing with the site's normal signer.
 */
import { Asset } from "@stellar/stellar-sdk";
import { USTRY_ASSET } from "../components/RwaHoldings";
import { clampSlippage, minReceived, type SwapQuote } from "./swap";

const [CODE, ISSUER] = USTRY_ASSET.split("-");
export const USTRY = new Asset(CODE, ISSUER);
export const USTRY_REF = { code: CODE, issuer: ISSUER };
export const JAR_DEFAULT_SLIPPAGE = 0.5;
export const JAR_MAX_SLIPPAGE = 2;
/** Refuse when the quote is this much worse than NAV-implied value (thin books / bad route). */
export const MAX_PRICE_IMPACT_PCT = 3;

export type JarSwapPlan = { ok: true; quote: SwapQuote; minOut: number; slippage: number; impactPct: number | null; expectedUsd: number | null }
  | { ok: false; error: string };

/** Pure check of a fresh quote against the slippage cap and NAV-implied value. */
export function planJarSwap(i: { quote: SwapQuote | null; slippage: number; xlmUsd: number | null; ustryUsd: number | null }): JarSwapPlan {
  if (!i.quote) return { ok: false, error: "No XLM → USTRY route right now. Try a smaller amount later." };
  if (!(i.slippage > 0) || i.slippage > JAR_MAX_SLIPPAGE) return { ok: false, error: `Slippage limit must be between 0.01% and ${JAR_MAX_SLIPPAGE}%.` };
  const s = clampSlippage(i.slippage);
  let impactPct: number | null = null, expectedUsd: number | null = null;
  if (i.xlmUsd && i.ustryUsd) {
    const inUsd = i.quote.sendAmount * i.xlmUsd;
    expectedUsd = i.quote.destAmount * i.ustryUsd;
    impactPct = ((inUsd - expectedUsd) / inUsd) * 100;
    if (impactPct > MAX_PRICE_IMPACT_PCT) return { ok: false, error: `This route would lose about ${impactPct.toFixed(1)}% versus USTRY's NAV, over the ${MAX_PRICE_IMPACT_PCT}% limit. Try a smaller amount.` };
  }
  return { ok: true, quote: i.quote, minOut: minReceived(i.quote.destAmount, s), slippage: s, impactPct, expectedUsd };
}
