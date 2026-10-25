import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { RwaHoldings, loadLive, XLM_SAC, EMPTY_TEXT, isRealRwa } from "../src/components/RwaHoldings";

const fake = (und: string) => async (_c: string, m: string) => ({ positions: ["0", "0", "0", "0", "0"], total_assets: "0", underlying: und, total_supply: "0", vault_supplied: "0" } as Record<string, unknown>)[m] as never;

describe("RWA holdings", () => {
  it("XLM SAC is the mainnet native contract", () => expect(XLM_SAC).toBe("CAS3J7GYLGXMF6TDJBBYYSE3HQ6BBSMLNUQ34T6TZMYMW2EVH34XOWMA"));
  it("a wrapper over plain XLM is not a real-world asset", async () => {
    expect(isRealRwa(XLM_SAC)).toBe(false);
    const l = await loadLive(fake(XLM_SAC) as never);
    expect(l.rwas).toHaveLength(0);
    expect(l.pool.supplied).toBe(0);
  });
  it("shows the honest empty state and pool row", async () => {
    const live = await loadLive(fake(XLM_SAC) as never);
    const html = renderToStaticMarkup(<RwaHoldings initial={live} load={async () => live} />);
    expect(html).toContain(EMPTY_TEXT);
    expect(html).toMatch(/data-testid="pool-row"/);
    expect(html).toMatch(/Supplied: 0 XLM/);
    expect(html).not.toMatch(/unaudited/i);
    expect(html).not.toMatch(/stellar\.expert/);
  });
});
