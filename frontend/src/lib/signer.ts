/**
 * Signer for Quasaria's keypair-only accounts. Every transaction path in the app
 * calls `signer.signTransaction(xdr)` and never touches key material directly.
 * There are no wallet extensions or third-party connectors: the key is the
 * account's own secret, held in memory for this session (and, only if the user
 * opts in, kept as a passphrase-encrypted blob in this browser).
 */
import { Keypair, TransactionBuilder } from "@stellar/stellar-sdk";

export interface Signer {
  readonly kind: "local";
  readonly address: string;
  /** Returns the signed transaction envelope XDR. */
  signTransaction(xdr: string): Promise<string>;
}

/**
 * Holds the keypair in memory for this session only. The secret is kept in a
 * private field, is not serializable (toJSON), and is dropped on `destroy()`.
 */
export class LocalKeySigner implements Signer {
  readonly kind = "local" as const;
  readonly address: string;
  #kp: Keypair | null;

  constructor(secret: string, private readonly networkPassphrase: string) {
    this.#kp = Keypair.fromSecret(secret);
    this.address = this.#kp.publicKey();
  }

  async signTransaction(xdr: string) {
    if (!this.#kp) throw new Error("This key has been locked; unlock it again to sign.");
    const tx = TransactionBuilder.fromXDR(xdr, this.networkPassphrase);
    tx.sign(this.#kp);
    return tx.toXDR();
  }

  /** Forget the key material (sign out / lock). */
  destroy() {
    this.#kp = null;
  }

  toJSON() {
    return { kind: this.kind, address: this.address };
  }
}
