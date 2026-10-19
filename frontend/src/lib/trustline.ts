/** Verified-USDC trustline helper (Circle issuer; matched on code AND issuer). A trustline is an opt-in to hold an asset; it costs a 0.5 XLM reserve. */
import { Account, Asset, BASE_FEE, Operation, TransactionBuilder } from "@stellar/stellar-sdk";
import { TESTNET_USDC_ISSUER } from "./config";
import { MAINNET_USDC_ISSUER } from "./liveMarkets";
import type { NetId } from "./nativePools";

export const usdcIssuer = (net: NetId) => (net === "mainnet" ? MAINNET_USDC_ISSUER : TESTNET_USDC_ISSUER);
export const TRUSTLINE_RESERVE_XLM = 0.5;
export const TRUSTLINE_NOTE = "A trustline lets your account hold USDC. Each one locks 0.5 XLM as reserve for as long as it exists, and you get that back when you remove it.";

export function buildTrustlineTx(i: { source: string; sequence: string; code: string; issuer: string; passphrase: string; limit?: string }): string {
  return new TransactionBuilder(new Account(i.source, i.sequence), { fee: BASE_FEE, networkPassphrase: i.passphrase })
    .addOperation(Operation.changeTrust({ asset: new Asset(i.code, i.issuer), ...(i.limit ? { limit: i.limit } : {}) }))
    .setTimeout(180).build().toXDR();
}
