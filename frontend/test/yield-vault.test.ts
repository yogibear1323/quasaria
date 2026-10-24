import { describe, expect, it } from "vitest";
import { depositProblem, toStroops, VAULT_DEPOSIT_CAP_XLM, VAULT_ID } from "../src/components/YieldVaultCard";

describe("yield vault deposit cap", () => {
  it("uses the mainnet vault id", () => expect(VAULT_ID).toBe("CCMF3HPVSUYQHHW2LKORUIS3D4YOPVEQZ4YZGQJGWRAJADVONBOD7U3D"));
  it("parses stroops", () => { expect(toStroops("1.5")).toBe(15_000_000n); expect(toStroops("1.12345678")).toBeNull(); });
  it("caps at 25 XLM", () => {
    expect(VAULT_DEPOSIT_CAP_XLM).toBe(25);
    expect(depositProblem("25")).toBeNull();
    expect(depositProblem("25.0000001")).toMatch(/Max 25/);
    expect(depositProblem("0")).toMatch(/above 0/);
    expect(depositProblem("abc")).toMatch(/Invalid/);
  });
});
