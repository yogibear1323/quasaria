import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { ActivityList } from "../src/pages/Activity";
import { classifyMemo, classifyOp, filterItems, type OpRec, type RewardCfg } from "../src/lib/activity";

const src = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const ME = "G" + "A".repeat(55), OTHER = "G" + "B".repeat(55), ISS = "G" + "C".repeat(55), RES = "G" + "D".repeat(55);
const H = (n: number) => n.toString(16).padStart(64, "0");
const cfg: RewardCfg = { code: "GLACIERQ", issuer: ISS, reserve: RES };
const base = (id: string, type: string, extra: Partial<OpRec> = {}): OpRec => ({ id, type, created_at: "2026-10-18T12:00:00Z", transaction_hash: H(Number(id)), transaction_successful: true, ...extra });

const ops: OpRec[] = [
  base("1", "path_payment_strict_send", { from: ME, to: ME, source_amount: "50.0000000", source_asset_type: "native", amount: "100.0000000", asset_type: "credit_alphanum12", asset_code: "SWPDEMO", asset_issuer: OTHER }),
  base("2", "manage_buy_offer", { source_account: ME, amount: "60.0000000", price: "1.0066700", selling_asset_type: "native", buying_asset_type: "credit_alphanum12", buying_asset_code: "MKT", source_account_: undefined } as Partial<OpRec>),
  base("3", "manage_sell_offer", { source_account: ME, amount: "0.0000000", price: "1", selling_asset_type: "credit_alphanum12", selling_asset_code: "MKT", buying_asset_type: "native" }),
  base("4", "liquidity_pool_deposit", { source_account: ME, reserves_deposited: [{ asset: "native", amount: "100.0000000" }, { asset: `PLD:${OTHER}`, amount: "100.0000000" }], shares_received: "100.0000000" }),
  base("5", "liquidity_pool_withdraw", { source_account: ME, reserves_received: [{ asset: "native", amount: "50.0000000" }, { asset: `PLD:${OTHER}`, amount: "50.0000000" }], shares: "50.0000000" }),
  base("6", "payment", { from: RES, to: ME, asset_type: "credit_alphanum12", asset_code: "GLACIERQ", asset_issuer: ISS, amount: "1369.8630137", transaction: { memo: "GLACIERQ:2026-10-17" } }),
  base("7", "payment", { from: RES, to: ME, asset_type: "credit_alphanum12", asset_code: "GLACIERQ", asset_issuer: ISS, amount: "136.9863", transaction: { memo: "GLACIERQ-REF:2026-10-17" } }),
  base("8", "payment", { from: RES, to: ME, asset_type: "credit_alphanum12", asset_code: "GLACIERQ", asset_issuer: ISS, amount: "136.9863", transaction: { memo: "GLACIERQ-BOOST:2026-10-17" } }),
  base("9", "payment", { from: OTHER, to: ME, asset_type: "native", amount: "12.5000000" }),
  base("10", "change_trust"),
  base("11", "payment", { from: ME, to: OTHER, asset_type: "native", amount: "1", transaction_successful: false }),
];

describe("activity classification", () => {
  const items = ops.map((o) => classifyOp(o, ME, cfg));
  it("classifies swaps, orders, pool deposits/withdrawals and payments", () => {
    expect(items[0]).toMatchObject({ kind: "swap", mine: true, hash: H(1) }); expect(items[0]!.title).toBe("Swap 50 XLM → 100 SWPDEMO");
    expect(items[1]).toMatchObject({ kind: "order" }); expect(items[1]!.title).toMatch(/^Buy order: 60 MKT for XLM at 1\.00667/);
    expect(items[2]!.title).toMatch(/^Cancelled order/);
    expect(items[3]).toMatchObject({ kind: "pool" }); expect(items[3]!.title).toBe("Pool deposit: 100 XLM + 100 PLD");
    expect(items[4]!.title).toBe("Pool withdrawal: 50 XLM + 50 PLD");
    expect(items[8]).toMatchObject({ kind: "payment", mine: true }); expect(items[8]!.detail).toMatch(/^received from/);
  });
  it("marks reward, referrer and referee payments only from the verified issuer and reserve with the right memo", () => {
    expect(items[5]).toMatchObject({ kind: "reward" }); expect(items[5]!.title).toMatch(/^Holder reward: 1,369\.86/);
    expect(items[6]).toMatchObject({ kind: "referral" }); expect(items[6]!.title).toMatch(/Referral bonus \(referrer\)/);
    expect(items[7]).toMatchObject({ kind: "referral" }); expect(items[7]!.title).toMatch(/Referral boost \(referee\)/);
    const spoofIssuer = classifyOp({ ...ops[5], asset_issuer: OTHER }, ME, cfg)!;
    const spoofSender = classifyOp({ ...ops[5], from: OTHER }, ME, cfg)!;
    const noIssuerYet = classifyOp(ops[5], ME, { code: "GLACIERQ", issuer: null, reserve: null })!;
    expect(spoofIssuer.kind).toBe("payment"); expect(spoofSender.kind).toBe("payment"); expect(noIssuerYet.kind).toBe("payment");
  });
  it("referral payments must come from the separate payer when one is configured; holder rewards still only from the reserve", () => {
    const withPayer: RewardCfg = { ...cfg, payer: OTHER };
    expect(classifyOp({ ...ops[6], from: OTHER }, ME, withPayer)!.kind).toBe("referral");
    expect(classifyOp(ops[6], ME, withPayer)!.kind).toBe("payment"); // reserve is not the referral payer
    expect(classifyOp({ ...ops[5], from: OTHER }, ME, withPayer)!.kind).toBe("payment"); // payer cannot mint holder rewards
  });
  it("skips unrelated operation types and failed transactions", () => { expect(items[9]).toBeNull(); expect(items[10]).toBeNull(); });
  it("parses memo conventions", () => {
    expect(classifyMemo("GLACIERQ:2026-10-17")).toEqual({ kind: "reward", day: "2026-10-17" });
    expect(classifyMemo("GLACIERQ-REF:2026-10-17")?.kind).toBe("referrer");
    expect(classifyMemo("GLACIERQ-BOOST:2026-10-17")?.kind).toBe("referee");
    expect(classifyMemo("hello")).toBeNull(); expect(classifyMemo(null)).toBeNull();
  });
  it("filters by kind", () => {
    const list = items.filter((x) => !!x) as NonNullable<(typeof items)[number]>[];
    expect(filterItems(list, "swap")).toHaveLength(1); expect(filterItems(list, "pool")).toHaveLength(2);
    expect(filterItems(list, "referral")).toHaveLength(2); expect(filterItems(list, "all")).toHaveLength(list.length);
  });
});

describe("activity list rendering", () => {
  const list = ops.map((o) => classifyOp(o, ME, cfg)).filter((x) => !!x) as NonNullable<ReturnType<typeof classifyOp>>[];
  const html = renderToStaticMarkup(<MemoryRouter><ActivityList items={list} loading={false} error={null} empty="none" /></MemoryRouter>);
  it("links every transaction to the StellarChain testnet page in a new tab", () => {
    for (const i of list) expect(html).toContain(`href="https://testnet.stellarchain.io/transactions/${i.hash}" target="_blank" rel="noopener noreferrer"`);
    expect((html.match(/data-testid="act-row"/g) ?? []).length).toBe(list.length);
  });
  it("has loading, error and empty states", () => {
    expect(renderToStaticMarkup(<ActivityList items={[]} loading error={null} empty="none" />)).toContain("act-loading");
    expect(renderToStaticMarkup(<ActivityList items={[]} loading={false} error="boom" empty="none" />)).toContain("boom");
    expect(renderToStaticMarkup(<ActivityList items={[]} loading={false} error={null} empty="Nothing yet" />)).toContain("Nothing yet");
  });
  it("builds no explorer URL itself: only the shared helper does", () => {
    expect(src("../src/pages/Activity.tsx") + src("../src/lib/activity.ts")).not.toMatch(/stellarchain\.io|stellar\.expert|\/transactions\//);
  });
});
