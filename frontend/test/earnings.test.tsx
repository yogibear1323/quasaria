import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import Earn, { HolderEarnings, LpEarnings, ReferralEarnings } from "../src/pages/Earn";
import { WalletProvider } from "../src/lib/wallet";
import { lpEarnings, lpFlows, paymentTotals } from "../src/lib/earnings";
import type { OpRec, RewardCfg } from "../src/lib/activity";
import type { Position } from "../src/lib/nativePools";

const ME = "G" + "A".repeat(55), ISS = "G" + "C".repeat(55), RES = "G" + "D".repeat(55), OTH = "G" + "B".repeat(55);
const T = (el: React.ReactElement) => renderToStaticMarkup(<MemoryRouter><WalletProvider>{el}</WalletProvider></MemoryRouter>).replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ");
const op = (id: string, type: string, x: Partial<OpRec>): OpRec => ({ id, type, created_at: "2026-10-18T00:00:00Z", transaction_hash: id, transaction_successful: true, ...x });
const USD = `USDC:${ISS}`;

describe("LP earnings", () => {
  const ops: OpRec[] = [
    op("1", "liquidity_pool_deposit", { source_account: ME, liquidity_pool_id: "p1", reserves_deposited: [{ asset: "native", amount: "100" }, { asset: USD, amount: "50" }] }),
    op("2", "liquidity_pool_deposit", { source_account: ME, liquidity_pool_id: "p1", reserves_deposited: [{ asset: "native", amount: "20" }, { asset: USD, amount: "10" }] }),
    op("3", "liquidity_pool_withdraw", { source_account: ME, liquidity_pool_id: "p1", reserves_received: [{ asset: "native", amount: "10" }, { asset: USD, amount: "5" }] }),
    op("4", "liquidity_pool_deposit", { source_account: OTH, liquidity_pool_id: "p1", reserves_deposited: [{ asset: "native", amount: "999" }, { asset: USD, amount: "999" }] }), // someone else
    op("5", "liquidity_pool_deposit", { source_account: ME, liquidity_pool_id: "p1", transaction_successful: false, reserves_deposited: [{ asset: "native", amount: "500" }, { asset: USD, amount: "500" }] }), // failed
  ];
  const pos: Position[] = [{ pool: { id: "p1", net: "testnet", feeBp: 30, totalShares: 1000, holders: 2, a: { code: "XLM", issuer: null }, b: { code: "USDC", issuer: ISS }, reserveA: 1, reserveB: 1 }, shares: 100, fraction: 0.1, amountA: 112, amountB: 56.5, usd: null }];
  it("computes now + withdrawn - deposited per asset, ignoring other accounts and failed transactions", () => {
    const f = lpFlows(ops, ME); expect(f.get("p1")!.deposited.get("native")).toBe(120); expect(f.get("p1")!.withdrawn.get(USD)).toBe(5);
    const [l] = lpEarnings(pos, f);
    expect(l.a.net).toBeCloseTo(112 + 10 - 120, 9); expect(l.b.net).toBeCloseTo(56.5 + 5 - 60, 9); expect(l.sawDeposit).toBe(true);
  });
  it("says so when there is no deposit in the history instead of inventing a number", () => {
    const [l] = lpEarnings(pos, new Map()); expect(l.sawDeposit).toBe(false);
    const t = T(<LpEarnings lines={[l]} truncated />);
    expect(t).toContain("no deposit in history"); expect(t).toContain("latest 200 operations");
  });
  it("renders gains with signs and explains fees stay in the pool", () => {
    const t = T(<LpEarnings lines={lpEarnings(pos, lpFlows(ops, ME))} truncated={false} />);
    expect(t).toMatch(/\+2\.0000 XLM/); expect(t).toMatch(/\+1\.5000 USDC/); expect(t).toMatch(/fees stay in the pool/);
    expect(T(<LpEarnings lines={[]} truncated={false} />)).toContain("No pool shares");
  });
});

describe("holder and referral earnings", () => {
  const cfg: RewardCfg = { code: "GLACIERQ", issuer: ISS, reserve: RES };
  const pay = (id: string, memo: string, x: Partial<OpRec> = {}) => op(id, "payment", { from: RES, to: ME, asset_code: "GLACIERQ", asset_issuer: ISS, asset_type: "credit_alphanum12", amount: "100", transaction: { memo }, ...x });
  it("sums verified reward, referrer and referee payments only", () => {
    const t = paymentTotals([pay("1", "GLACIERQ:2026-10-01"), pay("2", "GLACIERQ:2026-10-02", { amount: "50" }), pay("3", "GLACIERQ-REF:2026-10-02", { amount: "10" }), pay("4", "GLACIERQ-BOOST:2026-10-02", { amount: "5" }),
      pay("5", "GLACIERQ:2026-10-03", { asset_issuer: OTH }), pay("6", "GLACIERQ:2026-10-03", { from: OTH }), pay("7", "hello"), pay("8", "GLACIERQ:2026-10-03", { to: OTH })], ME, cfg);
    expect(t).toEqual({ reward: 150, referrer: 10, referee: 5, count: 4 });
  });
  it("shows not-live and coming-after-launch states honestly", () => {
    expect(T(<HolderEarnings live={false} address={ME} balance={null} totals={{ reward: 0, referrer: 0, referee: 0, count: 0 }} />)).toMatch(/Not live yet.*5% a year from 1M, 7% a year from 10M, not guaranteed/);
    expect(T(<ReferralEarnings address={ME} totals={{ reward: 0, referrer: 12.5, referee: 1, count: 2 }} />)).toMatch(/Coming after launch.*12\.50 GLACIERQ/);
    const live = T(<HolderEarnings live address={ME} balance={12_000_000} totals={{ reward: 400, referrer: 0, referee: 0, count: 1 }} />);
    expect(live).toMatch(/Tier 2 · 7% a year/); expect(live).toMatch(/2,301\.37 GLACIERQ/); expect(live).toMatch(/400\.00 GLACIERQ/);
  });
});

describe("Earnings page", () => {
  const t = T(<Earn />);
  it("has the three earning sections, the confirmed rates and no APY or tilde wording", () => {
    for (const s of ["Liquidity positions", "holder rewards", "Referral bonuses"]) expect(t).toContain(s);
    expect(t).toMatch(/5% a year from 1M, 7% a year from 10M/);
    expect(t).not.toMatch(/\bAPY\b|~\d/); expect(t).toMatch(/not guaranteed/i);
  });
});
