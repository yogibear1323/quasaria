/** React hook: owns the browser's single demo account, runs the simulator while the tab is open (one runner tab). */
import { useCallback, useEffect, useRef, useState } from "react";
import { catchUp, closedBy, step, type DemoState } from "./engine";
import { loadMarket, ticker, type DemoMarket } from "./market";
import { DEMO_KEY, claimRunner, closeDemo, createDemoLocked, loadDemo, randomId, releaseRunner, saveDemo, type CreateResult, type KV, type Locks } from "./store";

const TICK_MS = 60_000;
const MARKET_TTL = 240;

function storage(): KV | null {
  try {
    return typeof window !== "undefined" && window.localStorage ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function useDemo(opts: { oraclePrice: number | null; fundingHourly: number }) {
  const kv = storage();
  const [demo, setDemo] = useState<DemoState | null>(() => (kv ? loadDemo(kv) : null));
  const [market, setMarket] = useState<DemoMarket | null>(null);
  const [price, setPrice] = useState<number | null>(null);
  const [runner, setRunner] = useState(false);
  const [note, setNote] = useState("");
  const tab = useRef(randomId());
  const o = useRef(opts);
  o.current = opts;
  const mk = useRef<DemoMarket | null>(null);
  const busy = useRef(false);

  // other tabs: follow saves / closes
  useEffect(() => {
    if (!kv) return;
    const on = (e: StorageEvent) => {
      if (e.key === DEMO_KEY || e.key === null) setDemo(loadDemo(kv));
    };
    window.addEventListener("storage", on);
    return () => window.removeEventListener("storage", on);
  }, [kv]);

  const tick = useCallback(async () => {
    if (!kv || busy.current) return;
    const cur = loadDemo(kv);
    if (!cur) return setDemo(null);
    const now = Math.floor(Date.now() / 1000);
    const isRunner = claimRunner(kv, tab.current, now);
    setRunner(isRunner);
    if (!isRunner) return setDemo(cur);
    busy.current = true;
    try {
      if (!mk.current || now - mk.current.at > MARKET_TTL) {
        mk.current = await loadMarket(now);
        setMarket(mk.current);
      }
      const m = mk.current;
      const px = o.current.oraclePrice ?? (await ticker()) ?? m.m15[m.m15.length - 1]?.c ?? null;
      if (!px) return setNote("waiting for an XLM price");
      setPrice(px);
      let next = cur;
      if (now - cur.lastTick >= 900) {
        next = catchUp(cur, m, now, o.current.fundingHourly);
        const a = next.away[next.away.length - 1];
        if (a) setNote(a.mode === "caught-up" ? `caught up ${fmtGap(a.to - a.from)} from price history` : `paused while away ${fmtGap(a.to - a.from)} (beyond 48 h of price history)`);
      }
      next = step(next, { now, price: px, bars: { 900: closedBy(m.m15, 900, now), 3600: closedBy(m.h1, 3600, now), 14400: closedBy(m.h4, 14400, now) }, fundingHourly: o.current.fundingHourly, extSkew: 0 });
      if (saveDemo(kv, next)) setDemo(next);
      else setDemo(loadDemo(kv));
    } catch (e) {
      setNote(`market data unavailable (${(e as Error).message}); retrying`);
    } finally {
      busy.current = false;
    }
  }, [kv]);

  useEffect(() => {
    if (!demo?.id) return;
    void tick();
    const t = setInterval(() => void tick(), TICK_MS);
    const bye = () => kv && releaseRunner(kv, tab.current);
    window.addEventListener("pagehide", bye);
    return () => {
      clearInterval(t);
      window.removeEventListener("pagehide", bye);
      bye();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demo?.id, tick]);

  const create = useCallback(
    async (balance: unknown): Promise<CreateResult> => {
      if (!kv) return { ok: false, reason: "invalid", message: "This browser blocks local storage, so a demo cannot be kept." };
      const locks = (typeof navigator !== "undefined" && (navigator as Navigator & { locks?: Locks }).locks) || null;
      const r = await createDemoLocked(kv, balance, Math.floor(Date.now() / 1000), randomId(), locks);
      setDemo(loadDemo(kv));
      if (r.ok) setNote("");
      return r;
    },
    [kv],
  );
  const close = useCallback(() => {
    if (!kv) return;
    closeDemo(kv);
    setDemo(null);
    setNote("");
  }, [kv]);
  const reset = useCallback(async () => {
    const bal = demo?.balance;
    close();
    return bal ? create(bal) : null;
  }, [demo?.balance, close, create]);

  return { demo, market, price, runner, note, create, close, reset, available: !!kv };
}

export function fmtGap(s: number) {
  if (s < 3600) return `${Math.round(s / 60)} min`;
  if (s < 86_400) return `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min`;
  return `${(s / 86_400).toFixed(1)} days`;
}
