import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { WalletProvider } from "../src/lib/wallet";
import AccountModal, { NONCUSTODIAL_NOTE } from "../src/components/AccountModal";

const walk = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });

describe("keypair-only accounts", () => {
  it("has no Freighter or wallet-connector code or dependency", () => {
    const pkg = readFileSync(new URL("../package.json", import.meta.url), "utf8");
    expect(pkg).not.toMatch(/freighter|wallets-kit|walletconnect/i);
    const src = walk(new URL("../src", import.meta.url).pathname).filter((f) => /\.(tsx?|mts|mjs)$/.test(f));
    for (const f of src) expect(readFileSync(f, "utf8"), f).not.toMatch(/freighter/i);
  });
  it("the connect flow says 'Your keys, your XLM' accurately for the keypair model", () => {
    const html = renderToStaticMarkup(<WalletProvider><AccountModal /></WalletProvider>);
    const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    expect(text).toMatch(/Your keys, your XLM\./);
    expect(text).toMatch(/Quasaria never holds your keys or your XLM when you trade/);
    expect(NONCUSTODIAL_NOTE).toMatch(/you sign every transaction yourself/);
    expect(text).toMatch(/Create a new keypair/);
    expect(text).toMatch(/Sign in with a secret key/);
    expect(text).not.toMatch(/extension|connect (a )?wallet|Freighter/i);
  });
});
