import { useEffect, useMemo, useState } from "react";
import { Asset } from "@stellar/stellar-sdk";
import { useSearchParams } from "react-router-dom";
import { PageHead, Stat, Tabs, TxStatus, useTx } from "../components/ui";
import OrderBook from "../components/OrderBook";
import PriceChart from "../components/PriceChart";
import { AssetPicker, type PickerOption } from "../components/AssetBits";
import {
  ASSETS, assetFromKey, assetKeyOf, buildCancelOffer, buildLimitOrder, buildPathPayment, fetchBalances, fetchOpenOffers, fetchOrderBook, fetchTradeCandles,
  minReceived, quoteSwap, submitSignedXdr, hasTrustline, type Book, type Balance, type SwapQuote,
} from "../lib/stellar";
import { curatedList, verifyAsset, type AssetRef } from "../lib/nativePools";
import { STELLARCHAIN_ATTRIBUTION } from "../lib/stellarchain";
import { useAsync } from "../lib/useAsync";
import { fmt } from "../lib/format";

const px = (v: number) => (v >= 0.01 ? fmt(v, 5) : v.toPrecision(4));
const DEFAULT_BASE = "XLM";
const DEFAULT_QUOTE = assetKeyOf(ASSETS.USDC);
const refOf = (a: Asset): AssetRef => (a.isNative() ? { code: "XLM", issuer: null } : { code: a.getCode(), issuer: a.getIssuer() ?? null });

/** Curated, issuer-verified assets (matched by code AND issuer) as picker options. */
const OPTIONS: PickerOption[] = curatedList("testnet").map((c) => ({ key: c.issuer ? `${c.code}-${c.issuer}` : "XLM", code: c.code, logo: c.logo,
  sub: c.issuer ? `${c.name} · ${c.verification === "testnet-official" ? "official testnet issuer" : c.verification === "quasaria-issuer" ? "Quasaria issuer" : "Quasaria demo"}` : "Stellar Lumens (native)" }));

function VerifyNote({ keys }: { keys: string[] }) {
  const bad = keys.map((k) => ({ k, v: verifyAsset("testnet", refOf(assetFromKey(k))) })).filter((x) => x.v.status === "unverified" || x.v.status === "lookalike");
  if (!bad.length) return null;
  return (
    <div className="notice warn" role="alert" data-testid="unverified-note" style={{ fontSize: "0.82rem", marginBottom: 10 }}>
      <b>Unverified asset.</b> {bad.map((x) => x.k.split("-")[0]).join(", ")} is not on Quasaria's issuer-verified list{bad.some((x) => x.v.status === "lookalike") ? " (same ticker as a verified asset but a DIFFERENT issuer: possible look-alike)" : ""}. Anyone can issue any ticker. Check the issuer before you trade.
    </div>
  );
}

function SwapPanel({ fromKey, toKey, onFlip }: { fromKey: string; toKey: string; onFlip: () => void }) {
  const [amountIn, setAmountIn] = useState("100");
  const [slippage, setSlippage] = useState(0.5);
  const tx = useTx();
  const from = assetFromKey(fromKey), to = assetFromKey(toKey);
  const amt = Number(amountIn);
  const quote = useAsync<SwapQuote | null>(async () => { await new Promise((r) => setTimeout(r, 350)); return amt > 0 ? quoteSwap(from, amt, to) : null; }, [fromKey, toKey, amountIn]);
  const [bal, setBal] = useState<Balance[] | null>(null);
  useEffect(() => { if (tx.wallet.address) fetchBalances(tx.wallet.address).then(setBal).catch(() => setBal(null)); else setBal(null); }, [tx.wallet.address, tx.status]);
  const have = bal?.find((b) => (from.isNative() ? b.isNative : b.code === from.getCode() && b.issuer === from.getIssuer()))?.balance ?? null;
  const needTrust = bal && !hasTrustline(bal, to);
  const q = quote.data;
  const min = q ? minReceived(q.destAmount, slippage) : 0;
  const code = (a: Asset) => (a.isNative() ? "XLM" : a.getCode());
  return (
    <div data-testid="swap-panel">
      <div className="field"><label>You pay ({code(from)}){have !== null && <span className="muted"> · balance {fmt(have, 4)}</span>}</label>
        <input className="input" inputMode="decimal" value={amountIn} onChange={(e) => setAmountIn(e.target.value)} data-testid="swap-amount" /></div>
      <div className="row" style={{ justifyContent: "center", margin: "2px 0 8px" }}><button className="btn small ghost" onClick={onFlip} aria-label="Flip pair">⇅ Flip</button></div>
      <div className="field"><label>You receive ({code(to)}), quoted</label>
        <div className="input mono" data-testid="swap-out">{quote.loading ? "…" : q ? fmt(q.destAmount, 7) : amt > 0 ? "no route" : "—"}</div></div>
      {q && <div className="row between" style={{ fontSize: "0.82rem" }}><span className="muted">Rate</span><span className="mono">1 {code(from)} ≈ {px(q.rate)} {code(to)}</span></div>}
      {q && <div className="row between" style={{ fontSize: "0.82rem" }}><span className="muted">Route</span><span className="mono">{[code(from), ...q.path.map(code), code(to)].join(" → ")}</span></div>}
      {q && <div className="row between" style={{ fontSize: "0.82rem" }}><span className="muted">Minimum received ({slippage}% slippage)</span><span className="mono" data-testid="swap-min">{fmt(min, 7)} {code(to)}</span></div>}
      <div className="field" style={{ marginTop: 10 }}>
        <label>Max slippage: {slippage}%</label>
        <input type="range" min={0.1} max={5} step={0.1} value={slippage} onChange={(e) => setSlippage(Number(e.target.value))} />
      </div>
      {tx.wallet.address && needTrust && <div className="notice" style={{ fontSize: "0.78rem" }}>Receiving {code(to)} needs a trustline. It is added in the same transaction (reserve 0.5 XLM).</div>}
      <p className="muted" style={{ fontSize: "0.74rem" }}>Swaps are Stellar's own: the path finder uses the order book and native liquidity pools together. Pool swaps charge the pool's 0.30% fee, which goes to liquidity providers. The transaction fails instead of filling below the minimum received.</p>
      <button className="btn block" disabled={tx.busy || !q} data-testid="swap-btn" onClick={() => tx.run("swap", async () => {
        const me = tx.wallet.address!;
        const fresh = await quoteSwap(from, amt, to);
        if (!fresh) throw new Error("no route right now");
        const xdr = await buildPathPayment(me, from, amt, to, minReceived(fresh.destAmount, slippage), fresh.path);
        const r = await submitSignedXdr(await tx.wallet.sign(xdr));
        return r.hash;
      })}>Swap {code(from)} → {code(to)}</button>
      <TxStatus status={tx.status} />
    </div>
  );
}

function LimitPanel({ book, baseKey, quoteKey, BASE, QUOTE }: { book: Book; baseKey: string; quoteKey: string; BASE: string; QUOTE: string }) {
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const ref = book.asks[0]?.price ?? book.bids[0]?.price;
  const [price, setPrice] = useState("");
  const [amount, setAmount] = useState("100");
  const [touched, setTouched] = useState(false);
  useEffect(() => { if (!touched && ref) setPrice(ref < 0.01 ? ref.toPrecision(4) : ref.toFixed(5)); }, [ref, touched]);
  const tx = useTx();
  const offers = useAsync(async () => (tx.wallet.address ? fetchOpenOffers(tx.wallet.address) : []), [tx.wallet.address, tx.status]);
  const total = Number(price) * Number(amount);
  return (
    <div data-testid="limit-panel">
      <Tabs value={side} onChange={setSide} options={[{ v: "buy", label: `Buy ${BASE}` }, { v: "sell", label: `Sell ${BASE}` }]} />
      <div className="field"><label>Limit price ({QUOTE} per {BASE})</label><input className="input" value={price} onChange={(e) => { setTouched(true); setPrice(e.target.value); }} /></div>
      <div className="field"><label>Amount ({BASE})</label><input className="input" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
      <div className="row between muted" style={{ fontSize: "0.85rem", marginBottom: 12 }}><span>Total</span><span className="mono">{fmt(total, 4)} {QUOTE}</span></div>
      <div className="notice" style={{ fontSize: "0.78rem" }}>Offers stay on Stellar's order book until filled or cancelled. A missing trustline is added automatically in the same transaction.</div>
      <button className={`btn block ${side}`} disabled={tx.busy || !(total > 0)} onClick={() => tx.run(`${side} offer`, async () => {
        const xdr = await buildLimitOrder(tx.wallet.address!, side, assetFromKey(baseKey), assetFromKey(quoteKey), Number(amount), Number(price));
        const r = await submitSignedXdr(await tx.wallet.sign(xdr));
        return r.hash;
      })}>Place {side} order on the order book</button>
      <TxStatus status={tx.status} />
      {tx.wallet.address && (offers.data?.length ?? 0) > 0 && (
        <div style={{ marginTop: 14 }} data-testid="open-offers">
          <h3 style={{ margin: "0 0 6px", fontSize: "0.95rem" }}>Your open offers</h3>
          {offers.data!.map((o) => {
            const sell = o.selling.asset_type === "native" ? Asset.native() : new Asset(o.selling.asset_code!, o.selling.asset_issuer!);
            const buy = o.buying.asset_type === "native" ? Asset.native() : new Asset(o.buying.asset_code!, o.buying.asset_issuer!);
            return (
              <div key={o.id} className="row between" style={{ fontSize: "0.82rem", gap: 8 }}>
                <span className="mono">{fmt(Number(o.amount), 2)} {sell.isNative() ? "XLM" : sell.getCode()} @ {o.price} {buy.isNative() ? "XLM" : buy.getCode()}</span>
                <button className="btn small ghost neg" disabled={tx.busy} onClick={() => tx.run("cancel offer", async () => (await submitSignedXdr(await tx.wallet.sign(await buildCancelOffer(tx.wallet.address!, { id: String(o.id), selling: sell, buying: buy, price: o.price })))).hash)}>Cancel</button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function Trade() {
  const [params, setParams] = useSearchParams();
  const baseKey = params.get("base") || DEFAULT_BASE;
  const quoteKey = params.get("quote") || (baseKey === DEFAULT_BASE ? DEFAULT_QUOTE : "XLM");
  const optFor = (key: string): PickerOption => OPTIONS.find((o) => o.key === key) ?? { key, code: key.split("-")[0], sub: key.includes("-") ? `unverified · ${key.split("-")[1].slice(0, 4)}…${key.split("-")[1].slice(-4)}` : null };
  const options = useMemo(() => {
    const extra = [baseKey, quoteKey].filter((k) => !OPTIONS.some((o) => o.key === k)).map(optFor);
    return [...OPTIONS, ...extra];
  }, [baseKey, quoteKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const baseOpt = optFor(baseKey), quoteOpt = optFor(quoteKey);
  const BASE = baseOpt.code, QUOTE = quoteOpt.code;
  const setPair = (b: string, q: string) => setParams(b === DEFAULT_BASE && q === DEFAULT_QUOTE ? {} : { base: b, quote: q });
  const pick = (which: "base" | "quote", o: PickerOption) => {
    const next = { base: baseKey, quote: quoteKey, [which]: o.key };
    if (next.base === next.quote) next[which === "base" ? "quote" : "base"] = next.base === "XLM" ? DEFAULT_QUOTE : "XLM";
    setPair(next.base, next.quote);
  };

  const [book, setBook] = useState<Book>({ bids: [], asks: [], source: "horizon" });
  const [candles, setCandles] = useState<Awaited<ReturnType<typeof fetchTradeCandles>>>(null);
  const [tab, setTab] = useState<"swap" | "limit">("swap");
  useEffect(() => {
    let alive = true;
    const b = assetFromKey(baseKey), q = assetFromKey(quoteKey);
    setCandles(null);
    const load = async () => { const ob = await fetchOrderBook(b, q); if (alive) setBook(ob); };
    load();
    fetchTradeCandles(b, q).then((c) => alive && setCandles(c));
    const t = setInterval(() => { if (!document.hidden) load(); }, 15_000);
    return () => { alive = false; clearInterval(t); };
  }, [baseKey, quoteKey]);
  const mid = book.bids[0] && book.asks[0] ? (book.bids[0].price + book.asks[0].price) / 2 : book.bids[0]?.price ?? book.asks[0]?.price ?? 0;
  const last = mid || (candles?.[candles.length - 1]?.c ?? 0);
  const first = candles?.[0]?.o ?? 0;
  const change = first && last ? ((last - first) / first) * 100 : 0;

  return (
    <>
      <PageHead kicker="Scene · Quasar Core" title="Trade" right={<span className="pill cyan">Order book + native pools · Testnet</span>}>
        Swap through Stellar's own order book and liquidity pools, or place a limit order. No Quasaria contract sits between you and the ledger.
      </PageHead>
      <VerifyNote keys={[baseKey, quoteKey]} />
      <div className="grid g-trade">
        <div className="card"><h2>Order book</h2><OrderBook book={book} base={BASE} quote={QUOTE} />{!book.bids.length && !book.asks.length && <p className="muted" data-testid="empty-book">No offers on the testnet order book for this pair. Pool swaps may still have a route.</p>}</div>
        <div className="grid" style={{ alignContent: "start" }}>
          <div className="card glow">
            <div className="row between ticker" style={{ marginBottom: 10, flexWrap: "wrap", gap: 16 }}>
              <div className="row" style={{ gap: 12 }}>
                <AssetPicker label="Base asset" value={baseOpt} options={options} onChange={(o) => pick("base", o)} />
                <span className="muted">/</span>
                <AssetPicker label="Quote asset" value={quoteOpt} options={options} onChange={(o) => pick("quote", o)} />
                <span className="pill">Order book</span>
              </div>
              <Stat label="Mid" value={last ? px(last) : "—"} />
              <Stat label="Change" value={`${change >= 0 ? "+" : ""}${fmt(change, 2)}%`} className={change >= 0 ? "pos" : "neg"} />
              <Stat label="Best bid" value={book.bids[0] ? px(book.bids[0].price) : "—"} className="pos" />
              <Stat label="Best ask" value={book.asks[0] ? px(book.asks[0].price) : "—"} className="neg" />
            </div>
            {candles?.length ? <PriceChart candles={candles} /> : <div className="muted" style={{ height: 220, display: "grid", placeItems: "center" }}>No price history for {BASE}/{QUOTE} on testnet yet.</div>}
            <div className="muted" style={{ fontSize: "0.7rem", textAlign: "right" }}>Horizon trade aggregations (1h) · asset list &amp; logos: {STELLARCHAIN_ATTRIBUTION}</div>
          </div>
          <div className="grid g-3">
            <div className="card"><Stat label="Order book" value="Offers" sub="manage buy / sell offers, automatic trustlines" /></div>
            <div className="card"><Stat label="Paths" value="Best route" sub="strict-send path payments across book + pools" /></div>
            <div className="card"><Stat label="Pools" value="0.30% fee" sub="paid to liquidity providers, not to Quasaria" /></div>
          </div>
        </div>
        <div className="card">
          <Tabs value={tab} onChange={setTab} options={[{ v: "swap", label: "Swap" }, { v: "limit", label: "Limit (order book)" }]} />
          {tab === "swap" ? <SwapPanel fromKey={baseKey} toKey={quoteKey} onFlip={() => setPair(quoteKey, baseKey)} /> : <LimitPanel key={`${baseKey}/${quoteKey}`} book={book} baseKey={baseKey} quoteKey={quoteKey} BASE={BASE} QUOTE={QUOTE} />}
        </div>
      </div>
    </>
  );
}
