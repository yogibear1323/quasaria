/**
 * Classic Stellar (Horizon + SDEX) helpers: order books, trustlines, offers,
 * path payments. All transactions are built for TESTNET and signed by the
 * active signer (the account's own keypair, see lib/signer.ts).
 */
import { appendFeeOps, type FeeLine } from "./fees";
import { Asset, BASE_FEE, Horizon, LiquidityPoolAsset, Operation, TransactionBuilder, Memo, getLiquidityPoolId } from "@stellar/stellar-sdk";
import { HORIZON_URL, NETWORK_PASSPHRASE, OFFLINE_DEMO, USDC_ISSUER } from "./config";
import { demoBook, type Book } from "./demo";

export const horizon = new Horizon.Server(HORIZON_URL);

export const ASSETS: Record<string, Asset> = {
  XLM: Asset.native(),
  USDC: new Asset("USDC", USDC_ISSUER),
};

export const PAIRS = [
  { base: "XLM", quote: "USDC" },
];

/** `demoFallback`: show the demo book when Horizon is empty/unreachable (default pair only). */
export async function fetchOrderBook(base: Asset, quote: Asset, demoFallback = true): Promise<Book> {
  const empty: Book = { bids: [], asks: [], source: "horizon" };
  if (OFFLINE_DEMO) return demoFallback ? demoBook() : empty;
  try {
    const ob = await horizon.orderbook(base, quote).limit(15).call();
    const bids = ob.bids.map((b) => ({ price: Number(b.price), amount: Number(b.amount) / Number(b.price) }));
    const asks = ob.asks.map((a) => ({ price: Number(a.price), amount: Number(a.amount) }));
    if (!bids.length && !asks.length) return demoFallback ? demoBook() : empty;
    return { ...cleanBook(bids, asks), source: "horizon" };
  } catch {
    return demoFallback ? demoBook() : empty;
  }
}

/** "XLM" | "CODE-ISSUER" (stellarchain assetKey format) → Asset. */
export function assetFromKey(key: string): Asset {
  if (!key || key === "XLM" || key === "native") return Asset.native();
  const [code, issuer] = key.split("-");
  return new Asset(code, issuer);
}
export const assetKeyOf = (a: Asset) => (a.isNative() ? "XLM" : `${a.getCode()}-${a.getIssuer()}`);

/**
 * Testnet books often contain absurd "junk" offers far from the market. Hide
 * levels more than 50% away from the best bid/ask so the depth view stays
 * readable (they are still on the ledger, just not displayed).
 */
export function cleanBook(bids: { price: number; amount: number }[], asks: { price: number; amount: number }[]) {
  // Each side is filtered against ITS OWN best level, so the best bid and best ask are never dropped.
  // (A mid-point filter hid real offers whenever the spread was wide, e.g. a lone far-away ask made the
  // only real bid disappear and Market orders said the book was empty.)
  const bb = bids[0]?.price ?? 0, ba = asks[0]?.price ?? 0;
  return { bids: bids.filter((l) => l.price > bb * 0.5), asks: asks.filter((l) => l.price < ba * 1.5) };
}

/** Drop outlier candles (testnet junk trades) relative to the median close. */
function cleanCandles<T extends { o: number; h: number; l: number; c: number }>(cs: T[]) {
  const closes = cs.map((c) => c.c).sort((a, b) => a - b);
  const med = closes[Math.floor(closes.length / 2)] || 0;
  const within = (v: number) => v > med * 0.7 && v < med * 1.3;
  return cs
    .filter((c) => within(c.o) && within(c.c))
    .map((c) => ({ ...c, h: Math.min(c.h, Math.max(c.o, c.c) * 1.05), l: Math.max(c.l, Math.min(c.o, c.c) * 0.95) }));
}

export type Balance = { code: string; issuer?: string; balance: number; isNative: boolean };

export async function fetchBalances(pubkey: string): Promise<Balance[]> {
  const acct = await horizon.loadAccount(pubkey);
  return acct.balances.map((b) => {
    if (b.asset_type === "native") return { code: "XLM", balance: Number(b.balance), isNative: true };
    if (b.asset_type === "liquidity_pool_shares") return { code: "LP", balance: Number(b.balance), isNative: false };
    return { code: b.asset_code, issuer: b.asset_issuer, balance: Number(b.balance), isNative: false };
  });
}

export function hasTrustline(balances: Balance[], asset: Asset) {
  return asset.isNative() || balances.some((b) => b.code === asset.getCode() && b.issuer === asset.getIssuer());
}

async function builder(pubkey: string) {
  const source = await horizon.loadAccount(pubkey);
  return new TransactionBuilder(source, { fee: BASE_FEE, networkPassphrase: NETWORK_PASSPHRASE }).setTimeout(180);
}

/** Adds changeTrust ops for any asset lacking a trustline. */
function withTrust(b: TransactionBuilder, balances: Balance[], assets: Asset[]) {
  for (const a of assets) if (!hasTrustline(balances, a)) b.addOperation(Operation.changeTrust({ asset: a }));
  return b;
}

export async function buildTrustline(pubkey: string, asset: Asset) {
  return (await builder(pubkey)).addOperation(Operation.changeTrust({ asset })).build().toXDR();
}

/** SDEX limit order. side=buy: buy `amount` base at `price` (quote per base). */
export async function buildLimitOrder(pubkey: string, side: "buy" | "sell", base: Asset, quote: Asset, amount: number, price: number, fees: FeeLine[] = []) {
  const balances = await fetchBalances(pubkey);
  const b = withTrust(await builder(pubkey), balances, [base, quote]);
  appendFeeOps(b, fees); // before the offer: nothing reads this tx's last-op result, but keep the offer last like market orders
  if (side === "buy") {
    b.addOperation(Operation.manageBuyOffer({ selling: quote, buying: base, buyAmount: amount.toFixed(7), price: price.toFixed(7), offerId: "0" }));
  } else {
    b.addOperation(Operation.manageSellOffer({ selling: base, buying: quote, amount: amount.toFixed(7), price: price.toFixed(7), offerId: "0" }));
  }
  return b.addMemo(Memo.text("quasaria")).build().toXDR();
}

export async function fetchOpenOffers(pubkey: string) {
  if (OFFLINE_DEMO) return [];
  const r = await horizon.offers().forAccount(pubkey).limit(20).call();
  return r.records;
}

/** Cancel an offer by setting its amount to 0. */
export async function buildCancelOffer(pubkey: string, offer: { id: string; selling: Asset; buying: Asset; price: string }) {
  return (await builder(pubkey))
    .addOperation(Operation.manageSellOffer({ selling: offer.selling, buying: offer.buying, amount: "0", price: offer.price, offerId: offer.id }))
    .build()
    .toXDR();
}

/** Best SDEX+AMM path via Horizon strict-send path finding. */
export async function findStrictSendPath(from: Asset, amount: number, to: Asset) {
  const r = await horizon.strictSendPaths(from, amount.toFixed(7), [to]).call();
  return r.records[0];
}

export async function buildPathPayment(pubkey: string, from: Asset, amount: number, to: Asset, minOut: number, path: Asset[]) {
  const balances = await fetchBalances(pubkey);
  const b = withTrust(await builder(pubkey), balances, [to]);
  b.addOperation(
    Operation.pathPaymentStrictSend({ sendAsset: from, sendAmount: amount.toFixed(7), destination: pubkey, destAsset: to, destMin: minOut.toFixed(7), path }),
  );
  return b.build().toXDR();
}

export async function submitSignedXdr(signedXdr: string) {
  const tx = TransactionBuilder.fromXDR(signedXdr, NETWORK_PASSPHRASE);
  return horizon.submitTransaction(tx);
}

export async function fetchTradeCandles(base: Asset, quote: Asset) {
  if (OFFLINE_DEMO) return null;
  try {
    const end = Date.now();
    const r = await horizon.tradeAggregation(base, quote, end - 90 * 3600_000, end, 3600_000, 0).limit(90).call();
    if (!r.records.length) return null;
    return cleanCandles(r.records.map((c, i) => ({ t: i, o: Number(c.open), h: Number(c.high), l: Number(c.low), c: Number(c.close) })));
  } catch {
    return null;
  }
}

// ---- native (protocol-level) liquidity pools, CAP-38
export const nativePoolId = (a: Asset, b: Asset, fee = 30) => Array.from(getLiquidityPoolId("constant_product", { assetA: a, assetB: b, fee }) as Uint8Array, (x) => x.toString(16).padStart(2, "0")).join("");

export type NativePool = { id: string; reserveA: number; reserveB: number; totalShares: number; feeBp: number; holders: number };

/** Native pool state on the configured (testnet) Horizon, or null if it does not exist. */
export async function fetchNativePool(id: string): Promise<NativePool | null> {
  try {
    const r = await horizon.liquidityPools().liquidityPoolId(id).call();
    return { id, reserveA: Number(r.reserves[0].amount), reserveB: Number(r.reserves[1].amount), totalShares: Number(r.total_shares), feeBp: r.fee_bp, holders: Number(r.total_trustlines) };
  } catch {
    return null;
  }
}

/**
 * Deposit into the native XLM/<asset> pool (asset A must sort first; native always does).
 * Adds the asset trustline and the pool-share trustline when missing. `slippage` bounds the price.
 */
export async function buildNativeLpDeposit(pubkey: string, a: Asset, b: Asset, maxA: number, maxB: number, slippage = 0.02) {
  const balances = await fetchBalances(pubkey);
  const acct = await horizon.loadAccount(pubkey);
  const id = nativePoolId(a, b);
  const bld = withTrust(await builder(pubkey), balances, [a, b]);
  const hasShare = acct.balances.some((x) => x.asset_type === "liquidity_pool_shares" && (x as { liquidity_pool_id: string }).liquidity_pool_id === id);
  if (!hasShare) bld.addOperation(Operation.changeTrust({ asset: new LiquidityPoolAsset(a, b, 30) }));
  const ratio = maxA / maxB;
  bld.addOperation(Operation.liquidityPoolDeposit({ liquidityPoolId: id, maxAmountA: maxA.toFixed(7), maxAmountB: maxB.toFixed(7), minPrice: (ratio * (1 - slippage)).toPrecision(7), maxPrice: (ratio * (1 + slippage)).toPrecision(7) }));
  return bld.build().toXDR();
}
