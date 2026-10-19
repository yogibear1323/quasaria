import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const script = new URL("../scripts/rewards/rewards.mjs", import.meta.url).pathname;
const run = (args, env = {}) => spawnSync("node", [script, ...args], { encoding: "utf8", env: { ...process.env, HOME: mkdtempSync(join(tmpdir(), "rw-")), ...env } });

describe("rewards script safety", () => {
  it("keeps mainnet signing off", () => {
    expect(readFileSync(script, "utf8")).toMatch(/export const MAINNET_SIGNING = false;/);
  });
  it("refuses --send by default, on testnet without the opt-in, and on mainnet even with it", () => {
    for (const [args, env] of [[["daily", "--send"], {}], [["daily", "--send", "--net", "testnet"], {}], [["daily", "--send", "--net", "mainnet"], { QUASARIA_TESTNET_SEND: "yes" }], [["referral", "--send", "--net", "mainnet"], { QUASARIA_MAINNET_GO: "yes" }]]) {
      const r = run(args, env);
      expect(r.status).toBe(1); expect(r.stderr).toMatch(/sending is disabled in this build/);
    }
  });
  it("a dry-run without a keys file stops with a plain error and prints no secret", () => {
    const r = run(["daily", "--net", "testnet"]);
    expect(r.status).toBe(1); expect(r.stderr).toMatch(/keys file not found/); expect(r.stdout + r.stderr).not.toMatch(/\bS[A-Z2-7]{55}\b/);
  });
  it("contains no secret keys in any script file", () => {
    const dir = new URL("../scripts/rewards/", import.meta.url).pathname;
    for (const f of readdirSync(dir)) expect(readFileSync(join(dir, f), "utf8")).not.toMatch(/\bS[A-Z2-7]{55}\b/);
    expect(statSync(dir).isDirectory()).toBe(true);
  });
});
