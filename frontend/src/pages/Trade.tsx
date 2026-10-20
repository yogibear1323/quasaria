import { curatedList } from "../lib/nativePools";
import { NETWORK, IS_MAINNET } from "../lib/config";
import { useEffect, useMemo, useState } from "react";
import { Asset } from "@stellar/stellar-sdk";
import { PageHead, Stat, Tabs, TxStatus, useTx } from "../components/ui";
import OrderBook from "../components/OrderBook";
import PriceChart from "../components/PriceChart";
import { ASSETS, assetFromKey, assetKeyOf, buildCancelOffer, buildLimitOrder, fetchOpenOffers, fetchOrderBook, fetchTradeCandles, horizon, submitSignedXdr } from "../lib/stellar";
import { Link, useSearchParams } from "react-router-dom";
import { AssetPicker, toOption, type PickerOption } from "../components/AssetBits";
import { loadMarkets, type MarketRow } from "../lib/markets";
import { STELLARCHAIN_ATTRIBUTION } from "../lib/stellarchain";
import type { Book } from "../lib/demo";
import { TxLink } from "../components/TxLink";
import { useWallet } from "../lib/wallet";
import { useAsync } from "../lib/useAsync";
import { fetchBaseReserve, fetchRawAccount } from "../lib/account";
import { checkFunds, planMarket, type MarketPlan, type Side } from "../lib/market";
import { executeMarket, type MarketRun } from "../lib/marketRun";
import { NETWORK_PASSPHRASE } from "../lib/config";
import { fmt } from "../lib/format";
import { XLM_ABOUT_PATH, XLM_LOGO } from "../lib/xlm";
import { ASSET_LIST, badgeOf, testnetKey } from "../lib/assets";

/** Curated asset list (stablecoins + popular assets, v3 pools) as picker options. */
const CURATED_OPTS: PickerOption[] = IS_MAINNET
  ? curatedList("mainnet").filter((a) => a.issuer).map((a) => ({ key: `${a.code}-${a.issuer}`, code: a.code, sub: `${a.name}${a.homeDomain ? ` · ${a.homeDomain}` : ""}`, logo: a.logo }))
  : ASSET_LIST.filter((a) => a.testnet.kind !== "native").map((a) => ({ key: testnetKey(a), code: a.code, sub: `${badgeOf(a).text}${a.org ? ` · ${a.org}` : ""}`, logo: a.logo }));

const px = (v: number) => (v >= 0.01 ? fmt(v, 5) : v.toPrecision(4));
const DEFAULT_BASE = "XLM";
const DEFAULT_QUOTE = assetKeyOf(ASSETS.USDC);
const XLM_OPT: PickerOption = { key: "XLM", code: "XLM", sub: "Stellar Lumens (native)", logo: XLM_LOGO };
const USDC_OPT: PickerOption = { key: DEFAULT_QUOTE, code: "USDC", sub: IS_MAINNET ? "Circle (verified issuer)" : "Circle testnet issuer", logo: null };

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
  const tx = useTx();
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
            return r.hash;
          })
        }
      >
        Place {side} order on SDEX
      </button>
      <TxStatus status={tx.status} />
    </>
  );
}


const refOfKey = (k: string) => { const a = assetFromKey(k); return { code: a.isNative() ? "XLM" : a.getCode(), issuer: a.isNative() ? null : a.getIssuer() ?? null }; };
const nfmt = (v: number, d = 7) => v.toLocaleString("en-US", { maximumFractionDigits: d });

/** Instant buy/sell against the SDEX book. One tap opens a confirm step; nothing is signed before Confirm. */
function MarketPanel({ baseKey, quoteKey, BASE, QUOTE, onDone }: { baseKey: string; quoteKey: string; BASE: string; QUOTE: string; onDone: () => void }) {
  const w = useWallet();
  const [side, setSide] = useState<Side>("buy");
  const [amount, setAmount] = useState("");
  const [stage, setStage] = useState<"form" | "confirm">("form");
  const [frozen, setFrozen] = useState<{ plan: Extract<MarketPlan, { ok: true }>; feeXlm: number; reserveXlm: number; needTrust: Asset[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [res, setRes] = useState<MarketRun | null>(null);
  const base = assetFromKey(baseKey), quote = assetFromKey(quoteKey);

  const tap = async () => {
    setErr(null); setRes(null);
    if (!w.address) { w.openModal(); return; }
    const amt = Number(amount);
    if (!(amt > 0)) { setErr("Enter an amount."); return; }
    setBusy(true);
    try {
      const book = await fetchOrderBook(base, quote, false);
      const plan = planMarket(side, amt, book);
      if (!plan.ok) { setErr(plan.reason === "empty" ? `There are no offers on the order book to ${side} ${BASE} against right now.` : "Enter an amount."); return; }
      const [acct, reserve] = await Promise.all([fetchRawAccount(NETWORK, w.address), fetchBaseReserve(NETWORK)]);
      const f = checkFunds({ side, plan, base: refOfKey(baseKey), quote: refOfKey(quoteKey), acct, baseReserve: reserve });
      if (!f.ok) { setErr(f.error); return; }
      setFrozen({ plan, feeXlm: f.feeXlm, reserveXlm: f.reserveXlm, needTrust: f.needTrust.map((r) => (r.issuer ? new Asset(r.code, r.issuer) : Asset.native())) });
      setStage("confirm");
    } catch (e) { setErr(`Could not read the order book: ${e instanceof Error ? e.message : String(e)}`); } finally { setBusy(false); }
  };
  const confirm = async () => {
    if (!frozen || !w.address) return;
    setBusy(true); setErr(null);
    try {
      const address = w.address;
      const out = await executeMarket({ address, side, base, quote, baseCode: BASE, quoteCode: QUOTE, plan: frozen.plan, needTrust: frozen.needTrust, passphrase: NETWORK_PASSPHRASE, deps: {
        sequence: async () => (await horizon.loadAccount(address)).sequenceNumber(),
        sign: (x) => w.sign(x),
        submit: async (x) => { const r = await submitSignedXdr(x); return { hash: r.hash, result_xdr: r.result_xdr }; },
        openOffers: async () => (await fetchOpenOffers(address)).map((o) => ({ id: String(o.id), selling: o.selling.asset_type === "native" ? Asset.native() : new Asset(o.selling.asset_code!, o.selling.asset_issuer!), buying: o.buying.asset_type === "native" ? Asset.native() : new Asset(o.buying.asset_code!, o.buying.asset_issuer!), price: Number(o.price) })),
      } });
      setRes(out); setStage("form"); setFrozen(null); setAmount(""); onDone();
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); setStage("form"); setFrozen(null); } finally { setBusy(false); }
  };

  if (stage === "confirm" && frozen) {
    const p = frozen.plan;
    return (
      <div data-testid="market-confirm">
        <h3 style={{ margin: "0 0 4px", fontSize: "1rem" }}>Confirm {side === "buy" ? "buy" : "sell"}</h3>
        <dl className="kv" style={{ margin: "6px 0 10px" }}>
          <div><dt>Side</dt><dd className={side === "buy" ? "pos" : "neg"}>{side === "buy" ? "Buy" : "Sell"}</dd></div>
          <div><dt>Pair</dt><dd>{BASE} / {QUOTE}</dd></div>
          <div><dt>Amount</dt><dd className="mono">{nfmt(p.amount)} {BASE}</dd></div>
          <div><dt>Approx. avg price</dt><dd className="mono" data-testid="confirm-avg">{nfmt(Number(p.estAvg.toPrecision(6)))} {QUOTE}</dd></div>
          <div><dt>Approx. total</dt><dd className="mono" data-testid="confirm-total">{nfmt(p.estQuote, 4)} {QUOTE}</dd></div>
          <div><dt>Network fee</dt><dd className="mono">{nfmt(frozen.feeXlm)} XLM</dd></div>
          {frozen.reserveXlm > 0 && <div><dt>Reserve</dt><dd>{nfmt(frozen.reserveXlm)} XLM set aside for a new {frozen.needTrust.map((a) => (a.isNative() ? "XLM" : a.getCode())).join(", ")} trustline</dd></div>}
        </dl>
        {!p.full && <div className="notice warn" data-testid="thin-warning" style={{ fontSize: "0.82rem" }}>Thin book: only about {nfmt(p.estBase, 4)} of {nfmt(p.amount, 4)} {BASE} can be filled right now. Anything that can't fill is cancelled, never left on the book.</div>}
        <p className="muted l-tiny">Estimate from the live order book. The final price can differ slightly if the book moves before your order lands.</p>
        {err && <div className="notice" role="alert">{err}</div>}
        <div className="row" style={{ gap: 8 }}>
          <button className={`btn ${side}`} onClick={confirm} disabled={busy} data-testid="market-confirm-btn">{busy ? "Working…" : "Confirm"}</button>
          <button className="btn ghost" onClick={() => { setStage("form"); setFrozen(null); }} disabled={busy} data-testid="market-cancel-btn">Cancel</button>
        </div>
      </div>
    );
  }
  return (
    <div data-testid="market-panel">
      <Tabs value={side} onChange={(v) => { setSide(v); setErr(null); }} options={[{ v: "buy", label: `Buy ${BASE}` }, { v: "sell", label: `Sell ${BASE}` }]} />
      <div className="field"><label>Amount ({BASE})</label><input className="input mono" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.0" data-testid="market-amount" /></div>
      <p className="muted l-tiny" style={{ margin: "0 0 10px" }}>Fills right away against the best offers on the SDEX order book. Any part that can't fill is cancelled.</p>
      {err && <div className="notice" role="alert" data-testid="market-error" style={{ marginBottom: 10 }}>{err}</div>}
      <button className={`btn block ${side}`} onClick={tap} disabled={busy} data-testid="market-tap">{busy ? "Checking…" : `${side === "buy" ? "Buy" : "Sell"} ${BASE}`}</button>
      {res && (
        <div className={`notice ${res.outcome.kind === "filled" ? "tx-ok" : res.outcome.kind === "none" ? "warn" : ""}`} role="status" data-testid="market-result" style={{ marginTop: 12 }}>
          {res.outcome.text} <TxLink hash={res.hash} net={NETWORK} chars={10} />
          {res.warning && <div style={{ marginTop: 6 }}>{res.warning}</div>}
        </div>
      )}
    </div>
  );
}

function OpenOffers({ tick, onChange }: { tick: number; onChange: () => void }) {
  const w = useWallet();
  const tx = useTx();
  const offers = useAsync(async () => (w.address ? fetchOpenOffers(w.address) : []), [w.address, tick, tx.status]);
  if (!w.address || !(offers.data?.length)) return null;
  return (
    <div style={{ marginTop: 16 }} data-testid="open-offers">
      <h3 style={{ margin: "0 0 6px", fontSize: "0.95rem" }}>Your open offers</h3>
      {offers.data.map((o) => {
        const sell = o.selling.asset_type === "native" ? Asset.native() : new Asset(o.selling.asset_code!, o.selling.asset_issuer!);
        const buy = o.buying.asset_type === "native" ? Asset.native() : new Asset(o.buying.asset_code!, o.buying.asset_issuer!);
        return (
          <div key={o.id} className="row between" style={{ fontSize: "0.82rem", gap: 8, padding: "4px 0" }}>
            <span className="mono">{fmt(Number(o.amount), 2)} {sell.isNative() ? "XLM" : sell.getCode()} @ {o.price} {buy.isNative() ? "XLM" : buy.getCode()}</span>
            <button className="btn small ghost neg" disabled={tx.busy} onClick={() => tx.run("cancel offer", async () => { const r = await submitSignedXdr(await w.sign(await buildCancelOffer(w.address!, { id: String(o.id), selling: sell, buying: buy, price: o.price }))); onChange(); return r.hash; })}>Cancel</button>
          </div>
        );
      })}
      <TxStatus status={tx.status} />
    </div>
  );
}

function OrderCard({ book, baseKey, quoteKey, BASE, QUOTE, onDone }: { book: Book; baseKey: string; quoteKey: string; BASE: string; QUOTE: string; onDone: () => void }) {
  const [kind, setKind] = useState<"market" | "limit">("limit");
  const [tick, setTick] = useState(0);
  return (
    <div className="card" data-testid="order-card">
      <Tabs value={kind} onChange={setKind} options={[{ v: "limit", label: "Limit" }, { v: "market", label: "Market" }]} />
      {kind === "limit"
        ? <LimitPanel key={`${baseKey}/${quoteKey}`} book={book} baseKey={baseKey} quoteKey={quoteKey} BASE={BASE} QUOTE={QUOTE} />
        : <MarketPanel key={`m-${baseKey}/${quoteKey}`} baseKey={baseKey} quoteKey={quoteKey} BASE={BASE} QUOTE={QUOTE} onDone={() => { setTick((t) => t + 1); onDone(); }} />}
      <OpenOffers tick={tick} onChange={() => { setTick((t) => t + 1); onDone(); }} />
    </div>
  );
}

export default function Trade({ mode = "exchange" }: { mode?: "exchange" } = {}) {
  const [params, setParams] = useSearchParams();
  const baseKey = params.get("base") || DEFAULT_BASE;
  const quoteKey = params.get("quote") || (baseKey === DEFAULT_BASE ? DEFAULT_QUOTE : "XLM");
    const [market, setMarket] = useState<MarketRow[]>([]);
  useEffect(() => {
    loadMarkets(NETWORK, { itemsPerPage: 30, enrich: 0 }).then((d) => setMarket(d.rows)).catch(() => void 0);
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

  const [book, setBook] = useState<Book>({ bids: [], asks: [], source: "horizon" });
  const [bookTick, setBookTick] = useState(0);
  const [liveCandles, setLiveCandles] = useState<Awaited<ReturnType<typeof fetchTradeCandles>>>(null);
  useEffect(() => {
    let alive = true;
    const b = assetFromKey(baseKey), q = assetFromKey(quoteKey);
    setLiveCandles(null);
    const load = async () => {
      const ob = await fetchOrderBook(b, q, false);
      if (alive) setBook(ob);
    };
    load();
    fetchTradeCandles(b, q).then((c) => alive && setLiveCandles(c));
    const t = setInterval(load, 15_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [baseKey, quoteKey, bookTick]);
  const bookMid = book.bids[0] && book.asks[0] ? (book.bids[0].price + book.asks[0].price) / 2 : book.bids[0]?.price ?? book.asks[0]?.price ?? 0;
  // Use Horizon trade history only if it is consistent with the live book (testnet history is often polluted by junk trades). No invented series.
  const { candles, chartSource } = useMemo(() => {
    if (liveCandles && liveCandles.length > 10) {
      const cl = liveCandles.map((c) => c.c).sort((a, b) => a - b);
      const med = cl[Math.floor(cl.length / 2)];
      if (!bookMid || Math.abs(med / bookMid - 1) < 0.3) return { candles: liveCandles, chartSource: "Horizon trade aggregations (1h)" };
    }
    return { candles: [] as NonNullable<typeof liveCandles>, chartSource: `No Horizon trade history for this pair on ${NETWORK}` };
  }, [liveCandles, bookMid]);
  const last = bookMid || (candles[candles.length - 1]?.c ?? 0);
  const first = candles[0]?.o ?? 0;
  const change = useMemo(() => (first && last ? ((last - first) / first) * 100 : 0), [last, first]);

  return (
    <>
      <PageHead kicker="Exchange" title="Exchange" right={<span className="pill gold" data-mode={mode}>{IS_MAINNET ? "Mainnet · unaudited" : "Testnet · unaudited"}</span>}>
        Order-book trading on Stellar's native decentralized exchange (SDEX): live order book, price history, limit orders and instant market buy / sell.
      </PageHead>
      <div className="grid g-trade">
        <div className="card"><h2>Order book</h2><OrderBook book={book} base={BASE} quote={QUOTE} />{!book.bids.length && !book.asks.length && <p className="muted">No offers on the {NETWORK} SDEX for this pair.</p>}</div>
        <div className="grid" style={{ alignContent: "start" }}>
          <div className="card glow">
            <div className="row between ticker" style={{ marginBottom: 10, flexWrap: "wrap", gap: 16 }}>
              <div className="row" style={{ gap: 12, flexWrap: "wrap" }}>
                <AssetPicker label="Base asset" value={baseOpt} options={options} onChange={(o) => pick("base", o)} />
                <span className="muted">/</span>
                <AssetPicker label="Quote asset" value={quoteOpt} options={options} onChange={(o) => pick("quote", o)} />
                <span className="pill">SDEX</span>
                {(baseOpt?.key === "XLM" || quoteOpt?.key === "XLM") && <Link className="pill cyan" to={XLM_ABOUT_PATH} data-testid="xlm-about-link" title="What XLM is, reserves, fees and network facts">About XLM</Link>}
              </div>
              <Stat label="Mid" value={last ? px(last) : "—"} />
              <Stat label="Change" value={`${change >= 0 ? "+" : ""}${fmt(change, 2)}%`} className={change >= 0 ? "pos" : "neg"} />
              <Stat label="Best bid" value={book.bids[0] ? px(book.bids[0].price) : "—"} className="pos" />
              <Stat label="Best ask" value={book.asks[0] ? px(book.asks[0].price) : "—"} className="neg" />
            </div>
            {candles.length ? <PriceChart candles={candles} /> : <div className="muted" style={{ height: 220, display: "grid", placeItems: "center" }}>No price history for {BASE}/{QUOTE} on {NETWORK} yet.</div>}
            <div className="muted" style={{ fontSize: "0.7rem", textAlign: "right" }}>{chartSource} · asset list, logos & org names: {STELLARCHAIN_ATTRIBUTION}</div>
          </div>
          <div className="grid g-2">
            <div className="card"><Stat label="SDEX" value="Offers" sub="manageBuy/SellOffer, auto trustlines" /></div>
            <div className="card"><Stat label="Paths" value="Best route" sub="strict-send path payments via Horizon" /></div>
          </div>
        </div>
        <OrderCard book={book} baseKey={baseKey} quoteKey={quoteKey} BASE={BASE} QUOTE={QUOTE} onDone={() => setBookTick((t) => t + 1)} />
      </div>
    </>
  );
}
