/**
 * Live XLM-PERP/USD candlestick chart (TradingView Lightweight Charts™, Apache-2.0).
 * Candles + volume from Coinbase (Kraken backup), last candle live from the ticker, overlay lines for the
 * on-chain oracle price and the vault's mark price. Lazy-loaded: only the /perps/chart route and the
 * compact Perps-page embed pull this chunk in.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  CandlestickSeries, ColorType, CrosshairMode, HistogramSeries, LineSeries, LineStyle, createChart,
  type IChartApi, type IPriceLine, type ISeriesApi, type MouseEventParams, type Time, type UTCTimestamp,
} from "lightweight-charts";
import {
  STALE_AFTER_SEC, TIMEFRAMES, applyTick, change, fetchBars, fetchOpen24h, fetchTick, fmtAgeShort, freshness, loadBars, mergeHistory,
  readOverlay, saveBars, tfInfo, type Bar, type FeedSource, type Overlay, type Tick, type Timeframe,
} from "../lib/xlmChart";
import { fmtRate } from "../lib/perps";
import "../theme/xlm-chart.css";

export const XLM_CHART_LABEL = "Testnet perps · prices from mainnet market data · not financial advice";
const TICK_MS = 5_000;
const HISTORY_MS = 60_000;
const OVERLAY_MS = 30_000;
const C = {
  bg: "#07080f", grid: "rgba(255,255,255,0.045)", text: "#7d84a6", up: "#2fae84", down: "#c95a72",
  upVol: "rgba(47,174,132,0.28)", downVol: "rgba(201,90,114,0.28)", oracle: "#22d3ee", mark: "#a78bfa", cross: "rgba(196,181,253,0.45)",
};
const px = (v: number | null | undefined, d = 4) => (v == null || !Number.isFinite(v) ? "—" : `$${v.toFixed(v < 1 ? Math.max(d, 4) : 2)}`);
const vol = (v: number) => (v >= 1e6 ? `${(v / 1e6).toFixed(2)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(1)}K` : v.toFixed(0));
/** Axis + crosshair labels in the viewer's local time (lightweight-charts defaults to UTC), matching the tooltip. */
export function localTick(t: number, type: number) {
  const d = new Date(t * 1000);
  if (type === 0) return String(d.getFullYear());
  if (type === 1) return d.toLocaleString(undefined, { month: "short" });
  if (type === 2) return String(d.getDate());
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false });
}
const localFull = (t: number) => new Date(t * 1000).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
const visible = () => typeof document === "undefined" || document.visibilityState !== "hidden";

/** Session samples of oracle/mark (kept across tf switches and route changes). */
const samples: { at: number; oracle: number | null; mark: number | null }[] = [];
export function overlayPoints(s: typeof samples, key: "oracle" | "mark", tfSec: number) {
  const m = new Map<number, number>();
  for (const x of s) {
    const v = x[key];
    if (v != null && v > 0) m.set(Math.floor(x.at / tfSec) * tfSec, v);
  }
  return [...m.entries()].sort((a, b) => a[0] - b[0]).map(([t, value]) => ({ time: t as UTCTimestamp, value }));
}

type Props = { compact?: boolean; overlay?: Overlay | null; defaultTf?: Timeframe };

export default function XlmChart({ compact = false, overlay: overlayProp, defaultTf = "15m" }: Props) {
  const [tf, setTf] = useState<Timeframe>(defaultTf);
  const cached = loadBars(tf);
  const [bars, setBars] = useState<Bar[]>(cached?.bars ?? []);
  const [histSrc, setHistSrc] = useState<{ source: FeedSource; at: number } | null>(cached ? { source: cached.source, at: cached.at } : null);
  const [histErr, setHistErr] = useState<string | null>(null);
  const [tick, setTick] = useState<Tick | null>(null);
  const [tickErr, setTickErr] = useState(false);
  const [open24, setOpen24] = useState<number | null>(null);
  const [ownOverlay, setOwnOverlay] = useState<Overlay | null>(null);
  const [now, setNow] = useState(() => Date.now() / 1000);
  const [hover, setHover] = useState<{ bar: Bar; x: number; y: number } | null>(null);
  const overlay = overlayProp !== undefined ? overlayProp : ownOverlay;
  const tfSec = tfInfo(tf).sec;
  const tfRef = useRef(tf);
  tfRef.current = tf;

  // history: on timeframe change + every minute
  useEffect(() => {
    let alive = true;
    const c = loadBars(tf);
    setBars(c?.bars ?? []);
    setHistSrc(c ? { source: c.source, at: c.at } : null);
    setHistErr(null);
    const go = () => {
      if (!visible()) return;
      fetchBars(tf)
        .then(({ bars: fresh, source }) => {
          if (!alive) return;
          const at = Date.now() / 1000;
          setBars((prev) => {
            const merged = mergeHistory(fresh, prev);
            saveBars(tf, { bars: merged, source, at });
            return merged;
          });
          setHistSrc({ source, at });
          setHistErr(null);
        })
        .catch((e) => alive && setHistErr(String(e?.message ?? e)));
    };
    go();
    const t = setInterval(go, HISTORY_MS);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [tf]);

  // live ticker → last candle
  useEffect(() => {
    let alive = true;
    const go = () => {
      if (!visible()) return;
      fetchTick()
        .then((t) => {
          if (!alive) return;
          setTick(t);
          setTickErr(false);
          setBars((prev) => (prev.length ? applyTick(prev, t.price, Date.now() / 1000, tfInfo(tfRef.current).sec) : prev));
        })
        .catch(() => alive && setTickErr(true));
    };
    go();
    const t = setInterval(go, TICK_MS);
    const onVis = () => visible() && go();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      alive = false;
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  // 24h open, oracle/mark overlay (unless the parent passes it), 1s clock for ages
  useEffect(() => {
    let alive = true;
    const go24 = () => fetchOpen24h().then((o) => alive && o && setOpen24(o));
    go24();
    const t24 = setInterval(go24, 5 * 60_000);
    const clock = setInterval(() => setNow(Date.now() / 1000), 1_000);
    let tOv: ReturnType<typeof setInterval> | undefined;
    if (overlayProp === undefined) {
      const goOv = () => visible() && readOverlay().then((o) => alive && setOwnOverlay(o)).catch(() => void 0);
      goOv();
      tOv = setInterval(goOv, OVERLAY_MS);
    }
    return () => {
      alive = false;
      clearInterval(t24);
      clearInterval(clock);
      clearInterval(tOv);
    };
  }, [overlayProp === undefined]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!overlay) return;
    const last = samples[samples.length - 1];
    if (!last || last.at !== overlay.at) samples.push({ at: overlay.at, oracle: overlay.oracle, mark: overlay.mark });
    if (samples.length > 2000) samples.splice(0, samples.length - 2000);
  }, [overlay]);

  // ---- chart
  const box = useRef<HTMLDivElement>(null);
  const api = useRef<{ chart: IChartApi; candle: ISeriesApi<"Candlestick">; volume: ISeriesApi<"Histogram">; oracle: ISeriesApi<"Line">; mark: ISeriesApi<"Line">; lines: IPriceLine[] } | null>(null);
  const shown = useRef<{ tf: Timeframe; first: number; len: number } | null>(null);
  const barsRef = useRef(bars);
  barsRef.current = bars;

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const chart = createChart(el, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: C.bg }, textColor: C.text, fontFamily: "'JetBrains Mono', ui-monospace, monospace", fontSize: compact ? 10 : 11, attributionLogo: true },
      grid: { vertLines: { color: C.grid }, horzLines: { color: C.grid } },
      crosshair: { mode: CrosshairMode.Normal, vertLine: { color: C.cross, labelBackgroundColor: "#2a2350" }, horzLine: { color: C.cross, labelBackgroundColor: "#2a2350" } },
      rightPriceScale: { borderColor: "rgba(255,255,255,0.08)", scaleMargins: { top: 0.08, bottom: 0.24 } },
      timeScale: { borderColor: "rgba(255,255,255,0.08)", timeVisible: true, secondsVisible: false, rightOffset: 4, tickMarkFormatter: (t: Time, type: number) => localTick(Number(t), type) },
      localization: { priceFormatter: (p: number) => p.toFixed(5), timeFormatter: (t: Time) => localFull(Number(t)) },
    });
    const candle = chart.addSeries(CandlestickSeries, {
      upColor: C.up, downColor: C.down, borderUpColor: C.up, borderDownColor: C.down, wickUpColor: C.up, wickDownColor: C.down,
      priceFormat: { type: "price", precision: 5, minMove: 0.000001 },
    });
    const volume = chart.addSeries(HistogramSeries, { priceScaleId: "vol", priceFormat: { type: "volume" }, lastValueVisible: false, priceLineVisible: false });
    chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
    const line = { lineWidth: 2 as const, lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false, pointMarkersVisible: true, pointMarkersRadius: 2 };
    const oracle = chart.addSeries(LineSeries, { ...line, color: C.oracle, title: "" });
    const mark = chart.addSeries(LineSeries, { ...line, color: C.mark, lineStyle: LineStyle.Dashed, title: "" });
    api.current = { chart, candle, volume, oracle, mark, lines: [] };
    const onMove = (p: MouseEventParams<Time>) => {
      const d = p.seriesData.get(candle) as { time: UTCTimestamp; open: number; high: number; low: number; close: number } | undefined;
      if (!p.point || !d || p.time === undefined) return setHover(null);
      const b = barsRef.current.find((x) => x.t === Number(d.time));
      setHover({ bar: b ?? { t: Number(d.time), o: d.open, h: d.high, l: d.low, c: d.close, v: 0 }, x: p.point.x, y: p.point.y });
    };
    chart.subscribeCrosshairMove(onMove);
    shown.current = null;
    return () => {
      chart.unsubscribeCrosshairMove(onMove);
      chart.remove();
      api.current = null;
    };
  }, [compact]);

  useEffect(() => {
    const a = api.current;
    if (!a || !bars.length) return;
    const toC = (b: Bar) => ({ time: b.t as UTCTimestamp, open: b.o, high: b.h, low: b.l, close: b.c });
    const toV = (b: Bar) => ({ time: b.t as UTCTimestamp, value: b.v, color: b.c >= b.o ? C.upVol : C.downVol });
    const s = shown.current;
    const sameSeries = s && s.tf === tf && s.first === bars[0].t && (bars.length === s.len || bars.length === s.len + 1);
    if (sameSeries) {
      for (const b of bars.slice(bars.length === s!.len ? -1 : -2)) {
        a.candle.update(toC(b));
        a.volume.update(toV(b));
      }
    } else {
      a.candle.setData(bars.map(toC));
      a.volume.setData(bars.map(toV));
      const keep = compact ? 60 : (box.current?.clientWidth ?? 800) < 600 ? 60 : 120;
      a.chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, bars.length - keep), to: bars.length + 3 });
    }
    shown.current = { tf, first: bars[0].t, len: bars.length };
  }, [bars, tf, compact]);

  useEffect(() => {
    const a = api.current;
    if (!a) return;
    const lo = bars[0]?.t ?? 0;
    const within = (pts: { time: UTCTimestamp; value: number }[]) => pts.filter((p) => p.time >= lo);
    a.oracle.setData(bars.length ? within(overlayPoints(samples, "oracle", tfSec)) : []);
    a.mark.setData(bars.length ? within(overlayPoints(samples, "mark", tfSec)) : []);
    a.lines.forEach((l) => a.candle.removePriceLine(l));
    a.lines = [];
    if (overlay?.oracle) a.lines.push(a.candle.createPriceLine({ price: overlay.oracle, color: C.oracle, lineWidth: 1, lineStyle: LineStyle.Solid, axisLabelVisible: true, title: "Oracle" }));
    if (overlay?.mark) a.lines.push(a.candle.createPriceLine({ price: overlay.mark, color: C.mark, lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: "Mark" }));
  }, [overlay, tfSec, bars.length > 0, bars[0]?.t]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- header numbers
  const last = bars[bars.length - 1];
  const price = tick?.price ?? last?.c ?? null;
  const ch = change(price, open24);
  const feedAt = tick?.at ?? histSrc?.at ?? null;
  const feed = freshness(feedAt, now, STALE_AFTER_SEC);
  const stale = tickErr || feed.stale || (!!histErr && !tick);
  const source: FeedSource | null = tick?.source ?? histSrc?.source ?? null;
  const oracleAge = overlay?.oracleTs ? now - overlay.oracleTs : null;
  const oracleStale = oracleAge != null && overlay?.maxAge != null && oracleAge > overlay.maxAge;
  const tip = useMemo(() => {
    if (!hover) return null;
    const w = box.current?.clientWidth ?? 600;
    return { left: Math.min(Math.max(8, hover.x + 14), w - 176), top: Math.max(8, hover.y - 96) };
  }, [hover]);

  return (
    <div className={`xc ${compact ? "xc-compact" : ""}`} data-testid="xlm-chart">
      <div className="xc-head">
        <div className="xc-title">
          <span className="xc-sym">XLM-PERP<small>/USD</small></span>
          <span className="xc-px mono" data-testid="xlm-chart-price">{px(price, 5)}</span>
          <span className={`xc-ch mono ${ch == null ? "" : ch >= 0 ? "up" : "dn"}`} data-testid="xlm-chart-change">
            {ch == null ? "24h —" : `${ch >= 0 ? "+" : ""}${(ch * 100).toFixed(2)}% 24h`}
          </span>
        </div>
        <div className="xc-chips">
          <span className={`xc-chip ${stale ? "stale" : "live"}`} data-testid="xlm-chart-source" title={`Candle + last-trade source (mainnet market data)${tick?.tradeAt ? ` · last trade ${fmtAgeShort(now - tick.tradeAt)} ago` : ""} · age = since last successful update`}>
            <i aria-hidden /> {source ?? "connecting"} · {fmtAgeShort(feed.age)}
            {stale && <b data-testid="xlm-chart-stale"> stale</b>}
          </span>
          <span className={`xc-chip oracle ${oracleStale ? "stale" : ""}`} title="On-chain oracle price (vault oracle lastprice, Soroban testnet)" data-testid="xlm-chart-oracle">
            Oracle {px(overlay?.oracle)} · {fmtAgeShort(oracleAge)}{oracleStale && <b> stale</b>}
          </span>
          <span className="xc-chip mark" title="Vault mark_price() (Soroban testnet)">Mark {px(overlay?.mark)}</span>
          {!compact && overlay && overlay.fundingHourly != null && <span className="xc-chip" title="Current hourly funding rate from the vault">Funding {fmtRate(overlay.fundingHourly)}/h</span>}
        </div>
      </div>
      <div className="xc-tfs" role="group" aria-label="Timeframe">
        {TIMEFRAMES.map((x) => (
          <button key={x.tf} type="button" className={x.tf === tf ? "on" : ""} aria-pressed={x.tf === tf} onClick={() => setTf(x.tf)}>
            {x.tf}
          </button>
        ))}
        <span className="xc-legend" aria-hidden>
          <span className="o">━ oracle</span> <span className="m">┅ mark</span>
        </span>
      </div>
      <div className="xc-plot" ref={box}>
        {!bars.length && <div className="xc-empty">{histErr ? `Price feed unavailable (${histErr}). Retrying…` : "Loading XLM candles…"}</div>}
        {hover && tip && (
          <div className="xc-tip mono" style={tip} data-testid="xlm-chart-tip">
            <div>{localFull(hover.bar.t)}</div>
            <div>O <b>{hover.bar.o.toFixed(5)}</b> H <b>{hover.bar.h.toFixed(5)}</b></div>
            <div>L <b>{hover.bar.l.toFixed(5)}</b> C <b className={hover.bar.c >= hover.bar.o ? "up" : "dn"}>{hover.bar.c.toFixed(5)}</b></div>
            <div>Vol <b>{vol(hover.bar.v)}</b> XLM</div>
          </div>
        )}
      </div>
      {stale && bars.length > 0 && (
        <div className="xc-stalenote" role="status">Live feed interrupted. Showing the last data received{feedAt ? ` (${fmtAgeShort(feed.age)} ago)` : ""}; retrying every {TICK_MS / 1000}s.</div>
      )}
      <div className="xc-foot">
        <span>{XLM_CHART_LABEL}</span>
        <span>
          Charts by <a href="https://www.tradingview.com/" target="_blank" rel="noreferrer">TradingView</a> Lightweight Charts™
        </span>
      </div>
    </div>
  );
}
