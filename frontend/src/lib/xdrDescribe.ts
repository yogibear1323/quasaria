/**
 * Defensive, human-readable descriptions of the Soroban XDR shapes a signer
 * needs to see, covering every arm in the protocol 27/28 XDR (stellar-xdr v28):
 *
 *  - Soroban auth credentials: SOURCE_ACCOUNT, legacy ADDRESS (v1), CAP-71
 *    ADDRESS_V2 and ADDRESS_WITH_DELEGATES.
 *  - Contract executables: WASM, STELLAR_ASSET and the CAP-85 EXTERNAL_REF.
 *  - ScVal leaves, including the CAP-85 SCV_EXECUTABLE_TAG and byte payloads
 *    (stellar-sdk v17 returns a Uint8Array for bytes and for non-UTF-8 strings).
 *
 * Every function here is total: an arm this code does not know (a future
 * protocol) renders as `UNKNOWN(<sdk arm name>)` plus a warning, never as a
 * crash and never as silently "nothing to see".
 */
import { Address, inspectAuthEntry, scValToNative, xdr } from "@stellar/stellar-sdk";

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

/** JSON.stringify replacer: bigint → decimal string, bytes → 0x-hex. */
export function jsonSafe(_k: string, v: unknown): unknown {
  if (typeof v === "bigint") return v.toString();
  if (v instanceof Uint8Array) return `0x${hex(v)}`;
  return v;
}

/** One-line rendering of an ScVal (Txrep-style leaf). */
export function scValText(v: xdr.ScVal): string {
  try {
    switch (v.type) {
      case "scvAddress": return Address.fromScVal(v).toString();
      case "scvI128": case "scvU128": case "scvI256": case "scvU256":
      case "scvU64": case "scvI64": case "scvU32": case "scvI32":
      case "scvTimepoint": case "scvDuration": case "scvBool":
        return String(scValToNative(v));
      case "scvVoid": return "void";
      case "scvSymbol": return `"${String(scValToNative(v))}"`;
      case "scvBytes": return `0x${hex(scValToNative(v) as Uint8Array)}`;
      case "scvString": {
        const s = scValToNative(v) as string | Uint8Array;
        return typeof s === "string" ? JSON.stringify(s) : `0x${hex(s)}  (string, not valid UTF-8)`;
      }
      case "scvExecutableTag": {
        const t = scValToNative(v) as string | Uint8Array;
        return `executable tag ${typeof t === "string" ? JSON.stringify(t) : `0x${hex(t)}`}  (CAP-85)`;
      }
      case "scvLedgerKeyContractInstance": return "LEDGER_KEY_CONTRACT_INSTANCE";
      default: {
        // JSON.stringify(undefined) is undefined: an arm the SDK maps to
        // nothing (e.g. a future ScVal) must be flagged, not printed as "undefined".
        const s = JSON.stringify(scValToNative(v), jsonSafe);
        return s === undefined ? `UNKNOWN(${String(v.type)})  (WARNING: value type unknown to this app)` : s;
      }
    }
  } catch {
    // An arm the SDK cannot convert natively: show the raw XDR, don't throw.
    try { return `<${String(v.type)}> ${v.toXdr("base64")}`; } catch { return `<undecodable ScVal>`; }
  }
}

/** XDR enum names for the credential arms (as SEP-11 Txrep prints them). */
export const CREDENTIAL_NAMES: Record<string, string> = {
  sorobanCredentialsSourceAccount: "SOROBAN_CREDENTIALS_SOURCE_ACCOUNT",
  sorobanCredentialsAddress: "SOROBAN_CREDENTIALS_ADDRESS",
  sorobanCredentialsAddressV2: "SOROBAN_CREDENTIALS_ADDRESS_V2",
  sorobanCredentialsAddressWithDelegates: "SOROBAN_CREDENTIALS_ADDRESS_WITH_DELEGATES",
};

export function credentialName(c: { type: string }): string {
  return CREDENTIAL_NAMES[c.type] ?? `UNKNOWN(${c.type})`;
}

/** Executable (WASM / SAC / CAP-85 external ref) as a short phrase. */
export function executableText(e: xdr.ContractExecutable): string {
  switch (e.type) {
    case "contractExecutableWasm": return `CONTRACT_EXECUTABLE_WASM ${e.wasmHash.toString()}`;
    case "contractExecutableStellarAsset": return "CONTRACT_EXECUTABLE_STELLAR_ASSET";
    case "contractExecutableExternalRef": {
      let owner = "<unreadable owner>";
      try { owner = Address.fromScAddress(e.externalRef.executableOwner).toString(); } catch { /* keep placeholder */ }
      const tag = e.externalRef.tag.asStringOrBytes();
      return `CONTRACT_EXECUTABLE_EXTERNAL_REF owner ${owner} tag ${typeof tag === "string" ? JSON.stringify(tag) : `0x${hex(tag)}`}  (CAP-85: code is whatever the owner contract's tag points to, now or later)`;
    }
    default: return `UNKNOWN(${(e as { type: string }).type})`;
  }
}

function fnText(f: xdr.SorobanAuthorizedFunction): string {
  switch (f.type) {
    case "sorobanAuthorizedFunctionTypeContractFn": {
      const a = f.contractFn;
      return `${Address.fromScAddress(a.contractAddress).toString()}.${a.functionName.toString()}(${a.args.map(scValText).join(", ")})`;
    }
    case "sorobanAuthorizedFunctionTypeCreateContractHostFn":
      return `CREATE_CONTRACT ${executableText(f.createContractHostFn.executable)}`;
    case "sorobanAuthorizedFunctionTypeCreateContractV2HostFn":
      return `CREATE_CONTRACT_V2 ${executableText(f.createContractV2HostFn.executable)}`;
    default: return `UNKNOWN(${(f as { type: string }).type})`;
  }
}

/** Notes a signer should see for a given credential arm (hardware-wallet support as of Oct 2026). */
export function credentialNote(name: string): string | null {
  switch (name) {
    case "SOROBAN_CREDENTIALS_SOURCE_ACCOUNT": return "covered by the transaction signature";
    case "SOROBAN_CREDENTIALS_ADDRESS": return "legacy v1 credential: Trezor firmware refuses it; prefer ADDRESS_V2";
    case "SOROBAN_CREDENTIALS_ADDRESS_V2": return "CAP-71 address-bound credential";
    case "SOROBAN_CREDENTIALS_ADDRESS_WITH_DELEGATES": return "CAP-71 delegated auth: every delegate below signs separately";
    default: return "WARNING: credential type unknown to this app, do not sign unless you can decode it elsewhere";
  }
}

/**
 * Txrep-style lines for an operation's auth entries. Never throws: an entry
 * that cannot be decoded is reported as such (with a do-not-sign warning).
 */
export function authEntryLines(auth: readonly xdr.SorobanAuthorizationEntry[] | null | undefined, prefix: string): string[] {
  const entries = auth ?? [];
  const lines = [`${prefix}.len: ${entries.length}`];
  entries.forEach((e, n) => {
    const p = `${prefix}[${n}]`;
    let name = "UNKNOWN";
    try { name = credentialName(e.credentials); } catch { /* keep UNKNOWN */ }
    const note = credentialNote(name);
    lines.push(`${p}.credentials.type: ${name}${note ? `  (${note})` : ""}`);
    try {
      const info = inspectAuthEntry(e);
      if (info.address) {
        lines.push(`${p}.credentials.address: ${info.address}`, `${p}.credentials.nonce: ${info.nonce}`, `${p}.credentials.signatureExpirationLedger: ${info.signatureExpirationLedger}`);
        info.signers.slice(1).forEach((s, d) => lines.push(`${p}.credentials.delegates[${d}]: ${s.address}${s.signed ? "  (signed)" : "  (unsigned)"}`));
      }
      lines.push(`${p}.rootInvocation: ${fnText(info.invocation.function)}`);
      const subs = info.invocation.subInvocations.length;
      if (subs) lines.push(`${p}.rootInvocation.subInvocations.len: ${subs}`);
    } catch {
      lines.push(`${p}: <could not decode this auth entry: do not sign>`);
    }
  });
  return lines;
}

/** Lines for a host function that is NOT a plain contract call (deploys, uploads). */
export function hostFunctionLines(fn: xdr.HostFunction, prefix: string): string[] {
  switch (fn.type) {
    case "hostFunctionTypeInvokeContract": return [`${prefix}.type: HOST_FUNCTION_TYPE_INVOKE_CONTRACT`];
    case "hostFunctionTypeCreateContract":
      return [`${prefix}.type: HOST_FUNCTION_TYPE_CREATE_CONTRACT  (deploys a contract: not a plain call)`, `${prefix}.createContract.executable: ${executableText(fn.createContract.executable)}`];
    case "hostFunctionTypeCreateContractV2":
      return [
        `${prefix}.type: HOST_FUNCTION_TYPE_CREATE_CONTRACT_V2  (deploys a contract: not a plain call)`,
        `${prefix}.createContractV2.executable: ${executableText(fn.createContractV2.executable)}`,
        `${prefix}.createContractV2.constructorArgs.len: ${fn.createContractV2.constructorArgs.length}`,
      ];
    case "hostFunctionTypeUploadContractWasm":
      return [`${prefix}.type: HOST_FUNCTION_TYPE_UPLOAD_CONTRACT_WASM  (${fn.wasm.length} bytes of contract code: not a plain call)`];
    default:
      return [`${prefix}.type: UNKNOWN(${(fn as { type: string }).type})  (WARNING: unknown host function, do not sign)`];
  }
}

/**
 * The app's wallets (Freighter, in-app key) sign only the transaction envelope, which
 * satisfies SOURCE_ACCOUNT auth and nothing else. If simulation asks for another arm
 * (legacy ADDRESS, CAP-71 ADDRESS_V2 / WITH_DELEGATES, or a future arm), stop before
 * the wallet prompt instead of letting the user pay for a transaction that must fail.
 */
export function assertSourceOnlyAuth(method: string, auth: readonly xdr.SorobanAuthorizationEntry[] | undefined): void {
  const foreign = (auth ?? []).map((e) => credentialName(e.credentials)).filter((n) => n !== "SOROBAN_CREDENTIALS_SOURCE_ACCOUNT");
  if (foreign.length) throw new Error(`${method} needs a separate authorization signature (${foreign.join(", ")}), which this app's wallet flow does not support`);
}
