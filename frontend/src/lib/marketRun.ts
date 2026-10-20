/** Orchestration for a market order: submit the crossing offer, read what filled, then ALWAYS cancel any remainder. Dependencies are injected so it is unit-testable. */
import { Asset } from "@stellar/stellar-sdk";
import type { FeeLine } from "./fees";
import { buildCancelRemainderTx, buildMarketTx, describeOutcome, parseOfferResult, plainTxError, type MarketPlan, type OfferResult, type Outcome, type Side } from "./market";

export type OpenOffer = { id: string; selling: Asset; buying: Asset; price: number };
export type MarketDeps = {
  sequence: () => Promise<string>;                       // current sequence number of the source account
  sign: (xdr: string) => Promise<string>;
  submit: (signedXdr: string) => Promise<{ hash: string; result_xdr: string }>;
  openOffers: () => Promise<OpenOffer[]>;                // the account's resting offers right now
};
export type MarketRun = { hash: string; result: OfferResult | null; outcome: Outcome; cancelHash: string | null; warning: string | null };

const sameAsset = (a: Asset, b: Asset) => a.equals(b);

export async function executeMarket(i: { address: string; side: Side; base: Asset; quote: Asset; baseCode: string; quoteCode: string; plan: Extract<MarketPlan, { ok: true }>; needTrust: Asset[]; passphrase: string; deps: MarketDeps; fees?: FeeLine[] }): Promise<MarketRun> {
  const { deps } = i;
  const selling = i.side === "buy" ? i.quote : i.base, buying = i.side === "buy" ? i.base : i.quote;
  const before = new Set((await deps.openOffers()).map((o) => o.id));
  const xdr = buildMarketTx({ source: i.address, sequence: await deps.sequence(), side: i.side, base: i.base, quote: i.quote, amount: i.plan.amount, bound: i.plan.bound, needTrust: i.needTrust, passphrase: i.passphrase, fees: i.fees });
  let sub: { hash: string; result_xdr: string };
  try { sub = await deps.submit(await deps.sign(xdr)); } catch (e) { throw new Error(plainTxError(e)); }

  let result: OfferResult | null = null;
  try { result = parseOfferResult(sub.result_xdr, i.side); } catch { result = null; }

  // Which offer (if any) is left resting? Prefer the id from the result; fall back to "any new offer on this pair" so nothing can slip through.
  let leftovers: OpenOffer[] = [];
  if (result?.remainderOfferId) leftovers = [{ id: result.remainderOfferId, selling, buying, price: i.plan.bound }];
  else if (result === null) leftovers = (await deps.openOffers()).filter((o) => !before.has(o.id) && sameAsset(o.selling, selling) && sameAsset(o.buying, buying));

  let cancelHash: string | null = null, warning: string | null = null;
  for (const o of leftovers) {
    let done = false;
    for (let attempt = 0; attempt < 2 && !done; attempt++) {
      try {
        const c = buildCancelRemainderTx({ source: i.address, sequence: await deps.sequence(), offerId: o.id, selling: o.selling, buying: o.buying, price: o.price, passphrase: i.passphrase });
        cancelHash = (await deps.submit(await deps.sign(c))).hash; done = true;
      } catch { /* retry once, then warn */ }
    }
    if (!done) warning = "Part of your order could not be cancelled automatically and may still be on the order book. Cancel it under Your open offers.";
  }

  const outcome = result
    ? describeOutcome(i.side, i.baseCode, i.quoteCode, i.plan.amount, result)
    : { kind: "partial" as const, text: "Order submitted. Check your balances and open offers for the exact fill." };
  return { hash: sub.hash, result, outcome, cancelHash, warning };
}
