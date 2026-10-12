/* Quasaria Beacons simulator. Port of quasaria-beacons/docs/sim/sim.py (reserve + distribution model).
   Preview · not deployed · illustrative. All amounts in XLM (QFX valued 1:1). Not a guaranteed return. */
export const EPOCHS_PER_DAY = 6;
export const EPOCHS_PER_YEAR = 365 * EPOCHS_PER_DAY; // 2190
export const FEE_SHARE = 0.4;
export const INS_SHARE = 0.1;
export const APR_CAP = 0.25;
export const HOLDER_YIELD = 0.12;
export type Lock = "none" | "30d" | "90d";
export const LOCK_W: Record<Lock, number> = { none: 1.0, "30d": 1.1, "90d": 1.25 };

export const dailyRev = (fees: number, alloc: number, tvl: number, rate: number) => FEE_SHARE * fees + (rate * alloc * tvl) / 365;

export interface SimParams {
  tvl: number; alloc: number; rate: number; fees: number;
  feeFn?: (day: number) => number; startFees?: number; days?: number; ruleDays?: number;
  stake?: number; lock?: Lock; drought?: [number, number] | null; blendLoss?: { day: number; pct: number } | null;
}
export interface SimRow { day: number; fees: number; reserve: number; insurance: number; buyback: number; aprPct: number }
export interface LossInfo { day: number; loss: number; covered: number; stakerLoss: number; haircutPct: number }

/** Same loop as run_reserve() in sim.py, plus an optional user stake, fee drought and Blend loss. */
export function runSim(p: SimParams) {
  const { tvl, alloc, rate } = p;
  const days = p.days ?? 90;
  const ruleDays = p.ruleDays ?? 30;
  const feeFn = p.feeFn ?? (() => p.fees);
  const capE = (APR_CAP * tvl) / EPOCHS_PER_YEAR;
  const insTarget = 0.05 * alloc * tvl;
  let S = (42 * dailyRev(p.startFees ?? p.fees, alloc, tvl, rate)) / EPOCHS_PER_DAY;
  let ins = 0, buyback = 0, paid = 0, capped = 0, userPaid = 0;
  let lossInfo: LossInfo | null = null;
  const stake = Math.min(Math.max(p.stake ?? 0, 0), tvl);
  const wU = stake * LOCK_W[p.lock ?? "none"];
  const sumW = tvl - stake + wU; // other stakers at weight 1.00 (illustrative)
  const rows: SimRow[] = [];
  for (let e = 0; e < days * EPOCHS_PER_DAY; e++) {
    const d = e / EPOCHS_PER_DAY;
    let f = feeFn(d);
    if (p.drought && d >= p.drought[0] && d < p.drought[1]) f = 0;
    S += dailyRev(f, alloc, tvl, rate) / EPOCHS_PER_DAY;
    ins += (INS_SHARE * f) / EPOCHS_PER_DAY;
    if (p.blendLoss && !lossInfo && d >= p.blendLoss.day) {
      const L = p.blendLoss.pct * alloc * tvl;
      const cover = Math.min(ins, L);
      ins -= cover;
      lossInfo = { day: p.blendLoss.day, loss: L, covered: cover, stakerLoss: L - cover, haircutPct: ((L - cover) / tvl) * 100 };
    }
    const D = Math.min(S / 42, capE);
    if (D >= capE - 1e-9) capped++;
    S -= D; paid += D;
    if (e >= 1 && sumW > 0) userPaid += (D * wU) / sumW; // one-epoch warm-up
    if (ruleDays) {
      const thr = ruleDays * EPOCHS_PER_DAY * D;
      if (S > thr) { const x = S - thr; S = thr; const toIns = Math.min(x, Math.max(insTarget - ins, 0)); ins += toIns; buyback += x - toIns; }
    }
    if (e % EPOCHS_PER_DAY === EPOCHS_PER_DAY - 1)
      rows.push({ day: Math.floor(e / EPOCHS_PER_DAY) + 1, fees: f, reserve: S, insurance: ins, buyback, aprPct: (D * EPOCHS_PER_YEAR) / tvl * 100 });
  }
  const steadyD = Math.min(dailyRev(p.fees, alloc, tvl, rate) / EPOCHS_PER_DAY, capE);
  return {
    rows, reserveEnd: S, insuranceEnd: ins, buybackEnd: buyback, paid, epochsAtCap: capped,
    avgAprPct: (paid / tvl) * (365 / days) * 100,
    userPaid, userAprPct: stake ? (userPaid / stake) * (365 / days) * 100 : 0,
    userPerEpochSteady: sumW > 0 ? (steadyD * wU) / sumW : 0, lossInfo, capPerEpoch: capE,
  };
}
export const steadyApr = (fees: number, alloc: number, tvl: number, rate: number) => Math.min((dailyRev(fees, alloc, tvl, rate) * 365) / tvl, APR_CAP);
/** Fees/day entering the router where Beacons APR equals the 12% holder yield. */
export const breakEvenFees = (alloc: number, tvl: number, rate: number) => (HOLDER_YIELD * tvl - rate * alloc * tvl) / (FEE_SHARE * 365);
