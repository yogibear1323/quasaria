import { useEffect, useMemo, useState } from "react";
import { Asset } from "@stellar/stellar-sdk";
import { PageHead, Stat, Tabs, TxStatus, useTx } from "../components/ui";
import OrderBook from "../components/OrderBook";
import PriceChart from "../components/PriceChart";
import { ASSETS, assetFromKey, assetKeyOf, buildLimitOrder, buildPathPayment, buildTrustline, fetchBalances, fetchOrderBook, fetchTradeCandles, findStrictSendPath, hasTrustline, submitSignedXdr } from "../lib/stellar";
import { useSearchParams } from "react-router-dom";
import { AssetPicker, toOption, type PickerOption } from "../components/AssetBits";
import { loadMarkets, type MarketRow } from "../lib/markets";
import { STELLARCHAIN_ATTRIBUTION } from "../lib/stellarchain";
import { demoBook, demoCandles, DEMO_POOLS, type Book } from "../lib/demo";
import { ammAmountOut, priceImpact } from "../lib/math";
import { CONTRACTS, CONTRACTS_CONFIGURED, NETWORK_PASSPHRASE } from "../lib/config";
import { addr, i128, invokeContract, u64, vecAddr } from "../lib/soroban";
import { fmt, fmtCompact, toUnits } from "../lib/format";
import { readPool, useChain } from "../lib/chain";
import { ASSET_LIST, assetByTestnetKey, badgeOf, findRoute, testnetKey, type ListedAsset } from "../lib/assets";

/** Curated asset list (stablecoins + popular assets, v3 pools) as picker options. */
const CURATED_OPTS: PickerOption[] = ASSET_LIST.filter((a) => a.testnet.kind !== "native").map((a) => ({ key: testnetKey(a), code: a.code, sub: `${badgeOf(a).text}${a.org ? ` · ${a.org}` : ""}`, logo: a.logo }));
/** Chain the AMM quote along a router path (token ids in order). */
async function quoteRoute(pools: string[], tokenIn: string, amountIn: number) {
  let tok = tokenIn, amt = amountIn, impact = 0;
  const hops: { reserveIn: number; reserveOut: number }[] = [];
  for (const id of pools) {
    const p = await readPool(id);
    const aIn = p.tokenA === tok;
    const rIn = aIn ? p.reserveA : p.reserveB, rOut = aIn ? p.reserveB : p.reserveA;
    impact = 1 - (1 - impact) * (1 - priceImpact(amt, rIn, rOut, p.feeBps));
    amt = ammAmountOut(amt, rIn, rOut, p.feeBps);
    tok = aIn ? p.tokenB : p.tokenA;
    hops.push({ reserveIn: rIn, reserveOut: rOut });
  }
  return { out: amt, impact, hops };
}

const px = (v: number) => (v >= 0.01 ? fmt(v, 5) : v.toPrecision(4));
const DEFAULT_BASE = "XLM";
const DEFAULT_QUOTE = assetKeyOf(ASSETS.USDC);
const XLM_OPT: PickerOption = { key: "XLM", code: "XLM", sub: "Stellar Lumens (native)", logo: null };
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

function SwapPanel({ baseKey, quoteKey }: { baseKey: string; quoteKey: string }) {
  const [route, setRoute] = useState<"amm" | "sdex">("amm");
  const [amountIn, setAmountIn] = useState("500");
  const [slippage, setSlippage] = useState(0.5);
  const tx = useTx(route === "amm");
  // Router path for the picked pair over the curated v3 pools (else the XLM→QUSD core pool below).
  const from: ListedAsset | undefined = assetByTestnetKey(baseKey), to: ListedAsset | undefined = assetByTestnetKey(quoteKey);
  const path = from && to ? findRoute(from.id, to.id) : null;
  const rq = useChain(() => (path && from ? quoteRoute(path.pools, from.testnet.sac!, Number(amountIn) || 0) : Promise.reject(new Error("no route"))), [path?.pools.join(","), amountIn]);
  const [bal, setBal] = useState<Awaited<ReturnType<typeof fetchBalances>> | null>(null);
  useEffect(() => {
    if (tx.wallet.address && to && to.testnet.issuer) fetchBalances(tx.wallet.address).then(setBal).catch(() => setBal(null));
  }, [tx.wallet.address, to?.id]);
  const needTrust = to && to.testnet.issuer && bal && !hasTrustline(bal, new Asset(to.testnet.code, to.testnet.issuer));
  const live = useChain(() => readPool(CONTRACTS.pools[0]), []);
  const pool = live.data
    ? (() => {
        const xlmIsA = live.data.tokenA === CONTRACTS.xlmSac;
        return { reserveA: xlmIsA ? live.data.reserveA : live.data.reserveB, reserveB: xlmIsA ? live.data.reserveB : live.data.reserveA, feeBps: live.data.feeBps };
      })()
    : DEMO_POOLS[0];
  const routed = route === "amm" && path && from && to;
  const out = routed ? rq.data?.out ?? 0 : ammAmountOut(Number(amountIn), pool.reserveA, pool.reserveB, pool.feeBps);
  const impact = routed ? rq.data?.impact ?? 0 : priceImpact(Number(amountIn), pool.reserveA, pool.reserveB, pool.feeBps);
  const minOut = out * (1 - slippage / 100);
  const payCode = routed ? from!.code : "XLM", getCode = routed ? to!.code : route === "amm" ? "QUSD" : "USDC";
  return (
    <>
      <Tabs value={route} onChange={setRoute} options={[{ v: "amm", label: "Soroban AMM" }, { v: "sdex", label: "SDEX path" }]} />
      <div className="field"><label>You pay ({payCode})</label><input className="input" value={amountIn} onChange={(e) => setAmountIn(e.target.value)} /></div>
      <div style={{ textAlign: "center", fontSize: "1.4rem", color: "var(--quasar)", textShadow: "var(--glow-cyan)" }}>⇣</div>
      <div className="field"><label>You receive (est. {getCode})</label><input className="input" readOnly value={out > 0 && out < 0.01 ? out.toPrecision(4) : fmt(out, 4)} /></div>
      <div className="row between" style={{ fontSize: "0.82rem" }}><span className="muted">Price impact</span><span className={impact > 0.01 ? "neg mono" : "mono"}>{fmt(impact * 100, 3)}%</span></div>
      {routed && <div className="row between" style={{ fontSize: "0.82rem" }} data-testid="swap-route"><span className="muted">Router path</span><span className="mono">{[from!.code, ...path!.via, to!.code].join(" → ")} · {path!.pools.length} pool{path!.pools.length > 1 ? "s" : ""} {rq.live ? "· live" : ""}</span></div>}
      {routed && (from!.testnet.kind === "mirror" || to!.testnet.kind === "mirror") && <div className="muted" style={{ fontSize: "0.72rem" }}>{[from!, to!].filter((x) => x.testnet.kind === "mirror").map((x) => `${x.code} = testnet mirror of ${x.code} (no value)`).join(" · ")}</div>}
      {routed && needTrust && <div className="notice warn" style={{ fontSize: "0.78rem" }}>Receiving {to!.testnet.code} needs a trustline. <button className="btn small" disabled={tx.busy} onClick={() => tx.run(`trustline ${to!.testnet.code}`, async () => (await submitSignedXdr(await tx.wallet.sign(await buildTrustline(tx.wallet.address!, new Asset(to!.testnet.code, to!.testnet.issuer!))))).hash.slice(0, 10))}>Add trustline</button></div>}
      {route === "amm" && !routed && <div className="row between" style={{ fontSize: "0.82rem" }}><span className="muted">Pool reserves</span><span className="mono">{fmtCompact(pool.reserveA)} XLM / {fmtCompact(pool.reserveB)} QUSD {live.live ? "· live" : "· demo"}</span></div>}
      <div className="row between" style={{ fontSize: "0.82rem" }}><span className="muted">Fee (0.30%, 20% to referrer)</span><span className="mono">{fmt(Number(amountIn) * 0.003, 4)} {payCode}</span></div>
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
            if (routed) {
              if (!(minOut > 0)) throw new Error("no live quote for this route yet");
              const rr = await invokeContract(me, tx.wallet.sign, CONTRACTS.router, "swap_exact_in", [
                addr(me), vecAddr(path!.pools), addr(from!.testnet.sac!), i128(toUnits(Number(amountIn))), i128(toUnits(minOut) > 0n ? toUnits(minOut) : 1n), u64(deadline),
              ]);
              return rr.hash.slice(0, 10);
            }
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
  const [tab, setTab] = useState<"limit" | "swap">("limit");
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
      <PageHead kicker="Scene · Quasar Core" title="Trade" right={<span className="pill cyan">{CONTRACTS_CONFIGURED ? "Router + AMM live on testnet" : "AMM: demo reserves"}</span>}>
        Order-book trading on Stellar's native SDEX plus instant swaps through Quasaria's Soroban AMM router.
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
          <div className="grid g-3">
            <div className="card"><Stat label="SDEX" value="Offers" sub="manageBuy/SellOffer, auto trustlines" /></div>
            <div className="card"><Stat label="Paths" value="Best route" sub="strict-send path payments via Horizon" /></div>
            <div className="card"><Stat label="AMM" value="x·y=k" sub="0.30% fee → LPs, 20% of fee → referrer" /></div>
          </div>
        </div>
        <div className="card">
          <Tabs value={tab} onChange={setTab} options={[{ v: "limit", label: "Limit (SDEX)" }, { v: "swap", label: "Swap" }]} />
          {tab === "limit" ? <LimitPanel key={`${baseKey}/${quoteKey}`} book={book} baseKey={baseKey} quoteKey={quoteKey} BASE={BASE} QUOTE={QUOTE} /> : <SwapPanel baseKey={baseKey} quoteKey={quoteKey} />}
        </div>
      </div>
    </>
  );
}
