import { describe, expect, it } from "vitest";
import type { Candle } from "../src/office/indicators.js";
import { computeState, CausalityError, WARMUP } from "../src/office/decision/state.js";
import { gate, validateDecision, type TradeDecision } from "../src/office/decision/schema.js";
import { DEFAULT_HARD, hardCheck, hardLimitsFor, kellyRiskPct } from "../src/office/decision/hardRisk.js";
import { brier, fitPlatt, applyPlatt } from "../src/office/decision/calibrate.js";
import { review } from "../src/office/decision/review.js";
import { newBreakerState } from "../src/office/staleBreaker.js";

const TF = 900;
const bars = (n: number, seed = 1): Candle[] => {
  let x = seed, p = 0.3;
  return Array.from({ length: n }, (_, i) => {
    x = (x * 16807) % 2147483647;
    const r = (x / 2147483647 - 0.5) * 0.01;
    const o = p; p = p * (1 + r);
    return { t: 1_700_000_000 + i * TF, o, h: Math.max(o, p) * 1.001, l: Math.min(o, p) * 0.999, c: p, v: 1000 };
  });
};
const desk = (equity: number, peak = 500, dayStart = 500) => ({ equity, dayStartEquity: dayStart, peakEquity: peak, lossStreak: 0, pausedUntil: 0, entryTimes: [] });
const dec = (o: Partial<TradeDecision> = {}): TradeDecision => ({ t: 1, regime: "trending", direction: "long", setup_quality: 2, risk_state: "safe", confidence: 0.85, raw: 0.9, why: [], ...o });

describe("state engine", () => {
  it("is strictly causal", () => {
    const b = bars(300);
    expect(() => computeState(b, 200, TF, b[200].t + TF - 1, { equity: 1, peakEquity: 1, dayStartEquity: 1, inventory: 0 })).toThrow(CausalityError);
  });
  it("does not change when future bars are appended", () => {
    const b = bars(400);
    const pf = { equity: 1, peakEquity: 1, dayStartEquity: 1, inventory: 0 };
    const a = computeState(b.slice(0, 251), 250, TF, b[250].t + TF, pf);
    const c = computeState(b.slice(), 250, TF, b[250].t + TF, pf);
    expect(c).toEqual(a);
  });
  it("uses L2 book when given", () => {
    const b = bars(300);
    const s = computeState(b, WARMUP + 10, TF, b[WARMUP + 10].t + TF, { equity: 1, peakEquity: 1, dayStartEquity: 1, inventory: 0 }, { ts: b[WARMUP + 10].t + TF, bids: [[0.1, 300]], asks: [[0.1001, 100]] })!;
    expect(s.bookSource).toBe("l2");
    expect(s.imbalance).toBeCloseTo(0.5);
  });
});

describe("gate", () => {
  it("fires only on setup>=2, conf>0.80, safe", () => {
    expect(gate(dec()).fire).toBe(true);
    expect(gate(dec({ confidence: 0.8 })).fire).toBe(false);
    expect(gate(dec({ setup_quality: 1 })).fire).toBe(false);
    expect(gate(dec({ risk_state: "mean_limit" })).fire).toBe(false);
    expect(gate(dec({ regime: "crisis" })).fire).toBe(false);
    expect(validateDecision({ ...dec(), confidence: 1.2 })).toBe(false);
  });
});

describe("hard risk", () => {
  const L = { hardMaxRiskPct: 2, maxNotionalX: 1.5, deskDailyLossPct: 3, deskDrawdownPct: 10 } as never;
  it("takes the stricter of its own and existing limits", () => {
    const h = hardLimitsFor(L, 0.25);
    expect(h.maxDrawdownPct).toBe(10);
    expect(h.riskCapPct).toBe(0.25);
  });
  it("kills at 15% drawdown, kill switch, blocks on stale data and daily loss", () => {
    expect(hardCheck(DEFAULT_HARD, { desk: desk(425), startEquity: 500, open: 0, now: 0, killFlag: false })).toMatchObject({ ok: false, level: "kill" });
    expect(hardCheck(DEFAULT_HARD, { desk: desk(500), startEquity: 500, open: 0, now: 0, killFlag: true })).toMatchObject({ ok: false, level: "kill" });
    expect(hardCheck(DEFAULT_HARD, { desk: desk(484, 500, 500), startEquity: 500, open: 0, now: 0, killFlag: false })).toMatchObject({ ok: false, level: "block" });
    const br = { ...newBreakerState(), tripped: true, level: "trip" as const, reason: "oracle 120 s" };
    expect(hardCheck(DEFAULT_HARD, { desk: desk(500), startEquity: 500, open: 0, now: 0, killFlag: false, breaker: br })).toMatchObject({ ok: false });
    expect(hardCheck({ ...DEFAULT_HARD, usd: { killDrawdown: 5 } }, { desk: desk(95, 100, 100), startEquity: 100, open: 0, now: 0, killFlag: false })).toMatchObject({ level: "kill" });
  });
  it("kelly is capped at quarter-Kelly and the risk cap", () => {
    expect(kellyRiskPct(0.4, 1, 1, 5)).toBe(0);
    expect(kellyRiskPct(0.9, 1.5, 1, 100)).toBeCloseTo(0.25 * (0.9 - 0.1 / 1.5) * 100);
    expect(kellyRiskPct(0.9, 1.5, 0.25, 1)).toBe(1);
  });
});

describe("calibration + review", () => {
  it("brier and platt behave", () => {
    expect(brier([1, 0], [true, false])).toBe(0);
    const x = Array.from({ length: 400 }, (_, i) => i / 400), y = x.map((v, i) => v > 0.5 === (i % 5 !== 0));
    const p = fitPlatt(x, y);
    expect(applyPlatt(p, 0.9)).toBeGreaterThan(applyPlatt(p, 0.1));
  });
  it("review never auto-deploys", () => {
    const r = review([], 100);
    expect(r.autoDeploy).toBe(false);
    expect(r.notes.join(" ")).toMatch(/report only/);
  });
});

import { riskStateFor } from "../src/office/decision/schema.js";
describe("risk state", () => {
  const s = (dd: number) => ({ drawdownPct: dd }) as never;
  it("is derived in code", () => {
    expect(riskStateFor(s(0), 15, false)).toBe("safe");
    expect(riskStateFor(s(0), 15, true)).toBe("mean_limit");
    expect(riskStateFor(s(2), 15, false, 2, 3)).toBe("mean_limit");
    expect(riskStateFor(s(10), 15, false)).toBe("reduce");
  });
});
