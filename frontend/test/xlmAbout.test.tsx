import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import XlmAbout from "../src/components/XlmAbout";
import XlmRow from "../src/components/XlmRow";
import { parseLedgers, parseSupply } from "../src/lib/xlmAbout";
import { XLM_ABOUT_PATH } from "../src/lib/xlm";

const rec = (seq: number, at: string) => ({ sequence: seq, closed_at: at, protocol_version: 29, base_fee_in_stroops: 100, base_reserve_in_stroops: 5000000, fee_pool: "10879772.8813922" });
const LEDGERS = [rec(6, "2026-10-19T02:55:58Z"), rec(5, "2026-10-19T02:55:53Z"), rec(4, "2026-10-19T02:55:48Z"), rec(3, "2026-10-19T02:55:43Z"), rec(2, "2026-10-19T02:55:38Z"), rec(1, "2026-10-19T02:55:33Z")];
const text = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("XLM About: data parsing (nothing assumed)", () => {
  it("reads reserve, fee and the measured average close time from Horizon records", () => {
    const f = parseLedgers(LEDGERS)!;
    expect(f).toMatchObject({ sequence: 6, protocol: 29, baseFeeStroops: 100, baseReserveXlm: 0.5, avgCloseSeconds: 5 });
  });
  it("returns nulls, not guesses, when fields are missing", () => {
    expect(parseLedgers([])).toBeNull();
    const f = parseLedgers([{ sequence: 9, closed_at: "2026-10-19T00:00:00Z" }])!;
    expect(f.baseReserveXlm).toBeNull();
    expect(f.baseFeeStroops).toBeNull();
    expect(f.avgCloseSeconds).toBeNull();
  });
  it("supply snapshot parses; garbage gives null", () => {
    expect(parseSupply({ savedAt: "2026-10-19T02:54:31.553Z", totalSupply: "50001786837.39", circulatingSupply: "35201670132.65", originalSupply: "100000000000", source: "x" })).toMatchObject({ totalSupply: 50001786837.39, circulatingSupply: 35201670132.65 });
    expect(parseSupply(null)).toBeNull();
    expect(parseSupply({ savedAt: "x", totalSupply: "abc" })!.totalSupply).toBeNull();
  });
  it("the saved supply file in public/data is well-formed", () => {
    const j = JSON.parse(readFileSync(new URL("../public/data/xlm-supply.json", import.meta.url), "utf8"));
    const s = parseSupply(j)!;
    expect(s.totalSupply).toBeGreaterThan(4e10);
    expect(s.circulatingSupply!).toBeLessThan(s.totalSupply!);
    expect(j.source).toBe("https://dashboard.stellar.org/api/v3/lumens");
  });
});

describe("XLM About panel", () => {
  const supply = parseSupply({ savedAt: "2026-10-19T02:54:31.553Z", totalSupply: "50001786837.39", circulatingSupply: "35201670132.65", originalSupply: "100000000000", source: "s" });
  const h = renderToStaticMarkup(<XlmAbout ledger={parseLedgers(LEDGERS)} supply={supply} />);
  const t = text(h);
  it("uses the shared About panel markup and explains XLM and the network", () => {
    expect(h).toContain('class="about-panel"');
    expect(h).toContain("about-facts");
    expect(t).toMatch(/native asset of the Stellar network/);
    expect(t).toMatch(/no issuer and no trustline/);
    expect(t).toMatch(/pays every transaction fee/);
    expect(t).toMatch(/open-source, public ledger/);
    expect(t).toMatch(/launched in 2014/);
    expect(t).toMatch(/about every 5 seconds/);
    expect(t).toMatch(/Stellar Development Foundation \(SDF\)/);
  });
  it("shows the live facts, StellarChain links only, n/a for trustlines", () => {
    expect(t).toMatch(/Base reserve 0\.5 XLM/);
    expect(t).toMatch(/1 XLM \(2 base reserves\)/);
    expect(t).toMatch(/100 stroops/);
    expect(t).toMatch(/5 s/);
    expect(t).toMatch(/Trustlines n\/a/);
    expect(h).toContain('href="https://stellarchain.io/assets/XLM"');
    expect(h).toContain('href="https://stellarchain.io/ledgers/6"');
    expect(h).not.toMatch(/stellar\.expert|stellarscan|lumenscan/);
    expect(h).toContain('rel="noopener noreferrer"');
    expect(t).toMatch(/Total supply 50\.00B XLM/);
    expect(t).toMatch(/Circulating supply 35\.20B XLM/);
  });
  it("shows dashes when Horizon and the supply copy are unavailable, and never invites investment", () => {
    const e = renderToStaticMarkup(<XlmAbout ledger={null} supply={null} />);
    const et = text(e);
    expect(et).toMatch(/Base reserve —/);
    expect(et).toMatch(/Base fee —/);
    expect(et).toMatch(/Total supply —/);
    expect(et).toMatch(/Circulating supply —/);
    for (const x of [t, et]) expect(x).not.toMatch(/invest(ment)? (opportunity|advice only)|guarantee|will (rise|go up|moon)|price target|to the moon|APY|buy now/i);
    expect(t).toMatch(/not financial advice/);
    expect(t).toMatch(/not affiliated with, sponsored or endorsed by the Stellar Development Foundation/);
  });
});

describe("where the XLM About is reachable", () => {
  it("the pinned Markets row has an About button that opens the panel row", () => {
    const closed = renderToStaticMarkup(<table><tbody><XlmRow usdPerXlm={0.18} live onExchange={() => undefined} onAbout={() => undefined} /></tbody></table>);
    expect(closed).toContain('data-testid="xlm-about-btn"');
    expect(closed).not.toContain('data-testid="xlm-about-row"');
    const open = renderToStaticMarkup(<table><tbody><XlmRow usdPerXlm={0.18} live onExchange={() => undefined} aboutOpen onAbout={() => undefined} /></tbody></table>);
    expect(open).toContain('data-testid="xlm-about-row"');
    expect(open).toContain('id="about-xlm"');
  });
  it("Markets deep-links ?about=xlm and the Exchange pair header links to it when XLM is in the pair", () => {
    expect(XLM_ABOUT_PATH).toBe("/markets?about=xlm");
    const markets = readFileSync(new URL("../src/pages/Markets.tsx", import.meta.url), "utf8");
    expect(markets).toMatch(/params\.get\("about"\)\?\.toLowerCase\(\) === "xlm" \? "XLM"/);
    const trade = readFileSync(new URL("../src/pages/Trade.tsx", import.meta.url), "utf8");
    expect(trade).toMatch(/baseOpt\?\.key === "XLM" \|\| quoteOpt\?\.key === "XLM"/);
    expect(trade).toContain("to={XLM_ABOUT_PATH}");
  });
});
