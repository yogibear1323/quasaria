import { describe, expect, it } from "vitest";
import { depositProblem, toStroops, VAULT_ID } from "../src/components/YieldVaultCard";

describe("yield vault deposits", () => {
  it("uses the mainnet vault id", () => expect(VAULT_ID).toBe("CCMF3HPVSUYQHHW2LKORUIS3D4YOPVEQZ4YZGQJGWRAJADVONBOD7U3D"));
  it("parses stroops", () => { expect(toStroops("1.5")).toBe(15_000_000n); expect(toStroops("1.12345678")).toBeNull(); });
  it("has no deposit cap", () => {
    expect(depositProblem("25")).toBeNull();
    expect(depositProblem("100000")).toBeNull();
    expect(depositProblem("0")).toMatch(/above 0/);
    expect(depositProblem("abc")).toMatch(/Invalid/);
  });
});
