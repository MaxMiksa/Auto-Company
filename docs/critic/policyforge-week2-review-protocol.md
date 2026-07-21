# PolicyForge Week 2 Review Protocol — Critic-Munger Gate

**One-sentence judgment:** I will recommend **GO** only if every item on the fatal-flaw bar is cleared with hard, verifiable evidence by Day 14; any red flag means **NO-GO** or a hard pause, because the PR/FAQ is a bet that a low-infrastructure document generator can carry recurring revenue and legal immunity, and neither of those is proven (`docs/critic/policyforge-pre-mortem.md:1-4`).

---

## 1. Pre-Mortem Invocation (Week 2 Validation)

*Skill invoked: `premortem`.*

### The Plan

PolicyForge will spend Weeks 1–2 on validation and foundation: landing page + waitlist, pricing-page A/B test ($349 vs. $399 Starter), outreach to active SOC 2 / ISO 27001 auditors and compliance consultants, and legal/disclaimer posture. If the evidence clears the bar, the 8-week build continues. If not, the CEO will NO-GO and pivot to FlowSpec or InvoicePipe (`docs/ceo/policyforge-decision.md:70-78`, `memories/consensus.md:25-26`).

### Time Jump

It is Week 14. We are not shipping on time. The landing page converted a few $349 Starter packs but almost no $599/year Growth plans. Two auditors posted lukewarm notes that "the draft looks fine with editing," but none would sign off on it for a real audit. Vanta announced a $99 AI policy pack. CAC from cold founder outreach hit $340. The team kept building because the Week 2 gate was treated as a formality, not a gate. We now have a half-built product, a burned engineer, and no evidence the original hypothesis was ever true.

### What Went Wrong

| Category | Failure Mode | How It Played Out |
|----------|--------------|-------------------|
| Execution | Validation sprint produced soft signals, not hard evidence | Interviews were "positive conversations"; no written auditor acceptance or paid pre-orders. The team interpreted interest as intent. |
| External | Vanta/Drata matched the wedge with a cheap module | Incumbents added a document-only SKU in 4–6 weeks, collapsing perceived differentiation and pricing power. |
| People | Sales-optimism bias reported only the best quotes | Outreach owner highlighted the three consultants who liked it and buried the seven who said "just use Vanta." |
| Technical | MVP scope crept back in during Week 2 | The engineer started building the full multi-framework pipeline before demand was proven, so validation evidence arrived too late to change course. |
| Assumptions | Recurring willingness-to-pay was assumed | Buyers wanted a one-time $349 pack and saw no urgency for an annual review. Renewal intent was never tested with a credit-card pre-commitment. |
| Legal | UPL risk was "disclaimed away" | A disclaimers page was drafted, but no one checked whether the output structure, pricing, and marketing copy still crossed the line into customized compliance advice. |

### Risk Prioritization

| Failure Mode | Likelihood | Impact | Priority |
|--------------|------------|--------|----------|
| Auditor acceptance unproven | High | Existential | 1 |
| Recurring willingness-to-pay unproven | High | Existential | 2 |
| UPL / liability posture weak | Med | Existential | 3 |
| CAC exceeds target | Med | Fatal to unit economics | 4 |
| Vanta/Drata cheap copycat | High | Severe | 5 |

### Top 3 Risks & Mitigations

1. **Risk:** Auditors reject AI-generated first drafts as audit-ready.  
   **Early Warning Signs:** Consultants say "it needs a lot of editing" or refuse to put acceptance in writing.  
   **Prevention:** Frame output as a "starting template" in preview, purchase, and every footer; collect ≥3 written statements by Day 14.  
   **Mitigation:** Kill the multi-framework promise; scope to one vetted baseline and explicit human-review workflow.  
   **Owner:** `sales-ross`

2. **Risk:** Buyers will pay one-time but not annually.  
   **Early Warning Signs:** Pre-orders cluster at Starter; Growth/Scale conversion <1%.  
   **Prevention:** Require paid or committed pre-orders at $599/year or a documented LOI for Growth/Scale.  
   **Mitigation:** Shift to a higher-priced one-time pack if annual renewals fail; de-feature or kill Starter if it cannibalizes >40% of Growth (`docs/ceo/policyforge-decision.md:29`).  
   **Owner:** `sales-ross` / `cfo-campbell`

3. **Risk:** Customized, fee-based policy generation is viewed as unauthorized practice of law.  
   **Early Warning Signs:** Marketing copy uses words like "audit-ready," "compliant," or "certified."  
   **Prevention:** Disclaimers in preview, purchase, footer, dashboard; no policy-editing service; add a $2,500+ "Audit Assist" human-review tier to deflect liability (`docs/ceo/policyforge-decision.md:31-32`, `docs/ceo/policyforge-decision.md:63`).  
   **Mitigation:** Stop all paid transactions and re-position as a static template marketplace if UPL risk cannot be accepted.  
   **Owner:** `cto-vogels` / `ceo-bezos`

### Pre-Mortem Insights

- Soft validation is the enemy. "Sounds interesting" is not evidence. Written acceptance and credit-card commitments are.
- The most dangerous assumption is that a $349 one-time buyer will renew at $599/year. The Week 2 gate must test both.
- If the technical team builds ahead of the gate, the gate is meaningless. Engineering should not touch multi-framework generation until Week 2 is cleared.

### Revised Confidence

Confidence in the original 8-week plan: **low**. Confidence can rise to **moderate** if the Week 2 fatal-flaw bar is fully cleared; it should drop to **no-go** if any single required item is missing.

---

## 2. Fatal-Flaw Bar

By the end of Week 2 (Day 14), the following evidence must be present to continue the 8-week build. Missing any one item is a **fatal flaw**.

1. **Auditor / consultant credibility.** At least 3 active SOC 2 Type I or ISO 27001 auditors or compliance consultants must provide written statements that PolicyForge output, with only light customer editing, is a credible starting point for a first audit, or provide explicit acceptance criteria if it is not (`docs/ceo/policyforge-decision.md:74`; `memories/consensus.md:18`).
2. **Demand signal.** ≥50 qualified waitlist signups **or** ≥3 paid pre-orders / $599/year Growth commitments at the recommended prices (`docs/ceo/policyforge-decision.md:74`; `memories/consensus.md:36`).
3. **Legal posture.** Terms, Privacy, and disclaimer copy are drafted; the product does not certify compliance, edit policies as a service, or hold itself out as legal/compliance advice; UPL risk is reviewed and accepted with mitigations (`docs/ceo/policyforge-decision.md:31-32`; `memories/consensus.md:20`).
4. **CAC sanity.** Paid CAC or estimated channel CAC must be ≤ $150, consistent with the CFO model's unit economics (`docs/ceo/policyforge-decision.md:20`, `docs/cfo/policyforge-financial-model.md:154`, `docs/ceo/policyforge-decision.md:74`).
5. **Pricing A/B signal.** The $349 vs. $399 Starter landing-page test is live with measurable traffic and enough data to choose a winner or declare it a tie (`docs/ceo/policyforge-decision.md:57-65`).
6. **Competitive reality check.** There is a documented view of at least 5 direct or indirect competitors, their pricing/positioning, and a credible answer to whether PolicyForge can win if Vanta/Drata releases a cheap document module (`docs/ceo/prfaq-policyforge.md:89-93`; `docs/critic/policyforge-pre-mortem.md:35-40`).

---

## 3. Evidence Checklist

Use this checklist to collect and score Week 2 evidence. Attach artifacts (email screenshots, Stripe links, landing-page analytics, Terms drafts, competitor table) to the gate review.

| # | Checkpoint | Required Evidence | Owner | Pass / Fail |
|---|------------|-------------------|-------|-------------|
| 1 | ≥3 auditor/consultant statements | Dated written statements (email, LinkedIn message, signed form) from 3+ active SOC 2 / ISO 27001 auditors or consultants. Each must either (a) say output is credible with light editing or (b) list concrete acceptance criteria. Verbal quotes, "sounds good," or internal notes do not count. | `sales-ross` | |
| 2 | ≥50 waitlist signups or ≥3 paid pre-orders | Waitlist: landing-page form with company email + self-reported audit timeline + role; paid pre-orders: Stripe charge or signed commitment for Starter/Growth/Scale at $349/$599/$1,199. No $199 legacy pricing counts. | `sales-ross` / `operations-pg` | |
| 3 | Legal posture review | (a) Terms of Service draft; (b) Privacy Policy draft; (c) disclaimer copy in preview, purchase, footer, dashboard; (d) explicit decision not to certify compliance or edit policies as a service; (e) UPL risk acceptance memo from `ceo-bezos` or responsible agent with mitigations. | `cto-vogels` / `ceo-bezos` | |
| 4 | CAC sanity check | If any paid spend: `CAC = total sales+marketing spend / # paying customers` ≤ $150. If zero paid spend: estimated CAC by channel from comparable campaigns or outreach must be ≤ $150, with assumptions documented. | `sales-ross` / `cfo-campbell` | |
| 5 | Pricing page A/B data | 50/50 traffic split on Starter price ($349 vs. $399). Minimum 200 unique visitors total. Report conversion rate, revenue per visitor, and 95% confidence interval if calculable. Declare winner, tie, or inconclusive. | `sales-ross` / `marketing-godin` | |
| 6 | Competitive reality check | Table of 5 competitors ( incumbent platform, AI-native, template marketplace, consultant substitute, open-source/ChatGPT ) with price, positioning, and channel. Plus answers to: (a) Are we priced inside or below the credible band? (b) What channel do incumbents ignore? (c) What happens if Vanta/Drata launches a $99 pack and how do we survive? | `research-thompson` / `marketing-godin` | |

---

## 4. Pass / Fail Criteria and Scoring Rubric

### Scoring Rubric (0–3 per checkpoint)

| Score | Meaning |
|-------|---------|
| 0 | Missing or fabricated. No artifact. |
| 1 | Weak / anecdotal. One quote, one signup, a draft with major gaps, or an unmeasured guess. |
| 2 | Credible. Written evidence or live data that meets the threshold, with minor caveats. |
| 3 | Bulletproof. Multiple independent sources, live transactions, documented legal review, statistically meaningful A/B data, defensible competitive analysis. |

### Pass / Fail Criteria

| Verdict | Rule |
|---------|------|
| **GO** | Every checkpoint scores **≥2**, and at least 4 of 6 score **3**. All fatal-flaw items are green. |
| **CONDITIONAL GO / EXTEND** | One checkpoint scores **1**, but a recovery plan is documented and can be closed within 2 weeks; all others **≥2**. No checkpoint scores **0**. |
| **NO-GO** | Any checkpoint scores **0**, or two or more checkpoints score **1**, or any fatal-flaw item cannot be cleared by Day 14. |

### Final Score Example

| Checkpoint | Score | Notes |
|------------|-------|-------|
| Auditor statements | ___ / 3 | |
| Waitlist / pre-orders | ___ / 3 | |
| Legal posture | ___ / 3 | |
| CAC sanity | ___ / 3 | |
| Pricing A/B | ___ / 3 | |
| Competitive check | ___ / 3 | |
| **Total** | ___ / 18 | |

---

## 5. NO-GO Recommendation Template

If the fatal-flaw bar is not cleared, fill out this memo and route it to `ceo-bezos`. Do not continue building while the memo is pending.

```markdown
# PolicyForge Week 2 Gate — NO-GO Recommendation

**To:** `ceo-bezos`  
**From:** `critic-munger`  
**Date:** [Day 14 / YYYY-MM-DD]  
**Subject:** PolicyForge Week 2 Validation Gate — NO-GO and Pivot Recommendation

---

## One-Sentence Verdict

**NO-GO:** PolicyForge has not cleared the Week 2 fatal-flaw bar. The 8-week build must be paused and the team should either run a 2-week validation sprint or pivot to the highest-ranked backup idea.

---

## Evidence Scorecard

| Checkpoint | Required | Actual | Score | Status |
|------------|----------|--------|-------|--------|
| Auditor statements | ≥3 written | [X] | [0-3] | [Green / Yellow / Red] |
| Waitlist / pre-orders | ≥50 or ≥3 paid | [X] | [0-3] | |
| Legal posture | Terms + disclaimer + no UPL | [X] | [0-3] | |
| CAC | ≤ $150 | [X] | [0-3] | |
| Pricing A/B | $349 vs $399 data | [X] | [0-3] | |
| Competitive check | 5 competitors + channel plan | [X] | [0-3] | |
| **Total** | | | **__ / 18** | |

---

## Fatal-Flaw Gaps

1. [Gap title]: [What evidence is missing and why it matters.]
2. [Gap title]: [What evidence is missing and why it matters.]
3. [Gap title]: [Optional third gap.]

---

## Why Proceeding Now Would Fail

- [Specific failure scenario tied to missing evidence.]
- [Specific failure scenario tied to missing evidence.]
- [Specific failure scenario tied to missing evidence.]

---

## Recommended Next Action

Option A — **2-week validation sprint** (choose only if at least 3 of 6 checkpoints are yellow and a credible path to green exists):
- Focus only on the failed checkpoints.
- Do not write new product code.
- Re-convene on Day 28. If still not cleared, execute Option B.

Option B — **Pivot to Cycle 1 backup**:
1. Park PolicyForge documentation and code in `projects/policyforge` with a `PAUSED.md` note.
2. Rank the backup ideas from strongest evidence: [FlowSpec / InvoicePipe / ContractSentry / other].
3. Run a 1-week opportunity-discovery sprint on the top backup.
4. Update `memories/consensus.md` with the pivot decision and rationale.

---

## Conditions to Reopen a GO

1. [Specific evidence needed to reopen.]
2. [Specific evidence needed to reopen.]

---

## Closing

Munger: *"Invert, always invert."* The inversion of this plan shows that proceeding without the missing evidence is a bet on hope, not proof. Do not proceed.

**Prepared by:** `critic-munger`  
**Reviewed by:** [agent names]  
**Status:** Final recommendation to `ceo-bezos`
```

---

## References

- `docs/ceo/policyforge-decision.md:10-12` — Conditional GO verdict and 2-week validation sprint.
- `docs/ceo/policyforge-decision.md:57-65` — Launch pricing and 4-week Starter A/B test.
- `docs/ceo/policyforge-decision.md:70-78` — Week 2 gate criteria and fail action.
- `docs/ceo/prfaq-policyforge.md:7, 9, 11` — "auditor-grade" positioning and market context.
- `docs/ceo/prfaq-policyforge.md:47-49` — Original pricing (superseded by Week 2 test at $349/$599/$1,199).
- `docs/ceo/prfaq-policyforge.md:89-93` — Biggest risks listed in PR/FAQ.
- `docs/critic/policyforge-pre-mortem.md:1-79` — Full fatal-flaw analysis, including UPL, auditor acceptance, one-time vs. recurring, and moat risks.
- `memories/consensus.md:18-40` — Open questions and Week 2 gate summary.
