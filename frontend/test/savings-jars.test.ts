import { describe, expect, it } from "vitest";
import { addDeposit, allocated, jarStats, loadJars, newJar, reconcile, removeShares, saveJars } from "../src/lib/jars";
import { jarAmountProblem } from "../src/components/SavingsJars";
import { depositProblem } from "../src/components/YieldVaultCard";

const X = (n: number) => BigInt(Math.round(n * 1e7));
const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) }; };

describe("savings jars", () => {
  it("jar deposits have no cap; neither does the standalone card", () => {
    expect(jarAmountProblem("1000")).toBeNull();
    expect(jarAmountProblem("0")).toMatch(/above 0/);
    expect(depositProblem("1000")).toBeNull();
  });
  it("persists per wallet", () => {
    const s = mem(); const j = newJar("Ski", X(100));
    saveJars("GA", [j], s); expect(loadJars("GA", s)).toHaveLength(1); expect(loadJars("GB", s)).toHaveLength(0);
  });
  it("values shares at share_price so yield counts", () => {
    const j = addDeposit(newJar("Ski", X(100), undefined, 0), X(50), X(50));
    const st = jarStats(j, X(1.1), 864e5 * 10);
    expect(st.value).toBe(X(55)); expect(st.interest).toBe(X(5)); expect(st.pct).toBe(55);
    expect(st.eta).toMatch(/days/);
    expect(jarStats(j, X(1)).interest).toBe(0n);
  });
  it("withdraw reduces principal pro rata and reconcile caps to the vault balance", () => {
    const j = addDeposit(newJar("A", X(10)), X(10), X(10));
    expect(removeShares(j, X(4)).principal).toBe(X(6).toString());
    expect(() => removeShares(j, X(11))).toThrow();
    const k = addDeposit(newJar("B", X(10)), X(10), X(10));
    expect(allocated(reconcile([j, k], X(10)))).toBe(X(10));
  });
  it("target date gives a per-week amount; reached goal says so", () => {
    const j = newJar("D", X(70), "2026-11-07", Date.parse("2026-10-24"));
    expect(jarStats(j, X(1), Date.parse("2026-10-24")).perWeekNeeded).toBe(X(35));
    expect(jarStats(addDeposit(j, X(70), X(70)), X(1)).eta).toBe("Goal reached");
  });
});
