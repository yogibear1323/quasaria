import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { SourceTag } from "../ui";
import { useChain } from "../../lib/chain";
import { demoCalcPools, loadCalcPools, loadPoolActivity, type CalcPool } from "../../lib/calcData";
import { breakEvenDays, dayGrid, impermanentLoss, lpFeeApr, lpFeeFraction, lpFees, lpShare, lpSharesMinted, lpVsHold } from "../../lib/calc";
import { DEMO_POOLS } from "../../lib/demo";
import { fmt } from "../../lib/format";
import { type Series, AmountField, CalcDisclaimer, CalcHead, CalcStat, DurationField, ProjectionChart, TokenUsd, fmtAmt, fmtDays, fmtUsd, num, pctStr, useUsd } from "./common";

type VolMode = "week" | "day" | "custom";
const IL_PRESETS = [-75, -50, -25, 25, 50, 100, 200, 400];

export default function LpCalculator({ initialPool, embedded }: { initialPool?: string; embedded?: boolean }) {
  const chain = useChain(loadCalcPools, []);
  const data = chain.data ?? (chain.loading ? null : demoCalcPools());
  const usd = useUsd();
  const [poolId, setPoolId] = useState<string | null>(initialPool ?? null);
  const [depositA, setDepositA] = useState("100");
  const [days, setDays] = useState(30);
  const [volMode, setVolMode] = useState<VolMode | null>(null);
  const [customVol, setCustomVol] = useState("");
  const [referred, setReferred] = useState<number | null>(null);
  const [change, setChange] = useState(50);

  const pools = data?.pools ?? [];
  const p: CalcPool | undefined = pools.find((x) => x.id === poolId) ?? pools[0];
  useEffect(() => {
    if (p && poolId !== p.id) setPoolId(p.id);
  }, [p, poolId]);

  const act = useChain(() => (p && !p.demo ? loadPoolActivity(p) : Promise.reject(new Error("no live pool"))), [p?.id]);
  // Reset per-pool choices when the pool changes.
  useEffect(() => {
    setVolMode(null);
    setReferred(null);
    setCustomVol("");
  }, [p?.id]);

  const values = data?.values ?? {};
  const vA = p ? values[p.tokenA] ?? NaN : NaN;
  const vB = p ? values[p.tokenB] ?? NaN : NaN;
  const a = act.data;
  const weekAvg = a && a.windowDays > 0 ? a.week.volumeA / a.windowDays : 0;
  const mode: VolMode = volMode ?? (a ? "week" : "custom");
  const demoVol = p?.demo ? DEMO_POOLS.find((d) => d.id === p.id)?.volume24h ?? 0 : 0;
  const volA = mode === "week" ? weekAvg : mode === "day" ? a?.day.volumeA ?? 0 : customVol === "" ? (p?.demo ? demoVol * (p.reserveA / p.reserveB) : 0) : num(customVol);
  const refBps = a?.referralShareBps ?? 2000;
  const refFrac = referred ?? (a && a.week.feesA > 0 ? a.week.referredFraction : 1);
  const lpFrac = lpFeeFraction(refBps, refFrac);

  const dep = num(depositA);
  const r = useMemo(() => {
    if (!p) return null;
    const share = lpShare(dep, p.reserveA);
    const depB = p.reserveA > 0 ? (dep * p.reserveB) / p.reserveA : 0;
    const feeRate = p.feeBps / 10_000;
    const fees = lpFees({ dailyVolume: volA, feeBps: p.feeBps, share, days, lpFraction: lpFrac });
    const dailyFees = fees / Math.max(1, days);
    const tvlA = 2 * (p.reserveA + dep);
    const k = 1 + change / 100;
    const il = lpVsHold(dep, depB, k);
    const feesB = fees * il.p0; // fees (A-value) expressed in B at today's price
    return { share, depB, feeRate, fees, dailyFees, tvlA, apr: lpFeeApr(volA, p.feeBps, tvlA, lpFrac), minted: lpSharesMinted(dep, p.reserveA, p.totalShares), k, il, feesB, net: il.lpValueB + feesB - il.holdValueB, breakEven: breakEvenDays(il.ilValueB, dailyFees * il.p0) };
  }, [p, dep, volA, days, lpFrac, change]);

  const feeSeries = useMemo((): Series[] => (p && r ? [{ name: `Your fee earnings (${p.symA}-value)`, color: "#3dffa8", fill: true, points: dayGrid(days).map((d) => ({ x: d, y: lpFees({ dailyVolume: volA, feeBps: p.feeBps, share: r.share, days: d, lpFraction: lpFrac }) })) }] : []), [p, r, days, volA, lpFrac]);
  const ilSeries = useMemo((): Series[] => {
    if (!r) return [];
    const xs = Array.from({ length: 101 }, (_, i) => -90 + i * 4.9);
    return [
      { name: "IL vs holding", color: "#ff4d6d", points: xs.map((x) => ({ x, y: impermanentLoss(1 + x / 100) * 100 })) },
      { name: `IL + ${days}d fees`, color: "#3dffa8", dashed: true, points: xs.map((x) => { const v = lpVsHold(dep || 1, (dep || 1) * r.il.p0, 1 + x / 100); const f = dep > 0 ? r.feesB : 0; return { x, y: ((v.lpValueB + f) / v.holdValueB - 1) * 100 }; }) },
    ];
  }, [r, days, dep]);

  const usdA = (x: number) => usd.ofXlm(x * vA);
  const usdB = (x: number) => usd.ofXlm(x * vB);

  return (
    <div className={`card glow calc ${embedded ? "embedded" : ""}`} data-testid="calc-lp">
      <CalcHead icon="🌌" kicker="Calculator · Liquidity" title="LP fees & impermanent loss" right={<><SourceTag {...chain} what="Pools, reserves and fee rates read from the AMM pool contracts" />{!embedded && <Link className="pill cyan" to="/pools">Open Pools →</Link>}</>} />
      {!data || !p || !r ? (
        <div className="calc-loading">⟳ Reading live pools and fee rates from Soroban testnet…</div>
      ) : (
        <>
          <div className="calc-grid">
            <div>
              <div className="field">
                <label>Pool</label>
                <select className="input" value={p.id} onChange={(e) => setPoolId(e.target.value)} data-testid="lp-pool" aria-label="Pool">
                  {(["core", "stable"] as const).map((g) => {
                    const list = pools.filter((x) => x.group === g);
                    return list.length ? (
                      <optgroup key={g} label={g === "core" ? "Quasaria core pools" : "XLM / stablecoin pools (testnet)"}>
                        {list.map((x) => <option key={x.id} value={x.id}>{x.symA}/{x.symB}{x.mock ? " (mock)" : ""} · TVL ≈ {fmtAmt(2 * x.reserveA * (values[x.tokenA] ?? NaN))} XLM · fee {fmt(x.feeBps / 100, 2)}%</option>)}
                      </optgroup>
                    ) : null;
                  })}
                </select>
                <div className="calc-hint mono">{fmtAmt(p.reserveA)} {p.symA} / {fmtAmt(p.reserveB)} {p.symB} · 1 {p.symA} = {fmtAmt(p.reserveB / p.reserveA)} {p.symB} · swap fee {fmt(p.feeBps / 100, 2)}% (from contract)</div>
              </div>
              <AmountField label={`Deposit (${p.symA} side)`} value={depositA} onChange={setDepositA} unit={p.symA} testId="lp-amount"
                hint={<>+ {fmtAmt(r.depB)} {p.symB} matched to the pool ratio · total ≈ {fmtAmt(dep * vA + r.depB * vB)} XLM {fmtUsd(usd.ofXlm(dep * vA + r.depB * vB))}</>} />
              <DurationField days={days} onChange={setDays} />
              <div className="field">
                <label>Expected daily volume ({p.symA}-value)</label>
                <div className="calc-chips">
                  <button type="button" className={`chip ${mode === "week" ? "on" : ""}`} disabled={!a} onClick={() => setVolMode("week")}>7d avg {a ? fmtAmt(weekAvg) : "…"}</button>
                  <button type="button" className={`chip ${mode === "day" ? "on" : ""}`} disabled={!a} onClick={() => setVolMode("day")}>last 24h {a ? fmtAmt(a.day.volumeA) : "…"}</button>
                  <button type="button" className={`chip ${mode === "custom" ? "on" : ""}`} onClick={() => { setVolMode("custom"); if (customVol === "") setCustomVol(String(Math.round(volA * 100) / 100 || "")); }}>custom</button>
                </div>
                {mode === "custom" && (
                  <div className="calc-input" style={{ marginTop: 6 }}>
                    <input className="input mono" inputMode="decimal" value={customVol} placeholder="enter volume per day" onChange={(e) => setCustomVol(e.target.value)} data-testid="lp-volume" aria-label="Daily volume" />
                    <span className="unit">{p.symA}/day</span>
                  </div>
                )}
                <div className="calc-hint" data-testid="lp-volume-source">
                  {act.loading ? "⟳ summing on-chain swap events…" : a ? `On-chain: ${a.week.swaps} swap${a.week.swaps === 1 ? "" : "s"} in the last ${fmt(a.windowDays, 1)} days (${fmtAmt(a.week.volumeA)} ${p.symA}-value), ${a.day.swaps} in the last 24h. Using ${mode === "week" ? "the 7-day daily average" : mode === "day" ? "the last 24h" : "your figure"}.` : p.demo ? "Demo pool: example volume." : "Could not read recent swaps; enter an expected volume."}
                  {usdA(volA) !== null ? ` ${fmtUsd(usdA(volA))}/day` : ""}
                </div>
              </div>
              <div className="field">
                <label>Volume from referred traders: <b className="mono">{fmt(refFrac * 100, 0)}%</b>{referred === null && <span className="muted"> ({a && a.week.feesA > 0 ? "observed" : "conservative default"})</span>}</label>
                <input type="range" min={0} max={100} value={Math.round(refFrac * 100)} onChange={(e) => setReferred(Number(e.target.value) / 100)} aria-label="Referred volume share" />
                <div className="calc-hint">Referrers get {fmt(refBps / 100, 0)}% of the fee on their traders' swaps, so LPs keep {pctStr(lpFrac, 1)} of the {fmt(p.feeBps / 100, 2)}% fee.</div>
              </div>
            </div>
            <div className="calc-results">
              <CalcStat label={`Est. fee earnings · ${days}d`} tone="pos" testId="lp-fees"><TokenUsd amount={r.fees} symbol={`${p.symA}-value`} usd={usdA(r.fees)} /></CalcStat>
              <CalcStat label="Your pool share" testId="lp-share">{pctStr(r.share, 3)}<span className="calc-usd">{fmtAmt(r.minted)} QLP minted (est.)</span></CalcStat>
              <CalcStat label="Fee APR (after your deposit)" tone="cyan" testId="lp-apr">{pctStr(r.apr, 2)}<span className="calc-usd">excl. impermanent loss</span></CalcStat>
              <CalcStat label="Fees per day"><TokenUsd amount={r.dailyFees} symbol={`${p.symA}-value`} usd={usdA(r.dailyFees)} /></CalcStat>
              <CalcStat label="Pool TVL (after deposit)"><TokenUsd amount={r.tvlA} symbol={`${p.symA}-value`} usd={usdA(r.tvlA)} /></CalcStat>
              <CalcStat label="Deposit value"><TokenUsd amount={dep * vA + r.depB * vB} symbol="XLM" usd={usd.ofXlm(dep * vA + r.depB * vB)} /></CalcStat>
            </div>
          </div>
          <ProjectionChart testId="lp-fee-chart" height={170} series={feeSeries} />

          <div className="calc-il" data-testid="lp-il">
            <h3>Impermanent loss</h3>
            <div className="field">
              <label>Price of {p.symA} in {p.symB} changes by <b className={`mono ${change < 0 ? "neg" : "pos"}`}>{change > 0 ? "+" : ""}{change}%</b> <span className="muted mono">({fmtAmt(r.il.p0)} → {fmtAmt(r.il.p1)} {p.symB})</span></label>
              <input type="range" min={-90} max={400} step={1} value={change} onChange={(e) => setChange(Number(e.target.value))} aria-label="Expected price change" data-testid="lp-price-change" />
              <div className="calc-chips">
                {IL_PRESETS.map((c) => <button key={c} type="button" className={`chip ${c === change ? "on" : ""}`} onClick={() => setChange(c)}>{c > 0 ? "+" : ""}{c}%</button>)}
                <button type="button" className={`chip ${change === 0 ? "on" : ""}`} onClick={() => setChange(0)}>0</button>
              </div>
            </div>
            <div className="calc-results il">
              <CalcStat label="Impermanent loss" tone={r.il.ilPct < -1e-9 ? "neg" : undefined} testId="lp-il-pct">{pctStr(r.il.ilPct, 2)}<span className="calc-usd">vs just holding</span></CalcStat>
              <CalcStat label="Just holding"><TokenUsd amount={r.il.holdValueB} symbol={p.symB} usd={usdB(r.il.holdValueB)} /><span className="calc-usd mono">{fmtAmt(dep)} {p.symA} + {fmtAmt(r.depB)} {p.symB}</span></CalcStat>
              <CalcStat label="In the pool (no fees)"><TokenUsd amount={r.il.lpValueB} symbol={p.symB} usd={usdB(r.il.lpValueB)} /><span className="calc-usd mono">{fmtAmt(r.il.lpA)} {p.symA} + {fmtAmt(r.il.lpB)} {p.symB}</span></CalcStat>
              <CalcStat label="IL amount" tone={r.il.ilValueB < 0 ? "neg" : undefined}><TokenUsd amount={r.il.ilValueB} symbol={p.symB} usd={usdB(r.il.ilValueB)} /></CalcStat>
              <CalcStat label={`Pool + ${days}d fees vs holding`} tone={r.net >= 0 ? "pos" : "neg"} testId="lp-net"><TokenUsd amount={r.net} symbol={p.symB} usd={usdB(r.net)} /></CalcStat>
              <CalcStat label="Fees to cover IL">{fmtDays(r.breakEven)}<span className="calc-usd">at the fee rate above</span></CalcStat>
            </div>
            <ProjectionChart testId="lp-il-chart" height={190} series={ilSeries} xFmt={(x) => `${x > 0 ? "+" : ""}${Math.round(x)}%`} yFmt={(y) => `${fmt(y, Math.abs(y) < 10 ? 1 : 0)}%`} zeroLine markers={[{ x: change, label: `${change > 0 ? "+" : ""}${change}%: ${pctStr(r.il.ilPct, 2)}`, color: "#ffd166" }]} />
          </div>
          <ul className="calc-notes">
            <li>Fees = daily volume × {fmt(p.feeBps / 100, 2)}% fee × LP cut ({pctStr(lpFrac, 1)}) × your share × days. Volume, share and prices are assumed constant; fees stay in the pool and are paid out when you withdraw.</li>
            <li>IL = 2·√k / (1 + k) − 1 for a price ratio k, comparing the pool position with holding the same tokens. Values are in {p.symB} at the new price; USD assumes {p.symB} keeps today's value (1 {p.symB} ≈ {fmtAmt(vB)} XLM). Fees are valued at today's price.</li>
            <li>USD uses {usd.label}.</li>
          </ul>
          <CalcDisclaimer />
        </>
      )}
    </div>
  );
}
