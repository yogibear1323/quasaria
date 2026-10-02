import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { checkWasm, loadGuardConfig, sha256Hex } from "../../lib/wasm-guard.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../../..");
const REL = join(ROOT, "contracts/target/wasm32v1-none/release");
const wasms = existsSync(REL) ? readdirSync(REL).filter((f) => f.endsWith(".wasm")) : [];

test("wasm-guard (F-12): mock oracle refused on mainnet, allowed (reported) on testnet", { skip: !wasms.includes("quasaria_mock_oracle.wasm") }, () => {
  const cfg = loadGuardConfig(ROOT);
  const f = join(REL, "quasaria_mock_oracle.wasm");
  const b = readFileSync(f);
  assert.equal(checkWasm(b, f, "testnet", cfg).ok, true);
  const v = checkWasm(b, f, "mainnet", cfg);
  assert.equal(v.ok, false);
  // even renamed and allow-listed, the hash/meta checks still refuse it
  const cfg2 = { ...cfg, allowedMainnet: [{ name: "x", sha256: sha256Hex(b) }] };
  assert.equal(checkWasm(b, "/tmp/oracle.wasm", "mainnet", cfg2).ok, false);
});

test("wasm-guard: blocklisted live testnet mock hashes; empty allowlist refuses every mainnet deploy", { skip: wasms.length === 0 }, () => {
  const cfg = loadGuardConfig(ROOT);
  assert.ok(cfg.blocked.some((x) => x.sha256.startsWith("56bb5967")), "live testnet v3 mock oracle hash blocked");
  for (const w of wasms.filter((x) => !x.includes("mock"))) {
    const f = join(REL, w);
    const b = readFileSync(f);
    assert.equal(checkWasm(b, f, "testnet", cfg).ok, true, w);
    assert.equal(checkWasm(b, f, "mainnet", cfg).ok, false, `${w} must be refused until the audit pins its hash`);
    assert.equal(checkWasm(b, f, "mainnet", { ...cfg, allowedMainnet: [{ name: w, sha256: sha256Hex(b) }] }).ok, true, `${w} allowed once pinned`);
  }
});

test("static: build / verify / setup tools contain no signing or submission code", () => {
  for (const f of ["build-admin-tx.ts", "verify-hash.ts", "setup-multisig-account.ts", "lib/build.ts", "lib/hash.ts", "lib/txrep.ts", "lib/multisig.ts", "lib/network.ts"]) {
    const src = readFileSync(join(HERE, "..", f), "utf8");
    assert.doesNotMatch(src, /\.sign\(|sendTransaction|submitTransaction|fromSecret|signTransaction/, f);
  }
  const reh = readFileSync(join(HERE, "../rehearsal-testnet.ts"), "utf8");
  assert.match(reh, /const NET: NetworkCfg = NETWORKS\.testnet;/, "rehearsal hard-wired to testnet");
  assert.doesNotMatch(reh, /NETWORKS\.mainnet|Networks\.PUBLIC/);
});
