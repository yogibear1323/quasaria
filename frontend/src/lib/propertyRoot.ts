/**
 * PropertyRoot testnet demo helpers. Pure logic here (appraisal simulation, yield
 * estimate) so it can be unit-tested; chain calls go through lib/soroban.
 * Everything is TESTNET ONLY. Appraisal, title and KYC are simulated.
 */
import { nativeToScVal } from "@stellar/stellar-sdk";
import dep from "../config/propertyroot-testnet.json";
import { addr, i128, invokeContract, readContract, u64 } from "./soroban";

export const PR = dep;
export const STROOP = 10_000_000;
export const LTV_BPS = dep.params.ltvBps;
export const DEMO_CAP_USD = dep.params.demoCapUsd;

export type PropertyType = "single-family" | "townhouse" | "condo" | "farmland" | "raw-land";
export const TYPES: { id: PropertyType; label: string; perUnit: number; unit: "sqft" | "acre" }[] = [
  { id: "single-family", label: "Single-family home", perUnit: 285, unit: "sqft" },
  { id: "townhouse", label: "Townhouse", perUnit: 255, unit: "sqft" },
  { id: "condo", label: "Condo", perUnit: 240, unit: "sqft" },
  { id: "farmland", label: "Farmland", perUnit: 9_500, unit: "acre" },
  { id: "raw-land", label: "Raw land", perUnit: 4_200, unit: "acre" },
];

export type PropertyInput = { address: string; type: PropertyType; size: number };

/** Small deterministic hash (FNV-1a) so the same input always gets the same simulated appraisal. */
function fnv(s: string) { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h; }

/** SIMULATED appraisal: $/unit by type × size, ±8% deterministic "local market" factor, capped at the demo cap. */
export function simulateAppraisal(p: PropertyInput) {
  const t = TYPES.find((x) => x.id === p.type) ?? TYPES[0];
  const size = Math.max(0, Number(p.size) || 0);
  const factor = 0.92 + (fnv(`${p.address.trim().toLowerCase()}|${p.type}`) % 1601) / 10_000; // 0.92..1.08
  const raw = Math.round((t.perUnit * size * factor) / 100) * 100;
  const value = Math.min(raw, DEMO_CAP_USD);
  return { value, capped: raw > DEMO_CAP_USD, factor, unit: t.unit, titleVerified: size > 0 && p.address.trim().length >= 5, kycVerified: true };
}

export const workingCap = (valueUsd: number, ltvBps = LTV_BPS) => (valueUsd * ltvBps) / 10_000;

/** ESTIMATE: compounded lending yield on the portion put to work. Monthly compounding. */
export function estimateYield(o: { value: number; ltvPct: number; workPct: number; aprPct: number; years: number; xlmUsd?: number }) {
  const working = o.value * (o.ltvPct / 100) * (o.workPct / 100);
  const n = Math.round(o.years * 12);
  const r = o.aprPct / 100 / 12;
  const series: number[] = [];
  let v = working;
  for (let i = 0; i <= n; i++) { series.push(v - working); v *= 1 + r; }
  const earned = series[series.length - 1] ?? 0;
  const simple = working * (o.aprPct / 100) * o.years;
  return { working, earned, simple, compoundBonus: earned - simple, series, apy: (Math.pow(1 + r, 12) - 1) * 100 };
}

export async function sha256Hex(s: string) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
export const bytes32 = (hex: string) => nativeToScVal(Uint8Array.from(hex.match(/../g)!.map((h) => parseInt(h, 16))), { type: "bytes" });
const usd7 = (usd: number) => i128(BigInt(Math.round(usd * 100)) * 100_000n);

export type Attestation = { owner: string; value_usd: bigint; appraisal_hash: unknown; title_verified: boolean; kyc_verified: boolean; simulated: boolean; version: number; timestamp: bigint };
export type Property = { owner: string; token: string; value_usd: bigint; minted: bigint; over_cap: bigint; prt_working: bigint; principal_xlm: bigint; shares: bigint; yield_paid_xlm: bigint; att_version: number };
export type Position = { property: Property; value_xlm: bigint; accrued_yield_xlm: bigint; share_price: bigint };

const C = dep.contracts;
export const readNextId = () => readContract<bigint>(C.attestationRegistry, "next_id");
export const readAttestation = (id: number) => readContract<Attestation>(C.attestationRegistry, "get", [u64(id)]);
export const readTokenized = (id: number) => readContract<boolean>(C.propertyVault, "is_tokenized", [u64(id)]);
export const readPosition = (id: number) => readContract<Position>(C.propertyVault, "position", [u64(id)]);
export const readXlmPrice = async () => { const [p, d, ts] = await readContract<[bigint, number, bigint]>(C.propertyVault, "xlm_price"); return { usd: Number(p) / 10 ** d, ts: Number(ts) }; };
export const readReserve = () => readContract<bigint>(C.propertyVault, "reserve");
export const readSharePrice = () => readContract<bigint>(C.blendAdapter, "share_price");
export const readPrtBalance = (token: string, who: string) => readContract<bigint>(token, "balance", [addr(who)]);

type Sign = (x: string) => Promise<string>;
export const selfAttest = (owner: string, sign: Sign, id: number, valueUsd: number, hashHex: string) =>
  invokeContract(owner, sign, C.attestationRegistry, "self_attest", [u64(id), addr(owner), usd7(valueUsd), bytes32(hashHex)]);
export const tokenize = (owner: string, sign: Sign, id: number) => invokeContract(owner, sign, C.propertyVault, "tokenize", [addr(owner), u64(id)]);
export const putToWork = (owner: string, sign: Sign, id: number, prtUsd: number) => invokeContract(owner, sign, C.propertyVault, "put_to_work", [addr(owner), u64(id), usd7(prtUsd)]);
export const withdrawPosition = (owner: string, sign: Sign, id: number) => invokeContract(owner, sign, C.propertyVault, "withdraw", [addr(owner), u64(id)]);

export const fmtUsd = (n: number, d = 0) => `$${n.toLocaleString("en-US", { maximumFractionDigits: d, minimumFractionDigits: d })}`;
export const fromStroop = (v: bigint | number) => Number(v) / STROOP;
export const STORE_KEY = "propertyroot.demo.v1";
export const WAITLIST_KEY = "propertyroot.waitlist.v1";
