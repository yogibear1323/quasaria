/**
 * Testnet desk accounts (idempotent): per desk an OWNER (holds test QUSD in the vault) and an OPERATOR key
 * (vault.set_operator: can open/close, can never withdraw). Funding: friendbot XLM, QUSD trustline, 500 test QUSD
 * minted by the testnet issuer identity via the stellar CLI, deposit into the vault, delegate the operator.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Address, Asset, BASE_FEE, Contract, Horizon, Keypair, Networks, Operation, TransactionBuilder, nativeToScVal, rpc, scValToNative, xdr } from "@stellar/stellar-sdk";
import { loadDeployment } from "./deployment.js";
import { readKeyFile, writeKeyFile } from "./keys.js";
import type { OfficeConfig } from "./types.js";

const run = promisify(execFile);
const HORIZON = "https://horizon-testnet.stellar.org";
const UNIT = 10_000_000;

async function friendbot(pk: string) {
  const r = await fetch(`https://friendbot.stellar.org/?addr=${pk}`);
  if (!r.ok && r.status !== 400) throw new Error(`friendbot ${pk}: HTTP ${r.status}`);
}

export async function sorobanCall(server: rpc.Server, kp: Keypair, contractId: string, method: string, args: xdr.ScVal[]) {
  const src = await server.getAccount(kp.publicKey());
  const tx = new TransactionBuilder(src, { fee: "10000", networkPassphrase: Networks.TESTNET }).addOperation(new Contract(contractId).call(method, ...args)).setTimeout(120).build();
  const sim = await server.simulateTransaction(tx);
  if (!rpc.Api.isSimulationSuccess(sim)) throw new Error(`${method} simulation failed: ${"error" in sim ? String(sim.error).slice(0, 200) : ""}`);
  const p = rpc.assembleTransaction(tx, sim).build();
  p.sign(kp);
  const sent = await server.sendTransaction(p);
  if (sent.status === "ERROR") throw new Error(`${method} rejected`);
  const res = await server.pollTransaction(sent.hash, { attempts: 40 });
  if (res.status !== rpc.Api.GetTransactionStatus.SUCCESS) throw new Error(`${method}: ${res.status} ${sent.hash}`);
  return sent.hash;
}

export async function setupDesks(cfg: OfficeConfig, opts: { issuerIdentity: string; log?: (m: string) => void; only?: string[] }) {
  const log = opts.log ?? console.log;
  const dep = loadDeployment();
  const server = new rpc.Server(dep.rpcUrl);
  if ((await server.getNetwork()).passphrase !== Networks.TESTNET) throw new Error("not testnet");
  const horizon = new Horizon.Server(HORIZON);
  const qusd = new Asset("QUSD", dep.admin);
  const kf = readKeyFile();
  const read = async (method: string, args: xdr.ScVal[]) => {
    const tx = new TransactionBuilder(await server.getAccount(dep.admin), { fee: BASE_FEE, networkPassphrase: Networks.TESTNET }).addOperation(new Contract(dep.contracts.vault).call(method, ...args)).setTimeout(30).build();
    const sim = await server.simulateTransaction(tx);
    if (!rpc.Api.isSimulationSuccess(sim) || !sim.result) throw new Error(`read ${method} failed`);
    return scValToNative(sim.result.retval);
  };
  const report: Record<string, Record<string, string>> = {};
  // on-chain desks: the fleet desks plus calibrated desks running live TESTNET orders (e.g. Orion's tiny slice)
  const liveCal = (cfg.calibrated ?? []).filter((c) => c.mode === "live" || c.mode === "desk").map((c) => ({ id: c.id, capital: c.capital }));
  for (const d of [...cfg.desks.map((x) => ({ id: x.id, capital: x.capital })), ...liveCal]) {
    if (opts.only && !opts.only.includes(d.id)) continue;
    const r: Record<string, string> = {};
    report[d.id] = r;
    if (!kf.desks[d.id]) {
      const o = Keypair.random(), op = Keypair.random();
      kf.desks[d.id] = { owner: { publicKey: o.publicKey(), secret: o.secret() }, operator: { publicKey: op.publicKey(), secret: op.secret() } };
      writeKeyFile(kf); // persist before anything touches the network
      log(`[${d.id}] new keys owner ${o.publicKey()} operator ${op.publicKey()}`);
    }
    const owner = Keypair.fromSecret(kf.desks[d.id].owner.secret);
    const operator = Keypair.fromSecret(kf.desks[d.id].operator.secret);
    for (const kp of [owner, operator]) {
      try {
        await horizon.loadAccount(kp.publicKey());
      } catch {
        await friendbot(kp.publicKey());
        log(`[${d.id}] friendbot funded ${kp.publicKey()}`);
      }
    }
    // trustline
    let acct = await horizon.loadAccount(owner.publicKey());
    const tl = acct.balances.find((b) => "asset_code" in b && b.asset_code === "QUSD" && "asset_issuer" in b && b.asset_issuer === dep.admin);
    if (!tl) {
      const tx = new TransactionBuilder(acct, { fee: BASE_FEE, networkPassphrase: Networks.TESTNET }).addOperation(Operation.changeTrust({ asset: qusd })).setTimeout(120).build();
      tx.sign(owner);
      const res = await horizon.submitTransaction(tx);
      r.trustline = res.hash;
      log(`[${d.id}] QUSD trustline ${res.hash}`);
      acct = await horizon.loadAccount(owner.publicKey());
    }
    const free = Number(await read("free_collateral", [new Address(owner.publicKey()).toScVal()])) / UNIT;
    const ids = (await read("user_positions", [new Address(owner.publicKey()).toScVal()])) as unknown[];
    const funded = free > 0 || ids.length > 0;
    if (!funded) {
      const bal = Number((acct.balances.find((b) => "asset_code" in b && b.asset_code === "QUSD") as { balance: string } | undefined)?.balance ?? 0);
      if (bal < d.capital) {
        const amt = Math.round((d.capital - bal) * UNIT);
        const out = await run("stellar", ["contract", "invoke", "--id", dep.contracts.qusdSac, "--source", opts.issuerIdentity, "--network", "testnet", "--send=yes", "--", "transfer", "--from", dep.admin, "--to", owner.publicKey(), "--amount", String(amt)], { timeout: 120_000 });
        const m = (out.stderr + out.stdout).match(/Signing transaction: ([0-9a-f]{64})/);
        r.mint = m?.[1] ?? "ok";
        log(`[${d.id}] minted ${(amt / UNIT).toFixed(2)} test QUSD tx ${r.mint}`);
      }
      r.deposit = await sorobanCall(server, owner, dep.contracts.vault, "deposit", [new Address(owner.publicKey()).toScVal(), nativeToScVal(BigInt(Math.round(d.capital * UNIT)), { type: "i128" })]);
      log(`[${d.id}] deposited ${d.capital} test QUSD tx ${r.deposit}`);
    } else log(`[${d.id}] already funded (free ${free.toFixed(2)}, ${ids.length} open)`);
    const op = (await read("operator", [new Address(owner.publicKey()).toScVal()])) as string | null;
    if (op !== operator.publicKey()) {
      r.setOperator = await sorobanCall(server, owner, dep.contracts.vault, "set_operator", [new Address(owner.publicKey()).toScVal(), new Address(operator.publicKey()).toScVal()]);
      log(`[${d.id}] set_operator -> ${operator.publicKey()} tx ${r.setOperator}`);
    }
  }
  return report;
}

/** Emergency: owner revokes its operator (bot key loses all trading rights). */
export async function revokeOperators(only: string[] | "all", log = console.log) {
  const dep = loadDeployment();
  const server = new rpc.Server(dep.rpcUrl);
  const kf = readKeyFile();
  for (const [id, d] of Object.entries(kf.desks)) {
    if (only !== "all" && !only.includes(id)) continue;
    const owner = Keypair.fromSecret(d.owner.secret);
    const h = await sorobanCall(server, owner, dep.contracts.vault, "set_operator", [new Address(owner.publicKey()).toScVal(), xdr.ScVal.scvVoid()]);
    log(`[${id}] operator revoked tx ${h}`);
  }
}
