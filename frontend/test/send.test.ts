import { describe, expect, it } from "vitest";
import { Keypair, Networks, TransactionBuilder, Operation, Memo } from "@stellar/stellar-sdk";
import { buildSendTx, memoBytes, parseAmount, planSend, validDestination, type SendInput } from "../src/lib/send";
import { buildTrustlineTx, usdcIssuer } from "../src/lib/trustline";
import { minimumBalance, parseAccount, poolPosition, rewardStatus, verifiedLabel, type HAccount } from "../src/lib/account";
import { REWARD_ISSUER } from "../src/lib/rewards";

const A = Keypair.random().publicKey(), B = Keypair.random().publicKey();
const native = (balance: string, extra: Partial<HAccount> = {}, sell = "0"): HAccount => ({ balances: [{ asset_type: "native", balance, selling_liabilities: sell }], subentry_count: 0, ...extra });
const base = (o: Partial<SendInput> = {}): SendInput => ({ source: A, asset: { code: "XLM", issuer: null }, amount: "10", destination: B, memo: "", src: native("100"), baseReserve: 0.5, dest: native("5"), ...o });

describe("amount + address validation", () => {
  it("parses exact 7-decimal amounts and rejects junk", () => {
    expect(parseAmount("1.5")).toBe(15000000n);
    expect(parseAmount("0.0000001")).toBe(1n);
    for (const bad of ["", "0", "-1", "1.12345678", "abc", ".", "1e3"]) expect(parseAmount(bad)).toBeNull();
  });
  it("validates G addresses", () => { expect(validDestination(B)).toBe(true); expect(validDestination("GABC")).toBe(false); expect(validDestination(Keypair.random().secret())).toBe(false); });
  it("counts memo bytes, not characters", () => { expect(memoBytes("é")).toBe(2); });
});

describe("planSend", () => {
  it("plans a plain XLM payment", () => { const p = planSend(base()); expect(p).toMatchObject({ ok: true, kind: "payment", amountText: "10" }); });
  it("refuses self-send, bad address, long memo, unfunded source", () => {
    expect(planSend(base({ destination: A }))).toMatchObject({ ok: false });
    expect(planSend(base({ destination: "nope" }))).toMatchObject({ ok: false });
    expect(planSend(base({ memo: "x".repeat(29) }))).toMatchObject({ ok: false, error: expect.stringContaining("memo") });
    expect(planSend(base({ src: null }))).toMatchObject({ ok: false, error: expect.stringContaining("not funded") });
  });
  it("keeps the reserve: can't send the whole balance", () => {
    const r = planSend(base({ amount: "100", src: native("100", { subentry_count: 2 }) }));
    expect(r).toMatchObject({ ok: false, error: expect.stringContaining("reserve") });
    expect(planSend(base({ amount: "97.9", src: native("100", { subentry_count: 2 }) }))).toMatchObject({ ok: true }); // min 2.0 XLM + fee
    expect(planSend(base({ amount: "98", src: native("100", { subentry_count: 2 }) }))).toMatchObject({ ok: false });
  });
  it("accounts for open-offer liabilities", () => { expect(planSend(base({ amount: "60", src: native("100", {}, "50") }))).toMatchObject({ ok: false }); });
  it("creates a new destination account (min 1 XLM)", () => {
    expect(planSend(base({ dest: null, amount: "5" }))).toMatchObject({ ok: true, kind: "createAccount" });
    expect(planSend(base({ dest: null, amount: "0.5" }))).toMatchObject({ ok: false, error: expect.stringContaining("1 XLM") });
  });
  const usdc = { code: "USDC", issuer: usdcIssuer("testnet") };
  const held = (bal: string): HAccount => ({ balances: [{ asset_type: "native", balance: "50" }, { asset_type: "credit_alphanum4", asset_code: "USDC", asset_issuer: usdc.issuer, balance: bal }], subentry_count: 1 });
  const trusts = (limit = "1000", auth = true): HAccount => ({ balances: [{ asset_type: "native", balance: "5" }, { asset_type: "credit_alphanum4", asset_code: "USDC", asset_issuer: usdc.issuer, balance: "0", limit, is_authorized: auth }] });
  it("sends a held asset only to a trustline holder", () => {
    expect(planSend(base({ asset: usdc, src: held("20"), dest: trusts() }))).toMatchObject({ ok: true });
    expect(planSend(base({ asset: usdc, src: held("20"), dest: native("5") }))).toMatchObject({ ok: false, error: expect.stringContaining("trustline") });
    expect(planSend(base({ asset: usdc, src: held("20"), dest: null }))).toMatchObject({ ok: false });
    expect(planSend(base({ asset: usdc, src: held("5"), dest: trusts() }))).toMatchObject({ ok: false, error: expect.stringContaining("only have") });
    expect(planSend(base({ asset: usdc, src: held("20"), dest: trusts("1000", false) }))).toMatchObject({ ok: false, error: expect.stringContaining("authorized") });
    expect(planSend(base({ asset: { code: "USDC", issuer: Keypair.random().publicKey() }, src: held("20"), dest: trusts() }))).toMatchObject({ ok: false });
  });
});

describe("buildSendTx", () => {
  it("builds an unsigned payment with memo for the testnet passphrase", () => {
    const plan = planSend(base({ memo: "inv 42" })) as Extract<ReturnType<typeof planSend>, { ok: true }>;
    const xdr = buildSendTx(plan, { source: A, sequence: "100", destination: B, asset: { code: "XLM", issuer: null }, memo: "inv 42", passphrase: Networks.TESTNET });
    const tx = TransactionBuilder.fromXDR(xdr, Networks.TESTNET);
    expect(tx.signatures).toHaveLength(0);
    expect((tx as unknown as { sequence: string }).sequence).toBe("101");
    const op = tx.operations[0] as Operation.Payment;
    expect(op).toMatchObject({ type: "payment", destination: B, amount: "10.0000000" });
    expect(Buffer.from((tx.memo as Memo).value as Buffer).toString()).toBe("inv 42");
  });
  it("builds createAccount for a new address", () => {
    const plan = planSend(base({ dest: null, amount: "5" })) as Extract<ReturnType<typeof planSend>, { ok: true }>;
    const tx = TransactionBuilder.fromXDR(buildSendTx(plan, { source: A, sequence: "1", destination: B, asset: { code: "XLM", issuer: null }, memo: "", passphrase: Networks.TESTNET }), Networks.TESTNET);
    expect(tx.operations[0]).toMatchObject({ type: "createAccount", destination: B, startingBalance: "5.0000000" });
  });
  it("builds the verified USDC trustline", () => {
    const tx = TransactionBuilder.fromXDR(buildTrustlineTx({ source: A, sequence: "7", code: "USDC", issuer: usdcIssuer("testnet"), passphrase: Networks.TESTNET }), Networks.TESTNET);
    expect(tx.operations[0]).toMatchObject({ type: "changeTrust" });
  });
});

describe("account maths", () => {
  it("minimum balance = (2 + subentries + sponsoring − sponsored) × reserve", () => {
    expect(minimumBalance({ balances: [], subentry_count: 3, num_sponsoring: 2, num_sponsored: 1 }, 0.5)).toBe(3);
    expect(minimumBalance({ balances: [] }, null)).toBeNull();
  });
  it("parses native available, trustlines with issuer-verified labels, pool shares", () => {
    const rg = REWARD_ISSUER.testnet;
    const v = parseAccount({ subentry_count: 4, balances: [
      { asset_type: "native", balance: "100", selling_liabilities: "1" },
      { asset_type: "credit_alphanum4", asset_code: "USDC", asset_issuer: usdcIssuer("testnet"), balance: "5" },
      { asset_type: "credit_alphanum4", asset_code: "USDC", asset_issuer: "G" + "A".repeat(55), balance: "9" },
      { asset_type: "liquidity_pool_shares", liquidity_pool_id: "ab".repeat(32), balance: "10" },
    ] }, "testnet", 0.5);
    if (!v.exists) throw new Error("x");
    expect(v.native.reserve).toBe(3); expect(v.native.available).toBe(96);
    expect(v.holdings[0].verified).toContain("Circle"); expect(v.holdings[1].verified).toBeNull(); // same ticker, different issuer → not verified
    expect(v.poolShares).toEqual([{ poolId: "ab".repeat(32), shares: 10 }]);
    expect(rg === null || typeof rg === "string").toBe(true);
    expect(verifiedLabel("testnet", "USDC", "G" + "B".repeat(55))).toBeNull();
  });
  it("GLACIERQ tier status", () => {
    expect(rewardStatus(0).tier).toContain("Below 1M");
    expect(rewardStatus(1_000_000).tier).toContain("5%");
    expect(rewardStatus(10_000_000).tier).toContain("7%");
    expect(rewardStatus(500_000).next).toContain("500,000");
  });
  it("LP position: shares/total × reserves; value only on mainnet with a price", () => {
    const pool = { id: "x", fee_bp: 30, total_shares: "100", reserves: [{ asset: "native", amount: "1000" }, { asset: "USDC:G…", amount: "200" }] };
    const p = poolPosition({ poolId: "x", shares: 10 }, pool, 0.2, "testnet");
    expect(p.name).toBe("XLM / USDC"); expect(p.amounts).toEqual([{ code: "XLM", amount: 100 }, { code: "USDC", amount: 20 }]); expect(p.shareOfPool).toBe(0.1); expect(p.valueUsd).toBeNull();
    expect(poolPosition({ poolId: "x", shares: 10 }, pool, 0.2, "mainnet").valueUsd).toBeCloseTo(40);
    expect(poolPosition({ poolId: "x", shares: 10 }, null, 0.2, "mainnet").amounts).toEqual([]);
  });
});
