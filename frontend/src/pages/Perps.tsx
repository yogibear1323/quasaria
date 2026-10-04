import { useEffect, useState } from "react";
import { scValToNative, xdr } from "@stellar/stellar-sdk";
import { PageHead, RiskWarning, SourceTag, Stat, Tabs, TxStatus, ViewerNote, useTx } from "../components/ui";
import { OFFLINE_DEMO, expertContract } from "../lib/config";
import { scanEvents, useChain, useViewer } from "../lib/chain";
import { addr, bool, i128, invokeContract, u32, u64 } from "../lib/soroban";
import { useLiveXlmUsd } from "../lib/liveMarkets";
import { fmt, short, toUnits } from "../lib/format";
import {
  FUNDING_NOT_LIVE, PERPS, decodeFundingEvent, estimateOpen, failureText, fmtAge, fmtRate, fundingView, healthFactor, liquidationPrice,
  markFromPremium, marketKeyScVal, payerText, pnl, priceHealth, readPerps, type FundingEvent, type PerpsData, type PerpsMarket,
} from "../lib/perps";

/** Recent `funding_upd` events from the vault (RPC keeps ~7 days of events). */
async function readFundingHistory(vault: string): Promise<FundingEvent[]> {
  const events = await scanEvents([{ type: "contract", contractIds: [vault], topics: [[xdr.ScVal.scvSymbol("funding_upd").toXDR("base64"), "*"]] }], 120_000, 30);
  return events
    .map((e) => decodeFundingEvent({ ledger: e.ledger, ledgerClosedAt: e.ledgerClosedAt, topic: e.topic.map((t) => scValToNative(t)), value: scValToNative(e.value) }))
    .reverse()
    .slice(0, 24);
}

/** Per-market derived view: prices, freshness and funding (or why funding is unavailable). */
export function marketView(m: PerpsMarket, d: Pick<PerpsData, "config" | "fundingLive">, now: number, reference: number | null) {
  const health = priceHealth({ price: m.price, timestamp: m.priceTs, now, maxAge: d.config.maxPriceAge, reference });
  const funding = m.fundingConfig.ok && m.fundingState.ok ? fundingView(m.fundingConfig.value, m.fundingState.value, now) : null;
  let mark: { value: number | null; note: string } = { value: null, note: d.fundingLive ? "unavailable" : "funding module not deployed" };
  if (m.markOnChain.ok) mark = { value: m.markOnChain.value, note: "mark_price()" };
  else if (funding && m.price !== null) mark = { value: markFromPremium(m.price, funding.premium), note: `oracle × (1 + premium) · mark_price(): ${failureText[m.markOnChain.reason]}` };
  const fundingStatus = !d.fundingLive ? FUNDING_NOT_LIVE : !funding ? "Funding: unreadable right now" : funding.off ? "Funding module live · rates set to 0 (switched off by config)" : "Funding live · hourly, mark vs oracle";
  return { health, funding, mark, fundingStatus };
}

export default function Perps() {
  const viewer = useViewer("trader");
  const [nonce, setNonce] = useState(0);
  const chain = useChain(() => readPerps(viewer.address), [viewer.address, nonce]);
  const d = chain.data;
  const [now, setNow] = useState(() => Date.now() / 1000);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now() / 1000), 15_000);
    return () => clearInterval(t);
  }, []);
  const ref = useLiveXlmUsd(5 * 60_000, OFFLINE_DEMO);
  const [hist, setHist] = useState<{ rows: FundingEvent[]; error: string | null } | null>(null);
  useEffect(() => {
    if (!d?.fundingLive) return;
    let alive = true;
    readFundingHistory(d.vault).then((rows) => alive && setHist({ rows, error: null })).catch((e) => alive && setHist({ rows: [], error: String(e?.message ?? e) }));
    return () => {
      alive = false;
    };
  }, [d?.vault, d?.fundingLive, nonce]);

  const [marketCode, setMarketCode] = useState(PERPS.markets[0].code);
  const [side, setSide] = useState<"long" | "short">("long");
  const [margin, setMargin] = useState("100");
  const [lev, setLev] = useState(2);
  const [ack, setAck] = useState(false);
  const tx = useTx();
  const refresh = (h: string) => {
    setNonce((n) => n + 1);
    return h;
  };

  const market = d?.markets.find((m) => m.code === marketCode) ?? d?.markets[0];
  const mv = d && market ? marketView(market, d, now, market.code === "XLM" ? ref?.price ?? null : null) : null;
  const maxLev = d?.config.maxLeverage ?? 10;
  const est = estimateOpen({
    isLong: side === "long",
    margin: Number(margin) || 0,
    leverage: lev,
    price: market?.price ?? 0,
    mmBps: d?.config.mmBps ?? 500,
    openFeeBps: d?.config.openFeeBps ?? 10,
    hourlyRate: mv?.funding && !mv.funding.off ? mv.funding.predictedHourly : mv?.funding ? 0 : null,
  });
  const stale = !!mv?.health.stale;
  const belowMin = !!d && Number(margin) < d.config.minMargin;
  const needDeposit = !!d && est.need > d.free;
  const openBlock = !d ? "Vault not readable" : d.paused ? "Vault is paused: new positions are blocked" : stale ? "Oracle price is stale: the vault would revert (StalePrice)" : belowMin ? `Margin below vault minimum (${fmt(d.config.minMargin, 2)} ${PERPS.collateral})` : null;

  return (
    <>
      <PageHead
        kicker="Testnet · In development"
        title="Perps"
        right={
          <div className="row">
            <SourceTag {...chain} what="Warp leverage vault (Soroban testnet)" />
            <span className="pill gold" data-testid="perps-dev-badge">Testnet · In development</span>
          </div>
        }
      >
        Perpetual-style long / short positions on the Warp leverage vault: oracle-priced, isolated margin, settled in {PERPS.collateral}. Funding is charged hourly from the mark-vs-oracle premium{d && !d.fundingLive ? " (not live on this vault yet)" : ""}. Every number below comes straight from the deployed testnet contract.
      </PageHead>

      <RiskWarning>
        Perps are leveraged: at {lev}× a {fmt(100 / lev, 1)}% move against you can wipe out your margin, and positions are liquidated when the health factor drops below 1.0. Funding payments can drain margin over time. Profits are paid from a finite vault reserve and are capped by it. Stale oracle prices block trading and closing. This is unaudited testnet software with no guaranteed returns and no real value; nothing here is financial advice.
      </RiskWarning>

      <div className={`notice ${d && !d.fundingLive ? "warn" : ""}`} role="status" data-testid="funding-status">
        <b>{mv ? mv.fundingStatus : chain.loading ? "Reading vault…" : FUNDING_NOT_LIVE}</b>
        {d && !d.fundingLive && <> — the deployed vault ({short(d.vault, 5)}) predates the funding module, so funding rate, mark price and accrued funding are not shown. Prices, positions and vault stats below are live.</>}
      </div>

      {mv && mv.health.reasons.length > 0 && (
        <div className="notice warn" role="alert" data-testid="stale-warning">
          <b>⚠ Price warning.</b> {mv.health.reasons.join(" ")}
        </div>
      )}
      {chain.error && <div className="notice warn">Could not read the vault: {chain.error}</div>}

      {d && d.markets.length > 1 && <Tabs value={marketCode} onChange={setMarketCode} options={d.markets.map((m) => ({ v: m.code, label: `${m.code}-PERP` }))} />}

      <div className="card glow perps-market" data-testid="perps-market">
        <div className="row" style={{ justifyContent: "space-between", marginBottom: 10 }}>
          <h2 style={{ margin: 0 }}>{market?.code ?? PERPS.markets[0].code}-PERP <span className="muted" style={{ fontSize: "0.8rem", fontWeight: 400 }}>/ {PERPS.collateral}</span></h2>
          {d && <span className={`pill ${stale ? "pink" : "green"}`}>{stale ? "oracle stale" : "oracle fresh"}{mv?.health.ageSec != null ? ` · ${fmtAge(mv.health.ageSec)} old` : ""}</span>}
        </div>
        <div className="grid g-4">
          <Stat label="Oracle (index) price" value={market?.price != null ? fmt(market.price, 4) : "—"} sub={ref?.price && market?.code === "XLM" ? `live ref $${ref.price.toFixed(4)}` : "oracle lastprice()"} className={stale ? "neg" : ""} />
          <Stat label="Mark price" value={mv?.mark.value != null ? fmt(mv.mark.value, 4) : "—"} sub={mv?.mark.note ?? "—"} />
          <Stat label="Funding rate (1h)" value={mv?.funding ? fmtRate(mv.funding.currentHourly) : <span className="muted" style={{ fontSize: "0.85rem" }}>not live</span>} sub={mv?.funding ? `current · ${payerText(mv.funding.currentHourly)}` : "in development · testnet"} />
          <Stat label="Predicted next (1h)" value={mv?.funding ? fmtRate(mv.funding.predictedHourly) : <span className="muted" style={{ fontSize: "0.85rem" }}>not live</span>} sub={mv?.funding ? `TWAP · next in ${fmtAge(Math.max(0, mv.funding.nextAt - now))}` : "in development · testnet"} />
        </div>
        <div className="grid g-4" style={{ marginTop: 10 }}>
          <Stat label="Open interest · long" value={market ? fmt(market.oi.long, 2) : "—"} sub={market ? (market.oi.source === "funding_state" ? "funding_state()" : `from open positions${market.oi.partial ? " (partial)" : ""}`) : ""} className="pos" />
          <Stat label="Open interest · short" value={market ? fmt(market.oi.short, 2) : "—"} sub={PERPS.collateral + " notional at entry"} className="neg" />
          <Stat label="Skew" value={market ? fmt(market.oi.long - market.oi.short, 2) : "—"} sub={mv?.funding ? `premium ${fmtRate(mv.funding.premium)}` : "long − short"} />
          <Stat label="Max leverage" value={d ? `${fmt(d.config.maxLeverage, 0)}×` : "—"} sub="vault config (hard cap 20×)" />
        </div>
      </div>

      <div className="grid g-main-side">
        <div className="grid" style={{ alignContent: "start" }}>
          <div className="card" data-testid="perps-open">
            <h2>Open position</h2>
            <div className="perps-side" role="group" aria-label="Side">
              <button className={`btn ${side === "long" ? "" : "ghost"}`} onClick={() => setSide("long")}>Long</button>
              <button className={`btn ${side === "short" ? "" : "ghost"}`} onClick={() => setSide("short")}>Short</button>
            </div>
            <div className="grid g-2">
              <div className="field"><label>Collateral / margin ({PERPS.collateral})</label><input className="input" inputMode="decimal" value={margin} onChange={(e) => setMargin(e.target.value)} /></div>
              <div className="field"><label>Leverage: <b className={lev > 5 ? "neg" : ""}>{lev}×</b></label><input type="range" min={1} max={Math.max(1, Math.floor(maxLev))} value={lev} onChange={(e) => setLev(Number(e.target.value))} /></div>
            </div>
            <div className="grid g-4" style={{ margin: "8px 0 12px" }}>
              <Stat label="Size (notional)" value={fmt(est.size, 2)} sub={PERPS.collateral} />
              <Stat label="Est. liq. price" value={Number.isFinite(est.liq) ? fmt(est.liq, 4) : "—"} sub={Number.isFinite(est.distance) ? `${fmt(est.distance * 100, 1)}% away` : "needs oracle price"} className="neg" />
              <Stat label="Open fee" value={fmt(est.fee, 3)} sub={`${fmt((d?.config.openFeeBps ?? 10) / 100, 2)}% of notional`} />
              <Stat label="Est. funding / h" value={est.fundingPerHour === null ? "not live" : `${est.fundingPerHour > 0 ? "pay " : est.fundingPerHour < 0 ? "get " : ""}${fmt(Math.abs(est.fundingPerHour), 4)}`} sub={est.fundingPerHour === null ? "in development" : "at predicted rate"} />
            </div>
            <label className="row" style={{ fontSize: "0.85rem", marginBottom: 12 }}>
              <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
              I understand this is unaudited testnet software, leverage can liquidate my whole margin, and nothing here is guaranteed or financial advice.
            </label>
            <div className="row">
              {needDeposit && (
                <button className="btn ghost" disabled={!ack || tx.busy || !d || d.paused} onClick={() => tx.run("deposit", async () => {
                  const me = tx.wallet.address!;
                  return refresh((await invokeContract(me, tx.wallet.sign, PERPS.vault, "deposit", [addr(me), i128(toUnits(est.need - (d?.free ?? 0)))])).hash.slice(0, 10));
                })}>Deposit {fmt(Math.max(0, est.need - (d?.free ?? 0)), 2)} {PERPS.collateral}</button>
              )}
              <button className="btn" disabled={!ack || tx.busy || !!openBlock || needDeposit} title={openBlock ?? undefined} onClick={() => tx.run("open position", async () => {
                const me = tx.wallet.address!;
                return refresh((await invokeContract(me, tx.wallet.sign, PERPS.vault, "open_position", [addr(me), addr(me), marketKeyScVal(market!.key), bool(side === "long"), i128(toUnits(Number(margin))), u32(lev * 10_000)])).hash.slice(0, 10));
              })}>Open {side} {lev}×</button>
            </div>
            <p className="muted" style={{ fontSize: "0.78rem" }}>
              {openBlock ? `${openBlock}. ` : ""}Needs {fmt(est.need, 2)} {PERPS.collateral} free collateral in the vault (margin + fee); you have {fmt(d?.free ?? 0, 2)}. Estimates use the oracle price; the contract fills at the oracle price when the transaction lands.
            </p>
            <TxStatus status={tx.status} />
          </div>

          <div className="card" data-testid="perps-positions">
            <h2>Your positions</h2>
            <table className="t">
              <thead><tr><th>#</th><th>Side</th><th>Size</th><th>Lev.</th><th>Entry</th><th>Unrealised PnL</th><th>Accrued funding</th><th>Liq. price</th><th>Health</th><th /></tr></thead>
              <tbody>
                {(d?.positions ?? []).map((p) => {
                  const m = d!.markets.find((x) => x.code === p.asset);
                  const px = m?.price ?? null;
                  const u = px !== null ? pnl(p.isLong, p.size, p.entry, px) : null;
                  const pend = p.pendingFunding.ok ? p.pendingFunding.value : 0;
                  const liq = p.liqOnChain ?? liquidationPrice(p.isLong, p.margin, p.size, p.entry, d!.config.mmBps, pend);
                  const hf = p.hfOnChain.ok ? p.hfOnChain.value : u !== null ? healthFactor(p.margin, p.size, u, d!.config.mmBps, pend) : null;
                  return (
                    <tr key={p.id}>
                      <td className="mono">{p.id}</td>
                      <td className={p.isLong ? "pos" : "neg"}>{p.isLong ? "LONG" : "SHORT"} {p.asset}</td>
                      <td className="mono">{fmt(p.size, 2)}</td>
                      <td className="mono">{fmt(p.leverage, 2)}×</td>
                      <td className="mono">{fmt(p.entry, 4)}</td>
                      <td className={`mono ${u === null ? "" : u >= 0 ? "pos" : "neg"}`}>{u === null ? "—" : `${u >= 0 ? "+" : ""}${fmt(u, 2)}`}</td>
                      <td className="mono">{p.pendingFunding.ok ? `${p.pendingFunding.value > 0 ? "−" : p.pendingFunding.value < 0 ? "+" : ""}${fmt(Math.abs(p.pendingFunding.value), 4)}` : <span className="muted" title={p.pendingFunding.message}>{p.pendingFunding.reason === "missing" ? "not live" : failureText[p.pendingFunding.reason]}</span>}</td>
                      <td className="mono neg">{fmt(liq, 4)}</td>
                      <td className="mono">{hf === null ? "—" : `HF ${fmt(hf, 2)}`}{!p.hfOnChain.ok && hf !== null ? <span className="muted" style={{ fontSize: "0.7rem" }}> (est.)</span> : null}</td>
                      <td>
                        <button className="btn small ghost" disabled={tx.busy || stale || viewer.isDemo} title={stale ? "Oracle price is stale: close_position would revert" : viewer.isDemo ? "Read-only demo account" : undefined}
                          onClick={() => tx.run("close", async () => refresh((await invokeContract(tx.wallet.address!, tx.wallet.sign, PERPS.vault, "close_position", [addr(tx.wallet.address!), u64(p.id)])).hash.slice(0, 10)))}>Close</button>
                      </td>
                    </tr>
                  );
                })}
                {!d?.positions.length && <tr><td colSpan={10} className="muted">{chain.loading ? "Reading…" : "No open positions."}</td></tr>}
              </tbody>
            </table>
            <ViewerNote {...viewer} role="demo trader" />
            <p className="muted" style={{ fontSize: "0.76rem" }}>
              PnL at the oracle price (as the vault settles). Liq. price from the vault's liquidation_price() view{d?.fundingLive ? " (includes pending funding)" : ""}. Health factor = equity ÷ maintenance margin ({fmt((d?.config.mmBps ?? 500) / 100, 1)}% of notional); below 1.0 anyone can liquidate. "(est.)" = computed in the browser because health_factor() reverts on a stale price.
            </p>
          </div>

          <div className="card" data-testid="perps-history">
            <h2>Funding history</h2>
            {!d?.fundingLive ? (
              <p className="muted">{FUNDING_NOT_LIVE}. History will appear here from the vault's funding_upd events once a vault with the funding module is live.</p>
            ) : hist === null ? (
              <p className="muted">Reading funding_upd events…</p>
            ) : hist.rows.length === 0 ? (
              <p className="muted">{hist.error ? `Could not read events (${hist.error}).` : "No funding updates in the RPC's event window yet (updates happen on position touches or update_funding)."}</p>
            ) : (
              <table className="t">
                <thead><tr><th>When</th><th>Market</th><th>Rate / interval</th><th>Premium TWAP</th><th>Intervals</th><th>Index</th></tr></thead>
                <tbody>
                  {hist.rows.map((h) => (
                    <tr key={`${h.ledger}-${h.market}-${h.index}`}>
                      <td className="mono">{new Date(h.when).toLocaleString()}</td>
                      <td>{h.market}</td>
                      <td className={`mono ${h.rate > 0 ? "neg" : h.rate < 0 ? "pos" : ""}`}>{fmtRate(h.rate)}</td>
                      <td className="mono">{fmtRate(h.premiumTwap)}</td>
                      <td className="mono">{h.charged}/{h.intervals}</td>
                      <td className="mono">{h.index.toExponential(3)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        <div className="grid" style={{ alignContent: "start" }}>
          <div className="card" data-testid="perps-vault">
            <h2>Vault</h2>
            <div className="grid g-2">
              <Stat label="Reserve (counterparty)" value={d ? fmt(d.liquidity, 0) : "—"} sub={`${PERPS.collateral} · caps trader profits`} />
              <Stat label="Status" value={d ? (d.paused ? <span className="neg">paused</span> : stale ? <span className="neg">halted · stale oracle</span> : <span className="pos">open</span>) : "—"} sub="guardian pause / oracle" />
              <Stat label="Open positions" value={d ? `${d.openCount} / ${d.config.maxOpenPositions}` : "—"} sub={d ? `${fmt((d.openCount / Math.max(1, d.config.maxOpenPositions)) * 100, 1)}% of slot cap` : ""} />
              <Stat label="Skew vs reserve" value={d && market ? `${fmt((Math.abs(market.oi.long - market.oi.short) / Math.max(1e-9, d.liquidity)) * 100, 2)}%` : "—"} sub="|long − short| ÷ reserve" />
              <Stat label="Per-wallet cap" value={d ? `${d.config.maxPositionsPerUser}` : "—"} sub="open positions" />
              <Stat label="Min margin" value={d ? fmt(d.config.minMargin, 2) : "—"} sub={PERPS.collateral} />
              <Stat label="Maintenance" value={d ? `${fmt(d.config.mmBps / 100, 1)}%` : "—"} sub={d ? `liq. bonus ${fmt(d.config.liqBonusBps / 100, 1)}%` : ""} />
              <Stat label="Max price age" value={d ? fmtAge(d.config.maxPriceAge) : "—"} sub="oracle freshness gate" />
            </div>
            {d?.fundingLive && market?.fundingConfig.ok && (
              <p className="muted" style={{ fontSize: "0.76rem" }}>
                Funding params: interval {fmtAge(market.fundingConfig.value.interval)}, cap {fmtRate(market.fundingConfig.value.maxFundingRatePerHour)}/h, max premium {fmtRate(market.fundingConfig.value.maxPremium, 2)}, k {fmt(market.fundingConfig.value.k, 2)}, skew scale {fmt(market.fundingConfig.value.skewScale, 0)}.
              </p>
            )}
            <p className="muted" style={{ fontSize: "0.75rem", wordBreak: "break-all" }}>
              Vault <a className="mono" href={expertContract(PERPS.vault)} target="_blank" rel="noreferrer">{short(PERPS.vault, 6)} ↗</a>
              {d && <> · oracle <a className="mono" href={expertContract(d.oracle)} target="_blank" rel="noreferrer">{short(d.oracle, 6)} ↗</a></>}
            </p>
          </div>
          <div className="card">
            <h2>How it works</h2>
            <ul className="muted" style={{ fontSize: "0.82rem", paddingLeft: 18, margin: 0 }}>
              <li>Deposit {PERPS.collateral} as free collateral, then open a long or short with margin × leverage.</li>
              <li>Entry and exit fill at the oracle (index) price; PnL is linear in it.</li>
              <li>Funding: each hour the vault charges the TWAP of the mark-vs-oracle premium. Positive rate — longs pay shorts; negative — shorts pay longs. The reserve nets the imbalance.</li>
              <li>Below health factor 1.0 anyone can liquidate the position for a bonus.</li>
              <li>The vault rejects oracle prices older than the max age; while stale, opens, closes and liquidations revert.</li>
              <li>Testnet tokens only. No guaranteed returns.</li>
            </ul>
          </div>
        </div>
      </div>
    </>
  );
}
