import { useEffect, useMemo, useState } from "react";
import { PageHead, Stat, Tabs, TxStatus, useTx } from "../components/ui";
import OrderBook from "../components/OrderBook";
import PriceChart from "../components/PriceChart";
import { ASSETS, assetFromKey, assetKeyOf, buildLimitOrder, fetchOrderBook, fetchTradeCandles, submitSignedXdr } from "../lib/stellar";
import { useSearchParams } from "react-router-dom";
import { AssetPicker, toOption, type PickerOption } from "../components/AssetBits";
import { loadMarkets, type MarketRow } from "../lib/markets";
import { STELLARCHAIN_ATTRIBUTION } from "../lib/stellarchain";
import { demoBook, demoCandles, type Book } from "../lib/demo";
import { fmt } from "../lib/format";
import { XLM_LOGO } from "../lib/xlm";
import { ASSET_LIST, badgeOf, testnetKey } from "../lib/assets";

/** Curated asset list (stablecoins + popular assets, v3 pools) as picker options. */
const CURATED_OPTS: PickerOption[] = ASSET_LIST.filter((a) => a.testnet.kind !== "native").map((a) => ({ key: testnetKey(a), code: a.code, sub: `${badgeOf(a).text}${a.org ? ` · ${a.org}` : ""}`, logo: a.logo }));

const px = (v: number) => (v >= 0.01 ? fmt(v, 5) : v.toPrecision(4));
const DEFAULT_BASE = "XLM";
const DEFAULT_QUOTE = assetKeyOf(ASSETS.USDC);
const XLM_OPT: PickerOption = { key: "XLM", code: "XLM", sub: "Stellar Lumens (native)", logo: XLM_LOGO };
const USDC_OPT: PickerOption = { key: DEFAULT_QUOTE, code: "USDC", sub: "Circle testnet issuer", logo: null };

function LimitPanel({ book, baseKey, quoteKey, BASE, QUOTE }: { book: Book; baseKey: string; quoteKey: string; BASE: string; QUOTE: string }) {
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [price, setPriceRaw] = useState(() => (book.asks[0]?.price ?? book.bids[0]?.price ?? 0.1234).toFixed(5));
  const [touched, setTouched] = useState(false);
  const setPrice = (v: string) => {
    setTouched(true);
    setPriceRaw(v);
  };
  const [amount, setAmount] = useState("1000");
  const ref = book.asks[0]?.price ?? book.bids[0]?.price;
  useEffect(() => {
    if (!touched && ref) setPriceRaw(ref < 0.01 ? ref.toPrecision(4) : ref.toFixed(5));
  }, [ref, touched]);
  const tx = useTx(false);
  const total = Number(price) * Number(amount);
  return (
    <>
      <Tabs value={side} onChange={setSide} options={[{ v: "buy", label: `Buy ${BASE}` }, { v: "sell", label: `Sell ${BASE}` }]} />
      <div className="field"><label>Limit price ({QUOTE} per {BASE})</label><input className="input" value={price} onChange={(e) => setPrice(e.target.value)} /></div>
      <div className="field"><label>Amount ({BASE})</label><input className="input" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
      <div className="row between muted" style={{ fontSize: "0.85rem", marginBottom: 12 }}><span>Total</span><span className="mono">{fmt(total, 4)} {QUOTE}</span></div>
      <div className="notice warn">Missing trustlines (e.g. {QUOTE === "XLM" ? BASE : QUOTE}) are added automatically in the same transaction.</div>
      <button
        className={`btn block ${side}`}
        disabled={tx.busy}
        onClick={() =>
          tx.run(`${side} offer`, async () => {
            const xdr = await buildLimitOrder(tx.wallet.address!, side, assetFromKey(baseKey), assetFromKey(quoteKey), Number(amount), Number(price));
            const r = await submitSignedXdr(await tx.wallet.sign(xdr));
            return r.hash.slice(0, 10);
          })
        }
      >
        Place {side} order on SDEX
      </button>
      <TxStatus status={tx.status} />
    </>
  );
}

export default function Trade({ mode = "exchange" }: { mode?: "exchange" } = {}) {
  const [params, setParams] = useSearchParams();
  const baseKey = params.get("base") || DEFAULT_BASE;
  const quoteKey = params.get("quote") || (baseKey === DEFAULT_BASE ? DEFAULT_QUOTE : "XLM");
  const isDefault = baseKey === DEFAULT_BASE && quoteKey === DEFAULT_QUOTE;
  const [market, setMarket] = useState<MarketRow[]>([]);
  useEffect(() => {
    loadMarkets("testnet", { itemsPerPage: 30, enrich: 0 }).then((d) => setMarket(d.rows)).catch(() => void 0);
  }, []);
  const options = useMemo(() => {
    const opts = [XLM_OPT, USDC_OPT, ...CURATED_OPTS.filter((o) => o.key !== DEFAULT_QUOTE), ...market.filter((r) => r.key !== DEFAULT_QUOTE).map(toOption)];
    const u = market.find((r) => r.key === DEFAULT_QUOTE);
    if (u) opts[1] = { ...toOption(u), sub: u.orgName ?? USDC_OPT.sub };
    const seen = new Set<string>();
    return opts.filter((o) => (seen.has(o.key) ? false : (seen.add(o.key), true)));
  }, [market]);
  const optFor = (key: string): PickerOption => options.find((o) => o.key === key) ?? { key, code: key.split("-")[0], sub: key.includes("-") ? `${key.split("-")[1].slice(0, 4)}…${key.split("-")[1].slice(-4)}` : null };
  const baseOpt = optFor(baseKey), quoteOpt = optFor(quoteKey);
  const BASE = baseOpt.code, QUOTE = quoteOpt.code;
  const pick = (which: "base" | "quote", o: PickerOption) => {
    const next = { base: baseKey, quote: quoteKey, [which]: o.key };
    if (next.base === next.quote) next[which === "base" ? "quote" : "base"] = next.base === "XLM" ? DEFAULT_QUOTE : "XLM";
    setParams(next.base === DEFAULT_BASE && next.quote === DEFAULT_QUOTE ? {} : next);
  };

  const [book, setBook] = useState<Book>(() => (isDefault ? demoBook() : { bids: [], asks: [], source: "horizon" }));
  const [liveCandles, setLiveCandles] = useState<ReturnType<typeof demoCandles> | null>(null);
  useEffect(() => {
    let alive = true;
    const b = assetFromKey(baseKey), q = assetFromKey(quoteKey);
    setLiveCandles(null);
    const load = async () => {
      const ob = await fetchOrderBook(b, q, isDefault);
      if (alive) setBook(ob);
    };
    load();
    fetchTradeCandles(b, q).then((c) => alive && c && c.length > 10 && setLiveCandles(c));
    const t = setInterval(load, 15_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [baseKey, quoteKey, isDefault]);
  const bookMid = book.bids[0] && book.asks[0] ? (book.bids[0].price + book.asks[0].price) / 2 : book.bids[0]?.price ?? book.asks[0]?.price ?? 0;
  // Use Horizon trade history only if it is consistent with the live book
  // (testnet history is often polluted by junk trades); else a demo series.
  const { candles, chartSource } = useMemo(() => {
    if (liveCandles && bookMid) {
      const cl = liveCandles.map((c) => c.c).sort((a, b) => a - b);
      const med = cl[Math.floor(cl.length / 2)];
      if (Math.abs(med / bookMid - 1) < 0.3) return { candles: liveCandles, chartSource: "Horizon trade aggregations (1h)" };
    }
    if (liveCandles && !isDefault) return { candles: liveCandles, chartSource: "Horizon trade aggregations (1h)" };
    if (!isDefault) return { candles: [], chartSource: "No Horizon trade history for this pair on testnet" };
    const d = demoCandles();
    const k = (bookMid || d[d.length - 1].c) / d[d.length - 1].c;
    return { candles: d.map((c) => ({ ...c, o: c.o * k, h: c.h * k, l: c.l * k, c: c.c * k })), chartSource: "Demo price series (scaled to live mid)" };
  }, [liveCandles, bookMid, isDefault]);
  const last = bookMid || (candles[candles.length - 1]?.c ?? 0);
  const first = candles[0]?.o ?? 0;
  const change = useMemo(() => (first && last ? ((last - first) / first) * 100 : 0), [last, first]);

  return (
    <>
      <PageHead kicker="Exchange" title="Exchange" right={<span className="pill gold" data-mode={mode}>Testnet · unaudited</span>}>
        Order-book trading on Stellar's native decentralized exchange (SDEX): order book, price history and limit orders.
      </PageHead>
      <div className="grid g-trade">
        <div className="card"><h2>Order book</h2><OrderBook book={book} base={BASE} quote={QUOTE} />{!book.bids.length && !book.asks.length && <p className="muted">No offers on the testnet SDEX for this pair.</p>}</div>
        <div className="grid" style={{ alignContent: "start" }}>
          <div className="card glow">
            <div className="row between ticker" style={{ marginBottom: 10, flexWrap: "wrap", gap: 16 }}>
              <div className="row" style={{ gap: 12 }}>
                <AssetPicker label="Base asset" value={baseOpt} options={options} onChange={(o) => pick("base", o)} />
                <span className="muted">/</span>
                <AssetPicker label="Quote asset" value={quoteOpt} options={options} onChange={(o) => pick("quote", o)} />
                <span className="pill">SDEX</span>
              </div>
              <Stat label="Mid" value={last ? px(last) : "—"} />
              <Stat label="Change" value={`${change >= 0 ? "+" : ""}${fmt(change, 2)}%`} className={change >= 0 ? "pos" : "neg"} />
              <Stat label="Best bid" value={book.bids[0] ? px(book.bids[0].price) : "—"} className="pos" />
              <Stat label="Best ask" value={book.asks[0] ? px(book.asks[0].price) : "—"} className="neg" />
            </div>
            {candles.length ? <PriceChart candles={candles} /> : <div className="muted" style={{ height: 220, display: "grid", placeItems: "center" }}>No price history for {BASE}/{QUOTE} on testnet yet.</div>}
            <div className="muted" style={{ fontSize: "0.7rem", textAlign: "right" }}>{chartSource} · asset list, logos & org names: {STELLARCHAIN_ATTRIBUTION}</div>
          </div>
          <div className="grid g-2">
            <div className="card"><Stat label="SDEX" value="Offers" sub="manageBuy/SellOffer, auto trustlines" /></div>
            <div className="card"><Stat label="Paths" value="Best route" sub="strict-send path payments via Horizon" /></div>
          </div>
        </div>
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Limit order (SDEX)</h2>
          <LimitPanel key={`${baseKey}/${quoteKey}`} book={book} baseKey={baseKey} quoteKey={quoteKey} BASE={BASE} QUOTE={QUOTE} />
        </div>
      </div>
    </>
  );
}
