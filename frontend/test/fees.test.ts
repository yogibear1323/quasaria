import { afterEach, describe, expect, it, vi } from "vitest";
import { Account, Asset, Horizon, Keypair, Networks, TransactionBuilder } from "@stellar/stellar-sdk";
import { FEE_CONFIG, MAX_FEE_BPS, canReceiveFrom, feeAmount, feeEnabled, feeText, loadFeeReceiver, parseFeeConfig, planFees, _resetFeeCache } from "../src/lib/fees";
import { buildMarketTx } from "../src/lib/market";
import { buildSwapTx } from "../src/lib/swap";
import { buildLimitOrder, horizon } from "../src/lib/stellar";
import { buildDepositTx, buildWithdrawTx, previewDeposit, previewWithdraw, NETS, type PoolRow } from "../src/lib/nativePools";
import { NETWORK, NETWORK_PASSPHRASE } from "../src/lib/config";

const W = Keypair.random().publicKey(), ME = Keypair.random().publicKey(), ISS = Keypair.random().publicKey();
const ON = { bps: 10, wallet: W }, OFF = { bps: 0, wallet: null };
const USDC = new Asset("USDC", ISS), XLM = Asset.native();
const all = () => true;
const ops = (x: string) => (TransactionBuilder.fromXDR(x, NETWORK_PASSPHRASE) as unknown as { operations: { type: string; destination?: string; amount?: string; asset?: Asset }[] }).operations;

describe("fee config", () => {
  it("is off by default in this build (no env)", () => { expect(feeEnabled(FEE_CONFIG)).toBe(false); });
  it("needs both bps and a valid wallet", () => {
    expect(parseFeeConfig({ VITE_FEE_BPS: "10", VITE_FEE_WALLET: W })).toEqual(ON);
    expect(feeEnabled(parseFeeConfig({ VITE_FEE_BPS: "10" }))).toBe(false);
    expect(feeEnabled(parseFeeConfig({ VITE_FEE_BPS: "0", VITE_FEE_WALLET: W }))).toBe(false);
    expect(parseFeeConfig({ VITE_FEE_BPS: "10", VITE_FEE_WALLET: "GBAD" }).wallet).toBeNull();
    expect(parseFeeConfig({ VITE_FEE_BPS: String(MAX_FEE_BPS + 1), VITE_FEE_WALLET: W }).bps).toBe(0);
    expect(parseFeeConfig({ VITE_FEE_BPS: "1.5", VITE_FEE_WALLET: W }).bps).toBe(0);
  });
  it("rounds down to 7 decimals", () => {
    expect(feeAmount(1000, 10)).toBe(1);
    expect(feeAmount(0.00001, 10)).toBe(0); // dust → no op
    expect(feeAmount(123.4567891, 10)).toBe(0.1234567);
  });
});

describe("planFees", () => {
  it("empty when off or receiver unknown", () => {
    expect(planFees([{ asset: XLM, amount: 100 }], all, OFF)).toEqual([]);
    expect(planFees([{ asset: XLM, amount: 100 }], null, ON)).toEqual([]);
  });
  it("skips assets the wallet can't receive; merges same asset", () => {
    const rx = canReceiveFrom([{ asset_type: "native", balance: "5" }]);
    const l = planFees([{ asset: USDC, amount: 100 }, { asset: XLM, amount: 50 }, { asset: XLM, amount: 50 }], rx, ON);
    expect(l.map((x) => [x.code, x.amount])).toEqual([["XLM", 0.1]]);
    expect(feeText(l)).toBe("0.1 XLM");
  });
  it("trustline checks: authorized + room under limit", () => {
    const b = (o: object) => canReceiveFrom([{ asset_type: "credit_alphanum4", asset_code: "USDC", asset_issuer: ISS, balance: "1", limit: "100", ...o }])(USDC);
    expect(b({})).toBe(true);
    expect(b({ is_authorized: false })).toBe(false);
    expect(b({ limit: "1" })).toBe(false);
  });
  it("loadFeeReceiver → null on missing account / error (fee skipped, trade still works)", async () => {
    _resetFeeCache();
    expect(await loadFeeReceiver("https://h", ON, (async () => ({ ok: false })) as never)).toBeNull();
    _resetFeeCache();
    expect(await loadFeeReceiver("https://h", ON, (async () => { throw new Error("x"); }) as never)).toBeNull();
    _resetFeeCache();
    const rx = await loadFeeReceiver("https://h", ON, (async () => ({ ok: true, json: async () => ({ balances: [{ asset_type: "native", balance: "3" }] }) })) as never);
    expect(rx!(XLM)).toBe(true); expect(rx!(USDC)).toBe(false);
    _resetFeeCache();
  });
});

// Builders: FEE_CONFIG is off in tests, so appendFeeOps with default config adds nothing. Verify both: lines given + off = no op
// (mainnet safety), and the enabled path through a module re-import with env set.
describe("builders with fee OFF add no op", () => {
  const fees = planFees([{ asset: USDC, amount: 1000 }], all, ON);
  it("market", () => { expect(ops(buildMarketTx({ source: ME, sequence: "1", side: "buy", base: XLM, quote: USDC, amount: 10, bound: 1, needTrust: [], passphrase: NETWORK_PASSPHRASE, fees })).map((o) => o.type)).toEqual(["manageBuyOffer"]); });
  it("swap", () => { expect(ops(buildSwapTx({ source: ME, sequence: "1", from: USDC, to: XLM, amount: 10, minOut: 1, path: [], needTrust: [], passphrase: NETWORK_PASSPHRASE, fees })).map((o) => o.type)).toEqual(["pathPaymentStrictSend"]); });
});

describe("builders with fee ON (VITE_FEE_BPS=10)", () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); vi.restoreAllMocks(); });
  const load = async () => {
    vi.stubEnv("VITE_FEE_BPS", "10"); vi.stubEnv("VITE_FEE_WALLET", W); vi.resetModules();
    return { f: await import("../src/lib/fees"), m: await import("../src/lib/market"), s: await import("../src/lib/swap"), st: await import("../src/lib/stellar"), p: await import("../src/lib/nativePools") };
  };
  const pay = (o: ReturnType<typeof ops>[number]) => [o.type, o.destination, o.amount, o.asset?.isNative() ? "XLM" : o.asset?.getCode()];

  it("market sell: fee in base, paid BEFORE the offer (last-op result parsing intact)", async () => {
    const { f, m } = await load();
    const fees = f.planFees([{ asset: XLM, amount: 1000 }], all);
    const o = ops(m.buildMarketTx({ source: ME, sequence: "1", side: "sell", base: XLM, quote: USDC, amount: 1000, bound: 0.1, needTrust: [USDC], passphrase: NETWORK_PASSPHRASE, fees }));
    expect(o.map((x) => x.type)).toEqual(["changeTrust", "payment", "manageSellOffer"]);
    expect(pay(o[1])).toEqual(["payment", W, "1.0000000", "XLM"]);
  });
  it("swap: fee in send asset before path payment", async () => {
    const { f, s } = await load();
    const fees = f.planFees([{ asset: USDC, amount: 250 }], all);
    const o = ops(s.buildSwapTx({ source: ME, sequence: "1", from: USDC, to: XLM, amount: 250, minOut: 1, path: [], needTrust: [], passphrase: NETWORK_PASSPHRASE, fees }));
    expect(o.map((x) => x.type)).toEqual(["payment", "pathPaymentStrictSend"]);
    expect(pay(o[0])).toEqual(["payment", W, "0.2500000", "USDC"]);
  });
  it("limit buy: fee in quote (asset sold)", async () => {
    const { f, st } = await load();
    vi.spyOn(st.horizon, "loadAccount").mockResolvedValue(Object.assign(new Account(ME, "1"), { balances: [{ asset_type: "native", balance: "100" }, { asset_type: "credit_alphanum4", asset_code: "USDC", asset_issuer: ISS, balance: "100" }] }) as never);
    const fees = f.planFees([{ asset: USDC, amount: 500 * 0.2 }], all);
    const o = ops(await st.buildLimitOrder(ME, "buy", XLM, USDC, 500, 0.2, fees));
    expect(o.map((x) => x.type)).toEqual(["payment", "manageBuyOffer"]);
    expect(pay(o[0])).toEqual(["payment", W, "0.1000000", "USDC"]);
  });
  it("pool deposit (fee on both legs, before deposit) and withdraw (fee after withdraw)", async () => {
    const { f, p } = await load();
    vi.spyOn(Horizon.Server.prototype, "loadAccount").mockResolvedValue(Object.assign(new Account(ME, "1"), { balances: [{ asset_type: "native", balance: "100" }, { asset_type: "credit_alphanum4", asset_code: "USDC", asset_issuer: ISS, balance: "100" }] }) as never);
    const a = { code: "XLM", issuer: null }, b = { code: "USDC", issuer: ISS };
    const pool: PoolRow = { id: p.poolIdFor(p.orderAssets(a, b)[0], p.orderAssets(a, b)[1]), a, b, reserveA: 1000, reserveB: 100, totalShares: 300, feeBp: 30 } as unknown as PoolRow;
    const pv = p.previewDeposit({ pool, driver: "A", amount: 100, otherAmount: 0, slippageBps: 100 })!;
    const dfees = f.planFees([{ asset: XLM, amount: pv.maxAmountA }, { asset: USDC, amount: pv.maxAmountB }], all);
    const d = ops((await p.buildDepositTx("testnet", ME, a, b, pv, { fees: dfees })).xdr);
    expect(d.map((x) => x.type)).toEqual(["changeTrust", "payment", "payment", "liquidityPoolDeposit"]);
    const wd = p.previewWithdraw(pool, 30, 100)!;
    const wfees = f.planFees([{ asset: XLM, amount: wd.minAmountA }, { asset: USDC, amount: wd.minAmountB }], all);
    const w = ops(await p.buildWithdrawTx("testnet", ME, pool, wd, false, { fees: wfees }));
    expect(w.map((x) => x.type)).toEqual(["liquidityPoolWithdraw", "payment", "payment"]);
  });
});
void [Networks, NETWORK, NETS, previewDeposit, previewWithdraw, buildDepositTx, buildWithdrawTx, buildLimitOrder, horizon];
