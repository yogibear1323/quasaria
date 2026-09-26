#!/usr/bin/env node
/**
 * Build-time market snapshot (runs in the GitHub Pages workflow before `vite build`).
 *
 * stellarchain.io's API does not send CORS headers for github.io, so browsers on
 * the Pages site cannot read it. This script fetches exactly what the Markets
 * page, the landing cards and the XLM/USD ticker need and writes it to
 * public/data/stellarchain-snapshot.json, which Vite copies into the build.
 * The app tries the live API first and falls back to this file
 * ("snapshot, updated <time>").
 *
 * NEVER fails the build: on any error the previous (committed) snapshot is kept,
 * section by section, and the script exits 0.
 *
 *   node scripts/fetch-market-snapshot.mjs [outFile]
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const BASE = process.env.STELLARCHAIN_BASE || "https://api.stellarchain.io/v1";
const PER_NETWORK = Number(process.env.SNAPSHOT_ITEMS || 50);
const TIMEOUT_MS = Number(process.env.SNAPSHOT_TIMEOUT_MS || 20_000);
const here = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(process.argv[2] || resolve(here, "../public/data/stellarchain-snapshot.json"));

const log = (...a) => console.log("[market-snapshot]", ...a);

async function getJson(path, query) {
  const qs = new URLSearchParams(query).toString();
  const url = `${BASE}${path}?${qs}`;
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers: { Accept: "application/ld+json", "User-Agent": "quasaria-pages-build (+https://github.com/yogibear1323/quasaria)" }, signal: ctl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o?.[k] !== undefined).map((k) => [k, o[k]]));

/** Keep only the fields the frontend normalizers read (keeps the file small). */
export function trimAsset(a) {
  const toml = a.tomlInfo
    ? { ...pick(a.tomlInfo, ["image", "home_domain"]), ...(a.tomlInfo.documentation ? { documentation: pick(a.tomlInfo.documentation, ["ORG_NAME", "ORG_LOGO"]) } : {}) }
    : null;
  return {
    ...pick(a, ["assetKey", "code", "issuer", "network", "rankPosition", "priceXlm", "priceChange1h", "priceChange24h", "priceChange7d", "volumeXlm24h", "trades24h", "trustlinesTotal", "supply", "sparkline1h", "updatedAt", "imageUrl", "homeDomain"]),
    tomlInfo: toml,
  };
}

function readPrevious() {
  try {
    return JSON.parse(readFileSync(OUT, "utf8"));
  } catch {
    return null;
  }
}

async function main() {
  const prev = readPrevious();
  const next = { version: 1, source: BASE, generatedAt: prev?.generatedAt ?? null, overview: { ...(prev?.overview ?? {}) }, marketAssets: { ...(prev?.marketAssets ?? {}) } };
  let ok = 0;
  let failed = 0;

  try {
    const c = await getJson("/market/overview", { network: "mainnet", "order[recordedAt]": "desc", itemsPerPage: "1" });
    const m = c?.member?.[0];
    if (!m || typeof m.recordedAt !== "string") throw new Error("overview: empty response");
    next.overview.mainnet = { fetchedAt: new Date().toISOString(), data: pick(m, ["xlmPriceUsd", "xlmVolume24h", "totalTrades24h", "activeAssets24h", "trackedAssets", "totalAccounts", "totalContracts", "recordedAt"]) };
    ok++;
  } catch (e) {
    failed++;
    log(`WARN overview (mainnet) failed, keeping previous: ${e.message}`);
  }

  for (const network of ["testnet", "mainnet"]) {
    try {
      const c = await getJson("/market/assets", { network, itemsPerPage: String(PER_NETWORK) });
      if (!Array.isArray(c?.member) || c.member.length === 0) throw new Error("empty member list");
      next.marketAssets[network] = { fetchedAt: new Date().toISOString(), totalItems: c.totalItems ?? c.member.length, member: c.member.map(trimAsset) };
      ok++;
    } catch (e) {
      failed++;
      log(`WARN market assets (${network}) failed, keeping previous: ${e.message}`);
    }
  }

  if (ok === 0) {
    log(prev ? `all requests failed; keeping the committed snapshot from ${prev.generatedAt}` : "all requests failed and no previous snapshot exists; the app will show live data only");
    return;
  }
  next.generatedAt = new Date().toISOString();
  mkdirSync(dirname(OUT), { recursive: true });
  const tmp = `${OUT}.tmp`;
  writeFileSync(tmp, JSON.stringify(next) + "\n");
  renameSync(tmp, OUT);
  const n = Object.values(next.marketAssets).reduce((s, x) => s + (x?.member?.length ?? 0), 0);
  log(`wrote ${OUT} (${ok} ok, ${failed} failed; ${n} assets; generatedAt ${next.generatedAt})`);
}

main().catch((e) => {
  // Belt and braces: never break the Pages build over market data.
  log(`WARN unexpected error, keeping previous snapshot: ${e?.stack || e}`);
}).finally(() => process.exit(0));
