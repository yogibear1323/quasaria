import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { xdr, scValToNative } from "@stellar/stellar-sdk";
import {
  FUNDING_NOT_LIVE, classifyError, estimateOpen, fmtAge, fmtRate, fundingOwed, fundingView, healthFactor, hourly, liquidationPrice,
  markFromPremium, oiFromPositions, parseFundingConfig, parseFundingState, payerText, pnl, priceHealth, readPerps, skewPremium,
  decodeFundingEvent, codeOfAsset, defaultMarkets, LEGACY_VAULTS, type MarketSpec, type Reader,
} from "../src/lib/perps";
import { liquidationPrice as legacyLiq, pnl as legacyPnl } from "../src/lib/math";
import { simErrorDetail } from "../src/lib/soroban";
import Perps, { marketView } from "../src/pages/Perps";
import { WalletProvider } from "../src/lib/wallet";

const src = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const VAULT = "CAKUVSFDQXQGGBO2ZYQEQH6HMRMMDV6DDF4HMGRKK4Y3O2TGFWDAM55V";
const ORACLE = "CBHMDDCD5NDZKQIGP4VKBTQOQ4OQMK75CYAGHBXY2JT7WGBB774NO2DY";
const TRADER = "GBSMEW3XCI3YNPD4U5VYEHLALFWKOX634XZIHQXAXAWLBXTG36OLOP56";
const NOW = 1_791_143_965;
const XLM_SAC = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";
const NEW_VAULT = "CCLI4VU7PD7VKS3NWILJQXI445A2W6L2JQCMM3MOGTHLFBKNTUSUCJX2";
const OLD_MKT: MarketSpec[] = [{ code: "XLM", key: { type: "Other", code: "XLM" } }];
const NEW_MKT: MarketSpec[] = [{ code: "XLM", key: { type: "Stellar", id: XLM_SAC } }];
const E12 = 1_000_000_000_000n;

const fcfg = (o: Partial<Record<string, bigint | number>> = {}) => ({ interval: 3600n, k: E12, skew_scale: 10_000_0000000n, max_premium: E12 / 100n, max_funding_rate_per_hour: E12 / 1000n, interest_per_interval: 0n, max_catchup_intervals: 24, ...o });
const fstate = (o: Partial<Record<string, bigint | number>> = {}) => ({ long_oi: 500_0000000n, short_oi: 0n, index: 0n, last_funding_ts: BigInt(NOW - 1800), premium: 0n, premium_acc: 0n, acc_start: BigInt(NOW - 1800), last_sample_ts: BigInt(NOW - 1800), ...o });

describe("position math mirrors the vault", () => {
  it("PnL is linear in the oracle price (shorts negated)", () => {
    expect(pnl(true, 500, 0.12, 0.1234)).toBeCloseTo(14.1667, 3);
    expect(pnl(false, 500, 0.12, 0.1234)).toBeCloseTo(-14.1667, 3);
    expect(pnl(true, 500, 0.12, 0.12)).toBe(0);
    expect(pnl(true, 500, 0, 1)).toBe(0);
    expect(pnl(true, 500, 0.12, 0.1)).toBeCloseTo(legacyPnl(true, 500, 0.12, 0.1), 9);
  });
  it("liquidation price matches the contract formula and the on-chain value of position #1", () => {
    // live position #1: long, margin 100, size 500, entry 0.12, mm 5% → vault returns 0.102
    expect(liquidationPrice(true, 100, 500, 0.12, 500)).toBeCloseTo(0.102, 9);
    expect(liquidationPrice(false, 100, 500, 0.12, 500)).toBeCloseTo(0.138, 9);
    expect(liquidationPrice(true, 100, 500, 0.12, 500)).toBeCloseTo(legacyLiq(true, 100, 500, 0.12, 500), 12);
    // pending funding owed is taken out of the margin → liq moves closer
    expect(liquidationPrice(true, 100, 500, 0.12, 500, 10)).toBeCloseTo(0.1044, 9);
    expect(liquidationPrice(false, 100, 500, 0.12, 500, -10)).toBeCloseTo(0.1404, 9);
    expect(Number.isNaN(liquidationPrice(true, 100, 0, 0.12, 500))).toBe(true);
  });
  it("health factor counts pending funding", () => {
    expect(healthFactor(100, 500, 0, 500)).toBeCloseTo(4, 9);
    expect(healthFactor(100, 500, 0, 500, 50)).toBeCloseTo(2, 9);
    expect(healthFactor(100, 500, -100, 500)).toBe(0);
  });
  it("open estimate: size, fee, need, liq distance and funding direction", () => {
    const e = estimateOpen({ isLong: true, margin: 100, leverage: 5, price: 0.12, mmBps: 500, openFeeBps: 10, hourlyRate: 0.0001 });
    expect(e.size).toBe(500);
    expect(e.fee).toBeCloseTo(0.5, 9);
    expect(e.need).toBeCloseTo(100.5, 9);
    expect(e.liq).toBeCloseTo(0.102, 9);
    expect(e.distance).toBeCloseTo(0.15, 9);
    expect(e.fundingPerHour).toBeCloseTo(0.05, 9); // long pays at a positive rate
    expect(estimateOpen({ isLong: false, margin: 100, leverage: 5, price: 0.12, mmBps: 500, openFeeBps: 10, hourlyRate: 0.0001 }).fundingPerHour).toBeCloseTo(-0.05, 9);
    expect(estimateOpen({ isLong: true, margin: 100, leverage: 5, price: 0.12, mmBps: 500, openFeeBps: 10, hourlyRate: null }).fundingPerHour).toBeNull();
    expect(Number.isNaN(estimateOpen({ isLong: true, margin: 100, leverage: 5, price: 0, mmBps: 500, openFeeBps: 10, hourlyRate: null }).liq)).toBe(true);
  });
});

describe("funding math mirrors contracts/pricing", () => {
  const c = parseFundingConfig(fcfg());
  it("parses RATE_SCALE / 7-decimal fields", () => {
    expect(c).toMatchObject({ interval: 3600, k: 1, skewScale: 10_000, maxPremium: 0.01, maxFundingRatePerHour: 0.001, maxCatchupIntervals: 24 });
    const s = parseFundingState(fstate());
    expect(s.longOi).toBe(500);
    expect(s.shortOi).toBe(0);
  });
  it("skew premium is clamped and mark = oracle × (1 + premium)", () => {
    expect(skewPremium(500, 0, c)).toBeCloseTo(0.01, 12); // 500/10000 = 5 % → clamped to 1 %
    expect(skewPremium(50, 0, c)).toBeCloseTo(0.005, 12);
    expect(skewPremium(0, 50, c)).toBeCloseTo(-0.005, 12);
    expect(skewPremium(50, 0, { ...c, k: 0 })).toBe(0);
    expect(markFromPremium(0.12, 0.01)).toBeCloseTo(0.1212, 12);
  });
  it("current vs predicted (TWAP) rate, hourly normalisation, cap and next interval", () => {
    // premium in force for the last 30 min was 0, but current OI implies +1 % (capped by 0.1 %/h)
    const v = fundingView(c, parseFundingState(fstate()), NOW);
    expect(v.premium).toBeCloseTo(0.01, 12);
    expect(v.currentHourly).toBeCloseTo(0.001, 12); // capped
    expect(v.predictedHourly).toBe(0); // TWAP so far 0
    expect(v.nextAt).toBe(NOW + 1800);
    const v2 = fundingView(c, parseFundingState(fstate({ premium: E12 / 2000n })), NOW); // 0.05 % held for 30 min
    expect(v2.predictedHourly).toBeCloseTo(0.0005, 12);
    expect(hourly(0.0002, 1800)).toBeCloseTo(0.0004, 12);
    expect(v.off).toBe(false);
    expect(fundingView(parseFundingConfig(fcfg({ k: 0n, max_funding_rate_per_hour: 0n })), parseFundingState(fstate()), NOW).off).toBe(true);
  });
  it("funding owed sign: long pays on a rising index, short receives", () => {
    expect(fundingOwed(true, 1000, 0, 0.001)).toBeCloseTo(1, 12);
    expect(fundingOwed(false, 1000, 0, 0.001)).toBeCloseTo(-1, 12);
  });
  it("display helpers", () => {
    expect(fmtRate(0.000125)).toBe("+0.0125%");
    expect(fmtRate(-0.0005, 2)).toBe("−0.05%");
    expect(fmtRate(0)).toBe("0.0000%");
    expect(fmtRate(null)).toBe("—");
    expect(payerText(1)).toBe("longs pay shorts");
    expect(payerText(-1)).toBe("shorts pay longs");
    expect(fmtAge(30)).toBe("30 s");
    expect(fmtAge(900)).toBe("15 min");
    expect(fmtAge(497_633)).toBe("5.8 d");
  });
  it("decodes funding_upd events", () => {
    const ev = decodeFundingEvent({ ledger: 7, ledgerClosedAt: "2026-10-04T19:00:00Z", topic: ["funding_upd", ["Stellar", XLM_SAC]], value: { intervals: 2n, charged: 2n, premium_twap: E12 / 10_000n, rate: E12 / 10_000n, index: E12 / 5000n } }, NEW_MKT);
    expect(ev).toMatchObject({ market: "XLM", intervals: 2, charged: 2, rate: 0.0001, index: 0.0002 });
  });
});

describe("market keys", () => {
  it("legacy vault keys XLM as Other(XLM); fresh vaults as Stellar(native XLM SAC); config can override", () => {
    expect(LEGACY_VAULTS).toContain(VAULT);
    expect(defaultMarkets(VAULT, {}, XLM_SAC)).toEqual(OLD_MKT);
    expect(defaultMarkets(NEW_VAULT, {}, XLM_SAC)).toEqual(NEW_MKT);
    expect(defaultMarkets("CNEXT", {}, XLM_SAC, { vault: "CNEXT", market: { Other: "XLM" } })).toEqual(OLD_MKT);
    expect(defaultMarkets("CNEXT", {}, XLM_SAC, { vault: "COTHER", market: { Other: "XLM" } })).toEqual(NEW_MKT);
    expect(defaultMarkets(NEW_VAULT, { markets: [{ code: "BTC", other: "BTC" }, { code: "XLM", stellar: XLM_SAC }] }, XLM_SAC)).toEqual([{ code: "BTC", key: { type: "Other", code: "BTC" } }, ...NEW_MKT]);
  });
  it("maps decoded assets back to market codes", () => {
    expect(codeOfAsset(["Stellar", XLM_SAC], NEW_MKT)).toBe("XLM");
    expect(codeOfAsset(["Other", "XLM"], OLD_MKT)).toBe("XLM");
    expect(codeOfAsset(["Other", "XLM"], NEW_MKT)).toBe("XLM");
    expect(codeOfAsset(["Stellar", VAULT], NEW_MKT)).toBe("CAKU…M55V");
  });
});

describe("oracle freshness", () => {
  it("flags the halted vault's 5.8-day-old price and the gap to the live reference", () => {
    const h = priceHealth({ price: 0.1234, timestamp: 1_790_646_332, now: NOW, maxAge: 900, reference: 0.3 });
    expect(h.stale).toBe(true);
    expect(h.deviates).toBe(true);
    expect(h.reasons.join(" ")).toMatch(/5\.8 d old/);
    expect(h.reasons.join(" ")).toMatch(/live reference/);
  });
  it("catches a restamped (fresh-looking) old price via the reference only", () => {
    const h = priceHealth({ price: 0.1234, timestamp: NOW - 10, now: NOW, maxAge: 900, reference: 0.3 });
    expect(h.stale).toBe(false);
    expect(h.deviates).toBe(true);
  });
  it("fresh and close to the reference → no warning; missing price → stale", () => {
    expect(priceHealth({ price: 0.301, timestamp: NOW - 10, now: NOW, maxAge: 900, reference: 0.3 }).reasons).toEqual([]);
    expect(priceHealth({ price: null, timestamp: null, now: NOW, maxAge: 900 }).stale).toBe(true);
  });
});

describe("graceful degradation (feature detection)", () => {
  it("classifies simulation failures", () => {
    expect(simErrorDetail({ error: 'HostError: Error(WasmVm, MissingValue) ... "trying to invoke non-existent contract function", funding_state' })).toBe(" (non-existent contract function)");
    expect(simErrorDetail({ error: "HostError: Error(Contract, #7) blah" })).toBe(" (Error(Contract, #7))");
    expect(simErrorDetail({})).toBe("");
    expect(classifyError(new Error("simulation failed: funding_state (non-existent contract function)"))).toBe("missing");
    expect(classifyError(new Error("simulation failed: health_factor (Error(Contract, #7))"))).toBe("stale");
    expect(classifyError(new Error("simulation failed: x (Error(Contract, #6))"))).toBe("no-price");
    expect(classifyError(new Error("fetch failed"))).toBe("error");
  });
  it("OI from positions when funding_state is unavailable", () => {
    expect(oiFromPositions([{ asset: "XLM", isLong: true, size: 500 }, { asset: "XLM", isLong: false, size: 200 }, { asset: "BTC", isLong: true, size: 9 }], "XLM")).toEqual({ long: 500, short: 200 });
  });

  const assetOf = (args: xdr.ScVal[] = []) => {
    const v = args[0] ? scValToNative(args[0]) : null;
    return v;
  };
  const pos = (id: bigint, is_long: boolean) => ({ id, owner: TRADER, asset: ["Other", "XLM"], is_long, margin: 100_0000000n, size: 500_0000000n, entry_price: 12_000_000_000_000n, stop_loss: 0n, take_profit: 0n, opened_at: 1n });
  const base: Record<string, (args?: xdr.ScVal[]) => unknown> = {
    config: () => ({ max_leverage_bps: 100000, maintenance_margin_bps: 500, liquidation_bonus_bps: 500, open_fee_bps: 10, max_price_age: 900n, min_margin: 100000000n, max_positions_per_user: 10, max_open_positions: 1000 }),
    liquidity: () => 2_000_000_0000000n,
    open_position_count: () => 2,
    paused: () => false,
    oracle: () => ORACLE,
    decimals: () => 14,
    lastprice: () => ({ price: 12_340_000_000_000n, timestamp: 1_790_646_332n }),
    user_positions: () => [1n, 2n],
    position: (a) => (assetOf(a) === 1n ? pos(1n, true) : pos(2n, false)),
    open_position_ids_page: () => [1n, 2n],
    liquidation_price: () => 10_200_000_000_000n,
    health_factor: () => { throw new Error("simulation failed: health_factor (Error(Contract, #7))"); },
    free_collateral: () => 5_0000000n,
  };
  const reader = (extra: Record<string, (args?: xdr.ScVal[]) => unknown> = {}): Reader => (async (_id: string, method: string, args?: xdr.ScVal[]) => {
    const f = extra[method] ?? base[method];
    if (!f) throw new Error(`simulation failed: ${method} (non-existent contract function)`);
    return f(args);
  }) as Reader;

  it("old (deployed) vault: funding methods missing → not live, everything else live, no invented numbers", async () => {
    const d = await readPerps(TRADER, reader(), VAULT, OLD_MKT, NOW);
    expect(d.fundingLive).toBe(false);
    expect(d.oracle).toBe(ORACLE);
    expect(d.liquidity).toBe(2_000_000);
    expect(d.positions).toHaveLength(2);
    expect(d.positions[0]).toMatchObject({ id: 1, isLong: true, size: 500, leverage: 5, entry: 0.12, liqOnChain: 0.102 });
    expect(d.positions[0].pendingFunding).toMatchObject({ ok: false, reason: "missing" });
    expect(d.positions[0].hfOnChain).toMatchObject({ ok: false, reason: "stale" });
    const m = d.markets[0];
    expect(m.price).toBeCloseTo(0.1234, 12);
    expect(m.oi).toEqual({ long: 500, short: 500, source: "positions", partial: false });
    const v = marketView(m, d, NOW, 0.3);
    expect(v.funding).toBeNull();
    expect(v.mark.value).toBeNull();
    expect(v.fundingStatus).toBe(FUNDING_NOT_LIVE);
    expect(v.health.stale).toBe(true);
  });

  it("fresh vault with the funding module: funding config/state/mark/pending read live", async () => {
    const d = await readPerps(TRADER, reader({
      funding_config: () => fcfg(),
      funding_state: () => fstate({ premium: E12 / 2000n }),
      mark_price: () => 12_463_400_000_000n,
      pending_funding: () => 1234n,
      lastprice: () => ({ price: 12_340_000_000_000n, timestamp: BigInt(NOW - 30) }),
      health_factor: () => 39_000n,
      position: (a) => ({ ...pos(assetOf(a) as bigint, assetOf(a) === 1n), asset: ["Stellar", XLM_SAC] }),
    }), NEW_VAULT, NEW_MKT, NOW);
    expect(d.fundingLive).toBe(true);
    const m = d.markets[0];
    expect(m.oi.source).toBe("funding_state");
    const v = marketView(m, d, NOW, 0.1235);
    expect(v.mark).toMatchObject({ note: "mark_price()" });
    expect(v.mark.value).toBeCloseTo(0.124634, 9);
    expect(v.funding!.predictedHourly).toBeCloseTo(0.0005, 12);
    expect(v.fundingStatus).toMatch(/Funding live/);
    expect(v.health.reasons).toEqual([]);
    expect(d.positions[0].pendingFunding).toEqual({ ok: true, value: 0.0001234 });
    expect(d.positions[0].hfOnChain).toEqual({ ok: true, value: 3.9 });
  });

  it("funding module live but the oracle is stale: mark derived from the premium, flagged", async () => {
    const d = await readPerps(TRADER, reader({
      funding_config: () => fcfg(),
      funding_state: () => fstate(),
      mark_price: () => { throw new Error("simulation failed: mark_price (Error(Contract, #7))"); },
      pending_funding: () => 0n,
      position: (a) => ({ ...pos(assetOf(a) as bigint, assetOf(a) === 1n), asset: ["Stellar", XLM_SAC] }),
    }), NEW_VAULT, NEW_MKT, NOW);
    const v = marketView(d.markets[0], d, NOW, null);
    expect(d.fundingLive).toBe(true);
    expect(v.mark.value).toBeCloseTo(0.1234 * 1.01, 12);
    expect(v.mark.note).toMatch(/stale/);
    expect(v.health.stale).toBe(true);
  });
});

describe("Perps page + navigation", () => {
  it("is routed, in the nav, and deep-linkable on GitHub Pages", () => {
    expect(src("src/App.tsx")).toMatch(/<Route path="\/perps" element={<Perps \/>} \/>/);
    expect(src("src/components/Layout.tsx")).toMatch(/{ to: "\/perps", label: "Perps"/);
    expect(src("vite.config.ts")).toMatch(/"perps"/);
  });
  it("targets the configured perps-v1 vault and its Stellar(XLM SAC) market key", async () => {
    const { PERPS } = await import("../src/lib/perps");
    const cfg = JSON.parse(src("src/config/testnet.json"));
    expect(PERPS.vault).toBe(cfg.contracts.vault);
    expect(PERPS.markets).toEqual([{ code: "XLM", key: { type: "Stellar", id: cfg.vault.marketAsset.Stellar } }]);
  });
  it("reads the vault id from the normal app config (swappable via testnet.json / VITE_VAULT_ID)", () => {
    expect(src("src/lib/perps.ts")).toMatch(/vault: CONTRACTS\.vault/);
    expect(src("src/lib/config.ts")).toMatch(/VITE_VAULT_ID/);
  });
  it("renders the in-development labels and risk notes, without clipped gradient text", () => {
    const html = renderToStaticMarkup(<WalletProvider><MemoryRouter><Perps /></MemoryRouter></WalletProvider>);
    expect(html).toContain("Testnet · In development");
    expect(html).toContain(">Perps<");
    expect(html).toMatch(/no guaranteed returns/i);
    expect(html).toMatch(/liquidated/);
    expect(html).toContain("Open position");
    const page = src("src/pages/Perps.tsx") + src("src/lib/perps.ts");
    expect(page).not.toMatch(/background-clip/);
  });
});
