// Transaction hash, computed two independent ways inside this tool plus an
// optional third way with the Rust `stellar` CLI:
//
//  1. SDK: TransactionBuilder.fromXDR(xdr).hash()
//  2. RAW: sha256( sha256(passphrase) || int32(envelope type) || tx bytes ),
//     where the tx bytes are sliced straight out of the ORIGINAL envelope
//     bytes (no re-serialisation): everything between the 4-byte envelope
//     discriminant and the trailing DecoratedSignature<20> array.
//  3. CLI: `stellar tx hash --network-passphrase ...` (separate codebase).
//
// The signer approves only if the hash on the device equals the hash from
// two different machines (runbook step 4).
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { TransactionBuilder, xdr } from "@stellar/stellar-sdk";

const ENVELOPE_TYPE_TX = 2;
const ENVELOPE_TYPE_TX_FEE_BUMP = 5;
const ENVELOPE_TYPE_TX_V0 = 0;

export const sha256 = (b: Uint8Array) => createHash("sha256").update(b).digest();

export function decodeB64(x: string): Buffer {
  const s = x.trim();
  if (!/^[A-Za-z0-9+/=\s]+$/.test(s)) throw new Error("input is not base64 XDR");
  return Buffer.from(s.replace(/\s+/g, ""), "base64");
}

/** Signatures of an envelope (from the canonical JSON form). */
export function envelopeSignatures(envJson: any): { hint: string; signature: string }[] {
  if (envJson.tx) return envJson.tx.signatures ?? [];
  if (envJson.tx_fee_bump) return envJson.tx_fee_bump.signatures ?? [];
  if (envJson.tx_v0) return envJson.tx_v0.signatures ?? [];
  throw new Error("unknown envelope type");
}

const pad4 = (n: number) => (n + 3) & ~3;

/** Hash computed from raw bytes (method 2). */
export function rawHash(envB64: string, passphrase: string): string {
  const bytes = decodeB64(envB64);
  if (bytes.length < 8) throw new Error("envelope too short");
  const type = bytes.readInt32BE(0);
  if (type === ENVELOPE_TYPE_TX_V0) throw new Error("legacy v0 envelopes are not supported; rebuild the transaction");
  if (type !== ENVELOPE_TYPE_TX && type !== ENVELOPE_TYPE_TX_FEE_BUMP) throw new Error(`unknown envelope type ${type}`);
  const env = xdr.TransactionEnvelope.fromXDR(bytes);
  const sigs = envelopeSignatures(JSON.parse(JSON.stringify(env)));
  // DecoratedSignature = opaque hint[4] + opaque signature<64> (len + padded bytes)
  let tail = 4;
  for (const s of sigs) tail += 4 + 4 + pad4(Buffer.from(s.signature, "hex").length);
  // the tail really is the signature array: its count sits right before it
  const countOff = bytes.length - tail;
  if (countOff < 4 || bytes.readUInt32BE(countOff) !== sigs.length) {
    throw new Error("could not locate the signature array in the envelope bytes");
  }
  const txBytes = bytes.subarray(4, countOff);
  const tag = Buffer.alloc(4);
  tag.writeInt32BE(type, 0);
  const payload = Buffer.concat([sha256(Buffer.from(passphrase, "utf8")), tag, txBytes]);
  return sha256(payload).toString("hex");
}

/** Hash via the SDK (method 1). */
export function sdkHash(envB64: string, passphrase: string): string {
  const tx = TransactionBuilder.fromXDR(envB64.trim(), passphrase);
  return Buffer.from(tx.hash()).toString("hex");
}

/** Hash via the Rust stellar CLI (method 3), or null if the CLI is missing. */
export function cliHash(envB64: string, passphrase: string): string | null {
  try {
    return execFileSync("stellar", ["tx", "hash", "--network-passphrase", passphrase], {
      input: envB64.trim(),
      encoding: "utf8",
      stdio: ["pipe", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

/** Canonical stellar-xdr JSON of the envelope from the Rust CLI, or null. */
export function cliDecode(envB64: string): unknown | null {
  try {
    return JSON.parse(
      execFileSync("stellar", ["tx", "decode", "--output", "json"], {
        input: envB64.trim(),
        encoding: "utf8",
        stdio: ["pipe", "pipe", "ignore"],
      }),
    );
  } catch {
    return null;
  }
}

export interface HashReport {
  sdk: string;
  raw: string;
  cli: string | null;
  agree: boolean;
}

export function allHashes(envB64: string, passphrase: string, useCli: boolean): HashReport {
  const sdk = sdkHash(envB64, passphrase);
  const raw = rawHash(envB64, passphrase);
  const cli = useCli ? cliHash(envB64, passphrase) : null;
  const agree = sdk === raw && (cli === null || cli === sdk);
  return { sdk, raw, cli, agree };
}
