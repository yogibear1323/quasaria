import { describe, expect, it } from "vitest";
import { Account, Address, Contract, Keypair, Networks, Operation, TransactionBuilder, nativeToScVal, xdr } from "@stellar/stellar-sdk";
import { LENDING, addrv, i128v, txrep } from "../src/lib/lending";
import { authEntryLines, credentialName, executableText, hostFunctionLines, scValText } from "../src/lib/xdrDescribe";

const POOL = new Contract(LENDING.pool);
const OWNER = "CA3D5KRYM6CB7OWQ6TWYRR3Z4T7GNZLKERYNZGGA5SOAOPIFY6YQGAXE";
const g = Keypair.random().publicKey();
const d = Keypair.random().publicKey();

const invocation = () =>
  new xdr.SorobanAuthorizedInvocation({
    function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
      new xdr.InvokeContractArgs({ contractAddress: POOL.address().toScAddress(), functionName: "borrow", args: [addrv(g), i128v(5n)] }),
    ),
    subInvocations: [],
  });
const addrCreds = (who = g, sig: xdr.ScVal = xdr.ScVal.scvVoid()) =>
  new xdr.SorobanAddressCredentials({ address: new Address(who).toScAddress(), nonce: 42n, signatureExpirationLedger: 1234, signature: sig });
const entry = (credentials: xdr.SorobanCredentials) => new xdr.SorobanAuthorizationEntry({ credentials, rootInvocation: invocation() });

describe("protocol 27/28 credential arms in the Txrep preview", () => {
  it("names every SorobanCredentials arm", () => {
    expect(credentialName(xdr.SorobanCredentials.sorobanCredentialsSourceAccount())).toBe("SOROBAN_CREDENTIALS_SOURCE_ACCOUNT");
    expect(credentialName(xdr.SorobanCredentials.sorobanCredentialsAddress(addrCreds()))).toBe("SOROBAN_CREDENTIALS_ADDRESS");
    expect(credentialName(xdr.SorobanCredentials.sorobanCredentialsAddressV2(addrCreds()))).toBe("SOROBAN_CREDENTIALS_ADDRESS_V2");
    expect(credentialName({ type: "sorobanCredentialsSomethingNew" })).toBe("UNKNOWN(sorobanCredentialsSomethingNew)");
  });

  it("renders source-account, legacy v1 and CAP-71 v2 entries with address, nonce and root call", () => {
    const lines = authEntryLines(
      [
        entry(xdr.SorobanCredentials.sorobanCredentialsSourceAccount()),
        entry(xdr.SorobanCredentials.sorobanCredentialsAddress(addrCreds())),
        entry(xdr.SorobanCredentials.sorobanCredentialsAddressV2(addrCreds())),
      ],
      "auth",
    ).join("\n");
    expect(lines).toContain("auth.len: 3");
    expect(lines).toContain("auth[0].credentials.type: SOROBAN_CREDENTIALS_SOURCE_ACCOUNT  (covered by the transaction signature)");
    expect(lines).toMatch(/auth\[1\]\.credentials\.type: SOROBAN_CREDENTIALS_ADDRESS .*legacy v1/);
    expect(lines).toContain("auth[2].credentials.type: SOROBAN_CREDENTIALS_ADDRESS_V2");
    expect(lines).toContain(`auth[2].credentials.address: ${g}`);
    expect(lines).toContain("auth[2].credentials.nonce: 42");
    expect(lines).toContain("auth[2].credentials.signatureExpirationLedger: 1234");
    expect(lines).toContain(`auth[2].rootInvocation: ${LENDING.pool}.borrow(${g}, 5)`);
  });

  it("lists CAP-71 delegates", () => {
    const withDelegates = xdr.SorobanCredentials.sorobanCredentialsAddressWithDelegates(
      new xdr.SorobanAddressCredentialsWithDelegates({
        addressCredentials: addrCreds(OWNER),
        delegates: [new xdr.SorobanDelegateSignature({ address: new Address(d).toScAddress(), signature: xdr.ScVal.scvVoid(), nestedDelegates: [] })],
      }),
    );
    const text = authEntryLines([entry(withDelegates)], "auth").join("\n");
    expect(text).toContain("SOROBAN_CREDENTIALS_ADDRESS_WITH_DELEGATES");
    expect(text).toContain(`auth[0].credentials.address: ${OWNER}`);
    expect(text).toContain(`auth[0].credentials.delegates[0]: ${d}  (unsigned)`);
  });

  it("never throws on an entry it cannot decode", () => {
    const broken = { credentials: { type: "sorobanCredentialsFromTheFuture" }, rootInvocation: null } as unknown as xdr.SorobanAuthorizationEntry;
    const text = authEntryLines([broken], "auth").join("\n");
    expect(text).toContain("UNKNOWN(sorobanCredentialsFromTheFuture)");
    expect(text).toContain("do not sign");
    expect(authEntryLines(undefined, "auth")).toEqual(["auth.len: 0"]);
  });

  it("shows auth entries inside the full Txrep of a prepared transaction", () => {
    const src = Keypair.random().publicKey();
    const op = Operation.invokeHostFunction({
      func: xdr.HostFunction.hostFunctionTypeInvokeContract(new xdr.InvokeContractArgs({ contractAddress: POOL.address().toScAddress(), functionName: "borrow", args: [addrv(g), i128v(5n)] })),
      auth: [entry(xdr.SorobanCredentials.sorobanCredentialsAddressV2(addrCreds()))],
    });
    const tx = new TransactionBuilder(new Account(src, "1"), { fee: "100", networkPassphrase: Networks.TESTNET }).addOperation(op).setTimeout(60).build();
    const text = txrep(tx).join("\n");
    expect(text).toContain("invokeHostFunctionOp.auth.len: 1");
    expect(text).toContain("invokeHostFunctionOp.auth[0].credentials.type: SOROBAN_CREDENTIALS_ADDRESS_V2");
  });
});

describe("CAP-85 executables and ScVal arms", () => {
  const ext = xdr.ContractExecutable.contractExecutableExternalRef(new xdr.ContractExecutableExternalRef({ executableOwner: new Address(OWNER).toScAddress(), tag: "amm-v3" }));

  it("describes WASM, SAC and external-ref executables", () => {
    expect(executableText(xdr.ContractExecutable.contractExecutableWasm(new Uint8Array(32).fill(0xab)))).toBe(`CONTRACT_EXECUTABLE_WASM ${"ab".repeat(32)}`);
    expect(executableText(xdr.ContractExecutable.contractExecutableStellarAsset())).toBe("CONTRACT_EXECUTABLE_STELLAR_ASSET");
    expect(executableText(ext)).toMatch(new RegExp(`^CONTRACT_EXECUTABLE_EXTERNAL_REF owner ${OWNER} tag "amm-v3"`));
  });

  it("flags deploys (incl. external-ref) in the Txrep instead of dropping them", () => {
    const fn = xdr.HostFunction.hostFunctionTypeCreateContractV2(
      new xdr.CreateContractArgsV2({
        contractIdPreimage: xdr.ContractIdPreimage.contractIdPreimageFromAddress(new xdr.ContractIdPreimageFromAddress({ address: new Address(g).toScAddress(), salt: new Uint8Array(32) })),
        executable: ext,
        constructorArgs: [],
      }),
    );
    const lines = hostFunctionLines(fn, "hf").join("\n");
    expect(lines).toContain("HOST_FUNCTION_TYPE_CREATE_CONTRACT_V2  (deploys a contract: not a plain call)");
    expect(lines).toContain("CONTRACT_EXECUTABLE_EXTERNAL_REF");
    const tx = new TransactionBuilder(new Account(g, "1"), { fee: "100", networkPassphrase: Networks.TESTNET })
      .addOperation(Operation.invokeHostFunction({ func: fn, auth: [] })).setTimeout(60).build();
    expect(txrep(tx).join("\n")).toContain("CONTRACT_EXECUTABLE_EXTERNAL_REF");
  });

  it("renders bytes, non-UTF-8 strings and executable tags readably", () => {
    expect(scValText(xdr.ScVal.scvBytes(new Uint8Array([1, 0xff])))).toBe("0x01ff");
    expect(scValText(xdr.ScVal.scvString(new Uint8Array([0xff, 0xfe])))).toBe("0xfffe  (string, not valid UTF-8)");
    expect(scValText(xdr.ScVal.scvString("hi"))).toBe('"hi"');
    expect(scValText(xdr.ScVal.scvExecutableTag("amm-v3"))).toBe('executable tag "amm-v3"  (CAP-85)');
    expect(scValText(nativeToScVal({ a: 1n, b: new Uint8Array([2]) }))).toBe('{"a":"1","b":"0x02"}');
    expect(scValText(xdr.ScVal.scvVoid())).toBe("void");
  });
});

describe("source-only auth guard (wallet signs the envelope only)", () => {
  it("passes source-account auth and refuses address arms by name", async () => {
    const { assertSourceOnlyAuth } = await import("../src/lib/xdrDescribe");
    expect(() => assertSourceOnlyAuth("supply", [entry(xdr.SorobanCredentials.sorobanCredentialsSourceAccount())])).not.toThrow();
    expect(() => assertSourceOnlyAuth("supply", undefined)).not.toThrow();
    expect(() => assertSourceOnlyAuth("borrow", [entry(xdr.SorobanCredentials.sorobanCredentialsAddressV2(addrCreds()))])).toThrow(/borrow needs a separate authorization signature \(SOROBAN_CREDENTIALS_ADDRESS_V2\)/);
  });
});
