// Tiny Horizon reader (account state + base reserve). Read-only.
import type { AccountState } from "./multisig.ts";

export interface HorizonLike {
  account(id: string): Promise<{ sequence: string; state: AccountState } | null>;
  baseReserveStroops(): Promise<bigint>;
}

const toStroops = (s: string) => {
  const [i, f = ""] = s.split(".");
  return BigInt(i) * 10_000_000n + BigInt((f + "0000000").slice(0, 7));
};

export function parseHorizonAccount(j: any): { sequence: string; state: AccountState } {
  const native = (j.balances ?? []).find((b: any) => b.asset_type === "native");
  const master = (j.signers ?? []).find((s: any) => s.key === j.account_id);
  return {
    sequence: j.sequence,
    state: {
      id: j.account_id,
      balanceStroops: native ? toStroops(native.balance) : 0n,
      subentries: Number(j.subentry_count ?? 0),
      numSponsoring: Number(j.num_sponsoring ?? 0),
      numSponsored: Number(j.num_sponsored ?? 0),
      masterWeight: master ? Number(master.weight) : 0,
      signers: (j.signers ?? [])
        .filter((s: any) => s.key !== j.account_id)
        .map((s: any) => ({ key: s.key, weight: Number(s.weight) })),
      thresholds: {
        low: Number(j.thresholds?.low_threshold ?? 0),
        med: Number(j.thresholds?.med_threshold ?? 0),
        high: Number(j.thresholds?.high_threshold ?? 0),
      },
    },
  };
}

export class Horizon implements HorizonLike {
  base: string;
  constructor(base: string) {
    this.base = base;
  }
  async account(id: string) {
    const r = await fetch(`${this.base}/accounts/${id}`);
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`horizon ${r.status} for account ${id}`);
    return parseHorizonAccount(await r.json());
  }
  async baseReserveStroops() {
    const r = await fetch(`${this.base}/ledgers?order=desc&limit=1`);
    if (!r.ok) throw new Error(`horizon ${r.status} for ledgers`);
    const j: any = await r.json();
    const rec = j._embedded.records[0];
    return BigInt(rec.base_reserve_in_stroops);
  }
}
