import { useEffect, useRef, useState } from "react";

/** True when the user asked the OS for reduced motion (static page). */
export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Count up from 0 to a REAL value once it is known. `target === null` (unknown / loading / not live) returns null,
 * so callers keep their dash or ellipsis: no fake numbers are ever animated. rAF stops while the tab is hidden.
 */
export function useCountUp(target: number | null, ms = 900): number | null {
  const [v, setV] = useState<number | null>(() => (target === null ? null : prefersReducedMotion() ? target : 0));
  const raf = useRef(0);
  useEffect(() => {
    if (target === null || !Number.isFinite(target)) { setV(target === null ? null : target); return; }
    if (prefersReducedMotion() || typeof requestAnimationFrame === "undefined" || target === 0) { setV(target); return; }
    const t0 = performance.now();
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / ms), e = 1 - Math.pow(1 - k, 3);
      setV(k >= 1 ? target : target * e);
      if (k < 1) raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf.current);
  }, [target, ms]);
  return v;
}

/** Marks <html data-tab-hidden> while the tab is hidden so CSS pauses every Holders animation. */
export function usePauseWhenHidden() {
  useEffect(() => {
    if (typeof document === "undefined") return;
    const on = () => { if (document.hidden) document.documentElement.setAttribute("data-tab-hidden", ""); else document.documentElement.removeAttribute("data-tab-hidden"); };
    on(); document.addEventListener("visibilitychange", on);
    return () => { document.removeEventListener("visibilitychange", on); document.documentElement.removeAttribute("data-tab-hidden"); };
  }, []);
}

/**
 * Tier progress on a piecewise scale: 0..1M is the first half of the bar, 1M..10M the second half, 10M+ is full.
 * Returns null for an unknown balance (the bar stays empty and static).
 */
export function tierProgress(balance: number | null, t1 = 1_000_000, t2 = 10_000_000): number | null {
  if (balance === null || !Number.isFinite(balance) || balance < 0) return null;
  if (balance >= t2) return 1;
  if (balance >= t1) return 0.5 + 0.5 * ((balance - t1) / (t2 - t1));
  return 0.5 * (balance / t1);
}
