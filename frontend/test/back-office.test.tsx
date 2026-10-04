import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { scValToNative, xdr } from "@stellar/stellar-sdk";
import { BACK_OFFICE, mergeDesks, readFloorOnChain, sparkPath, statusAge, fetchStatus, type StatusDoc } from "../src/lib/backOffice";
import BackOffice from "../src/pages/BackOffice";
import { WalletProvider } from "../src/lib/wallet";

const src = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const NOW = 1_791_150_000;

const status = (o: Partial<StatusDoc["fleet"]> = {}, age = 60): StatusDoc => ({
  schema: "quasaria-back-office/status@1", generatedAt: new Date((NOW - age) * 1000).toISOString(), mode: "live", driftMode: "strict",
  fleet: { status: "running", reason: "", equity: 3000, startEquity: 3000, pnlToday: 0, pnlTotal: 0, riskUsedPct: 1.2, riskCapPct: 5, openPositions: 1, maxPositions: 12, netSide: "long", drawdownPct: 0, drawdownLimitPct: 12, ...o },
  market: { oraclePrice: 0.22, oracleAgeSec: 120, referencePrice: 0.2201, deviationPct: 0.05, oracleLevel: "ok", fundingPredictedHourly: 0, reserve: 10000 },
  desks: BACK_OFFICE.desks.map((d, i) => ({ id: d.id, status: i === 5 ? "halted" : "running", reason: i === 5 ? "drift: D-4" : "", equity: 500, startEquity: 500, pnlToday: 0, pnlTotal: 0, riskPct: d.riskPct, dailyLossPct: 0, dailyLimitPct: 3, drawdownPct: 0, drawdownLimitPct: 10, drift: { score: 10, level: "green", top: "ok" }, lastSignal: "no signal", spark: [1, 2, 3] })),
});

describe("back office config", () => {
  it("six named desks, two per strategy, public keys only", () => {
    expect(BACK_OFFICE.desks.map((d) => d.name)).toEqual(["Vega", "Rigel", "Lyra", "Nova", "Echo", "Halo"]);
    for (const s of ["trend", "funding", "meanrev"]) expect(BACK_OFFICE.desks.filter((d) => d.strategy === s).length).toBe(2);
    for (const d of BACK_OFFICE.desks) {
      expect(d.owner).toMatch(/^G[A-Z2-7]{55}$/);
      expect(d.operator).toMatch(/^G[A-Z2-7]{55}$/);
    }
    expect(src("src/config/back-office.json")).not.toMatch(/\bS[A-Z2-7]{55}\b/);
    expect(BACK_OFFICE.statusUrl).toMatch(/^https:\/\/raw\.githubusercontent\.com\/.+\/bot-status\/back-office\/status\.json$/);
  });
});

describe("status feed", () => {
  it("age + staleness", () => {
    expect(statusAge(status({}, 60), NOW)).toEqual({ age: 60, stale: false });
    expect(statusAge(status({}, 1200), NOW).stale).toBe(true);
    expect(statusAge(null, NOW).stale).toBe(true);
  });
  it("rejects an unexpected schema", async () => {
    const f = (async () => new Response(JSON.stringify({ schema: "x" }))) as unknown as typeof fetch;
    await expect(fetchStatus("https://example.test/s.json", f)).rejects.toThrow(/schema/);
  });
});

describe("merge chain + status", () => {
  const chain = { price: 0.22, priceTs: NOW, readAt: NOW, desks: Object.fromEntries(BACK_OFFICE.desks.map((d) => [d.id, { free: 450, equity: 512, positions: [] }])) };
  it("chain equity wins; status supplies bot state; stale status -> unknown", () => {
    const v = mergeDesks(BACK_OFFICE.desks, chain, status(), null, false);
    expect(v[0].equity).toBe(512);
    expect(v[0].pnl).toBe(12);
    expect(v[5].status).toBe("halted");
    expect(mergeDesks(BACK_OFFICE.desks, chain, status(), null, true)[0].status).toBe("unknown");
  });
  it("global kill marks every desk halted with the reason", () => {
    const v = mergeDesks(BACK_OFFICE.desks, chain, status({ status: "killed", reason: "manual" }), null, false);
    expect(v.every((d) => d.status === "halted" && /global kill/.test(d.reason))).toBe(true);
  });
  it("spark path", () => {
    expect(sparkPath([1]).line).toBe("");
    expect(sparkPath([1, 2, 3]).line.startsWith("M0.0,")).toBe(true);
  });
});

describe("on-chain reads (injected reader)", () => {
  it("reads free collateral + positions per owner with the Stellar(XLM SAC) market key", async () => {
    const calls: string[] = [];
    const read = (async (_c: string, m: string, a: xdr.ScVal[] = []) => {
      calls.push(m);
      if (m === "oracle") return "CBHMDDCD5NDZKQIGP4VKBTQOQ4OQMK75CYAGHBXY2JT7WGBB774NO2DY";
      if (m === "decimals") return 14;
      if (m === "lastprice") {
        expect(scValToNative(a[0])[0]).toBe("Stellar");
        return { price: 22n * 10n ** 12n, timestamp: BigInt(NOW) };
      }
      if (m === "free_collateral") return 400n * 10_000_000n;
      if (m === "user_positions") return [7n];
      if (m === "position") return { id: 7n, is_long: true, margin: 100n * 10_000_000n, size: 300n * 10_000_000n, entry_price: 20n * 10n ** 12n, stop_loss: 19n * 10n ** 12n, take_profit: 0n };
      if (m === "pending_funding") return 0n;
      throw new Error(m);
    }) as never;
    const f = await readFloorOnChain(read, BACK_OFFICE.desks.slice(0, 1));
    const d = f.desks[BACK_OFFICE.desks[0].id];
    expect(d.positions[0].leverage).toBeCloseTo(3);
    expect(d.positions[0].upnl).toBeCloseTo(30); // +10% on 300 notional
    expect(d.equity).toBeCloseTo(530);
    expect(calls).toContain("user_positions");
  });
});

describe("page", () => {
  it("renders the floor with six desks, testnet labels, kill switch status and no write controls", () => {
    const html = renderToStaticMarkup(<WalletProvider><MemoryRouter><BackOffice /></MemoryRouter></WalletProvider>);
    expect(html).toContain("Back Office");
    expect(html).toContain("Testnet");
    expect(html).toContain("Global kill switch");
    for (const d of BACK_OFFICE.desks) expect(html).toContain(d.name);
    expect(html).toContain("Mean-Rev");
    expect(html).not.toMatch(/<button[^>]*>(Pause|Flatten|Kill)/i);
  });
  it("nav: Back Office sits right after Perps; route registered", () => {
    const nav = src("src/components/Layout.tsx");
    expect(nav.indexOf('"/back-office"')).toBeGreaterThan(nav.indexOf('"/perps"'));
    expect(nav.indexOf('"/back-office"')).toBeLessThan(nav.indexOf('"/pools"'));
    expect(src("src/App.tsx")).toContain('path="/back-office"');
  });
  it("copy + style rules: no gradient text, no banned wording", () => {
    const files = ["src/pages/BackOffice.tsx", "src/lib/backOffice.ts", "src/theme/back-office.css", "src/config/back-office.json"].map(src).join("\n");
    expect(files).not.toMatch(/background-clip\s*:\s*text/i);
    expect(files).not.toMatch(new RegExp(["b", "a", "n", "k"].join(""), "i")); // owner copy rule
  });
});
