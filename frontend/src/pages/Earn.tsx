import { Link } from "react-router-dom";
import { PageHead } from "../components/ui";
import { AssetLogo } from "../components/AssetBits";
import { fmt, fmtCompact } from "../lib/format";
import { GLACIERQ_ICON_128, REWARD_ASSET_CODE, REWARD_DISCLOSURE, REWARD_ISSUER, REWARD_TIERS, TOKENOMICS, REWARD_TOTAL_SUPPLY, pctYear, reserveYearsAtCap } from "../lib/rewards";

/** /earn: LP positions and fee earnings, plus GLACIERQ holder rewards. */
export default function Earn() {
  return (
    <>
      <PageHead kicker="Earnings" title="Earnings" right={<span className="pill gold">Testnet · unaudited</span>}>
        Two ways to earn on Quasaria: swap fees as a liquidity provider, and daily {REWARD_ASSET_CODE} holder rewards.
      </PageHead>
      <section className="card glow how-earn" aria-labelledby="how-earn-h" data-testid="how-earnings-work" style={{ marginBottom: 16 }}>
        <h2 id="how-earn-h" style={{ marginTop: 0 }}>How earnings work</h2>
        <div className="grid g-2 how-earn-grid">
          <div className="how-earn-card" data-testid="how-supply">
            <div className="kicker">1 · The token</div>
            <h3 className="how-earn-t"><AssetLogo code={REWARD_ASSET_CODE} issuer={REWARD_ISSUER.testnet ?? REWARD_ISSUER.mainnet ?? "-"} logo={GLACIERQ_ICON_128} size={22} /> Glacier ({REWARD_ASSET_CODE})</h3>
            <p className="muted">{fmt(REWARD_TOTAL_SUPPLY / 1e9, 0)} billion in total, fixed, with the issuer locked so no more can ever be made. {fmt(TOKENOMICS.rewardReserve / 1e9, 0)} billion sits in the reward reserve and {fmt(TOKENOMICS.treasury / 1e9, 0)} billion in the treasury.</p>
          </div>
          <div className="how-earn-card" data-testid="how-rates">
            <div className="kicker">2 · Holder rewards</div>
            <h3 className="how-earn-t">{pctYear(REWARD_TIERS[0].apr)}% a year from 1M, {pctYear(REWARD_TIERS[1].apr)}% a year from 10M</h3>
            <p className="muted">Hold {REWARD_ASSET_CODE} and get paid every day as an ordinary Stellar payment, on your whole balance. Under 1 million earns nothing.</p>
          </div>
          <div className="how-earn-card" data-testid="how-cap">
            <div className="kicker">3 · The daily cap</div>
            <h3 className="how-earn-t">{fmtCompact(TOKENOMICS.dailyCap)} {REWARD_ASSET_CODE} a day, at most</h3>
            <p className="muted">If everyone together would earn more than that, every reward is scaled down pro rata. At the cap the reserve lasts about {fmt(reserveYearsAtCap(), 1)} years, and longer at normal usage.</p>
          </div>
          <div className="how-earn-card" data-testid="how-lp">
            <div className="kicker">4 · Liquidity providers</div>
            <h3 className="how-earn-t">0.30% on every swap</h3>
            <p className="muted">Add both sides of a pair to one of Stellar's native pools and the 0.30% fee on each swap is shared by that pool's providers, in proportion to their share.</p>
          </div>
        </div>
        <p className="how-earn-note" data-testid="how-disclosure"><b>Plainly:</b> rewards come from a finite reserve, are not guaranteed, and the daily cap can reduce them. {REWARD_DISCLOSURE.split(". They are not")[0]}. <Link to="/holders#tokenomics">Full tokenomics</Link></p>
      </section>
      <div className="grid g-2">
        <div className="card glow earn-card" data-testid="earn-lp">
          <h2 style={{ margin: 0 }}>Liquidity pools</h2>
          <p className="muted">Add both sides of a pair to a Stellar-native pool and earn a share of every swap. Impermanent loss can outweigh fees.</p>
          <div className="row earn-actions"><Link className="btn small" to="/pools">Open Pools</Link><Link className="btn ghost small" to="/calculators?c=lp">LP calculator</Link></div>
        </div>
        <div className="card glow earn-card" data-testid="earn-rewards">
          <h2 style={{ margin: 0 }}>{REWARD_ASSET_CODE} holder rewards</h2>
          <p className="muted">~{pctYear(REWARD_TIERS[0].apr)}% a year from 1M, ~{pctYear(REWARD_TIERS[1].apr)}% from 10M, paid daily from a finite reserve. Not guaranteed.</p>
          <div className="row earn-actions"><Link className="btn small" to="/holders">Holders tab</Link></div>
        </div>
      </div>
    </>
  );
}
