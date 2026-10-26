import { describe, expect, it } from "vitest";
import { Asset, Keypair, Networks, TransactionBuilder } from "@stellar/stellar-sdk";
import { DEFAULT_SLIPPAGE_PCT, buildSwapTx, checkSwapFunds, clampSlippage, minReceived, parseQuote, parseSwapReceived, plainSwapError } from "../src/lib/swap";
import { readFileSync } from "node:fs";
import type { HAccount } from "../src/lib/account";

// Real result of a testnet swap: 50 XLM -> 100 SWPDEMO through the order book, trustline added in the same transaction.
const REAL = "AAAAAAAAAMgAAAAAAAAAAgAAAAAAAAAGAAAAAAAAAAAAAAANAAAAAAAAAAEAAAABAAAAAExF5ZG7lHrrnyhJHA1t3TSD7h4vkR7qoNFm5wriqXmxAAAAAAAOEqcAAAACU1dQREVNTwAAAAAAAAAAAClCU+RDoVJyh5Z5TMauCRxyEFRAYWN8HFmAVjDQ7takAAAAADuaygAAAAAAAAAAAB3NZQAAAAAAjvNqEdFjEF2CrC25XKUagnAukVcbTsozZ+bN5w+np8QAAAACU1dQREVNTwAAAAAAAAAAAClCU+RDoVJyh5Z5TMauCRxyEFRAYWN8HFmAVjDQ7takAAAAADuaygAAAAAA";
const ISS = Keypair.random().publicKey(), ME = Keypair.random().publicKey();
const acct = (xlm: string, extra: HAccount["balances"] = [], sub = 0): HAccount => ({ subentry_count: sub, balances: [{ asset_type: "native", balance: xlm, selling_liabilities: "0" }, ...extra] });

describe("slippage maths", () => {
  it("minimum received floors to 7 decimals and is never looser than asked", () => {
    expect(minReceived(100, 0.5)).toBe(99.5); expect(minReceived(1, 1)).toBe(0.99); expect(minReceived(0.3333333, 0.5)).toBeLessThanOrEqual(0.3333333 * 0.995);
  });
  it("clamps silly limits", () => { expect(clampSlippage(0)).toBe(0.01); expect(clampSlippage(900)).toBe(50); expect(clampSlippage(NaN)).toBe(DEFAULT_SLIPPAGE_PCT); expect(DEFAULT_SLIPPAGE_PCT).toBe(0.5); });
});
describe("quote", () => {
  it("parses a Horizon path record (native + credit hops)", () => {
    const q = parseQuote(10, { destination_amount: "25.0000000", path: [{ asset_type: "native" }, { asset_type: "credit_alphanum4", asset_code: "USDC", asset_issuer: ISS }] });
    expect(q?.destAmount).toBe(25); expect(q?.rate).toBe(2.5); expect(q?.path).toHaveLength(2); expect(q?.path[0].isNative()).toBe(true);
    expect(parseQuote(10, undefined)).toBeNull(); expect(parseQuote(0, { destination_amount: "1", path: [] })).toBeNull();
  });
});
describe("checkSwapFunds", () => {
  const F = { code: "XLM", issuer: null }, T = { code: "USDC", issuer: ISS };
  it("adds the trustline and reports reserve + fee", () => { expect(checkSwapFunds({ from: F, to: T, amount: 10, acct: acct("100"), baseReserve: 0.5 })).toMatchObject({ ok: true, reserveXlm: 0.5, feeXlm: 0.00002 }); });
  it("counts extra ops (fee payments) in the network fee", () => { expect(checkSwapFunds({ from: F, to: T, amount: 10, acct: acct("100"), baseReserve: 0.5, extraOps: 1 })).toMatchObject({ ok: true, feeXlm: 0.00003 }); });
  it("plain errors", () => {
    expect(checkSwapFunds({ from: F, to: T, amount: 99, acct: acct("100"), baseReserve: 0.5 })).toMatchObject({ ok: false, error: expect.stringContaining("Not enough XLM") });
    expect(checkSwapFunds({ from: T, to: F, amount: 1, acct: acct("100"), baseReserve: 0.5 })).toMatchObject({ ok: false, error: expect.stringContaining("don't hold any USDC") });
    expect(checkSwapFunds({ from: T, to: F, amount: 5, acct: acct("100", [{ asset_type: "credit_alphanum4", asset_code: "USDC", asset_issuer: ISS, balance: "2" }], 1), baseReserve: 0.5 })).toMatchObject({ ok: false, error: expect.stringContaining("Not enough USDC") });
    expect(checkSwapFunds({ from: F, to: T, amount: 1, acct: null, baseReserve: 0.5 })).toMatchObject({ ok: false });
  });
});
describe("transaction", () => {
  it("path payment strict-send to self with the slippage minimum, trustline first, unsigned", () => {
    const D = new Asset("USDC", ISS);
    const tx = TransactionBuilder.fromXDR(buildSwapTx({ source: ME, sequence: "5", from: Asset.native(), to: D, amount: 50, minOut: 99.5, path: [], needTrust: [D], passphrase: Networks.TESTNET }), Networks.TESTNET);
    expect(tx.signatures).toHaveLength(0); expect(tx.operations.map((o) => o.type)).toEqual(["changeTrust", "pathPaymentStrictSend"]);
    expect(tx.operations[1]).toMatchObject({ sendAmount: "50.0000000", destMin: "99.5000000", destination: ME });
  });
  it("reads the received amount from a real result", () => { expect(parseSwapReceived(REAL)).toBe(100); });
});
describe("errors", () => {
  it("slippage failure is explained", () => { expect(plainSwapError({ response: { data: { extras: { result_codes: { operations: ["op_under_dest_min"] } } } } })).toContain("slippage limit"); });
  it("no liquidity", () => { expect(plainSwapError({ response: { data: { extras: { result_codes: { operations: ["op_too_few_offers"] } } } } })).toContain("liquidity"); });
});
describe("Swap page", () => {
  const p = readFileSync(new URL("../src/pages/Swap.tsx", import.meta.url), "utf8");
  it("quotes, has a user slippage limit and a confirm step before signing", () => {
    expect(p).toContain("slip-custom"); expect(p).toContain('data-testid="swap-confirm"'); expect(p).toContain("Minimum received");
    expect(p.slice(p.indexOf("const review"), p.indexOf("const confirm"))).not.toContain("w.sign");
    expect(p.slice(p.indexOf("const confirm"))).toContain("w.sign");
    expect(p).toContain("<TxLink"); expect(p).not.toMatch(/\.secret\b|console\./);
  });
  it("replaced the placeholder route", () => { const a = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8"); expect(a).toContain("<Swap />"); expect(a).not.toMatch(/path="\/swap"[^\n]*ComingSoon/); });
});

import { isTransientLookupError } from "../src/lib/swap";
describe("isTransientLookupError", () => {
  it("retries on 429/5xx/network, not on 400", () => {
    expect(isTransientLookupError({ response: { status: 429 } })).toBe(true);
    expect(isTransientLookupError({ response: { status: 503 } })).toBe(true);
    expect(isTransientLookupError(new TypeError("Failed to fetch"))).toBe(true);
    expect(isTransientLookupError({ response: { status: 400 } })).toBe(false);
  });
});
