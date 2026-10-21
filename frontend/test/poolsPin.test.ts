import { describe, expect, it } from "vitest";
import { parseNewSel, pinFirst, pinnedPair } from "../src/pages/Pools";
describe("Pools GLACIERQ/XLM pin", () => {
  it("builds the mainnet pair and a new-pair selection the panel can read", () => {
    const p = pinnedPair("mainnet")!;
    expect(p.id.startsWith("622916")).toBe(true);
    expect(parseNewSel(p.newSel)).toEqual({ a: p.a, b: p.b });
  });
  it("moves the real pool first without duplicating it", () => {
    const r = pinFirst([{ id: "x" }, { id: "y" }, { id: "p" }], "p");
    expect(r.found).toBe(true);
    expect(r.rows.map((x) => x.id)).toEqual(["p", "x", "y"]);
    expect(pinFirst([{ id: "x" }], "p").found).toBe(false);
  });
});
