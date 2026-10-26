/**
 * LIVE dry run of the Savings Jars XLM -> USTRY deposit, using the exact UI code paths.
 * Read-only against mainnet Horizon: nothing is signed or submitted.
 * Run: JAR_LIVE=1 VITE_NETWORK=mainnet VITE_FEE_BPS=10 VITE_FEE_WALLET=GCFL7SS3SMAT4X2VGROPYXX47P6QIXKYMRNGT5EIFYZRQUAN7GK433J2 npx vitest run scripts/jar-deposit.live.test.ts
 */
import { describe, expect, it } from "vitest";
import { Asset, Keypair, TransactionBuilder, xdr as X } from "@stellar/stellar-sdk";
import { HORIZON_URL, NETWORK_PASSPHRASE, IS_MAINNET } from "../src/lib/config";
import { findStrictSendPath } from "../src/lib/stellar";
import { fetchBaseReserve } from "../src/lib/account";
import { planFees, loadFeeReceiver, FEE_WALLET } from "../src/lib/fees";
import { checkSwapFunds, buildSwapTx, parseQuote } from "../src/lib/swap";
import { planJarSwap, USTRY, USTRY_REF, JAR_DEFAULT_SLIPPAGE } from "../src/lib/jarsSwap";
import { loadJarPrices } from "../src/lib/jarsPrice";

const AMOUNT = 1.5, FUND = 4;
const live = process.env.JAR_LIVE === "1";

describe.skipIf(!live)("live jar deposit dry run (no signing)", () => {
  it("quotes, builds and validates the deposit tx for a fresh 4 XLM account", async () => {
    expect(IS_MAINNET).toBe(true);
    const addr = Keypair.random().publicKey(); // throwaway, never funded
    const [reserve, rec, prices, recv] = await Promise.all([fetchBaseReserve("mainnet"), findStrictSendPath(Asset.native(), AMOUNT, USTRY), loadJarPrices(), loadFeeReceiver(HORIZON_URL)]);
    // fresh account as Horizon would show it right after create_account with 4 XLM
    const acct = { id: addr, account_id: addr, sequence: "100", subentry_count: 0, num_sponsoring: 0, num_sponsored: 0, balances: [{ asset_type: "native", balance: FUND.toFixed(7), buying_liabilities: "0", selling_liabilities: "0" }] } as never;
    const fees = planFees([{ asset: Asset.native(), amount: AMOUNT }], recv);
    const feeTotal = fees.reduce((s, l) => s + l.amount, 0);
    const f = checkSwapFunds({ from: { code: "XLM", issuer: null }, to: USTRY_REF, amount: AMOUNT + feeTotal, acct, baseReserve: reserve, extraOps: fees.length });
    const quote = parseQuote(AMOUNT, rec as never);
    const plan = planJarSwap({ quote, slippage: JAR_DEFAULT_SLIPPAGE, xlmUsd: prices.xlmUsd?.price ?? null, ustryUsd: prices.ustry?.usd ?? null });
    expect(f.ok).toBe(true); expect(plan.ok).toBe(true);
    if (!f.ok || !plan.ok) return;
    const xdrB64 = buildSwapTx({ source: addr, sequence: "100", from: Asset.native(), to: USTRY, amount: AMOUNT, minOut: plan.minOut, path: plan.quote.path, needTrust: f.needTrust.length ? [USTRY] : [], passphrase: NETWORK_PASSPHRASE, fees });
    const tx = TransactionBuilder.fromXDR(xdrB64, NETWORK_PASSPHRASE) as import("@stellar/stellar-sdk").Transaction;
    const ops = tx.operations.map((o) => o.type);
    expect(ops).toEqual(["changeTrust", ...(fees.length ? ["payment"] : []), "pathPaymentStrictSend"]);
    const pp = tx.operations.at(-1) as import("@stellar/stellar-sdk").Operation.PathPaymentStrictSend;
    expect(pp.sendAmount).toBe("1.5000000"); expect(pp.destination).toBe(addr);
    expect(Number(pp.destMin)).toBeCloseTo(plan.minOut, 7);
    expect((pp.destAsset as Asset).getIssuer()).toBe(USTRY.getIssuer());
    expect(Number(tx.fee)).toBe(100 * ops.length);
    expect(X.TransactionEnvelope.fromXDR(xdrB64, "base64").toXDR("base64")).toBe(xdrB64);
    // reserve math: after tx, min balance = (2 + 1 subentry) * 0.5 = 1.5 XLM
    const spent = AMOUNT + feeTotal + Number(tx.fee) / 1e7;
    const left = FUND - spent, minBal = (2 + 1) * reserve!;
    expect(left).toBeGreaterThan(minBal);
    // refusal rules
    const poor = { ...(acct as object), balances: [{ asset_type: "native", balance: "2.9000000" }] } as never;
    const fPoor = checkSwapFunds({ from: { code: "XLM", issuer: null }, to: USTRY_REF, amount: AMOUNT + feeTotal, acct: poor, baseReserve: reserve, extraOps: fees.length });
    const tooSlip = planJarSwap({ quote, slippage: 5, xlmUsd: prices.xlmUsd?.price ?? null, ustryUsd: prices.ustry?.usd ?? null });
    const badPx = planJarSwap({ quote: quote && { ...quote, destAmount: quote.destAmount * 0.9 }, slippage: 0.5, xlmUsd: prices.xlmUsd?.price ?? null, ustryUsd: prices.ustry?.usd ?? null });
    const noRoute = planJarSwap({ quote: null, slippage: 0.5, xlmUsd: 1, ustryUsd: 1 });
    expect([fPoor.ok, tooSlip.ok, badPx.ok, noRoute.ok]).toEqual([false, false, false, false]);
    console.log("[jar-live]", JSON.stringify({
      reserve, xlmUsd: prices.xlmUsd?.price, ustryUsd: prices.ustry?.usd, ustryAt: prices.ustry?.at,
      path: plan.quote.path.map((a) => (a.isNative() ? "XLM" : a.getCode())), destAmount: plan.quote.destAmount, minOut: plan.minOut,
      impactPct: plan.impactPct, expectedUsd: plan.expectedUsd, feeLines: fees.map((l) => `${l.amount} ${l.code} -> ${FEE_WALLET}`),
      networkFeeXlm: Number(tx.fee) / 1e7, checkFeeXlm: f.feeXlm, reserveXlm: f.reserveXlm, ops,
      xlmLeft: +left.toFixed(7), minBalance: minBal, spendableAfter: +(left - minBal).toFixed(7),
      refusals: { poor: (fPoor as { error: string }).error, slippage5: (tooSlip as { error: string }).error, quote10pctWorse: (badPx as { error: string }).error, noRoute: (noRoute as { error: string }).error },
      xdrLen: xdrB64.length,
    }, null, 1));
  }, 60_000);
});
