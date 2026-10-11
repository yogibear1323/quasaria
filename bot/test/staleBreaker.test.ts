import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_STALE_BREAKER, allowOrder, newBreakerState, observe, readHeartbeat, type StaleBreakerCfg, type StaleBreakerState } from "../src/office/staleBreaker.js";
import { runLendingKeeperOnce, type LendingVenue } from "../src/lending/keeper.js";

const C: StaleBreakerCfg = { ...DEFAULT_STALE_BREAKER, heartbeatFile: "/hb" };
const T0 = 1_800_000_000;
/** one read: on-chain oracle age `o` s and heartbeat age `h` s at time `now` */
const read = (s: StaleBreakerState, now: number, o: number | null, h: number | null = o, c = C) =>
  observe(s, { now, oracleTs: o === null ? null : now - o, heartbeatTs: h === null ? null : now - h }, c);

describe("stale-data breaker · thresholds", () => {
  it("fresh below 60 s; blocks entries at >= 60 s (before the vault's 90 s reject); hard trip at >= 90 s", () => {
    let r = read(newBreakerState(), T0, 59);
    expect(r.state.tripped).toBe(false);
    r = read(r.state, T0 + 60, 60);
    expect(r.state.tripped).toBe(true);
    expect(r.state.level).toBe("block");
    expect(r.changed).toBe("tripped");
    expect(allowOrder(r.state, "entry").ok).toBe(false);
    r = read(r.state, T0 + 120, 95);
    expect(r.state.level).toBe("trip");
    expect(r.state.reason).toMatch(/on-chain oracle age 95s/);
  });

  it("trips on EITHER source: a stale feed heartbeat or an unreadable oracle", () => {
    expect(read(newBreakerState(), T0, 5, 75).state.tripped).toBe(true); // chain fresh, feed stopped pushing
    expect(read(newBreakerState(), T0, 5, null).state.reason).toMatch(/heartbeat missing/);
    expect(read(newBreakerState(), T0, null, 5).state.reason).toMatch(/unreadable/);
  });

  it("while tripped: entries and size increases are refused; reduce-only, closes and trigger updates are allowed", () => {
    const s = read(newBreakerState(), T0, 120).state;
    expect(allowOrder(s, "entry")).toEqual({ ok: false, reason: expect.stringMatching(/^STALE DATA · entries halted/) });
    expect(allowOrder(s, "increase").ok).toBe(false);
    for (const k of ["reduce", "close", "trigger"] as const) expect(allowOrder(s, k).ok).toBe(true);
  });
});

describe("stale-data breaker · hysteresis recovery", () => {
  it("auto-clears only after 3 consecutive fresh reads; a stale read in between restarts the count", () => {
    let s = read(newBreakerState(), T0, 100).state;
    s = read(s, T0 + 60, 10).state;
    s = read(s, T0 + 120, 10).state;
    expect(s.tripped).toBe(true);
    expect(s.reason).toMatch(/recovering: 2\/3/);
    s = read(s, T0 + 180, 70).state; // stale again
    expect(s.freshCount).toBe(0);
    s = read(s, T0 + 240, 10).state;
    s = read(s, T0 + 300, 10).state;
    expect(s.tripped).toBe(true);
    const r = read(s, T0 + 360, 10);
    expect(r.state.tripped).toBe(false);
    expect(r.changed).toBe("cleared");
    expect(allowOrder(r.state, "entry").ok).toBe(true);
  });

  it("escalates to the global kill only after the longer window (600 s tripped)", () => {
    let r = read(newBreakerState(), T0, 70);
    for (let t = 60; t < 600; t += 60) (r = read(r.state, T0 + t, 70 + t)), expect(r.escalate).toBe(false);
    r = read(r.state, T0 + 600, 670);
    expect(r.escalate).toBe(true);
  });
});

describe("stale-data breaker · clock jump on resume", () => {
  it("a wall-clock jump (VM suspend/resume) distrusts cached data: trips, needs 3 fresh reads, and the gap does not count toward the kill", () => {
    let s = read(newBreakerState(), T0, 5).state;
    s = read(s, T0 + 60, 5).state;
    expect(s.tripped).toBe(false);
    // box suspended for 2.4 h; the first read after resume happens to look fresh (feed pushed 2 s ago)
    let r = read(s, T0 + 60 + 8_700, 2);
    expect(r.state.tripped).toBe(true);
    expect(r.state.reason).toMatch(/^resume: clock jumped 8700s/);
    expect(r.escalate).toBe(false);
    expect(allowOrder(r.state, "entry").ok).toBe(false);
    r = read(r.state, T0 + 8_820, 3);
    expect(r.state.tripped).toBe(true);
    r = read(r.state, T0 + 8_880, 3);
    expect(r.state.tripped).toBe(false); // 3 fresh reads (resume read + 2)
  });

  it("after a resume with stale data the escalation timer starts at the resume, not at the last pre-suspend read", () => {
    let s = read(newBreakerState(), T0, 5).state;
    let r = read(s, T0 + 10_000, 9_000); // resumed, data very old
    expect(r.state.tripped).toBe(true);
    expect(r.escalate).toBe(false);
    s = r.state;
    r = read(s, T0 + 10_060, 9_060);
    expect(r.escalate).toBe(false);
  });
});

describe("stale-data breaker · heartbeat file", () => {
  it("reads the feed heartbeat (epoch seconds); missing or garbage -> null", () => {
    const dir = mkdtempSync(join(tmpdir(), "hb-"));
    try {
      const f = join(dir, "oracle-feed.heartbeat");
      expect(readHeartbeat(f)).toBeNull();
      writeFileSync(f, "1800000123\n");
      expect(readHeartbeat(f)).toBe(1_800_000_123);
      writeFileSync(f, "nope");
      expect(readHeartbeat(f)).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("lending keeper · price-dependent actions are gated", () => {
  const venue = (): LendingVenue & { liquidate: ReturnType<typeof vi.fn> } => ({
    borrowerCount: async () => 1,
    borrowersPage: async () => ["GBORROWER"],
    account: async () => ({ healthFactor: 9_000_000n, debtUsd: 100n, collateralUsd: 90n }),
    positions: async () => [{ asset: "D", supplied: 0n, borrowed: 100n, collateral: false }, { asset: "C", supplied: 200n, borrowed: 0n, collateral: true }],
    reserves: async () => new Map([["D", { asset: "D", code: "D", price: 1n, decimals: 0, cash: 1000n, collateralEnabled: true }], ["C", { asset: "C", code: "C", price: 1n, decimals: 0, cash: 1000n, collateralEnabled: true }]]),
    closeFactorBps: async () => 5000,
    balances: async () => new Map([["D", 1000n]]),
    liquidate: vi.fn(async () => [50n, 55n] as [bigint, bigint]),
  });
  it("skips a liquidation while the stale-data guard is tripped, executes it when fresh", async () => {
    const v1 = venue();
    const r1 = await runLendingKeeperOnce(v1, { dryRun: false, log: () => undefined, priceGuard: async () => ({ ok: false, reason: "STALE DATA · entries halted: block" }) });
    expect(v1.liquidate).not.toHaveBeenCalled();
    expect(r1[0].error).toMatch(/STALE DATA/);
    const v2 = venue();
    await runLendingKeeperOnce(v2, { dryRun: false, log: () => undefined, priceGuard: async () => ({ ok: true }) });
    expect(v2.liquidate).toHaveBeenCalledTimes(1);
  });
});
