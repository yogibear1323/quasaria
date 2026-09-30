// TESTNET ONLY smoke test for the v3 asset pools (deployments/testnet-assets.json).
// A fresh friendbot-funded LP account (no real funds) receives testnet tokens from the admin,
// then per pool: add liquidity (real minimums), swap through the v3 router (min_out from a
// live quote), and remove all its liquidity (real minimums). Plus one 2-hop router swap.
// Keys stay in the stellar CLI keystore; secrets are never printed.
// Usage: node scripts/smoke-asset-pools.ts [PAIR ...]   (default: USDC/XLM EURC/USDC SHX/XLM)
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Asset, BASE_FEE, Horizon, Keypair, Networks, Operation, TransactionBuilder } from "../frontend/node_modules/@stellar/stellar-sdk/lib/esm/index.js";

if (process.env.NETWORK && process.env.NETWORK !== "testnet") throw new Error("TESTNET ONLY");
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dep = JSON.parse(readFileSync(resolve(root, "deployments/testnet.json"), "utf8"));
const doc = JSON.parse(readFileSync(resolve(root, "deployments/testnet-assets.json"), "utf8"));
if (dep.network !== "testnet" || doc.network !== "testnet") throw new Error("not testnet");
const horizon = new Horizon.Server(dep.horizonUrl);
const PAIRS = process.argv.slice(2).length ? process.argv.slice(2) : ["USDC/XLM", "EURC/USDC", "SHX/XLM"];
const LP = "quasaria-smoke-lp";
const sh = (args: string[]) => execFileSync("stellar", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const secretOf = (id: string) => execFileSync("stellar", ["keys", "show", id], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
let me: string;
try { me = sh(["keys", "address", LP]); } catch { sh(["keys", "generate", LP, "--network", "testnet", "--fund"]); me = sh(["keys", "address", LP]); }
const inv = (src: string, id: string, args: string[], send = true) => {
  for (let i = 1; ; i++) {
    try { return sh(["contract", "invoke", "--id", id, "--source", src, "--network", "testnet", ...(send ? [] : ["--send=no"]), "--", ...args]); }
    catch (e) { const m = String((e as { stderr?: string }).stderr ?? e); if (i >= 3 || /Error\(Contract, #\d+\)/.test(m)) throw new Error(m.split("\n").filter((l) => /rror/.test(l)).slice(-2).join(" | ") || m.slice(-300)); execFileSync("sleep", ["4"]); }
  }
};
const view = (id: string, args: string[]) => inv(LP, id, args, false);
const bal = (sac: string, who = me) => BigInt(JSON.parse(view(sac, ["balance", "--id", who])));
const u = (n: number) => BigInt(Math.floor(n * 1e7));
const fmt = (x: bigint) => (Number(x) / 1e7).toFixed(7).replace(/\.?0+$/, "");
const byId = Object.fromEntries((doc.assets as any[]).map((a) => [a.id, a]));
const poolOf = (pair: string) => (doc.pools as any[]).find((p) => p.pair === pair && p.pool);
let pass = 0, fail = 0;
const ok = (m: string) => { pass++; console.log(`  PASS  ${m}`); };
const bad = (m: string) => { fail++; console.log(`  FAIL  ${m}`); };
const check = (c: boolean, m: string) => (c ? ok(m) : bad(m));

// ---- fund the LP account with testnet tokens (classic payments from the admin)
async function submit(kp: Keypair, ops: unknown[]) {
  const acct = await horizon.loadAccount(kp.publicKey());
  const b = new TransactionBuilder(acct, { fee: String(Number(BASE_FEE) * 20), networkPassphrase: Networks.TESTNET });
  ops.forEach((o) => b.addOperation(o as never));
  const tx = b.setTimeout(120).build();
  tx.sign(kp);
  return horizon.submitTransaction(tx);
}
const need = new Set(PAIRS.flatMap((p) => p.split("/")).concat(["XLM"]));
const classic = [...need].map((id) => byId[id]).filter((a) => a && a.testnet.issuer && a.testnet.kind !== "native");
const lpAcct = await horizon.loadAccount(me);
const lpKp = Keypair.fromSecret(secretOf(LP));
const tl = classic.filter((a) => !lpAcct.balances.some((b: any) => b.asset_code === a.testnet.code && b.asset_issuer === a.testnet.issuer));
if (tl.length) await submit(lpKp, tl.map((a) => Operation.changeTrust({ asset: new Asset(a.testnet.code, a.testnet.issuer) })));
const adminKp = Keypair.fromSecret(secretOf("quasaria-admin"));
if (adminKp.publicKey() !== dep.admin) throw new Error("admin mismatch");
await submit(adminKp, classic.map((a) => Operation.payment({ destination: me, asset: new Asset(a.testnet.code, a.testnet.issuer), amount: (a.id === "USDC" ? 40 : 60 * a.pricePerXlm).toFixed(7) /* ≈ 60 XLM worth */ })));
console.log(`LP account ${me.slice(0, 6)}…${me.slice(-4)} funded (friendbot XLM + ${classic.map((a) => a.testnet.code).join(", ")} from the admin)`);

for (const pair of PAIRS) {
  const p = poolOf(pair);
  if (!p) { bad(`${pair}: no deployed pool`); continue; }
  const A = byId[p.assetA], B = byId[p.assetB];
  console.log(`==> ${pair}  pool ${p.pool}  (${A.testnet.code}/${B.testnet.code}: ${A.testnet.kind}/${B.testnet.kind})`);
  try {
    // 1) add liquidity with real minimums (0.5%)
    const info = JSON.parse(view(p.pool, ["info"]));
    const ra = BigInt(info.reserve_a), rb = BigInt(info.reserve_b);
    const wantA = A.id === "XLM" ? u(20) : u(Number(fmt(bal(A.testnet.sac))) * 0.3);
    const wantB = (wantA * rb) / ra;
    const minA = (wantA * 995n) / 1000n, minB = (wantB * 995n) / 1000n;
    const s0 = bal(p.pool);
    const dres = JSON.parse(inv(LP, p.pool, ["deposit", "--to", me, "--desired_a", String(wantA), "--desired_b", String(wantB + wantB / 200n), "--min_a", String(minA), "--min_b", String(minB)]));
    const s1 = bal(p.pool);
    check(s1 > s0, `add liquidity: ${fmt(BigInt(dres[0]))} ${A.code} + ${fmt(BigInt(dres[1]))} ${B.code} → ${fmt(s1 - s0)} QLP (min_a ${fmt(minA)}, min_b ${fmt(minB)})`);
    // 2) swap through the v3 router (token A → B), min_out = live quote − 1%
    const amtIn = wantA / 10n;
    const q = JSON.parse(view(dep.contracts.router, ["get_amounts_out", "--pools", JSON.stringify([p.pool]), "--token_in", A.testnet.sac, "--amount_in", String(amtIn)]));
    const minOut = (BigInt(q[1]) * 99n) / 100n;
    const b0 = bal(B.testnet.sac);
    const out = JSON.parse(inv(LP, dep.contracts.router, ["swap_exact_in", "--user", me, "--pools", JSON.stringify([p.pool]), "--token_in", A.testnet.sac, "--amount_in", String(amtIn), "--min_out", String(minOut), "--deadline", String(Math.floor(Date.now() / 1000) + 600)]));
    const b1 = bal(B.testnet.sac);
    check(b1 - b0 >= minOut && BigInt(out) >= minOut, `router swap ${fmt(amtIn)} ${A.code} → ${fmt(BigInt(out))} ${B.code} (quote ${fmt(BigInt(q[1]))}, min_out ${fmt(minOut)})`);
    // 3) remove all of this account's liquidity with real minimums
    const shares = bal(p.pool);
    const i2 = JSON.parse(view(p.pool, ["info"]));
    const expA = (shares * BigInt(i2.reserve_a)) / BigInt(i2.total_shares), expB = (shares * BigInt(i2.reserve_b)) / BigInt(i2.total_shares);
    const w = JSON.parse(inv(LP, p.pool, ["withdraw", "--to", me, "--shares", String(shares), "--min_a", String((expA * 995n) / 1000n), "--min_b", String((expB * 995n) / 1000n)]));
    check(bal(p.pool) === 0n && BigInt(w[0]) > 0n && BigInt(w[1]) > 0n, `remove liquidity: burned ${fmt(shares)} QLP → ${fmt(BigInt(w[0]))} ${A.code} + ${fmt(BigInt(w[1]))} ${B.code}`);
  } catch (e) { bad(`${pair}: ${(e as Error).message.slice(0, 300)}`); }
}

// 4) two-hop route through the router: EURC → USDC → XLM
const p1 = poolOf("EURC/USDC"), p2 = poolOf("USDC/XLM");
if (p1 && p2 && PAIRS.includes("EURC/USDC")) {
  try {
    const amt = u(2);
    const q = JSON.parse(view(dep.contracts.router, ["get_amounts_out", "--pools", JSON.stringify([p1.pool, p2.pool]), "--token_in", byId.EURC.testnet.sac, "--amount_in", String(amt)]));
    const minOut = (BigInt(q[2]) * 99n) / 100n;
    const out = JSON.parse(inv(LP, dep.contracts.router, ["swap_exact_in", "--user", me, "--pools", JSON.stringify([p1.pool, p2.pool]), "--token_in", byId.EURC.testnet.sac, "--amount_in", String(amt), "--min_out", String(minOut), "--deadline", String(Math.floor(Date.now() / 1000) + 600)]));
    check(BigInt(out) >= minOut, `2-hop router swap 2 EURC → USDC → ${fmt(BigInt(out))} XLM (min_out ${fmt(minOut)})`);
  } catch (e) { bad(`2-hop swap: ${(e as Error).message.slice(0, 300)}`); }
}
// 5) slippage guard: an impossible min_out must be rejected by the router
{
  const p = poolOf(PAIRS[0]);
  try {
    inv(LP, dep.contracts.router, ["swap_exact_in", "--user", me, "--pools", JSON.stringify([p.pool]), "--token_in", byId[p.assetA].testnet.sac, "--amount_in", String(u(1)), "--min_out", String(u(1_000_000)), "--deadline", String(Math.floor(Date.now() / 1000) + 600)]);
    bad("router accepted an impossible min_out");
  } catch (e) { check(/#3\b/.test((e as Error).message), `router rejects impossible min_out (Slippage #3)`); }
}
console.log(`\nsmoke: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
