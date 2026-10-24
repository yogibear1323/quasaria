import { NETWORK, IS_MAINNET } from "../lib/config";
import { Link } from "react-router-dom";
import { useAsync } from "../lib/useAsync";
import { useWallet } from "../lib/wallet";
import { fetchOps, rewardCfg, type OpRec } from "../lib/activity";
import { lpEarnings, lpFlows, paymentTotals, type LpLine, type PaymentTotals } from "../lib/earnings";
import { fetchPositions } from "../lib/nativePools";
import { fetchRewardBalance, rewardsLive } from "../lib/holders";
import { PageHead } from "../components/ui";
import { AssetLogo } from "../components/AssetBits";
import { fmt, fmtCompact } from "../lib/format";
import { GLACIERQ_ICON_128, REFERRAL_LIVE, REFERRAL_TERMS, REWARD_ASSET_CODE, dailyReward, tierFor, REWARD_DISCLOSURE, REWARD_ISSUER, REWARD_TIERS, TOKENOMICS, REWARD_TOTAL_SUPPLY, pctYear, reserveYearsAtCap, REWARD_RATE_TEXT } from "../lib/rewards";

const NET = NETWORK;
const HISTORY_LIMIT = 200;
const sign = (n: number) => `${n >= 0 ? "+" : "−"}${fmt(Math.abs(n), Math.abs(n) < 1 ? 6 : 4)}`;

export function LpEarnings({ lines, truncated }: { lines: LpLine[]; truncated: boolean }) {
  if (!lines.length) return <p className="muted" data-testid="lp-none">No pool shares on this account yet. <Link to="/pools">Open Pools</Link> to add a pair.</p>;
  return (
    <>
      {lines.map((l) => (
        <div key={l.poolId} className="hrow" data-testid="lp-line">
          <div className="hrow-main"><b>{l.a.code} / {l.b.code}</b><span className="muted l-tiny">worth now {fmt(l.a.now, 4)} {l.a.code} + {fmt(l.b.now, 4)} {l.b.code}</span></div>
          <div className="hrow-val mono">{l.sawDeposit ? <><span>{sign(l.a.net)} {l.a.code}</span><span>{sign(l.b.net)} {l.b.code}</span></> : <span className="muted">no deposit in history</span>}</div>
        </div>
      ))}
      <p className="muted l-tiny" style={{ marginBottom: 0 }}>Change versus what you put in, minus what you took out. It is the fees your share earned minus any impermanent loss: fees stay in the pool and raise what your shares are worth, they are not paid out separately. {truncated ? `Only your latest ${HISTORY_LIMIT} operations are read, so older deposits may be missing.` : ""}</p>
    </>
  );
}

export function HolderEarnings({ live, address, balance, totals }: { live: boolean; address: string | null; balance: number | null; totals: PaymentTotals }) {
  if (!address) return <p className="muted">Sign in to see your {REWARD_ASSET_CODE} balance and rewards.</p>;
  if (!live) return <p className="muted" data-testid="rewards-notlive">Not live yet: the {REWARD_ASSET_CODE} issuer and reward reserve are not on this network, so there is nothing to read. Rates when it starts: {REWARD_RATE_TEXT}. Not guaranteed.</p>;
  const b = balance ?? 0, tier = tierFor(b);
  return (
    <dl className="kv" data-testid="holder-earnings">
      <div><dt>Balance</dt><dd className="mono">{fmt(b, 2)} {REWARD_ASSET_CODE}</dd></div>
      <div><dt>Tier</dt><dd>{tier ? `${tier.name} · ${pctYear(tier.apr)}% a year` : `none (needs ${fmtCompact(REWARD_TIERS[0].min)})`}</dd></div>
      <div><dt>Estimated per day</dt><dd className="mono">{fmt(dailyReward(b), 2)} {REWARD_ASSET_CODE}</dd></div>
      <div><dt>Received so far</dt><dd className="mono">{fmt(totals.reward, 2)} {REWARD_ASSET_CODE}</dd></div>
    </dl>
  );
}

export function ReferralEarnings({ totals, address }: { totals: PaymentTotals; address: string | null }) {
  return (
    <>
      {!REFERRAL_LIVE && <p className="notice" data-testid="referral-flag" style={{ fontSize: "0.82rem" }}>Coming after launch: it starts after the first mainnet holder-reward run.</p>}
      <dl className="kv">
        <div><dt>As referrer ({REFERRAL_TERMS.referrerPct}% for {REFERRAL_TERMS.referrerDays} days)</dt><dd className="mono">{address ? fmt(totals.referrer, 2) : "—"} {REWARD_ASSET_CODE}</dd></div>
        <div><dt>As a friend (+{REFERRAL_TERMS.refereePct}% for {REFERRAL_TERMS.refereeMonths} months)</dt><dd className="mono">{address ? fmt(totals.referee, 2) : "—"} {REWARD_ASSET_CODE}</dd></div>
      </dl>
      <p className="muted l-tiny" style={{ marginBottom: 0 }}><Link to="/referral">See the terms</Link>. Not guaranteed.</p>
    </>
  );
}

/** /earn: your LP position gains, GLACIERQ holder rewards, plus how each works. */
export default function Earn() {
  const w = useWallet();
  const live = rewardsLive(NET);
  const ops = useAsync<OpRec[]>(() => (w.address ? fetchOps(NET, w.address, HISTORY_LIMIT) : Promise.resolve([])), [w.address]);
  const pos = useAsync(() => (w.address ? fetchPositions(NET, w.address, { xlmUsd: null }) : Promise.resolve([])), [w.address]);
  const bal = useAsync(() => (w.address && live.live ? fetchRewardBalance(NET, w.address) : Promise.resolve(null)), [w.address, live.live]);
  const lines = w.address ? lpEarnings(pos.data ?? [], lpFlows(ops.data ?? [], w.address)) : [];
  const totals = w.address ? paymentTotals(ops.data ?? [], w.address, rewardCfg(NET)) : { reward: 0, referrer: 0, referee: 0, count: 0 };
  return (
    <>
      <PageHead kicker="Earnings" title="Earnings" right={<span className="pill gold">{IS_MAINNET ? "Mainnet" : "Testnet"}</span>}>
        Two ways to earn on Quasaria: swap fees as a liquidity provider and daily {REWARD_ASSET_CODE} holder rewards. Your own numbers are below.
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
            <h3 className="how-earn-t">{REWARD_RATE_TEXT}</h3>
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
      <div className="grid g-2 earn-mine" data-testid="earn-mine">
        <div className="card glow earn-card" data-testid="earn-lp">
          <h2 style={{ margin: 0 }}>Liquidity positions</h2>
          {!w.address ? <p className="muted">Sign in to see your pool shares and what they have earned. <button className="btn small" onClick={() => w.openModal()}>Sign in</button></p>
            : pos.loading || ops.loading ? <p className="muted">Reading Horizon…</p>
            : <LpEarnings lines={lines} truncated={(ops.data?.length ?? 0) >= HISTORY_LIMIT} />}
          <div className="row earn-actions"><Link className="btn small" to="/pools">Open Pools</Link><Link className="btn ghost small" to="/calculators?c=lp">LP calculator</Link></div>
        </div>
        <div className="card glow earn-card" data-testid="earn-rewards">
          <h2 style={{ margin: 0 }}>{REWARD_ASSET_CODE} holder rewards</h2>
          <p className="muted l-tiny" style={{ margin: "4px 0 8px" }}>{REWARD_RATE_TEXT}, paid daily from a finite reserve. Not guaranteed.</p>
          <HolderEarnings live={live.live} address={w.address} balance={bal.data} totals={totals} />
          <div className="row earn-actions"><Link className="btn small" to="/holders">Holders tab</Link></div>
        </div>
      </div>
    </>
  );
}
