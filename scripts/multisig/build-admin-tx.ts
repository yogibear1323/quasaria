// Build an UNSIGNED Quasaria admin transaction for the multisig signing flow.
//
//   node build-admin-tx.ts --source <A: multisig admin G...> --contract <C...> \
//     --fn propose_action --args '{"action":{"tag":"SetGuardian","values":["G..."]}}' \
//     [--network testnet | --network mainnet --i-understand] [--wasm local.wasm] \
//     [--timeout 86400] [--fee 10000] [--out-dir out] [--name label] [--seq-offset n]
//
// * The admin account A is the TRANSACTION SOURCE, so the contract's
//   `admin.require_auth()` is satisfied by A's envelope signatures
//   (source-account credentials, medium threshold). Signers then add their
//   signatures to the same XDR one after another (Stellar Lab + Ledger/Trezor).
// * Simulates the call (fails loudly on any contract error), assembles the
//   Soroban footprint/fees, and writes: <name>.xdr, <name>.txrep (SEP-11
//   style), <name>.summary.txt, <name>.hash, <name>.json.
// * NEVER signs and NEVER submits. Mainnet needs `--network mainnet
//   --i-understand` and still only outputs unsigned XDR.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { rpc } from "@stellar/stellar-sdk";
import { die, groupHex, parse, phoenixTime } from "./lib/args.ts";
import { resolveNetwork } from "./lib/network.ts";
import { argsFromJson, buildAdminTx, loadSpec, readOnly, type AdminRpc } from "./lib/build.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

export async function main(argv: string[], server?: AdminRpc) {
  const { values: o } = parse(argv, {
    source: { type: "string" },
    contract: { type: "string" },
    fn: { type: "string" },
    args: { type: "string", default: "{}" },
    wasm: { type: "string" },
    network: { type: "string", default: "testnet" },
    "i-understand": { type: "boolean", default: false },
    "rpc-url": { type: "string" },
    fee: { type: "string", default: "10000" },
    timeout: { type: "string", default: "86400" },
    "out-dir": { type: "string", default: resolve(HERE, "out") },
    name: { type: "string" },
    "allow-address-auth": { type: "boolean", default: false },
    "seq-offset": { type: "string", default: "0" },
    help: { type: "boolean", default: false },
  });
  if (o.help || !o.source || !o.contract || !o.fn) {
    die("usage: node build-admin-tx.ts --source G... --contract C... --fn <method> [--args JSON] [--network testnet|mainnet --i-understand] [--wasm file] [--timeout s] [--fee stroops] [--out-dir dir] [--name label]", o.help ? 0 : 2);
  }
  const net = resolveNetwork({ network: o.network, iUnderstand: o["i-understand"], rpcUrl: o["rpc-url"] });
  const timeout = Number(o.timeout);
  if (!Number.isInteger(timeout) || timeout < 60 || timeout > 7 * 86_400) throw new Error("--timeout must be 60..604800 seconds");
  const srv: AdminRpc = server ?? new rpc.Server(net.rpcUrl, { allowHttp: false });
  const spec = await loadSpec(srv, o.contract, o.wasm);
  const args = argsFromJson(spec, o.fn, o.args!);

  const res = await buildAdminTx({
    server: srv,
    net,
    source: o.source,
    contractId: o.contract,
    method: o.fn,
    args,
    fee: o.fee,
    timeoutSeconds: timeout,
    allowAddressAuth: o["allow-address-auth"],
    seqOffset: Number(o["seq-offset"]),
  });

  // Timelock context for the signer.
  const notes: string[] = [];
  if (o.fn === "propose_action" || o.fn === "execute_action" || o.fn === "cancel_action") {
    try {
      const delay = Number(await readOnly(srv, net, o.source, o.contract, "action_delay", args));
      notes.push(`Timelock delay for this action: ${delay} s (${(delay / 3600).toFixed(2)} h)`);
    } catch (e) {
      notes.push(`(could not read action_delay: ${(e as Error).message.split("\n")[0]})`);
    }
    try {
      const eta = await readOnly(srv, net, o.source, o.contract, "action_eta", args);
      notes.push(eta == null ? "Currently queued: no" : `Currently queued: yes, ETA ${phoenixTime(Number(eta))}`);
    } catch { /* view may not exist on old wasm */ }
  }

  const name = (o.name ?? `${o.fn}-${o.contract.slice(0, 6)}-${res.hash.slice(0, 8)}`).replace(/[^A-Za-z0-9._-]/g, "_");
  mkdirSync(o["out-dir"]!, { recursive: true });
  const base = resolve(o["out-dir"]!, name);
  writeFileSync(`${base}.xdr`, res.xdr + "\n");
  writeFileSync(`${base}.txrep`, res.txrep);
  writeFileSync(`${base}.summary.txt`, res.summary + (notes.length ? notes.join("\n") + "\n" : ""));
  writeFileSync(`${base}.hash`, res.hash + "\n");
  writeFileSync(
    `${base}.json`,
    JSON.stringify(
      {
        unsigned: true,
        network: net.name,
        networkPassphrase: net.passphrase,
        source: o.source,
        contract: o.contract,
        fn: o.fn,
        args: JSON.parse(o.args!),
        hash: res.hash,
        minResourceFee: res.minResourceFee,
        simulatedReturn: res.retval,
        authKinds: res.authKinds,
        builtAt: new Date().toISOString(),
        files: { xdr: `${name}.xdr`, txrep: `${name}.txrep`, summary: `${name}.summary.txt` },
      },
      null,
      2,
    ) + "\n",
  );

  const banner = net.name === "mainnet" ? "*** MAINNET *** UNSIGNED transaction (not submitted)" : "TESTNET UNSIGNED transaction (not submitted)";
  console.log(`\n=== ${banner} ===\n`);
  console.log(res.summary);
  if (notes.length) console.log(notes.join("\n") + "\n");
  console.log(`Simulated return value: ${JSON.stringify(res.retval)}`);
  console.log(`Auth entries: ${res.authKinds.join(", ") || "none"}\n`);
  console.log(`Files: ${base}.{xdr,txrep,summary.txt,hash,json}\n`);
  console.log("Unsigned XDR:\n" + res.xdr + "\n");
  console.log("Transaction hash (compare on the device and with verify-hash.ts on a second machine):");
  console.log(groupHex(res.hash) + "\n");
  return { ...res, base };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((e) => die(`build-admin-tx: ${(e as Error).message}`));
}
