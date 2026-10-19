import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { breakEvenDays, dayGrid, impermanentLoss, lpFeeApr, lpFees, lpShare, lpVsHold } from "../../lib/calc";
import { fmt } from "../../lib/format";
import { type Series, AmountField, CalcDisclaimer, CalcHead, CalcStat, DurationField, ProjectionChart, fmtAmt, fmtDays, num, pctStr } from "./common";

const IL_PRESETS = [-75, -50, -25, 25, 50, 100, 200, 400];
/** Every Stellar liquidity pool charges the same fixed swap fee. */
const FEE_BPS = 30;
const sym = (s: string, d: string) => (s.trim() || d).slice(0, 12).toUpperCase();

/**
 * Pool fee and impermanent-loss calculator for Stellar liquidity pools. All inputs are yours: copy a pool's reserves and its
 * typical daily volume from the Pools page, then see the fee income and the impermanent loss for a price move.
 * Nothing is read from the chain, so the numbers are estimates only.
 */
export default function LpCalculator({ embedded }: { embedded?: boolean }) {
  const [symA, setSymA] = useState("XLM");
  const [symB, setSymB] = useState("USDC");
  const [resA, setResA] = useState("1000000");
  const [resB, setResB] = useState("180000");
  const [depositA, setDepositA] = useState("1000");
  const [vol, setVol] = useState("50000");
  const [days, setDays] = useState(30);
  const [change, setChange] = useState(50);
  const A = sym(symA, "A"), B = sym(symB, "B");
  const rA = num(resA), rB = num(resB), dep = num(depositA), volA = num(vol);
  const ok = rA > 0 && rB > 0;

  const r = useMemo(() => {
    if (!ok) return null;
    const share = lpShare(dep, rA);
    const depB = (dep * rB) / rA;
    const fees = lpFees({ dailyVolume: volA, feeBps: FEE_BPS, share, days });
    const dailyFees = fees / Math.max(1, days);
    const tvlA = 2 * (rA + dep);
    const k = 1 + change / 100;
    const il = lpVsHold(dep, depB, k);
    const feesB = fees * il.p0;
    return { share, depB, fees, dailyFees, tvlA, apr: lpFeeApr(volA, FEE_BPS, tvlA), il, feesB, net: il.lpValueB + feesB - il.holdValueB, breakEven: breakEvenDays(il.ilValueB, dailyFees * il.p0) };
  }, [ok, dep, rA, rB, volA, days, change]);

  const feeSeries = useMemo((): Series[] => (r ? [{ name: `Your fee income (${A})`, color: "#3dffa8", fill: true, points: dayGrid(days).map((d) => ({ x: d, y: lpFees({ dailyVolume: volA, feeBps: FEE_BPS, share: r.share, days: d }) })) }] : []), [r, days, volA, A]);
  const ilSeries = useMemo((): Series[] => {
    if (!r) return [];
    const xs = Array.from({ length: 101 }, (_, i) => -90 + i * 4.9);
    return [
      { name: "IL vs holding", color: "#ff4d6d", points: xs.map((x) => ({ x, y: impermanentLoss(1 + x / 100) * 100 })) },
      { name: `IL + ${days}d fees`, color: "#3dffa8", dashed: true, points: xs.map((x) => { const v = lpVsHold(dep || 1, (dep || 1) * r.il.p0, 1 + x / 100); const f = dep > 0 ? r.feesB : 0; return { x, y: ((v.lpValueB + f) / v.holdValueB - 1) * 100 }; }) },
    ];
  }, [r, days, dep]);

  return (
    <div className={`card glow calc ${embedded ? "embedded" : ""}`} data-testid="calc-lp">
      <CalcHead icon="🌌" kicker="Calculator · Liquidity" title="Pool fees & impermanent loss" right={!embedded ? <Link className="pill cyan" to="/pools">Open Pools →</Link> : undefined} />
      <div className="calc-grid">
        <div>
          <div className="field">
            <label>Assets in the pool</label>
            <div style={{ display: "flex", gap: 8 }}>
              <input className="input mono" value={symA} onChange={(e) => setSymA(e.target.value)} aria-label="Asset A code" data-testid="lp-sym-a" />
              <input className="input mono" value={symB} onChange={(e) => setSymB(e.target.value)} aria-label="Asset B code" data-testid="lp-sym-b" />
            </div>
          </div>
          <AmountField label={`Pool reserve of ${A}`} value={resA} onChange={setResA} unit={A} testId="lp-res-a" />
          <AmountField label={`Pool reserve of ${B}`} value={resB} onChange={setResB} unit={B} testId="lp-res-b"
            hint={ok ? <>1 {A} = {fmtAmt(rB / rA)} {B} at the pool's price. Copy both reserves from the pool's row on the Pools page.</> : <>Enter both reserves above zero.</>} />
          <AmountField label={`Your deposit (${A} side)`} value={depositA} onChange={setDepositA} unit={A} testId="lp-amount"
            hint={r ? <>+ {fmtAmt(r.depB)} {B} matched to the pool ratio. Stellar pools take both sides in the pool's ratio.</> : undefined} />
          <DurationField days={days} onChange={setDays} />
          <AmountField label={`Expected daily volume (${A}-value)`} value={vol} onChange={setVol} unit={`${A}/day`} testId="lp-volume"
            hint={<>Your guess, not a promise. Volume moves a lot from day to day. The fee is a fixed {fmt(FEE_BPS / 100, 2)}% of each swap.</>} />
        </div>
        <div className="calc-results">
          {r ? (
            <>
              <CalcStat label={`Est. fee income · ${days}d`} tone="pos" testId="lp-fees">{fmtAmt(r.fees)} <span className="unit">{A}-value</span></CalcStat>
              <CalcStat label="Your pool share" testId="lp-share">{pctStr(r.share, 3)}</CalcStat>
              <CalcStat label="Fee rate per year, if volume held" tone="cyan" testId="lp-apr">{pctStr(r.apr, 2)}<span className="calc-usd">before impermanent loss; not a forecast</span></CalcStat>
              <CalcStat label="Fees per day">{fmtAmt(r.dailyFees)} <span className="unit">{A}-value</span></CalcStat>
              <CalcStat label="Pool size after your deposit">{fmtAmt(r.tvlA)} <span className="unit">{A}-value</span></CalcStat>
            </>
          ) : <div className="calc-loading">Enter the pool reserves to see the estimate.</div>}
        </div>
      </div>
      {r && <ProjectionChart testId="lp-fee-chart" height={170} series={feeSeries} />}
      {r && (
        <div className="calc-il" data-testid="lp-il">
          <h3>Impermanent loss</h3>
          <div className="field">
            <label>Price of {A} in {B} changes by <b className={`mono ${change < 0 ? "neg" : "pos"}`}>{change > 0 ? "+" : ""}{change}%</b> <span className="muted mono">({fmtAmt(r.il.p0)} → {fmtAmt(r.il.p1)} {B})</span></label>
            <input type="range" min={-90} max={400} step={1} value={change} onChange={(e) => setChange(Number(e.target.value))} aria-label="Expected price change" data-testid="lp-price-change" />
            <div className="calc-chips">
              {IL_PRESETS.map((c) => <button key={c} type="button" className={`chip ${c === change ? "on" : ""}`} onClick={() => setChange(c)}>{c > 0 ? "+" : ""}{c}%</button>)}
              <button type="button" className={`chip ${change === 0 ? "on" : ""}`} onClick={() => setChange(0)}>0</button>
            </div>
          </div>
          <div className="calc-results il">
            <CalcStat label="Impermanent loss" tone={r.il.ilPct < -1e-9 ? "neg" : undefined} testId="lp-il-pct">{pctStr(r.il.ilPct, 2)}<span className="calc-usd">vs just holding</span></CalcStat>
            <CalcStat label="Just holding">{fmtAmt(r.il.holdValueB)} <span className="unit">{B}</span><span className="calc-usd mono">{fmtAmt(dep)} {A} + {fmtAmt(r.depB)} {B}</span></CalcStat>
            <CalcStat label="In the pool (no fees)">{fmtAmt(r.il.lpValueB)} <span className="unit">{B}</span><span className="calc-usd mono">{fmtAmt(r.il.lpA)} {A} + {fmtAmt(r.il.lpB)} {B}</span></CalcStat>
            <CalcStat label="IL amount" tone={r.il.ilValueB < 0 ? "neg" : undefined}>{fmtAmt(r.il.ilValueB)} <span className="unit">{B}</span></CalcStat>
            <CalcStat label={`Pool + ${days}d fees vs holding`} tone={r.net >= 0 ? "pos" : "neg"} testId="lp-net">{fmtAmt(r.net)} <span className="unit">{B}</span></CalcStat>
            <CalcStat label="Fees to cover IL">{fmtDays(r.breakEven)}<span className="calc-usd">at the fee income above</span></CalcStat>
          </div>
          <ProjectionChart testId="lp-il-chart" height={190} series={ilSeries} xFmt={(x) => `${x > 0 ? "+" : ""}${Math.round(x)}%`} yFmt={(y) => `${fmt(y, Math.abs(y) < 10 ? 1 : 0)}%`} zeroLine markers={[{ x: change, label: `${change > 0 ? "+" : ""}${change}%: ${pctStr(r.il.ilPct, 2)}`, color: "#ffd166" }]} />
        </div>
      )}
      <ul className="calc-notes">
        <li>Fees = daily volume × {fmt(FEE_BPS / 100, 2)}% × your share × days. Volume, share and prices are assumed constant. Fees stay inside the pool and come back to you when you withdraw.</li>
        <li>IL = 2·√k / (1 + k) − 1 for a price ratio k, comparing the pool position with holding the same tokens. Values are in {B} at the new price; fees are valued at today's price.</li>
      </ul>
      <CalcDisclaimer />
    </div>
  );
}
