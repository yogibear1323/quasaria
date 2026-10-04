/** Testnet deployment record (deployments/testnet.json) — the single source of contract ids + market keys. */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { MarketAsset } from "../soroban.js";

export interface Deployment {
  network: string;
  rpcUrl: string;
  networkPassphrase: string;
  admin: string;
  contracts: { vault: string; oracle: string; qusdSac: string; xlmSac: string; [k: string]: string };
  vault: { marketAsset: MarketAsset; config: Record<string, number | string> };
}

const PATH = fileURLToPath(new URL("../../../deployments/testnet.json", import.meta.url));

export function loadDeployment(path = PATH): Deployment {
  const d = JSON.parse(readFileSync(path, "utf8")) as Deployment;
  if (d.network !== "testnet") throw new Error(`deployment network is ${d.network}, refusing (testnet only)`);
  if (!d.vault?.marketAsset) throw new Error("deployments/testnet.json: vault.marketAsset missing");
  return d;
}

/** ticker -> market key. XLM is keyed by its token address on the perps-v1 vault. */
export function defaultMarkets(d?: Deployment): Record<string, MarketAsset> {
  try {
    return { XLM: (d ?? loadDeployment()).vault.marketAsset };
  } catch {
    return {};
  }
}
