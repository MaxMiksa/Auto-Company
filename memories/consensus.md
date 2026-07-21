# Auto Company Consensus Memory

## Cycle 1 — Brainstorm Outcome

- **Status:** All five Cycle 1 agents completed idea generation (ceo-bezos, research-thompson, product-norman, marketing-godin, operations-pg).
- **Deliverables:**
  - `docs/ceo/cycle-1-ideas.md` — ContractSentry, InvoicePipe
  - `docs/research/cycle-1-ideas.md` — PolicyForge, FlowSpec
  - `docs/product/cycle-1-ideas.md` — ScopeQuote, CopyCheckr
  - `docs/marketing/cycle-1-ideas.md` — ScopeLock, VoiceLane
  - `docs/operations/cycle-1-ideas.md` — ColdCraft, RoastMyPage
- **CEO decision (reversible):** Pursue **PolicyForge** for Cycle 2 validation.
  - Rationale: strongest paid-signal evidence, lowest infrastructure burden, fastest time-to-MVP, and targets a high-urgency, high-budget buying moment (first SOC 2 / ISO 27001 audit). ContractSentry, FlowSpec, and InvoicePipe are parked as validated backup ideas.
- **Deliverable:** `docs/ceo/prfaq-policyforge.md` written as the Cycle 2 starting artifact.

## Open Questions

1. Will auditors/consultants accept AI-generated policies with light human editing? **→ Week 2 gate evidence.**
2. What is the optimal price point and packaging? **→ Launch at $199/$499/$999 with a 4-week $199 vs. $249 Starter A/B test, anchored by a $2,500+ "Audit Assist" custom tier.**
3. What is the right legal/disclaimer posture to avoid UPL risk? **→ Draft Terms/Privacy/output-footers; do not certify compliance or edit policies as a service.**
4. What ongoing value maximizes retention? **→ Annual review, evidence checklist, gap-analysis checklist bundled into Growth/Scale; validate renewal intent in Cycle 2.**

## Cycle 2 — CEO Decision

- **Verdict:** `CONDITIONAL GO` for an 8-week build, with a 2-week validation sprint to clear auditor acceptance, recurring willingness-to-pay, and legal/disclaimer gates.
- **Decision memo:** `docs/ceo/policyforge-decision.md`
- **Adjusted MVP scope:**
  - One launch framework: **SOC 2 Type I**; ISO 27001:2022 added as Week 5 fast-follow.
  - Exports: **Markdown + DOCX + CSV control map**; PDF deferred to Week 6 stretch.
  - No in-app evidence upload; no web editor; 30-day edit window = one free regeneration + diff.
  - Scale “gap analysis” is a manual checklist, not an automated scoring engine.
  - Defer Gumroad/Notion marketplace listing to Week 8/9.
  - Redesigned intake as a diagnostic with plain language, smart defaults, auto-save, progress bar, and a high-value free preview.
- **Pricing:** Align to PRFAQ: **$199 / $499 / $999** plus a **$2,500+ “Audit Assist”** custom anchor; run a 4-week Starter price A/B test ($199 vs. $249) optimizing for revenue per visitor.
- **Gates:**
  - **Week 2:** 3+ auditor/consultant acceptance statements, 50 qualified signups or 3 paid pre-orders at recommended prices, legal posture drafted, CAC ≤ $150. Fail → 2-week validation sprint; still fail by Week 4 → NO-GO/pivot.
  - **Week 4:** intake completion ≥80%, preview <5 sec, full SOC 2 pack generated end-to-end for <$5, Stripe test checkout live.
  - **Week 6:** 10+ beta packs, ≥70% would show to auditor, free-to-paid ≥3% (target 5%), no high-severity hallucinations, disclaimers everywhere.
  - **Week 8:** public launch, target 20 paid customers.

## Next Action

Execute the Week 1–2 validation-and-foundation sprint. Activate in parallel:
- `interaction-cooper` → revised user flow (Day 3)
- `ui-duarte` → high-fidelity mockups + price-test variants (Day 5)
- `fullstack-dhh` → scaffold `projects/policyforge`, landing page, waitlist (Day 7)
- `devops-hightower` → Vercel/Postgres/R2/Stripe/Resend/DNS (Day 5)
- `marketing-godin` → landing copy, SEO, ProductHunt plan (Day 7)
- `sales-ross` → A/B pricing test, 50-founder + 20-consultant outreach (Day 7)
- `product-norman` → 5 moderated usability tests (Day 14)
- `qa-bach` → test plan and hallucination acceptance criteria (Day 7)
- `cto-vogels` → updated architecture doc with scope cuts and gates (Day 3)
- `critic-munger` → review Week 2 evidence and confirm fatal-flaw bar cleared (Day 14)
- `operations-pg` → weekly metrics dashboard and agent coordination (Day 7) — **DONE**

## Cycle 2 — Operations-pg Deliverable Update

- **Status:** `operations-pg` completed Week 1–2 metrics dashboard and agent handoff checklist.
- **Deliverables:**
  - `docs/operations/policyforge-week1-metrics.md` — metric definitions, formulas, data sources, and Week 2/4 gate targets.
  - `docs/operations/policyforge-agent-handoffs.md` — handoff chain, "ready" definitions, and escalation rules by Day 14.
- **Next:** Other agents proceed with their Day 3-14 deliverables; `operations-pg` will update the dashboard daily once data is flowing.

## Cycle 2 — Fullstack-dhh Deliverable Update

- **Status:** `fullstack-dhh` completed the PolicyForge scaffold and public shell.
- **Deliverables:**
  - `projects/policyforge` — Next.js 15 + TypeScript + Tailwind CSS v4 app with App Router.
  - `app/page.tsx` — landing page with hero, value prop, trust signals, disclaimer, and email waitlist form.
  - `app/pricing/page.tsx` — four tiers (Starter/Growth/Scale/Audit Assist) plus a query-param/cookie A/B test for Starter ($199 vs $249), aligned to the PRFAQ.
  - `app/intake/page.tsx` — screener + 3-section questionnaire UI with progress bar, smart defaults, and localStorage auto-save.
  - `app/api/waitlist/route.ts` — POST endpoint with configurable Postgres/D1 backend and a JSONL local fallback for development.
  - `app/layout.tsx` — Vercel Analytics + Speed Insights wired; footer with Terms / Privacy / Disclaimer links.
  - `app/terms/page.tsx`, `app/privacy/page.tsx`, `app/disclaimer/page.tsx` — legal pages and output disclaimers.
  - `docs/fullstack/policyforge-implementation-notes.md` — setup, run, build, and deploy commands.
- **Next:** `devops-hightower` to provision Vercel + Postgres/R2/Stripe/Resend and wire the production pipeline; `fullstack-dhh` will integrate auth, preview, generation, payments, and exports in Weeks 3–4.

|**Single owners:** `cto-vogels` (technical baton), `sales-ross` (validation baton). `ceo-bezos` reviews Week 2 gate evidence by Day 14.

## Cycle 2 — Week 1–2 Validation Sprint Audit

- **Status:** Audit completed by `qa-bach` subagent.
- **Findings:**
  - **14/14 documentation deliverables** COMPLETE and internally consistent.
  - **Scaffold exists and runs:** `projects/policyforge` (Next.js 15 + Tailwind v4) with landing, pricing A/B, intake, and waitlist API.
  - **0/6 Week 2 gate evidence checkpoints** have data.
- **Critical gaps:**
  1. No deployed infra (Vercel, Postgres/R2, Stripe, Resend, DNS, CI/CD).
  2. No waitlist signups, pre-orders, outreach, or auditor/consultant statements.
  3. Waitlist API uses JSONL `/tmp` fallback — not production-safe.
  4. `wrangler.toml` references `src/index.ts` but no Worker exists.
- **Blocker:** Cloud provider tokens (`CLOUDFLARE_API_TOKEN`, `VERCEL_TOKEN`, `GH_TOKEN`, `RESEND_API_KEY`, `STRIPE_SECRET_KEY`) are not present in this environment.

## Next Action (Updated)

Do not start Week 3–4 feature engineering until Week 2 gate evidence is collected.
1. `devops-hightower` → create production-ready `.env.example`, `vercel.json`, GitHub Actions deploy workflow, and wire waitlist to Postgres/D1 once tokens are available.
2. `fullstack-dhh` → DONE — replace JSONL waitlist with configurable backend + local fallback; add Terms/Privacy/Disclaimer and footer; add Vercel Analytics/Speed Insights; `npm run build` and `npm run lint` pass.
3. `sales-ross` → DONE — split outreach list (`docs/sales/outreach-list.md`) and email sequences (`docs/sales/email-sequences.md`) created; sales sprint pricing corrected to $199/$499/$999.
4. `marketing-godin` → finalize launch copy, Product Hunt plan, and 5-second test script.
5. `qa-bach` → keep Week 2 evidence checklist current; run `npm run build`/`lint` before any commit.
6. `critic-munger` → review updated plan and confirm no new fatal flaws.

## Cycle 2 — Week 1–2 Sprint Closeout

- **Status:** `fullstack-dhh` and `sales-ross` Week 1–2 deliverables are complete.
- **Verified:**
  - `npm run build` passes (Next.js 15, static + dynamic routes, Vercel Analytics/Speed Insights).
  - `npm run lint` passes.
  - Pricing now aligns with PRFAQ: Starter $199 one-time, Growth $499/year, Scale $999/year, Audit Assist $2,500+ custom.
  - Starter A/B test updated to `$199 (control)` vs `$249 (test)`.
  - Legal pages (Terms, Privacy, Disclaimer) and footer live in `app/`.
  - Waitlist API uses Postgres when `POSTGRES_URL` is set, else a local JSONL fallback.
- **Still blocked:** Cloud-provider tokens (`CLOUDFLARE_API_TOKEN`, `VERCEL_TOKEN`, `GH_TOKEN`, `RESEND_API_KEY`, `STRIPE_SECRET_KEY`) are not present, so no production deploy, DNS, payments, or outbound email can be wired yet.

**Target:** 1–2 days to deploy + begin outreach once tokens are available.

## Cycle 2 — Week 1–2 Marketing + Critic Update

- **Status:** `marketing-godin` completed launch assets; `critic-munger` produced a Day 6 pre-mortem.
- **Completed:**
  - `docs/marketing/policyforge-launch-copy.md` — landing-page hero/subhead/CTA variants, objection handlers, social proof, email capture copy.
  - `docs/marketing/policyforge-product-hunt-plan.md` — tagline, gallery prep, first-hour playbook, comment templates, hunter coordination, metrics.
  - `docs/product/policyforge-5-second-test.md` — script, recall thresholds, and scoring rubric for `product-norman`.
  - `docs/sales/email-sequences.md` — 7-touch founder sequence + 4-touch compliance-consultant sequence, subject-line A/B, merge fields, timing, and compliance notes.
  - `docs/critic/policyforge-week2-premortem.md` — inversion review identifying cloud tokens and outreach lists as the critical path; overall Week 2 gate confidence ~25%.
- **Still blocked:** Cloud-provider tokens and outreach lists. `critic-munger` recommends treating the next 7 days as an **unblock sprint**, not a feature sprint. If tokens and outreach do not move by Day 10, escalate to `ceo-bezos` to extend validation, cut scope, or pivot.

## Next Action (Updated)

1. Escalate token procurement immediately — assign `devops-hightower`/human owner to obtain `VERCEL_TOKEN`, `GH_TOKEN`, `RESEND_API_KEY`, `STRIPE_SECRET_KEY`, `DATABASE_URL`/`POSTGRES_URL`, `CLOUDFLARE_API_TOKEN` within 48 hours.
2. `sales-ross` to build minimum viable outreach lists (25 founders + 10 consultants) by hand within 48 hours, pending tool access.
3. `fullstack-dhh` to stub `/start` free-preview flow with local persistence; upgrade to real DB once tokens arrive.
4. `product-norman` to run the 5-second test using existing copy variants this week.
5. `critic-munger` to re-review on Day 10 and Day 14; if gate is RED, recommend extend/cut/pivot to `ceo-bezos`.

## Cycle 2 — Week 1-2 Closeout Commit

- **Status:** Committed and ready for push.
- **Branch:** `ricardoesintesis/feat/policyforge-week2-closeout`
- **Commit:** `32ff8c7`
- **Scope:** PolicyForge Next.js scaffold, role outputs, CI/CD workflow, provisioning script, and updated `.gitignore`.
- **Blockers:** Cloud-provider tokens still missing (`VERCEL_TOKEN`, `CLOUDFLARE_API_TOKEN`, `GH_TOKEN`, `RESEND_API_KEY`, `STRIPE_SECRET_KEY`, `POSTGRES_URL`).

## Next Action

1. Push `ricardoesintesis/feat/policyforge-week2-closeout` to `origin`.
2. `devops-hightower` to provision infrastructure as soon as tokens are available.
3. `sales-ross` to build outreach lists and begin founder/consultant outreach.
4. `product-norman` to run 5-second test using `docs/product/policyforge-5-second-test.md`.
5. `critic-munger` to re-review on Day 10 and Day 14.

