import { useEffect, useMemo, useState } from "react";
import { PageHead, SourceTag, Stat, TxStatus, ViewerNote, useTx } from "../components/ui";
import MintRedeem from "../components/MintRedeem";
import { DEMO_QFX } from "../lib/demo";
import { CONTRACTS } from "../lib/config";
import { addr, invokeContract } from "../lib/soroban";
import { readQfx, useChain, useViewer } from "../lib/chain";
import { apyFromApr, projectBalance } from "../lib/math";
import { fmt, fmtCompact, pct } from "../lib/format";

function GrowthChart({ principal, aprBps }: { principal: number; aprBps: number }) {
  const W = 600, H = 180;
  const pts = Array.from({ length: 366 }, (_, d) => projectBalance(principal, aprBps, d));
  const max = pts[365], min = principal;
  const path = pts.map((v, d) => `${d ? "L" : "M"}${(d / 365) * W},${H - ((v - min) / (max - min || 1)) * (H - 20) - 10}`).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none">
      <defs>
        <linearGradient id="g-growth" x1="0" x2="1"><stop offset="0" stopColor="#ffd166" /><stop offset="0.5" stopColor="#ff9a3d" /><stop offset="1" stopColor="#ff3dcb" /></linearGradient>
        <linearGradient id="g-growth-a" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#ff9a3d" stopOpacity="0.35" /><stop offset="1" stopColor="#ff3dcb" stopOpacity="0" /></linearGradient>
      </defs>
      <path d={`${path} L${W},${H} L0,${H} Z`} fill="url(#g-growth-a)" />
      <path d={path} fill="none" stroke="url(#g-growth)" strokeWidth={3} />
    </svg>
  );
}

export default function Rewards() {
  const viewer = useViewer("trader");
  const tx = useTx();
  const [refresh, setRefresh] = useState(0);
  const chain = useChain(() => readQfx(viewer.address), [viewer.address, refresh]);
  const info = chain.data ?? DEMO_QFX;
  const balance = chain.data ? chain.data.balance : DEMO_QFX.demoBalance;
  const [principal, setPrincipal] = useState("1000");
  const [days, setDays] = useState(365);
  const [now, setNow] = useState(() => Date.now() / 1000);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now() / 1000), 1000);
    return () => clearInterval(t);
  }, []);

  const toNext = Math.max(0, info.nextAccrualAt - now);
  const hh = String(Math.floor(toNext / 3600)).padStart(2, "0"), mm = String(Math.floor((toNext % 3600) / 60)).padStart(2, "0"), ss = String(Math.floor(toNext % 60)).padStart(2, "0");
  const myDaily = (balance * info.aprBps) / 10_000 / 365;
  const apy = apyFromApr(info.aprBps);
  const runwayDays = info.dailyEmission > 0 ? info.rewardPool / info.dailyEmission : Infinity;
  const proj = useMemo(() => projectBalance(Number(principal) || 0, info.aprBps, days), [principal, info.aprBps, days]);

  return (
    <>
      <PageHead kicker="Scene · Supernova" title="QFX · Quasaria Flux" right={<div className="row"><SourceTag {...chain} /><span className="pill gold">1 QFX = 1 XLM · fully backed</span></div>}>
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
            <Stat label="Next reward day in" value={`${hh}:${mm}:${ss}`} className="mono" />
            <Stat label="≈ per day at this rate" value={`+${fmt(myDaily, 4)}`} sub="QFX from the reserve" className="pos" />
            <Stat label="Accrued, not yet credited" value={fmt(info.pending, 7)} sub="shown in your balance" />
            <Stat label="Nominal APR" value={pct(info.aprBps)} sub={`${fmt(apy * 100, 2)}% APY if compounded daily`} className="gold" />
          </div>
          <div className="row" style={{ justifyContent: "center", marginTop: 14 }}>
            <button className="btn" disabled={tx.busy} onClick={() => tx.run("Credit yield", async () => { const r = await invokeContract(tx.wallet.address!, tx.wallet.sign, CONTRACTS.qfx, "settle", [addr(tx.wallet.address!)]); setRefresh((x) => x + 1); return r.hash.slice(0, 10); })}>Credit my yield (compound)</button>
          </div>
          <TxStatus status={tx.status} />
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
        <ul className="muted" style={{ fontSize: "0.85rem", paddingLeft: 18 }}>
          <li>Yield is <b>paid from the reserve</b> (QFX that was itself minted against deposited XLM). Paying it never changes total supply, so reserve = supply always holds.</li>
          <li>Anyone can top the reserve up with XLM (<span className="mono">fund_yield</span>) or with QFX from fees (<span className="mono">fund_yield_qfx</span>). When it runs dry, yield stops; it is never minted.</li>
          <li>Yield accrues once per UTC day and shows in your balance right away; it is credited (and starts compounding) whenever your balance moves or you press “Credit my yield”.</li>
          <li>Contracts that cannot absorb yield (the staking contract and the QFX/QUSD pool) are excluded; staking rewards come from their own pre-funded QFX reserves.</li>
        </ul>
      </div>
      <div className="card" style={{ marginTop: 18 }}>
        <h2>Yield calculator</h2>
        <div className="grid g-3">
          <div className="field"><label>Principal (QFX = XLM)</label><input className="input" value={principal} onChange={(e) => setPrincipal(e.target.value)} /></div>
          <div className="field"><label>Days held: {days}</label><input type="range" min={1} max={1095} value={days} onChange={(e) => setDays(Number(e.target.value))} /></div>
          <Stat label="Projected balance" value={fmt(proj, 2)} sub={`+${fmt(proj - Number(principal), 2)} QFX at ${pct(info.aprBps)} APR`} className="gold" />
        </div>
        <GrowthChart principal={Number(principal) || 1} aprBps={info.aprBps} />
        <p className="muted" style={{ fontSize: "0.78rem" }}>Projection assumes the APR stays constant, your yield is credited daily, and the reward reserve does not run out. Rates can change at any time and the reserve is finite. Testnet only, unaudited. Not financial advice.</p>
      </div>
    </>
  );
}
