import { useEffect, useRef, useState } from "react";
import { loadAccountView, type AccountView, type HAccount } from "./account";
import { useAsync } from "./useAsync";
import type { NetId } from "./nativePools";

export const ACCOUNT_REFRESH_MS = 10_000;

/**
 * Live Horizon account for an address (null address → nothing): GET {horizon}/accounts/{address} on the active network.
 * Re-fetched every ~10 s while the tab is visible, on focus / tab return, and on `reload()` (after a transaction), so an
 * unfunded (404) address switches to its balances by itself once its first XLM lands, and new trustlines appear on their own.
 */
export function useAccount(net: NetId, address: string | null, refreshMs = ACCOUNT_REFRESH_MS) {
  const s = useAsync<{ view: AccountView; raw: HAccount | null } | null>(() => (address ? loadAccountView(net, address) : Promise.resolve(null)), [net, address]);
  const [at, setAt] = useState<number | null>(null);
  const reload = useRef(s.reload); reload.current = s.reload;
  useEffect(() => { if (s.data && !s.loading) setAt(Date.now()); }, [s.data, s.loading]);
  useEffect(() => {
    if (!address || typeof window === "undefined") return;
    const tick = () => { if (!document.hidden) reload.current(); };
    const t = setInterval(tick, refreshMs);
    const onVis = () => { if (!document.hidden) reload.current(); };
    window.addEventListener("focus", onVis); document.addEventListener("visibilitychange", onVis);
    return () => { clearInterval(t); window.removeEventListener("focus", onVis); document.removeEventListener("visibilitychange", onVis); };
  }, [address, refreshMs]);
  return { ...s, view: s.data?.view ?? null, raw: s.data?.raw ?? null, updatedAt: at };
}
