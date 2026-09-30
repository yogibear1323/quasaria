/**
 * Quasaria lending (TESTNET ONLY, unaudited): config, pure risk math for previews, chain reads,
 * and a SEP-11 Txrep-style rendering of the exact transaction the wallet will sign.
 */
import { Account, Address, BASE_FEE, Contract, Keypair, TransactionBuilder, nativeToScVal, rpc, scValToNative, xdr, type Transaction } from "@stellar/stellar-sdk";
import L from "../config/lending.json";
import { NETWORK_PASSPHRASE, OFFLINE_DEMO } from "./config";
import { soroban } from "./soroban";

export type ReserveConfig = {
  decimals: number; ltv_bps: number; liq_threshold_bps: number; liq_bonus_bps: number; reserve_factor_bps: number;
  supply_cap: string; borrow_cap: string; min_supply: string; min_borrow: string; collateral_enabled: boolean; borrowable: boolean;
  base_rate_bps: number; slope1_bps: number; optimal_util_bps: number; slope2_bps: number;
};
export type LendingAsset = {
  id: string; code: string; canonical: string; testnetCanonical: string; homeDomain: string | null; testnetKind: string;
  testnetCode: string; testnetIssuer: string | null; sac: string; name: string | null; logo: string | null; category: string;
  peg: string | null; offPeg: boolean; tier: string; tierLabel: string; config: ReserveConfig; seedPriceUsd: number;
};
export const LENDING = L as unknown as {
  pool: string; oracle: string; oracleDecimals: number; admin: string; updatedAt: string;
  poolConfig: { maxPriceAgeSec: number; closeFactorBps: number; closeDustUsd: number; maxUserReserves: number; maxBorrowers: number; timelockDelaySec: number };
  reserves: LendingAsset[];
};
export const HF_SCALE = 10_000_000;
export const MAX_I128 = (1n << 127n) - 1n;
const bySac = new Map(LENDING.reserves.map((r) => [r.sac, r]));
export const lendingAssetBySac = (sac: string) => bySac.get(sac);
export const lendingAssetById = (id: string) => LENDING.reserves.find((r) => r.id === id);

// ------------------------------------------------------------------ rate math (mirrors the contract)
export function utilizationBps(cash: number, debt: number) {
  if (debt <= 0) return 0;
  return Math.min(10_000, Math.floor((debt * 10_000) / (cash + debt)));
}
export function borrowRateBps(c: Pick<ReserveConfig, "base_rate_bps" | "slope1_bps" | "optimal_util_bps" | "slope2_bps">, u: number) {
  if (u <= c.optimal_util_bps) return c.base_rate_bps + (c.slope1_bps * u) / c.optimal_util_bps;
  return c.base_rate_bps + c.slope1_bps + (c.slope2_bps * (u - c.optimal_util_bps)) / (10_000 - c.optimal_util_bps);
}
export function supplyRateBps(c: ReserveConfig, u: number) {
  return (borrowRateBps(c, u) * u * (10_000 - c.reserve_factor_bps)) / 1e8;
}
/** APR (bps) → APY (fraction), daily compounding (indices compound on every interaction). */
export const aprToApy = (bps: number) => Math.pow(1 + bps / 10_000 / 365, 365) - 1;

// ------------------------------------------------------------------ account math
export type PositionUsd = { sac: string; suppliedUsd: number; borrowedUsd: number; collateral: boolean; ltvBps: number; thresholdBps: number; collateralEnabled: boolean; supplyApy: number; borrowApy: number };
export type Totals = { collateralUsd: number; borrowLimitUsd: number; thresholdUsd: number; debtUsd: number; suppliedUsd: number; hf: number; limitUsed: number; netApy: number };

export function totals(ps: PositionUsd[]): Totals {
  let col = 0, lim = 0, thr = 0, debt = 0, sup = 0, earn = 0, pay = 0;
  for (const p of ps) {
    sup += p.suppliedUsd;
    earn += p.suppliedUsd * p.supplyApy;
    pay += p.borrowedUsd * p.borrowApy;
    debt += p.borrowedUsd;
    if (p.collateral && p.suppliedUsd > 0) {
      col += p.suppliedUsd;
      if (p.collateralEnabled) lim += (p.suppliedUsd * p.ltvBps) / 10_000;
      thr += (p.suppliedUsd * p.thresholdBps) / 10_000;
    }
  }
  const net = sup - debt;
  return {
    collateralUsd: col, borrowLimitUsd: lim, thresholdUsd: thr, debtUsd: debt, suppliedUsd: sup,
    hf: debt > 0 ? thr / debt : Infinity,
    limitUsed: lim > 0 ? debt / lim : debt > 0 ? Infinity : 0,
    netApy: net > 0 ? (earn - pay) / net : 0,
  };
}

export type Action = "supply" | "withdraw" | "borrow" | "repay";

/** Apply a hypothetical action to the positions (USD) for the preview. */
export function applyAction(ps: PositionUsd[], sac: string, action: Action, usd: number, tmpl: Omit<PositionUsd, "suppliedUsd" | "borrowedUsd">): PositionUsd[] {
  const out = ps.map((p) => ({ ...p }));
  let p = out.find((x) => x.sac === sac);
  if (!p) {
    p = { ...tmpl, suppliedUsd: 0, borrowedUsd: 0, collateral: action === "supply" && tmpl.collateralEnabled };
    out.push(p);
  }
  if (action === "supply") p.suppliedUsd += usd;
  if (action === "withdraw") p.suppliedUsd = Math.max(0, p.suppliedUsd - usd);
  if (action === "borrow") p.borrowedUsd += usd;
  if (action === "repay") p.borrowedUsd = Math.max(0, p.borrowedUsd - usd);
  return out;
}

/**
 * Price (USD) of `sac` at which HF hits 1, other prices fixed. Null if the account has no
 * debt or this asset can't move HF to 1. If the asset is collateral, it's the price it would
 * have to FALL to; if it's debt, the price it would have to RISE to.
 */
export function liquidationPrice(ps: PositionUsd[], sac: string, price: number): number | null {
  const t = totals(ps);
  if (!(t.debtUsd > 0) || !(price > 0)) return null;
  const p = ps.find((x) => x.sac === sac);
  if (!p) return null;
  const units = { col: p.collateral ? p.suppliedUsd / price : 0, debt: p.borrowedUsd / price };
  const thrOther = t.thresholdUsd - (p.collateral ? (p.suppliedUsd * p.thresholdBps) / 10_000 : 0);
  const debtOther = t.debtUsd - p.borrowedUsd;
  // thrOther + units.col*x*thr = debtOther + units.debt*x
  const k = units.col * (p.thresholdBps / 10_000) - units.debt;
  if (Math.abs(k) < 1e-18) return null;
  const x = (debtOther - thrOther) / k;
  return x > 0 && Number.isFinite(x) ? x : null;
}

export type HfTone = "safe" | "warn" | "danger" | "none";
export const hfTone = (hf: number): HfTone => (!Number.isFinite(hf) ? "none" : hf < 1.1 ? "danger" : hf < 1.5 ? "warn" : "safe");
export const hfLabel = (hf: number) => (!Number.isFinite(hf) ? "∞ (no debt)" : hf > 100 ? ">100" : hf.toFixed(2));

// ------------------------------------------------------------------ chain reads
export type ReserveView = {
  asset: string; total_supply: bigint; total_debt: bigint; utilization_bps: bigint; borrow_rate_bps: bigint; supply_rate_bps: bigint;
  config: ReserveConfig; state: { cash: bigint; treasury: bigint; bad_debt: bigint; supply_index: bigint; borrow_index: bigint; last_update: bigint };
};
export type UserReserve = { asset: string; supplied: bigint; borrowed: bigint; collateral: boolean };
export type AccountData = { collateral_usd: bigint; borrow_limit_usd: bigint; liq_threshold_usd: bigint; debt_usd: bigint; health_factor: bigint };

async function simulate<T>(contractId: string, method: string, args: xdr.ScVal[] = []): Promise<T> {
  if (OFFLINE_DEMO || !contractId) throw new Error("lending not configured");
  const tx = new TransactionBuilder(new Account(Keypair.random().publicKey(), "0"), { fee: BASE_FEE, networkPassphrase: NETWORK_PASSPHRASE })
    .addOperation(new Contract(contractId).call(method, ...args)).setTimeout(30).build();
  const sim = await soroban.simulateTransaction(tx);
  if (!rpc.Api.isSimulationSuccess(sim) || !sim.result) throw new Error(`simulation failed: ${method}${"error" in sim ? ` (${String(sim.error).match(/Error\(Contract, #\d+\)/)?.[0] ?? ""})` : ""}`);
  return scValToNative(sim.result.retval) as T;
}
export const u32v = (v: number) => nativeToScVal(v, { type: "u32" });
export const addrv = (a: string) => new Address(a).toScVal();
export const i128v = (v: bigint) => nativeToScVal(v, { type: "i128" });
export const boolv = (v: boolean) => nativeToScVal(v, { type: "bool" });

export async function readReserves(): Promise<ReserveView[]> {
  const out: ReserveView[] = [];
  const n = LENDING.reserves.length;
  const pages = await Promise.all(Array.from({ length: Math.ceil(n / 15) }, (_, i) => simulate<ReserveView[]>(LENDING.pool, "reserves_page", [u32v(i * 15), u32v(15)])));
  for (const p of pages) out.push(...p);
  return out;
}

/** Mock-oracle storage key for `Price(Asset::Stellar(sac))`. */
export const priceKey = (oracle: string, sac: string) =>
  xdr.LedgerKey.contractData(new xdr.LedgerKeyContractData({
    contract: new Address(oracle).toScAddress(),
    key: xdr.ScVal.scvVec([xdr.ScVal.scvSymbol("Price"), xdr.ScVal.scvVec([xdr.ScVal.scvSymbol("Stellar"), new Address(sac).toScVal()])]),
    durability: xdr.ContractDataDurability.persistent,
  }));

/** All oracle prices in ONE getLedgerEntries round trip. USD floats + timestamps. */
export async function readPrices(sacs: string[]): Promise<Map<string, { usd: number; ts: number }>> {
  const out = new Map<string, { usd: number; ts: number }>();
  const keys = sacs.map((s) => priceKey(LENDING.oracle, s));
  const res = await soroban.getLedgerEntries(...keys);
  const d = 10 ** LENDING.oracleDecimals;
  for (const e of res.entries) {
    if (e.val.type !== "contractData") continue;
    const cd = e.val.contractData;
    const k = scValToNative(cd.key) as [string, [string, string]];
    const v = scValToNative(cd.val) as { price: bigint; timestamp: bigint };
    out.set(k[1][1], { usd: Number(v.price) / d, ts: Number(v.timestamp) });
  }
  return out;
}

export const readUserPositions = (user: string) => simulate<UserReserve[]>(LENDING.pool, "user_positions", [addrv(user)]);
export const readAccount = (user: string) => simulate<AccountData>(LENDING.pool, "account", [addrv(user)]);

// ------------------------------------------------------------------ tx prepare / Txrep (SEP-11 style)
export type ArgNote = string | null;

/** Build + simulate a pool call; returns the prepared (fee + footprint) transaction. */
export async function preparePoolCall(pubkey: string, method: string, args: xdr.ScVal[]): Promise<Transaction> {
  const source = await soroban.getAccount(pubkey);
  const tx = new TransactionBuilder(source, { fee: BASE_FEE, networkPassphrase: NETWORK_PASSPHRASE })
    .addOperation(new Contract(LENDING.pool).call(method, ...args)).setTimeout(300).build();
  const sim = await soroban.simulateTransaction(tx, { cpuInstructions: 1_000_000 });
  if (!rpc.Api.isSimulationSuccess(sim)) {
    const code = "error" in sim ? String(sim.error).match(/Error\(Contract, #(\d+)\)/)?.[1] : undefined;
    throw new Error(code ? `${method} would fail: ${errorText(Number(code))}` : `simulation failed: ${method}`);
  }
  return rpc.assembleTransaction(tx, sim).build();
}

export async function submitPrepared(tx: Transaction, sign: (xdr: string) => Promise<string>) {
  const signed = await sign(tx.toXDR());
  const sent = await soroban.sendTransaction(TransactionBuilder.fromXDR(signed, NETWORK_PASSPHRASE));
  if (sent.status === "ERROR") throw new Error("transaction rejected by RPC");
  for (let i = 0; i < 40; i++) {
    const r = await soroban.getTransaction(sent.hash);
    if (r.status === rpc.Api.GetTransactionStatus.SUCCESS) return { hash: sent.hash, result: r.returnValue ? scValToNative(r.returnValue) : null };
    if (r.status === rpc.Api.GetTransactionStatus.FAILED) throw new Error(`transaction failed: ${sent.hash}`);
    await new Promise((res) => setTimeout(res, 1000));
  }
  throw new Error(`timed out waiting for ${sent.hash}`);
}

/** Canonical label for an address: CODE:ISSUER for listed SACs, the pool, or the raw address. */
export function labelFor(address: string): string | null {
  const a = bySac.get(address);
  if (a) return `${a.testnetCanonical}${a.testnetKind === "mirror" ? ` (testnet mirror of ${a.canonical})` : ""} · SAC`;
  if (address === LENDING.pool) return "Quasaria lending pool";
  return null;
}

function scToTxrep(v: xdr.ScVal): string {
  switch (v.type) {
    case "scvAddress": return Address.fromScVal(v).toString();
    case "scvI128": case "scvU64": case "scvU32": case "scvI64": case "scvBool": return String(scValToNative(v));
    case "scvSymbol": return `"${String(scValToNative(v))}"`;
    default: return JSON.stringify(scValToNative(v), (_k, x) => (typeof x === "bigint" ? x.toString() : x));
  }
}

/**
 * Txrep-style (SEP-11) lines for a single-op invoke-contract transaction, annotated with
 * human-readable comments (assets as CODE:ISSUER, amounts in tokens).
 */
export function txrep(tx: Transaction, notes: ArgNote[] = []): string[] {
  const lines = [
    `type: ENVELOPE_TYPE_TX`,
    `tx.sourceAccount: ${tx.source}`,
    `tx.fee: ${tx.fee}  (${(Number(tx.fee) / 1e7).toFixed(7)} XLM max, incl. resource fee)`,
    `tx.seqNum: ${tx.sequence}`,
    `tx.cond.type: PRECOND_TIME`,
    `tx.cond.timeBounds.maxTime: ${tx.timeBounds?.maxTime ?? 0}${tx.timeBounds?.maxTime ? `  (${new Date(Number(tx.timeBounds.maxTime) * 1000).toISOString()})` : ""}`,
    `tx.memo.type: MEMO_NONE`,
    `tx.operations.len: ${tx.operations.length}`,
  ];
  tx.operations.forEach((op, i) => {
    const p = `tx.operations[${i}].body`;
    lines.push(`tx.operations[${i}].sourceAccount._present: false`, `${p}.type: ${op.type === "invokeHostFunction" ? "INVOKE_HOST_FUNCTION" : op.type}`);
    if (op.type !== "invokeHostFunction") return;
    const fn = op.func;
    if (fn.type !== "hostFunctionTypeInvokeContract") return;
    const ic = fn.invokeContract;
    const h = `${p}.invokeHostFunctionOp.hostFunction`;
    const contract = Address.fromScAddress(ic.contractAddress).toString();
    lines.push(`${h}.type: HOST_FUNCTION_TYPE_INVOKE_CONTRACT`, `${h}.invokeContract.contractAddress: ${contract}${labelFor(contract) ? `  (${labelFor(contract)})` : ""}`, `${h}.invokeContract.functionName: "${ic.functionName.toString()}"`, `${h}.invokeContract.args.len: ${ic.args.length}`);
    ic.args.forEach((a: xdr.ScVal, j: number) => {
      const raw = scToTxrep(a);
      const lab = a.type === "scvAddress" ? labelFor(raw) : null;
      const note = notes[j] ?? lab;
      lines.push(`${h}.invokeContract.args[${j}]: ${raw}${note ? `  (${note})` : ""}`);
    });
    lines.push(`${p}.invokeHostFunctionOp.auth.len: ${op.auth?.length ?? 0}`);
  });
  lines.push(`tx.ext.v: 1  (Soroban resources from simulation)`, `signatures.len: 0  (your wallet signs next)`);
  return lines;
}

/** Plain-language names for the pool's error codes. */
export const ERRORS: Record<number, string> = {
  1: "amount must be positive", 2: "invalid config", 4: "asset not listed", 6: "you already use the maximum number of assets (8)",
  7: "below the minimum supply amount", 8: "below the minimum borrow amount", 9: "supply cap reached", 10: "borrow cap reached",
  11: "this asset can't be borrowed", 12: "this asset can't be used as collateral", 13: "not enough collateral (borrow limit)",
  14: "your health factor would drop below 1", 15: "not enough liquidity in the pool", 16: "insufficient supplied balance",
  17: "no oracle price", 18: "oracle price is stale (the testnet price keeper may be offline)", 19: "oracle price is future-dated",
  20: "position is healthy", 21: "no debt to repay", 23: "the pool's borrower list is full", 26: "that would leave a dust balance below the minimum",
  900: "the pool is paused (repay and safe withdrawals still work)",
};
export const errorText = (code: number) => ERRORS[code] ?? `contract error #${code}`;

/** raw → token float */
export const toTok = (v: bigint | string | number, dec = 7) => Number(BigInt(v)) / 10 ** dec;
