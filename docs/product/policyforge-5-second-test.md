# PolicyForge 5-Second Test Script

**Owner:** `product-norman`  
**Status:** Ready to run (unmoderated or live intercept)  
**Last updated:** 2026-07-21

---

## 1. Test Goal

Measure first-impression clarity of the PolicyForge landing page: can a visitor understand what the product does, who it is for, and what to do next after only 5 seconds of exposure?

---

## 2. Target Participants

- **Primary:** Seed-stage B2B SaaS founders, CTOs, or operations leads who have SOC 2 / ISO 27001 on their roadmap.
- **Secondary:** Engineering managers at 10–100 person SaaS companies.
- **Sourcing:** Indie Hackers, r/SaaS, LinkedIn founder networks, waitlist, UserTesting.com, or $25 Amazon-gift-card intercepts.
- **Sample size:** 15–20 participants for a first-pass qualitative signal; 50+ for statistically stable click-rate confidence.

---

## 3. Test Environment

- Show the landing page hero section only (above the fold) for **exactly 5 seconds**.
- Hide navigation, footer, and pricing details unless they appear above the fold.
- Use the control headline and subhead from `docs/marketing/policyforge-launch-copy.md` Section 2A unless running an A/B variant.
- Record the exact headline variant shown.

---

## 4. Five Test Questions

Ask these in this order, without letting participants revisit the page:

1. **What is this product or service?**  
   *(Open-ended; capture words/phrases used.)*

2. **Who is it for?**  
   *(Open-ended; look for “startups,” “founders,” “SOC 2,” “SaaS.”)*

3. **What is the main benefit or outcome?**  
   *(Open-ended; look for “policies,” “SOC 2,” “ISO 27001,” “audit,” “fast/cheap.”)*

4. **What would you click or do next?**  
   *(Open-ended; look for CTA recall: “Generate your policy pack,” “See free preview,” etc.)*

5. **How much does it cost?**  
   *(Open-ended; check whether price signal was absorbed. Accept “from $199,” “$199,” “$499/yr,” or “didn’t see price.”)*

---

## 5. Scoring Rubric

For each participant, score responses on a 0–3 scale:

| Score | Description |
|-------|-------------|
| 0 | No relevant idea / completely wrong |
| 1 | Partial or vague signal (e.g., “something about compliance”) |
| 2 | Correct domain + one key detail (e.g., “compliance policies for startups”) |
| 3 | Correct product, audience, and outcome (e.g., “SOC 2 policy generator for SaaS startups, $199”) |

### Success Thresholds

- **Overall clarity pass:** average score ≥ 2.0 across all five questions.
- **Headline clarity pass:** ≥ 70% of participants can state the product and audience correctly from the headline/subhead alone.
- **CTA recall pass:** ≥ 50% remember the primary CTA.
- **Price recall pass:** ≥ 40% recall a price point or “starts at $199.”

If any pass fails, revise the corresponding element and re-test.

---

## 6. Variant Testing Plan

Run separate 5-second tests for each headline variant in `policyforge-launch-copy.md`:

| Variant | Headline | Hypothesis |
|---------|----------|------------|
| A | `SOC 2 policy pack in an afternoon.` | Outcome-focused wording drives strongest benefit recall. |
| B | `Stop writing SOC 2 policies from scratch.` | Pain-led wording resonates with active audit prep. |
| C | `The first thing your auditor asks for? Already done.` | Audit framing improves perceived urgency. |
| D | `Compliance docs you won’t hate.` | Founder tone may increase CTA curiosity. |

### Method
- Randomly assign participants to one variant.
- Keep sample balanced (≥ 10 per variant).
- Compare scores and qualitative themes.
- Winning variant becomes Week 2 landing page control.

---

## 7. Moderator Notes

- Do not explain the product before showing the page.
- Do not let participants scroll or click during the 5 seconds.
- Ask questions in a neutral tone; avoid leading.
- Record exact wording used; group themes afterward.
- Note distractions or confusions (e.g., “I thought it was legal software,” “I don’t know what SOC 2 is”).

---

## 8. Analysis Template

| Participant | Variant | Q1 Score | Q2 Score | Q3 Score | Q4 Score | Q5 Score | Key Verbatim | Confusion |
|-------------|---------|----------|----------|----------|----------|----------|--------------|-----------|
| P1 | A | 2 | 3 | 2 | 1 | 0 | “Looks like a policy generator” | Didn’t notice CTA or price |
| P2 | B | 3 | 2 | 3 | 2 | 1 | “Stop writing from scratch — that’s me” | Price unclear |

Summarize by variant and overall.

---

## 9. Next Actions

1. `ui-duarte` to lock hero design and headline variant A as baseline before testing.
2. `product-norman` to recruit 15–20 participants and run 5-second sessions.
3. `operations-pg` to compile scores and choose the winning headline/CTA combination.
4. `marketing-godin` to apply winning copy to landing page and Product Hunt listing.
5. `qa-bach` to add 5-second test results to Week 2 evidence checklist.
