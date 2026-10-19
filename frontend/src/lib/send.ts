/**
 * Planning + building for the Send screen. Pure checks first (testable), then one builder that returns an unsigned XDR.
 * Keypair-only: the page signs with the in-memory key via wallet.sign and submits to Horizon; nothing here sees a secret.
 */
import { Account, Asset, BASE_FEE, Memo, Operation, TransactionBuilder, StrKey } from "@stellar/stellar-sdk";
import { parseUnits } from "./format";
import { fetchRawAccount, minimumBalance, type HAccount } from "./account";
import { NETS, type NetId } from "./nativePools";

export type SendAsset = { code: string; issuer: string | null }; // issuer null = native XLM
export const isNativeAsset = (a: SendAsset) => a.issuer === null;
export const MEMO_MAX_BYTES = 28;
export const MIN_CREATE_ACCOUNT_XLM = 1; // 2 base reserves at 0.5 XLM; Horizon rejects less

export const validDestination = (s: string) => StrKey.isValidEd25519PublicKey(s.trim());
export const memoBytes = (s: string) => new TextEncoder().encode(s).length;

/** "12.5" → 125000000n stroops; null if not a positive amount with ≤7 decimals. */
export function parseAmount(s: string): bigint | null {
  const t = s.trim();
  if (!/^\d*\.?\d*$/.test(t) || !/\d/.test(t)) return null;
  if ((t.split(".")[1] ?? "").length > 7) return null;
  try { const v = parseUnits(t); return v > 0n ? v : null; } catch { return null; }
}

export type SendInput = {
  source: string; asset: SendAsset; amount: string; destination: string; memo: string;
  /** Source account facts (null = unfunded). */
  src: HAccount | null; baseReserve: number | null;
  /** Destination account facts (null = does not exist yet). */
  dest: HAccount | null;
};
export type SendPlan =
  | { ok: true; kind: "payment" | "createAccount"; stroops: bigint; amountText: string; fee: string; notes: string[] }
  | { ok: false; error: string };

const stroopsToText = (v: bigint) => { const s = v.toString().padStart(8, "0"); return `${s.slice(0, -7)}.${s.slice(-7)}`.replace(/\.?0+$/, "") || "0"; };

export function planSend(i: SendInput): SendPlan {
  const dest = i.destination.trim();
  if (!validDestination(dest)) return { ok: false, error: "That is not a valid Stellar address (it starts with G and is 56 characters)." };
  if (dest === i.source) return { ok: false, error: "That is your own address." };
  const stroops = parseAmount(i.amount);
  if (stroops === null) return { ok: false, error: "Enter an amount greater than 0 with at most 7 decimals." };
  if (memoBytes(i.memo) > MEMO_MAX_BYTES) return { ok: false, error: `The memo is too long (${memoBytes(i.memo)} of ${MEMO_MAX_BYTES} bytes).` };
  if (!i.src) return { ok: false, error: "Your account is not funded on this network yet, so it cannot send." };
  const notes: string[] = [];
  const amountXlm = Number(stroopsToText(stroops));

  if (isNativeAsset(i.asset)) {
    const nat = i.src.balances.find((b) => b.asset_type === "native");
    const bal = Number(nat?.balance ?? 0), sell = Number(nat?.selling_liabilities ?? 0);
    const min = minimumBalance(i.src, i.baseReserve);
    if (min === null) return { ok: false, error: "Could not read the network reserve from Horizon. Try again in a moment." };
    const fee = Number(BASE_FEE) / 1e7;
    const spendable = bal - min - sell - fee;
    if (amountXlm > spendable + 1e-9) return { ok: false, error: `You can send at most ${Math.max(0, spendable).toFixed(7).replace(/\.?0+$/, "")} XLM: ${min} XLM stays locked as your account reserve${sell ? ", some is committed to open offers" : ""}, plus the network fee.` };
    if (!i.dest) {
      if (amountXlm < MIN_CREATE_ACCOUNT_XLM) return { ok: false, error: `That address does not exist on this network yet. A new account needs at least ${MIN_CREATE_ACCOUNT_XLM} XLM to be created.` };
      notes.push("This address is new on the network: your payment creates the account.");
      return { ok: true, kind: "createAccount", stroops, amountText: stroopsToText(stroops), fee: `${fee} XLM`, notes };
    }
    return { ok: true, kind: "payment", stroops, amountText: stroopsToText(stroops), fee: `${fee} XLM`, notes };
  }

  const held = i.src.balances.find((b) => b.asset_code === i.asset.code && b.asset_issuer === i.asset.issuer);
  if (!held) return { ok: false, error: `You do not hold ${i.asset.code} from that issuer.` };
  if (amountXlm > Number(held.balance) - Number(held.selling_liabilities ?? 0) + 1e-9) return { ok: false, error: `You only have ${held.balance} ${i.asset.code} available to send.` };
  if (!i.dest) return { ok: false, error: "That address does not exist on this network yet. It must be funded with XLM and trust this asset before it can receive it." };
  const trust = i.dest.balances.find((b) => b.asset_code === i.asset.code && b.asset_issuer === i.asset.issuer);
  if (!trust) return { ok: false, error: `That address has no trustline for ${i.asset.code} from this issuer, so it cannot receive it. Ask them to add it first.` };
  if (trust.is_authorized === false) return { ok: false, error: "That address's trustline is not authorized by the issuer." };
  if (trust.limit && Number(trust.limit) < Number(trust.balance) + amountXlm) notes.push("This would exceed the recipient's trustline limit; the network may reject it.");
  return { ok: true, kind: "payment", stroops, amountText: stroopsToText(stroops), fee: `${Number(BASE_FEE) / 1e7} XLM`, notes };
}

/** Unsigned transaction XDR for a plan. Needs the source's current sequence number from Horizon. */
export function buildSendTx(plan: Extract<SendPlan, { ok: true }>, i: { source: string; sequence: string; destination: string; asset: SendAsset; memo: string; passphrase: string }): string {
  const acct = new Account(i.source, i.sequence);
  const b = new TransactionBuilder(acct, { fee: BASE_FEE, networkPassphrase: i.passphrase }).setTimeout(180);
  const dest = i.destination.trim();
  if (plan.kind === "createAccount") b.addOperation(Operation.createAccount({ destination: dest, startingBalance: plan.amountText }));
  else b.addOperation(Operation.payment({ destination: dest, asset: isNativeAsset(i.asset) ? Asset.native() : new Asset(i.asset.code, i.asset.issuer!), amount: plan.amountText }));
  if (i.memo.trim()) b.addMemo(Memo.text(i.memo.trim()));
  return b.build().toXDR();
}

export async function loadSendContext(net: NetId, destination: string, f: typeof fetch = fetch) {
  const dest = validDestination(destination) ? await fetchRawAccount(net, destination.trim(), f) : null;
  return { dest, horizon: NETS[net].horizon };
}
