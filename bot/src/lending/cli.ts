/**
 * Lending keeper + oracle feed CLI (TESTNET ONLY).
 *
 *   npm run lending-keeper                 # sweep every 60 s; executes liquidations on testnet
 *   npm run lending-keeper -- --once       # one sweep
 *   npm run lending-keeper -- --dry-run    # plan only, never sends a transaction
 *   npm run oracle-feed -- --once          # refresh all 42 mock-oracle prices from mainnet Horizon
 *   npm run oracle-feed                    # full refresh every --interval s (default 300) AND a fast XLM/USD loop:
 *                                          # polls Coinbase/Kraken/Bitstamp every --poll-interval s (2), needs >= 2 to
 *                                          # agree within --max-source-spread % (0.5), pushes on a move >= --dev-trigger %
 *                                          # (0.12) from the last push or every --fast-interval s (20 heartbeat); the perps
 *                                          # vault rejects prices older than max_price_age (90 s). --fast-interval 0 = off.
 *   Stale guard: nothing is pushed when XLM/USD falls back to the cached snapshot or deviates > 1.5 % from an
 *   independent reference (Coinbase XLM-USD); snapshot-priced assets are skipped in full refreshes.
 *
 * Keys: QUASARIA_SECRET (liquidator) / QUASARIA_ORACLE_SECRET (oracle admin) from the env or
 * bot/.env, or --identity <name> to read one from the local stellar CLI keystore in-process
 * (never printed). Without a key the keeper runs dry. Liquidations are only ever SENT when the
 * RPC reports the testnet passphrase; anything else is dry-run (and the feed refuses).
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Keypair, Networks, rpc } from "@stellar/stellar-sdk";
import { crossCheck, decideFastPush, decideXlmPush, feedAssetsFrom, fetchUsdPrices, fetchXlmSources, fetchXlmUsdFast, filterFreshPrices, toOracleInt } from "./prices.js";
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
    // liveness for scripts/oracle-feed.sh: epoch seconds of the last successful on-chain XLM push (no secrets, no prices)
    const hbFile = process.env.ORACLE_FEED_HEARTBEAT ?? resolve(root, "bot/state/oracle-feed.heartbeat");
    const beat = () => {
      try {
        mkdirSync(dirname(hbFile), { recursive: true });
        writeFileSync(hbFile, String(Math.floor(Date.now() / 1000)));
      } catch { /* best effort */ }
    };
    // record why the process ends (a silent exit left no trace on Oct 10, 2026)
    process.on("exit", (code) => console.error(`oracle-feed: process exiting (code ${code}) at ${new Date().toISOString()}`));
    for (const sig of ["SIGTERM", "SIGINT", "SIGHUP"] as const)
      process.on(sig, () => (console.error(`oracle-feed: received ${sig} at ${new Date().toISOString()}`), process.exit(128 + (sig === "SIGHUP" ? 1 : sig === "SIGINT" ? 2 : 15))));
    process.on("unhandledRejection", (e) => console.error("oracle-feed: unhandled rejection:", e instanceof Error ? e.message : e));
    const kp = keyFrom("QUASARIA_ORACLE_SECRET");
    if (!kp && !flag("dry-run")) throw new Error("oracle-feed needs QUASARIA_ORACLE_SECRET or --identity (oracle admin)");
    const c = new SorobanClient(rpcUrl, kp ?? Keypair.random());
    await c.assertTestnet();
    const feed = feedAssetsFrom(assetsDoc);
    const every = Number(arg("interval", "300")) * 1000;
    const heartbeatSec = Number(arg("fast-interval", "20")); // XLM heartbeat; 0 = fast loop off
    const pollMs = Number(arg("poll-interval", "2")) * 1000;
    const devPct = Number(arg("dev-trigger", "0.12"));
    const maxSpread = Number(arg("max-source-spread", "0.5"));
    const xlm = feed.find((a) => !a.mainnet);
    const fast = heartbeatSec > 0 && !!xlm;
    type Full = Awaited<ReturnType<typeof fetchUsdPrices>>;
    let lastFull = 0, lastPushed: number | null = null, lastPushAt = 0, pendingJump: number | null = null;
    let fullJob: Promise<Full | null> | null = null, fullReady: Full | null = null;
    let lastSdexCheck = 0, lastFlag = 0, lastSummary = Date.now();
    const stats = { deviation: 0, heartbeat: 0, first: 0, skipped: 0, failed: 0 };
    const flagOnce = (msg: string) => {
      if (Date.now() - lastFlag > 30_000) (lastFlag = Date.now()), console.error(`oracle-feed: FLAG ${msg}`);
    };
    const pushFull = async (r: Full) => {
      const bySource = r.prices.reduce<Record<string, number>>((m, p) => ((m[p.source.split(" ")[0]] = (m[p.source.split(" ")[0]] ?? 0) + 1), m), {});
      console.log(`oracle-feed: ${r.prices.length} prices, XLM $${r.usdPerXlm.toFixed(5)} (${r.usdSource}), sources ${JSON.stringify(bySource)}`);
      if (flag("verbose")) for (const p of r.prices) console.log(`  ${p.id.padEnd(7)} $${p.usd.toPrecision(6).padStart(12)}  ${p.source}`);
      const { fresh, skipped, refused } = filterFreshPrices(r.prices, r.usdSource);
      if (refused) return console.error(`oracle-feed: ${refused}`);
      if (skipped.length) console.error(`oracle-feed: skipped snapshot-priced (stale) assets: ${skipped.join(", ")}`);
      // with the fast loop on, XLM/USD is owned by the cross-checked fast path (never overwritten by the slower single-source read)
      let batch = fast ? fresh.filter((p) => p.sac !== xlm!.sac) : fresh;
      // availability fallback (lending also reads XLM): if the fast path has not pushed for > 120 s, the full refresh may
      // carry the live SDEX XLM price, still behind the snapshot / reference-deviation / jump guard
      if (fast && Date.now() / 1000 - lastPushAt > 120) {
        const q = await fetchXlmUsdFast().catch(() => null);
        const d = q ? decideXlmPush({ ...q, lastPushed, pendingJump: null }) : { push: false as const, reason: "SDEX read failed" };
        if (q && d.push) {
          batch = [...batch, { id: xlm!.id, sac: xlm!.sac, usd: q.usd!, source: q.source }];
          (lastPushed = q.usd), (lastPushAt = Date.now() / 1000);
          console.error(`oracle-feed: FLAG fast XLM path stale > 120 s; full refresh carries SDEX XLM $${q.usd!.toFixed(5)} (ref ${q.reference?.toFixed(5) ?? "n/a"})`);
        } else console.error(`oracle-feed: FLAG fast XLM path stale > 120 s and fallback refused: ${"reason" in d ? d.reason : ""}`);
      }
      if (!flag("dry-run") && batch.length) {
        await pushPrices(c, oracleId, batch.map((p) => ({ sac: p.sac, price: toOracleInt(p.usd) })));
        if (!fast) (lastPushed = r.usdPerXlm), (lastPushAt = Date.now() / 1000);
        if (!fast || batch.some((p) => p.sac === xlm!.sac)) beat();
        console.log(`oracle-feed: pushed ${batch.length} to ${oracleId} at ${new Date().toISOString()}`);
      }
    };
    for (;;) {
      const t0 = Date.now();
      // 1) full 42-asset refresh: prices are fetched in the background; the push is serialized with the fast pushes (one signer)
      if (!fullJob && !fullReady && t0 - lastFull >= every) {
        lastFull = t0;
        fullJob = fetchUsdPrices(feed, { snapshotUsdPerXlm: assetsDoc.mainnetSource.usdPerXlm }).catch((e) => (console.error("oracle-feed: refresh failed:", (e as Error).message), null));
        void fullJob.then((r) => ((fullReady = r), (fullJob = null)));
        if (!fast) await fullJob;
      }
      // 2) fast XLM/USD: independent venues, cross-check, deviation trigger + heartbeat
      if (fast) {
        try {
          const q = await fetchXlmSources();
          const x = crossCheck(q, maxSpread, 2);
          if (x.outliers.length) flagOnce(`source outlier(s) beyond ${maxSpread}%: ${x.outliers.join("; ")}`);
          if (!x.ok) {
            stats.skipped++;
            flagOnce(`XLM push skipped: ${x.reason}`);
          } else {
            const now = Date.now() / 1000;
            const d = decideFastPush({ usd: x.usd, lastPushed, lastPushAt, now, pendingJump }, devPct, heartbeatSec);
            pendingJump = d.pendingJump;
            if (!d.push && d.reason !== "within band") (stats.skipped++, flagOnce(`XLM push held: ${d.reason}`));
            if (d.push && !flag("dry-run")) {
              await pushPrices(c, oracleId, [{ sac: xlm!.sac, price: toOracleInt(x.usd) }]);
              (lastPushed = x.usd), (lastPushAt = now), stats[d.why]++;
              beat();
              if (flag("verbose") || d.why === "deviation") console.log(`oracle-feed: ${d.why} push XLM $${x.usd.toFixed(5)} (${d.movePct.toFixed(3)}% move; ${x.used.join("+")}) at ${new Date().toISOString()}`);
            } else if (d.push) console.log(`oracle-feed: dry-run would push XLM $${x.usd.toFixed(5)} (${d.why}; ${x.used.join("+")})`);
            // advisory 4th source: mainnet SDEX USDC mid, once a minute (Horizon rate limits)
            if (now - lastSdexCheck >= 60) {
              lastSdexCheck = now;
              const s = await fetchXlmUsdFast().catch(() => null);
              if (s?.usd && Math.abs(s.usd - x.usd) / x.usd > 0.015) flagOnce(`mainnet SDEX USDC mid ${s.usd.toFixed(5)} is ${((s.usd / x.usd - 1) * 100).toFixed(2)}% from the CEX price ${x.usd.toFixed(5)}`);
            }
          }
        } catch (e) {
          stats.failed++;
          console.error("oracle-feed: fast push failed:", (e as Error).message);
        }
      }
      if (fullReady) {
        const r = fullReady;
        fullReady = null;
        await pushFull(r).catch((e) => console.error("oracle-feed: full push failed:", (e as Error).message));
      }
      if (Date.now() - lastSummary >= 300_000) {
        lastSummary = Date.now();
        console.log(`oracle-feed: last 5 min XLM pushes deviation ${stats.deviation}, heartbeat ${stats.heartbeat}, skipped ${stats.skipped}, failed ${stats.failed}; last $${lastPushed?.toFixed(5) ?? "n/a"} ${Math.round(Date.now() / 1000 - lastPushAt)}s ago`);
        (stats.deviation = 0), (stats.heartbeat = 0), (stats.skipped = 0), (stats.failed = 0), (stats.first = 0);
      }
      if (flag("once") || flag("dry-run")) {
        if (fullJob) await fullJob.then(() => fullReady && pushFull(fullReady));
        return;
      }
      await sleep(Math.max(250, (fast ? pollMs : every) - (Date.now() - t0)));
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
