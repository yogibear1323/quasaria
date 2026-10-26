/**
 * PHASE 2 (real mainnet, signs + submits). Do NOT run without Robert's explicit go.
 * Runs one Savings Jar XLM -> USTRY deposit through the PR's code paths with a throwaway key,
 * records it in a jar ledger, verifies on Horizon, then returns funds to Robert.
 *
 * Key: JSON {public, secret} in a 600-perm file (default /home/box/.quasaria-jars-test/key.json). Never logged.
 * Run:
 *   JAR_PHASE2=1 JAR_CLEANUP=sellback|keep|none VITE_NETWORK=mainnet VITE_FEE_BPS=10 \
 *   VITE_FEE_WALLET=GCFL7SS3SMAT4X2VGROPYXX47P6QIXKYMRNGT5EIFYZRQUAN7GK433J2 \
 *   npx vitest run scripts/jar-deposit-phase2.live.test.ts --reporter=verbose
 *  sellback: sell all USTRY back to XLM, remove trustline, merge account into Robert (account closed).
 *  keep:     keep the USTRY + trustline, send every spare XLM above the min balance to Robert.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { Asset, Keypair, Operation, TransactionBuilder, BASE_FEE, Account, Memo } from "@stellar/stellar-sdk";
import { HORIZON_URL, NETWORK_PASSPHRASE, IS_MAINNET } from "../src/lib/config";
import { findStrictSendPath, horizon, submitSignedXdr } from "../src/lib/stellar";
import { fetchBaseReserve, fetchRawAccount } from "../src/lib/account";
import { planFees, loadFeeReceiver } from "../src/lib/fees";
import { checkSwapFunds, buildSwapTx, parseQuote, parseSwapReceived, minReceived } from "../src/lib/swap";
import { planJarSwap, USTRY, USTRY_REF, JAR_DEFAULT_SLIPPAGE } from "../src/lib/jarsSwap";
import { loadJarPrices } from "../src/lib/jarsPrice";
import { emptyLedger, createJar, deposit, toUnitsN, SCALE, jarView } from "../src/lib/jarsLedger";

const ROBERT = "GBMGGJ22QTQMIYNNRFBIVJZ76DDATCU2OP2PGEGKTDRRF35PHES33HLO";
const KEY = process.env.JAR_KEY_FILE || "/home/box/.quasaria-jars-test/key.json";
const OUT = process.env.JAR_OUT || "/home/box/.quasaria-jars-test/result.json";
const AMOUNT = Number(process.env.JAR_AMOUNT || "1.5");
const CLEANUP = (process.env.JAR_CLEANUP || "sellback") as "sellback" | "keep" | "none";
const SELL_SLIPPAGE = 1;
const go = process.env.JAR_PHASE2 === "1";
const log = (k: string, v: unknown) => console.log(`[phase2] ${k}`, typeof v === "string" ? v : JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x)));
const sign = (xdr: string, kp: Keypair) => { const t = TransactionBuilder.fromXDR(xdr, NETWORK_PASSPHRASE); t.sign(kp); return t.toXDR(); };
const ustryBal = (a: { balances: { asset_code?: string; asset_issuer?: string; balance: string }[] }) => a.balances.find((b) => b.asset_code === "USTRY" && b.asset_issuer === USTRY.getIssuer())?.balance;

describe.skipIf(!go)("PHASE 2 live jar deposit (REAL mainnet)", () => {
  it("deposits, verifies, returns funds", async () => {
    expect(IS_MAINNET).toBe(true);
    expect(statSync(KEY).mode & 0o077).toBe(0); // key file must be 600
    const kp = Keypair.fromSecret(JSON.parse(readFileSync(KEY, "utf8")).secret);
    const addr = kp.publicKey(); log("account", addr);

    // 1) exactly what SavingsJars.startSwap does
    const [a, reserve, rec, prices, recv] = await Promise.all([fetchRawAccount("mainnet", addr), fetchBaseReserve("mainnet"), findStrictSendPath(Asset.native(), AMOUNT, USTRY), loadJarPrices(), loadFeeReceiver(HORIZON_URL)]);
    if (!a) throw new Error("Account not funded yet.");
    const fees = planFees([{ asset: Asset.native(), amount: AMOUNT }], recv);
    const f = checkSwapFunds({ from: { code: "XLM", issuer: null }, to: USTRY_REF, amount: AMOUNT + fees.reduce((s, l) => s + l.amount, 0), acct: a, baseReserve: reserve, extraOps: fees.length });
    if (!f.ok) throw new Error(f.error);
    const plan = planJarSwap({ quote: parseQuote(AMOUNT, rec as never), slippage: JAR_DEFAULT_SLIPPAGE, xlmUsd: prices.xlmUsd?.price ?? null, ustryUsd: prices.ustry?.usd ?? null });
    if (!plan.ok) throw new Error(plan.error);
    log("quote", { out: plan.quote.destAmount, minOut: plan.minOut, impactPct: plan.impactPct, path: plan.quote.path.map((x) => (x.isNative() ? "XLM" : x.getCode())), fees: fees.map((l) => `${l.amount} ${l.code}`) });

    // 2) exactly what confirmSwap does (w.sign replaced by the throwaway key)
    const seq = (await horizon.loadAccount(addr)).sequenceNumber();
    const xdr = buildSwapTx({ source: addr, sequence: seq, from: Asset.native(), to: USTRY, amount: AMOUNT, minOut: plan.minOut, path: plan.quote.path, needTrust: f.needTrust.length ? [USTRY] : [], passphrase: NETWORK_PASSPHRASE, fees });
    const res = await submitSignedXdr(sign(xdr, kp));
    const got = parseSwapReceived(res.result_xdr) ?? plan.minOut;
    const xlmSpent = AMOUNT + fees.reduce((s, l) => s + l.amount, 0);
    const xlmUsd = prices.xlmUsd?.price ?? 0;
    let ledger = createJar(emptyLedger(), { name: "Phase 2 test", fund: "XLM" });
    const id = ledger.jars[0].id;
    ledger = deposit(ledger, id, { units: toUnitsN(got), usd: (toUnitsN(xlmSpent) * BigInt(Math.round(xlmUsd * 1e7))) / SCALE, xlm: toUnitsN(xlmSpent), tx: res.hash });
    log("deposit tx", `${res.hash} received ${got} USTRY`);

    // 3) verify on Horizon
    const t = await horizon.transactions().transaction(res.hash).call();
    expect(t.successful).toBe(true);
    const after = await horizon.loadAccount(addr);
    expect(Number(ustryBal(after as never))).toBeCloseTo(got, 7);
    expect(got).toBeGreaterThanOrEqual(plan.minOut);
    log("jar view", jarView(ledger.jars[0], prices.ustry ? BigInt(Math.round(prices.ustry.usd * 1e7)) : null));
    const result: Record<string, unknown> = { addr, deposit: res.hash, got, minOut: plan.minOut, ledger };

    // 4) return funds
    if (CLEANUP === "sellback") {
      const bal = ustryBal(after as never)!;
      const back = await findStrictSendPath(USTRY, Number(bal), Asset.native());
      if (!back) throw new Error("No USTRY -> XLM route; rerun with JAR_CLEANUP=keep.");
      const destMin = minReceived(Number(back.destination_amount), SELL_SLIPPAGE);
      const path = back.path.map((p: { asset_type: string; asset_code?: string; asset_issuer?: string }) => (p.asset_type === "native" ? Asset.native() : new Asset(p.asset_code!, p.asset_issuer!)));
      const tx = new TransactionBuilder(new Account(addr, after.sequenceNumber()), { fee: BASE_FEE, networkPassphrase: NETWORK_PASSPHRASE }).setTimeout(180)
        .addOperation(Operation.pathPaymentStrictSend({ sendAsset: USTRY, sendAmount: bal, destination: addr, destAsset: Asset.native(), destMin: destMin.toFixed(7), path }))
        .addOperation(Operation.changeTrust({ asset: USTRY, limit: "0" }))
        .addOperation(Operation.accountMerge({ destination: ROBERT }))
        .addMemo(Memo.text("quasaria jar test")).build();
      tx.sign(kp);
      const r2 = await horizon.submitTransaction(tx);
      log("sellback+merge tx", r2.hash); result.cleanup = { mode: "sellback", tx: r2.hash };
      await expect(horizon.loadAccount(addr)).rejects.toBeTruthy(); // account closed
    } else if (CLEANUP === "keep") {
      const nat = Number((after.balances.find((b) => b.asset_type === "native") as { balance: string }).balance);
      const spare = Math.floor((nat - (2 + after.subentry_count) * reserve! - 0.0001) * 1e7) / 1e7;
      if (spare > 0) {
        const tx = new TransactionBuilder(new Account(addr, after.sequenceNumber()), { fee: BASE_FEE, networkPassphrase: NETWORK_PASSPHRASE }).setTimeout(180)
          .addOperation(Operation.payment({ destination: ROBERT, asset: Asset.native(), amount: spare.toFixed(7) })).addMemo(Memo.text("quasaria jar test")).build();
        tx.sign(kp);
        const r2 = await horizon.submitTransaction(tx);
        log("return spare XLM tx", `${r2.hash} (${spare} XLM)`); result.cleanup = { mode: "keep", tx: r2.hash, spare };
      }
    }
    writeFileSync(OUT, JSON.stringify(result, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 1), { mode: 0o600 });
  }, 180_000);
});
