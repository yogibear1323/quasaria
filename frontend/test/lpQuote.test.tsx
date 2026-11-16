import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { impermanentLoss } from "../src/lib/calc";
import { feeAmount } from "../src/lib/fees";
import {
  consumePage, emptyWalkState, finishWalk, matchedDeposit, monthlyFeeUsd, quoteNativeLp, tableFeeApr, valueInUnit, volumeOfTrade, WINDOW_MAX_AGE_MS,
  type NativePoolSide, type UnitTrade, type VolumeWalk,
} from "../src/lib/lpQuote";
import { fetchTradeWindow, parsePoolTrade } from "../src/lib/lpQuoteData";
import { LpQuoteBody } from "../src/components/calc/LpCalculator";
import { calculatorExtraPairs, curatedList, usdUnit, type AssetRef } from "../src/lib/nativePools";
import { WalletProvider } from "../src/lib/wallet";
import Landing from "../src/pages/Landing";
import Pools from "../src/pages/Pools";
import Calculators from "../src/pages/Calculators";

const XLM: AssetRef = { code: "XLM", issuer: null };
const USDC: AssetRef = { code: "USDC", issuer: "GDRIVERISSUERAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" };
const NOW = Date.parse("2026-11-07T12:00:00.000Z");
const pool: NativePoolSide = { reserveA: 1000, reserveB: 500, feeBp: 30, codeA: "XLM", codeB: "USDC" };

const walk = (over: Partial<VolumeWalk> = {}): VolumeWalk => ({
  ok: true, truncated: false, reachedCutoff: true, volumeInUnit: 2000, tradesInWindow: 4,
  fetchedAtMs: NOW, newestTradeMs: NOW - 1000, oldestInWindowMs: NOW - 3_600_000, pages: 1, ...over,
});

const quote = (over: Partial<Parameters<typeof quoteNativeLp>[0]> = {}) => quoteNativeLp({
  pool, walk: walk(), nowMs: NOW + 1000, deposit: 1000, driver: "A", unitCode: "XLM", unitIsA: true, usdPerUnit: null,
  platform: { enabled: false, bps: 0 }, priceChangePct: 0, ...over,
});

const trade = (atMs: number, baseAmount: number, counterAmount: number, base: AssetRef = XLM, counter: AssetRef = USDC): UnitTrade => ({
  atMs, base, baseAmount, counter, counterAmount,
});

const body = (q: ReturnType<typeof quoteNativeLp>, variant: "full" | "compact" = "full") => renderToStaticMarkup(
  <MemoryRouter><LpQuoteBody variant={variant} loading={false} loadError={null} quote={q} reserves={null} controls={null} glacierMoved={null} canOpen={false} /></MemoryRouter>,
);

describe("post-deposit share and fees", () => {
  it("matches both sides and dilutes the share", () => {
    const big = matchedDeposit(1000, 500, "A", 1000)!;
    const small = matchedDeposit(1000, 500, "A", 100)!;
    expect(big.amountB).toBeCloseTo(500);
    expect(big.share).toBeCloseTo(0.5);
    expect(small.share).toBeCloseTo(100 / 1100);
    expect(small.share).toBeLessThan(big.share);
    expect(valueInUnit(big.amountA, big.amountB, 1000, 500, true)).toBeCloseTo(2000);
  });

  it("fee income is volume × 0.30% × post-deposit share, simple 30- and 365-day figures", () => {
    const q = quote();
    expect(q.fees).not.toBeNull();
    expect(q.fees!.daily).toBeCloseTo(3);
    expect(q.fees!.monthly).toBeCloseTo(90);
    expect(q.fees!.yearly).toBeCloseTo(1095);
    expect(q.fees!.apr).toBeCloseTo(1095 / 2000);
    const tiny = quote({ deposit: 100 });
    expect(tiny.fees!.apr).toBeGreaterThan(q.fees!.apr);
  });

  it("a driver on the other side uses the same share", () => {
    const q = quote({ driver: "B", deposit: 500, unitIsA: false, unitCode: "USDC" });
    expect(q.amountA).toBeCloseTo(1000);
    expect(q.share).toBeCloseTo(0.5);
    expect(q.depositValue!.amount).toBeCloseTo(1000);
    expect(q.depositValue!.code).toBe("USDC");
  });
});

describe("zero, unknown, truncated, stale, invalid", () => {
  it("true zero only when the complete window measured no volume", () => {
    const q = quote({ walk: walk({ volumeInUnit: 0, tradesInWindow: 0 }) });
    expect(q.window).toBe("complete");
    expect(q.fees!.daily).toBe(0);
    expect(q.fees!.apr).toBe(0);
    expect(q.fees!.zeroVolume).toBe(true);
  });

  it("a failed read that happens to carry volume 0 is withheld, not shown as zero", () => {
    const q = quote({ walk: walk({ ok: false, volumeInUnit: 0, tradesInWindow: 0, reachedCutoff: false }) });
    expect(q.window).toBe("unavailable");
    expect(q.fees).toBeNull();
    expect(q.windowProblem).toMatch(/withheld/);
  });

  it("truncation withholds even a large partial volume", () => {
    const q = quote({ walk: walk({ truncated: true, reachedCutoff: false, volumeInUnit: 1_000_000 }) });
    expect(q.window).toBe("truncated");
    expect(q.fees).toBeNull();
  });

  it("a stale complete window withholds", () => {
    const q = quote({ walk: walk({ fetchedAtMs: NOW - WINDOW_MAX_AGE_MS - 1 }), nowMs: NOW });
    expect(q.window).toBe("stale");
    expect(q.fees).toBeNull();
  });

  it("rejects empty, negative, and non-numeric deposits without a fee rate", () => {
    for (const deposit of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const q = quote({ deposit });
      expect(q.fees, String(deposit)).toBeNull();
      expect(q.inputProblem).toMatch(/greater than zero/);
    }
  });

  it("does not invent reserves, a fee rate, or a pool", () => {
    expect(quote({ pool: { ...pool, reserveA: 0 } }).fees).toBeNull();
    expect(quote({ pool: { ...pool, feeBp: 0 } }).fees).toBeNull();
    expect(quote({ pool: null, walk: null }).fees).toBeNull();
    expect(quote({ pool: null, walk: null }).windowProblem).toMatch(/no native pool/);
  });

  it("leaves USD empty when no reliable price was supplied", () => {
    const q = quote({ usdPerUnit: null });
    expect(q.depositValue!.usd).toBeNull();
    expect(q.fees!.usdPerUnit).toBeNull();
    expect(q.fees!.monthlyUsd).toBeNull();
    expect(q.usdUnavailable).toBe(true);
    const priced = quote({ usdPerUnit: 0.5 });
    expect(priced.depositValue!.usd).toBeCloseTo(1000);
    expect(priced.fees!.usdPerUnit).toBe(0.5);
    expect(priced.fees!.monthlyUsd).toBeCloseTo(priced.fees!.monthly * 0.5);
    expect(priced.fees!.monthlyUsdVia).toBe("unit");
  });
});

describe("trade volume is one side only", () => {
  it("counts the unit asset once when both legs are present", () => {
    const t = trade(NOW, 10, 3);
    expect(volumeOfTrade(t, XLM)).toBe(10);
    expect(volumeOfTrade(t, USDC)).toBe(3);
    expect(volumeOfTrade(t, XLM)).not.toBe(13);
  });

  it("if both records were the unit, still counts one side", () => {
    const t = trade(NOW, 10, 4, XLM, XLM);
    expect(volumeOfTrade(t, XLM)).toBe(10);
  });

  it("an unrelated asset fails the trade instead of becoming zero volume", () => {
    expect(volumeOfTrade(trade(NOW, 10, 3), { code: "SHX", issuer: "GOTHER" })).toBeNull();
  });
});

describe("impermanent loss stays separate from fees", () => {
  it("matches 2× and ½× and does not change the fee line", () => {
    const up = quote({ priceChangePct: 100 });
    const down = quote({ priceChangePct: -50 });
    expect(up.il!.ilPct).toBeCloseTo(impermanentLoss(2), 10);
    expect(down.il!.ilPct).toBeCloseTo(impermanentLoss(0.5), 10);
    expect(up.il!.ilPct).toBeCloseTo(down.il!.ilPct, 10);
    expect(up.fees!.daily).toBeCloseTo(down.fees!.daily);
    expect(up.il!.lp).not.toBeCloseTo(up.il!.hold);
  });
});

describe("platform fee is separate", () => {
  it("is empty when the flag is off and uses the configured bps when on", () => {
    expect(quote().platform.enabled).toBe(false);
    expect(quote().platform.deposit).toEqual([]);
    const on = quote({ platform: { enabled: true, bps: 10 } });
    expect(on.platform.deposit).toEqual([
      { code: "XLM", amount: feeAmount(1000, 10) },
      { code: "USDC", amount: feeAmount(500, 10) },
    ]);
    expect(on.platform.withdraw.map((l) => l.amount)).toEqual(on.platform.deposit.map((l) => l.amount));
    expect(on.fees!.daily).toBeCloseTo(3);
  });
});

describe("pools table rate", () => {
  it("annualizes a full window and withholds truncated, pending, and missing inputs", () => {
    expect(tableFeeApr(1000, 100_000, false, false)).toBeCloseTo((1000 * 0.003 * 365 / 100_000) * 100);
    expect(tableFeeApr(1000, 100_000, true, false)).toBe("incomplete");
    expect(tableFeeApr(null, 100_000, false, true)).toBe("loading");
    expect(tableFeeApr(null, 100_000, false, false)).toBe("unknown");
    expect(tableFeeApr(10, 0, false, false)).toBe("unknown");
  });
});

describe("Horizon trade window", () => {
  const unit = XLM;
  const raw = (iso: string, base: string, counter = "2") => ({
    ledger_close_time: iso,
    base_asset_type: "native",
    base_amount: base,
    counter_asset_type: "credit_alphanum4",
    counter_asset_code: "USDC",
    counter_asset_issuer: USDC.issuer,
    counter_amount: counter,
  });

  it("parses a trade and rejects a bad timestamp", () => {
    expect(parsePoolTrade(raw("2026-11-07T11:00:00.000Z", "5"))!.baseAmount).toBe(5);
    expect(parsePoolTrade({ ...raw("nope", "5") })).toBeNull();
  });

  it("stops at the 24h cutoff and does not add the counter amount", async () => {
    const body = { _embedded: { records: [raw("2026-11-07T11:00:00.000Z", "10", "3"), raw("2026-11-06T10:00:00.000Z", "99", "99")] } };
    const fetchImpl = (async () => ({ ok: true, json: async () => body })) as unknown as typeof fetch;
    const w = await fetchTradeWindow("https://horizon.example", "ab".repeat(32), unit, NOW, { fetchImpl, maxPages: 4, limit: 200 });
    expect(w.ok).toBe(true);
    expect(w.reachedCutoff).toBe(true);
    expect(w.truncated).toBe(false);
    expect(w.volumeInUnit).toBe(10);
    expect(w.tradesInWindow).toBe(1);
  });

  it("marks a full page that never reaches the cutoff as truncated", async () => {
    const body = { _embedded: { records: [raw("2026-11-07T11:00:00.000Z", "10")] }, _links: { next: { href: "https://horizon.example/next" } } };
    const fetchImpl = (async () => ({ ok: true, json: async () => body })) as unknown as typeof fetch;
    const w = await fetchTradeWindow("https://horizon.example", "cd".repeat(32), unit, NOW, { fetchImpl, maxPages: 1, limit: 1 });
    expect(w.truncated).toBe(true);
    expect(w.reachedCutoff).toBe(false);
    expect(quote({ walk: w }).fees).toBeNull();
  });

  it("a finished empty window is a real zero, and network failures are not", async () => {
    const empty = (async () => ({ ok: true, json: async () => ({ _embedded: { records: [] } }) })) as unknown as typeof fetch;
    const zero = await fetchTradeWindow("https://horizon.example", "ef".repeat(32), unit, NOW, { fetchImpl: empty });
    expect(zero.ok && zero.reachedCutoff && !zero.truncated && zero.volumeInUnit === 0).toBe(true);
    expect(quote({ walk: zero }).fees!.zeroVolume).toBe(true);

    const down = (async () => ({ ok: false, status: 500, json: async () => ({}) })) as unknown as typeof fetch;
    const failed = await fetchTradeWindow("https://horizon.example", "11".repeat(32), unit, NOW, { fetchImpl: down });
    expect(failed.ok).toBe(false);
    expect(quote({ walk: failed }).fees).toBeNull();

    const boom = (async () => { throw new Error("network"); }) as unknown as typeof fetch;
    expect((await fetchTradeWindow("https://horizon.example", "22".repeat(32), unit, NOW, { fetchImpl: boom })).ok).toBe(false);
  });

  it("a trade that is not in the unit asset fails the window", () => {
    const state = consumePage(emptyWalkState(), [trade(NOW, 1, 1, USDC, { code: "SHX", issuer: "GOTHER" })], XLM, NOW);
    expect(state.bad).toBe(true);
    expect(finishWalk(state, { pages: 1, maxPages: 8, exhausted: true, fetchedAtMs: NOW }).ok).toBe(false);
  });
});

describe("quote view", () => {
  it("shows the annualized rate for a complete window and withholds it when truncated", () => {
    const html = body(quote());
    expect(html).toContain("lp-apr");
    expect(html).toContain("No liquidity-provider incentive");
    expect(html).toContain("not paid on pool shares");
    expect(html).not.toContain("data-testid=\"lp-net\"");
    const cut = body(quote({ walk: walk({ truncated: true, reachedCutoff: false }), priceChangePct: 100, usdPerUnit: 0.25, assetUsd: { a: 0.25, b: null } }));
    expect(cut).toContain("lp-withheld");
    expect(cut).toContain("monthly USD estimate");
    expect(cut).not.toContain("data-testid=\"lp-apr\"");
    expect(cut).not.toContain("data-testid=\"lp-daily\"");
    expect(cut).not.toContain("data-testid=\"lp-monthly-usd\"");
  });

  it("labels a verified zero as $0.00 and does not invent a price for the deposit", () => {
    const html = body(quote({ walk: walk({ volumeInUnit: 0, tradesInWindow: 0 }) }));
    expect(html).toContain("lp-zero");
    expect(html).toContain("USD unavailable");
    expect(html).toContain("$0.00");
    expect(html).toContain("data-testid=\"lp-monthly-usd\"");
  });
});

describe("monthly fee USD", () => {
  const xlm = { a: 0.25, b: null as number | null };
  const priced = { usdPerUnit: 0.25, assetUsd: xlm };

  it("prices an XLM fee leg at the live XLM price and does not add the other leg", () => {
    expect(monthlyFeeUsd(10, true, 1000, 500, 0.25, null)).toEqual({ usd: 2.5, via: "unit" });
    const q = quote(priced);
    expect(q.fees!.monthly).toBeCloseTo(90);
    expect(q.fees!.monthlyUsd).toBeCloseTo(90 * 0.25);
    expect(q.fees!.monthlyUsdVia).toBe("unit");
    const both = quote({ ...priced, assetUsd: { a: 0.25, b: 1 } });
    expect(both.fees!.monthlyUsd).toBeCloseTo(90 * 0.25);
    expect(both.fees!.monthlyUsdVia).toBe("unit");
  });

  it("values the other leg through the pool ratio when only XLM has a USD price", () => {
    expect(monthlyFeeUsd(90, true, 1000, 500, null, 0.25)).toEqual({ usd: 90 * (500 / 1000) * 0.25, via: "pool-ratio" });
    const q = quote({ usdPerUnit: null, unitCode: "GLACIERQ", assetUsd: { a: null, b: 0.25 } });
    expect(q.fees!.code).toBe("GLACIERQ");
    expect(q.fees!.usdPerUnit).toBeNull();
    expect(q.fees!.monthlyUsd).toBeCloseTo(90 * (500 / 1000) * 0.25);
    expect(q.fees!.monthlyUsdVia).toBe("pool-ratio");
  });

  it("prices a USDC fee leg at one dollar", () => {
    expect(monthlyFeeUsd(90, false, 1000, 500, null, 1)).toEqual({ usd: 90, via: "unit" });
    const q = quote({ driver: "B", deposit: 500, unitIsA: false, unitCode: "USDC", usdPerUnit: 1, assetUsd: { a: null, b: 1 } });
    expect(q.fees!.monthly).toBeCloseTo(90);
    expect(q.fees!.monthlyUsd).toBeCloseTo(90);
    expect(q.fees!.monthlyUsdVia).toBe("unit");
  });

  it("values the other leg through the pool ratio when only USDC has a USD price", () => {
    expect(monthlyFeeUsd(90, true, 1000, 500, null, 1)).toEqual({ usd: 45, via: "pool-ratio" });
    const q = quote({ usdPerUnit: null, unitCode: "USTRY", assetUsd: { a: null, b: 1 } });
    expect(q.fees!.monthlyUsd).toBeCloseTo(45);
    expect(q.fees!.monthlyUsdVia).toBe("pool-ratio");
  });

  it("uses curated USD prices: XLM and USDC count, EUR pegs and GLACIERQ do not", () => {
    const pricing = { xlmUsd: 0.25 };
    const list = curatedList("mainnet");
    const usdc = list.find((a) => a.code === "USDC" && a.peg === "USD");
    const circleEurc = list.find((a) => a.code === "EURC" && a.peg === "EUR");
    const mykobo = calculatorExtraPairs().flat().find((a) => a.display === "EURC (Mykobo)");
    expect(usdc && circleEurc && mykobo).toBeTruthy();
    expect(usdUnit("mainnet", { code: "XLM", issuer: null }, pricing)).toBe(0.25);
    expect(usdUnit("mainnet", usdc!, pricing)).toBe(1);
    expect(usdUnit("mainnet", circleEurc!, pricing)).toBeNull();
    expect(usdUnit("mainnet", mykobo!, pricing)).toBeNull();
    expect(usdUnit("testnet", { code: "XLM", issuer: null }, pricing)).toBeNull();
    const xlmPool = quote({
      usdPerUnit: 0.25,
      assetUsd: { a: usdUnit("mainnet", { code: "XLM", issuer: null }, pricing), b: usdUnit("mainnet", circleEurc!, pricing) },
    });
    expect(xlmPool.fees!.monthlyUsd).toBeCloseTo(90 * 0.25);
    const usdcPool = quote({
      driver: "B", deposit: 500, unitIsA: false, unitCode: "USDC", usdPerUnit: 1,
      assetUsd: { a: usdUnit("mainnet", mykobo!, pricing), b: usdUnit("mainnet", usdc!, pricing) },
    });
    expect(usdcPool.fees!.monthlyUsd).toBeCloseTo(90);
    expect(usdcPool.fees!.monthlyUsdVia).toBe("unit");
  });

  it("is unavailable when neither leg has a USD price", () => {
    expect(monthlyFeeUsd(90, true, 1000, 500, null, null)).toBeNull();
    const q = quote({ usdPerUnit: null, assetUsd: { a: null, b: null } });
    expect(q.window).toBe("complete");
    expect(q.fees!.monthly).toBeCloseTo(90);
    expect(q.fees!.monthlyUsd).toBeNull();
    expect(q.fees!.monthlyUsdVia).toBeNull();
  });

  it("withholds the USD figure when the 24h window is truncated, failed, stale, or missing", () => {
    expect(quote({ ...priced, walk: walk({ truncated: true, reachedCutoff: false, volumeInUnit: 1_000_000 }) }).fees).toBeNull();
    expect(quote({ ...priced, walk: walk({ ok: false, volumeInUnit: 0, tradesInWindow: 0, reachedCutoff: false }) }).fees).toBeNull();
    expect(quote({ ...priced, walk: walk({ fetchedAtMs: NOW - WINDOW_MAX_AGE_MS - 1 }), nowMs: NOW }).fees).toBeNull();
    expect(quote({ ...priced, walk: null }).fees).toBeNull();
  });

  it("is $0 for a complete window with no swaps", () => {
    expect(monthlyFeeUsd(0, true, 1000, 500, 0.25, null)).toEqual({ usd: 0, via: "unit" });
    expect(monthlyFeeUsd(0, true, 1000, 500, null, null)).toEqual({ usd: 0, via: null });
    const q = quote({ ...priced, walk: walk({ volumeInUnit: 0, tradesInWindow: 0 }) });
    expect(q.fees!.zeroVolume).toBe(true);
    expect(q.fees!.daily).toBe(0);
    expect(q.fees!.monthly).toBe(0);
    expect(q.fees!.monthlyUsd).toBe(0);
  });

  it("does not subtract the Quasaria deposit cost or add a holder reward", () => {
    const plain = quote(priced);
    const charged = quote({ ...priced, platform: { enabled: true, bps: 10 } });
    expect(charged.platform.deposit.map((l) => l.amount)).toEqual([feeAmount(1000, 10), feeAmount(500, 10)]);
    expect(charged.fees!.monthlyUsd).toBeCloseTo(plain.fees!.monthlyUsd!);
    expect(charged.fees!.monthlyUsd).toBeCloseTo(charged.fees!.monthly * 0.25);
  });
});

describe("monthly USD on each calculator placement", () => {
  const earn = quote({ usdPerUnit: 0.25, assetUsd: { a: 0.25, b: null } });
  const page = (node: ReactNode) => renderToStaticMarkup(<MemoryRouter><WalletProvider>{node}</WalletProvider></MemoryRouter>);

  it("shows the estimate on the full /calculators placement", () => {
    const shell = page(<Calculators />);
    expect(shell).toContain('data-testid="calc-lp"');
    expect(shell).toContain('data-testid="lp-pool-id"');
    expect(shell).not.toContain("calc compact");
    const html = body(earn, "full");
    expect(html).toContain('data-testid="lp-monthly-usd"');
    expect(html).toContain("≈ $22.50");
    expect(html).toContain("Estimate based on the last 24h of trading fees, scaled to 30 days.");
    expect(html).toContain("Not guaranteed.");
    expect(html).toContain("It varies with volume and price.");
    expect(html).toContain("No liquidity-provider incentive");
    expect(html).toContain('data-testid="lp-platform"');
    expect(html).not.toContain("USD estimate unavailable");
  });

  it("shows the estimate on the compact Landing placement", () => {
    const shell = page(<Landing />);
    expect(shell).toContain('data-testid="calc-lp"');
    expect(shell).toContain("calc compact");
    expect(shell).not.toContain('data-testid="lp-pool-id"');
    const html = body(earn, "compact");
    expect(html).toContain("calc compact");
    expect(html).toContain('data-testid="lp-monthly-usd"');
    expect(html).toContain("≈ $22.50");
    expect(html).toContain("Estimate based on the last 24h of trading fees");
  });

  it("shows the estimate on the compact Pools placement", () => {
    const shell = page(<Pools />);
    expect(shell).toContain('data-testid="calc-lp"');
    expect(shell).toContain("calc compact");
    expect(shell).toContain("Verified pairs");
    expect(shell).not.toContain('data-testid="lp-pool-id"');
    const html = body(earn, "compact");
    expect(html).toContain('data-testid="lp-monthly-usd"');
    expect(html).toContain("≈ $22.50");
    expect(html).toContain("lp-monthly");
  });

  it("says the estimate is unavailable when neither leg has a USD price, and labels a pool-ratio price", () => {
    const missing = body(quote({ usdPerUnit: null, assetUsd: { a: null, b: null } }));
    expect(missing).toContain("USD estimate unavailable");
    expect(missing).toContain("Neither asset has a direct USD price");
    expect(missing).not.toContain("≈ $");
    const crossed = body(quote({ usdPerUnit: null, unitCode: "USTRY", assetUsd: { a: null, b: 1 } }));
    expect(crossed).toContain("≈ $45.00");
    expect(crossed).toContain("valued with this pool&#x27;s reserve ratio");
    expect(crossed).toContain("USD unavailable");
  });

  it("shows $0.00 for a complete window with no swaps and hides the figure when the window is incomplete", () => {
    const zero = body(quote({ ...{ usdPerUnit: 0.25, assetUsd: { a: 0.25, b: null } }, walk: walk({ volumeInUnit: 0, tradesInWindow: 0 }) }));
    expect(zero).toContain("$0.00");
    expect(zero).toContain("lp-zero");
    expect(zero).not.toContain("USD estimate unavailable");
    const stale = body(quote({ usdPerUnit: 0.25, assetUsd: { a: 0.25, b: null }, walk: walk({ fetchedAtMs: NOW - WINDOW_MAX_AGE_MS - 1 }), nowMs: NOW }));
    expect(stale).not.toContain('data-testid="lp-monthly-usd"');
    expect(stale).toContain("monthly USD estimate");
  });
});
