import { describe, expect, it } from "vitest";
import { Address, Keypair, xdr } from "@stellar/stellar-sdk";
import { assertSourceOnlyAuth, credentialKind } from "../src/authGuard.js";

const creds = () =>
  new xdr.SorobanAddressCredentials({ address: new Address(Keypair.random().publicKey()).toScAddress(), nonce: 1n, signatureExpirationLedger: 10, signature: xdr.ScVal.scvVoid() });
const e = (credentials: xdr.SorobanCredentials) => ({ credentials });

describe("auth guard (bot signs as tx source only)", () => {
  it("accepts no auth and source-account auth", () => {
    expect(() => assertSourceOnlyAuth("liquidate", undefined)).not.toThrow();
    expect(() => assertSourceOnlyAuth("liquidate", [e(xdr.SorobanCredentials.sorobanCredentialsSourceAccount())])).not.toThrow();
  });
  it("refuses legacy ADDRESS and CAP-71 ADDRESS_V2 with a named error", () => {
    expect(() => assertSourceOnlyAuth("set_prices", [e(xdr.SorobanCredentials.sorobanCredentialsAddressV2(creds()))])).toThrow(/set_prices: .*1 non-source auth entry \(ADDRESS_V2\)/);
    expect(() =>
      assertSourceOnlyAuth("x", [e(xdr.SorobanCredentials.sorobanCredentialsAddress(creds())), e(xdr.SorobanCredentials.sorobanCredentialsSourceAccount())]),
    ).toThrow(/\(ADDRESS\)/);
  });
  it("names unknown future arms instead of crashing", () => {
    const future = { credentials: { type: "sorobanCredentialsFuture" } } as unknown as xdr.SorobanAuthorizationEntry;
    expect(credentialKind(future)).toBe("UNKNOWN(sorobanCredentialsFuture)");
    expect(() => assertSourceOnlyAuth("x", [future])).toThrow(/UNKNOWN\(sorobanCredentialsFuture\)/);
  });
});
