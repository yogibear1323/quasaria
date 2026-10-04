/** Testnet desk keys: ~/.quasaria-office/keys.json (0600, outside the repo, never committed). */
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { officeHome } from "./store.js";
import type { DeskKeys } from "./venue.js";

export interface KeyFile {
  network: "testnet";
  note: string;
  desks: Record<string, { owner: { publicKey: string; secret: string }; operator: { publicKey: string; secret: string } }>;
}
export const keysPath = () => process.env.QUASARIA_OFFICE_KEYS ?? join(officeHome(), "keys.json");

export function readKeyFile(path = keysPath()): KeyFile {
  if (!existsSync(path)) return { network: "testnet", note: "TESTNET ONLY. Never reuse on mainnet. Never commit.", desks: {} };
  const k = JSON.parse(readFileSync(path, "utf8")) as KeyFile;
  if (k.network !== "testnet") throw new Error("keys file is not marked testnet; refusing");
  return k;
}
export function writeKeyFile(k: KeyFile, path = keysPath()) {
  mkdirSync(join(path, ".."), { recursive: true, mode: 0o700 });
  writeFileSync(`${path}.tmp`, JSON.stringify(k, null, 1), { mode: 0o600 });
  renameSync(`${path}.tmp`, path);
  chmodSync(path, 0o600);
}
/** Runner view: owner public key + operator secret only (owner secrets are never loaded by the runner). */
export function deskKeys(path = keysPath()): Record<string, DeskKeys> {
  const k = readKeyFile(path);
  return Object.fromEntries(Object.entries(k.desks).map(([id, d]) => [id, { owner: d.owner.publicKey, operatorSecret: d.operator.secret }]));
}
