import { describe, expect, it } from "vitest";
import { cleanBook } from "../src/lib/stellar";
describe("cleanBook", () => {
  it("keeps the best bid even when a far-away ask sits on the other side (XLM/GLACIERQ mainnet case)", () => {
    const b = cleanBook([{ price: 100000, amount: 9982 }], [{ price: 1000000, amount: 1 }, { price: 10000000, amount: 1 }]);
    expect(b.bids).toHaveLength(1);
    expect(b.asks.map((a) => a.price)).toEqual([1000000]);
  });
  it("still drops junk deep in one side", () => {
    expect(cleanBook([{ price: 1, amount: 1 }, { price: 0.1, amount: 1 }], []).bids).toHaveLength(1);
  });
});
