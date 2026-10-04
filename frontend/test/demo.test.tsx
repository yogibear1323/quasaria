import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { aggregate, type Candle } from "../../bot/src/office/indicators";
import { CATCHUP_MAX_SEC, DEMO_MAX, DEMO_MIN, OFFICE, catchUp, closedBy, demoEquity, deskEquity, newDemo, step, validateBalance, type DemoState } from "../src/lib/demo/engine";
import { DEMO_KEY, LEASE_SEC, claimRunner, closeDemo, createDemo, createDemoLocked, loadDemo, saveDemo, type KV, type Locks } from "../src/lib/demo/store";
import { botStats, demoViews, mirrorViews } from "../src/lib/demo/views";
import { BACK_OFFICE, mergeDesks } from "../src/lib/backOffice";
import { PerpsNav, PERPS_MENU, isPerpsPath } from "../src/components/PerpsNav";
import { DemoAccount } from "../src/components/DemoAccount";

const src = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const T0 = 1_790_000_000 - (1_790_000_000 % 3600);

class MemKV implements KV {
  m = new Map<string, string>();
  getItem(k: string) { return this.m.get(k) ?? null; }
  setItem(k: string, v: string) { this.m.set(k, v); }
  removeItem(k: string) { this.m.delete(k); }
}
/** Serialising Web Locks stand-in (one holder at a time, FIFO). */
class FakeLocks implements Locks {
  private q: Promise<unknown> = Promise.resolve();
  request<T>(_n: string, cb: () => T | Promise<T>): Promise<T> {
    const r = this.q.then(() => new Promise((res) => setTimeout(res, 1))).then(cb);
    this.q = r.catch(() => undefined);
    return r;
  }
}

/** Deterministic XLM-like 15-minute series: regime-switching drift + seeded noise. */
function series(n: number, seed = 7): Candle[] {
  let x = seed, p = 0.22;
  const rnd = () => ((x = (x * 1103515245 + 12345) % 2 ** 31) / 2 ** 31) - 0.5;
  const out: Candle[] = [];
  for (let i = 0; i < n; i++) {
    const drift = Math.sin(i / 160) * 0.0009;
    const o = p;
    p = Math.max(0.05, p * (1 + drift + rnd() * 0.006));
    const h = Math.max(o, p) * (1 + Math.abs(rnd()) * 0.003), l = Math.min(o, p) * (1 - Math.abs(rnd()) * 0.003);
    out.push({ t: T0 + i * 900, o, h, l, c: p });
  }
  return out;
}
function run(st: DemoState, m15: Candle[]) {
  const h1 = aggregate(m15, 900, 4), h4 = aggregate(h1, 3600, 4);
  for (const b of m15) {
    const now = b.t + 900;
    st = step(st, { now, price: b.c, hi: b.h, lo: b.l, bars: { 900: closedBy(m15, 900, now).slice(-300), 3600: closedBy(h1, 3600, now).slice(-300), 14400: closedBy(h4, 14400, now).slice(-300) }, fundingHourly: 0, extSkew: 0 });
  }
  return st;
}

describe("demo balance validation", () => {
  it("presets + custom amounts within sane bounds", () => {
    expect(validateBalance("500")).toEqual({ ok: true, value: 500 });
    expect(validateBalance("$5,000")).toEqual({ ok: true, value: 5000 });
    expect(validateBalance("2500.5")).toEqual({ ok: true, value: 2500.5 });
    for (const bad of ["", "abc", "-100", "1e5", "12.345", String(DEMO_MIN - 1), String(DEMO_MAX + 1), "NaN"]) expect(validateBalance(bad).ok).toBe(false);
  });
});

describe("demo simulator (same bot modules)", () => {
  it("imports the fleet's strategy / sizing / risk / drift code, no wallet or chain code", () => {
    const e = src("src/lib/demo/engine.ts");
    for (const m of ["strategies", "sizing", "risk", "drift"]) expect(e).toContain(`../../../../bot/src/office/${m}`);
    for (const f of ["src/lib/demo/engine.ts", "src/lib/demo/store.ts", "src/lib/demo/views.ts", "src/lib/demo/useDemo.ts"]) expect(src(f)).not.toMatch(/stellar-sdk|signTransaction|useWallet|freighter|soroban/i);
  });
  it("splits the balance with the fleet's capital ratios", () => {
    const st = newDemo(3000, T0, "x");
    for (const d of OFFICE.desks) expect(st.desks[d.id].startEquity).toBeCloseTo(500);
    expect(demoEquity(st, 0.22)).toBeCloseTo(3000);
  });
  it("deterministic on a fixed price series; trades respect the risk caps; equity stays consistent", () => {
    const m15 = series(1400);
    const a = run(newDemo(1000, T0, "a"), m15);
    const b = run(newDemo(1000, T0, "a"), m15);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    const opens = Object.values(a.desks).flatMap((d) => d.trades.filter((t) => t.kind === "open"));
    expect(opens.length).toBeGreaterThan(0);
    for (const d of Object.values(a.desks)) {
      expect(d.positions.length).toBeLessThanOrEqual(OFFICE.limits.maxOpenPerDesk);
      for (const c of d.closed) expect(c.r).toBeGreaterThan(-2.5); // a stop loss is ~-1R (+ slippage / gaps), never a blow-up
      expect(deskEquity(d, m15[m15.length - 1].c)).toBeGreaterThan(0);
    }
    const st = botStats(a, BACK_OFFICE.desks, m15[m15.length - 1].c);
    expect(st.reduce((x, s) => x + s.pnl, 0)).toBeCloseTo(demoEquity(a, m15[m15.length - 1].c) - 1000, 6);
    expect(a.history.length).toBeGreaterThan(10);
  });
  it("catch-up replays recent history; older gaps are marked 'paused while away'", () => {
    const m15 = series(300);
    const h1 = aggregate(m15, 900, 4), h4 = aggregate(h1, 3600, 4);
    const now = m15[m15.length - 1].t + 900;
    const fresh = catchUp(newDemo(1000, now - 6 * 3600, "c"), { m15, h1, h4 }, now, 0);
    expect(fresh.away.at(-1)?.mode).toBe("caught-up");
    expect(fresh.lastTick).toBe(now);
    const old = catchUp(newDemo(1000, now - 5 * 86_400, "o"), { m15, h1, h4 }, now, 0);
    expect(old.away[0].mode).toBe("paused");
    expect(old.away[0].to - old.away[0].from).toBeGreaterThanOrEqual(5 * 86_400 - CATCHUP_MAX_SEC - 900);
  });
});

describe("separation from live data", () => {
  it("demo views carry their own unit + ids; live desk views are untouched; mirror only scales", () => {
    const live = mergeDesks(BACK_OFFICE.desks, null, null, null, true);
    const snap = JSON.stringify(live);
    const dv = demoViews(newDemo(1000, T0, "s"), BACK_OFFICE.desks, 0.22);
    expect(dv.every((d) => d.unit === "demo $")).toBe(true);
    expect(JSON.stringify(live)).toBe(snap);
    const withPnl = live.map((d) => ({ ...d, equity: 510, pnl: 10 }));
    const mv = mirrorViews(withPnl, 6000); // fleet capital 3000 -> x2
    expect(mv[0].pnl).toBe(20);
    expect(mv[0].unit).toBe("mirror $");
    expect(withPnl[0].pnl).toBe(10);
    expect(DEMO_KEY).toMatch(/^quasaria\.demo\./);
  });
});

describe("persistence + one demo per browser", () => {
  it("create -> load round trip; corrupt data ignored", () => {
    const kv = new MemKV();
    const r = createDemo(kv, "1000", T0, "id1");
    expect(r.ok).toBe(true);
    expect(loadDemo(kv)?.balance).toBe(1000);
    kv.setItem(DEMO_KEY, "{not json");
    expect(loadDemo(kv)).toBeNull();
  });
  it("a second create (another tab, same storage) is refused with the close-first message", () => {
    const kv = new MemKV();
    expect(createDemo(kv, 500, T0, "tabA").ok).toBe(true);
    const r = createDemo(kv, 5000, T0, "tabB");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("exists");
      expect(r.message).toMatch(/already have a demo open/);
    }
    expect(loadDemo(kv)?.balance).toBe(500);
  });
  it("two tabs racing under the lock: exactly one demo is created", async () => {
    const kv = new MemKV(), locks = new FakeLocks();
    const rs = await Promise.all([createDemoLocked(kv, 1000, T0, "A", locks), createDemoLocked(kv, 5000, T0, "B", locks)]);
    expect(rs.filter((r) => r.ok).length).toBe(1);
  });
  it("a stale tab cannot resurrect a closed demo; close frees the slot", () => {
    const kv = new MemKV();
    const r = createDemo(kv, 1000, T0, "id1");
    if (!r.ok) throw new Error("create failed");
    closeDemo(kv);
    expect(saveDemo(kv, r.demo)).toBe(false);
    expect(loadDemo(kv)).toBeNull();
    expect(createDemo(kv, 2000, T0, "id2").ok).toBe(true);
  });
  it("only one tab runs the simulation (heartbeat lease)", () => {
    const kv = new MemKV();
    expect(claimRunner(kv, "A", 100)).toBe(true);
    expect(claimRunner(kv, "B", 110)).toBe(false);
    expect(claimRunner(kv, "A", 120)).toBe(true);
    expect(claimRunner(kv, "B", 120 + LEASE_SEC + 1)).toBe(true);
  });
});

describe("demo UI", () => {
  const noop = async () => ({ ok: false as const, reason: "invalid" as const, message: "" });
  it("create form: presets, custom amount, simulated-results copy", () => {
    const h = renderToStaticMarkup(<DemoAccount demo={null} price={0.22} note="" runner available desks={BACK_OFFICE.desks} mode="demo" create={noop} close={() => undefined} reset={async () => null} />);
    for (const p of ["$500", "$1,000", "$5,000"]) expect(h).toContain(p);
    expect(h).toContain("Start demo");
    expect(h).toMatch(/does not guarantee future results/);
    expect(h).toMatch(/no guaranteed returns/);
  });
  it("existing demo replaces the create flow with the one-demo notice + reset/close", () => {
    const h = renderToStaticMarkup(<DemoAccount demo={newDemo(1000, T0, "z")} price={0.22} note="" runner available desks={BACK_OFFICE.desks} mode="demo" create={noop} close={() => undefined} reset={async () => null} />);
    expect(h).toContain("You already have a demo open — close it to start a new one.");
    expect(h).not.toContain("Start demo");
    expect(h).toContain("Close demo");
    expect(h).toContain("not real money");
  });
});

describe("Perps nav submenu", () => {
  const html = (p: string) => renderToStaticMarkup(<MemoryRouter initialEntries={[p]}><PerpsNav pathname={p} /></MemoryRouter>);
  it("accessible trigger: haspopup + expanded=false initially; caret button for touch", () => {
    const h = html("/markets");
    expect(h).toContain('aria-haspopup="menu"');
    expect(h).toContain('aria-expanded="false"');
    expect(h).toContain('aria-label="Perps menu"');
    expect(h).not.toContain('class="active"');
  });
  it("Perps shows active on /back-office and /perps; menu lists both", () => {
    expect(html("/back-office")).toContain('class="active"');
    expect(html("/perps")).toContain('class="active"');
    expect(isPerpsPath("/back-office")).toBe(true);
    expect(PERPS_MENU.map((m) => m.to)).toEqual(["/perps", "/back-office"]);
    expect(src("src/components/PerpsNav.tsx")).toMatch(/Escape/);
  });
  it("Perps page links to the demo account", () => {
    expect(src("src/pages/Perps.tsx")).toContain('to="/back-office?view=demo"');
  });
});
