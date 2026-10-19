import { Link } from "react-router-dom";
import { PageHead } from "../components/ui";
import { NONCUSTODIAL_NOTE } from "../components/AccountModal";
import { MAINNET_BROWSE, MAINNET_SIGNING } from "../lib/nativePools";
import { networkStatus } from "../lib/networkStatus";
import { GLACIERQ_ICON_128, REWARD_ASSET_CODE, REWARD_DISCLOSURE, REWARD_TIERS, TOKENOMICS, REWARD_TOTAL_SUPPLY, pctYear } from "../lib/rewards";
import { fmt, fmtCompact } from "../lib/format";

export const ABOUT_TAGLINE = "Quasaria is a self-banking decentralized exchange on Stellar where you trade, earn, and stay in full control of your keys.";

const REFERRAL_FACTS = {
  referrerPct: 10, referrerDays: 365, refereePct: 10, refereeMonths: 6, perReferralCap: 100_000, perReferrerDay: 25_000,
} as const;

function Section({ id, n, title, children, link }: { id: string; n: number; title: string; children: React.ReactNode; link?: { to: string; label: string } }) {
  return (
    <section className="card about-card" id={id} data-testid={`about-${id}`}>
      <div className="about-n" aria-hidden>{n}</div>
      <h2 style={{ marginTop: 0 }}>{title}</h2>
      <div className="muted about-body">{children}</div>
      {link && <Link className="btn small ghost" to={link.to} style={{ marginTop: 10 }}>{link.label} →</Link>}
    </section>
  );
}

export default function About() {
  const st = networkStatus({ mainnetSigning: MAINNET_SIGNING, mainnetBrowse: MAINNET_BROWSE });
  const t1 = REWARD_TIERS[0], t2 = REWARD_TIERS[1];
  return (
    <>
      <PageHead kicker="About" title="Your keys, your XLM" right={<span className={`pill ${st.net === "mainnet" ? "green" : "gold"}`} data-testid="about-net-pill">{st.net === "mainnet" ? "Mainnet" : "Testnet · unaudited"}</span>}>
        {ABOUT_TAGLINE}
      </PageHead>

      <div className="notice about-status" role="status" data-testid="about-network-status"><b>Network.</b> {st.line}</div>

      <div className="grid g-2 about-grid">
        <Section id="keys" n={1} title="Accounts you hold yourself" link={{ to: "/trade", label: "Open Trade" }}>
          <p>Your account is a Stellar keypair made in your browser. The public key is your account; the secret key signs. <b>Your keys, your XLM.</b> {NONCUSTODIAL_NOTE}</p>
          <p>You save your secret key once. Nobody, including us, can recover or reset it, so keep it somewhere safe and offline. You can sign in later by pasting it, and optionally lock a copy in this browser with a passphrase.</p>
        </Section>

        <Section id="swaps" n={2} title="Native order-book swaps" link={{ to: "/trade", label: "Swap" }}>
          <p>Swaps use Stellar's built-in order book and its path payments, so one swap can hop across several markets for a better price. You see the quote and a minimum received before you sign, and only issuer-verified assets are matched by default.</p>
        </Section>

        <Section id="pools" n={3} title="Native liquidity pools" link={{ to: "/pools", label: "Browse pools" }}>
          <p>Stellar has liquidity pools built into the network. Deposit a pair, get pool shares, and withdraw whenever you like with slippage limits you choose. Swap fees go to the pool providers, in proportion to their shares. Pools carry risk, including price moves against your deposit.</p>
        </Section>

        <Section id="rewards" n={4} title={`Glacier (${REWARD_ASSET_CODE}) holder rewards`} link={{ to: "/holders", label: "Holder rewards" }}>
          <p className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <img src={GLACIERQ_ICON_128} alt="" width={22} height={22} style={{ borderRadius: 6 }} />
            <span>Hold {fmtCompact(t1.min)} or more {REWARD_ASSET_CODE} and get <b>{pctYear(t1.apr)}% a year</b>; hold {fmtCompact(t2.min)} or more and get <b>{pctYear(t2.apr)}% a year</b>, on your whole balance, paid daily.</span>
          </p>
          <p>Supply is fixed at {fmtCompact(REWARD_TOTAL_SUPPLY)} {REWARD_ASSET_CODE} and the issuer is locked. {fmtCompact(TOKENOMICS.rewardReserve)} sit in a reward reserve that pays holders with ordinary payments, and the total paid in a day is capped at {fmt(TOKENOMICS.dailyCap, 0)}, scaled down pro rata if needed.</p>
          <p>{REWARD_DISCLOSURE}</p>
        </Section>

        <Section id="referral" n={5} title="Referral program">
          <p>Invite someone with your link. When they hold {REWARD_ASSET_CODE} and earn holder rewards, you get <b>{REFERRAL_FACTS.referrerPct}%</b> of their daily reward on top for a year, and they get a <b>+{REFERRAL_FACTS.refereePct}%</b> boost for {REFERRAL_FACTS.refereeMonths} months.</p>
          <p>Caps apply: {fmt(REFERRAL_FACTS.perReferralCap, 0)} {REWARD_ASSET_CODE} per referral on each side, {fmt(REFERRAL_FACTS.perReferrerDay, 0)} a day per referrer, and a shared daily budget. It goes live after the first mainnet holder-reward run, it is not guaranteed, and the terms may change or the program may pause.</p>
        </Section>

        <Section id="yeti" n={6} title="The yeti">
          <p>The yeti is Quasaria's mascot: a calm explorer in a space suit, keeping watch from the glacier while you trade. Same yeti on the token icon, in the quests and on the merch.</p>
        </Section>
      </div>

      <p className="muted" style={{ fontSize: "0.78rem", marginTop: 14 }} data-testid="about-risk">
        Quasaria is unaudited. Nothing here is financial advice. Liquidity pools and token rewards carry a risk of loss and may be regulated where you live.
      </p>
    </>
  );
}
