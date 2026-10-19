import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";

const walk = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
const root = new URL("../src/", import.meta.url).pathname;

describe("trading bots are gone from the site", () => {
  it("no source file mentions trading bots, a Bots page or a /bots route", () => {
    for (const f of walk(root).filter((x) => /\.(tsx?|css)$/.test(x))) {
      expect(readFileSync(f, "utf8"), f).not.toMatch(/trading bots?|polybot|\/bots\b|BotsPage|pages\/Bots|grid \/ DCA|DcaStrategy/i);
    }
  });
  it("the repo has no bot strategy engine any more", () => {
    const repo = new URL("../../bot/src/", import.meta.url).pathname;
    for (const f of ["engine.ts", "strategies", "office", "exchange.ts", "risk.ts", "keeper.ts"]) {
      if (f === "office") { expect(readdirSync(join(repo, "office"))).toEqual(["staleBreaker.ts"]); continue; }
      expect(existsSync(join(repo, f)), f).toBe(false);
    }
  });
});
