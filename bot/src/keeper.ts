import type { KeeperVault } from "./exchange.js";
import { healthFactor, triggerHit } from "./math.js";
import type { Position } from "./types.js";

export type KeeperAction = { id: number; kind: "liquidate" | "trigger"; detail: string };

/** Pure decision function: which positions to liquidate or trigger at `prices`. */
export function planKeeperActions(positions: Position[], prices: Record<string, number>, mmBps: number): KeeperAction[] {
  const out: KeeperAction[] = [];
  for (const p of positions) {
    const price = prices[p.asset];
    if (!price) continue;
    const hf = healthFactor(p, price, mmBps);
    if (hf < 1) {
      out.push({ id: p.id, kind: "liquidate", detail: `HF ${hf.toFixed(3)} < 1.0` });
      continue;
    }
    const hit = triggerHit(p, price);
    if (hit) out.push({ id: p.id, kind: "trigger", detail: hit });
  }
  return out;
}

/** One keeper sweep over all open positions. Failures are logged, not fatal. */
export async function runKeeperOnce(vault: KeeperVault, log: (m: string) => void = console.log) {
  const ids = await vault.openPositionIds();
  const positions: Position[] = [];
  for (const id of ids) {
    try {
      positions.push(await vault.position(id));
    } catch (e) {
      log(`keeper: could not load position ${id}: ${(e as Error).message}`);
    }
  }
  const prices: Record<string, number> = {};
  for (const a of new Set(positions.map((p) => p.asset))) {
    try {
      prices[a] = await vault.price(a);
    } catch (e) {
      log(`keeper: no price for ${a}: ${(e as Error).message}`);
    }
  }
  const actions = planKeeperActions(positions, prices, await vault.maintenanceMarginBps());
  const results: { action: KeeperAction; ok: boolean; value?: number; error?: string }[] = [];
  for (const a of actions) {
    try {
      const value = a.kind === "liquidate" ? await vault.liquidate(a.id) : await vault.executeTrigger(a.id);
      log(`keeper: ${a.kind} #${a.id} (${a.detail}) -> ${value}`);
      results.push({ action: a, ok: true, value });
    } catch (e) {
      // another keeper may have won the race; the contract re-checks everything
      log(`keeper: ${a.kind} #${a.id} failed: ${(e as Error).message}`);
      results.push({ action: a, ok: false, error: (e as Error).message });
    }
  }
  return results;
}
