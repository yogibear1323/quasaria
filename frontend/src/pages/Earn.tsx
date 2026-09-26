import { Link } from "react-router-dom";
import { PageHead, SourceTag } from "../components/ui";
import { useChain } from "../lib/chain";
import { loadCalcPools, loadCalcQfx, loadCalcStaking } from "../lib/calcData";
import { reserveRunwayDays, stakingApr } from "../lib/calc";
import { fmt, pct } from "../lib/format";
import { fmtAmt, fmtDays, pctStr } from "../components/calc/common";

/** /earn — hub for the three ways to earn, each with its panel and calculator. */
export default function Earn() {
  const st = useChain(loadCalcStaking, []);
  const q = useChain(loadCalcQfx, []);
  const lp = useChain(loadCalcPools, []);
  const stakeAprs = (st.data?.pools ?? []).filter((p) => p.active).map((p) => stakingApr(p.ratePerSec, p.totalStaked, 0, Number.isFinite(p.stakeValueXlm / p.rewardValueXlm) ? p.stakeValueXlm / p.rewardValueXlm : 1));
  const core = (lp.data?.pools ?? []).filter((p) => p.group === "core");
  return (
    <>
      <PageHead kicker="Scene · Supernova" title="Earn" right={<span className="pill gold">Testnet · unaudited</span>}>
        Three ways to put testnet assets to work on Quasaria. Each has a live panel and a calculator that projects potential rewards from the current on-chain rates.
      </PageHead>
      <div className="grid g-3">
        <div className="card glow earn-card" data-testid="earn-staking">
          <div className="row between"><h2 style={{ margin: 0 }}>🪐 Stake</h2><SourceTag {...st} /></div>
          <p className="muted">Lock QFX or QLP in Orbit pools and stream QFX from each pool's pre-funded reward reserve.</p>
          <div className="earn-big gold mono">{stakeAprs.length ? `${pctStr(Math.min(...stakeAprs), 0)} – ${pctStr(Math.max(...stakeAprs), 0)}` : "…"}</div>
          <div className="muted" style={{ fontSize: "0.8rem" }}>current pool APRs · {(st.data?.pools ?? []).length || "…"} pools · reserves {st.data ? fmtAmt(st.data.pools.reduce((s, p) => s + p.reserve, 0)) : "…"} QFX</div>
          <div className="row earn-actions"><Link className="btn small" to="/calculators?c=staking">Staking calculator</Link><Link className="btn ghost small" to="/stake">Open Stake</Link></div>
        </div>
        <div className="card glow earn-card" data-testid="earn-holder">
          <div className="row between"><h2 style={{ margin: 0 }}>✺ Hold QFX</h2><SourceTag {...q} /></div>
          <p className="muted">1 QFX = 1 XLM, fully backed. Holders earn a capped daily yield from a finite reserve (simple interest unless settled).</p>
          <div className="earn-big gold mono">{q.data ? pct(q.data.aprBps) : "…"} <small className="muted">APR</small></div>
          <div className="muted" style={{ fontSize: "0.8rem" }}>{q.data ? `cap ${pct(q.data.maxAprBps)} · reserve ${fmtAmt(q.data.rewardPool)} QFX · lasts ${fmtDays(reserveRunwayDays(q.data.rewardPool, q.data.eligibleSupply, q.data.aprBps))} at current supply` : "…"}</div>
          <div className="row earn-actions"><Link className="btn small" to="/calculators?c=holder">Yield calculator</Link><Link className="btn ghost small" to="/rewards">Mint & rewards</Link></div>
        </div>
        <div className="card glow earn-card" data-testid="earn-lp">
          <div className="row between"><h2 style={{ margin: 0 }}>🌌 Provide liquidity</h2><SourceTag {...lp} /></div>
          <p className="muted">Deposit both sides of an x·y=k pool and earn swap fees (minus the referral cut). Watch out for impermanent loss.</p>
          <div className="earn-big gold mono">{core.length ? `${fmt(core[0].feeBps / 100, 2)}%` : "…"} <small className="muted">swap fee</small></div>
          <div className="muted" style={{ fontSize: "0.8rem" }}>{lp.data ? `${lp.data.pools.length} live pools · ${core.map((p) => `${p.symA}/${p.symB}`).join(", ")} + XLM/stablecoin pools` : "…"}</div>
          <div className="row earn-actions"><Link className="btn small" to="/calculators?c=lp">LP calculator</Link><Link className="btn ghost small" to="/pools">Open Pools</Link></div>
        </div>
      </div>
      <div className="card" style={{ marginTop: 18 }} data-testid="earn-calculators">
        <div className="row between" style={{ flexWrap: "wrap", gap: 10 }}>
          <div>
            <h2 style={{ margin: 0 }}>Calculators</h2>
            <p className="muted" style={{ margin: "4px 0 0", fontSize: "0.88rem" }}>Staking rewards with reserve-depletion warnings, holder yield (simple vs settled compounding) with reserve runway, and LP fee earnings with an impermanent-loss simulator. All in tokens and approximate USD.</p>
          </div>
          <Link className="btn" to="/calculators">Open all calculators →</Link>
        </div>
        <p className="calc-disclaimer" style={{ marginTop: 12 }}>Estimates only, not financial advice. Rates are variable. Testnet only; contracts are unaudited.</p>
      </div>
    </>
  );
}
