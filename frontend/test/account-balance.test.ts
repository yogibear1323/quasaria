import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parseAccount, XLM_FEE_BUFFER, loadAccountView } from "../src/lib/account";

const ISS = "GDC4U6RG7XF5CQBZTR2JVV57QFP65PJGNLYNCNN73AIMEZUK5EWMWL5T";
describe("account balances from one Horizon account record", () => {
  it("XLM available = balance - (2+sub+sponsoring-sponsored)*0.5 - selling - fee buffer; tokens available = balance - selling", () => {
    const v = parseAccount({ subentry_count: 2, num_sponsoring: 1, num_sponsored: 1, balances: [
      { asset_type: "credit_alphanum12", asset_code: "GLACIERQ", asset_issuer: ISS, balance: "5000000.0000000", selling_liabilities: "1000000.0000000" },
      { asset_type: "liquidity_pool_shares", liquidity_pool_id: "ab".repeat(32), balance: "12.5" },
      { asset_type: "native", balance: "30.0000000", selling_liabilities: "1.0000000" },
    ] }, "mainnet", 0.5);
    if (!v.exists) throw new Error("expected account");
    expect(v.native.reserve).toBe(2);
    expect(v.native.available).toBeCloseTo(30 - 2 - 1 - XLM_FEE_BUFFER, 7);
    expect(v.holdings[0]).toMatchObject({ code: "GLACIERQ", balance: 5_000_000, available: 4_000_000, isReward: true });
    expect(v.poolShares).toEqual([{ poolId: "ab".repeat(32), shares: 12.5 }]);
  });
  it("a 404 (unfunded) then funded account flips on the next fetch", async () => {
    let funded = false;
    const f = (async (u: string) => {
      if (u.includes("/ledgers")) return { ok: true, status: 200, json: async () => ({ _embedded: { records: [{ base_reserve_in_stroops: 5000000 }] } }) };
      return funded ? { ok: true, status: 200, json: async () => ({ balances: [{ asset_type: "native", balance: "30.0000000" }], subentry_count: 0 }) } : { ok: false, status: 404, json: async () => ({}) };
    }) as unknown as typeof fetch;
    expect((await loadAccountView("mainnet", "G", f)).view.exists).toBe(false);
    funded = true;
    const v = (await loadAccountView("mainnet", "G", f)).view;
    expect(v.exists && v.native.balance).toBe(30);
  });
  it("the account hook re-fetches on a timer and on focus / tab return", () => {
    const src = readFileSync(new URL("../src/lib/useAccount.ts", import.meta.url), "utf8");
    expect(src).toMatch(/setInterval\(tick, refreshMs\)/);
    expect(src).toMatch(/addEventListener\("focus"/);
    expect(src).toMatch(/addEventListener\("visibilitychange"/);
    expect(src).toMatch(/ACCOUNT_REFRESH_MS = 10_000/);
  });
});
