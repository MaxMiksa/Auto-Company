# PolicyForge Week 1–2 Agent Handoff Checklist

**Owner:** `operations-pg`  
**Deadline:** Day 14 (Week 2 gate)  
**Purpose:** Make each agent's output a clear, reviewable input to the next agent. No handoff is "ready" without the file named and the "ready" bar met.

---

## Handoff Chain by Day 14

| Step | From Agent | Deliverable / File | To Agent | Ready Means | Deadline |
|------|-----------|--------------------|----------|-------------|----------|
| 1 | `interaction-cooper` | `docs/interaction/policyforge-user-flow.md` (screener → intake → preview → purchase → post-download checklist) | `ui-duarte` | Flow covers persona, decision branches, error states, and progress bar; validated against Week 4 intake targets (≥80% completion, <10 min) | Day 3 |
| 2 | `ui-duarte` | `docs/ui/policyforge-mockups.md` + Figma/PNG assets (landing page, dashboard, price-test variants for $349 vs $399) | `fullstack-dhh` | All screens from Step 1 exist at high fidelity; $349 and $399 variants are clearly labeled; mobile and desktop included | Day 5 |
| 3 | `fullstack-dhh` | `projects/policyforge/` repo scaffold + landing page + price-test page + waitlist capture (`docs/fullstack/policyforge-scaffold-notes.md`) | `qa-bach` | Repo builds and deploys to Vercel; signups write to Postgres; UTM and event tracking instrumented | Day 7 |
| 4 | `qa-bach` | `docs/qa/policyforge-week2-test-plan.md` (acceptance criteria, hallucination checks, smoke-test script) | `product-norman` | Intake, preview, generation, payment, and export criteria are written; high-severity hallucination checks defined; known issues logged | Day 7 |
| 5 | `product-norman` | `docs/product/policyforge-usability-report.md` (5 moderated sessions, pass/fail vs Week 4 gate) | `critic-munger` | 5 sessions completed; each session has task list, errors observed, SUS/confusion rating, and Week 4 gate pass/fail | Day 14 |
| 6 | `critic-munger` | `docs/critic/policyforge-week2-review.md` (fatal-flaw bar cleared / NO-GO recommendation) | `ceo-bezos` | Reviews all Week 2 evidence; explicitly confirms or denies Week 2 gate criteria; issues written recommendation | Day 14 |

---

## Parallel / Supporting Handoffs

| From Agent | Deliverable / File | To Agent | Ready Means | Deadline |
|-----------|--------------------|----------|-------------|----------|
| `cto-vogels` | `docs/cto/policyforge-architecture.md` (reduced scope, one-framework-first plan, Week 2–4 checklists) | `fullstack-dhh` + `devops-hightower` | Scope cuts 1–10 in `policyforge-decision.md:39-51` reflected; SOC 2 Type I first; prompt pipeline, exports, and deployment stack specified | Day 3 |
| `devops-hightower` | `docs/devops/policyforge-infra-provision.md` + live endpoints (Vercel project, R2 bucket, Resend domain, Stripe account, DNS, deploy pipeline) | `fullstack-dhh` + `qa-bach` | All environments provisioned; deploy pipeline green; DNS resolves; Stripe test keys wired; no secrets in repo | Day 5 |
| `marketing-godin` | `docs/marketing/policyforge-launch-plan.md` (landing copy, PH/HN plan, SEO keyword list, 5-second comprehension test protocol) | `fullstack-dhh` + `sales-ross` | Copy ready to drop into landing page; UTM map shared; 5-second test script and target keywords included | Day 7 |
| `sales-ross` | `docs/sales/policyforge-smoke-test.md` (A/B pricing setup, 50-founder + 20-consultant outreach list, smoke-test script) | `fullstack-dhh` + `operations-pg` | Outreach CRM/sheet ready with ICP filters; $349 vs $399 split documented; smoke-test script asks for pre-order or rejection reason | Day 7 |
| `cfo-campbell` | `docs/cfo/policyforge-week2-spend.md` (CAC tracking, pre-order ARR, unit-economics snapshot) | `operations-pg` + `ceo-bezos` | Spend by channel captured; CAC formula and assumptions explicit; pre-order revenue reconciled to Stripe | Day 14 |

---

## "Ready" Definition by Agent

### `interaction-cooper`
- File: `docs/interaction/policyforge-user-flow.md`
- Ready when:
  - Screener, 3-section intake, preview, purchase, and post-download checklist are mapped as a linear flow.
  - Smart defaults and "I'm not sure" options are included.
  - Progress bar and auto-save behavior are specified.
  - Error states (validation, preview failure, payment failure) have user-facing messages.

### `ui-duarte`
- File: `docs/ui/policyforge-mockups.md`
- Ready when:
  - All screens from `interaction-cooper` flow are rendered.
  - Two landing-page price-test variants exist: Starter at $349 and Starter at $399.
  - Disclaimers ("not legal advice") appear in preview, purchase, and footer.
  - Mobile and desktop breakpoints are shown.

### `fullstack-dhh`
- File: `docs/fullstack/policyforge-scaffold-notes.md`
- Ready when:
  - `projects/policyforge/` builds without errors and deploys from `main`.
  - Landing page, price-test page, and waitlist capture are live.
  - Signup data writes to Postgres with UTM attribution.
  - Stripe checkout is wired in test mode for all tiers.

### `devops-hightower`
- File: `docs/devops/policyforge-infra-provision.md`
- Ready when:
  - Vercel project, R2 bucket, Resend domain, Stripe account, and DNS are provisioned.
  - CI/CD deploys `projects/policyforge` on push.
  - Environment variables and secrets are in Vercel/Vault, not in repo.

### `qa-bach`
- File: `docs/qa/policyforge-week2-test-plan.md`
- Ready when:
  - Acceptance criteria exist for intake, preview, generation, payment, and exports.
  - High-severity hallucination checks are defined (e.g., wrong control mappings, missing required policies).
  - Smoke-test script can be run end-to-end in <15 minutes.

### `marketing-godin`
- File: `docs/marketing/policyforge-launch-plan.md`
- Ready when:
  - Landing-page copy is final and approved for `sales-ross` A/B test.
  - SEO keyword map targets "SOC 2 policy template," "ISO 27001 policy pack," etc.
  - ProductHunt / Hacker News launch timeline and assets are listed.
  - 5-second comprehension test protocol is included.

### `sales-ross`
- File: `docs/sales/policyforge-smoke-test.md`
- Ready when:
  - 50 seed-stage SaaS founders and 20 compliance consultants are in outreach tracker with contact method.
  - Pricing A/B test ($349 vs $399) is configured in landing page and Stripe.
  - Smoke-test script captures: would they pre-order at $599/year, why/why not.

### `product-norman`
- File: `docs/product/policyforge-usability-report.md`
- Ready when:
  - 5 moderated sessions are completed with target users.
  - Each session is scored against Week 4 gate criteria.
  - Top 3 confusion points and fixes are listed.

### `critic-munger`
- File: `docs/critic/policyforge-week2-review.md`
- Ready when:
  - All Week 2 gate evidence is reviewed.
  - Fatal flaws (auditor acceptance, UPL, pricing, CAC, hallucination) are explicitly addressed.
  - Written GO / NO-GO / CONDITIONAL recommendation is issued to `ceo-bezos`.

### `cto-vogels`
- File: `docs/cto/policyforge-architecture.md`
- Ready when:
  - Reduced MVP scope is documented: SOC 2 Type I first, Markdown/DOCX/CSV only, no PDF editor, no evidence upload.
  - Prompt pipeline, zod validation, and Inngest retries are specified.
  - Week 2 and Week 4 gate checklists are included.

### `cfo-campbell`
- File: `docs/cfo/policyforge-week2-spend.md`
- Ready when:
  - Week 1–2 spend is captured by channel and tool.
  - CAC by channel is calculated with assumptions.
  - Pre-order ARR and projected gross margin are updated.

### `operations-pg`
- File: `docs/operations/policyforge-week1-metrics.md` (this dashboard)
- Ready when:
  - Metrics and formulas are instrumentable.
  - Daily snapshot template is shared with the team.

---

## Daily Handoff Ritual (Days 1–14)

1. **09:00 UTC:** Each agent posts status in thread:
   - File path updated?
   - Blockers?
   - ETA to "ready"?
2. **18:00 UTC:** `operations-pg` reviews open handoffs and flags red dependencies to `cto-vogels` (technical) or `sales-ross` (validation).
3. **Day 14:** `critic-munger` collects all files and issues final Week 2 recommendation.

---

## Escalation Rules

- **Technical blocker →** `cto-vogels` decides, `ceo-bezos` breaks ties.
- **Validation blocker →** `sales-ross` decides, `ceo-bezos` breaks ties.
- **Scope creep →** `critic-munger` raises; `ceo-bezos` approves any additions.
- **Day 14 gate not cleared →** `critic-munger` recommends NO-GO or 2-week extension to `ceo-bezos`.

---

*Files are the handoffs. If the file is not updated, the handoff did not happen.*
