import { useEffect, useRef, useState } from "react";
import type { CalibratedStatus, ChainTrade } from "./backOffice";

/**
 * Back Office pulse: "the glow is the proof". A pulse may only fire when a REAL event
 * signature changes after the first observation (never on page load, never on a timer):
 *  - oracle: the on-chain oracle timestamp moved (a new price push landed)
 *  - fill:   a new on-chain desk trade tx appeared, or Orion's live slice logged a new fill
 *  - decision: the calibrated desk (Orion) logged a new closed-candle decision
 */
export interface RealEventKeys { oracle: string | null; fill: string | null; decision: string | null }

export function realEventKeys(
  oracleTs: number | null | undefined,
  trades: Record<string, ChainTrade[]> | null | undefined,
  calibrated: CalibratedStatus[] | null | undefined,
): RealEventKeys {
  const txs = trades ? Object.values(trades).flat().map((t) => `${t.tx}:${t.kind}`).sort() : null;
  const liveFills = (calibrated ?? []).flatMap((c) => (c.live?.fills ?? []).map((f) => `${c.id}:${f.tx}:${f.kind}`)).sort();
  const fill = txs === null && !liveFills.length ? null : [...(txs ?? []), ...liveFills].join("|");
  const decision = calibrated?.length ? calibrated.map((c) => `${c.id}:${c.decisions[0]?.t ?? 0}`).join("|") : null;
  return { oracle: oracleTs ? String(oracleTs) : null, fill, decision };
}

/** True for `ms` after `key` changes from one known value to another. Null keys and the first value never pulse. */
export function useEventPulse(key: string | null, ms = 1800): boolean {
  const prev = useRef<string | null>(null);
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (key === null) return;
    const was = prev.current;
    prev.current = key;
    if (was === null || was === key) return;
    setOn(true);
    const t = setTimeout(() => setOn(false), ms);
    return () => clearTimeout(t);
  }, [key, ms]);
  return on;
}
