import { loadAccountView, type AccountView, type HAccount } from "./account";
import { useAsync } from "./useAsync";
import type { NetId } from "./nativePools";

/** Read-only Horizon account for an address (null address → nothing). `reload()` after a transaction. */
export function useAccount(net: NetId, address: string | null) {
  const s = useAsync<{ view: AccountView; raw: HAccount | null } | null>(() => (address ? loadAccountView(net, address) : Promise.resolve(null)), [net, address]);
  return { ...s, view: s.data?.view ?? null, raw: s.data?.raw ?? null };
}
