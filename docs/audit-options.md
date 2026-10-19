# Quasaria DEX: cheapest realistic routes to a pre-mainnet audit (budget about $800)

*Researched Sunday Oct 18, 2026 (Arizona time). Every URL below was fetched or surfaced by search on that date. Each figure is tagged **[verified]** (read on the primary page), **[derived]** (my arithmetic from verified numbers), **[third-party]** (a secondary source, not the vendor's own page) or **[unverified]** (could not confirm). Where a price is not public, this report says "not publicly stated". Nothing was contacted, applied for, or purchased. This is research, not legal or investment advice.*

---

## 0. Bottom line

1. **$800 does not buy a credible independent audit of Quasaria.** The only public Soroban-specific price band I found is **$30,000 to $80,000 for 1,000 to 5,000 nSLOC** (Recon's own FAQ) [verified, one vendor, Recon says Soroban is "manual security review", not its core]. Quasaria's production Rust is **about 5,250 non-test lines**, which is at or past the top of that band. $800 is roughly 1% to 3% of the quoted band [derived].
2. **The one route that could make a real audit cost close to $0 is the SDF Soroban Security Audit Bank**, but it only admits **SCF-funded** projects [verified]. Nothing I found says Quasaria has SCF funding. The next SCF Build round, **SCF #46, has a submission deadline of Nov 8, 2026**, and you must file the interest form first to be invited [verified]. Build awards run up to $150,000 in XLM [verified].
3. **Even the Audit Bank is probably not "under $800".** The project pays a **5% upfront co-pay** (refunded if all critical, high and medium findings are fixed within 20 business days) [verified]. 5% is at most $800 only if the audit costs **$16,000 or less** [derived]. At the Audit Bank's program-wide average of about $75,000 per audit (SDF: "over 40 audits, over $3 million", which I computed to roughly $75k) the co-pay would be about **$3,750** [derived, rough]. Cash-flow only: it comes back if you remediate in time.
4. **What $800 does buy:** a free-to-cheap *lighter review* stack: open-source scanners, property tests, a formal-verification spike, one month of an AI scanner, and the audit paperwork (STRIDE threat model plus data-flow diagram) that the Audit Bank and any paid firm will require. That is worth doing, but it is **not an audit** and must not be marketed as one.
5. **Recommended:** run the free stack now, apply to SCF Build (deadline Nov 8, 2026) so the Audit Bank becomes available, and **do not put the leverage vault, lending, Beacons or the mock oracle on mainnet** until they have had a real audit. If a capped launch must happen first, limit it to the smallest fund-holding set (details in section 5).

---

## 1. What is being audited (measured on the box)

Measured with `tokei` (code lines only: no blanks, no comments) on `/workspace/stellar-dex` (branch `theme/global-charcoal`, HEAD `0a6cb6e`, Oct 11, 2026) and `/workspace/beacons-repo` (HEAD `4cb8e1b`, Oct 12, 2026). These are my own counts. Auditors may count differently.

### stellar-dex (`contracts/*/src/lib.rs`, excluding tests)

| Contract | Code lines | Role | Test code lines |
|---|---:|---|---:|
| lending | 1,280 | Lending | 1,168 |
| leverage-vault | 1,215 | Leverage vault, oracle-driven liquidations | 1,030 |
| reward-token (QFX) | 779 | 1:1 XLM-backed wrapper with yield | 662 |
| amm-pool | 686 | Constant-product pools plus LP token | 397 |
| gov | 464 | Shared crate: timelock, pause, multisig admin helpers | 260 |
| staking | 421 | Staking pools | 442 |
| referral | 216 | Referral fee registry | 210 |
| router | 110 | Multi-hop swap router | 86 |
| pricing | 75 | Pricing helper | 65 |
| mock-oracle | 332 | **Test oracle, never ship** | 0 |
| **Total** | **5,578** | **5,246 excluding mock-oracle** | |

Whole tree: 20 Rust files, 11,060 raw lines, 9,898 code lines including tests.

### beacons-repo (`contracts/`): Beacons tiers, **concept / not deployed**

| Contract | Code lines |
|---|---:|
| gov (copy) | 462 |
| vault | 334 |
| reward-reserve | 110 |
| peg-monitor | 119 |
| blend-adapter | 93 |
| fee-router | 77 |
| insurance-fund | 50 |
| **Total** | **1,245** (plus 237 lines of tests) |

The Beacons README says these contracts are "not built" and "not deployed". The code is a scaffold. Its own funding table already carries "Audit ~$30k–$100k+", an internal guess that matches the Recon band.

**Total audit surface if everything went to mainnet: about 6,500 code lines (5,246 plus 1,245), plus the oracle integration that replaces `mock-oracle`.** The internal readiness checklist (`docs/mainnet-readiness-checklist.md`) is "NO-GO", with no external audit, an unfinished multisig and a mock oracle.

---

## 2. Stellar's own programs

### 2.1 Soroban Security Audit Bank (SDF subsidy)

Sources: https://stellar.org/grants-and-funding/soroban-audit-bank , https://stellar.gitbook.io/scf-handbook/supporting-programs/audit-bank/official-rules , https://stellar.gitbook.io/scf-handbook/supporting-programs/audit-bank/faq , https://stellar.org/blog/developers/soroban-security-audit-bank-raising-the-standard-for-smart-contract-security . All [verified] Oct 18, 2026.

- **What it covers:** "covers up to 100% of the audit cost" with pre-approved firms "at pre-negotiated rates". For the **Initial Audit** the project pays **5%** to SDF before the audit starts. SDF pays the firm the whole bill. The 5% is **fully refunded** if all critical, high and medium findings are fixed within **20 business days** of the report, as verified with the audit firm.
- **Later audits:** Growth audit (more than $10M TVL or equivalent) 0% co-pay. Scale audit (more than $100M TVL) 0%. Between those, follow-ups cost **20%** (first) and **50%** (second). Growth and Scale audits "may include" formal verification or competitive audits.
- **Eligibility (all required):**
  - Funded by SCF. "Companies with other commercial grants from the SDF are not eligible."
  - Pass KYC and sanctions checks.
  - Be a priority category: financial protocols, widely used apps, infrastructure contracts (oracles, vaults, account abstraction), or yield-bearing token protocols. Quasaria's DEX, vault and QFX fit these on their face. Non-priority projects need 10K monthly active addresses or $100,000 TVL.
  - Code in scope must be finished, "nearly Mainnet-ready", heavily tested, **deployed on Testnet**, and needed within 4 to 6 weeks.
  - The application must include a **STRIDE threat model** and, per the rules, self-service scanner results with a remediation plan. (The Readiness Checklist page lists the tooling scan and remediation plan as "Optional / Bonus"; the Official Rules call them required. Plan to include both.) The checklist also requires a repo that is organized and understandable, executed integration tests, and a data-flow diagram with trust boundaries: https://stellar.gitbook.io/scf-handbook/supporting-programs/audit-bank/audit-readiness-checklist
  - Stay responsive during the audit.
- **How to get in:** "Check your email for an invite or contact communityfund@stellar.org" (SCF-funded projects); questions to sorobanaudits@stellar.org. There is no public self-serve application for non-SCF projects.
- **Timeline [verified]:** readiness review under 4 weeks, matched with a firm about 2 weeks after passing, audit scheduled 3 to 6 weeks later, audit takes 2 to 8 weeks. Realistically **3 to 5 months** from application to a final report.
- **Reports are published.** The audit firm publishes the final report publicly after remediation. Participants also consent to SDF using their name and logo in SDF channels.
- **Approved firms [verified]:** Certora, Code4rena, ChainSecurity, Halborn, Oak Security, OtterSec, Runtime Verification, Spearbit + Cantina, Veridise, Zellic.
- **Probationary firms [verified]:** Arda, Hacken, Sherlock, Quantstamp, Hashlock, Decurity, Adevar Labs, Bevor.
- **Track record [verified]:** 57 audited projects listed at https://stellar.org/audit-bank/projects (latest: Spectra/Certora May 18, 2026; Peridot/Halborn Apr 9, 2026; ROZO/Hacken Mar 30, 2026; OctoLend/Runtime Verification Feb 27, 2026; Reflector/Code4rena-Zellic Feb 2, 2026).
- **Self-service tooling is part of the program** ("complimentary or discounted access" for eligible projects), and formal verification is *not* included in initial Audit Bank engagements, only in later traction-milestone audits (Certora: https://www.certora.com/blog/roadmap-to-a-soroban-security-audit).

**The catch for Quasaria:** the entry ticket is SCF funding, not money.

### 2.2 SCF Build (the way into the Audit Bank)

Sources: https://stellar.gitbook.io/scf-handbook/scf-awards/build-award , https://communityfund.stellar.org/awards [verified].

- Award up to **$150,000 in XLM**, paid in milestone tranches over roughly 3 to 6 months. The handbook says it "covers up to about 4 months of development costs" and that "audit support [is] available through the Audit Bank for eligible projects".
- Three tracks: Open, Integration, RFP. Process: submit the interest form at communityfund.stellar.org, SCF reviews it and may ask for a referral, then you are invited by email to submit a full proposal (technical roadmap and milestones, tranche budget, traction, team).
- **Next round: SCF #46, submission deadline Nov 8, 2026. SCF #45 closed Aug 16, 2026.** The page says to submit the interest form "ASAP to be considered".
- KYC/KYB is required before payout. Some jurisdictions have restrictions that may limit a project to testnet.
- **[unverified] Whether a leveraged trading venue is acceptable to SCF reviewers, or whether other SDF grants Quasaria may hold would disqualify it. Ask SCF in the interest form.**
- **Instawards** replaced Kickstart in SCF 7.0 and are delivered through local Stellar Ambassador Chapters (https://stellar.gitbook.io/scf-handbook/scf-awards/instawards) [verified]. A secondary source says typically $1,000 to $5,000, with a $15,000 lifetime cap [third-party, unverified]. They are small, scoped awards, not audits, but one could fund the scanner and threat-model work. It is unclear whether an Instaward counts as "SCF-funded" for Audit Bank purposes [unverified].

### 2.3 SDF security programs and the Stellar bug bounty

- **HackerOne is now the only SDF bounty.** The Immunefi program for Stellar is **deprecated effective May 7, 2026**. Reward scale: Critical 0 to 25,000 points, High 0 to 15,000, Medium 0 to 10,000, Low 0 to 2,000; 1 point = $1 in XLM; carve-out for stellar-core, rs-soroban-env, rs-soroban-sdk and similar: critical up to 250,000 points. (https://hackerone.com/stellar , policy updated Oct 7, 2026) [verified].
- **It does not cover Quasaria.** Scope is SDF-maintained repos, services and the protocol and core. Third-party contracts are out. So it gives no coverage or free review for your contracts [verified].
- **Free self-service tooling** that SDF lists (https://developers.stellar.org/docs/tools/developer-tools/security-tools , https://skills.stellar.org/skills/standards/ecosystem.md) [verified]: Scout (CoinFabrik, static analysis, 20+ detectors), OpenZeppelin Security Detectors SDK, Certora Sunbeam (Wasm-level formal verification), Runtime Verification's Komet (property testing and formal verification), Almanax (AI), and the Soroban Security Portal (Inferara, searchable audit reports and vulnerabilities, https://stellarsecurityportal.com).

---

## 3. Soroban-capable audit firms: prices and typical ranges

**Published rate cards: essentially none.** For every firm below, the price is **not publicly stated**; Veridise's Soroban page says audits are custom quoted by code size, complexity and architecture (https://veridise.com/audits/soroban/). Public data points that exist:

| Data point | Figure | Source | Status |
|---|---|---|---|
| Recon, "focused protocol, 1,000–5,000 nSLOC", incl. Soroban as manual review | **$30,000–$80,000** | https://getrecon.xyz/services/smart-contract-audit | verified (vendor FAQ) |
| Sherlock market reference: general smart-contract audits | $5,000 (simple token) to $250,000+; typical DeFi $25,000–$100,000; mid-complexity DeFi $40,000–$100,000; pre-launch budget $60,000–$120,000 incl. one remediation review | https://sherlock.xyz/post/smart-contract-audit-pricing-a-market-reference-for-2026 (Feb 2026) | verified, but mostly EVM-based and from a firm that sells audits |
| Same, re-audit after fixes | **+$5,000 to $20,000 per pass** | same | verified |
| Same, language premium | Rust/Solana +25–40%; Move/Cairo +30–45%; rush +20–40% | same | verified (no Soroban figure given) |
| Audit Bank program average | "over 40 audits, over $3 million" ≈ **$75,000** each; launch plan "up to $1M" for 20–30 projects ≈ $33,000–$50,000 each | SDF blog posts | derived |
| Code4rena Reflector v3 (Stellar oracle) | **$20,000** USDC total awards, 15 days, Oct 27–Nov 11, 2025 | https://code4rena.com/audits/2025-10-reflector-v3 | verified |
| Code4rena Blend v2 + Certora FV | **$125,000** USDC pool, 27,099 Rust lines | https://github.com/code-423n4/2025-02-blend | previously verified in repo `docs/audit-firm-shortlist.md`; not re-fetched today |
| Hacken, general smart-contract audit range | $3,000–$100,000+ (not Soroban-specific) | secondary: https://fidesium.com/blog/smart-contract-audit-companies/ | third-party, unverified |
| Oak Security | "prices each engagement individually, no floor" | https://oaksecurity.io/security-audits | verified per search summary |

**Budget math at Quasaria's size [derived]:** 5,246 code lines is above Recon's top band edge (5,000). Even a single narrow slice (AMM + router + referral + pricing + gov, about 1,550 lines) falls in the "1,000–5,000" band, implying low five figures. So **the cheapest *paid* path I can substantiate is on the order of $30,000** for a small scope, not $800, and the quote could be lower or higher.

### Effort comparables (from published reports, repo `docs/audit-firm-shortlist.md`; sizing helps when you ask for quotes)

| Firm | Audit Bank | Comparable Soroban work and effort | Fit |
|---|---|---|---|
| Certora | approved | Blend v1/v2 (lending, liquidations) 6–8 weeks; Aquarius AMM; Slender lending; Sunbeam FV | best breadth, only firm with Soroban FV (Sunbeam) |
| Runtime Verification | approved | FxDAO (vaults and liquidations) 4 weeks; OctoLend 5 weeks; EquitX 5 weeks; Soroswap Aggregator 3 weeks; Komet fuzzing | strongest recent DeFi record |
| OtterSec | approved | Soroswap core AMM and router about 2.5 weeks; Blend v1 about 1 month; Reflector 1 week | best AMM and router analog |
| Veridise | approved | Phoenix AMM plus staking, 4 person-weeks; OrbitCDP (XLM CDP) 3 person-weeks; HiYield lending 9 person-weeks; publishes person-weeks | AMM plus staking analog |
| Halborn | approved | Peridot (lending, margin, liquidations) 1 month, 1 engineer; Normal Finance AMM | closest to the leverage vault |
| Zellic and Code4rena | approved | Reflector C4 contest; Volta Wallet | good second layer, not first audit |
| CoinFabrik | **not** on the current list (was a 2023 launch firm) | Aquarius AMM (Mar 2024), BondHive (Sep 2024); makes Scout | audit price not publicly stated; outside the subsidy |
| Quantstamp, Hashlock, Hacken, Sherlock | probationary | no Soroban comparables checked | price not publicly stated |

Typical durations: 2 to 8 weeks per engagement, plus a separate fix review. Quasaria full scope would be at the heavy end because of the vault, lending and QFX, with more than 5,000 lines.

---

## 4. Cheaper tiers (what $800 or less can buy)

| Tier | Tool / service | Cost | What it gives | Limits | Status |
|---|---|---|---|---|---|
| Static analysis | **Scout** (CoinFabrik) https://github.com/CoinFabrik/scout-soroban | free, open source | 20+ Soroban detectors, SARIF, VS Code extension | flags unchecked arithmetic en masse; false positives; no business-logic reasoning | verified listed. Already run on this repo on Sep 26 (v0.3.17), results in `docs/mainnet-readiness-checklist.md` |
| Static analysis | **OpenZeppelin Security Detectors SDK** https://github.com/OpenZeppelin/soroban-security-detectors-sdk | free, open source | CLI scanner plus custom detectors | same class of limits | verified listed; not yet run |
| Property testing / FV | **Komet** (Runtime Verification) https://github.com/runtimeverification/komet | free, open source | property tests and fuzzing in Rust; formal-verification semantics | needs hand-written invariants | verified listed; not yet used |
| Formal verification | **Certora Sunbeam** | "complimentary or discounted" for eligible SCF projects; public price not stated | proves properties on the compiled Wasm | spec writing is real work | verified listed; terms for non-SCF unverified |
| Knowledge base | **Soroban Security Portal** https://stellarsecurityportal.com | free | searchable Soroban audit findings: a checklist of bug classes others hit | not a review | verified |
| AI scanner | **Almanax** (lists Stellar-specific models) https://www.almanax.ai/ | Free tier for individual developers and a single project [verified in docs]; paid plans reported at **$39/month Startup, $99/month Premium (PoC generation)** | LLM scan, PR review, auto threat model | **Almanax says "joining depthfirst" on its homepage, so pricing and plans may be changing**; the $39 / $99 figures are from an aggregator, the official /pricing page returned 404; official trial is 7 days | partly third-party, **unverified current price** |
| AI scanner | Nethermind AuditAgent https://auditagent.nethermind.io/ | $50 free credits, $0.05 per billable line | n/a | **Does not support Soroban** (Rust for Solana only) | not usable for Soroban |
| Community review | Ask Stellar dev community / SCF reviewers / Ambassador chapters | free | informal feedback | not independent, not a report | no price needed; **no defined program found** |
| Competitive audit | **Code4rena** https://docs.code4rena.com/sponsors | no platform fee; you fund the award pool (standard: 96% conditional H/M pool, refunded if no H/M found, plus 4% QA pool, plus judging fee) [verified]. Pool size recommended per scope. A Stellar example is **$20,000** (Reflector v3) | 10,000+ registered researchers, code is public by default | needs a deposit to schedule; $800 is far below any observed Stellar pool | verified |
| Competitive audit | **Cantina** https://docs.cantina.security/security-teams/services/competitions | no public minimum; you define the prize pool; request form | competition plus final report | no public price; a recent competition example I saw was $120,000 to $150,000 [third-party search summary, unverified] | verified process, price unverified |
| Competitive audit | **Sherlock** (probationary on the Audit Bank) | contest pools in public data $104,000 to $1.39M [third-party, unverified]; Audit Engine is quote-based, "currently backlogged" | n/a | not for $800 | unverified |
| Bug bounty | **Immunefi** https://immunefi.com/bug-bounty-program/ | no setup fee; **10% platform fee on top of each valid payout** (not deducted from researcher) [verified via search summary of Immunefi support docs; support page itself did not load]; annual flat-fee subscription removes the 10%, price not published. One disclosed first-year all-in program cost was $27,450 USDC [third-party, one project's forum post] | ongoing review of live code | you must fund and honor the rewards; Stellar's Immunefi program is gone, not relevant to your contracts | partly verified |
| Bug bounty | **Hats Finance** https://docs.hats.finance/for-projects/pricing-structures | "management fee plus a success fee", percentages not published; vaults funded with project tokens | audit competitions and bounties | fee not stated | verified model, **price not stated** |

**What I could not verify:** any $0 to $1,500 *human* audit of Soroban from a named firm. A secondary source claimed some providers start at about €1,500 for a single-contract EVM review under 500 lines (Kairos Lab). It is EVM and I did not verify it, so I have not counted it.

---

## 5. Honest assessment

### 5.1 Does $800 get a credible audit?

**No.** It gets a *lighter review*:

- **Credible** means: an independent firm with Soroban references, a published report with severity ratings, a fix review, and findings that its engineers will stand behind. The cheapest *substantiated* price signal is **$30,000 to $80,000** for 1,000 to 5,000 lines (Recon). The Audit Bank's own average implies about **$75,000** [derived]. Re-audits add $5,000 to $20,000 per pass (Sherlock's market data).
- **$800 buys** (rough, with the Almanax price as unverified): free scanners ($0), property tests and a Komet or Sunbeam spike ($0, time only), one to two months of an AI scanner ($39 to $198 if the aggregator prices hold), a bounty-reserve or the first co-pay deposit toward something later. That is a **pre-audit hardening pass**, which the Audit Bank requires anyway. It will find the cheap bugs. It will **not** find the subtle ones that cost money in real exploits: oracle manipulation, liquidation edge cases, TTL and archival effects, rounding direction, admin and upgrade trust. Comparable Stellar audits found exactly those: e.g. a critical liquidation-state bug (Blend v1, OtterSec), "Stellar's resource limit can block liquidations" (Slender, Certora), stale oracle prices (OctoLend, RV), missing TTL bumps that brick liquidation (Peridot, Halborn). The $10M+ YieldBlox drain on Feb 22, 2026 was an oracle / pool configuration failure (https://blocksec.com/blog/yieldblox-dao-incident-on-stellar-oracle-misconfiguration-enabled-a-10m-drain, from the repo's earlier research).
- **Your own internal review already found 2 critical and 7 high issues** (F-01 to F-21, fixed on testnet v3, per `docs/mainnet-readiness-checklist.md`). That is evidence the code needs independent eyes, and also evidence that self-review works as a first filter. An AI or self review is *not* independent; do not label it "audited".

### 5.2 Recommended staged plan (cheapest route to a defensible mainnet)

**Stage 0: now, about $0 to $200 (1 to 2 weeks).**
1. Freeze a commit. Tag it. Remove or exclude `mock-oracle`; wire the production oracle (Reflector) and decide staleness and fallback rules, because auditors will review the oracle integration.
2. Write the **STRIDE threat model** and **data-flow diagram with trust boundaries** (required by the Audit Bank and by any paid firm).
3. Put **Scout, OpenZeppelin detectors, clippy (strict), cargo-audit** in CI. Add **Komet** property tests for: QFX supply is at most XLM held; yield only from the reserve; AMM k never decreases; no unhealthy vault position is unliquidatable; timelock cannot be bypassed. Try a **Sunbeam** spike on QFX or the AMM.
4. Optional: one month of an AI scanner (verify the current Almanax price first; the vendor is "joining depthfirst"). Budget $39 to $99 [unverified].
5. Archive all reports in `audits/` with a remediation log.

**Stage 1: $0, start immediately. Apply to SCF.**
Submit the SCF interest form now. **SCF #46 deadline is Nov 8, 2026.** Ask explicitly: (a) is a DEX with a leverage vault eligible, (b) does the Audit Bank apply after the testnet tranche, (c) can the 5% co-pay be paid from the award. Realistic outcome: if funded, a build tranche, then the Audit Bank readiness review, then a firm matched by SDF (state preference: Certora or Runtime Verification, then OtterSec or Veridise, per prior research). Expect **3 to 5 months** end to end. **Budget the co-pay separately: 5% of the audit price, which is probably in the $1,500 to $4,000 range at $30k to $80k audit prices, refundable on timely fixes [derived].** If a firm audit is under $16,000, 5% is under $800.

**Stage 2: $0 to a few hundred, before and after the audit.**
Fix every critical, high and medium finding within **20 business days** of the report (this is what refunds the co-pay). Publish the report (SDF does this anyway).

**Stage 3: post-audit, capped mainnet launch.**
Start with a small, hard-capped deployment: multisig admin (2-of-3 hardware) plus the on-chain timelock of at least 48 hours, pause guardian, per-wallet and global caps. Run a standing bounty with a *funded* reserve you can honestly afford. The Immunefi fee adds 10% on top of each payout (the platform charges no setup fee), and the Stellar HackerOne bounty will not cover your code.

**Stage 4: later (Growth audit at more than $10M TVL).** The Audit Bank then pays for follow-up audits, including formal verification or competitive audits, at 0% co-pay. A Code4rena or Cantina contest before that point costs real money (Reflector: $20,000).

### 5.3 What to leave off mainnet first

| Contract | Code lines | Mainnet at first? | Why |
|---|---:|---|---|
| mock-oracle | 332 | **Never** | Test-only. Admin can set any price or timestamp. |
| leverage-vault | 1,215 | **No** | Highest risk: oracle-driven liquidation, counterparty reserve, admin powers; recent comparable audits (Peridot, FxDAO, OctoLend, EquitX) all found liquidation and oracle bugs. Wait for the audit. |
| lending | 1,280 | **No** | Same class: liquidations, interest accounting, oracle dependence. Largest file. |
| Beacons (all 7 contracts) | 1,245 | **No** | Concept, not deployed. Blend adapter adds third-party risk. Fund-holding vault. |
| reward-token (QFX) | 779 | **Only after audit, or with a hard cap** | Holds user XLM 1:1 and pays a fixed APR from a finite reserve; sits underneath Beacons and most pools. |
| staking | 421 | After audit | Reward-per-share math had a real overflow bug (F-04, fixed on testnet). |
| gov | 464 | Required with anything | Timelock and pause: auditors must review it first, and it is shared. |
| **amm-pool + router + referral + pricing + gov** | 686 + 110 + 216 + 75 + 464 = **1,551** | **Smallest fund-holding set** | Closest to audited comparables (Soroswap core, Phoenix, Aquarius). This is the narrowest scope to quote first and the cheapest candidate for a first paid audit. |

If you must launch before any audit: only the **small AMM set**, with **tight TVL caps, no leverage, no lending**, a clear "unaudited, use at your own risk" label, and legal review. That is a business risk call for you and counsel; this report does not endorse an unaudited launch.

---

## 6. Open questions and caveats

- **Is Quasaria SCF-funded or SDF-grant-funded?** I found no evidence either way. The entire subsidy route depends on it.
- **Legal / compliance:** an exchange with a leverage product may be restricted in some jurisdictions; the SCF handbook notes jurisdiction restrictions. Not covered here.
- **No firm was asked for a quote.** All prices are public signals only. To get real numbers, send two firms the same frozen commit, scope list with line counts (section 1), docs, and threat model, and ask for person-weeks, dates, whether a fix review and fuzzing/formal verification are included, and whether the report is public.
- **Unverified items** are tagged above: Almanax current pricing, Instaward amounts and eligibility, Cantina and Sherlock pool figures (from a search summary), Hacken range, Immunefi subscription price, Kairos €1,500.
- **Line counts** use `tokei` code lines. Auditors usually count nSLOC, which can differ by 10% to 20%.
- Some figures come from the earlier firm research in `/workspace/stellar-dex/docs/audit-firm-shortlist.md` (Sep 26, 2026), which carries its own source URLs; I re-verified today the Audit Bank rules, SCF Build, HackerOne, Code4rena Reflector pool, Recon pricing and Sherlock market reference.

---

## 7. Links

- Audit Bank: https://stellar.org/grants-and-funding/soroban-audit-bank
- Audit Bank rules: https://stellar.gitbook.io/scf-handbook/supporting-programs/audit-bank/official-rules
- Audit Bank FAQ: https://stellar.gitbook.io/scf-handbook/supporting-programs/audit-bank/faq
- Audit Readiness Checklist: https://stellar.gitbook.io/scf-handbook/supporting-programs/audit-bank/audit-readiness-checklist
- Audited projects list: https://stellar.org/audit-bank/projects
- SCF Build handbook: https://stellar.gitbook.io/scf-handbook/scf-awards/build-award
- SCF rounds (SCF #46): https://communityfund.stellar.org/awards
- Instawards: https://stellar.gitbook.io/scf-handbook/scf-awards/instawards
- Stellar bug bounty (HackerOne): https://hackerone.com/stellar
- Stellar security tools list: https://developers.stellar.org/docs/tools/developer-tools/security-tools
- Scout: https://github.com/CoinFabrik/scout-soroban
- OpenZeppelin Soroban detectors: https://github.com/OpenZeppelin/soroban-security-detectors-sdk
- Komet: https://github.com/runtimeverification/komet
- Soroban Security Portal: https://stellarsecurityportal.com
- Certora, "Your Roadmap to a Soroban Security Audit": https://www.certora.com/blog/roadmap-to-a-soroban-security-audit
- Veridise Soroban audits: https://veridise.com/audits/soroban/
- Recon pricing FAQ: https://getrecon.xyz/services/smart-contract-audit
- Sherlock 2026 pricing reference: https://sherlock.xyz/post/smart-contract-audit-pricing-a-market-reference-for-2026
- Code4rena sponsors: https://docs.code4rena.com/sponsors
- Code4rena free contests post: https://www.zellic.io/blog/code4rena-free-contests
- Code4rena Reflector v3 ($20,000): https://code4rena.com/audits/2025-10-reflector-v3
- Cantina competitions: https://docs.cantina.security/security-teams/services/competitions
- Immunefi bug bounty: https://immunefi.com/bug-bounty-program/
- Hats Finance pricing: https://docs.hats.finance/for-projects/pricing-structures
- Almanax: https://www.almanax.ai/
- Nethermind AuditAgent (no Soroban): https://auditagent.nethermind.io/
- Local: `/workspace/stellar-dex/docs/audit-firm-shortlist.md`, `/workspace/stellar-dex/docs/mainnet-readiness-checklist.md`

---

## 8. Widened mainnet-first scope: LP, staking and a LumenDex-style front end

Scope (per Robert): pools, router, governance, staking and LP, plus a trading front end. The leverage vault, lending, Beacons and the QFX token stay off mainnet until audited. Figures below come from earlier measurements on the box. Prices are not re-quoted. The earlier $30-80k band is the reference.

### 8.1 Native Stellar pools (CAP-38) vs Quasaria's Soroban AMM
- **Native pools** are protocol-level. They use a constant-product formula with a 0.30% fee. LP shares are a trustline entry, not a contract token. There is no contract code for Quasaria to audit. The front end only builds `LiquidityPoolDeposit` and `LiquidityPoolWithdraw` operations and routes through pools and the SDEX with path payments. Source: CAP-38, https://github.com/stellar/stellar-protocol/blob/master/core/cap-0038.md
- LP shares cannot be staked in a Soroban contract, because they are not a SEP-41 token or a contract-held balance. Any "reward the LPs" feature therefore has to be off-chain, or it has to rely on the pool's own fee accrual.
- **Quasaria's Soroban AMM** mints SEP-41 LP tokens, so those can be staked. It is custom code and needs an audit.
- **Safer to ship now: native pools.** They carry no new custom-contract risk. A mainnet front end that only uses native pools needs no audit of Quasaria contracts. The only risk is front-end correctness (slippage, path, trustline handling).
- **Issuer risk:** for pools or contracts that hold classic assets via the Stellar Asset Contract (SAC), the asset issuer keeps authorization and clawback powers. It can freeze or claw back funds held by a Soroban pool contract. Use only assets with known issuer controls. `config/assets.mainnet.json` records the flags.

### 8.2 Contracts and LOC in the minimal Soroban set
Smallest fund-holding set: AMM pool + router + referral + gov = **1,476 LOC**. `pricing` is only used by the leverage vault and lending, so it stays out. Staking is **421 LOC**. It depends on `quasaria-reward-token`, and its reward-per-share math had a real overflow bug (F-04, fixed on testnet). All of this is custom code with admin keys, and none of it is audited.

### 8.3 "Earn" options without QFX
1. **Native LP fees (recommended first):** LPs earn the 0.30% fee through pool share value. There is no reward token, no promised APR and no new contract.
2. **XLM supply via Blend (non-custodial, front end only):** the front end calls Blend's audited pool contracts. The user holds the position. The risks are oracle manipulation and bad debt (the YieldBlox incident is the cautionary example) and Blend admin and pool-parameter risk. Check Blend's audit reports and pool list before you list a pool: https://docs.blend.capital/mainnet-deployments
3. **Custom Soroban staking contract:** needs an audit, so it comes after the Audit Bank. The risks are reward funding (who pays), admin keys, upgradeability and oracle dependence. Do not advertise a fixed APR.

### 8.4 Minimum safe shape before SCF / Audit Bank
Hard caps on deposits, a timelock on every parameter change, a multisig admin (the checklist says multisig is unfinished), a pause switch that never blocks withdrawals, no upgradeability or a timelocked one, only audited integrations, and no mock oracle. `docs/mainnet-readiness-checklist.md` currently says NO-GO. Add a public bug bounty only after an audit.

### 8.5 Legal flags (not legal advice)
Staking rewards, yield claims and "APR" marketing can be treated as an investment contract (Howey test) in the US. Look at SEC guidance, e.g. https://www.sec.gov/files/33-11412-fact-sheet.pdf. Also consider money-transmitter rules (FinCEN) and sanctions screening (OFAC). Paying token rewards to holders for holding is the pattern that raises the most flags. Get a lawyer's view before shipping any reward program.

### 8.6 Cost and effort delta (estimates, unverified against quotes)
- Native pools plus Blend front end only: audit $0 for contracts. Spend on front-end review and the pen-test checklist.
- Adding the minimal Soroban set (about 1.5k LOC): this sits inside the earlier $30-80k band, and the minimal set is the cheaper end. Request quotes.
- Adding staking (+421 LOC): roughly +25-30% on that scope. Treat it as unverified until a firm quotes it.

---

## 9. LumenDex reward verification (live Horizon data, checked 2026-10-18 evening, Phoenix time)

**Result: Robert is right. LumenDex pays holder rewards and liquidity rewards on-chain every day, in two automated batches.** My earlier read that these were not live was wrong. Earlier I had checked the treasury account GCNUHWWZV2…. The claimable balances it showed were dust spam it received, not rewards it sent.

### 9.1 What the data shows (Horizon, https://horizon.stellar.org)
| | Daily Rewards batch | Liquidity Rewards batch |
|---|---|---|
| Sender | `GD5EEDUHKL572PXTNZCJKWUIQLC6ZURQTFWCZQTXAY2ML7UA7HTWLDEX` | `GD4VPVNZ7OZICIII7PJ32MBK2LEONA3R23GBDKF7WEL7YNICEVSELDEX` |
| Memo | `LumenDex Daily Rewards!` | `LumenDex Liquidity Rewards!` |
| Time (UTC) | **17:04-17:06** | **16:36-16:37** |
| Time (Phoenix, UTC-7) | **about 10:04-10:06 AM** | **about 9:36-9:37 AM** |
| Batch size | **about 1,150-1,176 payments/day**, about 16.2-16.6M LDEX/day | **about 602-618 payments/day**, about 38.3-40.6M LDEX/day |
| Structure | about 12 txs/day, up to 100 payment ops each | same structure |
| LDEX held by sender now | about 18.97B | about 14.05B |
| Signer | single key, weight 1, thresholds 0 | same |

- **This matches Robert's "9:30-10 AM" in Phoenix time.** In UTC it is 16:36 and 17:04, not 9:30.
- The two sender accounts are on the same schedule every day for the days I checked. Daily batch: 2026-10-07 and 2026-10-09 to 2026-10-18. Liquidity batch: 2026-10-03 to 2026-10-18.
- **No batch from the Daily account on 2026-10-08 (UTC).** There were no transactions from it that day. Everything else is every day. The earlier days in the range were cut off by my page limit.
- The windows I checked were 9:30-10:00 UTC (nothing recurring), 16:30-17:00 UTC (the liquidity batch plus the start of the daily batch), and 17:00-17:10 UTC (the daily batch). I also scanned each account's full recent transaction list, so a batch at any other time would have shown up.

### 9.2 Per-holder rate (35 sampled holders, ranging from 1.2M to 14B LDEX)
- The Daily batch pays a **flat daily fraction of balance in tiers**, applied to the whole balance:
  - 1M up to under 10M LDEX: **0.01370%/day, exactly 5.00% APR**
  - 10M LDEX or more: **0.01917%/day, exactly 7.00% APR**
  - This matches the old Telegram tiers (5% at 1M, 7% at 10M). The top holder (14.0B LDEX) gets about 2.69M LDEX a day.
- Holders with less than 1M LDEX are not in my sample. Telegram says 250k and 500k tiers once existed (1% and 3%). Not checked.
- The Liquidity batch pays LPs in proportion to their pool shares. Amounts per holder are far larger than the Daily ones (for example about 82k LDEX on a 21M-LDEX holder). It follows the published share tiers of 9% to 19% APY.
- Payment amounts follow the "X LDEX / 100 * X% / 365" formula LumenDex states on Telegram: https://t.me/s/lumendexchannel?before=91

### 9.3 Source and mechanism
- The mechanism is a **centralized script**: one hot key per batch, simple `payment` operations, no smart contract, and no claim step.
- The issuer `GCTAWY73…` minted large amounts to the treasury `GCNUHWWZV2A3HM4UBB3NDVYACMWXLI2ERPVKVD2N32YV2GTBGRIBISJU` (500M on 2026-04-23, 1B on 2026-05-04, 100B on 2026-05-05, 100B on 2026-08-21). The two reward accounts hold 18.97B and 14.05B LDEX. I did not trace how the reward accounts themselves got their LDEX. **That funding link is unverified.**
- **The rewards are paid in newly issued LDEX.** Together the two batches are about 55M LDEX a day, about 20B a year. The stellar.toml says 10B total supply, but about 211.5B exists (StellarExpert shows the same figure). The "yield" is dilution paid from an issuer that can mint without limit. It is **not** revenue-backed.
- At the site's displayed price of about $0.0002 per LDEX (unverified, from the lumendex.com page), the daily payout is a few thousand dollars. The price is the only thing that makes it worth anything.
- StellarExpert flags the LDEX issuer for illicit or fraudulent activity (rating 0.0): https://stellar.expert/explorer/public/asset/LDEX-GCTAWY73CNMLONWUID7TMJT55NW4MS2MHMW26O222UGG2PRFE6ZXEH7N

### 9.4 What I could not verify
- stellarchain.io returned "Account Not Found" for the sender account via the URL I tried, so I could not cross-check there. All figures come from Horizon. Re-check by hand on stellarchain.io.
- I did not read LumenDex's X posts. Telegram and lumendex.com were read.
- The site still shows "Staking: +35% APR (soon)" and "Referral: up to +20% tokens (soon)". Those two features are not live. The holder and LP rewards above are separate and are live.

### 9.5 What this means for Quasaria
- **LumenDex's model is the easy part to copy and the dangerous part to promise.** A daily script paying tokens to holders needs no contract audit, but it creates a hot key that can drain the reward wallet, an unfunded-promise risk, and the securities and yield-claim risk in section 8.5. Do not copy the fixed APY tiers.
- A safer Quasaria version of "daily rewards" is pool-fee sharing paid in the pool's own assets (native LP fees). That has no token to inflate. If rewards are ever paid in a token, they should come from a funded budget with a hard cap, published on-chain.
- If you want daily LP rewards on Quasaria's Soroban AMM, do it as a staking contract that is part of the audit scope (421 LOC), not a script.


## 10. Referral program research (LumenDex's, and a no-contract version for Quasaria). Checked 2026-10-18 evening, Phoenix time

**Research only. Nothing was built, no mainnet action was taken, no outside contact was made.**

### 10.0 Bottom line
- **LumenDex's referral program does not exist.** It is "coming soon" on every page, the app has no referral-link code, and none of its four accounts has ever paid a referral. The "up to +20% tokens" line is marketing copy only. There is no mechanism to copy.
- **Quasaria can run referrals on mainnet without a smart contract.** The same method as the holder rewards works: referral binding is recorded on-chain by the referee's own signed transaction, an off-chain script reads Horizon, and plain payments go out daily from an ordinary account. Nothing here touches the audit scope.
- **The one design rule that makes it safe:** pay the referrer a small percentage of the referee's *holder reward*, not a percentage of purchases or trades. Self-referral and fake accounts then earn only a small rebate on capital they really hold. Wash trading earns nothing.
- **It cannot be live on mainnet today.** GLACIERQ is not issued, the mainnet accounts are unfunded, mainnet signing is off, and referral payouts depend on the holder-reward calculation, which has not yet been through a mainnet dry run. I recommend shipping it **right after the holder rewards pass their first mainnet dry run, not before**. Build effort is about 8-11 working days for the full version, or 5-6 for a minimal one (10.6).
- The share of pool fees is **not** available as a revenue source. Native pool fees go 100% to the LPs, and Quasaria has no cut. A fee-share referral would need Quasaria to add its own optional front-end fee first (10.3, option B). That is a product decision for Robert.

### 10.1 How LumenDex's referral program actually works: it does not
Evidence (Horizon, the LumenDex apps, Telegram):
- **Site copy.** The app is served identically from lumendex.online, lumendex.io and lumendex.co. The Earn page card reads: "earn up to 20% of tokens (coming soon) for every LDEX purchase made by someone who signs up using your unique referral link." The button is "Coming soon" and `link:null`. The home banner reads "Referral Program: up to +20% tokens (soon)". The staking card is equally "+35% APR (soon)".
- **App code.** I read the 9 MB lumendex.online bundle. "Referral" appears only in that copy. There is no `?ref=` handling, no referral code, no invite or affiliate logic. The only URL parameters it reads are `trezor-connect-src` and an anchor `search` field. A referral link or code therefore **does not exist**, so I can say nothing about what one would contain.
- **On-chain.** I scanned the entire transaction history (from 2025-08-31) of all four accounts: Daily rewards `GD5EEDUH…` (2,536 txs), Liquidity rewards `GD4VPVNZ…` (2,569), treasury `GCNUHWWZ…` (404), issuer `GCTAWY73…` (233).
  - The Daily account has sent **only** the memo `LumenDex Daily Rewards!` (1,963 txs). The Liquidity account has sent **only** `LumenDex Liquidity Rewards!` (1,964 txs).
  - The treasury has sent just 43 other transactions, of which only two carry a memo: `rewards supply` (2026-09-24, 10B LDEX to the Daily account) and `LP rewards top up` (2026-09-25, 15B LDEX to the Liquidity account). The issuer has sent 4, all without memos.
  - **No referral memo or payment exists.** The only memos containing "ref" are incoming airdrop spam (`XRPREFUND PROJECT`, `XLMREFUND AIRDROP`).
  - This also resolves the funding link left open in section 9.3. **The reward accounts are manually topped up from the treasury**, which holds the large mints. That is a hot-wallet-with-a-large-float pattern: the Daily and Liquidity accounts still hold about 19B and 14B LDEX on single, weight-1 keys.
- **Telegram** (t.me/s/lumendexchannel, all 4 pages, 96 posts). Referral appears in three posts only: the roadmap post lists "Decentralized referral system with attractive rewards for participants" under "TO BE COMPLETED", and two later posts say "we are developing a Referral program". No format, rates or dates were given. I did not check X.
- **Other:** stellarchain.io still says "Account Not Found" for the reward account via the URL I tried, so Horizon is the only on-chain source. lumendex.com did not respond. lumendex.app is a different, unrelated placeholder page.
- **Takeaway.** LumenDex's pitch is a *percentage of the referred user's purchases, paid in tokens*. That design is the one to avoid: a round-trip buy and sell costs a washer only the spread, so it is easy to farm.

### 10.2 Can Quasaria do referrals with no smart contract? Yes
Everything needed is native to Stellar and consistent with the holder rewards design.

**Link and binding**
- The link is `https://<quasaria>/?ref=G…` (the referrer's 56-character public key). The site validates it as a Stellar address, ignores it if it equals the visitor's own key, and stores it in `localStorage`. Nothing is paid or recorded at this point.
- **Binding is a transaction the referee signs themselves.** It is put into the normal onboarding transaction (the GLACIERQ trustline step) so the user sees no extra step. It adds one `manage_data` operation: name `quasaria:ref`, value = the referrer's raw 32-byte ed25519 key. Limits are 64 bytes for both name and value, so it fits.
  - Anyone can verify it with one Horizon call: `GET /accounts/{referee}` shows `data["quasaria:ref"]`. `GET /accounts?asset=GLACIERQ:<issuer>` returns **every holder with their `data` map and balances in one paginated feed** (I tested this on mainnet). The payout script therefore does not need to scan operation history.
  - Cost to the referee: 0.5 XLM reserve for the data entry, and 100 stroops (0.00001 XLM) in fee. The UI should state this.
  - **Alternative with no reserve:** put the referrer's key in the transaction's 32-byte `memo_hash`, signed by the referee, in a no-op transaction. That is cheaper but has no on-chain tag and is awkward to enumerate. I recommend the `manage_data` form.
- **Rules the script enforces, so attribution is checkable by anyone:**
  1. **First binding wins.** The script records the first value it sees and ignores later edits. The user can change the data entry afterwards, so the script must keep its own database (or read the `data_created` effect from Horizon).
  2. Referrer ≠ referee. The referrer must have a GLACIERQ trustline, hold the minimum balance (10.3), and be at least 14 days old.
  3. One level only: no payments on referees of referees.
  4. A binding must be made before the referee's first reward or within 30 days of account creation. A manual "enter a referral code" box can set it later within that window.
- **Publish a daily manifest.** The script emits a JSON/CSV of (referrer, referee, base reward, referral reward) with the snapshot ledger number, publishes it on the site, and puts `sha256(manifest)` into the `memo_hash` of the first payout transaction. Anyone can recompute the file from the chain.
- **Signed attestation is not needed.** A referrer cannot force an attribution on someone: the referee signs their own binding, and a referrer who is wrongly named simply receives a bonus. A separate off-chain signature would add complexity without extra safety.

**Payout**
- Plain `payment` operations of GLACIERQ from an ordinary account, up to 100 per transaction. Network fees are trivial: 1,000 payments is about 10 transactions and 0.01 XLM at the 100-stroop base fee (checked live).
- Memo `GLACIERQ-REF:YYYY-MM-DD` (23 bytes, within the 28-byte text limit). The script checks Horizon for payments already made that day, so a re-run cannot double-pay.
- A referrer with no trustline is skipped, not failed. The accrued amount is not carried forward, which keeps the rules simple and says so in the terms.

### 10.3 What the reward could look like
**Recommended (option A): a percentage of the referee's own daily holder reward, paid on top of it.** The referee's reward is unchanged. The bonus comes out of the reserve.

| Parameter | Proposal | Why |
|---|---|---|
| Referrer bonus | **10%** of the referee's daily holder reward | Small enough that self-referral is just a minor rebate |
| Duration | **365 days from binding** per referee | Bounds the liability |
| Referee requirement | Qualifies for holder rewards (≥1M GLACIERQ), holds the balance for 48 h+ | Reward only exists if real capital is held |
| Referrer requirement | Holds **≥100,000 GLACIERQ**, trustline, account ≥14 days old | Skin in the game; keeps empty sybil referrers out |
| Per-referrer cap | **25,000 GLACIERQ/day** | Equivalent to about 1.3B GLACIERQ of referred tier-2 balances, so it only stops extreme concentration |
| Referral sub-budget | **1,000,000 GLACIERQ/day** inside the existing 10M/day cap, scaled pro rata if exceeded | Referrals can never crowd out holder rewards |
| Delay | Pay on a 7-day lag behind the referee's reward | Gives time to spot and block abuse; Stellar tokens cannot be clawed back once paid |
| Funding | A separate **referral payer account with a float of about 30M GLACIERQ** (30 days at the sub-budget), topped up from the reserve | A stolen hot key then loses 30M, not the 50B reserve |

**Worked examples** (rates from `rewards.ts`: 5% a year from 1M, 7% from 10M, divided by 365)
- A referee holding **2M** earns 273.97/day. The referrer gets **27.40/day**, about 10,000 a year per referee. Twenty such referees pay **548/day**, or 200,000 a year.
- A referee holding **50M** earns 9,589/day. The referrer gets **959/day**, or about 350,000 over the year.
- **Aggregate cap math.** Holder reward plus the maximum referral bonus, assuming 100% of balances were referred (worst case):

| Qualifying balances | Holder rewards/day | + referral/day | % of the 10M cap | Reserve lifetime |
|---|---|---|---|---|
| 1B at 6% | 164k | 16k | 1.8% | ~757 years |
| 5B at 6% | 822k | 82k | 9.0% | ~152 years |
| 10B at 6.5% | 1.78M | 178k | 19.6% | ~70 years |
| 30B at 7% | 5.75M | 575k | 63% | ~22 years |
| 50B at 7% | 9.59M | 959k | 105% (cap bites, pro-rata scaling) | 13 years |

  - At the cap, the reserve lasts 13.7 years whatever the referral share, because the cap is total. At normal levels, referrals shorten the reserve life by at most 10%.
  - The sub-budget of 1M/day is 365M a year, 0.73% of the 50B reserve a year.

**Not recommended**
- **A percentage of purchases (LumenDex's pitch).** At up to 20%, a washer pays a spread of about 0.3% to earn a bonus 60 times larger. Do not pay on volume, trades or purchases.
- **Multi-level or team bonuses.** These are the MLM pattern in 10.4.

**Option B (needs a product decision): share of a Quasaria front-end fee.** Native pool fees and order-book trades pay Quasaria nothing today. If Quasaria later adds an optional 0.1% fee as an extra payment operation inside the user's own swap transaction (user-signed and atomic), a referrer could get a share. At $1M/day of volume, that is $1,000/day of fees and $250 to a referrer at a 25% share, paid in XLM or GLACIERQ. Wash trading is unprofitable as long as the referrer's share is below the fee itself. This introduces revenue and changes the "no fees" story. I would not do it for launch.

### 10.4 Risks and limits
- **Self-referral and sybil.** A user who refers their own wallets just earns 10% of their own 5-7%, about +0.5-0.7 percentage points of APR. Empty fake accounts earn nothing because the bonus is a percentage of a reward that needs 1M+ real tokens held. Splitting 10M across ten 1M accounts lowers their tier from 7% to 5%, so it loses. The per-referrer cap and the 100k referrer minimum cover the rest. **This is not "no abuse"; it is abuse that is bounded and paid for with real capital.**
- **Snapshot gaming (also affects the base holder rewards, not just referrals).** If rewards use a single daily snapshot, a wallet can hold the tokens for only that second. I recommend **the minimum of two snapshots 24 hours apart** (or the minimum of four snapshots a day) for both programs. LumenDex does not publish its snapshot rule.
- **Wash trading.** Not rewarded under option A, because trades are not an input.
- **Hot key.** A single script key holds the budget. Use the separate referral payer with a 30-day float, keep the 50B reserve in a cold multisig account, and make the daily payer pre-fund only the day's amount. LumenDex's single-key accounts hold 14-19B tokens and show the failure mode.
- **Irreversibility.** Stellar payments cannot be recalled, and GLACIERQ's issuer will be locked, so there is no clawback. The only controls are the delay, caps and a manual pause switch. A bug that overpays is permanent, so the script needs a dry-run mode, a daily maximum check, and a human sign-off on the first week of mainnet batches.
- **Securities, MLM and pyramid flags (not legal advice).**
  - Holder rewards in a token already carry the biggest risk (see 8.5). Referral bonuses add "rewards for bringing in others". That is the factor regulators look at for pyramid or investment-contract treatment.
  - Safer structure: **single level, paid on the referee's holding rather than recruitment, no fee to join, capped, time-limited**, and with no marketing that suggests earning by recruiting. The design above follows this.
  - Referrers who promote publicly generally must disclose the relationship (FTC endorsement rules in the US). The Referrals page should carry that notice and the same "not guaranteed, not financial advice" text as the rewards.
  - A lawyer should review the program and terms before launch. Do not call it income.
- **Sanctions.** Keypairs are pseudonymous, so Quasaria cannot identify who it pays. Screen every payee address against the OFAC SDN digital-currency address list before each batch (a free list, though it rarely includes Stellar addresses), and geo-block sanctioned jurisdictions on the site. Neither fully solves the problem; I could not verify the sanctions exposure of a pseudonymous payer. Ask counsel.
- **Tax and records.** Payouts may be taxable income for recipients, and a US operator can have information-reporting questions, though payees are anonymous. Keep a payout ledger (the daily manifest serves). Needs counsel.
- **UX limits.** The link lives in `localStorage`, so a user who switches browsers or devices before binding loses attribution. The manual code box mitigates this. The 0.5 XLM reserve is a visible cost. Users with account keys saved as plain keys have no recovery, as with everything else on the site.
- **Not verified:** GLACIERQ's market price (not trading yet), legal conclusions, and whether any directory shows referral data. All numbers above are my modelling from `rewards.ts`, not an observed result.

### 10.5 Can it be live on mainnet now? No. Soon, after holder rewards
- **Not now:** no GLACIERQ is issued, the reward and issuer accounts are not funded, mainnet signing is off, and no mainnet holder payout has run. A referral bonus is computed *from* those payouts.
- **Launch order:** (1) mainnet accounts funded, GLACIERQ issued, issuer locked; (2) holder rewards dry run, then first live batch; (3) referral binding switched on in the UI with payouts after a first dry-run week; (4) first live referral batch.
- **Interim:** the site can show a "Referrals: coming soon" card, but do not promise a rate, since the percentage and caps are proposals.

### 10.6 What it would take to build (estimates in working days, my judgment, not quotes)
| # | Component | Days |
|---|---|---|
| 1 | Spec and terms: rules, rates, disclosures, referral terms page | 0.5-1 |
| 2 | Frontend: capture `?ref`, validate, self-referral guard, add the `manage_data` binding to onboarding/trustline tx, manual code box | 1.5-2 |
| 3 | **Referrals section/tab:** your link and QR, referee count, estimated daily bonus, payout history, rules, risk notice, daily manifest download. Matches the Holders tab style | 1.5-2 |
| 4 | Payout script: read holders and `data`, validate rules, compute with caps, manifest and `sha256` memo, batch builder (100 ops/tx), idempotency, dry-run, pause switch, payer-float guard | 2-3 |
| 5 | Abuse controls: min balances, age checks, two-snapshot minimum, per-referrer cap, sanctions screening, alerts | 1 |
| 6 | Testnet end-to-end tests (binding, rules, cap scaling, double-run safety) | 1-2 |
| 7 | Docs, FAQ and any explainer clip | 0.5-1 |
| | **Full version** | **about 8-11 days** |
| | **Minimal version** (binding, script, simple page, no QR/manifest polish) | **about 5-6 days** |

- **Needs from Robert:** approval of the rates in 10.3 (or changes); a decision on option B; funding of a referral payer with a ~30M GLACIERQ float (from the reserve) once on mainnet; counsel's review of the terms.
- **Site changes:** a Referrals link or tab beside Holders, a `?ref` handler, an optional referrer pill on the Holders tab, and copy updates in the docs and FAQ.
- **No smart contract and no audit scope change.**
