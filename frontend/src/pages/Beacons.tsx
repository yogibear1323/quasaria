import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { PageHead } from "../components/ui";
import { BEACON_TIERS } from "../components/BeaconsPreview";
import { useWallet } from "../lib/wallet";
import { readQfx, useChain } from "../lib/chain";
import { breakEvenFees, runSim, type Lock } from "../lib/beaconsSim";
import "../theme/beacons-page.css";
import BeaconsFit from "../components/BeaconsFit";
import BeaconsLive from "../components/BeaconsLive";
import BeaconsDocs from "../components/BeaconsDocs";

const f = (n: number, d = 0) => n.toLocaleString("en-US", { maximumFractionDigits: d, minimumFractionDigits: d });
const PERKS = [0, 5, 10, 15, 20, 25];
const tierOf = (q: number) => { let t = "Below Spark"; for (const x of BEACON_TIERS) if (q >= x.lock) t = x.name; return t; };

function WalletQfx() {
  const w = useWallet();
  const chain = useChain(() => (w.address ? readQfx(w.address) : Promise.resolve(null)), [w.address]);
  if (!w.address) return <p className="muted">Connect a wallet to see your QFX balance here (read-only).</p>;
  if (!chain.data) return <p className="muted">{chain.error ? "Couldn't read your QFX balance." : "Reading your QFX balance…"}</p>;
  return <p>Your QFX balance (testnet, read-only): <b className="mono">{f(chain.data.balance, 4)} QFX</b>. Beacons is live on testnet only; this page is read-only.</p>;
}

function Simulator() {
  const [fees, setFees] = useState(300);
  const [tvl, setTvl] = useState(1_000_000);
  const [stake, setStake] = useState(10_000);
  const [lock, setLock] = useState<Lock>("none");
  const [rate, setRate] = useState(0.5);
  const [alloc, setAlloc] = useState(40);
  const [drought, setDrought] = useState(false);
  const [loss, setLoss] = useState(false);
  const r = useMemo(() => runSim({ tvl, alloc: alloc / 100, rate: rate / 100, fees, stake, lock, ruleDays: 30, days: 90,
    drought: drought ? [30, 60] : null, blendLoss: loss ? { day: 45, pct: 0.2 } : null }), [fees, tvl, stake, lock, rate, alloc, drought, loss]);
  const vs = r.userAprPct - 12;
  const be = breakEvenFees(alloc / 100, tvl, rate / 100);
  const W = 800, H = 220;
  const mx = Math.max(1, ...r.rows.map((x) => Math.max(x.reserve, x.insurance, x.buyback))) * 1.08;
  const pts = (k: "reserve" | "insurance" | "buyback") => r.rows.map((x, i) => `${((i / (r.rows.length - 1)) * W).toFixed(1)},${(H - (x[k] / mx) * H).toFixed(1)}`).join(" ");
  return (
    <>
      <div className="card">
        <div className="bp-ctrl">
          <label>Daily trading fees into the router (XLM) <output>{f(fees)}</output><input type="range" min={0} max={3000} step={10} value={fees} onChange={(e) => setFees(+e.target.value)} /></label>
          <label>Total staked (QFX) <output>{f(tvl)}</output><input type="range" min={100_000} max={10_000_000} step={100_000} value={tvl} onChange={(e) => setTvl(+e.target.value)} /></label>
          <label>Your stake (QFX)<input type="number" min={0} step={100} value={stake} onChange={(e) => setStake(Math.max(0, +e.target.value || 0))} /></label>
          <label>Lock length<select value={lock} onChange={(e) => setLock(e.target.value as Lock)}><option value="none">None (1.00×)</option><option value="30d">30 days (1.10×)</option><option value="90d">90 days (1.25×)</option></select></label>
          <label>Blend XLM supply rate (APR %) <output>{f(rate, 1)}%</output><input type="range" min={0} max={10} step={0.1} value={rate} onChange={(e) => setRate(+e.target.value)} /></label>
          <label>Blend allocation <output>{alloc}%</output><input type="range" min={0} max={50} step={5} value={alloc} onChange={(e) => setAlloc(+e.target.value)} /></label>
          <label className="bp-check"><input type="checkbox" checked={drought} onChange={(e) => setDrought(e.target.checked)} /> Fee drought (zero fees, days 30–60)</label>
          <label className="bp-check"><input type="checkbox" checked={loss} onChange={(e) => setLoss(e.target.checked)} /> Blend loss on day 45 (20% of deployed)</label>
        </div>
      </div>
      <div className="grid g-3" style={{ marginTop: 12 }}>
        <div className="card" data-testid="bp-apr"><div className="muted">Your estimated APR (90 days)</div><div className="bp-big">{f(r.userAprPct, 2)}%</div>
          <div className="muted">{r.lossInfo ? `Plus a one-off ${f(r.lossInfo.haircutPct, 2)}% haircut on stake from the Blend loss. ` : ""}Variable, illustrative, not guaranteed.</div></div>
        <div className="card"><div className="muted">Your payout per 4-hour cycle</div><div className="bp-big">{f(r.userPerEpochSteady, 3)} XLM</div><div className="muted">Tier: {tierOf(stake)} · steady state</div></div>
        <div className="card" data-testid="bp-vs"><div className="muted">vs 12% QFX holder yield (given up while staked)</div><div className={`bp-big ${vs >= 0 ? "bp-good" : "bp-bad"}`}>{vs >= 0 ? "+" : ""}{f(vs, 2)} pts</div>
          <div className="muted">Break-even ≈ {f(be)} XLM/day of router fees at this stake size.</div></div>
      </div>
      <div className="card" style={{ marginTop: 12 }}>
        <h3 style={{ marginTop: 0 }}>Reserve, insurance and buyback over 90 days (XLM)</h3>
        <svg className="bp-chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="Reserve level chart">
          {[1, 2, 3].map((i) => <line key={i} x1={0} x2={W} y1={(H * i) / 4} y2={(H * i) / 4} stroke="#dfdcf3" vectorEffect="non-scaling-stroke" />)}
          <polyline fill="none" stroke="#7c3aed" strokeWidth={2} vectorEffect="non-scaling-stroke" points={pts("buyback")} />
          <polyline fill="none" stroke="#d97706" strokeWidth={2} vectorEffect="non-scaling-stroke" points={pts("insurance")} />
          <polyline fill="none" stroke="#0891b2" strokeWidth={2} vectorEffect="non-scaling-stroke" points={pts("reserve")} />
        </svg>
        <p className="muted"><span style={{ color: "#0891b2" }}>■</span> reserve · <span style={{ color: "#d97706" }}>■</span> insurance · <span style={{ color: "#7c3aed" }}>■</span> buyback/treasury · after 90 days: reserve {f(r.reserveEnd)}, insurance {f(r.insuranceEnd)}, buyback {f(r.buybackEnd)} XLM · pool avg APR {f(r.avgAprPct, 2)}% · cycles at the 25% cap: {r.epochsAtCap}</p>
        {r.lossInfo && <p className="muted">Blend loss {f(r.lossInfo.loss)} XLM: insurance covered {f(r.lossInfo.covered)}, stakers absorb {f(r.lossInfo.stakerLoss)} XLM ({f(r.lossInfo.haircutPct, 2)}% pro rata on every exit). The QFX peg reserve is untouched.</p>}
      </div>
    </>
  );
}

export default function Beacons() {
  const [usdc, setUsdc] = useState(false);
  const [peg, setPeg] = useState(1);
  const drift = Math.abs(peg - 1) * 100;
  return (
    <>
      <PageHead kicker="Testnet · unaudited · live contracts" title="Beacons" right={<div className="row"><a className="pill gold" href="#live-testnet">Live on testnet ↓</a><a className="pill gold" href="#how-beacons-fits">How Beacons fits ↓</a><a className="pill gold" href="#beacons-docs">Full documents ↓</a><Link className="pill cyan" to="/back-office">Back Office panel</Link></div>}>
        Lock QFX into one of six tiers and share real protocol revenue, paid in XLM every 4 hours. Every QFX earns the same share; tiers add perks. The contracts are live on Stellar testnet only (unaudited, testnet XLM, no real value). Nothing here is a guaranteed return.
      </PageHead>
      <div className="bp-banner" role="note">Testnet · unaudited. Live contracts on Stellar testnet only, not mainnet. Rates are variable and the simulator below is illustrative. No wallet action on this page sends a transaction.</div>
      <div className="card"><WalletQfx /></div>
      <BeaconsLive />
      <BeaconsFit />

      <section className="bp-sec" aria-labelledby="bp-tiers"><h2 id="bp-tiers">Tiers, priced in QFX</h2><p className="muted">Flat reward weight 1.00 in every tier. Lock boost for anyone: none 1.00× · 30 days 1.10× · 90 days 1.25×. No per-wallet cap.</p>
        <div className="bp-tiers">{BEACON_TIERS.map((t, i) => (
          <div key={t.id} className="bp-tier"><div className="muted">Tier {i + 1} of 6</div><h3 style={{ margin: "2px 0" }}>{t.name}</h3><b>{f(t.lock)}</b><span className="muted">QFX min · {PERKS[i]}% trading-fee discount · XP · visuals</span></div>))}</div></section>

      <section className="bp-sec"><h2>Blend pool</h2><p className="muted">40% of staked value (30–50% range) goes to a Blend pool; 60% stays as a cash buffer for exits.</p>
        <div className="bp-seg" role="group" aria-label="Blend pool"><button aria-pressed={!usdc} onClick={() => setUsdc(false)}>XLM pool (default)</button><button aria-pressed={usdc} onClick={() => setUsdc(true)}>USDC pool (alternative)</button></div>
        <div className="card" style={{ marginTop: 10 }}>{usdc ? <><b>USDC pool (not default).</b> Needs XLM↔USDC swaps, adding costs and XLM/USD price risk to the payout pool.</> : <><b>XLM pool (default).</b> Same asset as payouts and the vault, so XLM price moves create no mismatch.</>}
          <p className="muted" style={{ marginBottom: 0 }}>Live-rate caveat: Blend's XLM supply rate was about 0.02% (30-day average, Oct 11, 2026). The simulator defaults to 0.5%, an illustrative base case.</p></div></section>

      <section className="bp-sec"><h2>Fee split</h2>
        <div className="bp-split" role="img" aria-label="40% stakers, 10% insurance, 50% operations"><div style={{ width: "40%", background: "#67e8f9" }}>40% stakers</div><div style={{ width: "10%", background: "#F2B84B" }}>10%</div><div style={{ width: "50%", background: "#c4b5fd" }}>50% operations</div></div>
        <p className="muted">Of fees entering the fee router. Today the DEX's swap fee goes entirely to liquidity providers (minus referral cuts), so Beacons needs a new protocol fee share on pools first. See the integration plan.</p></section>

      <section className="bp-sec"><h2>Reward schedule</h2><div className="grid g-3">
        <div className="card"><h3>1/42 every 4 hours</h3><p className="muted">Each cycle pays 1/42 of the reserve, about 7 days of smoothing.</p></div>
        <div className="card"><h3>25% APR cap</h3><p className="muted">Above the cap, the excess stays in the reserve.</p></div>
        <div className="card"><h3>30-day overflow</h3><p className="muted">Reserve above 30 days of payouts goes to insurance (to 5% of the Blend deployment), then buyback/treasury.</p></div></div></section>

      <section className="bp-sec"><h2>Peg monitor</h2><div className="card">
        <label className="muted">QFX price in XLM: <b className="mono">{peg.toFixed(3)}</b> ({drift.toFixed(1)}% drift)<input type="range" min={0.97} max={1.03} step={0.001} value={peg} onChange={(e) => setPeg(+e.target.value)} style={{ width: "100%", accentColor: "var(--violet)" }} /></label>
        <p>{drift > 1 ? <><b className="bp-bad">Paused:</b> new stakes and tier upgrades. Claims and exits keep working.</> : <><b className="bp-good">Open:</b> staking and upgrades allowed.</>}</p></div></section>

      <section className="bp-sec"><h2>Unbonding</h2><div className="card"><ul>
        <li><b>7-day unbonding</b>, no rewards while unbonding.</li><li><b>Exit cap</b> 2% of staked value per 4-hour cycle, <b>FIFO queue</b> with position and ETA.</li>
        <li><b>One-epoch warm-up</b> before new stake earns.</li><li>After an uncovered Blend loss, a pro-rata haircut applies to every exit.</li><li>If QFX minting is paused, exits are paid in XLM until it resumes.</li></ul></div></section>

      <section className="bp-sec"><h2>How staked QFX reaches Blend</h2><p className="muted">The vault redeems QFX for XLM 1:1, supplies 40% to Blend's XLM pool, keeps 60% as a buffer, and mints fresh QFX 1:1 on exit. The QFX contract is unchanged and stays fully backed.</p>
        <div className="card"><svg className="bp-flow" viewBox="0 0 900 230" role="img" aria-label="Routing flow"><defs><marker id="bpar" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10z" fill="#4a4470" /></marker></defs>
          <g fontSize="14" fill="#1b1640" textAnchor="middle">
            <rect x="10" y="80" width="140" height="64" rx="12" fill="#ffffff" stroke="#cdc7ec" /><text x="80" y="108">Staker</text><text x="80" y="128" fill="#4a4470" fontSize="12">stakes QFX</text>
            <rect x="210" y="80" width="170" height="64" rx="12" fill="#ffffff" stroke="#0891b2" /><text x="295" y="108">Beacon vault</text><text x="295" y="128" fill="#4a4470" fontSize="12">redeem 1:1</text>
            <rect x="450" y="10" width="190" height="64" rx="12" fill="#ffffff" stroke="#7c3aed" /><text x="545" y="38">Blend XLM pool</text><text x="545" y="58" fill="#4a4470" fontSize="12">40%</text>
            <rect x="450" y="150" width="190" height="64" rx="12" fill="#ffffff" stroke="#cdc7ec" /><text x="545" y="178">Cash buffer</text><text x="545" y="198" fill="#4a4470" fontSize="12">60%, pays exits</text>
            <rect x="700" y="80" width="190" height="64" rx="12" fill="#ffffff" stroke="#d97706" /><text x="795" y="108">Insurance fund</text><text x="795" y="128" fill="#4a4470" fontSize="12">covers losses first</text></g>
          <g stroke="#4a4470" fill="none" markerEnd="url(#bpar)"><path d="M150 112H205" /><path d="M380 100L445 50" /><path d="M380 125L445 175" /><path d="M640 45L700 95" /></g></svg></div></section>

      <section className="bp-sec" aria-labelledby="bp-sim"><h2 id="bp-sim">Simulator</h2><p className="muted">Same formulas as the Beacons simulations (sim.py). Other stakers assumed at weight 1.00. Illustrative only, not a guaranteed return.</p><Simulator /></section>
      <BeaconsDocs />
      <p className="muted" style={{ marginTop: 20 }}>Full write-up, deployment scope and integration plan: <a href="https://github.com/yogibear1323/quasaria-beacons" target="_blank" rel="noreferrer">quasaria-beacons on GitHub</a> · standalone playground: <a href="https://yogibear1323.github.io/quasaria-beacons/" target="_blank" rel="noreferrer">yogibear1323.github.io/quasaria-beacons</a></p>
    </>
  );
}
