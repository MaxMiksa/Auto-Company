# PolicyForge — Architecture & 8-Week Build Plan

**Author:** `cto-vogels` (Werner Vogels persona)  
**Status:** Cycle 2 architecture deliverable  
**Scope:** 8-week MVP for a single full-stack engineer, monolith-first, serverless-friendly.

---

## 1. Technical Constraints & Business Requirements

### Constraints
- **One full-stack engineer, 8 weeks.** Nothing gets built that needs a second pair of hands.
- **No ops team.** You build it, you run it. Everything must be deployable from `git push`.
- **No Kubernetes, no custom LLM hosting, no bespoke data pipeline.** We are not in the business of operating infrastructure before we have revenue.
- **Serverless-by-default.** Pay per use, auto-scale to zero, and let the provider handle uptime.
- **US/EU customers from day one.** Data flow and storage choices must not paint us into a GDPR corner.

### Business Requirements
| Requirement | Source / Why |
|-------------|--------------|
| Generate 15–25 SOC 2 Type I policies + control-mapping CSV + evidence checklist at launch; ISO 27001:2022 fast-follow in Week 5 | PR/FAQ, customer promise; reduced MVP scope |
| Support SOC 2 Type I at launch; ISO 27001:2022 fast-follow in Week 5 | CEO decision, reduced MVP scope |
| Free preview of one policy; full pack gated by purchase | Conversion mechanic in PR/FAQ |
| Output as Markdown, DOCX, and CSV control map; PDF optional/fallback | CEO decision, reduced MVP scope; PDF deferred to Week 6 stretch |
| $349 Starter (one-time), $599/year Growth, $1,199/year Scale, plus $2,500+ “Audit Assist” anchor | CEO pricing decision |
| 30-day edit window = one free regeneration + diff/changelog; annual refresh hook | Retention and renewal value |
| 20 paid customers in the first 8 weeks, free-to-paid ≥ 3% (target 5%) | Cycle 2 success metrics |
| Operating cost per generated pack < $5 | Unit-economics guardrail |
| Not legal advice; clear disclaimer in app and output | Liability / UPL risk |

### Non-Functional Requirements
- **Blast radius containment:** a failure in generation must not corrupt billing, auth, or already-delivered packs.
- **Idempotency:** duplicate Stripe webhooks or retrying LLM calls must not double-charge or double-generate.
- **Recoverability:** generation jobs survive API rate limits, timeouts, and transient LLM failures.
- **Observability from day one:** every generation job, payment, and export leaves a trace we can query in under 60 seconds.

---

## 2. Data-Flow Diagram

```mermaid
graph TD
    U[Customer Browser]
    V[Vercel Edge / Next.js App Router]
    A[Next.js API Routes / Serverless Functions]
    P[(Vercel Postgres)]
    R2[Cloudflare R2 — Generated Packs]
    Q[Inngest Job Queue]
    L[Anthropic Claude API]
    S[Stripe]
    RS[Resend — Email]

    U -->|1. Submit questionnaire / preview request| V
    V -->|2. Render UI / call API| A
    A -->|3. Store answers & metadata| P
    A -->|4. Enqueue generation job| Q
    Q -->|5. Trigger async worker| A
    A -->|6. Prompt templates + stack data| L
    L -->|7. Policy text / control map| A
    A -->|8. Generate Markdown, DOCX, CSV control map (PDF optional)| R2
    A -->|9. Update pack status & signed URL| P
    A -->|10. Email customer| RS
    A -->|11. Webhook: checkout/payment| S
    S -->|12. Subscription status| A
    U -->|13. GET signed URL / download| A
    A -->|14. Serve file from R2| U
```

### Key Flow Notes
- **Preview path (one policy):** synchronous. The API calls Claude with a short prompt and returns Markdown in < 5 seconds.
- **Full-pack path:** asynchronous. The API returns `202 Accepted` with a `packId`; the customer polls a `/status` endpoint or receives an email.
- **Paywall:** full-pack generation is only enqueued after Stripe confirms payment. Subscriptions (Growth/Scale) are checked at download time.
- **Retry loop:** Inngest retries LLM calls with exponential backoff and dead-letters jobs that fail after 5 attempts.
- **No in-app evidence upload:** intake is a diagnostic questionnaire only; the gap-analysis checklist points users to evidence they must collect outside the app.

---

## 3. Recommended Boring-Technology Stack

| Layer | Choice | Rationale |
|-------|--------|-----------|
| **App / API** | Next.js 15 (App Router) + TypeScript on Vercel | One language across UI, API, and job workers; edge deployment; git-push CI/CD; boring because millions of apps already run on it. |
| **ORM / DB access** | Drizzle ORM + Vercel Postgres (Neon) | Serverless-native, type-safe, no connection-pool headaches; Postgres is the most boring database on earth. |
| **Object storage** | Cloudflare R2 | S3-compatible, cheap ($0.015/GB), no egress fees between Cloudflare and R2, signed URLs for downloads. |
| **Job queue** | Inngest | Runs inside the same Next.js deploy, handles retries/scheduling/fan-out without a worker fleet. Keeps the codebase a monolith. |
| **Auth** | Auth.js (NextAuth v5) with Resend magic links | No passwords to leak; email is the identifier; fits the low-friction self-serve motion. |
| **Payments** | Stripe Checkout + Customer Portal + webhooks | Boring, global, handles tax/VAT via Stripe Tax when we need it. |
| **Email** | Resend | Free tier covers early volume; purpose-built for transactional email. |
| **LLM** | Anthropic Claude API (Haiku for preview, Sonnet for full packs) | Best-in-class long-form document quality; structured output via `tool_use` / JSON mode. |
| **Documents** | `docx` (DOCX), native Markdown, CSV control map, `md-to-pdf` + `puppeteer-core` (PDF optional/fallback) | Markdown, DOCX, and CSV are required at launch; PDF is a Week 6 stretch/optional fallback. |
| **Monitoring** | Vercel Analytics + Inngest dashboard + Sentry (free tier) | One engineer cannot run a Prometheus stack. Start with managed observability. |

### Why Not…
- **Supabase/Firebase:** Less portable; PolicyForge owns the data layer and must be able to migrate or self-host later.
- **LangChain / LlamaIndex:** Adds abstraction tax we do not need. Prompt templates are plain TypeScript functions.
- **Kubernetes / ECS:** We have zero customers. A serverless function is enough.
- **Self-hosted LLM:** The inference cost and ops burden exceed the API cost for the first 1,000 customers.

---

## 4. Key Failure Modes & Mitigations

| Failure | Blast Radius | Mitigation |
|---------|--------------|------------|
| **LLM call times out or gets rate-limited** | Generation job stalls | Wrap calls in Inngest; exponential backoff; break pack into per-policy steps; dead-letter after 5 retries with customer-visible error and refund path. |
| **LLM hallucinates policy content** | Auditor rejects, support burden, reputation | Seed prompts with vetted baselines, force structured outputs, run a zod schema validation, and prepend a disclaimer that human review is required. |
| **Duplicate Stripe webhooks** | Double access, revenue leakage | Idempotency: store `stripe_event_id` and ignore duplicates; use `customerId` + `packId` composite keys. |
| **Generation completes but file upload to R2 fails** | Pack appears “done” but is empty | Treat upload as part of the same Inngest step; if upload fails the whole step retries; do not mark `status=ready` until R2 returns an ETag. |
| **Database connection exhaustion** | API 500s | Use Drizzle with Neon serverless driver; set `max_connections` low; keep transactions short. |
| **Customer submits secrets or raw credentials in the intake form** | Compliance / legal liability | Form validation rejects credential-looking strings; field labels explicitly say “configuration answers only”; terms of service prohibit credential submission; no in-app evidence upload in MVP. |
| **LLM output leaks into logs or error pages** | Data exposure | Never log raw prompts or full responses; log only job IDs, token counts, and status codes. |
| **Vercel function cold start > preview SLA** | Free preview feels slow | Keep preview function lightweight; cache hot framework templates in memory; use Haiku for preview. |

---

## 5. 8-Week Build Plan (Single Full-Stack Engineer)

### Week 1 — Foundation
- Vercel project + Postgres + R2 buckets set up.
- Drizzle schema: `users`, `questionnaires`, `packs`, `packFiles`, `jobs`, `payments`, `subscriptions`.
- Auth.js magic-link flow wired to Resend.
- Hello-world API route and landing page stub.

### Week 2 — Intake & Data Model
- Simplified intake: one-screen screener + 3 progressive sections, plain language, smart defaults, auto-save, progress bar; target 10–15 minutes.
- Replace “subprocessors” with “Tools and vendors your company uses”.
- API: `POST /api/v1/questionnaires`, `GET /api/v1/questionnaires/:id`.
- Validation and sanitization of inputs; reject credential-looking strings.
- Data retention flags and deletion API.
- **Closes with the Week 2 Validation Gate (see `policyforge-week2-4-gates.md`).**

### Week 3 — LLM Pipeline (Preview)
- Prompt-template bank for SOC 2 Type I baseline; stage ISO 27001:2022 templates for Week 5 fast-follow.
- Synchronous preview endpoint: `POST /api/v1/packs/preview` → one stack-sensitive Markdown policy (Information Security or Access Control).
- Use Claude Haiku for speed; validate output with zod.
- Render preview in browser and gather metrics (time, tokens, satisfaction).

### Week 4 — Full-Pack Generation
- Async generation flow with Inngest: split pack into per-policy steps + control-mapping step + export step.
- Claude Sonnet for full-pack policies.
- Markdown, DOCX, and CSV control map export; PDF as HTML-to-PDF fallback (Week 6 stretch).
- End-to-end SOC 2 Type I pack generates for < $5 per pack, all outputs downloadable.
- Store files in R2 and update `packFiles` table with signed URLs.
- **Closes with the Week 4 Product-Technical Gate (see `policyforge-week2-4-gates.md`).**

### Week 5 — Payments, Paywall & ISO Fast-Follow
- Stripe Checkout for Starter ($349 one-time), Growth ($599/year) and Scale ($1,199/year) subscriptions; $2,500+ “Audit Assist” anchor tier listed.
- `POST /api/v1/packs/:id/generate` checks payment before enqueuing.
- Stripe webhook handler for `checkout.session.completed` and `invoice.paid`.
- Customer dashboard: list packs, status, download button, 30-day edit window.
- ISO 27001:2022 framework added as Week 5 fast-follow if Week 2/4 gates clear.

### Week 6 — Async Polish, Notifications & Edit Window
- Email notifications: pack ready, payment receipt, annual refresh reminder.
- Job status polling endpoint and UI (`GET /api/v1/packs/:id/status`).
- Retry/dead-letter handling; manual re-generation button.
- 30-day edit window: one free regeneration from saved questionnaire + redline Markdown diff/changelog; no in-place web editor.
- Scale tier gap analysis: manual checklist/report in dashboard and CSV (not an automated score).
- Optional PDF export stretch, if time permits.

### Week 7 — Security, Compliance & Hardening
- TLS, row-level access enforcement, and signed URL expiry (1 hour default).
- Input sanitization, rate limiting, and basic abuse detection.
- GDPR export/delete flows; terms/privacy/disclaimer pages.
- Sentry integration and Vercel log drains.

### Week 8 — Launch Prep & Ship
- SEO landing pages for “SOC 2 policy template”; ISO 27001 page as Week 5 fast-follow.
- ProductHunt / Hacker News launch checklist.
- Analytics events (sign-up, preview, purchase, download, auditor acceptance survey).
- Gumroad/Notion template marketplace listing as a Week 8/9 distribution experiment, not core MVP.
- Launch to production, monitor, and hotfix.

---

## 6. Estimated Monthly Operating Cost

### Assumptions
- Preview uses Claude Haiku (~$0.05 each).
- Full pack uses Claude Sonnet with prompt-cached baselines (~$1.50–$3.00 per pack depending on length).
- Markdown/DOCX/CSV export is compute-cheap; optional PDF adds ~$0.10 per render if using a browserless path.
- R2 storage is dominated by generated packs (1–3 MB each).

### Cost Table
| Component | At Launch (beta) | At 1,000 Customers |
|-----------|------------------|--------------------|
| Vercel Pro | $20 | $20–$50 (functions + bandwidth) |
| Vercel Postgres | $0–$20 | $20–$50 |
| Cloudflare R2 | $0–$1 | $10–$25 |
| Inngest | $0 (free tier) | $0–$20 |
| Resend email | $0–$5 | $10–$30 |
| Anthropic API | ~$50 (dev + early users) | ~$200–$500 |
| Sentry / monitoring | $0 (free tier) | $0–$20 |
| Domain / DNS | ~$10 | ~$10 |
| **Total estimated** | **~$80–$110/mo** | **~$270–$705/mo** |

### Unit Economics
- At 1,000 customers and ~100 full packs generated per month, total op cost of ~$500 implies **~$5/pack**.
- This meets the PR/FAQ guardrail; the actual target should be driven closer to **$2–$3/pack** by:
  - Using Haiku for first drafts and Sonnet only for final polish.
  - Caching common baseline prompts.
  - Batching generation where rate limits allow.
- Stripe processing fees are COGS, not infra, and sit outside this estimate.

---

## 7. Security, Privacy & Compliance Considerations

PolicyForge handles **confidential business information** (stack descriptions, vendor/tool lists, team size, cloud providers) but **must never accept credentials, access tokens, or raw secrets**. Treat customer data as a liability to minimize.

### Data Handling
- **Classification:** stack descriptions = confidential; credentials = forbidden.
- **Encryption in transit:** TLS 1.3 for all traffic.
- **Encryption at rest:** Vercel Postgres / Neon TDE; R2 default encryption. For defense in depth, encrypt the questionnaire JSON column with a per-tenant key derived from a master secret (e.g., `AES-256-GCM`).
- **Access control:** every read/write is gated by the authenticated `userId`; no shared or public pack URLs without signed, time-limited tokens.
- **Retention:** delete questionnaire answers and generated files on account deletion; retain minimal billing/invoice records as required by law.
- **Logs:** log IDs, statuses, and token counts, never full prompts or policy text.

### Third-Party AI
- **No model training on customer data:** Anthropic API data is not used to train models by default; document this in the privacy policy and terms.
- **Zero LLM prompt retention:** where possible, use the API without allowing Anthropic to retain inputs for safety review; otherwise disclose retention in terms.
- **Region awareness:** route EU customers through EU-available infrastructure tiers when Vercel/Anthropic support them; sign Standard Contractual Clauses (SCCs) where required.

### Compliance Posture
- **GDPR / CCPA:** provide data export and deletion; collect only what is needed for generation; do not sell data.
- **SOC 2 readiness:** we should dogfood PolicyForge output for our own security policies but not claim SOC 2 compliance until audited.
- **Legal disclaimer:** every generated document header states it is a starting template, not legal advice, and must be reviewed by the customer’s auditor / counsel.
- **UPL mitigation:** do not offer “audit certification,” do not edit policies for customers as a service, and keep all “advice” in the form of template text.

---

## 8. API-First Design Notes & Future Extension Points

### REST API Surface (v1)
| Resource | Endpoints | Purpose |
|----------|-----------|---------|
| `questionnaires` | `POST`, `GET`, `PUT` | Capture and update customer stack / framework inputs |
| `packs` | `POST /preview`, `POST`, `GET`, `GET /status` | Generate and retrieve policy packs |
| `packFiles` | `GET /:packId/files/:fileId` | Download Markdown/DOCX/CSV with signed URL; PDF optional/fallback |
| `subscriptions` | `GET`, `POST /portal` | Check entitlements and Stripe Customer Portal |
| `webhooks` | `POST /stripe`, `POST /ingest` | Billing and async job hooks |

### API-First Rules
- **Version in URL:** `/api/v1/...`. No breaking changes within v1.
- **Content negotiation:** Markdown and JSON by default; file downloads via `?format=docx|csv|pdf` (PDF optional/fallback).
- **Idempotency:** `Idempotency-Key` header for `POST` operations; Stripe webhooks keyed by event ID.
- **Structured LLM responses:** use Anthropic `tool_use` to return deterministic JSON, not free-form parsing.

### Future Extension Points
1. **Batch import / partner API:** allow consultants to upload a CSV of clients and generate packs programmatically.
2. **Framework expansion:** ISO 42001, GDPR Article 32, HIPAA Security Rule are new prompt-template modules; no DB schema change.
3. **Gap analysis (Scale tier):** manual checklist/report in the CSV/dashboard for users in MVP. A `POST /api/v1/gaps` automated scoring endpoint remains a future API, not MVP.
4. **Evidence checklist API:** `GET /api/v1/packs/:id/evidence` maps each policy to required evidence artifacts.
5. **Annual refresh:** scheduled Inngest function re-runs generation from the latest questionnaire and produces a redline.
6. **Integrations:** webhooks to Vanta/Drata/Secureframe for policy import; OAuth2 for partner marketplaces.
7. **White-label / reseller API:** separate API keys and tenant isolation become a future concern, so keep `tenantId` out of primary keys today but reserve a nullable column.

---

## 9. Week 2 & Week 4 Validation Gates

Full checklists (with owners and supporting inputs) are in [`policyforge-week2-4-gates.md`](./policyforge-week2-4-gates.md). The pass/fail bars below are extracted directly from `docs/ceo/policyforge-decision.md`.

| Gate | Deadline | Pass Criteria | Fail Action |
|------|----------|---------------|-------------|
| **Week 2 — Validation Gate** | End of Week 2 | (a) 3+ written statements from active SOC 2 / ISO 27001 auditors or compliance consultants that AI-generated first drafts with light editing are acceptable (or explicit acceptance criteria if not); (b) landing-page smoke test shows ≥50 qualified signups or ≥3 paid pre-orders / $599/year commitments at recommended prices; (c) Terms, Privacy, and disclaimer posture drafted and UPL risk accepted; (d) target CAC ≤ $150. | Pause build; run a 2-week validation sprint. If still not cleared by Week 4, **NO-GO** and pivot to FlowSpec or InvoicePipe. |
| **Week 4 — Product-Technical Gate** | End of Week 4 | (a) Intake completion rate ≥ 80%, median time < 10 min; (b) preview endpoint generates one stack-sensitive policy + partial control map in < 5 sec; (c) full SOC 2 Type I pack generates end-to-end, cost < $5 per pack, all outputs downloadable; (d) Stripe checkout live in test mode, dashboard lists packs and status; (e) no critical security/privacy gaps. | Cut more scope or extend Week 5/6; if core generation or payment cannot be made reliable, **NO-GO**. |

---

## Bottom Line

PolicyForge is a document-generation monolith, not a compliance platform. Build it on the stack the PR/FAQ already named: **Next.js + Vercel + Postgres + R2 + Stripe + Resend + Claude**, orchestrated with **Inngest** so one engineer can ship it in 8 weeks. The biggest architectural risks are not scale — they are **LLM reliability**, **payment idempotency**, and **data privacy**. Mitigate those with retries, idempotency keys, signed URLs, and a “starting template, not legal advice” posture everywhere. Ship the monolith, measure unit cost per pack, and only split pieces when the numbers force you to.
