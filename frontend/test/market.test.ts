import { describe, expect, it } from "vitest";
import { Asset, Keypair, Networks, TransactionBuilder } from "@stellar/stellar-sdk";
import { PROTECTION_BAND, buildCancelRemainderTx, buildMarketTx, checkFunds, describeOutcome, parseOfferResult, plainTxError, planMarket, walkLevels } from "../src/lib/market";
import { executeMarket, type OpenOffer } from "../src/lib/marketRun";
import type { HAccount } from "../src/lib/account";

// Real transaction results captured from a testnet run (taker buys/sells MKTDEMO against a maker's offers).
const FX = {
  "buy-full": "AAAAAAAAAMgAAAAAAAAAAgAAAAAAAAAGAAAAAAAAAAAAAAAMAAAAAAAAAAIAAAABAAAAAB2BNqDvL2/uQGUJcNkJfOPe5UgRsqQ4z49Zxuf8SrzIAAAAAAAOEcoAAAACTUtUREVNTwAAAAAAAAAAAHXvHKJEySp2Nz9T0vG2HYHrTnZgWEWnNzmCpVxlHu8UAAAAABfXhAAAAAAAAAAAABfXhAAAAAABAAAAAB2BNqDvL2/uQGUJcNkJfOPe5UgRsqQ4z49Zxuf8SrzIAAAAAAAOEcsAAAACTUtUREVNTwAAAAAAAAAAAHXvHKJEySp2Nz9T0vG2HYHrTnZgWEWnNzmCpVxlHu8UAAAAAAvrwgAAAAAAAAAAAAwoywAAAAACAAAAAA==",
  "sell-full": "AAAAAAAAAGQAAAAAAAAAAQAAAAAAAAADAAAAAAAAAAEAAAABAAAAAB2BNqDvL2/uQGUJcNkJfOPe5UgRsqQ4z49Zxuf8SrzIAAAAAAAOEc4AAAAAAAAAABGz3EAAAAACTUtUREVNTwAAAAAAAAAAAHXvHKJEySp2Nz9T0vG2HYHrTnZgWEWnNzmCpVxlHu8UAAAAABHhowAAAAACAAAAAA==",
  "buy-partial-thin": "AAAAAAAAAGQAAAAAAAAAAQAAAAAAAAAMAAAAAAAAAAIAAAABAAAAAB2BNqDvL2/uQGUJcNkJfOPe5UgRsqQ4z49Zxuf8SrzIAAAAAAAOEcsAAAACTUtUREVNTwAAAAAAAAAAAHXvHKJEySp2Nz9T0vG2HYHrTnZgWEWnNzmCpVxlHu8UAAAAAAvrwgAAAAAAAAAAAAwoywAAAAABAAAAAB2BNqDvL2/uQGUJcNkJfOPe5UgRsqQ4z49Zxuf8SrzIAAAAAAAOEcwAAAACTUtUREVNTwAAAAAAAAAAAHXvHKJEySp2Nz9T0vG2HYHrTnZgWEWnNzmCpVxlHu8UAAAAABfXhAAAAAAAAAAAABjLqAAAAAAAAAAAACj+wr2tHD+iykZFg5zKrBWJ+ZkGOam/92zkZOjFRQBAAAAAAAAOEdEAAAAAAAAAAk1LVERFTU8AAAAAAAAAAAB17xyiRMkqdjc/U9Lxth2B6052YFhFpzc5gqVcZR7vFAAAAABZXwdAAAAD6AAABC8AAAAAAAAAAAAAAAA="
} as const;

const book = { asks: [{ price: 1, amount: 40 }, { price: 1.02, amount: 40 }, { price: 1.04, amount: 40 }, { price: 1.3, amount: 500 }], bids: [{ price: 0.99, amount: 40 }, { price: 0.97, amount: 40 }, { price: 0.7, amount: 500 }] };
const SRC = Keypair.random().publicKey();
const DEMO = new Asset("MKTDEMO", Keypair.random().publicKey()), XLM = Asset.native();

describe("planMarket (estimate from the live book, fixed hidden band)", () => {
  it("band is fixed at 5% from the best opposing price", () => {
    expect(PROTECTION_BAND).toBe(0.05);
    const p = planMarket("buy", 60, book); if (!p.ok) throw new Error();
    expect(p.best).toBe(1); expect(p.bound).toBeCloseTo(1.05); expect(p.estBase).toBe(60); expect(p.estQuote).toBeCloseTo(60.4); expect(p.estAvg).toBeCloseTo(1.00667, 4); expect(p.full).toBe(true); expect(p.impact).toBeGreaterThan(0);
    const s = planMarket("sell", 30, book); if (!s.ok) throw new Error();
    expect(s.bound).toBeCloseTo(0.9405); expect(s.estAvg).toBeCloseTo(0.99);
  });
  it("never counts levels outside the band (thin book -> not full)", () => {
    const p = planMarket("buy", 200, book); if (!p.ok) throw new Error();
    expect(p.estBase).toBe(120); expect(p.full).toBe(false); // the 500 @ 1.30 is outside 1.05
    const s = planMarket("sell", 200, book); if (!s.ok) throw new Error();
    expect(s.estBase).toBe(80); expect(s.full).toBe(false);
  });
  it("empty side / bad amount", () => {
    expect(planMarket("buy", 10, { asks: [], bids: [] })).toEqual({ ok: false, reason: "empty" });
    expect(planMarket("buy", 0, book)).toEqual({ ok: false, reason: "amount" });
    expect(walkLevels([{ price: 2, amount: 5 }], 3, () => true)).toEqual({ base: 3, quote: 6, avg: 2 });
  });
});

describe("transactions", () => {
  it("market buy = manage_buy_offer at the bound, memo, unsigned, optional trustline first", () => {
    const p = planMarket("buy", 60, book); if (!p.ok) throw new Error();
    const tx = TransactionBuilder.fromXDR(buildMarketTx({ source: SRC, sequence: "10", side: "buy", base: DEMO, quote: XLM, amount: 60, bound: p.bound, needTrust: [DEMO], passphrase: Networks.TESTNET }), Networks.TESTNET);
    expect(tx.signatures).toHaveLength(0);
    expect(tx.operations.map((o) => o.type)).toEqual(["changeTrust", "manageBuyOffer"]);
    expect(tx.operations[1]).toMatchObject({ buyAmount: "60.0000000", price: "1.05", offerId: "0" });
    expect(Buffer.from((tx.memo as { value: Uint8Array }).value).toString()).toBe("quasaria");
  });
  it("market sell = manage_sell_offer at the bound", () => {
    const tx = TransactionBuilder.fromXDR(buildMarketTx({ source: SRC, sequence: "10", side: "sell", base: DEMO, quote: XLM, amount: 30, bound: 0.9405, needTrust: [], passphrase: Networks.TESTNET }), Networks.TESTNET);
    expect(tx.operations).toHaveLength(1); expect(tx.operations[0]).toMatchObject({ type: "manageSellOffer", amount: "30.0000000", price: "0.9405" });
  });
  it("cancel = amount 0 on the offer id", () => {
    const tx = TransactionBuilder.fromXDR(buildCancelRemainderTx({ source: SRC, sequence: "11", offerId: "922065", selling: XLM, buying: DEMO, price: 1.05, passphrase: Networks.TESTNET }), Networks.TESTNET);
    expect(tx.operations[0]).toMatchObject({ type: "manageSellOffer", amount: "0.0000000", offerId: "922065" });
  });
});

describe("parseOfferResult + messages (real testnet results)", () => {
  it("full buy", () => {
    const r = parseOfferResult(FX["buy-full"], "buy");
    expect(r.received).toBeCloseTo(60); expect(r.paid).toBeCloseTo(60.4); expect(r.avg).toBeCloseTo(1.00667, 4); expect(r.remainderOfferId).toBeNull();
    expect(describeOutcome("buy", "MKTDEMO", "XLM", 60, r)).toMatchObject({ kind: "filled", text: expect.stringContaining("Bought 60 MKTDEMO at avg price 1.00667 XLM") });
  });
  it("full sell", () => {
    const r = parseOfferResult(FX["sell-full"], "sell");
    expect(r.remainderOfferId).toBeNull(); expect(describeOutcome("sell", "MKTDEMO", "XLM", 30, r).kind).toBe("filled");
  });
  it("partial buy leaves a remainder offer that must be cancelled", () => {
    const r = parseOfferResult(FX["buy-partial-thin"], "buy");
    expect(r.received).toBeCloseTo(60); expect(r.remainderOfferId).toMatch(/^\d+$/);
    const o = describeOutcome("buy", "MKTDEMO", "XLM", 200, r);
    expect(o.kind).toBe("partial"); expect(o.text).toContain("Partially filled"); expect(o.text).toContain("The rest was cancelled");
  });
  it("nothing filled -> thin-book message", () => {
    expect(describeOutcome("buy", "A", "B", 10, { received: 0, paid: 0, avg: null, remainderOfferId: "1", remainderAmount: 5 })).toEqual({ kind: "none", text: "Couldn't fill (thin book): nothing traded and the order was cancelled." });
  });
});

const acct = (xlm: string, extra: HAccount["balances"] = [], sub = 0): HAccount => ({ subentry_count: sub, balances: [{ asset_type: "native", balance: xlm, selling_liabilities: "0" }, ...extra] });
const line = (code: string, issuer: string, bal: string) => ({ asset_type: "credit_alphanum12", asset_code: code, asset_issuer: issuer, balance: bal, selling_liabilities: "0" });
const DEMO_REF = { code: "MKTDEMO", issuer: DEMO.getIssuer() }, XLM_REF = { code: "XLM", issuer: null };

describe("checkFunds (plain errors immediately)", () => {
  const buy = planMarket("buy", 60, book), sell = planMarket("sell", 30, book);
  if (!buy.ok || !sell.ok) throw new Error();
  it("buy: adds the missing trustline and reports its reserve", () => {
    const r = checkFunds({ side: "buy", plan: buy, base: DEMO_REF, quote: XLM_REF, acct: acct("1000"), baseReserve: 0.5 });
    expect(r).toMatchObject({ ok: true, reserveXlm: 0.5 }); if (r.ok) expect(r.needTrust).toEqual([DEMO_REF]);
  });
  it("buy: not enough XLM", () => { expect(checkFunds({ side: "buy", plan: buy, base: DEMO_REF, quote: XLM_REF, acct: acct("30"), baseReserve: 0.5 })).toMatchObject({ ok: false, error: expect.stringContaining("Not enough XLM") }); });
  it("sell: no trustline / no balance", () => {
    expect(checkFunds({ side: "sell", plan: sell, base: DEMO_REF, quote: XLM_REF, acct: acct("100"), baseReserve: 0.5 })).toMatchObject({ ok: false, error: expect.stringContaining("don't hold any MKTDEMO") });
    expect(checkFunds({ side: "sell", plan: sell, base: DEMO_REF, quote: XLM_REF, acct: acct("100", [line("MKTDEMO", DEMO.getIssuer(), "5")], 1), baseReserve: 0.5 })).toMatchObject({ ok: false, error: expect.stringContaining("Not enough MKTDEMO") });
    expect(checkFunds({ side: "sell", plan: sell, base: DEMO_REF, quote: XLM_REF, acct: acct("100", [line("MKTDEMO", DEMO.getIssuer(), "50")], 1), baseReserve: 0.5 })).toMatchObject({ ok: true, needTrust: [] });
  });
  it("unfunded account", () => { expect(checkFunds({ side: "buy", plan: buy, base: DEMO_REF, quote: XLM_REF, acct: null, baseReserve: 0.5 })).toMatchObject({ ok: false }); });
  it("maps Horizon op codes to plain text", () => {
    expect(plainTxError({ response: { data: { extras: { result_codes: { operations: ["op_underfunded"] } } } } })).toBe("Not enough balance for this order.");
    expect(plainTxError({ response: { data: { extras: { result_codes: { operations: ["op_cross_self"] } } } } })).toContain("own open offers");
  });
});

describe("executeMarket: remainder is always cancelled", () => {
  const mk = (xdrOut: string, listAfter: OpenOffer[] = []) => {
    const submitted: string[] = []; let n = 0;
    return {
      submitted,
      deps: {
        sequence: async () => String(100 + n++), sign: async (x: string) => x,
        submit: async (x: string) => { submitted.push(x); return { hash: "h".repeat(63) + submitted.length, result_xdr: submitted.length === 1 ? xdrOut : FX["sell-full"] }; },
        openOffers: async () => (submitted.length ? listAfter : []),
      },
    };
  };
  const plan = (() => { const p = planMarket("buy", 200, book); if (!p.ok) throw new Error(); return p; })();
  const common = { address: SRC, side: "buy" as const, base: DEMO, quote: XLM, baseCode: "MKTDEMO", quoteCode: "XLM", plan, needTrust: [], passphrase: Networks.TESTNET };
  it("partial fill -> second tx cancels the resting offer", async () => {
    const m = mk(FX["buy-partial-thin"]);
    const r = await executeMarket({ ...common, deps: m.deps });
    expect(m.submitted).toHaveLength(2); expect(r.cancelHash).not.toBeNull(); expect(r.outcome.kind).toBe("partial"); expect(r.warning).toBeNull();
    const cancel = TransactionBuilder.fromXDR(m.submitted[1], Networks.TESTNET).operations[0];
    expect(cancel).toMatchObject({ type: "manageSellOffer", amount: "0.0000000" });
  });
  it("full fill -> no cancel needed", async () => {
    const m = mk(FX["buy-full"]);
    const r = await executeMarket({ ...common, deps: m.deps });
    expect(m.submitted).toHaveLength(1); expect(r.cancelHash).toBeNull();
  });
  it("unparseable result -> falls back to any NEW offer on the pair and cancels it", async () => {
    const m = mk("AAAA", [{ id: "777", selling: XLM, buying: DEMO, price: 1.05 }, { id: "5", selling: DEMO, buying: XLM, price: 2 }]);
    const r = await executeMarket({ ...common, deps: m.deps });
    expect(m.submitted).toHaveLength(2); expect(r.cancelHash).not.toBeNull();
    expect(TransactionBuilder.fromXDR(m.submitted[1], Networks.TESTNET).operations[0]).toMatchObject({ offerId: "777" });
  });
  it("cancel failure surfaces a warning instead of hiding it", async () => {
    const m = mk(FX["buy-partial-thin"]); let calls = 0;
    const r = await executeMarket({ ...common, deps: { ...m.deps, submit: async (x: string) => { calls++; if (calls > 1) throw new Error("boom"); return { hash: "a".repeat(64), result_xdr: FX["buy-partial-thin"] }; } } });
    expect(r.warning).toContain("may still be on the order book"); expect(r.cancelHash).toBeNull();
  });
});
