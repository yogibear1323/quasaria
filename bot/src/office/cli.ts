/**
 * Back Office CLI (TESTNET only).
 *   office run [--paper | --dry-run] [--once] [--publish] [--admin-port 52610]
 *   office status
 *   office pause|resume|flatten|halt|reset <desk|all>
 *   office kill [reason...]      # global kill: closes all fleet positions, blocks entries
 *   office unkill
 *   office revoke <desk|all>     # owner revokes the bot operator key (emergency, on-chain)
 *   office setup [--issuer quasaria-admin] [--only vega,rigel]
 *   office backtest [--days 120] [--save]
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { backtest, toBaseline } from "./backtest.js";
import { loadOfficeConfig } from "./config.js";
import { loadDeployment } from "./deployment.js";
import type { Baseline } from "./drift.js";
import { Fleet, type RunMode } from "./fleet.js";
import { deskKeys } from "./keys.js";
import { PublicReferenceFeed } from "./marketData.js";
import { StatusPublisher } from "./publisher.js";
import { startAdmin } from "./admin.js";
import { officeHome, Store, type Command } from "./store.js";
import { PaperOfficeVenue, SorobanOfficeVenue, type DeskKeys, type OfficeVenue } from "./venue.js";

const BASELINES = fileURLToPath(new URL("../../office.baselines.json", import.meta.url));
const argv = process.argv.slice(2);
const flag = (n: string) => argv.includes(`--${n}`);
const opt = (n: string, d?: string) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 ? argv[i + 1] : d;
};
const ts = () => new Date().toISOString().replace("T", " ").slice(0, 19) + "Z";
const log = (m: string) => console.log(`${ts()} ${m}`);

export function loadBaselines(): Record<string, Baseline> {
  return existsSync(BASELINES) ? (JSON.parse(readFileSync(BASELINES, "utf8")).desks as Record<string, Baseline>) : {};
}

/** Paper fills against the LIVE testnet oracle/funding state. */
class PaperOnLive extends PaperOfficeVenue {
  constructor(private readonly live: SorobanOfficeVenue) {
    super();
  }
  override async market() {
    const m = await this.live.market();
    this.price = m.oraclePrice;
    this.priceTs = m.oracleTs;
    const mine = await super.market();
    return { ...m, longOi: m.longOi + mine.longOi, shortOi: m.shortOi + mine.shortOi };
  }
}

async function runFleet() {
  const cfg = loadOfficeConfig(opt("config"));
  const dep = loadDeployment();
  const mode: RunMode = flag("paper") ? "paper" : flag("dry-run") ? "dry-run" : "live";
  const live = new SorobanOfficeVenue({ rpcUrl: dep.rpcUrl, vaultId: dep.contracts.vault, oracleId: dep.contracts.oracle, marketAsset: dep.vault.marketAsset });
  await live.assertTestnet();
  let venue: OfficeVenue = live;
  let keys: Record<string, DeskKeys> = deskKeys();
  const home = mode === "live" ? officeHome() : join(officeHome(), mode);
  if (mode === "paper") {
    const p = new PaperOnLive(live);
    keys = Object.fromEntries(cfg.desks.map((d) => [d.id, { owner: `PAPER_${d.id.toUpperCase()}`, operatorSecret: "" }]));
    for (const d of cfg.desks) p.deposit(keys[d.id].owner, d.capital);
    venue = p;
  } else {
    const missing = cfg.desks.filter((d) => !keys[d.id]).map((d) => d.id);
    if (missing.length) throw new Error(`no keys for desks: ${missing.join(", ")} (run: office setup)`);
  }
  const store = new Store(join(home, "state"));
  const fleet = new Fleet(cfg, venue, keys, store, new PublicReferenceFeed(), { mode, baselines: loadBaselines(), log, vaultId: dep.contracts.vault });
  log(`Back Office fleet · ${mode.toUpperCase()} · TESTNET · vault ${dep.contracts.vault} · ${cfg.desks.length} desks · drift ${fleet.driftMode(Date.now() / 1000)}`);
  log("Unaudited testnet software, test funds only. No expected or guaranteed returns.");
  const publisher = flag("publish") && mode === "live" ? new StatusPublisher() : null;
  const publishSec = Number(opt("publish-sec", "300"));
  const adminPort = opt("admin-port");
  if (adminPort) {
    startAdmin(store, Number(adminPort), () => fleet.lastStatus ?? (existsSync(join(store.dir, "status.json")) ? JSON.parse(readFileSync(join(store.dir, "status.json"), "utf8")) : null));
    log(`admin page: http://127.0.0.1:${adminPort}/ (local only)`);
  }
  let lastPub = 0;
  for (;;) {
    const t0 = Date.now();
    try {
      const st = await fleet.step();
      writeFileSync(join(store.dir, "heartbeat"), String(Math.floor(Date.now() / 1000)));
      if (st) {
        const f = (st as { fleet: { status: string; equity: number; pnlToday: number; openPositions: number; riskUsedPct: number } }).fleet;
        log(`tick: fleet ${f.status} equity ${f.equity.toFixed(2)} today ${f.pnlToday.toFixed(2)} open ${f.openPositions} risk ${f.riskUsedPct.toFixed(2)}%`);
      }
      if (publisher && st && Date.now() - lastPub >= publishSec * 1000) {
        lastPub = Date.now();
        publisher.publish(st).then((ok) => ok ? log("status published to bot-status branch") : publisher.lastError && log(`status publish failed: ${publisher.lastError}`));
      }
    } catch (e) {
      log(`step failed: ${(e as Error).stack ?? e}`);
    }
    if (flag("once")) break;
    // sleep, but react to a KILL flag within ~5 s
    const until = t0 + cfg.loopSec * 1000;
    while (Date.now() < until) {
      await new Promise((r) => setTimeout(r, 5000));
      if (store.killFlag() && !(fleet.lastStatus as { fleet?: { status?: string } } | null)?.fleet?.status?.startsWith("killed")) break;
    }
  }
}

async function main() {
  const cmd = argv[0];
  const store = () => new Store(join(flag("paper") ? join(officeHome(), "paper") : flag("dry-run") ? join(officeHome(), "dry-run") : officeHome(), "state"));
  switch (cmd) {
    case "run":
      return runFleet();
    case "status": {
      const p = join(store().dir, "status.json");
      if (!existsSync(p)) return console.log("no status yet");
      const s = JSON.parse(readFileSync(p, "utf8"));
      console.log(`${s.generatedAt} fleet ${s.fleet.status} ${s.fleet.reason ?? ""} equity ${s.fleet.equity} today ${s.fleet.pnlToday} risk ${s.fleet.riskUsedPct}% oracle ${s.market.oraclePrice} (${s.market.oracleLevel}, age ${s.market.oracleAgeSec}s, dev ${s.market.deviationPct}%)`);
      for (const d of s.desks) console.log(`  ${d.name.padEnd(6)} ${d.strategy.padEnd(8)} ${d.status.padEnd(8)} eq ${String(d.equity).padEnd(9)} open ${d.open.length} drift ${d.drift?.score ?? "-"} ${d.reason || ""} | ${d.lastSignal}`);
      return;
    }
    case "pause": case "resume": case "flatten": case "halt": case "reset": {
      const desk = argv[1];
      if (!desk) throw new Error(`usage: office ${cmd} <desk|all>`);
      store().enqueue({ cmd, desk, by: "cli" } as Command);
      return console.log(`queued ${cmd} ${desk} (applied on the next loop, <= 60 s)`);
    }
    case "kill": {
      const reason = argv.slice(1).filter((a) => !a.startsWith("--")).join(" ") || "manual kill (cli)";
      const s = store();
      s.setKillFlag(reason);
      s.enqueue({ cmd: "kill", reason, by: "cli" });
      return console.log(`KILL set: ${reason} — the runner closes all fleet positions within ~5 s and blocks entries until 'office unkill'`);
    }
    case "unkill": {
      const s = store();
      s.clearKillFlag();
      s.enqueue({ cmd: "unkill", by: "cli" });
      return console.log("kill cleared (halted desks stay halted until 'office reset <desk>')");
    }
    case "revoke": {
      const { revokeOperators } = await import("./setup.js");
      return revokeOperators(argv[1] === "all" || !argv[1] ? "all" : argv[1].split(","));
    }
    case "setup": {
      const { setupDesks } = await import("./setup.js");
      const r = await setupDesks(loadOfficeConfig(opt("config")), { issuerIdentity: opt("issuer", "quasaria-admin")!, only: opt("only")?.split(",") });
      return console.log(JSON.stringify(r, null, 1));
    }
    case "backtest": {
      const cfg = loadOfficeConfig(opt("config"));
      const feed = new PublicReferenceFeed();
      const now = Math.floor(Date.now() / 1000);
      const days = Number(opt("days", "120"));
      const out: Record<string, Baseline> = {};
      const summary: Record<string, unknown> = {};
      const cache = new Map<number, Awaited<ReturnType<typeof feed.history>>>();
      for (const d of cfg.desks) {
        if (d.strategy === "funding") {
          summary[d.id] = "no OI history to backtest funding capture; statistical drift tests disabled, D-4..D-8 apply";
          continue;
        }
        const span = d.timeframeSec === 900 ? Math.min(days, 45) : days;
        if (!cache.has(d.timeframeSec)) cache.set(d.timeframeSec, await feed.history(d.timeframeSec, now - span * 86_400, now));
        const bars = cache.get(d.timeframeSec)!;
        const r = backtest(d, bars, cfg.limits, d.capital);
        out[d.id] = toBaseline(r, `coinbase XLM-USD ${d.timeframeSec}s bars, ${r.days.toFixed(0)} days, generated ${new Date().toISOString()}`);
        summary[d.id] = { trades: r.trades.length, winRate: +r.winRate.toFixed(3), payoff: +r.payoff.toFixed(2), totalR: +r.totalR.toFixed(2), maxDrawdownPct: +r.maxDrawdownPct.toFixed(2), endEquity: +r.endEquity.toFixed(2), tradesPerDayP95: r.tradesPerDayP95 };
      }
      console.log(JSON.stringify(summary, null, 1));
      if (flag("save")) {
        writeFileSync(BASELINES, JSON.stringify({ note: "Drift baselines from historical backtests (illustrative; past behaviour, not a forecast).", generatedAt: new Date().toISOString(), desks: out }, null, 1) + "\n");
        console.log(`saved ${BASELINES}`);
      }
      return;
    }
    default:
      console.log(readFileSync(fileURLToPath(import.meta.url), "utf8").split("*/")[0]);
  }
}

main().catch((e) => {
  console.error("office:", e instanceof Error ? e.message : e);
  process.exit(1);
});
