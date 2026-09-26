import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { SourceTag, Tabs } from "../ui";
import { useChain } from "../../lib/chain";
import { demoCalcQfx, loadCalcQfx } from "../../lib/calcData";
import { dayGrid, effectiveApy, holderYieldAt, projectHolderYield, reserveRunwayDays, type CompoundMode, type HolderInput } from "../../lib/calc";
import { fmt, pct } from "../../lib/format";
import { type Series, AmountField, CalcDisclaimer, CalcHead, CalcStat, DurationField, ProjectionChart, TokenUsd, fmtAmt, fmtDays, fmtUsd, num, pctStr, useUsd } from "./common";

const MODES: { v: CompoundMode; label: string; color: string; name: string }[] = [
  { v: "simple", label: "Simple (default)", color: "#ffd166", name: "Simple interest" },
  { v: "weekly", label: "Settle weekly", color: "#38f3ff", name: "Settled weekly" },
  { v: "daily", label: "Settle daily", color: "#ff3dcb", name: "Settled daily" },
];

export default function HolderYieldCalculator({ embedded }: { embedded?: boolean }) {
  const chain = useChain(loadCalcQfx, []);
  const info = chain.data ?? (chain.loading ? null : demoCalcQfx());
  const usd = useUsd();
  const [amount, setAmount] = useState("1000");
  const [days, setDays] = useState(365);
  const [mode, setMode] = useState<CompoundMode>("simple");
  const [aprOverride, setAprOverride] = useState<number | null>(null);

  const liveApr = info?.aprBps ?? 0;
  const maxApr = info?.maxAprBps ?? 2500;
  const aprBps = Math.min(maxApr, aprOverride ?? liveApr);
  const amt = num(amount);
  const input: HolderInput | null = info ? { amount: amt, aprBps, days, mode, reserve: info.rewardPool, eligibleSupply: info.eligibleSupply } : null;
  const res = input ? projectHolderYield(input) : null;

  const series = useMemo((): Series[] => {
    if (!input) return [];
    const grid = dayGrid(days);
    return MODES.map((m) => ({ name: m.name, color: m.color, dashed: m.v !== mode, width: m.v === mode ? 3 : 1.5, fill: m.v === mode, points: grid.map((d) => ({ x: d, y: holderYieldAt({ ...input, mode: m.v }, d) })) }))
      .sort((a, b) => Number(a.fill) - Number(b.fill));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amt, aprBps, days, mode, info?.rewardPool, info?.eligibleSupply]);

  const runwayNow = info ? reserveRunwayDays(info.rewardPool, info.eligibleSupply, aprBps, "simple") : 0;
  const runwayCirc = info ? reserveRunwayDays(info.rewardPool, Math.max(info.circulating, info.eligibleSupply), aprBps, "simple") : 0;

  return (
    <div className={`card glow calc ${embedded ? "embedded" : ""}`} data-testid="calc-holder">
      <CalcHead icon="✺" kicker="Calculator · QFX holder yield" title="Holder yield" right={<><SourceTag {...chain} what="APR, cap, reserve and earning supply read from the QFX contract (yield_info, reserves)" />{!embedded && <Link className="pill cyan" to="/rewards">Open QFX →</Link>}</>} />
      {!info || !res ? (
        <div className="calc-loading">⟳ Reading the QFX APR and holder-yield reserve from Soroban testnet…</div>
      ) : (
        <>
          <div className="calc-grid">
            <div>
              <AmountField label="QFX held" value={amount} onChange={setAmount} unit="QFX" testId="holder-amount" hint={<>1 QFX = 1 XLM (fully backed) · {fmtUsd(usd.ofXlm(amt))}</>} />
              <DurationField days={days} onChange={setDays} />
              <div className="field">
                <label>Compounding</label>
                <Tabs value={mode} onChange={setMode} options={MODES.map((m) => ({ v: m.v, label: m.label }))} />
                <div className="calc-hint">
                  {mode === "simple"
                    ? "Matches the contract: yield accrues per whole UTC day on your stored balance and only compounds when your balance changes or someone calls settle."
                    : `Assumes you (or anyone) call settle every ${mode === "daily" ? "day" : "7 days"}, which credits the accrued yield so it starts earning too. Each settle is a transaction.`}
                </div>
              </div>
              <div className="field">
                <label>APR: <b className="mono">{pct(aprBps)}</b> {aprOverride === null ? <span className="pill green">live</span> : <button type="button" className="chip" onClick={() => setAprOverride(null)}>reset to live {pct(liveApr)}</button>}</label>
                <input type="range" min={0} max={maxApr} step={25} value={aprBps} onChange={(e) => setAprOverride(Number(e.target.value))} aria-label="What-if APR" />
                <div className="calc-hint">What-if slider; the admin can change the APR at any time, up to the {pct(maxApr)} hard cap in the contract.</div>
              </div>
            </div>
            <div className="calc-results">
              <CalcStat label={`Est. yield · ${days}d`} tone="gold" testId="holder-yield"><TokenUsd amount={res.yield} symbol="QFX" usd={usd.ofXlm(res.yield)} /></CalcStat>
              <CalcStat label="Total at the end" testId="holder-total"><TokenUsd amount={res.total} symbol="QFX" usd={usd.ofXlm(res.total)} /></CalcStat>
              <CalcStat label="Effective annual yield" tone="cyan">{pctStr(effectiveApy(aprBps, mode))}<span className="calc-usd">{MODES.find((m) => m.v === mode)!.name.toLowerCase()} · {pct(aprBps)} APR</span></CalcStat>
              <CalcStat label="Per day now"><TokenUsd amount={(amt * aprBps) / 10_000 / 365} symbol="QFX" usd={usd.ofXlm((amt * aprBps) / 10_000 / 365)} /></CalcStat>
              <CalcStat label="Reserve (unallocated)" testId="holder-reserve"><TokenUsd amount={info.rewardPool} symbol="QFX" usd={usd.ofXlm(info.rewardPool)} /></CalcStat>
              <CalcStat label="Runway at current supply" tone={runwayNow < days ? "neg" : undefined} testId="holder-runway">{fmtDays(runwayNow)}<span className="calc-usd">{fmtAmt(info.eligibleSupply)} QFX earning · {fmt(info.dailyEmission, 4)} QFX/day</span></CalcStat>
            </div>
          </div>
          <div className="notice warn calc-caveat" data-testid="holder-reserve-caveat">
            <b>Reserve caveat:</b> yield is paid from a finite, pre-funded reserve ({fmtAmt(info.rewardPool)} QFX now), never minted. When it is empty, yield stops for everyone until someone tops it up.
            At the current earning supply it lasts about <b>{fmtDays(runwayNow)}</b>; with your {fmtAmt(amt)} QFX added, about <b>{fmtDays(res.runwayDays)}</b>{mode !== "simple" ? ` (if everyone settles ${mode})` : ""};
            if all {fmtAmt(Math.max(info.circulating, info.eligibleSupply))} circulating QFX earned, about <b>{fmtDays(runwayCirc)}</b>.
            {res.capped && <> <b className="neg">Your {days}-day horizon runs past that point</b>, so the estimate is capped at your share of the reserve ({fmtAmt(res.reserveShare)} QFX; uncapped {fmtAmt(res.uncapped)}).</>}
          </div>
          <ProjectionChart testId="holder-chart" series={series} markers={res.runwayDays <= days ? [{ x: res.runwayDays, label: "reserve empty" }] : []} />
          <ul className="calc-notes">
            <li>Simple: yield = QFX × APR × whole days / 365. Settled daily: QFX × ((1 + APR/365)^days − 1). Settled weekly: 7-day simple periods, compounded.</li>
            <li>Assumes the APR, the earning supply and your balance stay constant. The staking contract and the QFX/QUSD pool do not earn holder yield, so QFX you stake or pool earns nothing here.</li>
            <li>USD uses {usd.label}.</li>
          </ul>
          <CalcDisclaimer />
        </>
      )}
    </div>
  );
}
