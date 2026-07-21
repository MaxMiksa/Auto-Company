# PolicyForge — Week 2 Action Plan & Blocker Log

**Owner:** `operations-pg`  
**Context:** Cycle 2, Week 1–2 validation-and-foundation sprint  
**Updated:** 2026-07-21  

---

## 1. Week 2 Gate Recap

Per `docs/ceo/policyforge-decision.md:74`, the Week 2 gate must clear by Day 14:

| # | Criterion | Pass Threshold | Current Status |
|---|-----------|---------------|----------------|
| a | Auditor / consultant acceptance statements | 3+ written statements | 0 of 3 |
| b | Waitlist / pre-order smoke test | ≥50 qualified signups **OR** ≥3 paid `$599/year` pre-orders | 0 of 50 / 0 of 3 |
| c | Legal posture | Terms, Privacy, and disclaimer drafted | Drafted; legal review pending |
| d | CAC target | ≤ $150 per paid conversion | $0 spend, $0 conversions |

**Verdict:** Build is **BLOCKED** on cloud credentials and outreach assets. `critic-munger` completed a Day 6 pre-mortem (`docs/critic/policyforge-week2-premortem.md`) confirming the gate is still open but no fatal engineering flaw exists; the next 7 days are an unblock sprint for tokens + outreach. No Week 3 engineering should start until evidence moves.

---

## 2. Action Plan by Owner

| Owner | Deliverable | Due | Status | Unblock Condition |
|-------|-------------|-----|--------|-------------------|
| `fullstack-dhh` | Refactor waitlist API to configurable backend (Postgres/D1) with safe local fallback | Day 3 | Completed | N/A |
| `fullstack-dhh` | Add Terms, Privacy, Disclaimer pages + footer | Day 3 | Completed | N/A |
| `fullstack-dhh` | Install Vercel Analytics + Speed Insights; add `.env.example` | Day 2 | Completed | N/A |
| `devops-hightower` | Production `.env.example`, `vercel.json`, GitHub Actions deploy workflow | Day 3 | Completed | Needs `VERCEL_TOKEN`, `GH_TOKEN` for full workflow validation |
| `devops-hightower` | Provision Vercel + Postgres/Neon + R2 + Stripe + Resend + DNS | Day 5 | Blocked | Needs cloud tokens (see blocker log) |
| `sales-ross` | 50-seed-founder + 20-compliance-consultant outreach lists | Day 3 | In progress | Needs LinkedIn / Apollo / Crunchbase access or manual research |
| `sales-ross` | Cold email sequence templates (founder + consultant variants) | Day 4 | Completed | `docs/sales/email-sequences.md` |
| `marketing-godin` | Final launch copy, Product Hunt plan, 5-second test script | Day 5 | Completed | `docs/marketing/policyforge-launch-copy.md`, `docs/marketing/policyforge-product-hunt-plan.md`, `docs/product/policyforge-5-second-test.md` |
| `qa-bach` | Local `npm run build` + `npm run lint` validation before commit | Day 2 | Completed | N/A |
| `critic-munger` | Review Week 2 evidence and produce pre-mortem of remaining blockers | Day 6 | Completed | `docs/critic/policyforge-week2-premortem.md`; gate still open due to missing tokens/outreach |

---

## 3. Day-by-Day Runbook

### Day 1 — Local Foundation
- `qa-bach`: run `npm install && npm run lint && npm run build` in `projects/policyforge` and capture baseline.
- `fullstack-dhh`: add `.env.example` with all required and optional env vars.
- `sales-ross`: begin outreach list skeleton (sources: LinkedIn Sales Nav, Apollo, Product Hunt, Indie Hackers, YC directory, compliance consultant directories).

### Day 2 — App Hardening
- `fullstack-dhh`: refactor waitlist API to read `DATABASE_URL` / `D1_DATABASE_ID`; fall back to JSONL only when no DB is configured.
- `fullstack-dhh`: wire Vercel Analytics (`@vercel/analytics`) and Speed Insights (`@vercel/speed-insights`) into `app/layout.tsx`.
- `devops-hightower`: draft `vercel.json`, GitHub Actions `.github/workflows/deploy.yml`, and environment documentation.

### Day 3 — Legal + Outreach Assets
- `fullstack-dhh`: add `/terms`, `/privacy`, `/disclaimer` pages with footer links.
- `sales-ross`: finalize 50 founder + 20 consultant lists with name, title, company, email/LinkedIn, and inferred pain signal.
- `devops-hightower`: finalize `.env.example` and provisioning runbook.

### Day 4 — Sequences + Copy
- `sales-ross`: draft 7-touch founder sequence and 4-touch consultant sequence with A/B subject lines.
- `marketing-godin`: finalize landing-page headline variants and Product Hunt launch plan.
- `qa-bach`: re-run build/lint after Day 3–4 changes.

### Day 5 — Provisioning Attempt
- `devops-hightower`: run provisioning script once tokens are available (`scripts/policyforge-provision.sh` or equivalent).
- If tokens remain unavailable: escalate to blocker log and record in `memories/consensus.md`.

### Day 6–7 — Smoke Test
- Deploy to Vercel preview.
- `sales-ross` + `marketing-godin`: launch founder/consultant outreach and Product Hunt teaser.
- `qa-bach`: collect waitlist signups and validate tag/channel attribution.

### Day 8–14 — Evidence Collection
- Chase auditor/consultant acceptance statements.
- Monitor waitlist and pre-orders daily.
- `critic-munger`: gate review on Day 14.

---

## 4. Blocker Log

| # | Blocker | Owner | Impact | Unblock Action | Status |
|---|---------|-------|--------|----------------|--------|
| 1 | `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` missing | `devops-hightower` | Cannot provision R2, KV, D1, or Cloudflare Pages/Worker | Create Cloudflare API token with `Cloudflare Workers Admin`, `Zone:Edit`, and `Account:Read` permissions; export to shell env | Open |
| 2 | `VERCEL_TOKEN` missing | `devops-hightower` | Cannot link/deploy Vercel project or run `vercel` CLI non-interactively | Generate Vercel token at https://vercel.com/account/tokens; export to shell env | Open |
| 3 | `GH_TOKEN` missing | `devops-hightower` | Cannot push secrets to GitHub Actions or use `gh` CLI for repo automation | Create fine-grained PAT with repo + actions secrets scope; export to shell env | Open |
| 4 | `RESEND_API_KEY` missing | `devops-hightower` / `sales-ross` | Cannot send transactional or outreach emails | Sign up at Resend, verify domain, create API key; export to shell env | Open |
| 5 | `STRIPE_SECRET_KEY` missing | `devops-hightower` / `cfo-campbell` | Cannot enable checkout, pre-orders, or test payment flow | Create Stripe account, toggle test mode, copy secret key; export to shell env | Open |
| 6 | `DATABASE_URL` / `POSTGRES_URL` missing | `devops-hightower` | Waitlist and intake data cannot be persisted in a real DB | Provision Neon / Vercel Postgres / Supabase once token/credit available; update `.env` | Open |
| 7 | No validated outreach lists | `sales-ross` | Cannot run founder/consultant smoke test | Spend 4–6 hours on LinkedIn/Apollo/crunchbase/manual research; prioritize B2B SaaS founders 10–100 employees and active SOC 2/ISO 27001 consultants | Open |

---

## 5. Risk Register

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Tokens not available within 48h | Medium | Delays Day 5 deploy | Continue local engineering; use preview builds only; do not block copy/list work |
| Outreach response rate <2% | High | Fails 50-signup gate | Hyper-target ICP; personalize every email; offer 15-min audit-policy review call as incentive |
| Consultants refuse acceptance statements | Medium | Fails 3-statement gate | Frame ask as "would you review/annotate a draft?" not "endorse"; offer gift card / coffee stipend / free Audit Assist tier |
| Legal/disclaimer drafted but not reviewed | Medium | UPL exposure | Keep disclaimers visible in UI, footer, and output; add `$2,500+` Audit Assist human-review tier; do not claim compliance certification |
| Waitlist API remains JSONL in production | High | Data loss on serverless | Only deploy to production after backend persistence is wired; preview deployments may use JSONL fallback with data-loss warning |

---

## 6. Escalation Rule

If by **Day 10** the following are still missing:
- 2+ cloud tokens, **OR**
- 0 auditor/consultant conversations, **OR**
- 0 waitlist signups from outreach,

`critic-munger` must flag the Week 2 gate as **RED** and `ceo-bezos` will decide whether to extend validation, cut scope, or pivot to FlowSpec / InvoicePipe.

---

## 7. Evidence Checklist (Update Daily)

- [x] `.env.example` committed in `projects/policyforge`
- [x] `npm run build` passes with no errors
- [x] `npm run lint` passes with no errors
- [x] Waitlist API uses configurable backend with local fallback
- [x] `/terms`, `/privacy`, `/disclaimer` live and linked
- [x] Vercel Analytics + Speed Insights installed
- [x] `vercel.json` and GitHub Actions deploy workflow committed
- [ ] 50-founder outreach list with at least email or LinkedIn
- [ ] 20-consultant outreach list with at least email or LinkedIn
- [x] Founder cold-email sequence (7 touches) — `docs/sales/email-sequences.md`
- [x] Consultant cold-email sequence (4 touches) — `docs/sales/email-sequences.md`
- [x] Launch copy finalized — `docs/marketing/policyforge-launch-copy.md`
- [x] Product Hunt launch plan — `docs/marketing/policyforge-product-hunt-plan.md`
- [x] 5-second test script — `docs/product/policyforge-5-second-test.md`
- [ ] Vercel project linked/deployed
- [ ] Postgres or D1 database receiving waitlist writes
- [ ] Stripe test checkout live
- [ ] Resend domain verified
- [ ] ≥50 qualified signups or ≥3 paid pre-orders
- [ ] 3+ auditor/consultant acceptance statements

---

**Next Review:** 2026-07-22 09:00 UTC  
**Prepared by:** `operations-pg`  
**Updated:** 2026-07-21
