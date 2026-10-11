/**
 * Lending liquidation keeper (pure planning + a sweep over a paged borrower index).
 * The pool keeps a bounded, paged index of accounts with debt (`borrower_count` /
 * `borrowers_page`), so a sweep never needs an unbounded on-chain loop.
 */
export const HF_ONE = 10_000_000n;

export type Position = { asset: string; supplied: bigint; borrowed: bigint; collateral: boolean };
export type Account = { healthFactor: bigint; debtUsd: bigint; collateralUsd: bigint };
export type ReserveInfo = { asset: string; code: string; price: bigint; decimals: number; cash: bigint; collateralEnabled: boolean };
export type LiquidationPlan = {
  borrower: string;
  debtAsset: string;
  collateralAsset: string;
  repay: bigint;
  receiveShares: boolean;
  hf: number;
  detail: string;
};

const usd = (amount: bigint, price: bigint, decimals: number) => (amount * price) / 10n ** BigInt(decimals);

/**
 * Pick the largest debt and the largest seizable collateral for an unhealthy account.
 * `repay` = closeFactor share of that debt (the contract re-caps it and allows a full close
 * only for dust), limited by what the liquidator holds.
 */
export function planLiquidation(
  borrower: string,
  acct: Account,
  positions: Position[],
  reserves: Map<string, ReserveInfo>,
  opts: { closeFactorBps: number; balances: Map<string, bigint> },
): LiquidationPlan | null {
  if (acct.healthFactor >= HF_ONE) return null;
  let debt: { p: Position; v: bigint } | null = null;
  let col: { p: Position; v: bigint } | null = null;
  for (const p of positions) {
    const r = reserves.get(p.asset);
    if (!r) continue;
    if (p.borrowed > 0n) {
      const v = usd(p.borrowed, r.price, r.decimals);
      if (!debt || v > debt.v) debt = { p, v };
    }
    if (p.collateral && p.supplied > 0n) {
      const v = usd(p.supplied, r.price, r.decimals);
      if (!col || v > col.v) col = { p, v };
    }
  }
  if (!debt || !col) return null;
  const want = (debt.p.borrowed * BigInt(opts.closeFactorBps)) / 10_000n;
  const have = opts.balances.get(debt.p.asset) ?? 0n;
  const repay = want < have ? want : have;
  const cr = reserves.get(col.p.asset)!;
  const hf = Number(acct.healthFactor) / Number(HF_ONE);
  if (repay <= 0n)
    return { borrower, debtAsset: debt.p.asset, collateralAsset: col.p.asset, repay: 0n, receiveShares: false, hf, detail: `HF ${hf.toFixed(4)} < 1 but liquidator holds no ${reserves.get(debt.p.asset)!.code}` };
  return {
    borrower,
    debtAsset: debt.p.asset,
    collateralAsset: col.p.asset,
    repay,
    // take supply shares when the collateral reserve can't pay out tokens
    receiveShares: cr.cash < col.p.supplied / 2n,
    hf,
    detail: `HF ${hf.toFixed(4)} < 1: repay ${repay} of ${reserves.get(debt.p.asset)!.code}, seize ${cr.code}`,
  };
}

export interface LendingVenue {
  borrowerCount(): Promise<number>;
  borrowersPage(start: number, limit: number): Promise<string[]>;
  account(user: string): Promise<Account>;
  positions(user: string): Promise<Position[]>;
  reserves(): Promise<Map<string, ReserveInfo>>;
  closeFactorBps(): Promise<number>;
  balances(assets: string[]): Promise<Map<string, bigint>>;
  liquidate(p: LiquidationPlan): Promise<[bigint, bigint]>;
}

export const PAGE = 100; // pool MAX_PAGE

export async function allBorrowers(v: LendingVenue): Promise<string[]> {
  const n = await v.borrowerCount();
  const out: string[] = [];
  for (let s = 0; s < n; s += PAGE) {
    const page = await v.borrowersPage(s, PAGE);
    out.push(...page);
    if (page.length < PAGE) break;
  }
  return out;
}

export type SweepResult = { plan: LiquidationPlan; ok: boolean; executed: boolean; repaid?: bigint; seized?: bigint; error?: string };

/** One sweep: scan all borrowers (paged), liquidate HF < 1 (unless dry-run). */
/**
 * `priceGuard` (stale-data breaker): liquidations act on oracle prices, so each one is re-checked immediately before it
 * is signed; while the guard reports stale data the liquidation is skipped (logged) and retried on a later sweep.
 */
export async function runLendingKeeperOnce(
  v: LendingVenue,
  opts: { dryRun: boolean; log?: (m: string) => void; priceGuard?: () => Promise<{ ok: true } | { ok: false; reason: string }> },
): Promise<SweepResult[]> {
  const log = opts.log ?? console.log;
  const borrowers = await allBorrowers(v);
  const reserves = await v.reserves();
  const cf = await v.closeFactorBps();
  const balances = await v.balances([...reserves.keys()]);
  log(`lending-keeper: ${borrowers.length} borrower(s), ${reserves.size} reserves${opts.dryRun ? " (dry-run)" : ""}`);
  const out: SweepResult[] = [];
  for (const b of borrowers) {
    let acct: Account;
    try {
      acct = await v.account(b);
    } catch (e) {
      log(`lending-keeper: ${b.slice(0, 6)}… account unreadable (stale price?): ${(e as Error).message}`);
      continue;
    }
    const plan = planLiquidation(b, acct, await v.positions(b), reserves, { closeFactorBps: cf, balances });
    if (!plan) continue;
    log(`lending-keeper: ${b.slice(0, 6)}… ${plan.detail}`);
    if (plan.repay <= 0n) {
      out.push({ plan, ok: false, executed: false, error: "no balance" });
      continue;
    }
    if (opts.dryRun) {
      log(`lending-keeper (dry-run): would liquidate ${b.slice(0, 6)}…`);
      out.push({ plan, ok: true, executed: false });
      continue;
    }
    const g = opts.priceGuard ? await opts.priceGuard() : { ok: true as const };
    if (!g.ok) {
      log(`lending-keeper: liquidation of ${b.slice(0, 6)}… skipped — ${g.reason}`);
      out.push({ plan, ok: false, executed: false, error: g.reason });
      continue;
    }
    try {
      const [repaid, seized] = await v.liquidate(plan);
      log(`lending-keeper: liquidated ${b.slice(0, 6)}… repaid ${repaid} seized ${seized}`);
      balances.set(plan.debtAsset, (balances.get(plan.debtAsset) ?? 0n) - repaid);
      out.push({ plan, ok: true, executed: true, repaid, seized });
    } catch (e) {
      // another keeper may have won, or HF recovered; the contract re-checks everything
      log(`lending-keeper: liquidation of ${b.slice(0, 6)}… failed: ${(e as Error).message}`);
      out.push({ plan, ok: false, executed: true, error: (e as Error).message });
    }
  }
  return out;
}
