/**
 * Non-custodial key handling. Everything here runs in the browser only:
 * keys are generated with the Web Crypto CSPRNG, never sent anywhere, never
 * logged, and only persisted (optionally) as a password-encrypted blob in
 * this device's localStorage.
 */
import { Keypair, StrKey } from "@stellar/stellar-sdk";

export type NewAccount = { publicKey: string; secret: string };

function requireCsprng() {
  if (typeof globalThis.crypto?.getRandomValues !== "function" || typeof globalThis.crypto?.subtle === "undefined") {
    throw new Error("Secure randomness (Web Crypto) is unavailable in this browser; refusing to create a key.");
  }
}

/**
 * Generate a fresh Ed25519 keypair with stellar-sdk `Keypair.random()`, whose
 * seed comes from tweetnacl's randomBytes → `crypto.getRandomValues` (CSPRNG).
 * We refuse to run at all if Web Crypto is missing, so there is no weak fallback.
 */
export function generateAccount(): NewAccount {
  requireCsprng();
  const kp = Keypair.random();
  return { publicKey: kp.publicKey(), secret: kp.secret() };
}

export const isValidSecret = (s: string) => StrKey.isValidEd25519SecretSeed(s.trim());
export const isValidPublicKey = (s: string) => StrKey.isValidEd25519PublicKey(s.trim());

/** Validate an imported secret and derive its address. Throws on bad input. */
export function importSecret(secret: string): NewAccount {
  const s = secret.trim();
  if (!isValidSecret(s)) throw new Error("That is not a valid Stellar secret key (it should start with S and be 56 characters).");
  return { publicKey: Keypair.fromSecret(s).publicKey(), secret: s };
}

// ---- backup check: the user re-types a random slice of the secret
export type BackupChallenge = { start: number; length: number };

/** Pick a random 6-character window (1-based positions shown to the user), skipping the leading "S". */
export function backupChallenge(length = 6, rand: () => number = secureRandom): BackupChallenge {
  const start = 1 + Math.floor(rand() * (56 - 1 - length));
  return { start, length };
}
export const challengeLabel = (c: BackupChallenge) => `characters ${c.start + 1}–${c.start + c.length}`;
export function checkBackup(secret: string, c: BackupChallenge, input: string) {
  return input.trim().toUpperCase() === secret.slice(c.start, c.start + c.length);
}

function secureRandom() {
  requireCsprng();
  const b = new Uint32Array(1);
  globalThis.crypto.getRandomValues(b);
  return b[0] / 2 ** 32;
}

// ---- optional "remember on this device": PBKDF2-SHA256 → AES-256-GCM
export type EncryptedKey = {
  v: 1;
  kdf: "PBKDF2-SHA256";
  iterations: number;
  salt: string; // base64
  iv: string; // base64
  ciphertext: string; // base64 (AES-GCM, includes auth tag)
  publicKey: string; // not secret; lets the UI show which account is stored
};

export const KEYSTORE_KEY = "quasaria.keystore.v1";
export const DEFAULT_ITERATIONS = 600_000; // OWASP 2023+ guidance for PBKDF2-SHA256
export const MIN_PASSWORD = 8;

const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function deriveKey(password: string, salt: Uint8Array, iterations: number) {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

export async function encryptSecret(secret: string, password: string, iterations = DEFAULT_ITERATIONS): Promise<EncryptedKey> {
  requireCsprng();
  if (password.length < MIN_PASSWORD) throw new Error(`Use a password of at least ${MIN_PASSWORD} characters.`);
  const { publicKey } = importSecret(secret);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt, iterations);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: new TextEncoder().encode(publicKey) }, key, new TextEncoder().encode(secret)));
  return { v: 1, kdf: "PBKDF2-SHA256", iterations, salt: b64(salt), iv: b64(iv), ciphertext: b64(ct), publicKey };
}

export async function decryptSecret(blob: EncryptedKey, password: string): Promise<string> {
  if (blob.v !== 1 || blob.kdf !== "PBKDF2-SHA256") throw new Error("Unsupported keystore format.");
  const key = await deriveKey(password, unb64(blob.salt), blob.iterations);
  let pt: ArrayBuffer;
  try {
    pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(blob.iv) as BufferSource, additionalData: new TextEncoder().encode(blob.publicKey) }, key, unb64(blob.ciphertext) as BufferSource);
  } catch {
    throw new Error("Wrong password (or the stored key is corrupted).");
  }
  const secret = new TextDecoder().decode(pt);
  if (importSecret(secret).publicKey !== blob.publicKey) throw new Error("Stored key does not match its address.");
  return secret;
}

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const store = (): Store | null => (typeof localStorage !== "undefined" ? localStorage : null);

export function loadStoredKey(s: Store | null = store()): EncryptedKey | null {
  try {
    const raw = s?.getItem(KEYSTORE_KEY);
    return raw ? (JSON.parse(raw) as EncryptedKey) : null;
  } catch {
    return null;
  }
}
export function saveStoredKey(blob: EncryptedKey, s: Store | null = store()) {
  s?.setItem(KEYSTORE_KEY, JSON.stringify(blob));
}
/** "Forget this device": remove the encrypted key from localStorage. */
export function forgetStoredKey(s: Store | null = store()) {
  s?.removeItem(KEYSTORE_KEY);
}

// ---- testnet funding
export async function fundWithFriendbot(publicKey: string, f: typeof fetch = fetch) {
  if (!isValidPublicKey(publicKey)) throw new Error("invalid address");
  const r = await f(`https://friendbot.stellar.org/?addr=${encodeURIComponent(publicKey)}`);
  if (!r.ok) {
    const body = await r.text().catch(() => "");
    if (/createAccountAlreadyExist|already funded/i.test(body)) return { alreadyFunded: true };
    throw new Error(`Friendbot failed (${r.status})`);
  }
  return { alreadyFunded: false };
}

/** Download text as a file without any network request. */
export function downloadText(filename: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
