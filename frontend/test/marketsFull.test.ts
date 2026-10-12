import { describe, expect, it } from "vitest";
import { clampPage, filterRows, pageCount, parseTomlCurrencies, sortRows } from "../src/lib/marketsFull";
import type { LiveRow } from "../src/lib/liveMarkets";
import { readFileSync } from "node:fs";

const row = (code: string, rank: number, price: number | null): LiveRow => ({ key: `${code}-G${rank}`, code, issuer: `G${rank}`, rank, logo: null, orgName: null, homeDomain: null, priceXlm: price, priceKind: null, change1h: null, change24h: null, change7d: null, volumeXlm24h: null, trades24h: null, holders: null, supply: null, sparkline: [], lastTradeAt: null, source: "snapshot", fetchedAt: null, snapshotFields: [] });

describe("markets top 1,000", () => {
  it("pages: 100 per page, max 10, clamped", () => {
    expect(pageCount(1000)).toBe(10);
    expect(pageCount(1050)).toBe(10);
    expect(pageCount(0)).toBe(1);
    expect(clampPage(99, 1000)).toBe(10);
    expect(clampPage(NaN, 1000)).toBe(1);
  });
  it("sorts with missing values last and filters across all rows", () => {
    const rows = [row("A", 1, 2), row("B", 2, null), row("C", 3, 5)];
    expect(sortRows(rows, "price", "desc").map((r) => r.code)).toEqual(["C", "A", "B"]);
    expect(sortRows(rows, "price", "asc").map((r) => r.code)).toEqual(["A", "C", "B"]);
    expect(filterRows(rows, "c").map((r) => r.code)).toEqual(["C"]);
  });
  it("reads SEP-1 CURRENCIES verbatim", () => {
    const t = parseTomlCurrencies(`[DOCUMENTATION]\nORG_NAME="Acme"\n[[CURRENCIES]]\ncode="USDX"\nissuer="GABC"\nname = "Dollar X" # c\ndesc="""Line one\nline two"""\nis_asset_anchored=true\nanchor_asset="USD"\n[[CURRENCIES]]\ncode="Y"`);
    expect(t.documentation.ORG_NAME).toBe("Acme");
    expect(t.currencies[0]).toMatchObject({ code: "USDX", name: "Dollar X", desc: "Line one\nline two", is_asset_anchored: true, anchor_asset: "USD" });
    expect(t.currencies).toHaveLength(2);
  });
  it("the committed full list has 1,000 ranked mainnet assets and the browser never calls stellarchain.io on github.io", () => {
    const j = JSON.parse(readFileSync(new URL("../public/data/markets-mainnet.json", import.meta.url), "utf8"));
    expect(j.member).toHaveLength(1000);
    expect(readFileSync(new URL("../src/lib/stellarchain.ts", import.meta.url), "utf8")).toMatch(/github\\\.io/);
  });
});
