import { describe, expect, it } from "vitest";
import { breakEvenFees, dailyRev, runSim, steadyApr } from "../src/lib/beaconsSim";

// Expected values from quasaria-beacons/docs/sim/reserve_summary.csv (sim.py).
const base = { tvl: 1_000_000, alloc: 0.4, rate: 0.005, fees: 300, startFees: 300 };
const CASES: [string, (d: number) => number, number, number[]][] = [
  ["ramp", (d) => 1000 + (1000 * d) / 90, 30, [6199, 13492, 0, 49139, 121]],
  ["flat 1500", () => 1500, 30, [4137, 13500, 0, 51234, 0]],
  ["flat 2000", () => 2000, 14, [9589, 21558, 944, 59280, 469]],
  ["flat 3000", () => 3000, 30, [20548, 32900, 22464, 60459, 510]],
  ["flat 3000 14d", () => 3000, 14, [9589, 36912, 29411, 60459, 510]],
];
describe("Beacons simulator matches sim.py", () => {
  for (const [name, fn, rule, exp] of CASES)
    it(name, () => {
      const r = runSim({ ...base, feeFn: fn, ruleDays: rule });
      expect([r.reserveEnd, r.insuranceEnd, r.buybackEnd, r.paid].map(Math.round)).toEqual(exp.slice(0, 4));
      expect(r.epochsAtCap).toBe(exp[4]);
    });
  it("write-up worked examples", () => {
    expect(dailyRev(300, 0.4, 1e6, 0.005)).toBeCloseTo(125.48, 2);
    expect(steadyApr(300, 0.4, 1e6, 0.005) * 100).toBeCloseTo(4.58, 2);
    expect(steadyApr(600, 0.4, 1e6, 0.005) * 100).toBeCloseTo(8.96, 2);
    expect(Math.round(breakEvenFees(0.4, 1e6, 0.005))).toBe(808);
  });
  it("blend loss: insurance first, rest is a staker haircut", () => {
    const r = runSim({ ...base, blendLoss: { day: 45, pct: 0.2 } });
    expect(r.lossInfo!.loss).toBeCloseTo(80_000, 6);
    expect(r.lossInfo!.covered + r.lossInfo!.stakerLoss).toBeCloseTo(80_000, 6);
  });
});
