/**
 * Quasaria bot CLI (TESTNET ONLY).
 *
 *   npm run paper                                  # simulated vault + random-walk prices
 *   npm start -- --config my.json --mode paper --ticks 1000
 *   npm run keeper                                 # live liquidation/SL-TP keeper (needs .env)
 *   npm start -- --config my.json --mode live      # live strategies via delegated operator key
 */
import { readFileSync, existsSync } from "node:fs";
import { parseConfig } from "./config.js";
import { BotEngine, randomWalk } from "./engine.js";
import { PaperVault } from "./exchange.js";
import { runKeeperOnce } from "./keeper.js";
import { SorobanVault } from "./soroban.js";

function arg(name: string, def?: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

function loadEnv() {
  if (!existsSync(".env")) return;
  for (const line of readFileSync(".env", "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

async function main() {
  loadEnv();
  const cfgPath = arg("config", "quasaria-bot.config.example.json")!;
  const cfg = parseConfig(JSON.parse(readFileSync(cfgPath, "utf8")));
  const mode = arg("mode", "paper") ?? "paper";
  console.log(`Quasaria bot · ${mode.toUpperCase()} · TESTNET · ${cfg.strategies.length} strategies`);
  console.log("⚠  Unaudited software. Leverage can wipe out your margin. Not financial advice.\n");

  if (mode === "paper" && !flag("keeper-only")) {
    const vault = new PaperVault({ liquidity: 1_000_000, maxLeverage: cfg.risk.maxLeverage });
    const owner = "PAPER_OWNER";
    const equity = Number(arg("equity", "10000"));
    vault.deposit(owner, equity);
    const engine = new BotEngine(cfg, vault, owner, equity);
    const assets = [...new Set(cfg.strategies.map((s) => s.asset))];
    const ticks = Number(arg("ticks", "500"));
    for (const t of randomWalk(0.12, ticks, 0.006, Number(arg("seed", "7")))) {
      vault.now = t.time;
      for (const a of assets) {
        vault.setPrice(a, t.price);
        await engine.tick(a, t);
      }
      if (cfg.keeper.enabled) await runKeeperOnce(vault, () => void 0);
    }
    const open = await vault.positions(owner);
    const counts = engine.events.reduce<Record<string, number>>((m, e) => ((m[e.type] = (m[e.type] ?? 0) + 1), m), {});
    for (const e of engine.events.slice(-12)) console.log(`${new Date(e.time * 1000).toISOString()} [${e.type}] ${e.strategyId ?? ""} ${e.detail}`);
    console.log("\nsummary:", { ...counts, realizedPnl: +engine.realizedPnl.toFixed(4), openPositions: open.length, freeCollateral: +vault.freeCollateral(owner).toFixed(4) });
    return;
  }

  const need = ["QUASARIA_RPC_URL", "QUASARIA_VAULT_ID", "QUASARIA_ORACLE_ID", "QUASARIA_SECRET"];
  const missing = need.filter((k) => !process.env[k]);
  if (missing.length) throw new Error(`live mode needs env: ${missing.join(", ")} (see .env.example)`);
  if ((process.env.QUASARIA_NETWORK ?? "testnet") !== "testnet") throw new Error("QUASARIA_NETWORK must be testnet");
  const live = new SorobanVault({
    rpcUrl: process.env.QUASARIA_RPC_URL!, vaultId: process.env.QUASARIA_VAULT_ID!, oracleId: process.env.QUASARIA_ORACLE_ID!,
    secret: process.env.QUASARIA_SECRET!, owner: process.env.QUASARIA_OWNER,
  });
  await live.assertTestnet();

  if (flag("keeper-only")) {
    console.log(`keeper: sweeping every ${cfg.keeper.intervalSec}s`);
    for (;;) {
      await runKeeperOnce(live).catch((e) => console.error("keeper sweep failed:", e.message));
      await new Promise((r) => setTimeout(r, cfg.keeper.intervalSec * 1000));
    }
  }

  const owner = process.env.QUASARIA_OWNER!;
  if (!owner) throw new Error("QUASARIA_OWNER required for live strategies");
  const engine = new BotEngine(cfg, live, owner, Number(arg("equity", "1000")));
  const assets = [...new Set(cfg.strategies.map((s) => s.asset))];
  let seen = 0;
  for (;;) {
    for (const a of assets) {
      try {
        const price = await live.price(a);
        await engine.tick(a, { time: Math.floor(Date.now() / 1000), price });
      } catch (e) {
        console.error(`tick ${a} failed:`, (e as Error).message);
      }
    }
    for (const e of engine.events.slice(seen)) console.log(`[${e.type}] ${e.strategyId ?? ""} ${e.detail}`);
    seen = engine.events.length;
    if (cfg.keeper.enabled) await runKeeperOnce(live).catch(() => void 0);
    await new Promise((r) => setTimeout(r, cfg.keeper.intervalSec * 1000));
  }
}

main().catch((e) => {
  console.error("fatal:", e instanceof Error ? e.message : e);
  process.exit(1);
});
