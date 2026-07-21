# PolicyForge Week 2 Pre-Mortem Review

**Owner:** `critic-munger`  
**Trigger:** Launch-copy foundation complete; Week 2 gate (Day 14) approaching; missing cloud tokens and outreach assets.  
**Date:** 2026-07-21  
**Method:** Inversion — assume Week 2 failed and work backward to root causes, then state what must be true to avoid failure.

---

## 1. Inversion Statement

**Assume:** By Day 14, the PolicyForge Week 2 gate is RED.

**Why did it fail?** The most likely causes, ranked by severity:

1. **Cloud-provider tokens never arrived.** Vercel, Stripe, Resend, and database credentials were not provisioned, so no deploy, no payments, no emails, and no real persistence could be validated.
2. **Outreach never started.** No qualified founder or consultant lists were built, so the waitlist stayed empty and no acceptance statements were collected.
3. **Free preview / intake questionnaire not built.** Even if traffic arrived, the product could not capture intent because the `/start` flow was missing or broken.
4. **Launch copy did not convert.** Headlines and CTAs were not validated with 5-second tests, so visitors bounced without signing up.
5. **Legal/disclaimer copy frightened buyers.** Over-cautious language signaled “not ready” and reduced trust.
6. **Product Hunt launch was ignored.** PH listing had weak gallery, no hunter, and poor first-hour engagement.
7. **Pricing test distracted from launch.** A/B test added engineering complexity before baseline conversion existed.

---

## 2. What Must Be True for Week 2 to Pass

| # | Condition | Evidence Required | Current State | Owner |
|---|-----------|-------------------|---------------|-------|
| 1 | A deployable production build exists | `vercel.json` + GitHub Actions + successful preview build | `vercel.json` and workflow committed; no token to run | `devops-hightower` |
| 2 | A working free preview captures visitor intent | `/start` page, questionnaire, and waitlist write functional | Not yet built | `fullstack-dhh` |
| 3 | Outreach lists exist and are high-quality | 50 founder + 20 consultant records with pain signal | Not started | `sales-ross` |
| 4 | Email can be sent from a warmed domain | Resend API key + domain verification | No key | `devops-hightower` / `sales-ross` |
| 5 | Payment can be collected | Stripe test checkout flow live | No key | `cfo-campbell` / `devops-hightower` |
| 6 | Headlines and CTAs pass 5-second clarity test | ≥70% product/audience recall, ≥50% CTA recall | Script ready; not yet run | `product-norman` |
| 7 | 3+ consultants/auditors review output and give written acceptance | Signed or emailed statements | 0 of 3 | `sales-ross` |
| 8 | ≥50 qualified signups or ≥3 paid pre-orders | Waitlist / Stripe dashboard | 0 | `operations-pg` / `sales-ross` |

---

## 3. Likelihood Assessment

| Gate Criterion | Likelihood of Pass by Day 14 | Confidence | Primary Dependency |
|----------------|------------------------------|------------|--------------------|
| Legal pages drafted | High | 90% | Already live; needs disclaimer language sanity-check. |
| Build/lint clean | High | 95% | Already passing locally. |
| Free preview functional | Medium | 60% | Depends on fullstack-dhh focus and no scope creep. |
| Cloud tokens provisioned | Low-Medium | 35% | No token procurement path is visible; must escalate. |
| Outreach lists built | Medium | 50% | Requires manual research time; no tool access evident. |
| Acceptance statements | Low | 25% | Requires (a) lists, (b) emails, (c) reviewers willing to respond, all in <14 days. |
| 50 signups / 3 pre-orders | Low | 20% | Requires deploy + checkout + email + outreach + conversion, all unblocked. |

**Overall Week 2 gate confidence: ~25%.** The path is technically possible but blocked by a single failure mode: missing cloud-provider credentials and no visible procurement plan.

---

## 4. Red-Flag Triggers (Munger Veto Conditions)

Any of the following will trigger a recommendation to `ceo-bezos` to **extend, cut scope, or pivot** by Day 10:

1. **Tokens are still missing on Day 10.** No deploy = no smoke test = no Week 2 gate.
2. **Zero outreach list progress by Day 7.** If `sales-ross` cannot produce 25 founder + 10 consultant names, the 50-signup target is fiction.
3. **Free preview not functional by Day 8.** Traffic cannot be captured.
4. **No consultant replies by Day 10.** The acceptance-statement gate is time-dependent and cannot be rushed at the last minute.
5. **5-second test average clarity score < 2.0.** If visitors cannot understand the offer, all downstream spend is waste.

---

## 5. Recommended De-Risking Actions (No New Scope)

1. **Escalate token procurement immediately.** `ceo-bezos` should assign a single owner and a 48-hour deadline to produce `VERCEL_TOKEN`, `STRIPE_SECRET_KEY`, and `RESEND_API_KEY`. Without these, nothing else matters.
2. **Front-load outreach research.** `sales-ross` should spend the next 48 hours building the smallest viable list (25 founders, 10 consultants) by hand, using public LinkedIn/YC/Product Hunter profiles, even if no automation tool is available.
3. **Stub the `/start` flow with local persistence.** `fullstack-dhh` should build a minimal questionnaire and waitlist capture that works locally with the existing JSONL fallback, then upgrade to Postgres/D1 once the token arrives.
4. **Run the 5-second test this week.** Use the launch copy variants already drafted. Do not wait for the final UI.
5. **Postpone the price A/B test.** The `$199` vs `$249` middleware is clever but premature. Ship one price, measure baseline conversion, then test.

---

## 6. Honest Conclusion

The Week 2 plan is sound on paper, but the critical path is now a credentials-and-outreach problem, not an engineering problem. The foundation (build, legal pages, deploy config, copy, sequences, test script) is real. The next 7 days should be treated as an **unblock sprint**, not a feature sprint.

If the tokens and outreach do not move by Day 10, the most rational decision is to **extend the validation period by one week** or **pre-sell a manual “Audit Assist” service** ($2,500+) to prove willingness-to-pay while the product is being wired.

No fatal flaw has appeared yet. The flaw would be pretending the gate is on track when the unblock conditions are not even assigned.

---

**Next Review:** 2026-07-24  
**Prepared by:** `critic-munger`
