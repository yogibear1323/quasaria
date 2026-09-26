import { useEffect, useMemo, useState } from "react";
import { PageHead, Stat, TxStatus, useTx } from "../components/ui";
import { DEMO_QFX } from "../lib/demo";
import { CONTRACTS, CONTRACTS_CONFIGURED } from "../lib/config";
import { addr, invokeContract, readContract } from "../lib/soroban";
import { apyFromApr, DAY, projectBalance } from "../lib/math";
import { fmt, fmtCompact, fromUnits, pct } from "../lib/format";

type Info = { aprBps: number; maxAprBps: number; totalSupply: number; maxSupply: number; genesis: number; index: number };

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
  const [info, setInfo] = useState<Info>({ ...DEMO_QFX });
  const [balance, setBalance] = useState(DEMO_QFX.demoBalance);
  const [principal, setPrincipal] = useState("10000");
  const [days, setDays] = useState(365);
  const [now, setNow] = useState(() => Date.now() / 1000);
  const tx = useTx();

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now() / 1000), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!CONTRACTS_CONFIGURED) return;
    readContract<{ index: bigint; apr_bps: number; max_apr_bps: number; total_supply: bigint; max_supply: bigint; genesis: bigint }>(CONTRACTS.qfx, "reward_info")
      .then((r) => setInfo({ aprBps: r.apr_bps, maxAprBps: r.max_apr_bps, totalSupply: fromUnits(r.total_supply), maxSupply: fromUnits(r.max_supply), genesis: Number(r.genesis), index: Number(r.index) / 1e18 }))
      .catch(() => void 0);
  }, []);
  useEffect(() => {
    if (!CONTRACTS_CONFIGURED || !tx.wallet.address) return;
    readContract<bigint>(CONTRACTS.qfx, "balance", [addr(tx.wallet.address)]).then((b) => setBalance(fromUnits(b))).catch(() => void 0);
  }, [tx.wallet.address]);

  const secsIntoDay = (now - info.genesis) % DAY;
  const toNext = DAY - secsIntoDay;
  const hh = String(Math.floor(toNext / 3600)).padStart(2, "0"), mm = String(Math.floor((toNext % 3600) / 60)).padStart(2, "0"), ss = String(Math.floor(toNext % 60)).padStart(2, "0");
  const nextBal = projectBalance(balance, info.aprBps, 1);
  const apy = apyFromApr(info.aprBps);
  const proj = useMemo(() => projectBalance(Number(principal) || 0, info.aprBps, days), [principal, info.aprBps, days]);
  const supplyPct = (info.totalSupply / info.maxSupply) * 100;

  return (
    <>
      <PageHead kicker="Scene · Supernova" title="QFX · Quasaria Flux" right={<span className="pill gold">SEP-41 · compounding daily</span>}>
        Hold QFX, do nothing, grow. Every UTC day since genesis the global reward index multiplies by (1 + APR/365) — every wallet compounds at once.
      </PageHead>
      <div className="grid g-main-side">
        <div className="card glow" style={{ textAlign: "center", padding: 28 }}>
          <h3>{tx.wallet.address ? "Your QFX balance" : "Demo wallet balance"}</h3>
          <div className="orb-counter">{fmt(balance, 4)}</div>
          <div className="muted">QFX</div>
          <div className="grid g-3" style={{ marginTop: 22, textAlign: "left" }}>
            <Stat label="Next compounding in" value={`${hh}:${mm}:${ss}`} className="mono" />
            <Stat label="After next tick" value={fmt(nextBal, 4)} sub={`+${fmt(nextBal - balance, 4)} QFX`} className="pos" />
            <Stat label="Global index" value={fmt(info.index, 6)} sub="balance = shares × index" />
          </div>
          <div className="row" style={{ justifyContent: "center", marginTop: 18 }}>
            <button className="btn" disabled={tx.busy} onClick={() => tx.run("accrue", async () => (await invokeContract(tx.wallet.address!, tx.wallet.sign, CONTRACTS.qfx, "accrue", [])).hash.slice(0, 10))}>Poke index (keeper)</button>
          </div>
          <TxStatus status={tx.status} />
        </div>
        <div className="card">
          <h2>Rate & emission</h2>
          <div className="grid g-2">
            <Stat label="Nominal APR" value={pct(info.aprBps)} className="gold" sub="admin-set" />
            <Stat label="Effective APY" value={`${fmt(apy * 100, 2)}%`} className="gold" sub="daily compounding" />
            <Stat label="Hard APR cap" value={pct(info.maxAprBps)} sub="enforced in contract" />
            <Stat label="Supply" value={fmtCompact(info.totalSupply)} sub={`of ${fmtCompact(info.maxSupply)} max`} />
          </div>
          <div style={{ margin: "16px 0 6px" }} className="row between"><span className="muted" style={{ fontSize: "0.8rem" }}>Emission budget used</span><span className="mono">{fmt(supplyPct, 1)}%</span></div>
          <div className="progress"><div style={{ width: `${supplyPct}%` }} /></div>
          <ul className="muted" style={{ fontSize: "0.85rem", paddingLeft: 18 }}>
            <li>Interest is <b>minted</b> (inflationary), never taken from other users.</li>
            <li>Emission is bounded by <b>max supply</b>: once reached, the index freezes and rewards stop.</li>
            <li>The cap can only be lowered, never raised, after launch.</li>
          </ul>
        </div>
      </div>
      <div className="card" style={{ marginTop: 18 }}>
        <h2>Compounding calculator</h2>
        <div className="grid g-3">
          <div className="field"><label>Principal (QFX)</label><input className="input" value={principal} onChange={(e) => setPrincipal(e.target.value)} /></div>
          <div className="field"><label>Days held: {days}</label><input type="range" min={1} max={1095} value={days} onChange={(e) => setDays(Number(e.target.value))} /></div>
          <Stat label="Projected balance" value={fmt(proj, 2)} sub={`+${fmt(proj - Number(principal), 2)} QFX at ${pct(info.aprBps)} APR`} className="gold" />
        </div>
        <GrowthChart principal={Number(principal) || 1} aprBps={info.aprBps} />
        <p className="muted" style={{ fontSize: "0.78rem" }}>Projection assumes the APR stays constant and the max-supply cap is not reached. Rates can change at any time. Not financial advice.</p>
      </div>
    </>
  );
}
