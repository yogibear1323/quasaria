import { Link } from "react-router-dom";
import { PageHead } from "../components/ui";
import { CopyButton } from "../components/CopyButton";
import { useWallet } from "../lib/wallet";
import { fmt, fmtCompact } from "../lib/format";
import { REFERRAL_LIVE, REFERRAL_TERMS as T, REWARD_ASSET_CODE as CODE } from "../lib/rewards";

export const referralLink = (address: string, origin = typeof window === "undefined" ? "" : window.location.origin + (import.meta.env.BASE_URL ?? "/").replace(/\/$/, "")) => `${origin}/?ref=${address}`;

export default function Referral() {
  const w = useWallet();
  return (
    <>
      <PageHead kicker="Referral" title="Referral program" right={<span className={`pill ${REFERRAL_LIVE ? "green" : "gold"}`} data-testid="referral-status">{REFERRAL_LIVE ? "Live" : "Coming after launch"}</span>}>
        Invite someone to Quasaria. When they hold {CODE} and earn holder rewards, you earn a bonus on top and so do they. Bonuses are extra {CODE} on top of the normal reward, and nobody's own reward is reduced.
      </PageHead>

      {!REFERRAL_LIVE && (
        <div className="notice" role="status" style={{ marginBottom: 16 }} data-testid="referral-notflive">
          <b>Not active yet.</b> The program starts after the first mainnet holder-reward run. Nothing is earned or tracked before then, so sharing a link now has no effect. The terms below are confirmed, but they are not guaranteed and may change, and the program may be paused.
        </div>
      )}

      <div className="grid g-2">
        <div className="card glow" data-testid="referral-terms">
          <h2 style={{ marginTop: 0 }}>The terms</h2>
          <dl className="kv">
            <div><dt>Referrer bonus</dt><dd>{T.referrerPct}% of the friend's daily reward, for {T.referrerDays} days</dd></div>
            <div><dt>Friend's boost</dt><dd>+{T.refereePct}% of their own daily reward, for {T.refereeMonths} months ({T.refereeDays} days)</dd></div>
            <div><dt>Cap per referral</dt><dd>{fmt(T.perReferralCap, 0)} {CODE} on each side</dd></div>
            <div><dt>Cap per referrer</dt><dd>{fmt(T.perReferrerDay, 0)} {CODE} a day</dd></div>
            <div><dt>Daily budget</dt><dd>{fmtCompact(T.subBudgetDay)} {CODE} a day for all referral bonuses, inside the {fmtCompact(10_000_000)} daily reward cap</dd></div>
            <div><dt>Paid</dt><dd>{T.payoutLagDays} days after the reward day, as plain {CODE} payments</dd></div>
          </dl>
        </div>

        <div className="card" data-testid="referral-eligibility">
          <h2 style={{ marginTop: 0 }}>Who qualifies</h2>
          <ul className="muted" style={{ paddingLeft: 18, fontSize: "0.9rem" }}>
            <li>The friend holds {fmtCompact(T.refereeMinBalance)}+ {CODE} for at least {T.refereeHoldHours} hours and has the {CODE} trustline.</li>
            <li>You hold {fmtCompact(T.referrerMinBalance)}+ {CODE} and your account is at least {T.referrerMinAgeDays} days old.</li>
            <li>The first referrer a friend binds to wins, and the link has to be bound within {T.bindWindowDays} days.</li>
            <li>Self-referrals and mutual pairs earn nothing.</li>
            <li>Referral bonuses never use up the holder-reward budget first: holders are paid before referrals.</li>
          </ul>
        </div>
      </div>

      <div className="grid g-2" style={{ marginTop: 16 }}>
        <div className="card" data-testid="referral-link">
          <h2 style={{ marginTop: 0 }}>Your link</h2>
          {!w.address ? (
            <p className="muted">Create a keypair or sign in to get your link. <button className="btn small" onClick={() => w.openModal()}>Sign in</button></p>
          ) : (
            <>
              <div className="addr-full mono" data-testid="referral-url">{referralLink(w.address)}</div>
              <div style={{ margin: "10px 0" }}><CopyButton value={referralLink(w.address)} label="Copy link" /></div>
              {!REFERRAL_LIVE && <p className="muted l-tiny">Preview only: this link does nothing until the program starts.</p>}
            </>
          )}
        </div>
        <div className="card" data-testid="referral-how">
          <h2 style={{ marginTop: 0 }}>How it works</h2>
          <ul className="muted" style={{ paddingLeft: 18, fontSize: "0.9rem" }}>
            <li>The friend binds your address with a small on-chain note on their own account (a data entry named <span className="mono">{T.bindKey}</span>), signed with their key. Nobody else can bind for them.</li>
            <li>A daily script reads the reward payments, works out the bonuses, and pays them from a separate payer account. Each day's payout list is published with its sha256 so anyone can check it.</li>
            <li>Payments carry the memos <span className="mono">{CODE}-REF:YYYY-MM-DD</span> (referrer) and <span className="mono">{CODE}-BOOST:YYYY-MM-DD</span> (friend), and appear in <Link to="/activity">Activity</Link>.</li>
            <li>There is a pause switch. Rewards are not guaranteed. See <Link to="/holders">Holder rewards</Link> for the base program.</li>
          </ul>
        </div>
      </div>
    </>
  );
}
