// Human-readable decode of a transaction envelope.
//
// * `toTxrep`: SEP-11 Txrep-*style* flat `path: value` lines, generated from
//   the canonical stellar-xdr JSON form of the envelope (the same JSON the
//   Rust `stellar tx decode --output json` prints, so a second machine can
//   reproduce it independently). Keys are camelCased as in SEP-11, arrays get
//   a `.len` line, absent optionals print `._present: false`.
// * `summarize`: a plain-English summary for the signer (who/what/when/fees,
//   decoded contract call arguments, auth entries, set_options effects).
import { Address, StrKey, TransactionBuilder, scValToNative, xdr } from "@stellar/stellar-sdk";
import { envelopeSignatures } from "./hash.ts";
import { phoenixTime } from "./args.ts";

const camel = (k: string) => k.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
const STRKEY_RE = /^[GCMTPXB][A-Z2-7]{55,}$/;

function scalar(v: unknown): string {
  if (typeof v === "string") {
    if (STRKEY_RE.test(v) || /^-?\d+$/.test(v) || /^[0-9a-f]+$/i.test(v)) return v;
    return JSON.stringify(v);
  }
  return String(v);
}

function walk(v: unknown, path: string, out: string[]): void {
  if (v === null || v === undefined) {
    out.push(`${path}._present: false`);
    return;
  }
  if (Array.isArray(v)) {
    out.push(`${path}.len: ${v.length}`);
    v.forEach((x, i) => walk(x, `${path}[${i}]`, out));
    return;
  }
  if (typeof v === "object") {
    const entries = Object.entries(v as Record<string, unknown>);
    if (entries.length === 0) {
      out.push(`${path}: {}`);
      return;
    }
    for (const [k, x] of entries) walk(x, `${path}.${camel(k)}`, out);
    return;
  }
  out.push(`${path}: ${scalar(v)}`);
}

export function envelopeJson(envB64: string): any {
  return JSON.parse(JSON.stringify(xdr.TransactionEnvelope.fromXDR(envB64.trim(), "base64")));
}

/** SEP-11-style flat representation. */
export function toTxrep(envB64: string): string {
  const j = envelopeJson(envB64);
  const out: string[] = [];
  if (j.tx) {
    out.push("type: ENVELOPE_TYPE_TX");
    walk(j.tx.tx, "tx", out);
    walk(j.tx.signatures, "signatures", out);
  } else if (j.tx_fee_bump) {
    out.push("type: ENVELOPE_TYPE_TX_FEE_BUMP");
    walk(j.tx_fee_bump.tx, "feeBump.tx", out);
    walk(j.tx_fee_bump.signatures, "feeBump.signatures", out);
  } else {
    throw new Error("unsupported envelope type (v0)");
  }
  return out.join("\n") + "\n";
}

// ------------------------------------------------------------ summary

const stroopsToXlm = (s: string | number | bigint) => {
  const n = BigInt(s);
  const neg = n < 0n;
  const a = neg ? -n : n;
  return `${neg ? "-" : ""}${a / 10_000_000n}.${(a % 10_000_000n).toString().padStart(7, "0")} XLM`;
};

/** ScVal (canonical JSON form) -> compact readable string via the SDK decoder. */
export function scvalReadable(scJson: unknown): string {
  try {
    const sv = scvalFromJson(scJson);
    if (!sv) return JSON.stringify(scJson);
    return JSON.stringify(scValToNative(sv), (_k, x) => (typeof x === "bigint" ? x.toString() : x));
  } catch {
    return JSON.stringify(scJson);
  }
}

// Rebuild an ScVal from canonical JSON for the native decoder (only the
// shapes contract calls use; anything else falls back to raw JSON).
function scvalFromJson(j: any): xdr.ScVal | null {
  if (j === "void") return xdr.ScVal.scvVoid();
  if (typeof j !== "object" || j === null) return null;
  const [k, v] = Object.entries(j)[0] as [string, any];
  switch (k) {
    case "bool": return xdr.ScVal.scvBool(v);
    case "u32": return xdr.ScVal.scvU32(v);
    case "i32": return xdr.ScVal.scvI32(v);
    case "u64": return xdr.ScVal.scvU64(xdr.Uint64.fromString(BigInt(v).toString()));
    case "i64": return xdr.ScVal.scvI64(xdr.Int64.fromString(BigInt(v).toString()));
    case "symbol": return xdr.ScVal.scvSymbol(v);
    case "string": return xdr.ScVal.scvString(v);
    case "bytes": return xdr.ScVal.scvBytes(Buffer.from(v, "hex"));
    case "address": return new Address(v).toScVal();
    case "vec": {
      const items = (v as any[]).map(scvalFromJson);
      return items.some((x) => !x) ? null : xdr.ScVal.scvVec(items as xdr.ScVal[]);
    }
    case "map": {
      const entries = (v as any[]).map((e) => {
        const kk = scvalFromJson(e.key), vv = scvalFromJson(e.val);
        return kk && vv ? new xdr.ScMapEntry({ key: kk, val: vv }) : null;
      });
      return entries.some((x) => !x) ? null : xdr.ScVal.scvMap(entries as xdr.ScMapEntry[]);
    }
    default: return null; // i128/u128/u256/... -> raw JSON is already readable
  }
}

function describeScArg(j: unknown): string {
  const r = scvalReadable(j);
  return r.length > 600 ? r.slice(0, 600) + "…" : r;
}

function describeOp(op: any, i: number, lines: string[]) {
  const src = op.source_account ? ` (op source ${op.source_account})` : "";
  const [kind, body] = Object.entries(op.body)[0] as [string, any];
  if (kind === "invoke_host_function") {
    const hf = body.host_function;
    if (hf.invoke_contract) {
      const ic = hf.invoke_contract;
      lines.push(`  [${i}] INVOKE CONTRACT ${ic.contract_address}${src}`);
      lines.push(`      function: ${ic.function_name}`);
      (ic.args as unknown[]).forEach((a, n) => lines.push(`      arg${n}: ${describeScArg(a)}`));
    } else {
      lines.push(`  [${i}] HOST FUNCTION ${Object.keys(hf)[0]}${src}  <-- not a plain contract call, inspect the Txrep`);
    }
    const auth = body.auth as any[];
    lines.push(`      auth entries: ${auth.length}`);
    auth.forEach((e, n) => {
      const cred = typeof e.credentials === "string" ? e.credentials : Object.keys(e.credentials)[0];
      const who = typeof e.credentials === "object" && e.credentials.address ? ` address=${e.credentials.address.address}` : "";
      const root = e.root_invocation?.function?.contract_fn;
      lines.push(`        #${n}: ${cred}${who}${root ? ` -> ${root.contract_address}.${root.function_name}` : ""}`);
    });
  } else if (kind === "set_options") {
    lines.push(`  [${i}] SET_OPTIONS${src}`);
    if (body.signer) lines.push(`      signer: ${body.signer.key} weight ${body.signer.weight}${body.signer.weight === 0 ? " (REMOVE)" : ""}`);
    if (body.master_weight !== null) lines.push(`      master key weight: ${body.master_weight}${body.master_weight === 0 ? " (MASTER KEY DISABLED)" : ""}`);
    for (const t of ["low_threshold", "med_threshold", "high_threshold"]) if (body[t] !== null) lines.push(`      ${t}: ${body[t]}`);
    if (body.home_domain !== null) lines.push(`      home_domain: ${JSON.stringify(body.home_domain)}`);
    if (body.inflation_dest !== null) lines.push(`      inflation_dest: ${body.inflation_dest}`);
    if (body.set_flags !== null) lines.push(`      set_flags: ${body.set_flags}`);
    if (body.clear_flags !== null) lines.push(`      clear_flags: ${body.clear_flags}`);
  } else {
    lines.push(`  [${i}] ${kind.toUpperCase()}${src}: ${JSON.stringify(body)}`);
  }
}

export function summarize(envB64: string, passphrase: string, hashHex?: string): string {
  const j = envelopeJson(envB64);
  if (!j.tx) throw new Error("only regular (v1) transaction envelopes are summarised");
  const t = j.tx.tx;
  const lines: string[] = [];
  lines.push(`Network passphrase: ${passphrase}`);
  lines.push(`Transaction source: ${t.source_account}`);
  lines.push(`Sequence number:    ${t.seq_num}`);
  lines.push(`Max fee:            ${stroopsToXlm(t.fee)} (${t.fee} stroops, inclusion + resource fee)`);
  const tb = t.cond?.time ?? null;
  if (tb) {
    lines.push(`Valid from:         ${phoenixTime(Number(tb.min_time))}`);
    lines.push(`Valid until:        ${phoenixTime(Number(tb.max_time))}`);
  } else {
    lines.push(`Preconditions:      ${JSON.stringify(t.cond)}`);
  }
  lines.push(`Memo:               ${JSON.stringify(t.memo)}`);
  lines.push(`Operations:         ${t.operations.length}`);
  t.operations.forEach((op: any, i: number) => describeOp(op, i, lines));
  if (t.ext && t.ext.v1) {
    const r = t.ext.v1.resources;
    lines.push(`Soroban resources:  instructions ${r.instructions}, disk read bytes ${r.disk_read_bytes ?? r.read_bytes}, write bytes ${r.write_bytes}`);
    lines.push(`                    footprint read-only ${r.footprint.read_only.length}, read-write ${r.footprint.read_write.length}; resource fee ${stroopsToXlm(t.ext.v1.resource_fee)}`);
  }
  const sigs = envelopeSignatures(j);
  lines.push(`Signatures:         ${sigs.length}${sigs.length ? " (" + sigs.map((s) => "hint " + s.hint).join(", ") + ")" : " (UNSIGNED)"}`);
  const h = hashHex ?? Buffer.from(TransactionBuilder.fromXDR(envB64, passphrase).hash()).toString("hex");
  lines.push(`Transaction hash:   ${h}`);
  return lines.join("\n") + "\n";
}

export const isAccountId = (g: string) => StrKey.isValidEd25519PublicKey(g);
export const isContractId = (c: string) => StrKey.isValidContract(c);
