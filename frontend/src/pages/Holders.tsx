import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { PageHead } from "../components/ui";
import { AssetLogo } from "../components/AssetBits";
import { useWallet } from "../lib/wallet";
import { fmt, fmtCompact, short } from "../lib/format";
import {
  GLACIERQ_ICON_128, REWARD_ASSET_CODE, REWARD_DISCLOSURE, REWARD_ISSUER, REWARD_MIN_BALANCE, REWARD_TIERS, TOKENOMICS, REWARD_TOTAL_SUPPLY, dailyReward, reserveYearsAtCap, tierFor, pctYear } from "../lib/rewards";
import { fetchReserveStatus, fetchRewardBalance, fetchRewardHistory, rewardsLive, type Payment, type ReserveStatus } from "../lib/holders";

const NET = "testnet" as const; // mainnet is switched on only when the reward accounts exist and signing is enabled
const pctDay = (apr: number) => ((apr / 365) * 100).toFixed(apr === 0.05 ? 4 : 5);

function useAsync<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [s, set] = useState<{ data: T | null; loading: boolean; error: string | null }>({ data: null, loading: true, error: null });
  useEffect(() => {
    let alive = true;
    set((x) => ({ ...x, loading: true }));
    fn().then((d) => alive && set({ data: d, loading: false, error: null })).catch((e) => alive && set({ data: null, loading: false, error: String(e?.message ?? e) }));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return s;
}

function NotLive({ what }: { what: string }) {
  return <p className="muted" data-testid="not-live">Not live yet: {what}. The {REWARD_ASSET_CODE} issuer and reward reserve are not on this network yet, so there is nothing to read.</p>;
}

export default function Holders() {
  const w = useWallet();
  const live = rewardsLive(NET);
  const bal = useAsync(() => (w.address && live.live ? fetchRewardBalance(NET, w.address) : Promise.resolve(null)), [w.address, live.live]);
  const hist = useAsync(() => (w.address && live.live ? fetchRewardHistory(NET, w.address) : Promise.resolve([] as Payment[])), [w.address, live.live]);
  const reserve = useAsync<ReserveStatus | null>(() => (live.live ? fetchReserveStatus(NET) : Promise.resolve(null)), [live.live]);
  const balance = bal.data ?? 0;
  const tier = tierFor(balance);
  const daily = dailyReward(balance);
  const nextTier = tier ? REWARD_TIERS.find((t) => t.min > balance) : REWARD_TIERS[0];
  return (
    <>
      <PageHead kicker="Holders" title={`${REWARD_ASSET_CODE} holder rewards`} right={<span className="pill gold">Testnet · unaudited</span>}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}><AssetLogo code={REWARD_ASSET_CODE} issuer={REWARD_ISSUER[NET] ?? "-"} logo={GLACIERQ_ICON_128} size={22} />Glacier ({REWARD_ASSET_CODE}): a daily payment for holders of 1,000,000 or more.</span>
      </PageHead>

      <div className="notice" role="note" data-testid="holders-disclosure" style={{ marginBottom: 16 }}><b>Plainly:</b> {REWARD_DISCLOSURE} Rewards come from a finite reserve, not from revenue.</div>

      <div className="grid g-2">
        <div className="card glow" data-testid="my-rewards">
          <h2 style={{ marginTop: 0 }}>Your rewards</h2>
          {!w.address ? (
            <p className="muted">Sign in with your keypair to see your balance, tier and payment history. <button className="btn small" onClick={() => w.openModal()}>Sign in</button></p>
          ) : !live.live ? (
            <NotLive what="your balance and tier" />
          ) : (
            <>
              <div className="l-est">
                <div><span className="muted l-tiny">Balance</span><b className="mono">{bal.loading ? "…" : fmt(balance, 2)} {REWARD_ASSET_CODE}</b></div>
                <div><span className="muted l-tiny">Tier</span><b className="mono">{tier ? `${tier.name} · ${pctYear(tier.apr)}%/yr` : "none"}</b></div>
                <div><span className="muted l-tiny">Est. reward / day</span><b className="mono">{fmt(daily, 2)}</b></div>
              </div>
              <p className="muted l-tiny">{tier ? `Daily rate ${pctDay(tier.apr)}% on your whole balance (estimate; the daily cap can reduce it).` : `No reward under ${fmtCompact(REWARD_MIN_BALANCE)} ${REWARD_ASSET_CODE}.`}{nextTier ? ` Next tier at ${fmtCompact(nextTier.min)} (${nextTier.apr * 100}%/yr).` : ""}</p>
              <p className="muted l-tiny">Account {short(w.address, 6)}</p>
            </>
          )}
        </div>

        <div className="card" data-testid="reserve-status">
          <h2 style={{ marginTop: 0 }}>Reward reserve</h2>
          {!live.live ? <NotLive what="the reserve balance, runway and payouts" /> : reserve.loading ? <p className="muted">Reading Horizon…</p> : !reserve.data ? <p className="muted">Reserve account not found on this network yet.</p> : (
            <>
              <div className="l-est">
                <div><span className="muted l-tiny">Reserve balance</span><b className="mono">{fmtCompact(reserve.data.balance)}</b></div>
                <div><span className="muted l-tiny">Runway at the cap</span><b className="mono">{fmt(reserve.data.runwayDaysAtCap / 365, 1)} yr</b></div>
                <div><span className="muted l-tiny">Runway at current emission</span><b className="mono">{reserve.data.runwayDaysAtCurrent ? `${fmt(reserve.data.runwayDaysAtCurrent / 365, 1)} yr` : "n/a yet"}</b></div>
                <div><span className="muted l-tiny">Paid today (UTC)</span><b className="mono">{fmtCompact(reserve.data.todayTotal)} · {reserve.data.todayCount} payments</b></div>
                <div><span className="muted l-tiny">Next payout</span><b className="mono">{reserve.data.nextPayout.toISOString().slice(0, 16).replace("T", " ")} UTC</b></div>
              </div>
              <p className="muted l-tiny">Reserve account {short(live.reserve ?? "", 6)}, read from Horizon.</p>
            </>
          )}
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }} data-testid="payment-history">
        <h2 style={{ marginTop: 0 }}>Payment history</h2>
        {!w.address ? <p className="muted">Sign in to see the daily payments you received.</p> : !live.live ? <NotLive what="your payment history" /> : hist.loading ? <p className="muted">Reading Horizon…</p> : !hist.data?.length ? <p className="muted">No reward payments received yet.</p> : (
          <div style={{ overflowX: "auto" }}>
            <table className="t">
              <thead><tr><th>Day (UTC)</th><th>Amount</th><th>Memo</th><th>Transaction</th></tr></thead>
              <tbody>{hist.data.map((p) => (
                <tr key={p.id}><td className="mono">{p.day ?? p.at.slice(0, 10)}</td><td className="mono pos">+{fmt(p.amount, 4)} {REWARD_ASSET_CODE}</td><td className="mono muted">{p.memo ?? ""}</td>
                  <td><a className="mono" href={`https://stellar.expert/explorer/${NET}/tx/${p.tx}`} target="_blank" rel="noreferrer">{p.tx.slice(0, 8)}… ↗</a></td></tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </div>

      <div className="grid g-2" style={{ marginTop: 16 }}>
        <div className="card" data-testid="how-it-works">
          <h2 style={{ marginTop: 0 }}>How the daily payments work</h2>
          <ul className="muted" style={{ paddingLeft: 18, fontSize: "0.9rem" }}>
            <li>Once a day (about 00:30 UTC) a script takes a snapshot of {REWARD_ASSET_CODE} holders from Horizon and pays each qualifying holder with an ordinary Stellar payment from the reward account. No smart contract is involved.</li>
            <li>Each payment carries the memo <span className="mono">{REWARD_ASSET_CODE}:YYYY-MM-DD</span>, and a ledger of paid days stops a rerun from paying twice.</li>
            <li>Rates: <b>{pctYear(REWARD_TIERS[0].apr)}% a year</b> from 1M to under 10M ({pctDay(REWARD_TIERS[0].apr)}% a day) and <b>{pctYear(REWARD_TIERS[1].apr)}% a year</b> from 10M ({pctDay(REWARD_TIERS[1].apr)}% a day), flat on the whole balance. Nothing under 1M.</li>
            <li>The total paid in a day is capped at {fmtCompact(TOKENOMICS.dailyCap)} {REWARD_ASSET_CODE}. If the computed total is higher, every reward is scaled down pro rata.</li>
            <li>The issuer, the reserve, the treasury and liquidity-pool accounts are excluded.</li>
            <li>Rewards are paid from a finite reserve, not from revenue, and are not guaranteed.</li>
          </ul>
        </div>
        <div className="card" id="tokenomics" data-testid="tokenomics">
          <h2 style={{ marginTop: 0 }}>Tokenomics <span className="pill green" style={{ fontSize: "0.6rem" }}>confirmed</span></h2>
          <table className="t">
            <tbody>
              <tr><td>Total supply</td><td className="mono">{fmt(REWARD_TOTAL_SUPPLY, 0)} {REWARD_ASSET_CODE} (fixed; minted once, issuer then locked)</td></tr>
              <tr><td>Reward reserve</td><td className="mono">{fmt(TOKENOMICS.rewardReserve, 0)}</td></tr>
              <tr><td>Treasury / distribution</td><td className="mono">{fmt(TOKENOMICS.treasury, 0)} (launch, liquidity, holders)</td></tr>
              <tr><td>Daily emission cap</td><td className="mono">{fmt(TOKENOMICS.dailyCap, 0)} per day (0.01% of supply)</td></tr>
              <tr><td>Reserve runway at the cap</td><td className="mono">{fmt(reserveYearsAtCap(), 1)} years (50B ÷ 3.65B a year)</td></tr>
            </tbody>
          </table>
          <p className="muted l-tiny">Typical use sits far below the cap: emission is about 5–7% a year of qualifying balances, so 10B of qualifying balances emit roughly 0.5–0.7B a year and the reserve lasts well beyond 70 years. Payments move tokens from the reserve into circulation, so holders who are not paid are diluted. See the <Link to="/earn">Earnings</Link> tab for liquidity-pool earnings.</p>
        </div>
      </div>
    </>
  );
}
