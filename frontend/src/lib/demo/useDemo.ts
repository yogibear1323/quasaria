/** React hook: owns the browser's single demo account, runs the simulator while the tab is open (one runner tab). */
import { useCallback, useEffect, useRef, useState } from "react";
import { catchUp, closedBy, stepDemo, type DemoState, type Profile } from "./engine";
import { TradeTape, fetchTrades, loadActiveMarket, loadMarket, pickPrice, ticker, type DemoMarket, type FeedSource } from "./market";
import { DEMO_KEY, claimRunner, closeDemo, createDemoLocked, loadDemo, randomId, releaseRunner, saveDemo, type CreateResult, type KV, type Locks } from "./store";

const TICK_MS: Record<Profile, number> = { active: 5_000, strict: 60_000 };
const CANDLE_TTL: Record<Profile, number> = { active: 30, strict: 240 };
const ACTIVE_CATCHUP_SEC = 5 * 3600; // 300 one-minute candles
export const ORACLE_MAX_DEV_PCT = 1.5; // same halt threshold as the fleet's oracle guard

function storage(): KV | null {
  try {
    return typeof window !== "undefined" && window.localStorage ? window.localStorage : null;
  } catch {
    return null;
  }
}

export interface Feed {
  source: FeedSource;
  price: number;
  at: number; // last successful tick (unix s)
  dataAt: number | null; // timestamp of the newest market datum (trade / candle)
  sessionTicks: number;
  lastCandle: number | null;
  oracle: { price: number; ageSec: number; devPct: number } | null;
  trades: number; // trades on the tape (Active)
}

export function useDemo(opts: { oraclePrice: number | null; oracleTs?: number | null; fundingHourly: number }) {
  const kv = storage();
  const [demo, setDemo] = useState<DemoState | null>(() => (kv ? loadDemo(kv) : null));
  const [market, setMarket] = useState<DemoMarket | null>(null);
  const [price, setPrice] = useState<number | null>(null);
  const [runner, setRunner] = useState(false);
  const [note, setNote] = useState("");
  const [feed, setFeed] = useState<Feed | null>(null);
  const [subBars, setSubBars] = useState<Record<number, number[]>>({});
  const sessionTicks = useRef(0);
  const tab = useRef(randomId());
  const o = useRef(opts);
  o.current = opts;
  const mk = useRef<DemoMarket | null>(null);
  const tape = useRef(new TradeTape());
  const busy = useRef(false);

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
    const profile: Profile = cur.profile ?? "strict";
    busy.current = true;
    try {
      if (!mk.current || mk.current.base !== (profile === "active" ? 60 : 900) || now - mk.current.at > CANDLE_TTL[profile]) {
        mk.current = profile === "active" ? await loadActiveMarket(now) : await loadMarket(now);
        setMarket(mk.current);
      }
      const m = mk.current;
      let pk: { price: number; source: FeedSource } | null = null;
      let dataAt: number | null = null;
      const bars: Record<number, ReturnType<typeof closedBy>> = Object.fromEntries(Object.entries(m.bars).map(([g, b]) => [Number(g), closedBy(b, Number(g), now).slice(-300)]));
      if (profile === "active") {
        await fetchTrades(tape.current.trades.length ? 100 : 1000).then((ts) => tape.current.add(ts)).catch(() => 0);
        const lt = tape.current.last();
        if (lt && now - lt.t < 120) (pk = { price: lt.price, source: "trades" }), (dataAt = lt.t);
        else pk = await ticker();
        bars[15] = tape.current.bars(15, now);
        bars[30] = tape.current.bars(30, now);
        setSubBars({ 15: bars[15].slice(-40).map((b) => b.c), 30: bars[30].slice(-40).map((b) => b.c) });
      } else pk = await pickPrice({ price: o.current.oraclePrice, ts: o.current.oracleTs ?? null }, now, m);
      if (!pk) return setNote("waiting for an XLM price");
      const px = pk.price;
      setPrice(px);
      // independent oracle check: on-chain oracle vs the price we trade on
      const op = o.current.oraclePrice, ots = o.current.oracleTs ?? null;
      const oracle = op && ots ? { price: op, ageSec: Math.max(0, now - ots), devPct: (Math.abs(px - op) / op) * 100 } : null;
      const entryBlock = oracle && oracle.ageSec < 1200 && oracle.devPct > ORACLE_MAX_DEV_PCT ? `oracle check: price deviates ${oracle.devPct.toFixed(2)}% from the on-chain oracle` : undefined;
      sessionTicks.current += 1;
      const baseBars = m.bars[m.base];
      setFeed({ source: pk.source, price: px, at: now, dataAt: dataAt ?? (baseBars?.length ? baseBars[baseBars.length - 1].t : null), sessionTicks: sessionTicks.current, lastCandle: baseBars?.length ? baseBars[baseBars.length - 1].t + m.base : null, oracle, trades: tape.current.trades.length });
      let next = cur;
      if (now - cur.lastTick >= Math.max(120, m.base)) {
        next = catchUp(cur, m.bars, m.base, now, o.current.fundingHourly, profile === "active" ? ACTIVE_CATCHUP_SEC : undefined);
        const a = next.away[next.away.length - 1];
        if (a) setNote(a.mode === "caught-up" ? `caught up ${fmtGap(a.to - a.from)} from price history` : `paused while away ${fmtGap(a.to - a.from)} (beyond the available price history)`);
      }
      next = stepDemo(next, { now, price: px, bars, fundingHourly: o.current.fundingHourly, extSkew: 0, entryBlock });
      if (saveDemo(kv, next)) setDemo(next);
      else setDemo(loadDemo(kv));
    } catch (e) {
      setNote(`market data unavailable (${(e as Error).message}); retrying`);
    } finally {
      busy.current = false;
    }
  }, [kv]);

  const profile = demo?.profile ?? "strict";
  useEffect(() => {
    if (!demo?.id) return;
    void tick();
    const t = setInterval(() => void tick(), TICK_MS[profile]);
    const bye = () => kv && releaseRunner(kv, tab.current);
    window.addEventListener("pagehide", bye);
    return () => {
      clearInterval(t);
      window.removeEventListener("pagehide", bye);
      bye();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demo?.id, profile, tick]);

  const create = useCallback(
    async (balance: unknown, p: Profile = "active"): Promise<CreateResult> => {
      if (!kv) return { ok: false, reason: "invalid", message: "This browser blocks local storage, so a demo cannot be kept." };
      const locks = (typeof navigator !== "undefined" && (navigator as Navigator & { locks?: Locks }).locks) || null;
      const r = await createDemoLocked(kv, balance, Math.floor(Date.now() / 1000), randomId(), locks, p);
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
    const bal = demo?.balance, p = demo?.profile ?? "strict";
    close();
    return bal ? create(bal, p) : null;
  }, [demo?.balance, demo?.profile, close, create]);

  return { demo, market, subBars, price, runner, note, feed, create, close, reset, available: !!kv };
}

export function fmtGap(s: number) {
  if (s < 3600) return `${Math.round(s / 60)} min`;
  if (s < 86_400) return `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min`;
  return `${(s / 86_400).toFixed(1)} days`;
}
