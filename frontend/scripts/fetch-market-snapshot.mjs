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
/** Mainnet list size for the Markets tab (top N by stellarchain.io rank, topped up from stellar.expert). */
const MAINNET_TARGET = Number(process.env.SNAPSHOT_MAINNET_ITEMS || 1000);
const PAGE_SIZE = 200;
const EXPERT = process.env.STELLAR_EXPERT_BASE || "https://api.stellar.expert/explorer/public";
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
    ? {
        ...pick(a.tomlInfo, ["image", "home_domain", "name", "is_asset_anchored", "anchor_asset", "anchor_asset_type"]),
        // issuer-published text, kept verbatim (capped) for the About tab
        ...(typeof a.tomlInfo.desc === "string" ? { desc: a.tomlInfo.desc.slice(0, 1500) } : {}),
        ...(typeof a.tomlInfo.conditions === "string" ? { conditions: a.tomlInfo.conditions.slice(0, 1500) } : {}),
        ...(a.tomlInfo.documentation ? { documentation: pick(a.tomlInfo.documentation, ["ORG_NAME", "ORG_LOGO", "ORG_URL"]) } : {}),
      }
    : null;
  return {
    ...pick(a, ["assetKey", "code", "issuer", "network", "rankPosition", "priceXlm", "priceChange1h", "priceChange24h", "priceChange7d", "volumeXlm24h", "trades24h", "trustlinesTotal", "supply", "sparkline1h", "updatedAt", "imageUrl", "homeDomain"]),
    tomlInfo: toml,
  };
}

async function getExpert(path) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${EXPERT}${path}`, { headers: { Accept: "application/json", "User-Agent": "quasaria-pages-build" }, signal: ctl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${path}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

/** stellar.expert asset record -> the stellarchain shape the app reads (price in USD -> XLM via the overview rate). */
export function fromExpert(r, rank, xlmUsd) {
  const [code, issuer] = String(r.asset).split("-");
  const usd = Number(r.price);
  const ti = r.tomlInfo ?? {};
  return {
    assetKey: `${code}-${issuer}`, code, issuer, network: 1, rankPosition: rank,
    priceXlm: Number.isFinite(usd) && usd > 0 && Number(xlmUsd) > 0 ? String(usd / Number(xlmUsd)) : undefined,
    trustlinesTotal: r.trustlines?.total, supply: r.supply, homeDomain: r.domain,
    rankSource: "stellar.expert", updatedAt: new Date().toISOString(),
    tomlInfo: ti.code ? { ...pick(ti, ["image", "name", "anchor_asset", "anchor_asset_type"]), home_domain: r.domain, ...(ti.desc ? { desc: String(ti.desc).slice(0, 1500) } : {}), ...(ti.orgName ? { documentation: { ORG_NAME: ti.orgName } } : {}) } : null,
  };
}

/** Top MAINNET_TARGET mainnet assets: every page of stellarchain.io's ranked list, then stellar.expert (by rating) to fill. */
async function mainnetTop(xlmUsd) {
  const out = [];
  let total = 0;
  for (let page = 1; out.length < MAINNET_TARGET && page <= Math.ceil(MAINNET_TARGET / PAGE_SIZE) + 1; page++) {
    const c = await getJson("/market/assets", { network: "mainnet", itemsPerPage: String(PAGE_SIZE), page: String(page) });
    if (!Array.isArray(c?.member) || !c.member.length) break;
    total = c.totalItems ?? total;
    out.push(...c.member.filter((m) => typeof m.issuer === "string" && m.issuer).map(trimAsset)); // native XLM is the quote asset, not a row
    if (c.member.length < PAGE_SIZE) break;
  }
  if (!out.length) throw new Error("empty member list");
  out.sort((a, b) => (a.rankPosition ?? 1e9) - (b.rankPosition ?? 1e9));
  const seen = new Set(out.map((a) => a.assetKey));
  let expertAdded = 0;
  if (out.length < MAINNET_TARGET) {
    try {
      let cursor = "";
      for (let i = 0; i < 10 && out.length < MAINNET_TARGET; i++) {
        const j = await getExpert(`/asset?sort=rating&order=desc&limit=200${cursor ? `&cursor=${cursor}` : ""}`);
        const recs = j?._embedded?.records ?? [];
        if (!recs.length) break;
        for (const r of recs) {
          if (out.length >= MAINNET_TARGET) break;
          if (typeof r.asset !== "string" || !r.asset.includes("-")) continue; // skips native XLM
          const [code, issuer] = r.asset.split("-");
          if (seen.has(`${code}-${issuer}`)) continue;
          seen.add(`${code}-${issuer}`);
          out.push(fromExpert(r, out.length + 1, xlmUsd));
          expertAdded++;
        }
        cursor = String(recs[recs.length - 1].paging_token ?? "");
        if (!cursor) break;
      }
    } catch (e) {
      log(`WARN stellar.expert top-up failed: ${e.message}`);
    }
  }
  const member = out.slice(0, MAINNET_TARGET);
  log(`mainnet: ${member.length} assets (${member.length - expertAdded} stellarchain.io of ${total} tracked, ${expertAdded} stellar.expert)`);
  return { fetchedAt: new Date().toISOString(), totalItems: member.length, sources: { stellarchain: member.length - expertAdded, stellarExpert: expertAdded }, member };
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

  try {
    const full = await mainnetTop(next.overview.mainnet?.data?.xlmPriceUsd);
    // The shared snapshot (read by every page: ticker, landing cards) keeps the top PER_NETWORK;
    // the full list goes to its own file, loaded only by the Markets tab.
    next.marketAssets.mainnet = { ...full, totalItems: full.member.length, member: full.member.slice(0, PER_NETWORK) };
    const fullOut = resolve(dirname(OUT), "markets-mainnet.json");
    const slim = { ...full, member: full.member.map((a, i) => (i < PER_NETWORK ? a : { ...a, sparkline1h: undefined })) };
    mkdirSync(dirname(fullOut), { recursive: true });
    writeFileSync(`${fullOut}.tmp`, JSON.stringify({ version: 1, generatedAt: new Date().toISOString(), ...slim }) + "\n");
    renameSync(`${fullOut}.tmp`, fullOut);
    ok++;
  } catch (e) {
    failed++;
    log(`WARN market assets (mainnet top ${MAINNET_TARGET}) failed, keeping previous: ${e.message}`);
  }

  for (const network of ["testnet"]) {
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
