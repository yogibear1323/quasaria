import { useCallback, useEffect, useRef, useState } from "react";

export type AsyncState<T> = { data: T | null; loading: boolean; error: string | null; live: boolean; reload: () => void };

/** Runs `fn` on mount and whenever `deps` change; `reload()` re-runs it. Stale results are dropped. */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[] = []): AsyncState<T> {
  const [s, set] = useState<{ data: T | null; loading: boolean; error: string | null; live: boolean }>({ data: null, loading: true, error: null, live: false });
  const [n, setN] = useState(0);
  const f = useRef(fn);
  f.current = fn;
  useEffect(() => {
    let alive = true;
    set((x) => ({ ...x, loading: true }));
    f.current().then((d) => alive && set({ data: d, loading: false, error: null, live: true })).catch((e) => alive && set((x) => ({ data: x.data, loading: false, error: String(e?.message ?? e), live: false }))); // keep the last good data on a failed refresh
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, n]);
  const reload = useCallback(() => setN((x) => x + 1), []);
  return { ...s, reload };
}
