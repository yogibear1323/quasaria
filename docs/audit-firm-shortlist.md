# Quasaria: Smart-Contract Audit Firm Shortlist

*Research compiled Sep 26, 2026 (Arizona time). This is research only. No firm was contacted, no form was filled in, and no quote was requested.*

**Scope being audited (Quasaria, Stellar Soroban / Rust):** staking contract, a 1:1 fully backed XLM wrapper token that pays holder yield from a reserve, a constant-product AMM pool plus router, a referral fee contract, and a leverage vault with oracle-driven liquidations. In the local repo (`contracts/`) this is about **2,850 non-test Rust lines** across six contracts: amm-pool 624, leverage-vault 686, reward-token 840, staking 350, referral 217, router 132. There is also a 112-line `mock-oracle`. I measured these counts with `wc -l` on the box on Sep 26, 2026, so they are not from an external source.

**How to read this:** every claim has a source URL. Report page counts come from `pdfinfo` on the PDF at the linked URL. Anything marked *(inference)* is my judgement, not a sourced fact. Where information could not be found, it says "not publicly stated".

---

## TL;DR ranking

| Rank | Firm | Audit Bank status | Strongest comparable Soroban work | Why it's ranked here |
|---|---|---|---|---|
| **1** | **Certora** | Approved | Blend v1 + v2 (lending/liquidations, incl. formal verification), Aquarius AMM, Slender (lending), Reflector (oracle) | Covers the widest range of Quasaria's components and has a Soroban formal-verification prover. Good for invariants like wrapper backing, AMM `k`, and vault solvency. |
| **2** | **Runtime Verification** | Approved | FxDAO (vaults + liquidations + oracle), Soroswap Aggregator (AMM routing), OctoLend (lending/liquidations/oracle), EquitX (CDP liquidations), StellarBroker, DeFindex | Most recent Soroban DeFi reports of any firm here. Has its own Soroban fuzzing/FV tool (Komet) and audited `rs-soroban-env`. |
| **3** | **OtterSec** | Approved | Soroswap core (constant-product AMM + router), Blend v1 (found a critical liquidation bug), Reflector (oracle) | Its engagements map most directly onto the AMM, router and liquidation parts. Engagements are short and fast. |
| **4** | **Veridise** | Approved | Phoenix DEX (AMM **and staking**), OrbitCDP (XLM-collateral CDP), HiYield (lending), Wombat (AMM), Untangled vault (oracle); audited Soroban core for SDF | Clearest match for the AMM + staking pair. Its reports state person-weeks, which helps with budgeting. |
| **5** | **Halborn** | Approved | Peridot (lending + **margin/leverage** + liquidations + oracle), Normal Finance Stellar AMM; currently auditing Aquarius concentrated liquidity | Its most recent public Soroban report is a close analog of Quasaria's leverage vault. |

**Recommendation:** If Quasaria is SCF-funded, apply to the SDF Audit Bank and state a preference for **Certora** (first choice) or **Runtime Verification** (second choice). SDF assigns the firm but considers the project's preference. If Quasaria pays privately, get quotes from **Certora and Runtime Verification**, with **OtterSec** as the fast, lower-effort alternative for the AMM and router. Details are in the per-firm sections and "Getting 2 quotes" below.

---

## SDF Soroban Security Audit Bank (subsidy): how it works

- **What it is:** an SDF program that "schedules audits for projects and covers up to 100% of the audit cost" with pre-approved firms. It is for eligible projects funded through the Stellar Community Fund (SCF). Audits use "pre-negotiated rates". Sources: https://stellar.gitbook.io/scf-handbook/supporting-programs/audit-bank/official-rules and https://stellar.org/grants-and-funding/soroban-audit-bank
- **Scale:** SDF reports "over 40 essential audits, deploying over $3 million" since launch (https://stellar.org/blog/developers/soroban-security-audit-bank-raising-the-standard-for-smart-contract-security). At launch the program offered "up to $1M in security audit credits" for "20-30 high-priority projects" (https://stellar.org/blog/developers/the-soroban-audit-bank-fostering-a-secure-smart-contract-ecosystem).
- **Co-pay schedule** (https://stellar.gitbook.io/scf-handbook/supporting-programs/audit-bank/official-rules):

  | Audit stage | Traction threshold | Project co-pay |
  |---|---|---|
  | Initial Audit | None for priority categories | **5%**, paid upfront to SDF. **Fully refunded** if all critical, high and medium issues are fixed within **20 business days**, as verified by SDF with the audit firm. |
  | Growth Audit | >$10M TVL or equivalent | 0% (may include formal verification) |
  | Scale Audit | >$100M TVL or equivalent | 0% (may include formal verification) |
  | Pre-traction follow-ups | n/a | **20%** for the first follow-up, **50%** for the second |

  The FAQ describes the same rule: "the project must pay 5% of its first audit cost as an upfront co-payment to SDF. Subsequently, SDF will pay the entire first audit cost" (https://stellar.gitbook.io/scf-handbook/supporting-programs/audit-bank/faq).
- **Eligibility** (all from the Official Rules URL above):
  - Must be **SCF-funded**. Companies with other commercial SDF grants are not eligible.
  - Must pass KYC and sanctions checks.
  - Must be in a priority category. "Financial Protocols", "Infrastructure Contracts: Oracles, vaults…" and "Yield-Bearing Token Protocols" all apply to Quasaria.
  - Code in scope must be complete, "nearly Mainnet-ready", extensively tested and **deployed on Testnet**.
  - The application must include self-service tooling scan results with a remediation plan and a **STRIDE threat model**.
  - The team must stay responsive during the audit and be able to pay the co-pay.
- **Process and timing:**
  - Phases: Intake → Readiness Review with threat modeling (<4 weeks) → Scheduling (1 week) → Pre-audit prep (2–3 weeks) → Audit (1–6 weeks) → Remediation (1–4 weeks) → Verification (2–3 weeks) → public report (Official Rules URL).
  - The FAQ says projects are "matched with an audit firm within approximately two weeks after passing the readiness review", firms schedule "within 3–6 weeks after matching", and audits take "2 to 8 weeks" (FAQ URL).
- **Firm selection:** "Multiple quotes from pre-approved audit firms will be gathered" by SDF. SDF schedules "at SDF's discretion", weighing among other things the "Project's preference (if expressed in submission form)". SDF "retains sole discretion over audit firm assignment" (Official Rules URL).
- **Approved firms, as of this research:** Certora, Code4rena, ChainSecurity, Halborn, Oak Security, OtterSec, Runtime Verification, Spearbit + Cantina, Veridise, Zellic.
- **Probationary firms:** Arda, Hacken, Sherlock, Quantstamp, Hashlock, Decurity, Adevar Labs, Bevor (Official Rules URL).
- **Note on CoinFabrik:** it was one of the six launch firms (https://stellar.org/blog/developers/the-soroban-audit-bank-fostering-a-secure-smart-contract-ecosystem) but is **not on the current approved or probationary list**.
- **Open question:** the task does not say whether Quasaria is SCF-funded. If it is not, the Audit Bank is not available and the full cost falls on the project.

---

## 1. Certora (recommended first choice)

- **Website:** https://www.certora.com
- **Audit Bank:** Yes, approved (https://stellar.gitbook.io/scf-handbook/supporting-programs/audit-bank/official-rules).
- **Why it fits:**
  - **Formal verification on Soroban.** Certora states its Prover supports "Stellar" and "Soroban" (https://github.com/Certora/SecurityReports).
  - For Blend v2, its formal-verification report says "The Certora Prover demonstrated that the implementation of the Stellar contracts above is correct with respect to the formal rules". The rules were published and run with `certoraSorobanProver` (https://github.com/blend-capital/blend-contracts-v2/tree/main/audits, FV report).
  - This suits Quasaria's key invariants *(inference)*: wrapper supply ≤ XLM backing, a yield reserve separate from principal, AMM `k` never decreasing, and no insolvent vault position left unliquidatable.
  - Its manual-review coverage spans **lending/liquidations** (Blend, Slender), an **AMM** (Aquarius) and an **oracle** (Reflector).
- **Comparable Soroban/Stellar work (public reports):**
  - **Blend v1** (lending/backstop): security report, Jan 2024, 17 pp. "performed during 6 weeks between October and December 2023" (https://github.com/blend-capital/blend-contracts/blob/main/audits/BlendCertoraReport.pdf; summary at https://www.certora.com/reports/blend).
  - **Blend v1 formal verification**: 9 pp. Work started Nov 26, 2024 and verification finished Jan 15, 2025 (https://github.com/Certora/SecurityReports/blob/main/Reports/2025/01_30_2025_Blend_V1-FV.pdf).
  - **Blend v2**:
    - Security assessment, 25 pp, Feb 3–Mar 27, 2025. Findings include "Users can create nearly unfillable auctions" and "share inflation to bypass partial liquidation protection".
    - FV report, 14 pp, Feb 3–Mar 13, 2025.
    - Both are at https://github.com/blend-capital/blend-contracts-v2/tree/main/audits.
    - Certora also ran the Blend v2 Code4rena contest with a formal-verification track (https://code4rena.com/audits/2025-02-blend-v2-audit-certora-formal-verification).
  - **Aquarius AMM**: 38 pp. Manual review Aug 14–Sep 30, 2024, plus a fix review Nov 18–Dec 13, 2024 (https://github.com/Certora/SecurityReports/blob/main/Reports/2024/12_29_2024_Aquarius-MR.pdf; https://www.certora.com/reports/aquarius-amm-security).
  - **Slender** (lending): 42 pp, cover dated July 2024, listed May 22, 2024. Findings include "Stellar's resource limit can block liquidations" and "Liquidating small positions is not incentivized" (https://github.com/Certora/SecurityReports/blob/main/Reports/2024/05_22_2024_Slender-MR.pdf).
  - **Reflector** (oracle DAO + subscription contracts): FV + manual review, 23 pp, Sep 25–Oct 10, 2024 (https://github.com/Certora/SecurityReports/blob/main/Reports/2024/10_10_2024_Reflector-FV-MR.pdf).
  - **Spectra** (Stellar + EVM bridge): 28 pp, May 1–18, 2026. An Audit Bank engagement completed May 18, 2026 (https://www.certora.com/reports/spectra-bridge; https://stellar.org/audit-bank/projects).
  - Other Stellar entries: Huma, Cables, Reyts (https://github.com/Certora/SecurityReports).
- **Typical scope and timeline:** from the reports above, 2–8 weeks per engagement, with separate fix-review windows. Reports run 9–42 pp.
- **Cost:** Certora's rates are **not publicly stated**. One related public figure: the Certora-co-run Blend v2 Code4rena contest had a **$125,000 USDC** total pool, including "Formal Verification: up to $20,000" and "Mitigation Review: $20,000" (https://github.com/code-423n4/2025-02-blend). That was a 27,099-line Rust scope (https://code4rena.com/reports/2025-02-blend-v2-audit-certora-formal-verification), far larger than Quasaria.

## 2. Runtime Verification (recommended second choice)

- **Website:** https://runtimeverification.com
- **Audit Bank:** Yes, approved. SDF describes RV's approach as "formal methods… starting with an in-depth design and specification review" (https://stellar.gitbook.io/scf-handbook/supporting-programs/audit-bank/official-rules).
- **Why it fits:**
  - It has the most recent Soroban DeFi reports of the firms reviewed, across CDP/vault liquidations, AMM routing and lending.
  - It builds **Komet**, "its in-house formal verification and fuzz testing tool tailored for Soroban smart contracts", which was used in the StellarBroker audit (https://github.com/runtimeverification/publications/blob/main/reports/smart-contracts/StellarBroker_report.pdf; Komet repo: https://github.com/runtimeverification/komet).
  - It also audited the Soroban host environment itself, `rs-soroban-env`, in 2024 (https://github.com/runtimeverification/publications).
- **Comparable Soroban/Stellar work** (index: https://github.com/runtimeverification/publications):
  - **FxDAO** (XLM-collateral vaults + stable pools): 54 pp, "4 calendar weeks (March 28, 2024, through April 28, 2024)". Findings include "liquidate and redeem functions can be blocked…" and "Only One Oracle is Used As Reference" (https://github.com/runtimeverification/publications/blob/main/reports/smart-contracts/FxDAO.pdf).
  - **Soroswap Aggregator** (AMM router across DEXes): 43 pp, "3 calendar weeks (July 15, 2024, through August 5…)" (https://github.com/runtimeverification/publications/blob/main/reports/smart-contracts/Soroswap_Aggregator.pdf; also linked from https://docs.soroswap.finance/smart-contracts/soroswap-aggregator/audits).
  - **OctoLend (Untangled)** (lending + collateral vault): 40 pp, "5 calendar weeks (January 22, 2026, through February 27, 2026)", with Komet fuzz testing. Findings include "No Protections Against Stale Oracle Prices" and several liquidation bugs (https://github.com/runtimeverification/publications/blob/main/reports/smart-contracts/OctoLend.pdf). This was an Audit Bank audit completed Feb 27, 2026 (https://stellar.org/audit-bank/projects).
  - **EquitX** (CDP with XLM oracle + liquidations): 32 pp, Oct 13–Nov 17, 2025. Manual review only; "No fuzzing, formal verification… was included in the scope". Findings include "Incorrect Handling of Interest During Liquidation" (https://strapi-rv-bucket-01.s3.us-east-2.amazonaws.com/20251210_Equit_X_d705fd836a.pdf).
  - **StellarBroker**: 25 pp, Mar 31–Apr 18, 2025, "as part of the Stellar Development Foundation's Audit Bank program" (URL above).
  - **DeFindex APY Stabilizer** (yield/vault fee proxy): 46 pp, "two calendar weeks, with two Soroban auditors working in parallel" (https://github.com/runtimeverification/publications/blob/main/reports/smart-contracts/DeFindex%20APY%20Stabilizer-Audit%20Report-Final.pdf).
- **Typical scope and timeline:** 2–5 calendar weeks in the reports above. Reports run 25–54 pp. FV/fuzzing is included in some engagements and explicitly excluded in others, so **ask for it explicitly**.
- **Cost:** **not publicly stated.**

## 3. OtterSec

- **Website:** https://osec.io
- **Audit Bank:** Yes, approved. It was also one of the original launch firms (https://stellar.gitbook.io/scf-handbook/supporting-programs/audit-bank/official-rules; https://stellar.org/blog/developers/the-soroban-audit-bank-fostering-a-secure-smart-contract-ecosystem).
- **Why it fits:**
  - It audited the canonical Soroban **constant-product AMM + factory + router** (Soroswap core), which is directly analogous to Quasaria's pool and router.
  - It audited **Blend's lending/liquidation** code and found a **critical** liquidation-state bug plus a share-price inflation attack. The Blend report says: "a critical vulnerability where the state of the user-to-be-liquidated may be outdated… and another issue that enables the initial depositor to execute an inflation attack, manipulating the share token's price" (https://github.com/blend-capital/blend-contracts/blob/main/audits/blend_capital_final.pdf).
  - It audited the **Reflector oracle**.
  - Formal verification is **not publicly stated** as an OtterSec service for Soroban.
- **Comparable Soroban/Stellar work** (index: https://osec.io/audits):
  - **Soroswap core** (AMM/factory/router): 15 pp, "conducted between December 11th and December 27th, 2023". It found 3 vulnerabilities and 3 general findings, including a high-severity unbounded-storage issue (report: https://github.com/soroswap/core/blob/main/audits/2024-02-22_soroswap_ottersec_audit.pdf; team write-up: https://medium.com/stellar-community/securing-soroswap-finance-our-journey-with-ottersec-ee4d839c0168). The write-up also stresses freezing a commit hash before the audit.
  - **Blend Capital v1**: 23 pp, "conducted between January 29th and February 29th, 2024", 10 findings (URL above; also https://osec.io/reports/67a31c2a-91c0-48c9-bc38-22c2b5ff105d).
  - **Reflector oracle**: 16 pp, "conducted between January 18th and January 25th, 2024" (https://github.com/reflector-network/reflector-contract/blob/master/audits/reflector_ottersec_audit_public_feed_2024.pdf).
  - Also listed on OtterSec's audits page: Soroban Governor (https://osec.io/reports/8ee2b53c-7794-46af-861b-b78e075a43e6), Axelar Stellar, Stellar RPC, and Stellar repos for Paxos, Rango and Mercury Labs Sollpay (https://osec.io/audits).
- **Typical scope and timeline:** 1 week (Reflector), about 2.5 weeks (Soroswap) and about 1 month (Blend). Reports run 15–23 pp.
- **Cost:** **not publicly stated.**
- **Caveat:** OtterSec's public Soroban **DeFi** reports (Soroswap, Blend, Reflector) date from 2023–2024 (sources above). Its later Stellar entries on https://osec.io/audits are mostly infrastructure and token work *(inference from the listing)*.

## 4. Veridise

- **Website:** https://veridise.com
- **Audit Bank:** Yes, approved, and one of the original launch firms (Official Rules URL; launch blog URL above).
- **Why it fits:**
  - Veridise calls Soroban audits "one of our core competencies". It says it reviews "authorization boundaries, arithmetic and ledger-based time logic, storage and TTL assumptions, and host-boundary type safety" (https://veridise.com/audits/soroban/).
  - Its Phoenix audit covered **AMM pools and staking**, two of Quasaria's components.
  - It has also audited a Soroban **XLM-collateral CDP**, **lending** protocols and an **oracle-driven vault**.
  - SDF chose it to audit **Soroban core**: "From Oct. 30, 2023 to Dec. 22, 2023… over 35 person-weeks" (https://veridise.com/wp-content/uploads/2025/02/VAR_Stellar_Soroban.pdf).
- **Comparable Soroban work** (index: https://veridise.com/audits/soroban/):
  - **Phoenix DEX** (pools + staking): 46 pp, Jan 3–18, 2024, "4 person-weeks, with 2 engineers reviewing code over 2 weeks" (https://veridise.com/audits-archive/company/moonbite/phoenix-dex-2024-05-03/; PDF https://veridise.com/wp-content/uploads/2025/02/VAR_MoonBite_240103_OfficialR.pdf). Phoenix says the audit was funded by the Audit Bank (https://medium.com/stellar-community/phoenix-building-the-first-defi-hub-on-stellar-cae669829ab5).
  - **OrbitCDP** (borrow stablecoins against XLM): 23 pp, Dec 16–20, 2024, "3 person-weeks, with 3 security analysts… over 1 week" (https://veridise.com/audits-archive/company/orbit/zenith-protocols-orbitcdp-2024-12-26/).
  - **Wombat Exchange** (AMM ported to Soroban): 49 pp, Sep 2–Oct 29, 2024, 17 person-weeks (https://veridise.com/audits-archive/company/wombat/wombat-exchange-2024-12-24/).
  - **Lydia Labs HiYield** (two lending protocols): Apr 15–May 15, 2024, 9 person-weeks (https://veridise.com/audits-archive/company/lydia-labs/hiyield-2024-05-29/).
  - **Untangled Vault** (tagged "Price Oracle, Vault"): 22 pp, 12 person-days (https://veridise.com/audits-archive/company/untangled-finance/untangled-vault-2025-05-22/).
  - Also: RedStone Stellar Connector (oracle), Stellar Registry/Scaffold (an Audit Bank audit, https://stellar.org/audit-bank/projects), Centiiv, Verseprop (https://veridise.com/audits/soroban/).
- **Typical scope and timeline:** Veridise publishes effort in person-weeks, which helps with budgeting. Examples: 3 person-weeks for a small CDP, 4 for AMM + staking, 9 for lending, 17 for a large AMM. Calendar time ranged from 1 to 8 weeks.
- **Cost:** **not publicly stated.**

## 5. Halborn

- **Website:** https://www.halborn.com
- **Audit Bank:** Yes, approved (Official Rules URL).
- **Why it fits:** its most recent public Soroban report, **Peridot**, is a close analog of Quasaria's leverage vault. Halborn describes Peridot as a "DeFi lending, borrowing, and margin trading platform" on Soroban. The findings map directly onto Quasaria's risk surface:
  - "Repair the liquidation mechanism"
  - "Enforce fresh oracle prices at every critical decision point"
  - Soroban TTL/archival issues ("Missing TTL Bumps for Configuration Keys… Bricks Liquidation")
  - "AMM Price Manipulation Enables Undercollateralized Position Opening"
  - "Exchange Rate Inflation Via Direct Token Donation"

  Source: https://www.halborn.com/audits/peridot-protocol/smart-contract-assessment-e9c4bc
- **Comparable Soroban work:**
  - **Peridot**: Mar 9–Apr 9, 2026. "assigned a full-time security engineer". 67 findings (3 critical, 5 high, 17 medium), all solved (URL above). An Audit Bank audit completed Apr 9, 2026 (https://stellar.org/audit-bank/projects).
  - **Normal Finance Stellar AMM**: Jun 25–Aug 5, 2025, 12 findings including 3 high (https://www.halborn.com/audits/normal-finance/stellar-amm-6f9223).
  - Other Audit Bank audits: **Spiko** (https://www.halborn.com/audits/spiko/stellar-contracts-879885), **Alula** (https://www.halborn.com/audits/alula-finance/smart-contracts-cd8f6d) and **Rivool Finance** (listed at https://stellar.org/audit-bank/projects).
  - Halborn is currently auditing Aquarius concentrated liquidity, engaged June 2026 (https://docs.aqua.network/security/audits).
- **Typical scope and timeline:** about 4–6 weeks in the two reports above. Peridot used one full-time engineer.
- **Cost:** **not publicly stated.**
- **Caveat:** Halborn has no formal-verification offering for Soroban that I could find publicly (not publicly stated). Its public Soroban DeFi reports are more recent (2025–2026) but fewer than those of the top three.

---

## Candidates evaluated but not shortlisted

- **Zellic** (https://www.zellic.io). Approved Audit Bank firm (Official Rules URL).
  - Public Soroban reports found: *Volta Wallet* (https://github.com/Zellic/publications/blob/master/Volta%20Wallet%20-%20Zellic%20Audit%20Report.pdf) and *Pyth Pro Stellar Contracts* (listed in https://github.com/Zellic/publications).
  - Zellic acquired Code4rena in Aug 2024 (https://www.zellic.io/blog/why-code4rena). Code4rena ran the Reflector v3 contest (Oct 27–Nov 11, 2025, **$20,000 USDC** pool; https://code4rena.com/audits/2025-10-reflector-v3), which SDF lists as "Reflector - Code4rena / Zellic" (https://stellar.org/audit-bank/projects).
  - Not shortlisted because I found no public Zellic report on a Soroban AMM, staking or lending protocol. It is a good fit for a **later competitive audit** (via Code4rena) layered on top of a primary audit.
- **CoinFabrik** (https://www.coinfabrik.com).
  - Public Soroban audits: Aquarius AMM (March 2024) and BondHive (Sep 2024) (https://github.com/CoinFabrik/coinfabrik-audit-reports; https://www.coinfabrik.com/blog/aquarius-audit-report/).
  - Maintains **Scout**, an open-source Soroban static analyzer and useful pre-audit tooling (https://github.com/CoinFabrik/scout-soroban).
  - Not shortlisted: fewer comparable reports, and it is **not on the current Audit Bank list**.
- **Code4rena / Spearbit+Cantina** (competitive audits). Both are approved Audit Bank firms. Blend v2 used Code4rena (27,099 Rust lines, 3 high and 18 medium findings; https://code4rena.com/reports/2025-02-blend-v2-audit-certora-formal-verification). Aquarius used a 2-month Cantina competition with 33 researchers (https://docs.aqua.network/security/audits). Both are better as a *second* layer after the private audit than as the first audit *(inference)*.

---

## Public cost data points (none are firm rate cards)

Firm-specific pricing is **not publicly stated** for any shortlisted firm. The public figures I found:

1. **Blend v2 competitive audit + Certora FV (Code4rena): $125,000 USDC total pool** for a 27,099-line Rust scope (https://github.com/code-423n4/2025-02-blend; https://code4rena.com/reports/2025-02-blend-v2-audit-certora-formal-verification).
2. **Reflector v3 competitive audit (Code4rena): $20,000 USDC** total awards (https://code4rena.com/audits/2025-10-reflector-v3).
3. **Audit Bank program average (derived):** "over 40" audits for "over $3 million" works out to roughly $75k per audit on average *(my arithmetic)* (https://stellar.org/blog/developers/soroban-security-audit-bank-raising-the-standard-for-smart-contract-security). The 2023 launch budget of "up to $1M" for "20-30" projects implies about $33k–$50k each *(my arithmetic)* (https://stellar.org/blog/developers/the-soroban-audit-bank-fostering-a-secure-smart-contract-ecosystem).

Under the Audit Bank, Quasaria's out-of-pocket cost for the Initial Audit would be **5% of the audit cost, refundable** if critical, high and medium findings are fixed within 20 business days (see the subsidy section).

**Expected effort for Quasaria *(inference)*:** Quasaria has about 2,850 non-test lines across six contracts. Comparable engagements:
- Phoenix AMM + staking: 4 person-weeks over 2 weeks
- Soroswap core: about 2.5 weeks
- FxDAO vaults: 4 weeks

A single-firm audit of roughly **2–4 calendar weeks** is plausible, plus a fix review. Adding formal verification of the wrapper, AMM and vault invariants would add time.

---

## How to prepare (before requesting quotes or applying)

1. **Freeze the code.** Tag a release and give auditors one commit hash. Soroswap called setting the commit hash "crucial" (https://medium.com/stellar-community/securing-soroswap-finance-our-journey-with-ottersec-ee4d839c0168). Certora noted that the Blend v1 audit ran on a "live repository" instead of a frozen commit, which is not its usual practice (https://www.certora.com/reports/blend). The Audit Bank also requires in-scope code to be complete and deployed to Testnet (Official Rules URL).
2. **Replace `mock-oracle` with the production oracle integration before freezing.** The repo currently ships a mock oracle. Liquidation logic should be audited against the real feed, with its staleness, decimals and fallback behaviour *(inference)*. Lessons from comparable projects:
   - Staleness bugs appeared in the OctoLend and Peridot reports (links above).
   - The **YieldBlox DAO pool on Blend v2 was drained for $10M+ on Feb 22, 2026**. Its Reflector price source followed a thin, manipulable SDEX market. This was "a pool-operator… configuration issue", not a Blend core bug (https://blocksec.com/blog/yieldblox-dao-incident-on-stellar-oracle-misconfiguration-enabled-a-10m-drain).
   - So ask for **oracle configuration and asset-listing risk to be in scope**, not just the contract code.
3. **Documentation:** an architecture overview, a per-contract spec, and a **data-flow diagram with trust boundaries**. Also list the invariants you believe hold, such as:
   - wrapper supply ≤ XLM held
   - yield paid only from the reserve, never from principal
   - AMM `k` non-decreasing apart from fees
   - an unhealthy vault position is always liquidatable within Soroban resource limits (Slender's "resource limit can block liquidations" finding shows why)

   The Audit Readiness Checklist requires the data-flow diagram and threat model (https://stellar.gitbook.io/scf-handbook/supporting-programs/audit-bank/audit-readiness-checklist).
4. **Test suite:** unit and **integration tests**, executed, with coverage numbers. Add fuzz and property tests for the invariants above. The checklist asks for integration tests (checklist URL).
5. **Threat model:** a **STRIDE** threat model is mandatory for the Audit Bank (Official Rules URL).
6. **Self-scan first:** run a Soroban static analyzer such as CoinFabrik Scout (https://github.com/CoinFabrik/scout-soroban). The Audit Bank asks for tooling results plus a remediation plan (Official Rules URL).
7. **Plan remediation capacity:** fixing all critical, high and medium findings within 20 business days is what gets the 5% co-pay refunded (Official Rules URL).

## Getting 2 quotes

- **If using the Audit Bank:** SDF itself gathers "multiple quotes from pre-approved audit firms" and assigns the firm, weighing the project's stated preference (Official Rules URL). **Quasaria should not solicit quotes itself in that path.** Instead, name a first and second preference in the submission form (for example Certora, then Runtime Verification) with a one-line reason tied to the comparable reports above.
- **If paying privately:** get at least two quotes, ideally from firms with different strengths: one FV-heavy (Certora or Runtime Verification) and one manual-review specialist with direct AMM/lending analogs (OtterSec or Veridise) *(inference)*. To make quotes comparable, send each firm the **same frozen commit, scope list (files and LOC), docs and threat model**. Ask each quote to state:
  - engineer count and person-weeks (the unit Veridise already publishes)
  - calendar dates
  - whether a fix review is included
  - whether fuzzing or formal verification is included (RV's EquitX engagement explicitly excluded both; https://strapi-rv-bucket-01.s3.us-east-2.amazonaws.com/20251210_Equit_X_d705fd836a.pdf)
  - whether the report will be public

---

## Final recommendation

1. **Certora.** Best overall match: lending/liquidations (Blend, Slender), AMM (Aquarius), oracle (Reflector), and Soroban formal verification that can prove the wrapper, AMM and vault invariants.
2. **Runtime Verification.** Deepest recent Soroban DeFi track record (FxDAO, OctoLend, EquitX, Soroswap Aggregator) plus Komet fuzzing/FV. Make sure FV/fuzzing is in scope.
3. **OtterSec.** Most direct AMM/router analog (Soroswap core), found a critical liquidation bug in Blend, and works fast. Choose it if schedule or budget matters more than formal verification.
4. **Veridise.** Best AMM + staking analog (Phoenix) and transparent person-week sizing.
5. **Halborn.** Freshest leverage/margin analog (Peridot).

**Suggested path:** confirm SCF eligibility and apply to the Audit Bank naming Certora, then Runtime Verification. After launch, and once TVL milestones are hit, use the free Growth or Scale audit (or a Code4rena/Cantina competition) as a second, independent review.
