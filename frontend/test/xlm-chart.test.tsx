import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import {
  TIMEFRAMES, aggregateBars, applyTick, change, fetchBars, fetchOpen24h, fetchTick, freshness, loadBars, mergeHistory, open24hFromBars,
  parseCoinbase, parseKraken, readOverlay, saveBars, tfInfo, type Bar,
} from "../src/lib/xlmChart";
import { PERPS_MENU, isPerpsPath } from "../src/components/PerpsNav";
import XlmChartPage from "../src/pages/XlmChart";
import { localTick, overlayPoints, XLM_CHART_LABEL } from "../src/components/XlmChart";

const src = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const bar = (t: number, o: number, h: number, l: number, c: number, v = 1): Bar => ({ t, o, h, l, c, v });
type Route = Record<string, unknown | ((u: string) => unknown)>;
/** Fake fetch: first matching url fragment wins; values that are Errors → HTTP 500. */
function fakeFetch(routes: Route): typeof fetch {
  return (async (u: string) => {
    const k = Object.keys(routes).find((x) => String(u).includes(x));
    const v = k === undefined ? new Error("no route") : routes[k];
    if (v instanceof Error) return { ok: false, status: 500, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => v };
  }) as unknown as typeof fetch;
}

describe("route + nav", () => {
  it("adds 'Live XLM chart' between Perps and Back Office, pointing at /perps/chart", () => {
    expect(PERPS_MENU.map((m) => m.label)).toEqual(["Perps", "Live XLM chart", "Back Office · robot floor"]);
    expect(PERPS_MENU[1].to).toBe("/perps/chart");
    expect(isPerpsPath("/perps/chart")).toBe(true);
    // exact matching so "Perps" is not highlighted on /perps/chart
    expect(src("src/components/PerpsNav.tsx")).toMatch(/to=\{m\.to\} end role="menuitem"/);
  });
  it("registers /perps/chart as a lazy route", () => {
    const app = src("src/App.tsx");
    expect(app).toMatch(/lazy\(\(\) => import\("\.\/pages\/XlmChart"\)\)/);
    expect(app).toMatch(/path="\/perps\/chart"/);
    expect(app).not.toMatch(/^import XlmChart/m);
  });
  it("deep link works on Pages: /perps/chart is served by the 404.html SPA copy, no perps/ folder collides", () => {
    const vite = src("vite.config.ts");
    expect(vite).toMatch(/"404", \.\.\.SPA_ROUTES/);
    expect(vite).toMatch(/"perps"/);
    expect(existsSync(new URL("../public/perps", import.meta.url))).toBe(false);
  });
  it("Perps page embeds the compact chart lazily and links to the full chart", () => {
    const perps = src("src/pages/Perps.tsx");
    expect(perps).toMatch(/lazy\(\(\) => import\("\.\.\/components\/XlmChart"\)\)/);
    expect(perps).toMatch(/to="\/perps\/chart"/);
  });
});

describe("chart page", () => {
  const html = renderToStaticMarkup(
    <MemoryRouter initialEntries={["/perps/chart"]}>
      <XlmChartPage />
    </MemoryRouter>,
  );
  it("renders header, timeframes, labels, CTAs and attribution", () => {
    expect(html).toContain("XLM-PERP");
    for (const t of ["1m", "5m", "15m", "1h", "4h", "1D"]) expect(html).toContain(`>${t}</button>`);
    expect(html).toContain(XLM_CHART_LABEL);
    expect(XLM_CHART_LABEL).toBe("Testnet perps · prices from mainnet market data · not financial advice");
    expect(html).toMatch(/href="\/perps"[^>]*>Trade on Perps/);
    expect(html).toContain('href="/back-office?view=demo"');
    expect(html).toContain("https://www.tradingview.com/");
    expect(html).toContain("Lightweight Charts™");
    expect(html).not.toMatch(/b[a]nk/i); // forbidden copy word
  });
  it("styles avoid gradient text", () => {
    expect(src("src/theme/xlm-chart.css")).not.toMatch(/background-clip/);
  });
});

describe("candles", () => {
  it("parses Coinbase (newest first, [t,l,h,o,c,v]) and Kraken ([t,o,h,l,c,vwap,v,n])", () => {
    expect(parseCoinbase([[120, 1, 3, 2, 2.5, 10], [60, 0.9, 2.1, 1, 2, 5]])).toEqual([bar(60, 1, 2.1, 0.9, 2, 5), bar(120, 2, 3, 1, 2.5, 10)]);
    expect(parseKraken({ error: [], result: { XXLMZUSD: [[60, "1", "2", "0.5", "1.5", "1.2", "7", 3]], last: 60 } })).toEqual([bar(60, 1, 2, 0.5, 1.5, 7)]);
    expect(() => parseKraken({ error: ["EQuery"] })).toThrow();
  });
  it("aggregates 1h → 4h on UTC-aligned buckets", () => {
    const h = 3600;
    const src1h = [bar(3 * h, 1, 2, 0.5, 1.5, 1), bar(4 * h, 1.5, 3, 1.4, 2, 2), bar(5 * h, 2, 2.2, 1, 1.1, 3), bar(8 * h, 1.1, 1.2, 1, 1.2, 4)];
    expect(aggregateBars(src1h, h, 4)).toEqual([bar(0, 1, 2, 0.5, 1.5, 1), bar(4 * h, 1.5, 3, 1, 1.1, 5), bar(8 * h, 1.1, 1.2, 1, 1.2, 4)]);
    expect(aggregateBars(src1h, h, 1)).toEqual(src1h);
    expect(tfInfo("4h")).toMatchObject({ sec: 14400, cb: 3600, cbAgg: 4, kraken: 240 });
    expect(TIMEFRAMES.map((t) => t.tf)).toEqual(["1m", "5m", "15m", "1h", "4h", "1D"]);
  });
  it("live tick updates the last candle, opens a new one at the previous close, ignores late ticks", () => {
    const b = [bar(0, 1, 1.2, 0.9, 1.1, 5), bar(60, 1.1, 1.3, 1.0, 1.2, 4)];
    const same = applyTick(b, 1.5, 90, 60);
    expect(same[1]).toEqual(bar(60, 1.1, 1.5, 1.0, 1.5, 4));
    expect(b[1].c).toBe(1.2); // not mutated
    expect(applyTick(b, 0.8, 100, 60)[1]).toMatchObject({ l: 0.8, c: 0.8, h: 1.3 });
    const next = applyTick(b, 1.25, 121, 60);
    expect(next).toHaveLength(3);
    expect(next[2]).toEqual(bar(120, 1.2, 1.25, 1.2, 1.25, 0));
    expect(applyTick(b, 2, 30, 60)).toBe(b);
    expect(applyTick(b, NaN, 90, 60)).toBe(b);
    expect(applyTick([], 1, 61, 60)).toEqual([bar(60, 1, 1, 1, 1, 0)]);
  });
  it("history refresh keeps a newer live candle", () => {
    const fresh = [bar(0, 1, 1, 1, 1), bar(60, 1, 1, 1, 1)];
    expect(mergeHistory(fresh, [...fresh, bar(120, 1, 2, 1, 2, 0)])).toHaveLength(3);
    expect(mergeHistory(fresh, [bar(60, 9, 9, 9, 9)])).toBe(fresh);
  });
  it("overlay samples snap to candle buckets (last sample per bucket wins)", () => {
    const s = [{ at: 61, oracle: 1, mark: null }, { at: 100, oracle: 2, mark: 2.1 }, { at: 130, oracle: 3, mark: null }];
    expect(overlayPoints(s, "oracle", 60)).toEqual([{ time: 60, value: 2 }, { time: 120, value: 3 }]);
    expect(overlayPoints(s, "mark", 60)).toEqual([{ time: 60, value: 2.1 }]);
  });
});

describe("time labels", () => {
  it("axis ticks use local time like the tooltip", () => {
    const t = Date.UTC(2026, 9, 4, 21, 30) / 1000;
    const d = new Date(t * 1000);
    expect(localTick(t, 0)).toBe(String(d.getFullYear()));
    expect(localTick(t, 2)).toBe(String(d.getDate()));
    expect(localTick(t, 3)).toMatch(new RegExp(String(d.getMinutes()).padStart(2, "0")));
  });
});

describe("feeds + fallback", () => {
  const cb = [[120, 1, 3, 2, 2.5, 10]];
  const kr = { error: [], result: { XXLMZUSD: [[60, "1", "2", "0.5", "1.5", "1.2", "7", 3]], last: 60 } };
  it("candles: Coinbase first, Kraken when Coinbase fails, error when both fail", async () => {
    expect((await fetchBars("15m", fakeFetch({ "coinbase.com/products/XLM-USD/candles?granularity=900": cb }))).source).toBe("Coinbase");
    const k = await fetchBars("4h", fakeFetch({ coinbase: new Error(), "OHLC?pair=XLMUSD&interval=240": kr }));
    expect(k).toEqual({ bars: [bar(60, 1, 2, 0.5, 1.5, 7)], source: "Kraken" });
    await expect(fetchBars("1m", fakeFetch({ coinbase: new Error(), kraken: new Error() }))).rejects.toThrow();
  });
  it("4h from Coinbase aggregates 1h candles", async () => {
    const T = 14400 * 10;
    const rows = [[T + 7200, 1, 2, 1.5, 1.6, 1], [T + 3600, 1, 2, 1.2, 1.5, 1], [T, 1, 2, 1.1, 1.2, 1]];
    const r = await fetchBars("4h", fakeFetch({ "granularity=3600": rows }));
    expect(r.bars).toEqual([bar(T, 1.1, 2, 1, 1.6, 3)]);
  });
  it("ticker: Coinbase (exchange time), else Kraken, else throws", async () => {
    const t = await fetchTick(fakeFetch({ "XLM-USD/ticker": { price: "0.2201", time: "2026-10-04T21:00:00Z" } }), () => 2e9);
    expect(t).toEqual({ price: 0.2201, source: "Coinbase", at: 2e9, tradeAt: Date.parse("2026-10-04T21:00:00Z") / 1000 });
    expect(await fetchTick(fakeFetch({ coinbase: new Error(), "Ticker?pair=XLMUSD": { result: { XXLMZUSD: { c: ["0.21"] } } } }), () => 5)).toEqual({ price: 0.21, source: "Kraken", at: 5, tradeAt: null });
    await expect(fetchTick(fakeFetch({ coinbase: { price: "0" }, kraken: new Error() }))).rejects.toThrow();
  });
  it("24h change: Coinbase stats open, Kraken hourly fallback, null when unknown", async () => {
    expect(await fetchOpen24h(fakeFetch({ "XLM-USD/stats": { open: "0.2" } }))).toBe(0.2);
    const now = 100 * 3600;
    const hourly = { result: { X: Array.from({ length: 30 }, (_, i) => [(71 + i) * 3600, String(1 + i), "9", "0", "1", "1", "1", 1]) } };
    expect(await fetchOpen24h(fakeFetch({ coinbase: new Error(), "interval=60": hourly }), now)).toBe(6);
    expect(await fetchOpen24h(fakeFetch({ coinbase: new Error(), kraken: new Error() }))).toBeNull();
    expect(open24hFromBars([bar(0, 1, 1, 1, 1)], 10 * 86400)).toBeNull();
    expect(change(0.22, 0.2)).toBeCloseTo(0.1, 9);
    expect(change(null, 0.2)).toBeNull();
  });
  it("freshness flags stale / missing feeds", () => {
    expect(freshness(100, 110)).toEqual({ age: 10, stale: false });
    expect(freshness(100, 200)).toEqual({ age: 100, stale: true });
    expect(freshness(null, 200).stale).toBe(true);
  });
  it("keeps the last good candles for an outage", () => {
    saveBars("1h", { bars: [bar(0, 1, 1, 1, 1)], source: "Kraken", at: 5 });
    expect(loadBars("1h")).toMatchObject({ source: "Kraken", at: 5 });
  });
  it("reads oracle + mark from the vault; tolerates a missing mark/funding", async () => {
    const calls: string[] = [];
    const read = async <T,>(c: string, m: string): Promise<T> => {
      calls.push(m);
      const r: Record<string, unknown> = { oracle: "CORACLE", config: { max_price_age: 600n }, decimals: 14, lastprice: { price: 22_010_000_000_000n, timestamp: 1_000n }, mark_price: 22_020_000_000_000n };
      if (!(m in r)) throw new Error("non-existent contract function");
      return r[m] as T;
    };
    const o = await readOverlay(read, "CVAULT", 1_060);
    expect(o).toMatchObject({ oracle: 0.2201, oracleTs: 1000, mark: 0.2202, fundingHourly: null, maxAge: 600, at: 1060 });
    expect(calls).toContain("mark_price");
  });
});
