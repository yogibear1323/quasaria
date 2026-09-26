/**
 * Signer abstraction shared by the Freighter extension and the in-app
 * (browser-held) key. Every transaction path in the app calls
 * `signer.signTransaction(xdr)` and never touches key material directly.
 */
import { Keypair, TransactionBuilder } from "@stellar/stellar-sdk";
import { signTransaction as freighterSign } from "@stellar/freighter-api";

export interface Signer {
  readonly kind: "freighter" | "local";
  readonly address: string;
  /** Returns the signed transaction envelope XDR. */
  signTransaction(xdr: string): Promise<string>;
}

export class FreighterSigner implements Signer {
  readonly kind = "freighter" as const;
  constructor(readonly address: string, private readonly networkPassphrase: string, private readonly sign = freighterSign) {}
  async signTransaction(xdr: string) {
    const r = await this.sign(xdr, { networkPassphrase: this.networkPassphrase, address: this.address });
    if (r.error) throw new Error(String((r.error as { message?: string }).message ?? r.error));
    return r.signedTxXdr;
  }
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
    if (!this.#kp) throw new Error("This in-app key has been locked; unlock it again to sign.");
    const tx = TransactionBuilder.fromXDR(xdr, this.networkPassphrase);
    tx.sign(this.#kp);
    return tx.toXDR();
  }

  /** Forget the key material (logout / lock). */
  destroy() {
    this.#kp = null;
  }

  toJSON() {
    return { kind: this.kind, address: this.address };
  }
}
