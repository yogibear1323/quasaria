import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import Referral, { referralLink } from "../src/pages/Referral";
import Holders from "../src/pages/Holders";
import { WalletProvider } from "../src/lib/wallet";
import { REFERRAL_LIVE, REFERRAL_TERMS } from "../src/lib/rewards";

const R = (el: React.ReactElement) => renderToStaticMarkup(<MemoryRouter><WalletProvider>{el}</WalletProvider></MemoryRouter>);
const text = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#x27;/g, "'").replace(/\s+/g, " ");

describe("Referral page", () => {
  const html = R(<Referral />); const t = text(html);
  it("shows the confirmed terms and the Live status", () => {
    expect(REFERRAL_LIVE).toBe(true);
    expect(html).not.toContain('data-testid="referral-notflive"'); expect(html).toContain('data-testid="referral-status">Live');
    expect(t).toMatch(/10% of the friend's daily reward, for 365 days/);
    expect(t).toMatch(/\+10% of their own daily reward, for 6 months \(180 days\)/);
    expect(t).toMatch(/100,000 GLACIERQ on each side/); expect(t).toMatch(/25,000 GLACIERQ a day/); expect(t).toMatch(/1M GLACIERQ a day for all referral bonuses/);
    expect(t).toMatch(/7 days after the reward day/);
    expect(t).toMatch(/1M\+ GLACIERQ for at least 48 hours/); expect(t).toMatch(/100K\+ GLACIERQ and your account is at least 14 days old/);
    expect(t).toMatch(/first referrer a friend binds to wins/); expect(t).toMatch(/within 30 days/);
    expect(t).toContain("quasaria:ref");
  });
  it("makes no promises, no APY wording, no out-of-scope products", () => {
    expect(t).toMatch(/not guaranteed/); expect(t).not.toMatch(/\bAPY\b|risk-free|guaranteed (return|income)/i);
    expect(t).not.toMatch(/beacon|perp|trading bot|vault|lending|staking|QFX/i);
  });
  it("builds the link from the address", () => {
    expect(referralLink("GABC", "https://x.test/quasaria")).toBe("https://x.test/quasaria/?ref=GABC");
    expect(REFERRAL_TERMS.bindKey).toBe("quasaria:ref");
  });
});

describe("Holders page tiers", () => {
  const t = text(R(<Holders />));
  it("states qualifying balances and rates, with reserve status not-live when no issuer exists", () => {
    expect(t).toMatch(/Who qualifies and what it pays/);
    expect(t).toMatch(/1M to under 10M/); expect(t).toMatch(/10M and above/);
    expect(t).toMatch(/12% a year/);
    expect(t).toMatch(/Not live yet: the reserve balance, runway and payouts|Reward reserve/); // live on testnet once the public reward config is published
    expect(t).not.toMatch(/\bAPY\b/);
  });
});
