// Generate docs/stablecoin-pairs.json: XLM/stablecoin pairs auto-discovered
// from the stellarchain.io feed (see shared/stablecoins.ts), plus READ-ONLY
// mainnet Horizon snapshots of the native liquidity pool and SDEX top of book
// for each passing pair. Nothing is signed or submitted.
// Usage: node scripts/gen-stablecoin-pairs.ts [--network mainnet|testnet] [--out file] [--min-trustlines N] [--min-trades N]
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { discoverStablecoins, type StablecoinConfig, type VerifyCache } from "../shared/stablecoins.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const arg = (n: string, d?: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : d;
};
const network = (arg("network", "mainnet") as "mainnet" | "testnet");
const out = resolve(root, arg("out", network === "mainnet" ? "docs/stablecoin-pairs.json" : "docs/stablecoin-pairs.testnet.json")!);

// optional overrides: config/stablecoins.json { allow, deny, denyDomainPatterns, brandDomains, minTrustlines, minTrades24h }
const cfgFile = resolve(root, "config/stablecoins.json");
const overrides: Partial<StablecoinConfig> = existsSync(cfgFile) ? JSON.parse(readFileSync(cfgFile, "utf8")) : {};
if (arg("min-trustlines")) overrides.minTrustlines = Number(arg("min-trustlines"));
if (arg("min-trades")) overrides.minTrades24h = Number(arg("min-trades"));

// toml verification cache on disk (gitignored)
const cachePath = resolve(root, ".cache/stellar-toml.json");
mkdirSync(dirname(cachePath), { recursive: true });
const disk: Record<string, { at: number; currencies: { code: string; issuer: string }[] | null }> = existsSync(cachePath) ? JSON.parse(readFileSync(cachePath, "utf8")) : {};
const cache: VerifyCache = { get: (d) => disk[d], set: (d, v) => void (disk[d] = v) };

const res = await discoverStablecoins({ fetch }, { ...overrides, network }, { cache });
writeFileSync(cachePath, JSON.stringify(disk, null, 1));

// ---- read-only mainnet Horizon: native (protocol) liquidity pools + SDEX book
type Market = { nativePool: null | { id: string; reserveXlm: number; reserveStable: number; totalShares: number; feeBp: number; holders: number }; sdex: null | { bestBid: number | null; bestAsk: number | null } };
const markets: Record<string, Market> = {};
if (network === "mainnet") {
  const H = "https://horizon.stellar.org";
  for (const p of res.pairs.filter((x) => x.verified)) {
    const m: Market = { nativePool: null, sdex: null };
    const type = p.code.length <= 4 ? "credit_alphanum4" : "credit_alphanum12";
    try {
      const lp = (await (await fetch(`${H}/liquidity_pools?reserves=native,${p.code}:${p.issuer}&limit=5`)).json()) as { _embedded?: { records: { id: string; fee_bp: number; total_shares: string; total_trustlines: string; reserves: { asset: string; amount: string }[] }[] } };
      const rec = lp._embedded?.records.sort((a, b) => Number(b.total_shares) - Number(a.total_shares))[0];
      if (rec) {
        const x = rec.reserves.find((r) => r.asset === "native");
        const s = rec.reserves.find((r) => r.asset !== "native");
        m.nativePool = { id: rec.id, reserveXlm: Number(x?.amount ?? 0), reserveStable: Number(s?.amount ?? 0), totalShares: Number(rec.total_shares), feeBp: rec.fee_bp, holders: Number(rec.total_trustlines) };
      }
    } catch { /* leave null */ }
    try {
      const ob = (await (await fetch(`${H}/order_book?selling_asset_type=native&buying_asset_type=${type}&buying_asset_code=${p.code}&buying_asset_issuer=${p.issuer}&limit=1`)).json()) as { bids: { price: string }[]; asks: { price: string }[] };
      m.sdex = { bestBid: ob.bids[0] ? Number(ob.bids[0].price) : null, bestAsk: ob.asks[0] ? Number(ob.asks[0].price) : null };
    } catch { /* leave null */ }
    markets[p.assetKey] = m;
  }
}

const doc = {
  ...res,
  note: "Auto-generated. XLM vs each fiat-anchored stablecoin found in the stellarchain.io feed. 'verified' = issuer listed in its home domain's stellar.toml CURRENCIES. Mainnet market snapshots are read-only (Horizon). Review before use; not an endorsement.",
  pairs: res.pairs.map((p) => ({ ...p, pair: `XLM/${p.code}`, mainnet: markets[p.assetKey] ?? null })),
};
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(doc, null, 2) + "\n");
const v = res.pairs.filter((p) => p.verified);
console.log(`scanned ${res.scanned} assets (as of ${res.asOf}) → ${res.pairs.length} pairs (${v.length} verified, ${v.filter((p) => p.primary).length} primary), ${res.rejected.length} rejected`);
for (const p of res.pairs) console.log(`  ${p.verified ? "✔" : "?"} ${p.primary ? "★" : " "} XLM/${p.code.padEnd(7)} ${p.peg} ${String(p.domain).padEnd(28)} holders ${p.holders} trades ${p.trades24h} ${p.verification}${p.duplicate ? " (duplicate code)" : ""}`);
console.log("rejected:");
for (const r of res.rejected) console.log(`  ✘ ${r.code.padEnd(8)} ${String(r.domain).padEnd(28)} ${r.holders} — ${r.reasons.join("; ")}`);
console.log(`wrote ${out}`);
