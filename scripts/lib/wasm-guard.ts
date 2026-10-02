// F-12 deploy guard: refuse to deploy a mock (or any non-audited) wasm to the
// Stellar public network. No dependencies (node:crypto / node:fs only) so
// every deploy script can import it, and it can run as a CLI from bash:
//
//   node scripts/lib/wasm-guard.ts --network testnet path/to/contract.wasm
//
// Rules
//  * every network: the file must exist and be a wasm module.
//  * mainnet (refused unless ALL hold):
//      - sha256 not in config/wasm-blocklist.json `blocked[]`;
//      - not byte-identical to the locally built mock oracle
//        (contracts/target/wasm32v1-none/release/quasaria_mock_oracle.wasm);
//      - neither the file name nor the `contractmetav0` custom section
//        matches a blocked pattern (e.g. "mock");
//      - sha256 IS in config/wasm-allowlist.mainnet.json `allowed[]`
//        (audited hashes; empty until the audit, so mainnet is refused).
//  * testnet / futurenet: blocklisted wasm is allowed (the mock oracle is a
//    legitimate testnet contract), but the verdict is still reported.
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type Network = "testnet" | "futurenet" | "mainnet";
export const MAINNET_PASSPHRASE = "Public Global Stellar Network ; September 2015";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

export interface GuardConfig {
  blocked: { name: string; sha256: string; reason?: string }[];
  blockedMetaPatterns: string[];
  blockedFileNamePatterns: string[];
  allowedMainnet: { name: string; sha256: string }[];
  /** Hashes of locally built mock wasm (computed, not configured). */
  localMockHashes: string[];
}

export interface Verdict {
  ok: boolean;
  network: Network;
  file: string;
  sha256: string;
  reasons: string[];
}

export const sha256Hex = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

export function loadGuardConfig(root = ROOT): GuardConfig {
  const bl = JSON.parse(readFileSync(resolve(root, "config/wasm-blocklist.json"), "utf8"));
  const al = JSON.parse(readFileSync(resolve(root, "config/wasm-allowlist.mainnet.json"), "utf8"));
  const localMockHashes: string[] = [];
  const mock = resolve(root, "contracts/target/wasm32v1-none/release/quasaria_mock_oracle.wasm");
  if (existsSync(mock)) localMockHashes.push(sha256Hex(readFileSync(mock)));
  return {
    blocked: bl.blocked ?? [],
    blockedMetaPatterns: bl.blockedMetaPatterns ?? [],
    blockedFileNamePatterns: bl.blockedFileNamePatterns ?? [],
    allowedMainnet: al.allowed ?? [],
    localMockHashes,
  };
}

function readVarU32(b: Uint8Array, off: number): [number, number] {
  let result = 0, shift = 0, pos = off;
  for (;;) {
    if (pos >= b.length) throw new Error("truncated LEB128");
    const byte = b[pos++];
    result |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) break;
    shift += 7;
    if (shift > 35) throw new Error("LEB128 too long");
  }
  return [result >>> 0, pos];
}

/** Custom sections of a wasm module: name -> concatenated payload. */
export function customSections(wasm: Uint8Array): Map<string, Uint8Array> {
  if (wasm.length < 8 || wasm[0] !== 0x00 || wasm[1] !== 0x61 || wasm[2] !== 0x73 || wasm[3] !== 0x6d) {
    throw new Error("not a wasm module (bad magic)");
  }
  const out = new Map<string, Uint8Array>();
  let pos = 8;
  while (pos < wasm.length) {
    const id = wasm[pos++];
    const [size, p1] = readVarU32(wasm, pos);
    const end = p1 + size;
    if (end > wasm.length) throw new Error("truncated wasm section");
    if (id === 0) {
      const [nlen, p2] = readVarU32(wasm, p1);
      const name = new TextDecoder().decode(wasm.subarray(p2, p2 + nlen));
      const payload = wasm.subarray(p2 + nlen, end);
      const prev = out.get(name);
      out.set(name, prev ? Buffer.concat([prev, payload]) : payload);
    }
    pos = end;
  }
  return out;
}

export function checkWasm(bytes: Uint8Array, file: string, network: Network, cfg: GuardConfig): Verdict {
  const sha = sha256Hex(bytes);
  const reasons: string[] = [];
  const blocked = cfg.blocked.find((x) => x.sha256.toLowerCase() === sha);
  if (blocked) reasons.push(`sha256 is blocklisted: ${blocked.name}${blocked.reason ? ` (${blocked.reason})` : ""}`);
  if (cfg.localMockHashes.includes(sha)) reasons.push("byte-identical to the locally built quasaria_mock_oracle.wasm");
  const fname = basename(file).toLowerCase();
  for (const p of cfg.blockedFileNamePatterns) if (fname.includes(p.toLowerCase())) reasons.push(`file name matches blocked pattern "${p}"`);
  let meta = "";
  try {
    const sec = customSections(bytes).get("contractmetav0");
    if (sec) meta = new TextDecoder("utf-8", { fatal: false }).decode(sec).toLowerCase();
  } catch (e) {
    reasons.push(`cannot parse wasm: ${(e as Error).message}`);
  }
  for (const p of cfg.blockedMetaPatterns) if (meta.includes(p.toLowerCase())) reasons.push(`contract meta matches blocked pattern "${p}"`);

  if (network !== "mainnet") {
    // Mocks are fine on test networks; only a malformed file is fatal.
    const fatal = reasons.filter((r) => r.startsWith("cannot parse"));
    return { ok: fatal.length === 0, network, file, sha256: sha, reasons };
  }
  if (!cfg.allowedMainnet.some((x) => x.sha256.toLowerCase() === sha)) {
    reasons.push("sha256 is not in config/wasm-allowlist.mainnet.json (audited hashes)");
  }
  return { ok: reasons.length === 0, network, file, sha256: sha, reasons };
}

/** Throws unless `file` may be deployed to `network`. Returns the verdict. */
export function assertWasmDeployable(file: string, network: Network, cfg = loadGuardConfig()): Verdict {
  if (!existsSync(file)) throw new Error(`wasm not found: ${file}`);
  const v = checkWasm(readFileSync(file), file, network, cfg);
  if (!v.ok) {
    throw new Error(`REFUSED: ${basename(file)} (${v.sha256}) may not be deployed to ${network}:\n  - ${v.reasons.join("\n  - ")}`);
  }
  return v;
}

export function networkFromPassphrase(p: string): Network {
  if (p === MAINNET_PASSPHRASE) return "mainnet";
  if (p === "Test SDF Network ; September 2015") return "testnet";
  if (p === "Test SDF Future Network ; October 2022") return "futurenet";
  throw new Error(`unknown network passphrase: ${p}`);
}

// ---------------------------------------------------------------- CLI
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const ni = args.indexOf("--network");
  const network = (ni >= 0 ? args[ni + 1] : "") as Network;
  const files = args.filter((a, i) => !a.startsWith("--") && !(ni >= 0 && i === ni + 1));
  if (!["testnet", "futurenet", "mainnet"].includes(network) || files.length === 0) {
    console.error("usage: node scripts/lib/wasm-guard.ts --network <testnet|futurenet|mainnet> <file.wasm>...");
    process.exit(2);
  }
  let bad = 0;
  for (const f of files) {
    try {
      const v = assertWasmDeployable(f, network);
      console.error(`wasm-guard: OK ${basename(f)} ${v.sha256} on ${network}${v.reasons.length ? ` (notes: ${v.reasons.join("; ")})` : ""}`);
    } catch (e) {
      console.error(`wasm-guard: ${(e as Error).message}`);
      bad++;
    }
  }
  process.exit(bad ? 1 : 0);
}
