/**
 * Optional anchor on/off-ramp for the Lend page, against the SDF TEST anchor only.
 *   SEP-1  : discover endpoints from https://testanchor.stellar.org/.well-known/stellar.toml
 *   SEP-10 : web auth — fetch a challenge, verify it, sign it with the connected wallet, get a JWT
 *   SEP-24 : interactive deposit/withdraw popup (the anchor runs SEP-12 KYC inside it), then poll
 *   SEP-38 : indicative prices only (never used for collateral pricing)
 * SEP-10 is used only for this anchor session; the lending contract itself uses Soroban
 * require_auth and there is no Quasaria backend.
 */
import { Networks, TransactionBuilder, type Transaction } from "@stellar/stellar-sdk";

export const TEST_ANCHOR_DOMAIN = "testanchor.stellar.org";
/** Assets the test anchor serves that the Lend page cares about. */
export const ANCHOR_ASSETS = ["USDC", "SRT"] as const;
export type AnchorAsset = (typeof ANCHOR_ASSETS)[number];

export type AnchorToml = {
  WEB_AUTH_ENDPOINT?: string; TRANSFER_SERVER_SEP0024?: string; ANCHOR_QUOTE_SERVER?: string; SIGNING_KEY?: string; NETWORK_PASSPHRASE?: string;
  currencies: Array<{ code?: string; issuer?: string }>;
};

/** Minimal TOML reader for the SEP-1 fields we need (top-level strings + [[CURRENCIES]]). */
export function parseStellarToml(text: string): AnchorToml {
  const out: AnchorToml = { currencies: [] };
  let section: string | null = null;
  let cur: Record<string, string> | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\s+#.*$/, "").trim();
    if (!line || line.startsWith("#")) continue;
    const arr = line.match(/^\[\[(.+)\]\]$/);
    if (arr) { section = arr[1].trim(); cur = {}; if (section === "CURRENCIES") out.currencies.push(cur); continue; }
    const tbl = line.match(/^\[(.+)\]$/);
    if (tbl) { section = tbl[1].trim(); cur = null; continue; }
    const kv = line.match(/^([A-Za-z0-9_]+)\s*=\s*"(.*)"$/);
    if (!kv) continue;
    if (section === null) (out as Record<string, unknown>)[kv[1]] = kv[2];
    else if (section === "CURRENCIES" && cur) cur[kv[1]] = kv[2];
  }
  return out;
}

type F = typeof fetch;
const json = async (r: Response) => {
  const b = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((b as { error?: string }).error ?? `HTTP ${r.status}`);
  return b;
};

export async function loadAnchor(domain = TEST_ANCHOR_DOMAIN, f: F = fetch): Promise<AnchorToml> {
  const r = await f(`https://${domain}/.well-known/stellar.toml`);
  if (!r.ok) throw new Error(`stellar.toml HTTP ${r.status}`);
  const t = parseStellarToml(await r.text());
  if (t.NETWORK_PASSPHRASE && t.NETWORK_PASSPHRASE !== Networks.TESTNET) throw new Error("anchor is not on testnet");
  return t;
}

/** SEP-24 /info: which of our assets can be deposited / withdrawn. */
export async function sep24Info(toml: AnchorToml, f: F = fetch) {
  if (!toml.TRANSFER_SERVER_SEP0024) throw new Error("anchor has no SEP-24 server");
  return (await json(await f(`${toml.TRANSFER_SERVER_SEP0024}/info`))) as { deposit: Record<string, { enabled: boolean; min_amount?: number; max_amount?: number }>; withdraw: Record<string, { enabled: boolean }> };
}

/**
 * Verify a SEP-10 challenge before signing: server-signed sequence 0 tx whose first op is a
 * manageData "<domain> auth" op sourced from the client account, within its time bounds.
 */
export function verifyChallenge(xdrStr: string, account: string, toml: AnchorToml, domain = TEST_ANCHOR_DOMAIN, now = Date.now() / 1000): Transaction {
  const tx = TransactionBuilder.fromXDR(xdrStr, Networks.TESTNET) as Transaction;
  if (tx.sequence !== "0") throw new Error("SEP-10: challenge sequence must be 0");
  if (toml.SIGNING_KEY && tx.source !== toml.SIGNING_KEY) throw new Error("SEP-10: challenge not from the anchor's SIGNING_KEY");
  const op = tx.operations[0] as { type: string; source?: string; name?: string };
  if (!op || op.type !== "manageData" || op.source !== account || op.name !== `${domain} auth`) throw new Error("SEP-10: unexpected challenge operation");
  if (tx.operations.some((o) => o.type !== "manageData")) throw new Error("SEP-10: challenge has non-manageData operations");
  const tb = tx.timeBounds;
  if (!tb || Number(tb.minTime) > now + 60 || Number(tb.maxTime) < now) throw new Error("SEP-10: challenge expired");
  return tx;
}

export async function sep10Token(toml: AnchorToml, account: string, sign: (xdr: string) => Promise<string>, f: F = fetch): Promise<string> {
  if (!toml.WEB_AUTH_ENDPOINT) throw new Error("anchor has no SEP-10 endpoint");
  const ch = (await json(await f(`${toml.WEB_AUTH_ENDPOINT}?account=${account}`))) as { transaction: string };
  verifyChallenge(ch.transaction, account, toml);
  const signed = await sign(ch.transaction);
  const tok = (await json(await f(toml.WEB_AUTH_ENDPOINT, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ transaction: signed }) }))) as { token: string };
  if (!tok.token) throw new Error("SEP-10: no token");
  return tok.token;
}

export type Sep24Start = { type: string; url: string; id: string };
export async function sep24Interactive(toml: AnchorToml, token: string, kind: "deposit" | "withdraw", asset: AnchorAsset, account: string, f: F = fetch): Promise<Sep24Start> {
  const body = new FormData();
  body.set("asset_code", asset);
  body.set("account", account);
  body.set("lang", "en");
  return (await json(await f(`${toml.TRANSFER_SERVER_SEP0024}/transactions/${kind}/interactive`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body }))) as Sep24Start;
}

export type Sep24Tx = { id: string; status: string; kind?: string; amount_in?: string; amount_out?: string; message?: string; more_info_url?: string; stellar_transaction_id?: string };
export async function sep24Status(toml: AnchorToml, token: string, id: string, f: F = fetch): Promise<Sep24Tx> {
  const r = (await json(await f(`${toml.TRANSFER_SERVER_SEP0024}/transaction?id=${encodeURIComponent(id)}`, { headers: { Authorization: `Bearer ${token}` } }))) as { transaction: Sep24Tx };
  return r.transaction;
}
export const TERMINAL = new Set(["completed", "refunded", "expired", "error", "no_market", "too_small", "too_large"]);

/** SEP-38 indicative prices for selling `amount` USD (null if unsupported). */
export async function sep38Indicative(toml: AnchorToml, amount: number, f: F = fetch): Promise<Array<{ asset: string; price: string }> | null> {
  if (!toml.ANCHOR_QUOTE_SERVER) return null;
  try {
    const r = (await json(await f(`${toml.ANCHOR_QUOTE_SERVER}/prices?sell_asset=iso4217:USD&sell_amount=${amount}`))) as { buy_assets?: Array<{ asset: string; price: string }> };
    return r.buy_assets ?? null;
  } catch {
    return null;
  }
}
