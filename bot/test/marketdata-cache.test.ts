import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PublicReferenceFeed } from "../src/office/marketData.js";

/** Fake Coinbase candles endpoint: serves every minute in [start,end] (or the latest 300). Counts requests. */
function fake(now: number) {
  let calls = 0;
  const f = (async (url: string) => {
    calls++;
    const u = new URL(url);
    const g = Number(u.searchParams.get("granularity"));
    const s = u.searchParams.get("start"), e = u.searchParams.get("end");
    const end = e ? Date.parse(e) / 1000 : now, start = s ? Date.parse(s) / 1000 : end - 300 * g;
    const rows: number[][] = [];
    for (let t = Math.ceil(start / g) * g; t <= end && rows.length < 300; t += g) rows.push([t, 0.19, 0.2, 0.195, 0.196, 1]);
    return { ok: true, json: async () => rows.reverse() } as Response;
  }) as typeof fetch;
  return { f, calls: () => calls };
}

describe("reference feed: disk-cached candle history", () => {
  it("pages once, persists, and a fresh process only fetches the gap", async () => {
    const dir = mkdtempSync(join(tmpdir(), "candles-"));
    try {
      const now = 1_790_100_000;
      const a = fake(now);
      const bars = await new PublicReferenceFeed(a.f, 55, dir).closedBars(60, now, 3000);
      expect(bars.length).toBeGreaterThanOrEqual(2990);
      expect(a.calls()).toBeGreaterThan(10);
      expect(existsSync(join(dir, "candles-60.json"))).toBe(true);
      const b = fake(now + 600);
      const again = await new PublicReferenceFeed(b.f, 55, dir).closedBars(60, now + 600, 3000);
      expect(again.length).toBeGreaterThanOrEqual(2990);
      expect(b.calls()).toBeLessThanOrEqual(2); // latest page only (+ at most one head top-up)
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);
});
