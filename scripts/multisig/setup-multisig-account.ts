// Build the UNSIGNED transaction that turns an account into a multisig
// account (plan §1.4): ONE transaction, one set_options op per signer; the
// last op also sets the thresholds and the master key weight to 0.
//
//   node setup-multisig-account.ts --account G... --profile admin \
//     --signer A1=G...:1 --signer A2=G...:1 --signer A3=G...:1 \
//     [--low 2 --med 2 --high 2] [--network testnet | --network mainnet --i-understand] \
//     [--dry-run] [--out-dir out] [--name label] [--home-domain quasaria.xyz]
//
// Safety checks (refuses on any error): total weight < high or < medium
// threshold, duplicate / invalid / self / deny-listed signer keys, weights
// outside 1..255, more than 20 signers, non-monotonic thresholds, master
// weight != 0, a single key controlling an admin/treasury account, losing one
// signer locking admin calls (admin/treasury), an account that already has
// extra signers or thresholds or a disabled master, and a balance below the
// new minimum balance. The dry-run decode re-derives the resulting signer
// set from the built XDR and prints who can authorise what.
//
// Never signs, never submits. The account's CURRENT master key signs it
// (Stellar Lab + hardware wallet, or the rehearsal script on testnet).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Account } from "@stellar/stellar-sdk";
import { die, groupHex, parse } from "./lib/args.ts";
import { resolveNetwork, type NetworkCfg } from "./lib/network.ts";
import { Horizon, type HorizonLike } from "./lib/horizon.ts";
import { PROFILES, buildSetOptionsTx, checkPlan, describeConfig, parseSignerArg, resultingConfig, type MultisigPlan, type Profile } from "./lib/multisig.ts";
import { allHashes } from "./lib/hash.ts";
import { summarize, toTxrep } from "./lib/txrep.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "../..");

/** Hot/dev keys that must never become multisig signers. */
export function defaultDenyList(): string[] {
  const out: string[] = [];
  try {
    const d = JSON.parse(readFileSync(resolve(REPO, "deployments/testnet.json"), "utf8"));
    for (const k of [d.admin, d.demoTrader, d.governance?.guardian]) if (typeof k === "string" && k.startsWith("G")) out.push(k);
  } catch { /* optional */ }
  return [...new Set(out)];
}

export interface SetupResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
  xdr?: string;
  hash?: string;
  txrep?: string;
  summary?: string;
  description?: string;
  base?: string;
}

export function planFromArgs(o: Record<string, any>): { plan: MultisigPlan; profile: Profile } {
  const profile = (o.profile ?? "custom") as Profile;
  if (!["admin", "guardian", "treasury", "custom"].includes(profile)) throw new Error(`unknown --profile ${profile}`);
  const defs = profile === "custom" ? undefined : PROFILES[profile];
  const num = (v: string | undefined, d: number | undefined, n: string) => {
    if (v === undefined) {
      if (d === undefined) throw new Error(`--${n} is required for --profile custom`);
      return d;
    }
    const x = Number(v);
    if (!Number.isFinite(x)) throw new Error(`--${n} must be a number`);
    return x;
  };
  const signers = (o.signer ?? []).map(parseSignerArg);
  return {
    profile,
    plan: {
      account: o.account,
      signers,
      low: num(o.low, defs?.low, "low"),
      med: num(o.med, defs?.med, "med"),
      high: num(o.high, defs?.high, "high"),
      masterWeight: num(o["master-weight"], 0, "master-weight"),
      homeDomain: o["home-domain"],
    },
  };
}

export async function main(argv: string[], horizon?: HorizonLike): Promise<SetupResult> {
  const { values: o } = parse(argv, {
    account: { type: "string" },
    profile: { type: "string", default: "custom" },
    signer: { type: "string", multiple: true },
    low: { type: "string" },
    med: { type: "string" },
    high: { type: "string" },
    "master-weight": { type: "string" },
    "home-domain": { type: "string" },
    "keep-master": { type: "boolean", default: false },
    "allow-single-signer": { type: "boolean", default: false },
    deny: { type: "string", multiple: true },
    network: { type: "string", default: "testnet" },
    "i-understand": { type: "boolean", default: false },
    "horizon-url": { type: "string" },
    timeout: { type: "string", default: "86400" },
    fee: { type: "string", default: "1000" },
    "dry-run": { type: "boolean", default: false },
    "out-dir": { type: "string", default: resolve(HERE, "out") },
    name: { type: "string" },
    quiet: { type: "boolean", default: false },
    help: { type: "boolean", default: false },
  });
  if (o.help || !o.account || !o.signer?.length) {
    die("usage: node setup-multisig-account.ts --account G... --profile admin|guardian|treasury|custom --signer [label=]G...:weight (repeat) [--low n --med n --high n] [--network testnet|mainnet --i-understand] [--dry-run]", o.help ? 0 : 2);
  }
  const net: NetworkCfg = resolveNetwork({ network: o.network, iUnderstand: o["i-understand"], horizonUrl: o["horizon-url"] });
  const timeout = Number(o.timeout);
  if (!Number.isInteger(timeout) || timeout < 60 || timeout > 7 * 86_400) throw new Error("--timeout must be 60..604800 seconds");
  const { plan, profile } = planFromArgs(o);
  const hz = horizon ?? new Horizon(net.horizonUrl);
  const log = (s = "") => { if (!o.quiet) console.log(s); };

  const acct = await hz.account(plan.account);
  const errors: string[] = [];
  if (!acct) errors.push(`account ${plan.account} does not exist on ${net.name} (fund it first)`);
  const reserve = acct ? await hz.baseReserveStroops() : 5_000_000n;
  const deny = [...defaultDenyList(), ...(o.deny ?? [])];
  const chk = checkPlan(plan, acct?.state, {
    profile,
    denySigners: deny,
    baseReserveStroops: reserve,
    allowSingleSignerControl: o["allow-single-signer"],
    keepMaster: o["keep-master"],
  });
  errors.push(...chk.errors);
  const labels = Object.fromEntries(plan.signers.filter((s) => s.label).map((s) => [s.key, s.label!]));

  log(`\n=== setup-multisig-account (${net.name.toUpperCase()}) — UNSIGNED, never submitted ===`);
  log(`Account: ${plan.account}  profile: ${profile}`);
  for (const w of chk.warnings) log(`WARNING: ${w}`);
  if (errors.length) {
    for (const e of errors) console.error(`REFUSED: ${e}`);
    return { ok: false, errors, warnings: chk.warnings };
  }

  const tx = buildSetOptionsTx(plan, new Account(plan.account, acct!.sequence), net.passphrase, timeout, o.fee);
  const xdrB64 = tx.toEnvelope().toXDR("base64");
  const hashes = allHashes(xdrB64, net.passphrase, true);
  if (!hashes.agree) throw new Error(`hash methods disagree: ${JSON.stringify(hashes)}`);
  // Dry-run decode: re-derive the resulting configuration from the XDR itself.
  const after = resultingConfig(xdrB64, acct!.state);
  if (after.account !== plan.account) throw new Error("decoded source account mismatch");
  const recheck = checkPlan(
    { account: plan.account, signers: after.signers, low: after.thresholds.low, med: after.thresholds.med, high: after.thresholds.high, masterWeight: after.masterWeight },
    undefined,
    { profile, denySigners: deny, allowSingleSignerControl: o["allow-single-signer"], keepMaster: o["keep-master"] },
  );
  if (recheck.errors.length) throw new Error(`decoded result fails the checks: ${recheck.errors.join("; ")}`);
  const description = describeConfig(after, labels);
  const txrep = toTxrep(xdrB64);
  const summary = summarize(xdrB64, net.passphrase, hashes.sdk);

  log("\nResulting account configuration (decoded from the XDR):");
  log(description);
  log("\n" + summary);
  if (o["dry-run"]) {
    log("Txrep (SEP-11 style):\n" + txrep);
    log("DRY RUN: nothing written.");
  }
  log("Unsigned XDR:\n" + xdrB64 + "\n");
  log("Transaction hash:\n" + groupHex(hashes.sdk) + "\n");
  log("Sign with the account's CURRENT master key (it is disabled by this tx).");
  let base: string | undefined;
  if (!o["dry-run"]) {
    const name = (o.name ?? `setup-multisig-${profile}-${plan.account.slice(0, 6)}-${hashes.sdk.slice(0, 8)}`).replace(/[^A-Za-z0-9._-]/g, "_");
    mkdirSync(o["out-dir"]!, { recursive: true });
    base = resolve(o["out-dir"]!, name);
    writeFileSync(`${base}.xdr`, xdrB64 + "\n");
    writeFileSync(`${base}.txrep`, txrep);
    writeFileSync(`${base}.summary.txt`, description + "\n\n" + summary);
    writeFileSync(`${base}.hash`, hashes.sdk + "\n");
    writeFileSync(`${base}.json`, JSON.stringify({ unsigned: true, network: net.name, profile, plan, after, warnings: chk.warnings, hash: hashes.sdk, builtAt: new Date().toISOString() }, null, 2) + "\n");
    log(`Files: ${base}.{xdr,txrep,summary.txt,hash,json}`);
  }
  return { ok: true, errors: [], warnings: chk.warnings, xdr: xdrB64, hash: hashes.sdk, txrep, summary, description, base };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2))
    .then((r) => process.exit(r.ok ? 0 : 1))
    .catch((e) => die(`setup-multisig-account: ${(e as Error).message}`));
}
