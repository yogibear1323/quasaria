/**
 * Quasaria trading fee (client-side, LOBSTR-style).
 *
 * When enabled, every Exchange order (limit + market), Swap (path payment) and Pools deposit/withdraw the user
 * signs carries ONE extra Payment op per charged asset, inside the same transaction, paying FEE_BPS of the
 * traded/sent amount to FEE_WALLET, in the asset being sold/sent (withdraw: the asset received).
 * The fee is shown (percent + amount + asset) before anything is signed.
 *
 * OFF BY DEFAULT. The fee is entirely off (no op, no UI line) unless BOTH are set at build time:
 *   VITE_FEE_BPS     integer basis points, 1..MAX_FEE_BPS (10 = 0.10%). Unset/0/invalid = off.
 *   VITE_FEE_WALLET  the fee wallet's G… address. Unset/invalid = off.
 *
 * Trustline / missing-account safety (chosen approach: SKIP, never convert):
 *   A payment to an account that does not exist, or in an asset the fee wallet has no trustline for, fails the
 *   WHOLE transaction (op_no_destination / op_no_trust) and the user's trade would fail. So before building, the
 *   site reads the fee wallet from Horizon and only charges a leg when the wallet exists and can receive that
 *   asset (XLM always; others only with a non-authorization-blocked trustline with room under its limit).
 *   Legs it cannot receive are skipped (no fee) rather than converted to an "XLM equivalent", because a
 *   conversion needs a price oracle the user would have to trust and adds a second asset to their spend.
 *   If Horizon can't be read, the fee is skipped too: the fee must never be the reason a trade fails.
 */
import { Asset, Operation, StrKey, type TransactionBuilder } from "@stellar/stellar-sdk";

export const MAX_FEE_BPS = 100; // hard cap 1.00%: a typo can't charge users more

export type FeeConfig = { bps: number; wallet: string | null };

export function parseFeeConfig(env: Record<string, unknown>): FeeConfig {
  const raw = String(env.VITE_FEE_BPS ?? "").trim();
  const n = /^\d+$/.test(raw) ? Number(raw) : 0;
  const bps = n >= 1 && n <= MAX_FEE_BPS ? n : 0;
  const w = String(env.VITE_FEE_WALLET ?? "").trim();
  const wallet = w && StrKey.isValidEd25519PublicKey(w) ? w : null;
  return { bps, wallet };
}

export const FEE_CONFIG: FeeConfig = parseFeeConfig(import.meta.env as unknown as Record<string, unknown>);
export const FEE_BPS = FEE_CONFIG.bps;
export const FEE_WALLET = FEE_CONFIG.wallet;

export const feeEnabled = (c: FeeConfig = FEE_CONFIG): c is { bps: number; wallet: string } => c.bps > 0 && !!c.wallet;
export const feePctText = (bps: number) => `${(bps / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}%`;

/** Fee in 7-decimal units, rounded DOWN (never charge more than the stated percent). */
export function feeAmount(amount: number, bps: number): number {
  if (!(amount > 0) || !(bps > 0)) return 0;
  return Math.floor(amount * 1e7 * bps / 10_000) / 1e7;
}

export type FeeLine = { asset: Asset; code: string; amount: number; bps: number };
export type CanReceive = (a: Asset) => boolean;

const codeOf = (a: Asset) => (a.isNative() ? "XLM" : a.getCode());

/** Fee lines for the given legs. Empty when the fee is off, the leg is dust, or the wallet can't receive it. */
export function planFees(legs: { asset: Asset; amount: number }[], canReceive: CanReceive | null, c: FeeConfig = FEE_CONFIG): FeeLine[] {
  if (!feeEnabled(c) || !canReceive) return [];
  const out: FeeLine[] = [];
  for (const l of legs) {
    const amount = feeAmount(l.amount, c.bps);
    if (amount <= 0 || !canReceive(l.asset)) continue;
    const prev = out.find((o) => o.asset.equals(l.asset));
    if (prev) prev.amount = Math.round((prev.amount + amount) * 1e7) / 1e7;
    else out.push({ asset: l.asset, code: codeOf(l.asset), amount, bps: c.bps });
  }
  return out;
}

/** Appends one Payment op per fee line to the fee wallet. No-op for an empty list. */
export function appendFeeOps(b: TransactionBuilder, lines: FeeLine[], c: FeeConfig = FEE_CONFIG): TransactionBuilder {
  if (!feeEnabled(c)) return b;
  for (const l of lines) b.addOperation(Operation.payment({ destination: c.wallet, asset: l.asset, amount: l.amount.toFixed(7) }));
  return b;
}

type HBal = { asset_type: string; asset_code?: string; asset_issuer?: string; balance?: string; limit?: string; is_authorized?: boolean };
/** Build a receive-check from the fee wallet's Horizon balances. */
export function canReceiveFrom(balances: HBal[]): CanReceive {
  return (a) => {
    if (a.isNative()) return true;
    const b = balances.find((x) => x.asset_code === a.getCode() && x.asset_issuer === a.getIssuer());
    if (!b || b.is_authorized === false) return false;
    return Number(b.limit ?? "922337203685.4775807") - Number(b.balance ?? 0) > 0;
  };
}

let cache: { at: number; p: Promise<CanReceive | null> } | null = null;
/** Reads the fee wallet (cached 60 s). Resolves null (= skip fee) when off, missing account, or Horizon error. */
export function loadFeeReceiver(horizonUrl: string, c: FeeConfig = FEE_CONFIG, fetchImpl: typeof fetch = fetch): Promise<CanReceive | null> {
  if (!feeEnabled(c)) return Promise.resolve(null);
  if (cache && Date.now() - cache.at < 60_000) return cache.p;
  const p = fetchImpl(`${horizonUrl.replace(/\/$/, "")}/accounts/${c.wallet}`)
    .then(async (r) => (r.ok ? canReceiveFrom(((await r.json()) as { balances: HBal[] }).balances) : null))
    .catch(() => null);
  cache = { at: Date.now(), p };
  return p;
}
export const _resetFeeCache = () => { cache = null; };

/** Shared confirm-step text, e.g. "Quasaria fee 0.1%: 1.25 USDC". Empty string when no lines. */
export const feeText = (lines: FeeLine[]) => lines.map((l) => `${l.amount.toLocaleString("en-US", { maximumFractionDigits: 7 })} ${l.code}`).join(" + ");
