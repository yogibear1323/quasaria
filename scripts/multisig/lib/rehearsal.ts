// Pure helpers for the testnet rehearsal (contract list, device keys, state).
import { StrKey } from "@stellar/stellar-sdk";

export interface Devices {
  A1: string;
  A2: string;
  A3: string;
  G1: string;
  G2: string;
}

export interface RehearsalState {
  network: "testnet";
  A: string;
  G: string;
  devices: Devices;
  createdAt: string;
}

export interface ContractRef {
  name: string;
  id: string;
}

/** Device public keys must be valid, distinct and not hot/dev keys. */
export function validateDevices(d: Partial<Devices>, deny: string[] = []): string[] {
  const errs: string[] = [];
  const seen = new Map<string, string>();
  for (const n of ["A1", "A2", "A3", "G1", "G2"] as const) {
    const k = d[n];
    if (!k) {
      errs.push(`--${n.toLowerCase()} is required`);
      continue;
    }
    if (!StrKey.isValidEd25519PublicKey(k)) errs.push(`${n} is not a valid G... public key`);
    if (seen.has(k)) errs.push(`${n} duplicates ${seen.get(k)}: every role needs its own device key`);
    seen.set(k, n);
    if (deny.includes(k)) errs.push(`${n} is a hot/dev key from deployments/testnet.json`);
  }
  return errs;
}

const SKIP = new Set(["xlmSac", "qusdSac"]);

/** Governed v3 contracts from deployments/testnet.json (+ optionally the 52 asset pools). */
export function rehearsalContracts(dep: any, assets?: any, opts: { includeAssetPools?: boolean; only?: string[] } = {}): ContractRef[] {
  const out: ContractRef[] = [];
  const seen = new Set<string>();
  const add = (name: string, id: unknown) => {
    if (typeof id !== "string" || !StrKey.isValidContract(id) || seen.has(id)) return;
    seen.add(id);
    out.push({ name, id });
  };
  for (const [name, id] of Object.entries(dep.contracts ?? {})) if (!SKIP.has(name)) add(name, id);
  if (dep.lending?.pool) add("lending", dep.lending.pool);
  if (opts.includeAssetPools && assets?.pools) {
    for (const p of assets.pools) add(`pool:${p.id}`, p.pool);
  }
  if (opts.only?.length) {
    const want = new Set(opts.only);
    const sel = out.filter((c) => want.has(c.name) || want.has(c.id));
    const missing = opts.only.filter((w) => !sel.some((c) => c.name === w || c.id === w));
    if (missing.length) throw new Error(`unknown contract(s): ${missing.join(", ")}`);
    return sel;
  }
  return out;
}

/** Expected-vs-actual comparison rows for `check`. */
export function compareRoles(
  rows: { name: string; admin?: string | null; guardian?: string | null; pending?: string | null; error?: string }[],
  A: string,
  G: string,
) {
  return rows.map((r) => {
    const problems: string[] = [];
    if (r.error) problems.push(r.error);
    else {
      if (r.admin !== A) problems.push(`admin ${r.admin} != A`);
      if (r.guardian !== G) problems.push(`guardian ${r.guardian} != G`);
      if (r.pending) problems.push(`pending_admin still set (${r.pending})`);
    }
    return { ...r, ok: problems.length === 0, problems };
  });
}

/** Check A/G account configuration as read from Horizon. */
export function checkAccountConfig(
  label: string,
  st: { masterWeight: number; signers: { key: string; weight: number }[]; thresholds: { low: number; med: number; high: number } },
  expectSigners: string[],
  expectThresholds: { low: number; med: number; high: number },
): string[] {
  const p: string[] = [];
  if (st.masterWeight !== 0) p.push(`${label}: master key weight ${st.masterWeight} (expected 0)`);
  const keys = st.signers.map((s) => s.key).sort();
  const want = [...expectSigners].sort();
  if (JSON.stringify(keys) !== JSON.stringify(want)) p.push(`${label}: signers ${keys.join(",")} != expected ${want.join(",")}`);
  for (const s of st.signers) if (s.weight !== 1) p.push(`${label}: signer ${s.key} weight ${s.weight} (expected 1)`);
  const t = st.thresholds;
  if (t.low !== expectThresholds.low || t.med !== expectThresholds.med || t.high !== expectThresholds.high) {
    p.push(`${label}: thresholds ${t.low}/${t.med}/${t.high} != expected ${expectThresholds.low}/${expectThresholds.med}/${expectThresholds.high}`);
  }
  return p;
}
