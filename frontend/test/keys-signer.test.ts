import { describe, expect, it, vi } from "vitest";
import { Account, Asset, BASE_FEE, Keypair, Networks, Operation, StrKey, TransactionBuilder } from "@stellar/stellar-sdk";
import {
  backupChallenge, checkBackup, decryptSecret, encryptSecret, forgetStoredKey, fundWithFriendbot, generateAccount, importSecret,
  KEYSTORE_KEY, loadStoredKey, saveStoredKey,
} from "../src/lib/keys";
import { FreighterSigner, LocalKeySigner, type Signer } from "../src/lib/signer";

const FAST = 1_000; // PBKDF2 iterations for tests only (app default is 600k)

function unsignedTx(source: string) {
  return new TransactionBuilder(new Account(source, "100"), { fee: BASE_FEE, networkPassphrase: Networks.TESTNET })
    .addOperation(Operation.payment({ destination: Keypair.random().publicKey(), asset: Asset.native(), amount: "1" }))
    .setTimeout(60)
    .build();
}

describe("key generation", () => {
  it("creates valid, unique G/S pairs that match each other", () => {
    const a = generateAccount(), b = generateAccount();
    expect(StrKey.isValidEd25519PublicKey(a.publicKey)).toBe(true);
    expect(StrKey.isValidEd25519SecretSeed(a.secret)).toBe(true);
    expect(Keypair.fromSecret(a.secret).publicKey()).toBe(a.publicKey);
    expect(a.secret).not.toBe(b.secret);
  });
  it("draws randomness from Web Crypto", () => {
    const spy = vi.spyOn(globalThis.crypto, "getRandomValues");
    generateAccount();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
  it("refuses to generate without Web Crypto", () => {
    const orig = globalThis.crypto;
    Object.defineProperty(globalThis, "crypto", { value: undefined, configurable: true });
    try {
      expect(() => generateAccount()).toThrow(/Secure randomness/);
    } finally {
      Object.defineProperty(globalThis, "crypto", { value: orig, configurable: true });
    }
  });
  it("imports / rejects secrets", () => {
    const a = generateAccount();
    expect(importSecret(`  ${a.secret} `).publicKey).toBe(a.publicKey);
    expect(() => importSecret(a.publicKey)).toThrow();
    expect(() => importSecret("SNOTAKEY")).toThrow();
  });
  it("backup check accepts the right slice only", () => {
    const a = generateAccount();
    const c = backupChallenge(6, () => 0.5);
    expect(c.start).toBeGreaterThanOrEqual(1);
    expect(c.start + c.length).toBeLessThanOrEqual(56);
    expect(checkBackup(a.secret, c, a.secret.slice(c.start, c.start + 6).toLowerCase())).toBe(true);
    expect(checkBackup(a.secret, c, "AAAAAA")).toBe(a.secret.slice(c.start, c.start + 6) === "AAAAAA");
  });
});

describe("encryption (PBKDF2 → AES-GCM)", () => {
  it("round-trips and never stores the plaintext", async () => {
    const a = generateAccount();
    const blob = await encryptSecret(a.secret, "correct horse battery", FAST);
    expect(JSON.stringify(blob)).not.toContain(a.secret);
    expect(blob.publicKey).toBe(a.publicKey);
    expect(await decryptSecret(blob, "correct horse battery")).toBe(a.secret);
  });
  it("uses a fresh salt and IV each time", async () => {
    const a = generateAccount();
    const x = await encryptSecret(a.secret, "password123", FAST), y = await encryptSecret(a.secret, "password123", FAST);
    expect(x.salt).not.toBe(y.salt);
    expect(x.iv).not.toBe(y.iv);
    expect(x.ciphertext).not.toBe(y.ciphertext);
  });
  it("rejects wrong passwords, tampering and short passwords", async () => {
    const a = generateAccount();
    const blob = await encryptSecret(a.secret, "password123", FAST);
    await expect(decryptSecret(blob, "password124")).rejects.toThrow(/Wrong password/);
    const ct = atob(blob.ciphertext);
    const flipped = btoa(String.fromCharCode(ct.charCodeAt(0) ^ 1) + ct.slice(1));
    await expect(decryptSecret({ ...blob, ciphertext: flipped }, "password123")).rejects.toThrow();
    await expect(decryptSecret({ ...blob, publicKey: generateAccount().publicKey }, "password123")).rejects.toThrow();
    await expect(encryptSecret(a.secret, "short", FAST)).rejects.toThrow(/at least/);
  });
  it("save / load / forget this device", async () => {
    const m = new Map<string, string>();
    const s = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
    const a = generateAccount();
    saveStoredKey(await encryptSecret(a.secret, "password123", FAST), s);
    expect(m.has(KEYSTORE_KEY)).toBe(true);
    expect(loadStoredKey(s)?.publicKey).toBe(a.publicKey);
    forgetStoredKey(s);
    expect(loadStoredKey(s)).toBeNull();
  });
});

describe("signers", () => {
  it("LocalKeySigner signs locally with a verifiable signature", async () => {
    const a = generateAccount();
    const signer: Signer = new LocalKeySigner(a.secret, Networks.TESTNET);
    expect(signer.address).toBe(a.publicKey);
    const tx = unsignedTx(a.publicKey);
    const signed = TransactionBuilder.fromXDR(await signer.signTransaction(tx.toXDR()), Networks.TESTNET);
    expect(signed.signatures).toHaveLength(1);
    const d = signed.signatures[0] as unknown as { signature: (() => Buffer) | Buffer };
    const sig = typeof d.signature === "function" ? d.signature() : d.signature;
    expect(Keypair.fromPublicKey(a.publicKey).verify(signed.hash(), sig)).toBe(true);
    expect(Keypair.random().verify(signed.hash(), sig)).toBe(false);
  });
  it("does not leak the secret via JSON and refuses to sign after destroy()", async () => {
    const a = generateAccount();
    const s = new LocalKeySigner(a.secret, Networks.TESTNET);
    expect(JSON.stringify(s)).not.toContain(a.secret);
    s.destroy();
    await expect(s.signTransaction(unsignedTx(a.publicKey).toXDR())).rejects.toThrow(/locked/);
  });
  it("FreighterSigner goes through the same interface", async () => {
    const a = generateAccount();
    const fake = vi.fn(async (xdr: string) => ({ signedTxXdr: `signed:${xdr.length}`, signerAddress: a.publicKey }));
    const s: Signer = new FreighterSigner(a.publicKey, Networks.TESTNET, fake as never);
    expect(await s.signTransaction("AAAA")).toBe("signed:4");
    expect(fake).toHaveBeenCalledWith("AAAA", { networkPassphrase: Networks.TESTNET, address: a.publicKey });
  });
});

describe("friendbot", () => {
  it("calls friendbot with the address and treats 'already funded' as success", async () => {
    const a = generateAccount();
    const ok = vi.fn(async (_u: string) => new Response("{}", { status: 200 }));
    await fundWithFriendbot(a.publicKey, ok as unknown as typeof fetch);
    expect(ok.mock.calls[0][0]).toBe(`https://friendbot.stellar.org/?addr=${a.publicKey}`);
    const dup = vi.fn(async () => new Response("op_already_exists createAccountAlreadyExist", { status: 400 }));
    expect(await fundWithFriendbot(a.publicKey, dup as unknown as typeof fetch)).toEqual({ alreadyFunded: true });
    await expect(fundWithFriendbot("GBAD", ok as unknown as typeof fetch)).rejects.toThrow();
  });
});
