import { useEffect, useRef, useState } from "react";
import { AssetLogo } from "./AssetBits";
import { XLM_LOGO } from "../lib/xlm";
import { useAsync } from "../lib/useAsync";
import { curatedList, fetchPoolForPair, tvlUsd, type NetId, type Pricing, type PoolRow } from "../lib/nativePools";

const FEE = 0.003;
/** Monthly volume (USD) per pair, as reported Oct 2026. Static: Horizon has no cheap 30-day pool volume endpoint. */
const PAIRS = [
  { code: "SHX", volume: 735_000 },
  { code: "yXLM", volume: 683_000 },
  { code: "VELO", volume: 160_000 },
  { code: "XRP", volume: 115_000 },
] as const;
const AS_OF = "as of Oct 2026";
const money = (n: number, d = 0) => `$${n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d })}`;

/** Counts up from 0 once the element scrolls into view. */
function Counter({ to, prefix = "$" }: { to: number; prefix?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [v, setV] = useState(0);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce || typeof IntersectionObserver === "undefined") { setV(to); return; }
    let raf = 0;
    const io = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return;
      io.disconnect();
      const t0 = performance.now();
      const step = (t: number) => { const k = Math.min(1, (t - t0) / 1400); setV(to * (1 - Math.pow(1 - k, 3))); if (k < 1) raf = requestAnimationFrame(step); };
      raf = requestAnimationFrame(step);
    }, { threshold: 0.3 });
    io.observe(el);
    return () => { io.disconnect(); cancelAnimationFrame(raf); };
  }, [to]);
  return <span ref={ref} className="mono">{prefix}{Math.round(v).toLocaleString("en-US")}</span>;
}

export default function LpEarn({ net, pricing, onBecome }: { net: NetId; pricing: Pricing; onBecome: () => void }) {
  const list = curatedList(net);
  const pairs = PAIRS.map((p) => ({ ...p, fees: p.volume * FEE, asset: list.find((c) => c.code === p.code) ?? null }));
  const total = pairs.reduce((s, p) => s + p.fees, 0);
  const live = useAsync<(PoolRow | null)[]>(() => net === "mainnet"
    ? Promise.all(pairs.map((p) => (p.asset ? fetchPoolForPair(net, { code: "XLM", issuer: null }, p.asset).catch(() => null) : Promise.resolve(null))))
    : Promise.resolve(pairs.map(() => null)), [net]);
  const [pick, setPick] = useState(0);
  const [dep, setDep] = useState("1000");
  const p = pairs[pick];
  const pool = live.data?.[pick] ?? null;
  const liveTvl = pool ? tvlUsd(pool, pricing) : null;
  const EXAMPLE_TVL = 250_000;
  const tvl = liveTvl ?? EXAMPLE_TVL;
  const d = Math.max(0, Number(dep) || 0);
  const share = d > 0 ? d / (tvl + d) : 0;
  const monthly = share * p.fees;

  return (
    <section className="card glow lp-earn" style={{ marginBottom: 16 }} data-testid="lp-earn">
      <span className="pill gold">Earn as a liquidity provider</span>
      <h2 className="lp-earn-h">Your liquidity, working while you sleep 🌙</h2>
      <p className="muted" style={{ marginTop: 0 }}>
        Every swap through a Stellar pool pays a <b>0.3% fee</b>. That fee stays in the pool and is shared among all liquidity providers in proportion to their share of the pool.
      </p>

      <h3 className="lp-earn-sub">Fee leaderboard <span className="muted l-tiny">· monthly volume {AS_OF}</span></h3>
      <div className="lp-earn-grid" data-testid="lp-leaderboard">
        {pairs.map((x, i) => (
          <button key={x.code} type="button" className={`lp-earn-card${i === pick ? " on" : ""}`} onClick={() => setPick(i)} data-testid="lp-pair-card">
            <span className="lp-earn-rank">#{i + 1}</span>
            <span className="row" style={{ gap: 4, display: "inline-flex", alignItems: "center" }}>
              <AssetLogo code="XLM" issuer={null} logo={XLM_LOGO} size={22} />
              <AssetLogo code={x.code} issuer={x.asset?.issuer ?? null} logo={x.asset?.logo ?? null} size={22} />
              <b style={{ marginLeft: 4 }}>XLM/{x.code}</b>
            </span>
            <span className="l-tiny muted">Monthly volume</span>
            <span className="lp-earn-vol">{money(x.volume)}+</span>
            <span className="l-tiny muted">Fees to providers / mo</span>
            <span className="lp-earn-fee">≈ <Counter to={x.fees} /></span>
          </button>
        ))}
      </div>
      <p className="lp-earn-total">≈ <Counter to={total} /> / month in fees across these four pools, <span className="muted">before it's split among all providers.</span></p>

      <div className="lp-earn-calc" data-testid="lp-calc">
        <h3 className="lp-earn-sub" style={{ marginTop: 0 }}>What could my share earn?</h3>
        <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
          <select className="input" style={{ maxWidth: 180 }} value={pick} onChange={(e) => setPick(Number(e.target.value))} aria-label="Pair" data-testid="lp-calc-pair">
            {pairs.map((x, i) => <option key={x.code} value={i}>XLM/{x.code}</option>)}
          </select>
          <input className="input" style={{ maxWidth: 180 }} inputMode="decimal" value={dep} onChange={(e) => setDep(e.target.value)} aria-label="Deposit in USD" placeholder="Deposit (USD)" data-testid="lp-calc-dep" />
        </div>
        <div className="lp-earn-out">
          <div><span className="l-tiny muted">Pool liquidity</span><b className="mono">{money(tvl)}</b>
            <span className="l-tiny muted">{liveTvl != null ? "live from Horizon" : live.loading ? "loading… (example)" : "example figure"}</span></div>
          <div><span className="l-tiny muted">Your pool share</span><b className="mono" data-testid="lp-calc-share">{(share * 100).toFixed(share < 0.001 ? 4 : 2)}%</b></div>
          <div><span className="l-tiny muted">Est. fees / month</span><b className="mono lp-earn-fee" data-testid="lp-calc-monthly">{money(monthly, 2)}</b>
            <span className="l-tiny muted">at {AS_OF} volume</span></div>
        </div>
        <p className="l-tiny muted" style={{ margin: "6px 0 0" }}>Share = deposit ÷ (pool liquidity + deposit). Est. fees = share × that pool's monthly fees. An estimate, not a promise.</p>
      </div>

      <div className="notice" role="note" style={{ margin: "12px 0", fontSize: "0.82rem" }} data-testid="lp-risk">
        <b>Keep it real:</b> the fees above go to <i>all</i> providers, so you earn only your share, not the whole amount. Earnings rise and fall with trading volume. Impermanent loss (price moves between the two assets) can outweigh the fees you earn. Past volume is no guarantee of future volume. Nothing here is guaranteed income, and no pool is risk-free.
      </div>
      <button className="btn" onClick={onBecome} data-testid="lp-become">Become a provider →</button>
    </section>
  );
}
