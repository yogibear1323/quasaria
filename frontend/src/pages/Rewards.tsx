import { useState } from "react";
import { Link } from "react-router-dom";
import { PageHead, SourceTag, Stat, TxStatus, ViewerNote, useTx } from "../components/ui";
import MintRedeem from "../components/MintRedeem";
import { DEMO_QFX } from "../lib/demo";
import { CONTRACTS } from "../lib/config";
import { addr, invokeContract } from "../lib/soroban";
import { readQfx, useChain, useViewer } from "../lib/chain";
import { apyFromApr } from "../lib/math";
import HolderYieldCalculator from "../components/calc/HolderYieldCalculator";
import { fmt, fmtCompact, pct } from "../lib/format";

export default function Rewards() {
  const viewer = useViewer("trader");
  const tx = useTx();
  const [refresh, setRefresh] = useState(0);
  const chain = useChain(() => readQfx(viewer.address), [viewer.address, refresh]);
  const info = chain.data ?? DEMO_QFX;
  const balance = chain.data ? chain.data.balance : DEMO_QFX.demoBalance;
  // Yield accrues every second (time-weighted); show the live per-second rate.
  const perSecond = (balance * info.effectiveAprBps) / 10_000 / (365 * 86_400);
  const myDaily = (balance * info.effectiveAprBps) / 10_000 / 365;
  const apy = apyFromApr(info.aprBps);
  const runwayDays = info.dailyEmission > 0 ? info.rewardPool / info.dailyEmission : Infinity;

  return (
    <>
      <PageHead kicker="Scene · Supernova" title="QFX · Quasaria Flux" right={<div className="row"><SourceTag {...chain} /><span className="pill gold">1 QFX = 1 XLM · fully backed</span><Link className="pill cyan" to="/calculators?c=holder">🧮 Yield calculator</Link></div>}>
        QFX is XLM in a Soroban wrapper: every QFX is minted only when the same amount of XLM is deposited, and can be redeemed 1:1 at any time. Holders also earn a capped, variable rate paid out of a pre-funded reward reserve, never by minting new tokens.
      </PageHead>
      <div className="grid g-main-side">
        <MintRedeem />
        <div className="card">
          <h2>Holder yield</h2>
          <div style={{ textAlign: "center" }}>
            <h3>{tx.wallet.address ? "Your QFX balance" : chain.live ? "Demo trader balance (on-chain)" : "Demo wallet balance"}</h3>
            <div className="orb-counter">{fmt(balance, 4)}</div>
            <div className="muted">QFX · redeemable for {fmt(balance, 4)} XLM</div>
            {chain.live && <ViewerNote {...viewer} role="demo trader" />}
          </div>
          <div className="grid g-2" style={{ marginTop: 16 }}>
            <Stat label="Yield accrues" value="every second" sub={`≈ +${fmt(perSecond, 7)} QFX/s, time-weighted`} className="mono" />
            <Stat label="≈ per day at this rate" value={`+${fmt(myDaily, 4)}`} sub="QFX from the reserve" className="pos" />
            <Stat label="Accrued, not yet credited" value={fmt(info.pending, 7)} sub="shown in your balance" />
            <Stat label="Nominal APR" value={pct(info.aprBps)} sub={`${fmt(apy * 100, 2)}% APY if compounded daily`} className="gold" />
          </div>
          <div className="row" style={{ justifyContent: "center", marginTop: 14 }}>
            <button className="btn" disabled={tx.busy} onClick={() => tx.run("Credit yield", async () => { const r = await invokeContract(tx.wallet.address!, tx.wallet.sign, CONTRACTS.qfx, "settle", [addr(tx.wallet.address!)]); setRefresh((x) => x + 1); return r.hash.slice(0, 10); })}>Credit my yield (compound)</button>
          </div>
          <TxStatus status={tx.status} />
          <a className="calc-panel-link" href="#calculator" data-testid="rewards-calc-link">🧮 Project your yield (simple vs compounding) ↓</a>
        </div>
      </div>
      <div className="card" style={{ marginTop: 18 }}>
        <h2>Reward reserve</h2>
        <div className="grid g-4">
          <Stat label="Holder-yield reserve" value={`${fmtCompact(info.rewardPool)} QFX`} sub="pre-funded with testnet XLM" className="gold" />
          <Stat label="Paid per day" value={`${fmt(info.dailyEmission, 4)} QFX`} sub={`on ${fmtCompact(info.eligibleSupply)} QFX earning`} />
          <Stat label="Runway at current rate" value={Number.isFinite(runwayDays) ? (runwayDays > 36_500 ? "> 100 years" : `${fmtCompact(runwayDays)} days`) : "—"} sub="then yield stops" />
          <Stat label="Hard APR cap" value={pct(info.maxAprBps)} sub="enforced in contract" />
        </div>
        <div className="grid g-4" style={{ marginTop: 10 }}>
          <Stat label="Eligible-supply cap" value={Number.isFinite(info.maxEligible) ? `${fmtCompact(info.maxEligible)} QFX` : "—"} sub="bounds the reserve commitment" />
          <Stat label="Effective APR now" value={pct(info.effectiveAprBps)} sub={info.effectiveAprBps < info.aprBps ? "diluted: earning supply is above the cap" : "earning supply is under the cap"} />
        </div>
        <ul className="muted" style={{ fontSize: "0.85rem", paddingLeft: 18 }}>
          <li>Yield is <b>paid from the reserve</b> (QFX that was itself minted against deposited XLM). Paying it never changes total supply, so reserve = supply always holds.</li>
          <li>Anyone can top the reserve up with XLM (<span className="mono">fund_yield</span>) or with QFX from fees (<span className="mono">fund_yield_qfx</span>). When it runs dry, yield stops; it is never minted.</li>
          <li>Yield accrues <b>per second on the balance you actually held</b> (time-weighted), so a deposit held for two minutes earns two minutes of yield. It shows in your balance right away and is credited (and starts compounding) whenever your balance moves or you press “Credit my yield”.</li>
          <li>Only up to the eligible-supply cap earns the full APR; above it, holders share the capped emission pro rata, so the reserve commitment stays bounded. APR and cap changes go through an on-chain timelock.</li>
          <li>Contracts that cannot absorb yield (the staking contract and the QFX/QUSD pool) are excluded; staking rewards come from their own pre-funded QFX reserves.</li>
        </ul>
      </div>
      <div style={{ marginTop: 18 }} id="calculator">
        <HolderYieldCalculator embedded />
        <p className="muted" style={{ fontSize: "0.8rem", margin: "8px 4px 0" }}>Also see the <Link to="/calculators">staking and liquidity calculators</Link>.</p>
      </div>
    </>
  );
}
