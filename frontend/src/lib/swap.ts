/**
 * Swap = a Stellar path payment (strict send) from you to yourself. Horizon finds the best route across the
 * order book and native liquidity pools; the transaction carries a minimum-received bound (your slippage limit),
 * so it fails instead of filling worse.
 */
import { appendFeeOps, type FeeLine } from "./fees";
import { Account, Asset, BASE_FEE, Memo, Operation, TransactionBuilder, xdr } from "@stellar/stellar-sdk";
import { minimumBalance, type HAccount } from "./account";

export const DEFAULT_SLIPPAGE_PCT = 0.5;
export const SLIPPAGE_PRESETS = [0.1, 0.5, 1];
export const clampSlippage = (p: number) => (Number.isFinite(p) ? Math.min(Math.max(p, 0.01), 50) : DEFAULT_SLIPPAGE_PCT);

/** Minimum received after a slippage tolerance in percent (0.5 = 0.5%). Floors at 7 decimals so the bound is never looser than asked. */
export const minReceived = (dest: number, slippagePct: number) => Math.floor(dest * (1 - clampSlippage(slippagePct) / 100) * 1e7) / 1e7;

export type Ref = { code: string; issuer: string | null };
export type SwapQuote = { sendAmount: number; destAmount: number; path: Asset[]; rate: number };

export function parseQuote(sendAmount: number, rec: { destination_amount: string; path: { asset_type: string; asset_code?: string; asset_issuer?: string }[] } | undefined): SwapQuote | null {
  if (!rec || !(sendAmount > 0)) return null;
  const dest = Number(rec.destination_amount);
  if (!(dest > 0)) return null;
  const path = rec.path.map((a) => (a.asset_type === "native" ? Asset.native() : new Asset(a.asset_code!, a.asset_issuer!)));
  return { sendAmount, destAmount: dest, path, rate: dest / sendAmount };
}

export type SwapFunds = { ok: true; needTrust: Ref[]; reserveXlm: number; feeXlm: number } | { ok: false; error: string };
export function checkSwapFunds(i: { from: Ref; to: Ref; amount: number; acct: HAccount | null; baseReserve: number | null }): SwapFunds {
  if (!i.acct) return { ok: false, error: "Your account is not on the network yet. Fund it with XLM first." };
  if (i.baseReserve === null) return { ok: false, error: "Could not read the network reserve from Horizon. Try again in a moment." };
  const fee = Number(BASE_FEE) / 1e7;
  const holds = (a: Ref) => i.acct!.balances.find((b) => b.asset_code === a.code && b.asset_issuer === a.issuer);
  const needTrust: Ref[] = i.to.issuer && !holds(i.to) ? [i.to] : [];
  const feeXlm = fee * (needTrust.length + 1), reserveXlm = needTrust.length * i.baseReserve;
  const n = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: 7 });
  if (i.from.issuer) {
    const h = holds(i.from);
    if (!h) return { ok: false, error: `You don't hold any ${i.from.code}, so there is nothing to swap.` };
    const have = Number(h.balance) - Number(h.selling_liabilities ?? 0);
    if (have + 1e-9 < i.amount) return { ok: false, error: `Not enough ${i.from.code}: you have ${n(have)}.` };
    const nat = i.acct.balances.find((b) => b.asset_type === "native");
    const free = Number(nat?.balance ?? 0) - (minimumBalance(i.acct, i.baseReserve) ?? 0) - Number(nat?.selling_liabilities ?? 0) - feeXlm - reserveXlm;
    if (free < 0) return { ok: false, error: `Not enough free XLM for the network fee${needTrust.length ? " and the new trustline reserve (0.5 XLM)" : ""}.` };
  } else {
    const nat = i.acct.balances.find((b) => b.asset_type === "native");
    const free = Number(nat?.balance ?? 0) - (minimumBalance(i.acct, i.baseReserve) ?? 0) - Number(nat?.selling_liabilities ?? 0) - feeXlm - reserveXlm;
    if (i.amount > free + 1e-9) return { ok: false, error: `Not enough XLM: you can swap up to ${n(Math.max(0, free))} XLM (the rest is your account reserve and fees).` };
  }
  return { ok: true, needTrust, reserveXlm, feeXlm };
}

export function buildSwapTx(i: { source: string; sequence: string; from: Asset; to: Asset; amount: number; minOut: number; path: Asset[]; needTrust: Asset[]; passphrase: string; fees?: FeeLine[] }): string {
  const b = new TransactionBuilder(new Account(i.source, i.sequence), { fee: BASE_FEE, networkPassphrase: i.passphrase }).setTimeout(180);
  for (const a of i.needTrust) b.addOperation(Operation.changeTrust({ asset: a }));
  appendFeeOps(b, i.fees ?? []); // fee BEFORE the path payment: parseSwapReceived reads the LAST op
  b.addOperation(Operation.pathPaymentStrictSend({ sendAsset: i.from, sendAmount: i.amount.toFixed(7), destination: i.source, destAsset: i.to, destMin: i.minOut.toFixed(7), path: i.path }));
  return b.addMemo(Memo.text("quasaria")).build().toXDR();
}

/** Amount actually received, from a successful path-payment transaction result. */
export function parseSwapReceived(resultXdrBase64: string): number | null {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const res: any = xdr.TransactionResult.fromXDR(resultXdrBase64, "base64").toJSON();
  const ops: any[] = res?.result?.tx_success ?? [];
  const ok = ops[ops.length - 1]?.op_inner?.path_payment_strict_send?.success;
  const amt = ok?.last?.amount;
  return amt === undefined ? null : Number(BigInt(String(amt))) / 1e7;
  /* eslint-enable @typescript-eslint/no-explicit-any */
}

export function plainSwapError(e: unknown): string {
  const ops: string[] = (e as { response?: { data?: { extras?: { result_codes?: { operations?: string[]; transaction?: string } } } } })?.response?.data?.extras?.result_codes?.operations ?? [];
  const tx = (e as { response?: { data?: { extras?: { result_codes?: { transaction?: string } } } } })?.response?.data?.extras?.result_codes?.transaction;
  const m: Record<string, string> = {
    op_under_dest_min: "The price moved beyond your slippage limit, so nothing was swapped. Try again or raise the limit.",
    op_too_few_offers: "There isn't enough liquidity on this route right now.",
    op_over_sendmax: "The price moved beyond your limit, so nothing was swapped.",
    op_underfunded: "Not enough balance for this swap.",
    op_no_trust: "Missing trustline.",
    op_src_no_trust: "You don't hold the asset you are swapping.",
    op_line_full: "Your trustline limit for the asset you would receive is full.",
    op_no_destination: "Your account was not found on the network.",
    op_low_reserve: "Not enough XLM to cover the account reserve this swap needs.",
    op_offer_cross_self: "This route would trade against one of your own open offers. Cancel it first.",
  };
  for (const c of ops) if (m[c]) return m[c];
  if (tx === "tx_insufficient_balance") return "Not enough XLM to pay the fee and keep your reserve.";
  if (tx === "tx_bad_seq") return "Your account changed while signing. Please try again.";
  return e instanceof Error ? e.message : String(e);
}

/** True when a quote lookup failed for a transient reason (rate limit, timeout, no connection) rather than "no path". */
export function isTransientLookupError(e: unknown): boolean {
  const st = (e as { response?: { status?: number } })?.response?.status;
  if (st === 429 || (typeof st === "number" && st >= 500)) return true;
  if (st === undefined) return true; // no HTTP response at all: network error / CORS / timeout
  return false;
}
