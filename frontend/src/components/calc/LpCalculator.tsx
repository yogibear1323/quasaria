import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { SourceTag } from "../ui";
import { useAsync } from "../../lib/useAsync";
import { breakEvenDays, dayGrid, impermanentLoss, lpFeeApr, lpFees, lpShare, lpSharesMinted, lpVsHold } from "../../lib/calc";
import { deriveXlmUsd, fetchVolume24h, loadCuratedPools, usdUnit, type PoolRow } from "../../lib/nativePools";
import { fmt } from "../../lib/format";
import { type Series, AmountField, CalcDisclaimer, CalcHead, CalcStat, DurationField, ProjectionChart, TokenUsd, fmtAmt, fmtDays, num, pctStr, useUsd } from "./common";

type VolMode = "day" | "custom";
const IL_PRESETS = [-75, -50, -25, 25, 50, 100, 200, 400];
const NET = "testnet" as const;

export default function LpCalculator({ initialPool, embedded }: { initialPool?: string; embedded?: boolean }) {
  const chain = useAsync(async () => (await loadCuratedPools(NET)).filter((p) => p.reserveA > 0 && p.reserveB > 0), []);
  const usd = useUsd();
  const [poolId, setPoolId] = useState<string | null>(initialPool ?? null);
  const [depositA, setDepositA] = useState("100");
  const [days, setDays] = useState(30);
  const [volMode, setVolMode] = useState<VolMode | null>(null);
  const [customVol, setCustomVol] = useState("");
  const [change, setChange] = useState(50);

  const pools = chain.data ?? [];
  const p: PoolRow | undefined = pools.find((x) => x.id === poolId) ?? pools[0];
  useEffect(() => { if (p && poolId !== p.id) setPoolId(p.id); }, [p, poolId]);
  const act = useAsync(() => (p ? fetchVolume24h(NET, p.id, p.a) : Promise.reject(new Error("no pool"))), [p?.id]);
  useEffect(() => { setVolMode(null); setCustomVol(""); }, [p?.id]);

  const pricing = useMemo(() => ({ xlmUsd: deriveXlmUsd(NET, pools) ?? usd.price }), [pools, usd.price]);
  const uA = p ? usdUnit(NET, p.a, pricing) : null, uB = p ? usdUnit(NET, p.b, pricing) : null;
  const measured = act.data?.volume ?? 0;
  const mode: VolMode = volMode ?? (act.data ? "day" : "custom");
  const volA = mode === "day" ? measured : num(customVol);
  const sA = p?.a.code ?? "", sB = p?.b.code ?? "";
  const feeBps = p?.feeBp ?? 30;
  const dep = num(depositA);

  const r = useMemo(() => {
    if (!p) return null;
    const share = lpShare(dep, p.reserveA);
    const depB = p.reserveA > 0 ? (dep * p.reserveB) / p.reserveA : 0;
    const fees = lpFees({ dailyVolume: volA, feeBps, share, days, lpFraction: 1 });
    const dailyFees = fees / Math.max(1, days);
    const tvlA = 2 * (p.reserveA + dep);
    const il = lpVsHold(dep, depB, 1 + change / 100);
    const feesB = fees * il.p0;
    return { share, depB, fees, dailyFees, tvlA, apr: lpFeeApr(volA, feeBps, tvlA, 1), minted: lpSharesMinted(dep, p.reserveA, p.totalShares), il, feesB, net: il.lpValueB + feesB - il.holdValueB, breakEven: breakEvenDays(il.ilValueB, dailyFees * il.p0) };
  }, [p, dep, volA, days, change, feeBps]);

  const feeSeries = useMemo((): Series[] => (p && r ? [{ name: `Your fee earnings (${sA})`, color: "#8fd0ff", fill: true, points: dayGrid(days).map((d) => ({ x: d, y: lpFees({ dailyVolume: volA, feeBps, share: r.share, days: d, lpFraction: 1 }) })) }] : []), [p, r, days, volA, feeBps, sA]);
  const ilSeries = useMemo((): Series[] => {
    if (!r) return [];
    const xs = Array.from({ length: 101 }, (_, i) => -90 + i * 4.9);
    return [
      { name: "IL vs holding", color: "#ff4d6d", points: xs.map((x) => ({ x, y: impermanentLoss(1 + x / 100) * 100 })) },
      { name: `IL + ${days}d fees`, color: "#8fd0ff", dashed: true, points: xs.map((x) => { const v = lpVsHold(dep || 1, (dep || 1) * r.il.p0, 1 + x / 100); const f = dep > 0 ? r.feesB : 0; return { x, y: ((v.lpValueB + f) / v.holdValueB - 1) * 100 }; }) },
    ];
  }, [r, days, dep]);
  const usdA = (x: number) => (uA == null ? null : x * uA), usdB = (x: number) => (uB == null ? null : x * uB);

  return (
    <div className={`card glow calc ${embedded ? "embedded" : ""}`} data-testid="calc-lp">
      <CalcHead icon="🌌" kicker="Calculator · Liquidity" title="LP fees & impermanent loss" right={<><SourceTag {...chain} what="Pools, reserves and the 0.30% fee read from Stellar's native liquidity pools via Horizon" />{!embedded && <Link className="pill cyan" to="/pools">Open Pools →</Link>}</>} />
      {chain.loading ? <div className="calc-loading">⟳ Reading native pools from Horizon…</div> : !p || !r ? (
        <div className="calc-loading" data-testid="calc-no-pools">No pools exist yet for the verified pairs on this network. Create one from the Pools tab, then come back.</div>
      ) : (
        <>
          <div className="calc-grid">
            <div>
              <div className="field">
                <label>Pool</label>
                <select className="input" value={p.id} onChange={(e) => setPoolId(e.target.value)} data-testid="lp-pool" aria-label="Pool">
                  {pools.map((x) => <option key={x.id} value={x.id}>{x.a.code}/{x.b.code} · {fmtAmt(x.reserveA)} / {fmtAmt(x.reserveB)} · fee {fmt(x.feeBp / 100, 2)}%</option>)}
                </select>
                <div className="calc-hint mono">{fmtAmt(p.reserveA)} {sA} / {fmtAmt(p.reserveB)} {sB} · 1 {sA} = {fmtAmt(p.reserveB / p.reserveA)} {sB} · swap fee {fmt(feeBps / 100, 2)}% (protocol-set)</div>
              </div>
              <AmountField label={`Deposit (${sA} side)`} value={depositA} onChange={setDepositA} unit={sA} testId="lp-amount" hint={<>+ {fmtAmt(r.depB)} {sB} matched to the pool ratio</>} />
              <DurationField days={days} onChange={setDays} />
              <div className="field">
                <label>Expected daily volume ({sA})</label>
                <div className="calc-chips">
                  <button type="button" className={`chip ${mode === "day" ? "on" : ""}`} disabled={!act.data} onClick={() => setVolMode("day")}>last 24h {act.data ? fmtAmt(measured) : "…"}</button>
                  <button type="button" className={`chip ${mode === "custom" ? "on" : ""}`} onClick={() => { setVolMode("custom"); if (customVol === "") setCustomVol(String(Math.round(volA * 100) / 100 || "")); }}>custom</button>
                </div>
                {mode === "custom" && (
                  <div className="calc-input" style={{ marginTop: 6 }}>
                    <input className="input mono" inputMode="decimal" value={customVol} placeholder="enter volume per day" onChange={(e) => setCustomVol(e.target.value)} data-testid="lp-volume" aria-label="Daily volume" />
                    <span className="unit">{sA}/day</span>
                  </div>
                )}
                <div className="calc-hint" data-testid="lp-volume-source">
                  {act.loading ? "⟳ reading the pool's trades…" : act.data ? `On-chain: ${act.data.trades} trade${act.data.trades === 1 ? "" : "s"} in the last 24h (${fmtAmt(measured)} ${sA})${act.data.truncated ? ", first pages only" : ""}. Using ${mode === "day" ? "the measured 24h volume" : "your own number"}.` : "No measured volume available; enter your own."}
                </div>
              </div>
            </div>
            <div className="calc-results">
              <CalcStat label={`Est. fee earnings · ${days}d`} tone="pos" testId="lp-fees"><TokenUsd amount={r.fees} symbol={sA} usd={usdA(r.fees)} /></CalcStat>
              <CalcStat label="Your pool share" testId="lp-share">{pctStr(r.share, 3)}<span className="calc-usd">{fmtAmt(r.minted)} pool shares (est.)</span></CalcStat>
              <CalcStat label="Fee APR (after your deposit)" tone="cyan" testId="lp-apr">{pctStr(r.apr, 2)}<span className="calc-usd">excl. impermanent loss</span></CalcStat>
              <CalcStat label="Fees per day"><TokenUsd amount={r.dailyFees} symbol={sA} usd={usdA(r.dailyFees)} /></CalcStat>
              <CalcStat label="Pool TVL (after deposit)"><TokenUsd amount={r.tvlA} symbol={`${sA}-value`} usd={usdA(r.tvlA)} /></CalcStat>
              <CalcStat label="Deposit value"><TokenUsd amount={dep} symbol={`${sA} + ${fmtAmt(r.depB)} ${sB}`} usd={uA != null || uB != null ? (usdA(dep) ?? 0) + (usdB(r.depB) ?? 0) : null} /></CalcStat>
            </div>
          </div>
          <ProjectionChart testId="lp-fee-chart" height={170} series={feeSeries} />

          <div className="calc-il" data-testid="lp-il">
            <h3>Impermanent loss</h3>
            <div className="field">
              <label>Price of {sA} in {sB} changes by <b className={`mono ${change < 0 ? "neg" : "pos"}`}>{change > 0 ? "+" : ""}{change}%</b> <span className="muted mono">({fmtAmt(r.il.p0)} → {fmtAmt(r.il.p1)} {sB})</span></label>
              <input type="range" min={-90} max={400} step={1} value={change} onChange={(e) => setChange(Number(e.target.value))} aria-label="Expected price change" data-testid="lp-price-change" />
              <div className="calc-chips">
                {IL_PRESETS.map((c) => <button key={c} type="button" className={`chip ${c === change ? "on" : ""}`} onClick={() => setChange(c)}>{c > 0 ? "+" : ""}{c}%</button>)}
                <button type="button" className={`chip ${change === 0 ? "on" : ""}`} onClick={() => setChange(0)}>0</button>
              </div>
            </div>
            <div className="calc-results il">
              <CalcStat label="Impermanent loss" tone={r.il.ilPct < -1e-9 ? "neg" : undefined} testId="lp-il-pct">{pctStr(r.il.ilPct, 2)}<span className="calc-usd">vs just holding</span></CalcStat>
              <CalcStat label="Just holding"><TokenUsd amount={r.il.holdValueB} symbol={sB} usd={usdB(r.il.holdValueB)} /><span className="calc-usd mono">{fmtAmt(dep)} {sA} + {fmtAmt(r.depB)} {sB}</span></CalcStat>
              <CalcStat label="In the pool (no fees)"><TokenUsd amount={r.il.lpValueB} symbol={sB} usd={usdB(r.il.lpValueB)} /><span className="calc-usd mono">{fmtAmt(r.il.lpA)} {sA} + {fmtAmt(r.il.lpB)} {sB}</span></CalcStat>
              <CalcStat label="IL amount" tone={r.il.ilValueB < 0 ? "neg" : undefined}><TokenUsd amount={r.il.ilValueB} symbol={sB} usd={usdB(r.il.ilValueB)} /></CalcStat>
              <CalcStat label={`Pool + ${days}d fees vs holding`} tone={r.net >= 0 ? "pos" : "neg"} testId="lp-net"><TokenUsd amount={r.net} symbol={sB} usd={usdB(r.net)} /></CalcStat>
              <CalcStat label="Fees to cover IL">{fmtDays(r.breakEven)}<span className="calc-usd">at the fee rate above</span></CalcStat>
            </div>
            <ProjectionChart testId="lp-il-chart" height={190} series={ilSeries} xFmt={(x) => `${x > 0 ? "+" : ""}${Math.round(x)}%`} yFmt={(y) => `${fmt(y, Math.abs(y) < 10 ? 1 : 0)}%`} zeroLine markers={[{ x: change, label: `${change > 0 ? "+" : ""}${change}%: ${pctStr(r.il.ilPct, 2)}`, color: "#ffd166" }]} />
          </div>
          <ul className="calc-notes">
            <li>Fees = daily volume × {fmt(feeBps / 100, 2)}% fee × your share × days. Volume, share and prices are assumed constant; fees stay in the pool and are paid out when you withdraw.</li>
            <li>IL = 2·√k / (1 + k) − 1 for a price ratio k, comparing the pool position with holding the same tokens. Values are in {sB} at the new price. Fees are valued at today's price.</li>
            <li>USD values appear only when a leg is XLM or a verified USD stablecoin. {usd.label}.</li>
          </ul>
          <CalcDisclaimer />
        </>
      )}
    </div>
  );
}
