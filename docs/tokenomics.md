# GLACIERQ tokenomics (confirmed 2026-10-18)

| | |
|---|---|
| Total supply | 100,000,000,000 GLACIERQ, fixed. Minted once, then the issuer is locked (no more can ever be made) |
| Reward reserve | 50,000,000,000: pays holder rewards and referral bonuses with ordinary payments |
| Treasury | 50,000,000,000: launch, liquidity, holders |
| Holder rewards | 1% a month (12% a year) on balances from 1M, same rate from 10M, nothing under 1M; flat on the whole balance; paid daily (rate/365); based on the lower of two daily snapshots. Not guaranteed |
| Daily cap | 10,000,000 GLACIERQ across all holder rewards; scaled down pro rata if exceeded. At the cap the reserve lasts about 13.7 years; at 10B qualifying balances (12% a year) about 40 years |
| Referral | 10% of a friend's daily reward to the referrer for 365 days; +10% to the friend for 180 days; 100,000 cap per referral on each side; 25,000/day per referrer; 1,000,000/day sub-budget inside the 10M cap; paid 7 days after the reward day from a separate payer account (about 30M float). Starts after the first mainnet holder-reward run |
| Excluded from rewards | issuer, reserve, treasury, referral payer, pool accounts |
| Transparency | each batch has a manifest whose sha256 is committed on chain (`manifest-sha256`); memos `GLACIERQ:YYYY-MM-DD`, `GLACIERQ-REF:`, `GLACIERQ-BOOST:` |

Wording rules for the site: say "1% a month (12% a year) from 1M, not guaranteed"; no compounding-yield jargon and never imply a return. Single source of truth in code: `frontend/src/lib/rewards.ts`; script maths: `frontend/scripts/rewards/core.mjs` (see `docs/rewards-scripts.md`).
