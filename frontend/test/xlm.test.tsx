import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import XlmRow from "../src/components/XlmRow";
import XlmMark from "../src/components/XlmMark";
import { XLM_LOGO, xlmMatches, xlmRowData } from "../src/lib/xlm";
import { ASSET_LIST } from "../src/lib/assets";
import { readFileSync } from "node:fs";

const render = (p: Parameters<typeof XlmRow>[0]) => renderToStaticMarkup(<table><tbody><XlmRow {...p} /></tbody></table>);
const text = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("XLM as a listed asset", () => {
  it("search matches by code, name or native; empty shows it; an unrelated query hides it", () => {
    for (const q of ["", "xlm", "XL", "lumens", "stellar lum", "native"]) expect(xlmMatches(q), q).toBe(true);
    for (const q of ["usdc", "GA5Z", "xlmx"]) expect(xlmMatches(q), q).toBe(false);
  });
  it("row data: live feed gives price and 24h; snapshot gives price only; nothing gives dashes (never invented)", () => {
    expect(xlmRowData({ usdPerXlm: 0.1784, change24h: -1.2, live: true })).toEqual({ priceUsd: 0.1784, change24h: -1.2, source: "live" });
    expect(xlmRowData({ usdPerXlm: 0.1784, change24h: -1.2, live: false })).toEqual({ priceUsd: 0.1784, change24h: null, source: "snapshot" });
    expect(xlmRowData({ usdPerXlm: null, change24h: 3, live: true })).toEqual({ priceUsd: null, change24h: null, source: "none" });
    expect(xlmRowData({ usdPerXlm: 0, live: true }).priceUsd).toBeNull();
    expect(xlmRowData({ usdPerXlm: NaN, live: true }).priceUsd).toBeNull();
  });
  it("renders the native row: XLM icon and name, no issuer, USD price and 24h from the feed, dashes elsewhere", () => {
    const h = render({ usdPerXlm: 0.1784, change24h: 2.5, live: true, onExchange: () => undefined });
    expect(h).toContain('data-testid="xlm-row"');
    expect(h).toContain(XLM_LOGO);
    expect(text(h)).toMatch(/XLM Stellar Lumens · native, no issuer/);
    expect(text(h)).toContain("$0.1784");
    expect(text(h)).toContain("+2.50%");
    expect(h).not.toMatch(/G[A-Z2-7]{55}/);
    // 1h, 7d, volume, trades, trustlines, trend are dashes: 6 dashes + rank = 7
    expect((h.match(/>—</g) ?? []).length).toBeGreaterThanOrEqual(7);
  });
  it("shows dashes (not numbers) when the feed has no price", () => {
    const h = render({ usdPerXlm: null, live: false, onExchange: () => undefined });
    expect(h).not.toContain("$");
    expect(h).toContain('data-testid="xlm-usd"><span class="muted">—</span>');
    expect(h).toContain('data-testid="xlm-24h"><span class="muted">—</span>');
  });
  it("is in the verified-asset list as native XLM with the icon (feeds the Pools and Exchange pickers)", () => {
    const x = ASSET_LIST.find((a) => a.id === "XLM")!;
    expect(x.testnet.kind).toBe("native");
    expect(x.testnet.issuer).toBeNull();
    expect(x.logo).toBe(XLM_LOGO);
  });
  it("the Exchange pickers offer XLM first, with the icon", () => {
    const src = readFileSync(new URL("../src/pages/Trade.tsx", import.meta.url), "utf8");
    expect(src).toMatch(/const XLM_OPT: PickerOption = \{ key: "XLM", code: "XLM", sub: "Stellar Lumens \(native\)", logo: XLM_LOGO \}/);
    expect(src).toMatch(/const opts = \[XLM_OPT, /);
  });
  it("the XLM icon is the official Stellar symbol from the SDF press kit (two vector paths on a white disc), used only for native XLM", () => {
    const svg = readFileSync(new URL("../public/tokens/xlm.svg", import.meta.url), "utf8");
    expect(svg).toContain('aria-label="Stellar (XLM)"');
    expect((svg.match(/<path /g) ?? []).length).toBe(2); // the symbol only: no wordmark letters
    expect(svg).not.toMatch(/<text|<image|href=/);
    const readme = readFileSync(new URL("../public/tokens/README.md", import.meta.url), "utf8");
    expect(readme).toContain("stellar.org/brand-resources");
    expect(readme).toContain("not affiliated with, sponsored or endorsed by the Stellar Development Foundation");
  });
  it("XLM price pills (header, home hero ticker) show the mark; AssetLogo never swaps in the icon by ticker alone", () => {
    const layout = readFileSync(new URL("../src/components/Layout.tsx", import.meta.url), "utf8");
    const landing = readFileSync(new URL("../src/pages/Landing.tsx", import.meta.url), "utf8");
    expect((layout.match(/<XlmMark/g) ?? []).length).toBe(2);
    expect((landing.match(/<XlmMark/g) ?? []).length).toBe(2);
    const bits = readFileSync(new URL("../src/components/AssetBits.tsx", import.meta.url), "utf8");
    expect(bits).not.toContain("XLM_LOGO");
    const h = renderToStaticMarkup(<XlmMark size={16} />);
    expect(h).toContain(XLM_LOGO);
  });
});
