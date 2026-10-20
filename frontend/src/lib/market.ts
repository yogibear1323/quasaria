/**
 * Market (instant) buy/sell on the native SDEX order book.
 *
 * A market order is a manage_buy_offer / manage_sell_offer priced at a fixed PROTECTION BAND away from the best
 * opposing price taken when the user taps Buy/Sell. The offer crosses the book immediately and takes whatever is
 * available inside the band; anything left over would rest on the book as an accidental limit order, so the caller
 * always cancels that remainder right after (see parseOfferResult → remainderOfferId).
 *
 * The band is deliberately fixed and not user-configurable. It is not shown before the tap; the confirm step shows
 * only the estimated average price and total from the live book. REVISIT BEFORE MAINNET SIGNING IS ENABLED.
 */
import { minimumBalance, type HAccount } from "./account";
import { appendFeeOps, type FeeLine } from "./fees";
import { Account, Asset, BASE_FEE, Memo, Operation, TransactionBuilder, xdr } from "@stellar/stellar-sdk";

export const PROTECTION_BAND = 0.05; // 5% from the best opposing price at tap time
export const MARKET_MEMO = "quasaria";
export type Side = "buy" | "sell";
const EPS = 1e-7;

export type Level = { price: number; amount: number };
export type MarketBook = { bids: Level[]; asks: Level[] };

/** Walk levels (best first) taking up to `amount` base units, only inside the price bound. */
export function walkLevels(levels: Level[], amount: number, ok: (price: number) => boolean) {
  let left = amount, base = 0, quote = 0;
  for (const l of levels) {
    if (!ok(l.price) || left <= EPS) break;
    const take = Math.min(left, l.amount);
    base += take; quote += take * l.price; left -= take;
  }
  return { base, quote, avg: base > 0 ? quote / base : null };
}

export type MarketPlan =
  | { ok: true; side: Side; amount: number; best: number; bound: number; estBase: number; estQuote: number; estAvg: number; impact: number; full: boolean; maxQuoteSpend: number }
  | { ok: false; reason: "empty" | "amount" };

/** Estimate from the live book. `bound` = best × (1 ± band); `impact` is the avg price's move away from best (positive = worse). */
export function planMarket(side: Side, amount: number, book: MarketBook, band = PROTECTION_BAND): MarketPlan {
  if (!(amount > 0)) return { ok: false, reason: "amount" };
  const levels = side === "buy" ? book.asks : book.bids;
  const best = levels[0]?.price;
  if (!best) return { ok: false, reason: "empty" };
  const bound = side === "buy" ? best * (1 + band) : best * (1 - band);
  const w = walkLevels(levels, amount, (p) => (side === "buy" ? p <= bound : p >= bound));
  const estAvg = w.avg ?? best;
  return {
    ok: true, side, amount, best, bound, estBase: w.base, estQuote: w.quote, estAvg,
    impact: side === "buy" ? estAvg / best - 1 : 1 - estAvg / best,
    full: w.base >= amount - EPS,
    maxQuoteSpend: amount * bound, // upper bound the offer can ever spend (buy)
  };
}

const p7 = (n: number) => n.toFixed(7);

/** Unsigned tx: optional trustline(s) + one immediate-crossing offer at the bound. Nothing is signed here. */
export function buildMarketTx(i: { source: string; sequence: string; side: Side; base: Asset; quote: Asset; amount: number; bound: number; needTrust: Asset[]; passphrase: string; fees?: FeeLine[] }): string {
  const acct = new Account(i.source, i.sequence);
  const b = new TransactionBuilder(acct, { fee: BASE_FEE, networkPassphrase: i.passphrase }).setTimeout(180);
  for (const a of i.needTrust) b.addOperation(Operation.changeTrust({ asset: a }));
  appendFeeOps(b, i.fees ?? []); // fee BEFORE the offer: parseOfferResult reads the LAST op
  if (i.side === "buy") b.addOperation(Operation.manageBuyOffer({ selling: i.quote, buying: i.base, buyAmount: p7(i.amount), price: p7(i.bound), offerId: "0" }));
  else b.addOperation(Operation.manageSellOffer({ selling: i.base, buying: i.quote, amount: p7(i.amount), price: p7(i.bound), offerId: "0" }));
  return b.addMemo(Memo.text(MARKET_MEMO)).build().toXDR();
}

/** Unsigned tx cancelling a leftover offer (amount 0). Pass the exact assets/price of the offer being cancelled. */
export function buildCancelRemainderTx(i: { source: string; sequence: string; offerId: string; selling: Asset; buying: Asset; price: number; passphrase: string }): string {
  const acct = new Account(i.source, i.sequence);
  return new TransactionBuilder(acct, { fee: BASE_FEE, networkPassphrase: i.passphrase }).setTimeout(180)
    .addOperation(Operation.manageSellOffer({ selling: i.selling, buying: i.buying, amount: "0", price: p7(i.price), offerId: i.offerId }))
    .build().toXDR();
}

/** remainderAmount is in the offer's selling asset (what is still resting). */
export type OfferResult = { received: number; paid: number; avg: number | null; remainderOfferId: string | null; remainderAmount: number };
const f7 = (v: { toString(): string }) => Number(BigInt(v.toString())) / 1e7;

/**
 * Read the last operation's offer result out of a transaction result XDR: what the taker got and paid
 * (summed over claimed offers), and the id/amount of any offer left resting.
 * `side` buy: received base, paid quote. sell: received quote, paid base. (For a taker, "received" = maker's amountSold.)
 */
export function parseOfferResult(resultXdrBase64: string, side: Side): OfferResult {
  /* toJSON() gives the SDK 17 canonical shape (snake_case keys, 64-bit ints as strings). Typed loosely on purpose. */
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const res: any = xdr.TransactionResult.fromXDR(resultXdrBase64, "base64").toJSON();
  const ops: any[] = res.result.tx_success ?? res.result.tx_failed ?? [];
  const inner: any = ops[ops.length - 1]?.op_inner;
  const ok: any = (side === "buy" ? inner?.manage_buy_offer : inner?.manage_sell_offer)?.success;
  if (!ok) throw new Error("not a successful offer result");
  let received = 0, paid = 0;
  for (const c of ok.offers_claimed as any[]) {
    const a = c.order_book ?? c.v0 ?? c.liquidity_pool;
    received += f7(a.amount_sold); paid += f7(a.amount_bought);
  }
  const eff = ok.offer;
  const o = eff && eff !== "deleted" ? (eff.created ?? eff.updated) : null;
  const remainderOfferId: string | null = o ? String(o.offer_id) : null;
  const remainderAmount = o ? f7(o.amount) : 0;
  /* eslint-enable @typescript-eslint/no-explicit-any */
  // avg price is always quote per base
  const base = side === "buy" ? received : paid, quote = side === "buy" ? paid : received;
  return { received, paid, avg: base > 0 ? quote / base : null, remainderOfferId, remainderAmount };
}

export type Outcome = { kind: "filled" | "partial" | "none"; text: string };
/** Plain result line for the toast. */
export function describeOutcome(side: Side, baseCode: string, quoteCode: string, requested: number, r: OfferResult): Outcome {
  const got = side === "buy" ? r.received : r.paid; // base units that changed hands
  const n = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: 7 });
  const avg = r.avg === null ? "" : ` at avg price ${n(Number(r.avg.toPrecision(6)))} ${quoteCode}`;
  const verb = side === "buy" ? "Bought" : "Sold";
  if (got <= EPS) return { kind: "none", text: "Couldn't fill (thin book): nothing traded and the order was cancelled." };
  if (got >= requested - EPS) return { kind: "filled", text: `${verb} ${n(got)} ${baseCode}${avg}.` };
  return { kind: "partial", text: `Partially filled: ${verb.toLowerCase()} ${n(got)} of ${n(requested)} ${baseCode}${avg}. The rest was cancelled.` };
}

/** Horizon op error codes → plain language. */
export function plainTxError(e: unknown): string {
  const codes: string[] = (e as { response?: { data?: { extras?: { result_codes?: { operations?: string[]; transaction?: string } } } } })?.response?.data?.extras?.result_codes?.operations ?? [];
  const tx = (e as { response?: { data?: { extras?: { result_codes?: { transaction?: string } } } } })?.response?.data?.extras?.result_codes?.transaction;
  const m: Record<string, string> = {
    op_underfunded: "Not enough balance for this order.",
    op_low_reserve: "Not enough XLM to cover the account reserve this order needs.",
    op_line_full: "Your trustline limit for the asset you would receive is full.",
    op_sell_no_trust: "You don't hold the asset you would be selling.",
    op_buy_no_trust: "You need a trustline for the asset you would receive.",
    op_sell_not_authorized: "The issuer has not authorised you to hold the asset you are selling.",
    op_buy_not_authorized: "The issuer has not authorised you to hold the asset you would receive.",
    op_cross_self: "This would trade against one of your own open offers. Cancel it first.",
    op_no_trust: "Missing trustline.",
  };
  for (const c of codes) if (m[c]) return m[c];
  if (tx === "tx_insufficient_balance") return "Not enough XLM to pay the fee and keep your reserve.";
  if (tx === "tx_bad_seq") return "Your account changed while signing. Please try again.";
  return e instanceof Error ? e.message : String(e);
}

type Ref = { code: string; issuer: string | null };
export type FundsCheck = { ok: true; needTrust: Ref[]; reserveXlm: number; feeXlm: number } | { ok: false; error: string };

/**
 * Plain, immediate balance/trustline check at tap time. Returns the trustlines the transaction will add (each locks 0.5 XLM)
 * or a plain error. `acct` is the raw Horizon account (null = not on the network).
 */
export function checkFunds(i: { side: Side; plan: Extract<MarketPlan, { ok: true }>; base: Ref; quote: Ref; acct: HAccount | null; baseReserve: number | null }): FundsCheck {
  if (!i.acct) return { ok: false, error: "Your account is not on the network yet. Fund it with XLM first." };
  if (i.baseReserve === null) return { ok: false, error: "Could not read the network reserve from Horizon. Try again in a moment." };
  const recv = i.side === "buy" ? i.base : i.quote, spend = i.side === "buy" ? i.quote : i.base;
  const need = i.side === "buy" ? i.plan.maxQuoteSpend : i.plan.amount;
  const nat = i.acct.balances.find((b) => b.asset_type === "native");
  const xlmBal = Number(nat?.balance ?? 0), xlmSell = Number(nat?.selling_liabilities ?? 0);
  const min = minimumBalance(i.acct, i.baseReserve) ?? 0;
  const fee = Number(BASE_FEE) / 1e7;
  const holds = (a: Ref) => i.acct!.balances.find((b) => b.asset_code === a.code && b.asset_issuer === a.issuer);
  const needTrust: Ref[] = recv.issuer && !holds(recv) ? [recv] : [];
  const feeXlm = fee * (needTrust.length + 1);
  const reserveXlm = needTrust.length * i.baseReserve;
  let spendableXlm = xlmBal - min - xlmSell - feeXlm - reserveXlm - i.baseReserve; // keep one entry's reserve free for a possible resting offer
  if (spend.issuer) {
    const h = holds(spend);
    if (!h) return { ok: false, error: `You don't hold any ${spend.code}, so there is nothing to ${i.side === "buy" ? "pay with" : "sell"}.` };
    const have = Number(h.balance) - Number(h.selling_liabilities ?? 0);
    if (have + 1e-9 < need) return { ok: false, error: `Not enough ${spend.code}: this order needs ${i.side === "buy" ? "up to " : ""}${need.toLocaleString("en-US", { maximumFractionDigits: 7 })} and you have ${have.toLocaleString("en-US", { maximumFractionDigits: 7 })}.` };
  } else if (need > spendableXlm + 1e-9) {
    return { ok: false, error: `Not enough XLM: this order needs ${i.side === "buy" ? "up to " : ""}${need.toLocaleString("en-US", { maximumFractionDigits: 7 })} XLM and you can spend ${Math.max(0, spendableXlm).toLocaleString("en-US", { maximumFractionDigits: 7 })} (the rest is your account reserve and fees).` };
  }
  if (spend.issuer && spendableXlm < 0) return { ok: false, error: `Not enough free XLM for the network fee and reserve${needTrust.length ? " (a new trustline locks 0.5 XLM)" : ""}.` };
  return { ok: true, needTrust, reserveXlm, feeXlm };
}
