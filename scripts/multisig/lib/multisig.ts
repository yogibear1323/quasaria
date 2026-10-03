// Planning, safety checks and dry-run decode for converting an account into a
// Stellar multisig account with ONE transaction (one set_options operation per
// signer, the last one also setting the thresholds and master weight 0), plus
// an offline signature-weight checker for signed envelopes.
import { Account, Keypair, Operation, StrKey, TransactionBuilder } from "@stellar/stellar-sdk";
import { decodeB64, envelopeSignatures, sdkHash } from "./hash.ts";
import { envelopeJson } from "./txrep.ts";

export interface SignerSpec {
  key: string;
  weight: number;
  label?: string;
}

export interface MultisigPlan {
  account: string;
  signers: SignerSpec[];
  low: number;
  med: number;
  high: number;
  masterWeight: number;
  homeDomain?: string;
}

export interface AccountState {
  id: string;
  balanceStroops: bigint;
  subentries: number;
  numSponsoring: number;
  numSponsored: number;
  masterWeight: number;
  signers: { key: string; weight: number }[]; // excluding the master key
  thresholds: { low: number; med: number; high: number };
}

export type Profile = "admin" | "guardian" | "treasury" | "custom";

/** Launch layout from plan §1.4. */
export const PROFILES: Record<Exclude<Profile, "custom">, { low: number; med: number; high: number; singleControl: boolean; minSigners: number }> = {
  admin: { low: 2, med: 2, high: 2, singleControl: false, minSigners: 3 },
  guardian: { low: 1, med: 1, high: 2, singleControl: true, minSigners: 2 },
  treasury: { low: 2, med: 2, high: 2, singleControl: false, minSigners: 3 },
};

export const MAX_SIGNERS = 20;

export interface CheckOptions {
  profile?: Profile;
  denySigners?: string[];
  baseReserveStroops?: bigint;
  allowSingleSignerControl?: boolean;
  keepMaster?: boolean;
}

export interface CheckResult {
  errors: string[];
  warnings: string[];
}

const isByte = (n: number) => Number.isInteger(n) && n >= 0 && n <= 255;

export function checkPlan(plan: MultisigPlan, state?: AccountState, opt: CheckOptions = {}): CheckResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const profile = opt.profile ?? "custom";
  if (!StrKey.isValidEd25519PublicKey(plan.account)) errors.push(`account ${plan.account} is not a valid G... account id`);
  if (plan.signers.length === 0) errors.push("no signers given");
  if (plan.signers.length > MAX_SIGNERS) errors.push(`too many signers (${plan.signers.length} > ${MAX_SIGNERS})`);
  const seen = new Set<string>();
  const deny = new Set(opt.denySigners ?? []);
  for (const s of plan.signers) {
    const tag = s.label ? `${s.label} (${s.key})` : s.key;
    if (!StrKey.isValidEd25519PublicKey(s.key)) errors.push(`signer ${tag} is not a valid ed25519 public key (G...)`);
    if (seen.has(s.key)) errors.push(`duplicate signer ${tag}`);
    seen.add(s.key);
    if (s.key === plan.account) errors.push(`signer ${tag} is the account's own master key (it is being disabled)`);
    if (deny.has(s.key)) errors.push(`signer ${tag} is on the deny list (e.g. a hot/dev key): never a multisig signer`);
    if (!Number.isInteger(s.weight) || s.weight < 1 || s.weight > 255) errors.push(`signer ${tag} weight ${s.weight} must be 1..255`);
  }
  for (const [n, v] of [["low", plan.low], ["med", plan.med], ["high", plan.high], ["master weight", plan.masterWeight]] as const) {
    if (!isByte(v)) errors.push(`${n} threshold ${v} must be an integer 0..255`);
  }
  if (plan.low < 1 || plan.med < 1 || plan.high < 1) errors.push("thresholds must be >= 1 (0 lets any single signature act)");
  if (plan.low > plan.med || plan.med > plan.high) errors.push(`thresholds must satisfy low <= med <= high (got ${plan.low}/${plan.med}/${plan.high})`);
  if (plan.masterWeight !== 0 && !opt.keepMaster) errors.push(`master weight must be 0 (got ${plan.masterWeight}); the master key is a single point of failure`);

  // With --keep-master the master key stays a signer: count its weight in the
  // lockout / single-key-control / lost-device checks below.
  const weights = plan.signers.map((s) => s.weight);
  if (opt.keepMaster && isByte(plan.masterWeight) && plan.masterWeight > 0) weights.push(plan.masterWeight);
  const total = weights.reduce((a, b) => a + b, 0);
  const maxW = weights.length ? Math.max(...weights) : 0;
  if (total < plan.high) errors.push(`LOCKOUT: total signer weight ${total} < high threshold ${plan.high} (signer changes would be impossible forever)`);
  if (total < plan.med) errors.push(`LOCKOUT: total signer weight ${total} < medium threshold ${plan.med} (no admin call could ever be authorised)`);
  const single = weights.some((w) => w >= plan.med);
  if (single) {
    if ((profile === "admin" || profile === "treasury") && !opt.allowSingleSignerControl) {
      errors.push(`a single signer reaches the medium threshold ${plan.med}: that is not multisig (profile ${profile})`);
    } else warnings.push(`a single signature reaches the medium threshold ${plan.med} (expected for the guardian, which must pause alone)`);
  }
  if (total - maxW < plan.med) {
    const msg = `losing the heaviest signer leaves weight ${total - maxW} < medium threshold ${plan.med}: one lost device locks admin calls`;
    if (profile === "admin" || profile === "treasury") errors.push(msg);
    else warnings.push(msg);
  }
  if (total - maxW < plan.high) {
    warnings.push(`losing the heaviest signer leaves weight ${total - maxW} < high threshold ${plan.high}: signer rotation (set_options) would need the remaining keys only if they still reach ${plan.high}`);
  }
  if (profile !== "custom") {
    const p = PROFILES[profile];
    if (plan.low !== p.low || plan.med !== p.med || plan.high !== p.high) {
      warnings.push(`thresholds ${plan.low}/${plan.med}/${plan.high} differ from the ${profile} profile ${p.low}/${p.med}/${p.high} (plan §1.4)`);
    }
    if (plan.signers.length < p.minSigners) warnings.push(`${profile} profile expects at least ${p.minSigners} signers (got ${plan.signers.length})`);
  }

  if (state) {
    if (state.id !== plan.account) errors.push("account state does not belong to the planned account");
    if (state.masterWeight === 0) errors.push("the account's master key is already disabled: it cannot sign this transaction (use the existing signers / a different procedure)");
    if (state.signers.length > 0) {
      errors.push(`the account already has ${state.signers.length} extra signer(s) (${state.signers.map((s) => s.key).join(", ")}): this tool only sets up a fresh account`);
    }
    if (state.thresholds.low > 1 || state.thresholds.med > 1 || state.thresholds.high > 1) {
      errors.push(`the account already has thresholds ${state.thresholds.low}/${state.thresholds.med}/${state.thresholds.high}: refusing to modify a configured account`);
    }
    const reserve = opt.baseReserveStroops ?? 5_000_000n;
    const entries = BigInt(2 + state.subentries + plan.signers.length + state.numSponsoring - state.numSponsored);
    const minBal = entries * reserve;
    const buffer = 10_000_000n; // 1 XLM for fees
    if (state.balanceStroops < minBal + buffer) {
      errors.push(`balance ${fmtXlm(state.balanceStroops)} < new minimum balance ${fmtXlm(minBal)} + 1 XLM fee buffer`);
    }
  }
  return { errors, warnings };
}

export const fmtXlm = (s: bigint) => `${s / 10_000_000n}.${(s % 10_000_000n).toString().padStart(7, "0")} XLM`;

/** One transaction: a set_options per signer; the last op also sets thresholds + master weight. */
export function buildSetOptionsTx(plan: MultisigPlan, account: Account, passphrase: string, timeoutSeconds = 86_400, fee = "1000") {
  if (account.accountId() !== plan.account) throw new Error("source account mismatch");
  const b = new TransactionBuilder(account, { fee, networkPassphrase: passphrase });
  plan.signers.forEach((s, i) => {
    const last = i === plan.signers.length - 1;
    b.addOperation(
      Operation.setOptions({
        signer: { ed25519PublicKey: s.key, weight: s.weight },
        ...(last
          ? {
              masterWeight: plan.masterWeight,
              lowThreshold: plan.low,
              medThreshold: plan.med,
              highThreshold: plan.high,
              ...(plan.homeDomain ? { homeDomain: plan.homeDomain } : {}),
            }
          : {}),
      }),
    );
  });
  return b.setTimeout(timeoutSeconds).build();
}

/** Re-derive the resulting account configuration from an envelope (dry-run decode). */
export function resultingConfig(envB64: string, before: { masterWeight: number; signers: { key: string; weight: number }[]; thresholds: { low: number; med: number; high: number } }) {
  const j = envelopeJson(envB64);
  const t = j.tx.tx;
  const signers = new Map(before.signers.map((s) => [s.key, s.weight]));
  let masterWeight = before.masterWeight;
  const th = { ...before.thresholds };
  let homeDomain: string | null = null;
  for (const op of t.operations) {
    if (op.source_account && op.source_account !== t.source_account) throw new Error("operation with a different source account");
    const so = op.body.set_options;
    if (!so) throw new Error(`unexpected operation ${Object.keys(op.body)[0]} (only set_options allowed)`);
    if (so.inflation_dest !== null || so.set_flags !== null || so.clear_flags !== null) throw new Error("unexpected flags / inflation change");
    if (so.signer) {
      if (so.signer.weight === 0) signers.delete(so.signer.key);
      else signers.set(so.signer.key, so.signer.weight);
    }
    if (so.master_weight !== null) masterWeight = so.master_weight;
    if (so.low_threshold !== null) th.low = so.low_threshold;
    if (so.med_threshold !== null) th.med = so.med_threshold;
    if (so.high_threshold !== null) th.high = so.high_threshold;
    if (so.home_domain !== null) homeDomain = so.home_domain;
  }
  return { account: t.source_account as string, masterWeight, signers: [...signers].map(([key, weight]) => ({ key, weight })), thresholds: th, homeDomain };
}

/** Plain-English description of who can do what after the change. */
export function describeConfig(c: { masterWeight: number; signers: { key: string; weight: number; label?: string }[]; thresholds: { low: number; med: number; high: number } }, labels: Record<string, string> = {}): string {
  const lines: string[] = [];
  lines.push(`Master key weight: ${c.masterWeight}${c.masterWeight === 0 ? " (DISABLED)" : ""}`);
  lines.push(`Signers (${c.signers.length}):`);
  for (const s of c.signers) lines.push(`  - ${labels[s.key] ? labels[s.key] + " " : ""}${s.key} weight ${s.weight}`);
  lines.push(`Thresholds: low ${c.thresholds.low} / medium ${c.thresholds.med} / high ${c.thresholds.high}`);
  const n = c.signers.length;
  if (n > 0 && n <= 12) {
    const ws = c.signers.map((s) => s.weight);
    const minK = (th: number) => {
      for (let k = 1; k <= n; k++) {
        const ok = combos(n, k).every((idx) => idx.reduce((a, i) => a + ws[i], 0) >= th);
        const any = combos(n, k).some((idx) => idx.reduce((a, i) => a + ws[i], 0) >= th);
        if (ok) return `any ${k} of ${n} signers`;
        if (any && k === n) return `only some combinations of ${k}`;
      }
      return "NO combination of signers (LOCKED)";
    };
    lines.push(`Medium-threshold ops (contract admin calls, payments): ${minK(c.thresholds.med)}`);
    lines.push(`High-threshold ops (set_options: signer/threshold changes, merge): ${minK(c.thresholds.high)}`);
    const total = ws.reduce((a, b) => a + b, 0);
    const lose1 = total - Math.max(...ws);
    lines.push(`After losing any one signer: medium ${lose1 >= c.thresholds.med ? "still possible" : "LOCKED"}, high ${lose1 >= c.thresholds.high ? "still possible" : "LOCKED"}`);
  }
  return lines.join("\n");
}

function combos(n: number, k: number): number[][] {
  const out: number[][] = [];
  const rec = (start: number, acc: number[]) => {
    if (acc.length === k) return void out.push([...acc]);
    for (let i = start; i < n; i++) rec(i + 1, [...acc, i]);
  };
  rec(0, []);
  return out;
}

// ------------------------------------------------------------ signature weight check

export interface SigEval {
  hash: string;
  weight: number;
  threshold: number;
  validSigners: string[];
  unknownSignatures: number;
  duplicateSigners: string[];
  extraSignatures: boolean;
  predicted: "PASS" | "FAIL";
  reason: string;
}

/**
 * Predict whether the envelope's signatures satisfy `threshold` for an
 * account with `signers`. Models txBAD_AUTH (weight too low) and
 * txBAD_AUTH_EXTRA (signatures that match no signer, or more valid
 * signatures than the threshold needs).
 */
export function evaluateSignatures(envB64: string, passphrase: string, signers: { key: string; weight: number }[], threshold: number): SigEval {
  decodeB64(envB64);
  const hashHex = sdkHash(envB64, passphrase);
  const hash = Buffer.from(hashHex, "hex");
  const sigs = envelopeSignatures(envelopeJson(envB64));
  const matched = new Map<string, number>();
  let unknown = 0;
  for (const s of sigs) {
    const hint = Buffer.from(s.hint, "hex");
    const sig = Buffer.from(s.signature, "hex");
    const who = signers.find((k) => {
      const raw = Buffer.from(StrKey.decodeEd25519PublicKey(k.key));
      return raw.subarray(28).equals(hint) && Keypair.fromPublicKey(k.key).verify(hash, sig);
    });
    if (!who) unknown++;
    else matched.set(who.key, (matched.get(who.key) ?? 0) + 1);
  }
  const dup = [...matched].filter(([, c]) => c > 1).map(([k]) => k);
  const valid = [...matched.keys()];
  const ws = valid.map((k) => signers.find((s) => s.key === k)!.weight);
  const weight = ws.reduce((a, b) => a + b, 0);
  const extra = unknown > 0 || dup.length > 0 || (ws.length > 0 && weight - Math.min(...ws) >= threshold);
  let predicted: "PASS" | "FAIL" = "PASS";
  let reason = `signature weight ${weight} >= threshold ${threshold}`;
  if (weight < threshold) {
    predicted = "FAIL";
    reason = `txBAD_AUTH: signature weight ${weight} < threshold ${threshold}`;
  } else if (extra) {
    predicted = "FAIL";
    reason = `txBAD_AUTH_EXTRA: ${unknown ? unknown + " signature(s) match no signer; " : ""}${dup.length ? "duplicate signer(s); " : ""}more signatures than needed`;
  }
  return { hash: hashHex, weight, threshold, validSigners: valid, unknownSignatures: unknown, duplicateSigners: dup, extraSignatures: extra, predicted, reason };
}

/** Parse "G...:1[:label]" or "label=G...:1". */
export function parseSignerArg(a: string): SignerSpec {
  let label: string | undefined;
  let rest = a;
  const eq = a.indexOf("=");
  if (eq > 0) {
    label = a.slice(0, eq);
    rest = a.slice(eq + 1);
  }
  const [key, w, l2] = rest.split(":");
  const weight = w === undefined ? 1 : Number(w);
  return { key, weight, label: label ?? l2 };
}
