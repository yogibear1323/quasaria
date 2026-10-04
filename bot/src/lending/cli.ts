/**
 * Lending keeper + oracle feed CLI (TESTNET ONLY).
 *
 *   npm run lending-keeper                 # sweep every 60 s; executes liquidations on testnet
 *   npm run lending-keeper -- --once       # one sweep
 *   npm run lending-keeper -- --dry-run    # plan only, never sends a transaction
 *   npm run oracle-feed -- --once          # refresh all 42 mock-oracle prices from mainnet Horizon
 *   npm run oracle-feed                    # full refresh every --interval s (default 300) AND a fast XLM/USD push
 *                                          # (perps market) every --fast-interval s (default 20); the perps vault
 *                                          # rejects prices older than its max_price_age (90 s). --fast-interval 0 = off.
 *   Stale guard: nothing is pushed when XLM/USD falls back to the cached snapshot or deviates > 1.5 % from an
 *   independent reference (Coinbase XLM-USD); snapshot-priced assets are skipped in full refreshes.
 *
 * Keys: QUASARIA_SECRET (liquidator) / QUASARIA_ORACLE_SECRET (oracle admin) from the env or
 * bot/.env, or --identity <name> to read one from the local stellar CLI keystore in-process
 * (never printed). Without a key the keeper runs dry. Liquidations are only ever SENT when the
 * RPC reports the testnet passphrase; anything else is dry-run (and the feed refuses).
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Keypair, Networks, rpc } from "@stellar/stellar-sdk";
import { decideXlmPush, feedAssetsFrom, fetchUsdPrices, fetchXlmUsdFast, filterFreshPrices, toOracleInt } from "./prices.js";
import { runLendingKeeperOnce } from "./keeper.js";
import { SorobanClient, SorobanLending, pushPrices } from "./soroban.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const arg = (n: string, d?: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : d;
};
const flag = (n: string) => process.argv.includes(`--${n}`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function loadEnv() {
  const p = resolve(root, "bot/.env");
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}
function keyFrom(envName: string): Keypair | null {
  const id = arg("identity");
  if (id) return Keypair.fromSecret(execFileSync("stellar", ["keys", "show", id], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim());
  const s = process.env[envName];
  return s ? Keypair.fromSecret(s) : null;
}

async function main() {
  loadEnv();
  const dep = JSON.parse(readFileSync(resolve(root, "deployments/testnet.json"), "utf8"));
  const assetsDoc = JSON.parse(readFileSync(resolve(root, "deployments/testnet-assets.json"), "utf8"));
  if (dep.network !== "testnet") throw new Error("TESTNET ONLY");
  if ((process.env.QUASARIA_NETWORK ?? "testnet") !== "testnet") throw new Error("QUASARIA_NETWORK must be testnet");
  const rpcUrl = process.env.QUASARIA_RPC_URL ?? dep.rpcUrl;
  const oracleId = dep.contracts.oracle as string;
  const poolId = (arg("pool") ?? dep.contracts.lending) as string | undefined;
  const mode = process.argv[2];

  if (mode === "oracle-feed") {
    const kp = keyFrom("QUASARIA_ORACLE_SECRET");
    if (!kp && !flag("dry-run")) throw new Error("oracle-feed needs QUASARIA_ORACLE_SECRET or --identity (oracle admin)");
    const c = new SorobanClient(rpcUrl, kp ?? Keypair.random());
    await c.assertTestnet();
    const feed = feedAssetsFrom(assetsDoc);
    const every = Number(arg("interval", "300")) * 1000;
    const fastEvery = Number(arg("fast-interval", "20")) * 1000;
    const xlm = feed.find((a) => !a.mainnet);
    let lastFull = 0, lastPushed: number | null = null, pendingJump: number | null = null;
    for (;;) {
      const t0 = Date.now();
      if (t0 - lastFull >= every || !fastEvery) {
        lastFull = t0;
        try {
          const { prices, usdPerXlm, usdSource } = await fetchUsdPrices(feed, { snapshotUsdPerXlm: assetsDoc.mainnetSource.usdPerXlm });
          const bySource = prices.reduce<Record<string, number>>((m, p) => ((m[p.source.split(" ")[0]] = (m[p.source.split(" ")[0]] ?? 0) + 1), m), {});
          console.log(`oracle-feed: ${prices.length} prices, XLM $${usdPerXlm.toFixed(5)} (${usdSource}), sources ${JSON.stringify(bySource)}`);
          if (flag("verbose")) for (const p of prices) console.log(`  ${p.id.padEnd(7)} $${p.usd.toPrecision(6).padStart(12)}  ${p.source}`);
          const { fresh, skipped, refused } = filterFreshPrices(prices, usdSource);
          if (refused) console.error(`oracle-feed: ${refused}`);
          else if (skipped.length) console.error(`oracle-feed: skipped snapshot-priced (stale) assets: ${skipped.join(", ")}`);
          if (!flag("dry-run") && fresh.length) {
            await pushPrices(c, oracleId, fresh.map((p) => ({ sac: p.sac, price: toOracleInt(p.usd) })));
            if (usdSource !== "snapshot") lastPushed = usdPerXlm;
            console.log(`oracle-feed: pushed ${fresh.length} to ${oracleId} at ${new Date().toISOString()}`);
          }
        } catch (e) {
          console.error("oracle-feed: refresh failed:", (e as Error).message);
        }
      } else if (xlm) {
        try {
          const q = await fetchXlmUsdFast();
          const d = decideXlmPush({ ...q, lastPushed, pendingJump });
          if ("pendingJump" in d) pendingJump = d.pendingJump ?? null;
          if (!d.push) console.error(`oracle-feed: fast push skipped: ${d.reason}`);
          else if (!flag("dry-run")) {
            await pushPrices(c, oracleId, [{ sac: xlm.sac, price: toOracleInt(q.usd!) }]);
            lastPushed = q.usd;
            if (flag("verbose")) console.log(`oracle-feed: fast XLM $${q.usd!.toFixed(5)} (ref ${q.reference?.toFixed(5) ?? "n/a"}) at ${new Date().toISOString()}`);
          }
        } catch (e) {
          console.error("oracle-feed: fast push failed:", (e as Error).message);
        }
      }
      if (flag("once") || flag("dry-run")) return;
      await sleep(Math.max(1000, (fastEvery || every) - (Date.now() - t0)));
    }
  }

  if (mode === "lending-keeper") {
    if (!poolId) throw new Error("no lending pool id (deployments/testnet.json contracts.lending or --pool)");
    const kp = keyFrom("QUASARIA_SECRET");
    const c = new SorobanClient(rpcUrl, kp ?? Keypair.random());
    const net = await new rpc.Server(rpcUrl).getNetwork();
    const onTestnet = net.passphrase === Networks.TESTNET;
    const dryRun = flag("dry-run") || !kp || !onTestnet;
    if (!onTestnet) console.log("lending-keeper: RPC is not testnet: forcing dry-run");
    const codes: Record<string, string> = Object.fromEntries(feedAssetsFrom(assetsDoc).map((a) => [a.sac, a.id]));
    const venue = new SorobanLending(c, poolId, oracleId, codes);
    console.log(`lending-keeper: pool ${poolId} · ${dryRun ? "DRY-RUN" : `LIVE testnet as ${kp!.publicKey().slice(0, 6)}…`}`);
    for (;;) {
      const r = await runLendingKeeperOnce(venue, { dryRun }).catch((e) => {
        console.error("lending-keeper: sweep failed:", (e as Error).message);
        return [];
      });
      console.log(`lending-keeper: sweep done, ${r.length} candidate(s), ${r.filter((x) => x.executed && x.ok).length} liquidated`);
      if (flag("once") || flag("dry-run")) return;
      await sleep(Number(arg("interval", "60")) * 1000);
    }
  }
  throw new Error("usage: cli.ts oracle-feed|lending-keeper [--once] [--dry-run] [--identity name]");
}

main().catch((e) => {
  console.error("fatal:", e instanceof Error ? e.message : e);
  process.exit(1);
});
