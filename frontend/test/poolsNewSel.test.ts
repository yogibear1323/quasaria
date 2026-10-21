import { describe, expect, it } from "vitest";
import { parseNewSel } from "../src/pages/Pools";
import { keyOf, orderAssets, poolIdFor } from "../src/lib/nativePools";
const G = { code: "GLACIERQ", issuer: "GDC4U6RG7XF5CQBZTR2JVV57QFP65PJGNLYNCNN73AIMEZUK5EWMWL5T" };
const X = { code: "XLM", issuer: null };
describe("Pools pair picker selection", () => {
  it("round-trips XLM + GLACIERQ (issuer keys contain ':')", () => {
    const [a, b] = orderAssets(X, G);
    const p = parseNewSel(`new:${poolIdFor(X, G)}:${keyOf(a)}|${keyOf(b)}`);
    expect(p).toEqual({ a, b });
    expect(() => poolIdFor(p.a, p.b)).not.toThrow();
  });
});
