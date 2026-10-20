import { describe, expect, it } from "vitest";
import { assetsUrl, fetchAssetsPage, HORIZON_PAGE, isAccountId } from "../src/lib/horizonAssets";
import { glacierqMatches } from "../src/components/GlacierqRow";

const ISS = "GDC4U6RG7XF5CQBZTR2JVV57QFP65PJGNLYNCNN73AIMEZUK5EWMWL5T";
describe("horizon /assets browser", () => {
  it("builds paged + search URLs", () => {
    expect(assetsUrl("https://h", "")).toBe("https://h/assets?limit=200&order=asc");
    expect(assetsUrl("https://h", "GLACIERQ", "c1")).toContain("asset_code=GLACIERQ");
    expect(assetsUrl("https://h", "GLACIERQ", "c1")).toContain("cursor=c1");
    expect(assetsUrl("https://h", ISS)).toContain(`asset_issuer=${ISS}`);
    expect(assetsUrl("https://h", `GLACIERQ:${ISS}`)).toMatch(/asset_code=GLACIERQ&asset_issuer=/);
    expect(isAccountId(ISS)).toBe(true);
  });
  it("keeps paging while pages are full, stops on a short page", async () => {
    const rec = (i: number) => ({ asset_code: `A${i}`, asset_issuer: ISS, asset_type: "credit_alphanum4", paging_token: `t${i}` });
    const full = { ok: true, json: async () => ({ _embedded: { records: Array.from({ length: HORIZON_PAGE }, (_, i) => rec(i)) } }) };
    const short = { ok: true, json: async () => ({ _embedded: { records: [rec(1)] } }) };
    expect((await fetchAssetsPage("https://h", "", null, (async () => full) as never)).next).toBe(`t${HORIZON_PAGE - 1}`);
    expect((await fetchAssetsPage("https://h", "", "x", (async () => short) as never)).next).toBeNull();
  });
  it("GLACIERQ pinned row matches code, name and issuer searches", () => {
    for (const q of ["", "GLACIERQ", "glac", "Glacier", ISS, ISS.slice(0, 8)]) expect(glacierqMatches(q)).toBe(true);
    expect(glacierqMatches("USDC")).toBe(false);
  });
});
