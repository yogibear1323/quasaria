// Small CLI helpers shared by the multisig tools.
import { parseArgs, type ParseArgsConfig } from "node:util";

/** Any Stellar secret seed (S + 55 base32 chars). */
export const SECRET_RE = /S[A-Z2-7]{55}/;

/** These tools never take secret keys: refuse if one appears anywhere in argv. */
export function refuseSecrets(argv: string[]): void {
  for (const a of argv) {
    if (SECRET_RE.test(a)) {
      throw new Error("Refusing: an argument looks like a Stellar SECRET key (S...). These tools only take public keys and never sign.");
    }
  }
}

export function parse<const T extends NonNullable<ParseArgsConfig["options"]>>(argv: string[], options: T) {
  refuseSecrets(argv);
  return parseArgs({ args: argv, options, allowPositionals: true as const, strict: true as const });
}

export function die(msg: string, code = 1): never {
  console.error(msg);
  process.exit(code);
}

/** "abcd...": groups of 4 hex chars, 8 groups per line, for comparing on a device screen. */
export function groupHex(hex: string): string {
  const g = hex.match(/.{1,4}/g) ?? [];
  const lines: string[] = [];
  for (let i = 0; i < g.length; i += 8) lines.push(g.slice(i, i + 8).join(" "));
  return lines.join("\n");
}

export function phoenixTime(unixSeconds: number): string {
  if (!unixSeconds) return "none";
  const d = new Date(unixSeconds * 1000);
  const local = d.toLocaleString("en-US", { timeZone: "America/Phoenix", dateStyle: "medium", timeStyle: "short" });
  return `${local} MST (America/Phoenix) = ${d.toISOString()}`;
}
