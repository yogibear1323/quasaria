/**
 * Client-side mirrors of the on-chain math (for quotes / previews only; the
 * contracts are the source of truth).
 */

// ---- AMM (contracts/amm-pool)
export function ammAmountOut(amountIn: number, reserveIn: number, reserveOut: number, feeBps: number) {
  if (amountIn <= 0 || reserveIn <= 0 || reserveOut <= 0) return 0;
  const net = amountIn * (1 - feeBps / 10_000);
  return (net * reserveOut) / (reserveIn + net);
}
export function priceImpact(amountIn: number, reserveIn: number, reserveOut: number, feeBps: number) {
  const out = ammAmountOut(amountIn, reserveIn, reserveOut, feeBps);
  const spot = reserveOut / reserveIn;
  return out > 0 ? 1 - out / amountIn / spot : 0;
}

// ---- QFX holder rewards (contracts/reward-token)
export const DAY = 86_400;
export const dailyFactor = (aprBps: number) => 1 + aprBps / 10_000 / 365;
export const apyFromApr = (aprBps: number) => dailyFactor(aprBps) ** 365 - 1;
/** Balance after `days` full days of daily compounding, capped by maxSupply share. */
export function projectBalance(principal: number, aprBps: number, days: number) {
  return principal * dailyFactor(aprBps) ** Math.floor(days);
}

