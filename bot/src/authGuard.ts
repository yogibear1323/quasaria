/**
 * The bot and keeper only sign the transaction envelope, so they can only satisfy
 * SOROBAN_CREDENTIALS_SOURCE_ACCOUNT auth. If simulation asks for any other
 * credential arm (legacy ADDRESS, CAP-71 ADDRESS_V2 / ADDRESS_WITH_DELEGATES, or
 * an arm from a future protocol), refuse up front with a clear message instead of
 * submitting a transaction that fails on-chain and burns the fee.
 */
import type { xdr } from "@stellar/stellar-sdk";

const NAMES: Record<string, string> = {
  sorobanCredentialsSourceAccount: "SOURCE_ACCOUNT",
  sorobanCredentialsAddress: "ADDRESS",
  sorobanCredentialsAddressV2: "ADDRESS_V2",
  sorobanCredentialsAddressWithDelegates: "ADDRESS_WITH_DELEGATES",
};

export const credentialKind = (e: Pick<xdr.SorobanAuthorizationEntry, "credentials">) =>
  NAMES[e.credentials.type] ?? `UNKNOWN(${e.credentials.type})`;

export function assertSourceOnlyAuth(method: string, auth: readonly Pick<xdr.SorobanAuthorizationEntry, "credentials">[] | undefined) {
  const foreign = (auth ?? []).map(credentialKind).filter((k) => k !== "SOURCE_ACCOUNT");
  if (foreign.length) {
    throw new Error(`${method}: simulation needs ${foreign.length} non-source auth entr${foreign.length === 1 ? "y" : "ies"} (${foreign.join(", ")}); the bot only signs as the transaction source`);
  }
}
