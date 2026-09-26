import { useEffect, useMemo, useState } from "react";
import { Asset } from "@stellar/stellar-sdk";
import { PageHead, Stat, Tabs, TxStatus, useTx } from "../components/ui";
import OrderBook from "../components/OrderBook";
import PriceChart from "../components/PriceChart";
import { ASSETS, buildLimitOrder, buildPathPayment, fetchOrderBook, fetchTradeCandles, findStrictSendPath, submitSignedXdr } from "../lib/stellar";
import { demoBook, demoCandles, DEMO_POOLS, type Book } from "../lib/demo";
import { ammAmountOut, priceImpact } from "../lib/math";
import { CONTRACTS, CONTRACTS_CONFIGURED, NETWORK_PASSPHRASE } from "../lib/config";
import { addr, i128, invokeContract, u64, vecAddr } from "../lib/soroban";
import { fmt, fmtCompact, toUnits } from "../lib/format";
import { readPool, useChain } from "../lib/chain";

const BASE = "XLM", QUOTE = "USDC";

function LimitPanel({ book }: { book: Book }) {
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [price, setPrice] = useState(() => (book.asks[0]?.price ?? 0.1234).toFixed(5));
  const [amount, setAmount] = useState("1000");
  const tx = useTx(false);
  const total = Number(price) * Number(amount);
  return (
    <>
      <Tabs value={side} onChange={setSide} options={[{ v: "buy", label: `Buy ${BASE}` }, { v: "sell", label: `Sell ${BASE}` }]} />
      <div className="field"><label>Limit price ({QUOTE} per {BASE})</label><input className="input" value={price} onChange={(e) => setPrice(e.target.value)} /></div>
      <div className="field"><label>Amount ({BASE})</label><input className="input" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
      <div className="row between muted" style={{ fontSize: "0.85rem", marginBottom: 12 }}><span>Total</span><span className="mono">{fmt(total, 4)} {QUOTE}</span></div>
      <div className="notice warn">Missing trustlines (e.g. {QUOTE}) are added automatically in the same transaction.</div>
      <button
        className={`btn block ${side}`}
        disabled={tx.busy}
        onClick={() =>
          tx.run(`${side} offer`, async () => {
            const xdr = await buildLimitOrder(tx.wallet.address!, side, ASSETS[BASE], ASSETS[QUOTE], Number(amount), Number(price));
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

function SwapPanel() {
  const [route, setRoute] = useState<"amm" | "sdex">("amm");
  const [amountIn, setAmountIn] = useState("500");
  const [slippage, setSlippage] = useState(0.5);
  const tx = useTx(route === "amm");
  const live = useChain(() => readPool(CONTRACTS.pools[0]), []);
  const pool = live.data
    ? (() => {
        const xlmIsA = live.data.tokenA === CONTRACTS.xlmSac;
        return { reserveA: xlmIsA ? live.data.reserveA : live.data.reserveB, reserveB: xlmIsA ? live.data.reserveB : live.data.reserveA, feeBps: live.data.feeBps };
      })()
    : DEMO_POOLS[0];
  const out = ammAmountOut(Number(amountIn), pool.reserveA, pool.reserveB, pool.feeBps);
  const impact = priceImpact(Number(amountIn), pool.reserveA, pool.reserveB, pool.feeBps);
  const minOut = out * (1 - slippage / 100);
  return (
    <>
      <Tabs value={route} onChange={setRoute} options={[{ v: "amm", label: "Soroban AMM" }, { v: "sdex", label: "SDEX path" }]} />
      <div className="field"><label>You pay (XLM)</label><input className="input" value={amountIn} onChange={(e) => setAmountIn(e.target.value)} /></div>
      <div style={{ textAlign: "center", fontSize: "1.4rem", color: "var(--quasar)", textShadow: "var(--glow-cyan)" }}>⇣</div>
      <div className="field"><label>You receive (est. {route === "amm" ? "QUSD" : "USDC"})</label><input className="input" readOnly value={fmt(out, 4)} /></div>
      <div className="row between" style={{ fontSize: "0.82rem" }}><span className="muted">Price impact</span><span className={impact > 0.01 ? "neg mono" : "mono"}>{fmt(impact * 100, 3)}%</span></div>
      {route === "amm" && <div className="row between" style={{ fontSize: "0.82rem" }}><span className="muted">Pool reserves</span><span className="mono">{fmtCompact(pool.reserveA)} XLM / {fmtCompact(pool.reserveB)} QUSD {live.live ? "· live" : "· demo"}</span></div>}
      <div className="row between" style={{ fontSize: "0.82rem" }}><span className="muted">Fee (0.30%, 20% to referrer)</span><span className="mono">{fmt(Number(amountIn) * 0.003, 4)} XLM</span></div>
      <div className="field" style={{ marginTop: 10 }}>
        <label>Max slippage: {slippage}%</label>
        <input type="range" min={0.1} max={5} step={0.1} value={slippage} onChange={(e) => setSlippage(Number(e.target.value))} />
      </div>
      <button
        className="btn block"
        disabled={tx.busy}
        onClick={() =>
          tx.run("swap", async () => {
            const me = tx.wallet.address!;
            if (route === "sdex") {
              const p = await findStrictSendPath(ASSETS.XLM, Number(amountIn), ASSETS.USDC);
              if (!p) throw new Error("no SDEX path found");
              const path = p.path.map((a) => (a.asset_type === "native" ? Asset.native() : new Asset(a.asset_code, a.asset_issuer)));
              const xdr = await buildPathPayment(me, ASSETS.XLM, Number(amountIn), ASSETS.USDC, Number(p.destination_amount) * (1 - slippage / 100), path);
              return (await submitSignedXdr(await tx.wallet.sign(xdr))).hash.slice(0, 10);
            }
            const deadline = BigInt(Math.floor(Date.now() / 1000) + 300);
            const r = await invokeContract(me, tx.wallet.sign, CONTRACTS.router, "swap_exact_in", [
              addr(me), vecAddr([CONTRACTS.pools[0]]), addr(CONTRACTS.xlmSac || (await xlmSacId())), i128(toUnits(Number(amountIn))), i128(toUnits(minOut)), u64(deadline),
            ]);
            return r.hash.slice(0, 10);
          })
        }
      >
        Swap {route === "amm" ? "via router" : "via SDEX"}
      </button>
      <TxStatus status={tx.status} />
    </>
  );
}

async function xlmSacId() {
  return Asset.native().contractId(NETWORK_PASSPHRASE);
}

export default function Trade() {
  const [book, setBook] = useState<Book>(() => demoBook());
  const [liveCandles, setLiveCandles] = useState<ReturnType<typeof demoCandles> | null>(null);
  const [tab, setTab] = useState<"limit" | "swap">("limit");
  useEffect(() => {
    let alive = true;
    const load = async () => {
      const b = await fetchOrderBook(ASSETS[BASE], ASSETS[QUOTE]);
      if (alive) setBook(b);
    };
    load();
    fetchTradeCandles(ASSETS[BASE], ASSETS[QUOTE]).then((c) => alive && c && c.length > 10 && setLiveCandles(c));
    const t = setInterval(load, 15_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);
  const bookMid = book.bids[0] && book.asks[0] ? (book.bids[0].price + book.asks[0].price) / 2 : 0;
  // Use Horizon trade history only if it is consistent with the live book
  // (testnet history is often polluted by junk trades); else a demo series.
  const { candles, chartSource } = useMemo(() => {
    if (liveCandles && bookMid) {
      const cl = liveCandles.map((c) => c.c).sort((a, b) => a - b);
      const med = cl[Math.floor(cl.length / 2)];
      if (Math.abs(med / bookMid - 1) < 0.3) return { candles: liveCandles, chartSource: "Horizon trade aggregations (1h)" };
    }
    const d = demoCandles();
    const k = (bookMid || d[d.length - 1].c) / d[d.length - 1].c;
    return { candles: d.map((c) => ({ ...c, o: c.o * k, h: c.h * k, l: c.l * k, c: c.c * k })), chartSource: "Demo price series (scaled to live mid)" };
  }, [liveCandles, bookMid]);
  const last = bookMid || (candles[candles.length - 1]?.c ?? 0);
  const first = candles[0]?.o ?? 1;
  const change = useMemo(() => ((last - first) / first) * 100, [last, first]);

  return (
    <>
      <PageHead kicker="Scene · Quasar Core" title="Trade" right={<span className="pill cyan">{CONTRACTS_CONFIGURED ? "Router + AMM live on testnet" : "AMM: demo reserves"}</span>}>
        Order-book trading on Stellar's native SDEX plus instant swaps through Quasaria's Soroban AMM router.
      </PageHead>
      <div className="grid g-trade">
        <div className="card"><h2>Order book</h2><OrderBook book={book} base={BASE} quote={QUOTE} /></div>
        <div className="grid" style={{ alignContent: "start" }}>
          <div className="card glow">
            <div className="row between ticker" style={{ marginBottom: 10, flexWrap: "wrap", gap: 16 }}>
              <div className="row" style={{ gap: 12 }}>
                <span style={{ fontFamily: "var(--font-display)", fontSize: "1.3rem" }}>{BASE}<span className="muted">/{QUOTE}</span></span>
                <span className="pill">SDEX</span>
              </div>
              <Stat label="Mid" value={fmt(last, 5)} />
              <Stat label="Change" value={`${change >= 0 ? "+" : ""}${fmt(change, 2)}%`} className={change >= 0 ? "pos" : "neg"} />
              <Stat label="Best bid" value={fmt(book.bids[0]?.price ?? 0, 5)} className="pos" />
              <Stat label="Best ask" value={fmt(book.asks[0]?.price ?? 0, 5)} className="neg" />
            </div>
            <PriceChart candles={candles} />
            <div className="muted" style={{ fontSize: "0.7rem", textAlign: "right" }}>{chartSource}</div>
          </div>
          <div className="grid g-3">
            <div className="card"><Stat label="SDEX" value="Offers" sub="manageBuy/SellOffer, auto trustlines" /></div>
            <div className="card"><Stat label="Paths" value="Best route" sub="strict-send path payments via Horizon" /></div>
            <div className="card"><Stat label="AMM" value="x·y=k" sub="0.30% fee → LPs, 20% of fee → referrer" /></div>
          </div>
        </div>
        <div className="card">
          <Tabs value={tab} onChange={setTab} options={[{ v: "limit", label: "Limit (SDEX)" }, { v: "swap", label: "Swap" }]} />
          {tab === "limit" ? <LimitPanel book={book} /> : <SwapPanel />}
        </div>
      </div>
    </>
  );
}
