// Copies ONLY public contract IDs + tx hashes from the RWA testnet deploy record into
// src/config/rwa-testnet.json. Run: node scripts/sync-rwa-testnet.mjs [path/to/testnet.json]
// Superseded entries are dropped; failed/missing contracts are marked pending.
import { readFileSync, writeFileSync } from "node:fs";
const src = process.argv[2] || "/workspace/rwa-yield-layer/deployments/testnet.json";
const d = JSON.parse(readFileSync(src, "utf8"));
const NAMES = ["compliance_registry", "oracle_adapter", "rwa_wrapper", "lending_pool", "yield_vault"];
const isHex = (s) => typeof s === "string" && /^[0-9a-f]{64}$/.test(s);
const isC = (s) => typeof s === "string" && /^C[A-Z2-7]{55}$/.test(s);
const dead = (e) => !e || e.superseded === true || /supersed|fail|error/i.test(String(e.status ?? ""));
function pick(v) {
  const list = (Array.isArray(v) ? v : [v]).filter((e) => e && typeof e === "object" && !dead(e));
  return list[list.length - 1];
}
const contracts = NAMES.map((name) => {
  const e = pick(d.contracts?.[name]);
  const ok = e && isC(e.id) && isHex(e.deploy_tx);
  return ok
    ? { name, status: "deployed", id: e.id, deploy_tx: e.deploy_tx, ...(isHex(e.init_tx) ? { init_tx: e.init_tx } : {}) }
    : { name, status: "pending" };
});
const out = { network: "testnet", deployed: d.deployed ?? null, source_commit: /^[0-9a-f]{7,40}$/.test(d.source_commit ?? "") ? d.source_commit : null, contracts };
writeFileSync(new URL("../src/config/rwa-testnet.json", import.meta.url), JSON.stringify(out, null, 2) + "\n");
console.log(contracts.map((c) => `${c.name}: ${c.status} ${c.id ?? ""}`).join("\n"));
