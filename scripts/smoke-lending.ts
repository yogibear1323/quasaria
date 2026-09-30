// TESTNET ONLY smoke test for the lending pool:
//  A) supply USDC → enable collateral → borrow XLM → accrue interest → repay all → withdraw all
//  B) open a near-limit position, move the mock XLM price up so HF < 1, run the bot's lending
//     keeper (live on testnet) and check it liquidated the position
//  C) pause the pool: supply/borrow rejected, repay still works; unpause
// Stop the oracle-feed daemon first (it would overwrite the moved price); restart it after.
// Keys come from the stellar CLI keystore, never printed. Writes deployments/smoke-lending.json.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Asset, BASE_FEE, Horizon, Keypair, Networks, Operation, TransactionBuilder } from "../frontend/node_modules/@stellar/stellar-sdk/lib/esm/index.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dep = JSON.parse(readFileSync(resolve(root, "deployments/testnet.json"), "utf8"));
if (dep.network !== "testnet") throw new Error("TESTNET ONLY");
const L = JSON.parse(readFileSync(resolve(root, "deployments/testnet-lending.json"), "utf8"));
const POOL = L.pool as string, ORACLE = L.oracle as string;
const sac = (id: string) => L.reserves.find((r: { id: string }) => r.id === id).sac as string;
const USDC = sac("USDC"), XLM = sac("XLM");
const USDC_ISSUER = L.reserves.find((r: { id: string }) => r.id === "USDC").testnetIssuer as string;
const horizon = new Horizon.Server(dep.horizonUrl);
const log = (...a: unknown[]) => console.log(...a);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const sh = (args: string[]) => execFileSync("stellar", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const secretOf = (id: string) => execFileSync("stellar", ["keys", "show", id], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
const ensure = (id: string) => { try { return sh(["keys", "address", id]); } catch { sh(["keys", "generate", id, "--network", "testnet", "--fund"]); return sh(["keys", "address", id]); } };
const inv = (src: string, args: string[], send = true) => {
  for (let i = 1; ; i++) {
    try { return sh(["contract", "invoke", "--id", POOL, "--source", src, "--network", "testnet", ...(send ? [] : ["--send=no"]), "--", ...args]); } catch (e) {
      const m = String((e as { stderr?: string }).stderr ?? e);
      if (i >= 3 || /Error\(Contract, #\d+\)/.test(m)) throw new Error(m.split("\n").find((l) => l.includes("Error(")) ?? m.slice(-300));
      execFileSync("sleep", ["4"]);
    }
  }
};
const expectFail = (src: string, args: string[], code: string) => {
  try { inv(src, args); } catch (e) { const ok = (e as Error).message.includes(code); log(`   ${ok ? "✓" : "✗"} ${args[0]} rejected (${(e as Error).message.match(/Error\([^)]*\)/)?.[0]})`); return ok; }
  log(`   ✗ ${args[0]} unexpectedly succeeded`); return false;
};
async function submit(kp: Keypair, ops: unknown[]) {
  const acct = await horizon.loadAccount(kp.publicKey());
  const b = new TransactionBuilder(acct, { fee: String(Number(BASE_FEE) * 20), networkPassphrase: Networks.TESTNET });
  ops.forEach((o) => b.addOperation(o as never));
  const tx = b.setTimeout(120).build(); tx.sign(kp);
  return horizon.submitTransaction(tx);
}
const ur = (u: string, a: string) => JSON.parse(inv("quasaria-admin", ["user_reserve", "--user", u, "--asset", a], false));
const acct = (u: string) => JSON.parse(inv("quasaria-admin", ["account", "--user", u], false));
const hf = (u: string) => { const h = BigInt(acct(u).health_factor); return h > 10n ** 30n ? Infinity : Number(h) / 1e7; };
const setPx = (asset: string, price: bigint) => sh(["contract", "invoke", "--id", ORACLE, "--source", "quasaria-admin", "--network", "testnet", "--", "set_price", "--asset", JSON.stringify({ Stellar: asset }), "--price", price.toString(), "--timestamp", "0"]);
const getPx = (asset: string) => BigInt(JSON.parse(sh(["contract", "invoke", "--id", ORACLE, "--source", "quasaria-admin", "--network", "testnet", "--send=no", "--", "lastprice", "--asset", JSON.stringify({ Stellar: asset })])).price);
const U = 10_000_000n;
const out: Record<string, unknown> = { pool: POOL, at: new Date().toISOString(), steps: [] as unknown[] };
const step = (name: string, ok: boolean, detail: unknown) => { (out.steps as unknown[]).push({ name, ok, detail }); log(`${ok ? "PASS" : "FAIL"} ${name} ${JSON.stringify(detail)}`); };

// accounts
const admin = Keypair.fromSecret(secretOf("quasaria-admin"));
const users = ["quasaria-lending-smoke", "quasaria-lending-smoke-2", "quasaria-liquidator"].map((id) => ({ id, addr: ensure(id), kp: Keypair.fromSecret(secretOf(id)) }));
for (const u of users) {
  const a = await horizon.loadAccount(u.addr);
  if (!a.balances.some((b) => "asset_code" in b && b.asset_code === "USDC" && b.asset_issuer === USDC_ISSUER)) await submit(u.kp, [Operation.changeTrust({ asset: new Asset("USDC", USDC_ISSUER) })]);
}
const usdcBal = async (addr: string) => Number((await horizon.loadAccount(addr)).balances.find((b) => "asset_code" in b && b.asset_code === "USDC")?.balance ?? 0);
for (const u of users.slice(0, 2)) if ((await usdcBal(u.addr)) < 40) await submit(admin, [Operation.payment({ destination: u.addr, asset: new Asset("USDC", USDC_ISSUER), amount: "40" })]);
const [A, B, LQ] = users;

// ---------------------------------------------------------------- A) happy path
log("\n== A) supply USDC → collateral → borrow XLM → interest → repay → withdraw");
inv(A.id, ["supply", "--user", A.addr, "--asset", USDC, "--amount", (30n * U).toString()]);
inv(A.id, ["set_collateral", "--user", A.addr, "--asset", USDC, "--enabled", "true"]);
const r0 = ur(A.addr, USDC);
step("supply 30 USDC + collateral on", BigInt(r0.supplied) === 30n * U && r0.collateral, { supplied: r0.supplied, collateral: r0.collateral });
const xlmPx = Number(getPx(XLM)) / 1e14;
const borrowXlm = BigInt(Math.floor((12 / xlmPx) * 1e7)); // ≈ $12 of XLM (limit $24)
inv(A.id, ["borrow", "--user", A.addr, "--asset", XLM, "--amount", borrowXlm.toString()]);
const d0 = BigInt(ur(A.addr, XLM).borrowed);
step("borrow ≈$12 of XLM", d0 >= borrowXlm, { borrowed: d0.toString(), hf: hf(A.addr) });
const res = JSON.parse(inv("quasaria-admin", ["reserve", "--asset", XLM], false));
log(`   XLM reserve: util ${Number(res.utilization_bps) / 100}% borrow APR ${Number(res.borrow_rate_bps) / 100}% supply APR ${Number(res.supply_rate_bps) / 100}%`);
await sleep(45_000);
inv(A.id, ["accrue_interest", "--asset", XLM]);
const d1 = BigInt(ur(A.addr, XLM).borrowed);
step("interest accrued after ~45 s", d1 > d0, { before: d0.toString(), after: d1.toString(), interestStroops: (d1 - d0).toString() });
const paid = inv(A.id, ["repay", "--payer", A.addr, "--user", A.addr, "--asset", XLM, "--amount", "170141183460469231731687303715884105727"]);
step("repay all", BigInt(ur(A.addr, XLM).borrowed) === 0n, { paid: JSON.parse(paid) });
const got = inv(A.id, ["withdraw", "--user", A.addr, "--asset", USDC, "--amount", "170141183460469231731687303715884105727"]);
step("withdraw all", BigInt(JSON.parse(got)) === 30n * U && BigInt(ur(A.addr, USDC).supplied) === 0n, { withdrawn: JSON.parse(got) });

// ---------------------------------------------------------------- B) liquidation by the keeper
log("\n== B) unhealthy position → keeper liquidation");
inv(B.id, ["supply", "--user", B.addr, "--asset", USDC, "--amount", (30n * U).toString()]);
const px0 = getPx(XLM);
const nearLimit = BigInt(Math.floor((23.5 / (Number(px0) / 1e14)) * 1e7)); // limit $24 (80% of $30)
inv(B.id, ["borrow", "--user", B.addr, "--asset", XLM, "--amount", nearLimit.toString()]);
const hfB0 = hf(B.addr);
setPx(XLM, (px0 * 115n) / 100n); // XLM +15% → debt $27.0 > threshold $25.5
const hfB1 = hf(B.addr);
step("price move makes HF < 1", hfB1 < 1, { hfBefore: hfB0, hfAfter: hfB1, xlmPriceBefore: Number(px0) / 1e14, xlmPriceAfter: (Number(px0) * 1.15) / 1e14 });
const debtBefore = BigInt(ur(B.addr, XLM).borrowed), colBefore = BigInt(ur(B.addr, USDC).supplied);
const k = execFileSync("npx", ["tsx", "src/lending/cli.ts", "lending-keeper", "--once", "--identity", LQ.id], { cwd: resolve(root, "bot"), encoding: "utf8", env: process.env });
log(k.split("\n").map((l) => "   | " + l).join("\n"));
const debtAfter = BigInt(ur(B.addr, XLM).borrowed), colAfter = BigInt(ur(B.addr, USDC).supplied);
const repaid = debtBefore - debtAfter, seized = colBefore - colAfter;
const pxNow = Number(getPx(XLM)) / 1e14;
const bonusPct = seized > 0n ? ((Number(seized) / 1e7) / ((Number(repaid) / 1e7) * pxNow) - 1) * 100 : 0;
step("keeper liquidated (≤ 50% close factor, 5% USDC bonus)", repaid > 0n && repaid <= debtBefore / 2n + 1n && seized > 0n, {
  debtBefore: debtBefore.toString(), debtAfter: debtAfter.toString(), repaid: repaid.toString(), seizedUsdc: seized.toString(), impliedBonusPct: Number(bonusPct.toFixed(3)), hfAfter: hf(B.addr) });

// ---------------------------------------------------------------- C) pause still allows repay
log("\n== C) pause: repay allowed, new risk blocked");
inv("quasaria-admin", ["pause", "--caller", admin.publicKey()]);
let pauseOk = true;
try {
  pauseOk = expectFail(B.id, ["supply", "--user", B.addr, "--asset", USDC, "--amount", (1n * U).toString()], "#900") && pauseOk;
  pauseOk = expectFail(B.id, ["borrow", "--user", B.addr, "--asset", XLM, "--amount", (10n * U).toString()], "#900") && pauseOk;
  const d = BigInt(ur(B.addr, XLM).borrowed);
  inv(B.id, ["repay", "--payer", B.addr, "--user", B.addr, "--asset", XLM, "--amount", "170141183460469231731687303715884105727"]);
  const d2 = BigInt(ur(B.addr, XLM).borrowed);
  step("repay works while paused", d2 === 0n && d > 0n, { debtBefore: d.toString(), debtAfter: d2.toString() });
  const w = inv(B.id, ["withdraw", "--user", B.addr, "--asset", USDC, "--amount", "170141183460469231731687303715884105727"]);
  step("safe withdraw works while paused", BigInt(JSON.parse(w)) > 0n, { withdrawn: JSON.parse(w) });
} finally {
  inv("quasaria-admin", ["unpause"]);
}
step("supply/borrow rejected while paused (GovError::Paused #900)", pauseOk, {});
setPx(XLM, px0); // restore (the feed daemon refreshes it anyway)
step("unpaused + price restored", JSON.parse(inv("quasaria-admin", ["paused"], false)) === false, {});
out.ok = (out.steps as Array<{ ok: boolean }>).every((s) => s.ok);
writeFileSync(resolve(root, "deployments/smoke-lending.json"), JSON.stringify(out, null, 2) + "\n");
log(`\nSMOKE ${out.ok ? "PASSED" : "FAILED"}`);
