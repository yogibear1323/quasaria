import { Link } from "react-router-dom";
import { PageHead } from "../components/ui";
import { REWARD_ASSET_CODE, REWARD_TIERS } from "../lib/rewards";

/** /earn: LP positions and fee earnings, plus GLACIERQ holder rewards. */
export default function Earn() {
  return (
    <>
      <PageHead kicker="Earnings" title="Earnings" right={<span className="pill gold">Testnet · unaudited</span>}>
        Two ways to earn on Quasaria: swap fees as a liquidity provider, and daily {REWARD_ASSET_CODE} holder rewards.
      </PageHead>
      <div className="grid g-2">
        <div className="card glow earn-card" data-testid="earn-lp">
          <h2 style={{ margin: 0 }}>Liquidity pools</h2>
          <p className="muted">Add both sides of a pair to a Stellar-native pool and earn a share of every swap. Impermanent loss can outweigh fees.</p>
          <div className="row earn-actions"><Link className="btn small" to="/pools">Open Pools</Link><Link className="btn ghost small" to="/calculators?c=lp">LP calculator</Link></div>
        </div>
        <div className="card glow earn-card" data-testid="earn-rewards">
          <h2 style={{ margin: 0 }}>{REWARD_ASSET_CODE} holder rewards</h2>
          <p className="muted">~{REWARD_TIERS[0].apr * 100}% a year from 1M, ~{REWARD_TIERS[1].apr * 100}% from 10M, paid daily from a finite reserve. Not guaranteed.</p>
          <div className="row earn-actions"><Link className="btn small" to="/holders">Holders tab</Link></div>
        </div>
      </div>
    </>
  );
}
