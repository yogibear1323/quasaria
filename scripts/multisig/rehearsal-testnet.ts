// TESTNET-ONLY rehearsal of the multisig admin handover (plan §1.6).
// There is no network flag: the passphrase is hard-wired to testnet and the
// RPC/Horizon endpoints are verified to be testnet before anything happens.
//
// Subcommands (run in this order; see docs/multisig-runbook.md §Rehearsal):
//   create-accounts --a1 G.. --a2 G.. --a3 G.. --g1 G.. --g2 G.. [--dry-run]
//       Creates fresh accounts A (admin, 2-of-3) and G (guardian, 1-of-2,
//       high 2) with friendbot, then submits ONE set_options tx each that adds
//       the device keys and sets master weight 0. The A/G master keys are
//       random throwaway keys that live only in memory for this command and
//       are disabled by the tx. Writes out/rehearsal/state.json (public keys only).
//   (every contract step takes --contracts name,... from deployments/testnet.json,
//    --asset-pools to add the 52 v3 pools, or --contract-ids name=C...,... for
//    throwaway copies)
//   build-propose  [--contracts a,b] [--asset-pools]
//       Unsigned propose_admin(A) for each v3 contract, source = the CURRENT
//       admin (the testnet hot key; sign with `stellar tx sign`).
//   build-accept   [--contracts ...]   Unsigned accept_admin(), source = A.
//   build-threshold-test --contracts <one>
//       Unsigned harmless admin call by A (`unpause`, or re-proposing A):
//       sign with ONE device -> submit-expect --expect fail (tx_bad_auth);
//       add a second signature -> submit-expect --expect success.
//   build-guardian [--contracts ...]   propose_action(SetGuardian(G)) by A
//       (falls back to instant set_guardian on pre-Step-1 wasm, with a warning).
//   build-guardian-execute [--contracts ...]   execute_action(SetGuardian(G)) by A.
//   check [--contracts ...]           admin()/guardian()/pending_admin() == A/G,
//                                      A/G signers + thresholds via Horizon.
//   check-sigs --xdr file [--threshold med]   offline signature-weight prediction.
//   submit-expect --xdr file --expect fail|success   submit a signed tx (testnet).
//
// Unsigned XDRs go to out/rehearsal/NN-<step>-<contract>.{xdr,txrep,summary.txt,hash,json};
// sign them in Stellar Lab (testnet) with the devices. Transactions for the
// same source are built with consecutive sequence numbers: submit in order.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Account, Keypair, StrKey, TransactionBuilder, rpc } from "@stellar/stellar-sdk";
import { die, groupHex, parse, phoenixTime } from "./lib/args.ts";
import { NETWORKS, assertRpcNetwork, type NetworkCfg } from "./lib/network.ts";
import { argsFromJson, buildAdminTx, loadSpec, readOnly, type AdminRpc } from "./lib/build.ts";
import { Horizon, type HorizonLike } from "./lib/horizon.ts";
import { buildSetOptionsTx, checkPlan, evaluateSignatures, type MultisigPlan } from "./lib/multisig.ts";
import { checkAccountConfig, compareRoles, rehearsalContracts, validateDevices, type ContractRef, type RehearsalState } from "./lib/rehearsal.ts";
import { defaultDenyList } from "./setup-multisig-account.ts";
import { envelopeJson } from "./lib/txrep.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "../..");
const NET: NetworkCfg = NETWORKS.testnet;

export interface RehearsalRpc extends AdminRpc {
  sendTransaction?(tx: any): Promise<any>;
  getTransaction?(hash: string): Promise<any>;
}

export interface Ctx {
  server: RehearsalRpc;
  horizon: HorizonLike;
  outDir: string;
  statePath: string;
  friendbot?: (addr: string) => Promise<void>;
  submitClassic?: (xdrB64: string) => Promise<void>;
  log: (s?: string) => void;
}

const readJson = (p: string) => JSON.parse(readFileSync(p, "utf8"));

function loadState(ctx: Ctx): RehearsalState {
  if (!existsSync(ctx.statePath)) throw new Error(`no rehearsal state at ${ctx.statePath}; run create-accounts first`);
  const s = readJson(ctx.statePath);
  if (s.network !== "testnet") throw new Error("state file is not a testnet rehearsal");
  return s;
}

function contractsFrom(o: any): ContractRef[] {
  if (o["contract-ids"]) {
    // Explicit list (e.g. throwaway copies for a dry run): name=C...,name2=C...
    return String(o["contract-ids"]).split(",").map((s: string, i: number) => {
      const [n, id] = s.includes("=") ? s.split("=") : [`c${i + 1}`, s];
      if (!StrKey.isValidContract(id.trim())) throw new Error(`--contract-ids: ${id} is not a C... contract id`);
      return { name: n.trim(), id: id.trim() };
    });
  }
  const dep = readJson(resolve(REPO, "deployments/testnet.json"));
  if (dep.networkPassphrase !== NET.passphrase) throw new Error("deployments/testnet.json is not testnet");
  const assetsPath = resolve(REPO, "deployments/testnet-assets.json");
  const assets = existsSync(assetsPath) ? readJson(assetsPath) : undefined;
  const only = o.contracts ? String(o.contracts).split(",").map((s: string) => s.trim()).filter(Boolean) : undefined;
  return rehearsalContracts(dep, assets, { includeAssetPools: o["asset-pools"], only });
}

const specFns = (spec: any): string[] => spec.funcs().map((f: any) => JSON.parse(JSON.stringify(f)).name);

function save(ctx: Ctx, name: string, r: { xdr: string; hash: string; txrep: string; summary: string }, meta: object) {
  mkdirSync(ctx.outDir, { recursive: true });
  const base = resolve(ctx.outDir, name.replace(/[^A-Za-z0-9._-]/g, "_"));
  writeFileSync(`${base}.xdr`, r.xdr + "\n");
  writeFileSync(`${base}.txrep`, r.txrep);
  writeFileSync(`${base}.summary.txt`, r.summary);
  writeFileSync(`${base}.hash`, r.hash + "\n");
  writeFileSync(`${base}.json`, JSON.stringify({ unsigned: true, network: "testnet", hash: r.hash, ...meta, builtAt: new Date().toISOString() }, null, 2) + "\n");
  return base;
}

// ---------------------------------------------------------------- create-accounts

export async function createAccounts(ctx: Ctx, o: any) {
  const devices = { A1: o.a1, A2: o.a2, A3: o.a3, G1: o.g1, G2: o.g2 };
  const errs = validateDevices(devices, defaultDenyList());
  if (errs.length) throw new Error(errs.join("; "));
  if (existsSync(ctx.statePath) && !o.force) throw new Error(`${ctx.statePath} exists (an earlier rehearsal); pass --force to start a new one`);
  // Throwaway master keys: in memory only, disabled (weight 0) by the setup tx.
  const masters = { A: Keypair.random(), G: Keypair.random() };
  const plans: Record<"A" | "G", MultisigPlan> = {
    A: { account: masters.A.publicKey(), signers: [devices.A1, devices.A2, devices.A3].map((key) => ({ key, weight: 1 })), low: 2, med: 2, high: 2, masterWeight: 0 },
    G: { account: masters.G.publicKey(), signers: [devices.G1, devices.G2].map((key) => ({ key, weight: 1 })), low: 1, med: 1, high: 2, masterWeight: 0 },
  };
  const profile = { A: "admin", G: "guardian" } as const;
  for (const r of ["A", "G"] as const) {
    const pre = checkPlan(plans[r], undefined, { profile: profile[r], denySigners: defaultDenyList() });
    if (pre.errors.length) throw new Error(`${r}: ${pre.errors.join("; ")}`);
    for (const w of pre.warnings) ctx.log(`${r} WARNING: ${w}`);
  }
  if (o["dry-run"]) {
    ctx.log("DRY RUN: would create A=" + plans.A.account + " (2-of-3) and G=" + plans.G.account + " (1-of-2, high 2). Nothing submitted.");
    return { A: plans.A.account, G: plans.G.account, submitted: false };
  }
  if (!ctx.friendbot || !ctx.submitClassic) throw new Error("friendbot/submit not available");
  for (const r of ["A", "G"] as const) {
    const id = plans[r].account;
    ctx.log(`Funding ${r} = ${id} with friendbot...`);
    await ctx.friendbot(id);
    const acct = await ctx.horizon.account(id);
    if (!acct) throw new Error(`${r} not found after friendbot`);
    const chk = checkPlan(plans[r], acct.state, { profile: profile[r], denySigners: defaultDenyList(), baseReserveStroops: await ctx.horizon.baseReserveStroops() });
    if (chk.errors.length) throw new Error(`${r}: ${chk.errors.join("; ")}`);
    const tx = buildSetOptionsTx(plans[r], new Account(id, acct.sequence), NET.passphrase, 300);
    tx.sign(masters[r]); // testnet throwaway master key; disabled by this very tx
    ctx.log(`Submitting ${r} set_options (tx ${Buffer.from(tx.hash()).toString("hex")})...`);
    await ctx.submitClassic(tx.toEnvelope().toXDR("base64"));
    const after = await ctx.horizon.account(id);
    const want = r === "A" ? { low: 2, med: 2, high: 2 } : { low: 1, med: 1, high: 2 };
    const probs = checkAccountConfig(r, after!.state, plans[r].signers.map((s) => s.key), want);
    if (probs.length) throw new Error(probs.join("; "));
    ctx.log(`${r} is now multisig: master weight 0, thresholds ${want.low}/${want.med}/${want.high}.`);
  }
  const state: RehearsalState = { network: "testnet", A: plans.A.account, G: plans.G.account, devices, createdAt: new Date().toISOString() };
  mkdirSync(dirname(ctx.statePath), { recursive: true });
  writeFileSync(ctx.statePath, JSON.stringify(state, null, 2) + "\n");
  ctx.log(`State (public keys only): ${ctx.statePath}`);
  return { ...state, submitted: true };
}

// ---------------------------------------------------------------- builders

async function buildFor(ctx: Ctx, step: string, idx: number, c: ContractRef, source: string, fn: string, argsJson: string, seqOffset: number, meta: object = {}) {
  const spec = await loadSpec(ctx.server, c.id);
  const args = argsFromJson(spec, fn, argsJson);
  const r = await buildAdminTx({ server: ctx.server, net: NET, source, contractId: c.id, method: fn, args, seqOffset, timeoutSeconds: 86_400 });
  const name = `${String(idx).padStart(2, "0")}-${step}-${c.name}`;
  const base = save(ctx, name, r, { step, contract: c, source, fn, args: JSON.parse(argsJson), seqOffset, ...meta });
  ctx.log(`  ${name}: ${fn} by ${source.slice(0, 6)}… (seq +${seqOffset}) hash ${r.hash.slice(0, 16)}…  -> ${base}.xdr`);
  return { name, base, ...r };
}

export async function buildStep(ctx: Ctx, step: string, o: any) {
  const st = loadState(ctx);
  const contracts = contractsFrom(o);
  const built: any[] = [];
  const offsets = new Map<string, number>();
  const nextOff = (src: string) => {
    const n = offsets.get(src) ?? 0;
    offsets.set(src, n + 1);
    return n;
  };
  ctx.log(`${step}: ${contracts.length} contract(s)`);
  let idx = 0;
  for (const c of contracts) {
    idx++;
    try {
      const spec = await loadSpec(ctx.server, c.id);
      const fns = specFns(spec);
      if (!fns.includes("propose_admin")) {
        ctx.log(`  skip ${c.name}: no two-step admin (not a governed v3 contract)`);
        continue;
      }
      const admin = String(await readOnly(ctx.server, NET, st.A, c.id, "admin"));
      if (step === "propose") {
        if (admin === st.A) { ctx.log(`  skip ${c.name}: admin is already A`); continue; }
        built.push(await buildFor(ctx, "propose", idx, c, admin, "propose_admin", JSON.stringify({ new_admin: st.A }), nextOff(admin)));
      } else if (step === "accept") {
        const pending = await readOnly(ctx.server, NET, st.A, c.id, "pending_admin");
        if (admin === st.A) { ctx.log(`  skip ${c.name}: admin is already A`); continue; }
        if (pending !== st.A) { ctx.log(`  skip ${c.name}: pending_admin is ${pending ?? "none"}, submit the propose tx first`); continue; }
        built.push(await buildFor(ctx, "accept", idx, c, st.A, "accept_admin", "{}", nextOff(st.A)));
      } else if (step === "threshold-test") {
        if (admin !== st.A) throw new Error(`${c.name}: admin is not A yet`);
        const [fn, args] = fns.includes("unpause") ? ["unpause", "{}"] : ["propose_admin", JSON.stringify({ new_admin: st.A })];
        const r = await buildFor(ctx, "threshold-test", idx, c, st.A, fn, args, nextOff(st.A), { expect: "1 signature -> tx_bad_auth; 2 signatures -> success" });
        built.push(r);
        ctx.log(`  1) sign ${r.name}.xdr with ONE A-device in Stellar Lab -> submit-expect --expect fail`);
        ctx.log(`  2) add a SECOND A-device signature to the same XDR -> submit-expect --expect success`);
        break;
      } else if (step === "guardian" || step === "guardian-execute") {
        if (admin !== st.A) throw new Error(`${c.name}: admin is not A yet`);
        const action = JSON.stringify({ action: { tag: "SetGuardian", values: [st.G] } });
        if (!fns.includes("action_delay")) {
          if (step === "guardian" && fns.includes("set_guardian")) {
            ctx.log(`  WARNING ${c.name}: pre-Step-1 wasm (instant set_guardian). Building the instant call; upgrade to the Step-1 wasm to rehearse the timelock.`);
            built.push(await buildFor(ctx, "guardian-instant", idx, c, st.A, "set_guardian", JSON.stringify({ guardian: st.G }), nextOff(st.A)));
          } else ctx.log(`  skip ${c.name}: no SetGuardian action in this wasm`);
          continue;
        }
        const eta = await readOnly(ctx.server, NET, st.A, c.id, "action_eta", argsFromJson(spec, "action_eta", action));
        if (step === "guardian") {
          if (eta != null) { ctx.log(`  skip ${c.name}: SetGuardian already queued, ETA ${phoenixTime(Number(eta))}`); continue; }
          built.push(await buildFor(ctx, "guardian-propose", idx, c, st.A, "propose_action", action, nextOff(st.A)));
        } else {
          if (eta == null) { ctx.log(`  skip ${c.name}: SetGuardian not queued`); continue; }
          const now = Math.floor(Date.now() / 1000);
          if (Number(eta) > now) ctx.log(`  NOTE ${c.name}: ETA ${phoenixTime(Number(eta))} is in the future; simulation fails until then`);
          built.push(await buildFor(ctx, "guardian-execute", idx, c, st.A, "execute_action", action, nextOff(st.A)));
        }
      }
    } catch (e) {
      ctx.log(`  ERROR ${c.name}: ${(e as Error).message.split("\n")[0]}`);
    }
  }
  ctx.log(`Built ${built.length} unsigned transaction(s) in ${ctx.outDir}. Submit same-source txs in file order.`);
  return built;
}

// ---------------------------------------------------------------- checks

export async function check(ctx: Ctx, o: any) {
  const st = loadState(ctx);
  const rows: any[] = [];
  for (const c of contractsFrom(o)) {
    try {
      const fns = specFns(await loadSpec(ctx.server, c.id));
      if (!fns.includes("propose_admin")) continue;
      const admin = String(await readOnly(ctx.server, NET, st.A, c.id, "admin"));
      const guardian = String(await readOnly(ctx.server, NET, st.A, c.id, "guardian"));
      const pending = (await readOnly(ctx.server, NET, st.A, c.id, "pending_admin")) as string | null;
      rows.push({ name: c.name, admin, guardian, pending });
    } catch (e) {
      rows.push({ name: c.name, error: (e as Error).message.split("\n")[0] });
    }
  }
  const cmp = compareRoles(rows, st.A, st.G);
  const acctProblems: string[] = [];
  for (const [label, id, sig, th] of [
    ["A", st.A, [st.devices.A1, st.devices.A2, st.devices.A3], { low: 2, med: 2, high: 2 }],
    ["G", st.G, [st.devices.G1, st.devices.G2], { low: 1, med: 1, high: 2 }],
  ] as const) {
    const a = await ctx.horizon.account(id);
    if (!a) acctProblems.push(`${label} ${id} does not exist`);
    else acctProblems.push(...checkAccountConfig(label, a.state, [...sig], th));
  }
  for (const r of cmp) ctx.log(`${r.ok ? "OK  " : "FAIL"} ${r.name.padEnd(22)} ${r.ok ? "admin=A guardian=G" : r.problems.join("; ")}`);
  for (const p of acctProblems) ctx.log(`FAIL ${p}`);
  if (!acctProblems.length) ctx.log("OK   A: master 0, A1-A3 weight 1, thresholds 2/2/2; G: master 0, G1-G2 weight 1, thresholds 1/1/2");
  const ok = cmp.every((r) => r.ok) && acctProblems.length === 0;
  ctx.log(ok ? "\nREHEARSAL CHECK PASSED" : "\nREHEARSAL CHECK: problems found");
  return { ok, rows: cmp, acctProblems };
}

export async function checkSigs(ctx: Ctx, xdrB64: string, thresholdName = "med", accountId?: string) {
  const j = envelopeJson(xdrB64);
  const src = accountId ?? j.tx?.tx?.source_account;
  if (!src) throw new Error("cannot determine the source account");
  const a = await ctx.horizon.account(src);
  if (!a) throw new Error(`account ${src} not found`);
  const signers = [...a.state.signers];
  if (a.state.masterWeight > 0) signers.push({ key: src, weight: a.state.masterWeight });
  const th = (a.state.thresholds as any)[thresholdName];
  if (th === undefined) throw new Error("--threshold must be low|med|high");
  const ev = evaluateSignatures(xdrB64, NET.passphrase, signers, Math.max(th, 1));
  ctx.log(`Account ${src}: ${ev.validSigners.length} valid signature(s), weight ${ev.weight} vs ${thresholdName} threshold ${ev.threshold}`);
  ctx.log(`Prediction: ${ev.predicted} (${ev.reason})`);
  return ev;
}

export async function submitExpect(ctx: Ctx, xdrB64: string, expect: "fail" | "success") {
  if (!ctx.server.sendTransaction || !ctx.server.getTransaction) throw new Error("RPC cannot submit");
  await assertRpcNetwork(ctx.server, NET);
  const tx = TransactionBuilder.fromXDR(xdrB64, NET.passphrase);
  await checkSigs(ctx, xdrB64).catch((e) => ctx.log(`(signature prediction unavailable: ${e.message})`));
  const sent = await ctx.server.sendTransaction(tx);
  let outcome: "success" | "fail";
  let detail = "";
  if (sent.status === "ERROR") {
    outcome = "fail";
    detail = sent.errorResult ? JSON.stringify(JSON.parse(JSON.stringify(sent.errorResult)).result) : "ERROR";
  } else {
    let res: any;
    for (let i = 0; i < 30; i++) {
      res = await ctx.server.getTransaction(sent.hash);
      if (res.status !== "NOT_FOUND") break;
      await new Promise((r) => setTimeout(r, 2000));
    }
    outcome = res?.status === "SUCCESS" ? "success" : "fail";
    detail = res?.status ?? "timeout";
  }
  const asExpected = outcome === expect;
  ctx.log(`Submitted ${sent.hash}: ${outcome.toUpperCase()} ${detail}`);
  ctx.log(asExpected ? `AS EXPECTED (${expect})` : `UNEXPECTED: expected ${expect}`);
  return { outcome, detail, asExpected, hash: sent.hash };
}

// ---------------------------------------------------------------- CLI

export async function main(argv: string[], ctxOverride?: Partial<Ctx>) {
  const { values: o, positionals } = parse(argv, {
    a1: { type: "string" }, a2: { type: "string" }, a3: { type: "string" },
    g1: { type: "string" }, g2: { type: "string" },
    contracts: { type: "string" },
    "contract-ids": { type: "string" },
    "asset-pools": { type: "boolean", default: false },
    xdr: { type: "string" },
    expect: { type: "string" },
    threshold: { type: "string", default: "med" },
    account: { type: "string" },
    state: { type: "string" },
    "out-dir": { type: "string" },
    network: { type: "string", default: "testnet" },
    force: { type: "boolean", default: false },
    "dry-run": { type: "boolean", default: false },
    help: { type: "boolean", default: false },
  });
  if (o.network !== "testnet") throw new Error("rehearsal-testnet.ts is TESTNET ONLY (no mainnet mode exists)");
  const cmd = positionals[0];
  const CMDS = ["create-accounts", "build-propose", "build-accept", "build-threshold-test", "build-guardian", "build-guardian-execute", "check", "check-sigs", "submit-expect"];
  if (o.help || !cmd || !CMDS.includes(cmd)) {
    die(`usage: node rehearsal-testnet.ts <${CMDS.join("|")}> [options]\n(see the header of this file)`, o.help ? 0 : 2);
  }
  const outDir = o["out-dir"] ?? resolve(HERE, "out/rehearsal");
  const server = (ctxOverride?.server ?? new rpc.Server(NET.rpcUrl)) as RehearsalRpc;
  const ctx: Ctx = {
    server,
    horizon: ctxOverride?.horizon ?? new Horizon(NET.horizonUrl),
    outDir,
    statePath: o.state ?? resolve(outDir, "state.json"),
    log: ctxOverride?.log ?? ((s = "") => console.log(s)),
    friendbot: ctxOverride?.friendbot ?? (async (addr) => {
      const r = await fetch(`${NET.friendbot}?addr=${addr}`);
      if (!r.ok) throw new Error(`friendbot ${r.status}: ${(await r.text()).slice(0, 200)}`);
    }),
    submitClassic: ctxOverride?.submitClassic ?? (async (x) => {
      const r = await fetch(`${NET.horizonUrl}/transactions`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: `tx=${encodeURIComponent(x)}` });
      const j: any = await r.json();
      if (!r.ok || !j.successful) throw new Error(`submit failed: ${JSON.stringify(j.extras?.result_codes ?? j.title ?? j)}`);
    }),
  };
  if (cmd !== "check-sigs" && cmd !== "create-accounts") await assertRpcNetwork(server, NET);
  const xdrArg = () => {
    if (!o.xdr) throw new Error("--xdr <file|base64> required");
    return (existsSync(o.xdr) ? readFileSync(o.xdr, "utf8") : o.xdr).trim();
  };
  switch (cmd) {
    case "create-accounts": return createAccounts(ctx, o);
    case "build-propose": return buildStep(ctx, "propose", o);
    case "build-accept": return buildStep(ctx, "accept", o);
    case "build-threshold-test":
      if ((!o.contracts && !o["contract-ids"]) || String(o.contracts ?? o["contract-ids"]).includes(",")) throw new Error("build-threshold-test needs exactly one --contracts <name>");
      return buildStep(ctx, "threshold-test", o);
    case "build-guardian": return buildStep(ctx, "guardian", o);
    case "build-guardian-execute": return buildStep(ctx, "guardian-execute", o);
    case "check": {
      const r = await check(ctx, o);
      if (!r.ok) process.exitCode = 1;
      return r;
    }
    case "check-sigs": return checkSigs(ctx, xdrArg(), o.threshold, o.account);
    case "submit-expect": {
      if (o.expect !== "fail" && o.expect !== "success") throw new Error("--expect fail|success required");
      const r = await submitExpect(ctx, xdrArg(), o.expect);
      if (!r.asExpected) process.exitCode = 1;
      return r;
    }
    default:
      die("usage: node rehearsal-testnet.ts <create-accounts|build-propose|build-accept|build-threshold-test|build-guardian|build-guardian-execute|check|check-sigs|submit-expect> [options]\n(see the header of this file)", o.help ? 0 : 2);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((e) => die(`rehearsal-testnet: ${(e as Error).message}`));
}

export { groupHex };
