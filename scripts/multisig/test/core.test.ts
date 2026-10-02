import { test } from "node:test";
import assert from "node:assert/strict";
import { Account, Keypair, Networks, Operation, TransactionBuilder, xdr } from "@stellar/stellar-sdk";
import { refuseSecrets, groupHex } from "../lib/args.ts";
import { resolveNetwork, assertRpcNetwork } from "../lib/network.ts";
import { rawHash, sdkHash, allHashes } from "../lib/hash.ts";
import { toTxrep, summarize } from "../lib/txrep.ts";
import { verify } from "../verify-hash.ts";

const classicTx = (signers = 0) => {
  const src = Keypair.random();
  const tx = new TransactionBuilder(new Account(src.publicKey(), "41"), { fee: "100", networkPassphrase: Networks.TESTNET })
    .addOperation(Operation.bumpSequence({ bumpTo: "50" }))
    .setTimeout(300)
    .build();
  for (let i = 0; i < signers; i++) tx.sign(Keypair.random());
  return tx.toEnvelope().toXDR("base64");
};

test("network: defaults to testnet; mainnet needs --i-understand; cross-network URLs refused", () => {
  assert.equal(resolveNetwork({}).name, "testnet");
  assert.throws(() => resolveNetwork({ network: "mainnet" }), /i-understand/);
  assert.equal(resolveNetwork({ network: "mainnet", iUnderstand: true }).passphrase, Networks.PUBLIC);
  assert.throws(() => resolveNetwork({ network: "futurenet" }), /unknown network/);
  assert.throws(() => resolveNetwork({ network: "testnet", rpcUrl: "https://mainnet.sorobanrpc.com" }), /MAINNET endpoint/);
  assert.throws(() => resolveNetwork({ network: "mainnet", iUnderstand: true, rpcUrl: "https://soroban-testnet.stellar.org" }), /TESTNET endpoint/);
});

test("network: RPC passphrase mismatch is refused", async () => {
  await assert.rejects(assertRpcNetwork({ getNetwork: async () => ({ passphrase: Networks.PUBLIC }) }, resolveNetwork({})), /mismatch/);
});

test("args: secret keys are refused anywhere in argv", () => {
  const s = Keypair.random().secret();
  assert.throws(() => refuseSecrets(["--source", s]), /SECRET/);
  assert.throws(() => refuseSecrets([`--x=${s}`]), /SECRET/);
  refuseSecrets(["--source", Keypair.random().publicKey()]);
  assert.equal(groupHex("a".repeat(64)).split("\n").length, 2);
});

test("hash: SDK, raw-bytes and CLI hashes agree, unsigned and signed", () => {
  for (const n of [0, 1, 2]) {
    const x = classicTx(n);
    assert.equal(rawHash(x, Networks.TESTNET), sdkHash(x, Networks.TESTNET));
    const r = allHashes(x, Networks.TESTNET, true);
    assert.ok(r.agree);
    if (r.cli !== null) assert.equal(r.cli, r.sdk);
  }
});

test("hash: signatures do not change the hash; network and tampering do", () => {
  const src = Keypair.random();
  const tx = new TransactionBuilder(new Account(src.publicKey(), "1"), { fee: "100", networkPassphrase: Networks.TESTNET })
    .addOperation(Operation.bumpSequence({ bumpTo: "9" })).setTimeout(300).build();
  const unsigned = tx.toEnvelope().toXDR("base64");
  tx.sign(Keypair.random());
  const signed = tx.toEnvelope().toXDR("base64");
  assert.equal(sdkHash(unsigned, Networks.TESTNET), sdkHash(signed, Networks.TESTNET));
  assert.notEqual(sdkHash(unsigned, Networks.TESTNET), sdkHash(unsigned, Networks.PUBLIC));
  const env = xdr.TransactionEnvelope.fromXDR(unsigned, "base64") as any;
  const bytes = Buffer.from(env.toXDR());
  bytes[43] ^= 1; // flip a bit of the fee field inside the tx body
  const tampered = bytes.toString("base64");
  assert.notEqual(rawHash(tampered, Networks.TESTNET), rawHash(unsigned, Networks.TESTNET));
});

test("verify-hash: --expect match passes, mismatch and malformed fail", () => {
  const x = classicTx(0);
  const h = sdkHash(x, Networks.TESTNET);
  assert.ok(verify(x, Networks.TESTNET, h, false).ok);
  assert.ok(verify(x, Networks.TESTNET, h.toUpperCase().replace(/(.{4})/g, "$1 "), false).ok, "grouped/uppercase accepted");
  const bad = verify(x, Networks.TESTNET, "0".repeat(64), false);
  assert.equal(bad.ok, false);
  assert.match(bad.problems.join(), /MISMATCH/);
  assert.equal(verify(x, Networks.TESTNET, "xyz", false).ok, false);
  assert.ok(verify(x, Networks.TESTNET, undefined, true).report.agree);
});

test("txrep/summary: decode classic tx", () => {
  const x = classicTx(1);
  const t = toTxrep(x);
  assert.match(t, /^type: ENVELOPE_TYPE_TX$/m);
  assert.match(t, /tx\.operations\[0\]\.body\.bumpSequence\.bumpTo: 50/);
  assert.match(t, /signatures\.len: 1/);
  const s = summarize(x, Networks.TESTNET);
  assert.match(s, /BUMP_SEQUENCE/);
  assert.match(s, new RegExp(sdkHash(x, Networks.TESTNET)));
});

test("summary: protocol 27/28 credential arms are named, with address and delegates", async () => {
  const { Address, Contract } = await import("@stellar/stellar-sdk");
  const src = Keypair.random(), who = Keypair.random().publicKey(), del = Keypair.random().publicKey();
  const c = new Contract("CA3D5KRYM6CB7OWQ6TWYRR3Z4T7GNZLKERYNZGGA5SOAOPIFY6YQGAXE");
  const args = new xdr.InvokeContractArgs({ contractAddress: c.address().toScAddress(), functionName: "propose_action", args: [] });
  const inv = new xdr.SorobanAuthorizedInvocation({ function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(args), subInvocations: [] });
  const ac = new xdr.SorobanAddressCredentials({ address: new Address(who).toScAddress(), nonce: 1n, signatureExpirationLedger: 9, signature: xdr.ScVal.scvVoid() });
  const entries = [
    xdr.SorobanCredentials.sorobanCredentialsSourceAccount(),
    xdr.SorobanCredentials.sorobanCredentialsAddress(ac),
    xdr.SorobanCredentials.sorobanCredentialsAddressV2(ac),
    xdr.SorobanCredentials.sorobanCredentialsAddressWithDelegates(new xdr.SorobanAddressCredentialsWithDelegates({ addressCredentials: ac, delegates: [new xdr.SorobanDelegateSignature({ address: new Address(del).toScAddress(), signature: xdr.ScVal.scvVoid(), nestedDelegates: [] })] })),
  ].map((credentials) => new xdr.SorobanAuthorizationEntry({ credentials, rootInvocation: inv }));
  const env = new TransactionBuilder(new Account(src.publicKey(), "1"), { fee: "100", networkPassphrase: Networks.TESTNET })
    .addOperation(Operation.invokeHostFunction({ func: xdr.HostFunction.hostFunctionTypeInvokeContract(args), auth: entries }))
    .setTimeout(60).build().toEnvelope().toXDR("base64");
  const s = summarize(env, Networks.TESTNET);
  assert.match(s, /#0: source_account -> C/);
  assert.match(s, new RegExp(`#1: address address=${who} .*legacy v1`));
  assert.match(s, new RegExp(`#2: address_v2 address=${who} .*CAP-71`));
  assert.match(s, new RegExp(`#3: address_with_delegates address=${who}`));
  assert.match(s, new RegExp(`delegate ${del} \\(unsigned\\)`));
  assert.match(toTxrep(env), /addressV2|address_v2|addressWithDelegates/);
});
