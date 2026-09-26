/**
 * Market-data layer for display: stellarchain.io first, Horizon (testnet)
 * as the fallback when stellarchain is down, empty, or stale. Nothing here is
 * used for trading or settlement.
 */
import { useEffect, useState } from "react";
import { Asset } from "@stellar/stellar-sdk";
import { OFFLINE_DEMO } from "./config";
import { horizon, ASSETS } from "./stellar";
import { isStale, stellarchain, type MarketAsset, type ScNetwork } from "./stellarchain";

export const OVERVIEW_MAX_AGE = 2 * 3600_000; // XLM/USD older than 2h → fall back
export const ASSET_MAX_AGE = 24 * 3600_000; // per-asset snapshot older than 24h → "stale"

export type PriceSource = "stellarchain" | "horizon" | "none";

export type XlmUsd = { price: number | null; updatedAt: string | null; source: PriceSource; stale: boolean; note?: string };

/** Mid of a Horizon order book (price of `selling` in `buying`). */
export async function horizonMid(selling: Asset, buying: Asset): Promise<number | null> {
  const ob = await horizon.orderbook(selling, buying).limit(1).call();
  const bid = ob.bids[0] ? Number(ob.bids[0].price) : null;
  const ask = ob.asks[0] ? Number(ob.asks[0].price) : null;
  if (bid && ask) return (bid + ask) / 2;
  return bid ?? ask ?? null;
}

export async function loadXlmUsd(): Promise<XlmUsd> {
  let staleSc: XlmUsd | null = null;
  try {
    const o = await stellarchain.overview("mainnet");
    if (o?.xlmPriceUsd) {
      const r: XlmUsd = { price: o.xlmPriceUsd, updatedAt: o.updatedAt, source: "stellarchain", stale: isStale(o.updatedAt, OVERVIEW_MAX_AGE), note: "mainnet reference price" };
      if (!r.stale) return r;
      staleSc = r;
    }
  } catch {
    /* fall through to Horizon */
  }
  try {
    const mid = await horizonMid(ASSETS.XLM, ASSETS.USDC);
    if (mid) return { price: mid, updatedAt: new Date().toISOString(), source: "horizon", stale: false, note: "testnet SDEX XLM/USDC mid (fallback)" };
  } catch {
    /* ignore */
  }
  return staleSc ?? { price: null, updatedAt: null, source: "none", stale: true };
}

export function useXlmUsd(refreshMs = 5 * 60_000) {
  const [v, setV] = useState<XlmUsd | null>(null);
  useEffect(() => {
    if (OFFLINE_DEMO) return;
    let alive = true;
    const go = () => loadXlmUsd().then((x) => alive && setV(x));
    go();
    const t = setInterval(go, refreshMs);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [refreshMs]);
  return v;
}

export type MarketRow = MarketAsset & { priceSource: PriceSource; priceAsOf: string | null; stale: boolean };

/**
 * Top assets by stellarchain rank. For rows with no/stale price, try the
 * Horizon book vs XLM on the configured (testnet) Horizon — only meaningful
 * for `network === "testnet"` because Quasaria never talks to mainnet Horizon.
 */
export async function loadMarkets(network: ScNetwork, o: { itemsPerPage?: number; search?: string; enrich?: number } = {}): Promise<{ rows: MarketRow[]; total: number; error?: string }> {
  let rows: MarketRow[] = [];
  let total = 0;
  let error: string | undefined;
  try {
    const r = await stellarchain.marketAssets({ network, itemsPerPage: o.itemsPerPage ?? 25, search: o.search });
    total = r.total;
    rows = r.assets.map((a) => {
      const stale = isStale(a.updatedAt, ASSET_MAX_AGE);
      return { ...a, priceSource: a.priceXlm !== null ? "stellarchain" : "none", priceAsOf: a.priceXlm !== null ? a.updatedAt : null, stale };
    });
  } catch (e) {
    error = (e as Error).message;
  }
  if (network === "testnet") {
    const todo = rows.filter((r) => r.priceXlm === null || r.stale).slice(0, o.enrich ?? 12);
    await Promise.all(
      todo.map(async (r) => {
        try {
          const a = new Asset(r.code, r.issuer);
          const [mid, info] = await Promise.all([horizonMid(a, Asset.native()), horizon.assets().forCode(r.code).forIssuer(r.issuer).call()]);
          if (mid) Object.assign(r, { priceXlm: mid, priceSource: "horizon", priceAsOf: new Date().toISOString(), stale: false });
          const rec = info.records[0] as unknown as { accounts?: { authorized?: number } } | undefined;
          if (rec?.accounts?.authorized !== undefined) r.trustlines = rec.accounts.authorized;
        } catch {
          /* leave as-is */
        }
      }),
    );
  }
  return { rows, total, error };
}
