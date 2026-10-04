import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { scValToNative, xdr } from "@stellar/stellar-sdk";
import {
  BACK_OFFICE, EXAMPLE_POSE, applyExample, bubbleFor, deskTally, exampleInit, exampleStep, fetchStatus, floorTape, fmtPnl, mergeDesks, pnlTone, reactionFor, readFloorOnChain, sparkPath, statusAge,
  type ChainTrade, type StatusDoc,
} from "../src/lib/backOffice";
import { RobotDesk } from "../src/components/RobotDesk";
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
  it("six named desks matching the fleet config (Echo/Nova paused, Lyra experimental), public keys only", () => {
    expect(BACK_OFFICE.desks.map((d) => d.name)).toEqual(["Vega", "Regal", "Lyra", "Nova", "Echo", "Halo"]);
    expect(Object.fromEntries(BACK_OFFICE.desks.map((d) => [d.id, `${d.strategy}/${d.timeframeSec}${d.paused ? "/paused" : ""}`]))).toEqual({
      vega: "supertrend/3600", rigel: "trend/14400", lyra: "liqpocket/3600", nova: "funding/3600/paused", echo: "meanrev/900/paused", halo: "meanrev/3600",
    });
    expect(BACK_OFFICE.desks.find((d) => d.id === "lyra")!.label).toBe("Experimental · liquidity pockets · simulated/testnet");
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
  it("the runner's status feed decides strategy / frame / pause / label (old runners publish none of the new keys)", () => {
    const st = status();
    const lyra = st.desks.find((d) => d.id === "lyra")!;
    Object.assign(lyra, { strategy: "funding", timeframeSec: 3600 }); // pre-upgrade runner
    let v = mergeDesks(BACK_OFFICE.desks, chain, st, null, false).find((d) => d.cfg.id === "lyra")!;
    expect(v.cfg.strategy).toBe("funding");
    expect(v.cfg.label).toBeUndefined();
    Object.assign(lyra, { strategy: "liqpocket", label: "Experimental · liquidity pockets · simulated/testnet", configPaused: null, lpFilterBars: null });
    v = mergeDesks(BACK_OFFICE.desks, chain, st, null, false).find((d) => d.cfg.id === "lyra")!;
    expect(v.cfg.strategy).toBe("liqpocket");
    expect(v.cfg.label).toMatch(/^Experimental/);
    expect(mergeDesks(BACK_OFFICE.desks, chain, st, null, true).find((d) => d.cfg.id === "echo")!.cfg.paused).toMatch(/15m mean-reversion/); // stale -> config
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
  it("nav: Back Office is a Perps submenu (not top-level); route registered", () => {
    const nav = src("src/components/Layout.tsx");
    expect(nav).not.toContain('"/back-office", label');
    expect(nav).toContain("<PerpsNav");
    expect(src("src/components/PerpsNav.tsx")).toContain('to: "/back-office"');
    expect(src("src/App.tsx")).toContain('path="/back-office"');
  });
  it("copy + style rules: no gradient text, no banned wording", () => {
    const files = ["src/components/RobotDesk.tsx", "src/components/DemoAccount.tsx", "src/components/PerpsNav.tsx", "src/lib/demo/engine.ts", "src/lib/demo/store.ts", "src/lib/demo/views.ts", "src/lib/demo/useDemo.ts", "src/lib/demo/market.ts", "src/lib/demo/profiles.ts", "src/pages/BackOffice.tsx", "src/lib/backOffice.ts", "src/theme/back-office.css", "src/config/back-office.json"].map(src).join("\n");
    expect(files).not.toMatch(/background-clip\s*:\s*text/i);
    expect(files).not.toMatch(new RegExp(["b", "a", "n", "k"].join(""), "i")); // owner copy rule
  });
});

const iso = (sec: number) => new Date(sec * 1000).toISOString();
const close = (pnl: number, ageSec: number, id = 1): ChainTrade => ({ kind: "close", id, price: 0.22, pnl, reason: "stop", ledger: 100 - ageSec / 10, at: iso(NOW - ageSec), tx: `tx${id}` });
const open = (ageSec: number, id = 9): ChainTrade => ({ kind: "open", id, side: "long", leverage: 3, price: 0.22, ledger: 100 - ageSec / 10, at: iso(NOW - ageSec), tx: `tx${id}` });

describe("robot floor model", () => {
  it("fmtPnl: clean 0.00, signed values, unicode minus", () => {
    expect(fmtPnl(0)).toBe("0.00");
    expect(fmtPnl(-0.001)).toBe("0.00");
    expect(fmtPnl(0.42)).toBe("+0.42");
    expect(fmtPnl(-0.18)).toBe("−0.18");
    expect(fmtPnl(null)).toBe("—");
  });
  it("tally: wins/losses, gross won vs lost, realized; opens ignored", () => {
    const t = deskTally([close(0.42, 10, 1), close(-0.18, 20, 2), close(0.95, 30, 3), open(40)]);
    expect(t).toMatchObject({ wins: 2, losses: 1 });
    expect(t.grossWon).toBeCloseTo(1.37);
    expect(t.grossLost).toBeCloseTo(0.18);
    expect(t.realized).toBeCloseTo(1.19);
    expect(deskTally([])).toEqual({ wins: 0, losses: 0, grossWon: 0, grossLost: 0, realized: 0 });
  });
  it("bubble shows the latest real trade for 3 h", () => {
    expect(bubbleFor([open(60)], NOW)).toEqual({ text: "LONG XLM 3.0×", tone: "open" });
    expect(bubbleFor([close(0.42, 60)], NOW)).toEqual({ text: "CLOSED +0.42", tone: "win" });
    expect(bubbleFor([close(-0.18, 60)], NOW)?.tone).toBe("loss");
    expect(bubbleFor([open(4 * 3600)], NOW)).toBeNull();
    expect(bubbleFor([], NOW)).toBeNull();
  });
  it("reaction: cheer/slump only for a close in the last 10 min", () => {
    expect(reactionFor([close(0.3, 120)], NOW)).toBe("win");
    expect(reactionFor([open(30), close(-0.3, 120)], NOW)).toBe("loss");
    expect(reactionFor([close(0.3, 3600)], NOW)).toBeNull();
    expect(reactionFor([open(30)], NOW)).toBeNull();
  });
  it("glow tone + floor tape ordering", () => {
    expect([pnlTone(null), pnlTone(0), pnlTone(0.2), pnlTone(-0.2)]).toEqual(["flat", "flat", "up", "dn"]);
    const v = mergeDesks(BACK_OFFICE.desks, null, null, { vega: [close(0.1, 50, 1)], rigel: [open(10, 2)] }, false);
    expect(floorTape(v).map((x) => x.desk)).toEqual(["Regal", "Vega"]);
  });
  it("example script: alternates open/close on active desks, never touches paused/halted poses, labelled tx ids", () => {
    let s = exampleInit();
    for (let k = 0; k < 8; k++) s = exampleStep(s, 0.22, NOW * 1000 + k);
    const posed = BACK_OFFICE.desks.filter((_, i) => EXAMPLE_POSE[i]).map((d) => d.id);
    for (const id of posed) expect(s.desks[id].trades).toEqual([]);
    const all = Object.values(s.desks).flatMap((d) => d.trades);
    expect(all.length).toBe(8);
    expect(all.every((t) => t.tx.startsWith("example"))).toBe(true);
    expect(all.filter((t) => t.kind === "close").length).toBe(4);
    const live = mergeDesks(BACK_OFFICE.desks, null, status(), null, false);
    const ex = applyExample(live, s);
    expect(live.every((d) => d.trades.length === 0)).toBe(true); // live views untouched
    expect(ex[3].status).toBe("paused");
    expect(ex[5].status).toBe("halted");
    expect(ex[0].pnl).toBeCloseTo(s.desks[ex[0].cfg.id].realized + (s.desks[ex[0].cfg.id].pos?.upnl ?? 0));
  });
});

describe("robot desk render", () => {
  const view = (o: Partial<ReturnType<typeof mergeDesks>[number]> = {}) => ({ ...mergeDesks(BACK_OFFICE.desks, null, status(), null, false)[0], ...o });
  const html = (d: ReturnType<typeof view>, example = false) => renderToStaticMarkup(<RobotDesk d={d} i={0} now={NOW} selected={false} onSelect={() => undefined} tradesLoaded example={example} />);
  it("no trades: odometer 0.00, W 0 · L 0, no bubble, no example label", () => {
    const h = html(view({ pnl: 0 }));
    expect(h).toContain("st-running");
    expect(h).toContain(">0.00<");
    expect(h).toContain("W 0");
    expect(h).not.toContain("bo-bubble");
    expect(h).not.toMatch(/>example</i);
  });
  it("status drives pose classes; halted shows alarm, paused shows zzz", () => {
    expect(html(view({ status: "halted" }))).toContain("st-halted");
    expect(html(view({ status: "paused" }))).toContain("bo-zzz");
  });
  it("recent real win -> cheer + green glow + bubble; loss -> slump + red", () => {
    const w = html(view({ pnl: 0.42, trades: [close(0.42, 60)] }));
    expect(w).toContain("rx-win");
    expect(w).toContain("t-up");
    expect(w).toContain("CLOSED +0.42");
    const l = html(view({ pnl: -0.18, trades: [close(-0.18, 60)] }));
    expect(l).toContain("rx-loss");
    expect(l).toContain("t-dn");
  });
  it("open position shows unrealized P&L on the desk", () => {
    const pos = { id: 7, side: "long" as const, margin: 25, size: 75, leverage: 3, entry: 0.22, stop: 0.217, takeProfit: 0.227, pendingFunding: 0, upnl: 0.11 };
    const h = html(view({ positions: [pos], pnl: 0.11 }));
    expect(h).toContain("LONG 3.0×");
    expect(h).toContain("uPnL <b class=\"g\">+0.11");
  });
  it("example mode is labelled on the odometer", () => {
    expect(html(view({ pnl: 0.27 }), true)).toMatch(/<em>example<\/em>/);
  });
  it("css: reduced-motion kill switch, distinct strategy accents", () => {
    const css = src("src/theme/back-office.css");
    expect(css).toMatch(/prefers-reduced-motion:\s*reduce/);
    for (const s of ["trend", "funding", "meanrev"]) expect(css).toContain(`.bo-desk.${s} { --acc:`);
  });
});
