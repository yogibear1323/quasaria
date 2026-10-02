// Independently recompute the hash of a transaction envelope (the
// "two-machine check", runbook step 4). Run this on a SECOND machine that did
// not build the transaction:
//
//   node verify-hash.ts --xdr <base64 | file> [--network testnet|mainnet] \
//     [--expect <64-hex hash from the build machine>] [--no-cli]
//
// It computes the hash three ways (SDK; raw byte slicing of the original
// envelope + sha256; the Rust `stellar tx hash`, if installed), cross-checks
// the SDK decode against `stellar tx decode`, prints a summary + Txrep, and
// exits non-zero if anything disagrees or the hash differs from --expect.
// Works offline. Never signs or submits. (Read-only: mainnet needs no extra
// flag here because nothing can be sent.)
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Networks } from "@stellar/stellar-sdk";
import { die, groupHex, parse } from "./lib/args.ts";
import { allHashes, cliDecode } from "./lib/hash.ts";
import { envelopeJson, summarize, toTxrep } from "./lib/txrep.ts";

export interface VerifyResult {
  ok: boolean;
  hash: string;
  report: ReturnType<typeof allHashes>;
  problems: string[];
}

export function verify(xdrB64: string, passphrase: string, expect?: string, useCli = true): VerifyResult {
  const problems: string[] = [];
  const report = allHashes(xdrB64, passphrase, useCli);
  if (report.sdk !== report.raw) problems.push(`SDK hash ${report.sdk} != raw hash ${report.raw}`);
  if (useCli && report.cli === null) problems.push("stellar CLI not available for the third hash (install it, or pass --no-cli)");
  if (report.cli !== null && report.cli !== report.sdk) problems.push(`CLI hash ${report.cli} != SDK hash ${report.sdk}`);
  if (useCli) {
    const c = cliDecode(xdrB64);
    if (c !== null && JSON.stringify(c) !== JSON.stringify(envelopeJson(xdrB64))) problems.push("SDK decode differs from `stellar tx decode` JSON");
  }
  if (expect !== undefined) {
    const e = expect.trim().toLowerCase().replace(/\s+/g, "");
    if (!/^[0-9a-f]{64}$/.test(e)) problems.push("--expect must be a 64-char hex hash");
    else if (e !== report.sdk) problems.push(`hash MISMATCH: expected ${e}, computed ${report.sdk}`);
  }
  return { ok: problems.length === 0, hash: report.sdk, report, problems };
}

export function main(argv: string[]): number {
  const { values: o } = parse(argv, {
    xdr: { type: "string" },
    network: { type: "string", default: "testnet" },
    expect: { type: "string" },
    "no-cli": { type: "boolean", default: false },
    quiet: { type: "boolean", default: false },
    help: { type: "boolean", default: false },
  });
  if (o.help || !o.xdr) die("usage: node verify-hash.ts --xdr <base64|file> [--network testnet|mainnet] [--expect <hash>] [--no-cli]", o.help ? 0 : 2);
  const net = o.network === "mainnet" ? Networks.PUBLIC : o.network === "testnet" ? Networks.TESTNET : die(`unknown network ${o.network}`);
  const xdrB64 = existsSync(o.xdr!) ? readFileSync(o.xdr!, "utf8").trim() : o.xdr!.trim();
  const r = verify(xdrB64, net, o.expect, !o["no-cli"]);
  if (!o.quiet) {
    console.log(`Network: ${o.network} (${net})\n`);
    console.log(summarize(xdrB64, net, r.hash));
    console.log("--- Txrep ---\n" + toTxrep(xdrB64));
  }
  console.log(`hash (SDK):  ${r.report.sdk}`);
  console.log(`hash (raw):  ${r.report.raw}`);
  console.log(`hash (CLI):  ${r.report.cli ?? "(not run)"}`);
  console.log("\nCompare with the device screen:\n" + groupHex(r.hash) + "\n");
  if (!r.ok) {
    console.error("FAIL:\n  - " + r.problems.join("\n  - "));
    return 1;
  }
  console.log(o.expect ? "OK: all methods agree and the hash matches --expect." : "OK: all methods agree. (Pass --expect <hash> to compare with the build machine.)");
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exit(main(process.argv.slice(2)));
  } catch (e) {
    die(`verify-hash: ${(e as Error).message}`);
  }
}
