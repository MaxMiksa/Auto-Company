# PolicyForge — Week 1–4 Validation Sprint Test Plan

**Author:** `qa-bach` (James Bach persona)  
**Skill invoked:** `senior-qa`  
**Status:** Draft for one-person QA / single full-stack engineer  
**Scope:** Intake, preview, full-pack generation, payments, exports, notifications, dashboard, security, and high-severity hallucination checks.  
**Goal:** Provide fast, risk-focused quality information for the Week 4 Product-Technical Gate.

---

## 1. Test Strategy & Scope

### 1.1 Core Quality Risks (highest first)

1. **LLM hallucination in policy output** — wrong controls, invented evidence, or contradictory statements can destroy auditor trust and create liability.
2. **Payment idempotency** — duplicate Stripe webhooks or retries must not double-charge or double-generate.
3. **Data privacy / PII leakage** — customer stack descriptions and answers must stay encrypted, access-controlled, and out of logs.
4. **Preview SLA** — >5 s free preview kills conversion.
5. **Full-pack throughput** — must finish end-to-end within minutes and under the $5/pack cost guardrail.

### 1.2 In-Scope Functional Areas

| Area | What we validate | Key sources |
|------|------------------|-------------|
| **Intake validation** | Screener + 3 progressive sections; smart defaults; auto-save; progress bar; plain-language labels; rejection of credential-looking strings; `framework = SOC 2 Type I` first. | `docs/ceo/policyforge-decision.md:47`, `docs/cto/policyforge-architecture.md:123-127` |
| **Preview generation** | One stack-sensitive policy (Information Security or Access Control) + partial control map; <5 sec; free; rendered in browser. | `docs/ceo/policyforge-decision.md:49`, `docs/cto/policyforge-architecture.md:129-133` |
| **Full-pack generation queue** | Async Inngest pipeline; per-policy steps; retries; dead-letter; status polling; pack composed of 15–25 policies + CSV control map. | `docs/cto/policyforge-architecture.md:135-140` |
| **Payment flow** | Stripe Checkout for Starter ($349) and Growth/Scale ($599/$1,199 annual); webhook idempotency; paywall before `POST /api/v1/packs/:id/generate`. | `docs/ceo/policyforge-decision.md:55-65`, `docs/cto/policyforge-architecture.md:141-145` |
| **Exports** | DOCX, Markdown, and CSV control map generated and stored in R2; signed download URLs; correct file contents. | `docs/ceo/policyforge-decision.md:42`, `docs/cto/policyforge-architecture.md:135-139` |
| **Email notifications** | Pack ready, payment receipt, and error/refund messages via Resend. | `docs/cto/policyforge-architecture.md:147-150` |
| **Dashboard** | Lists packs and status; download button; 30-day edit/regeneration + diff view; post-download 4-step checklist. | `docs/ceo/policyforge-decision.md:50-51`, `docs/cto/policyforge-architecture.md:145-146` |
| **Security / disclaimer** | TLS, row-level access, signed URL expiry, input sanitization, rate limiting, GDPR export/delete, and disclaimer on every output surface. | `docs/cto/policyforge-architecture.md:153-157`, `docs/cto/policyforge-architecture.md:198-220` |

### 1.3 Out of Scope for Week 4

- ISO 27001 framework generation (target Week 5 fast-follow).
- PDF export (Week 6 stretch).
- Gumroad / Notion marketplace listing.
- Advanced gap-analysis scoring engine.
- In-app evidence upload vault.

---

## 2. Week 4 Gate Acceptance Criteria

All Week 4 gate criteria from `docs/ceo/policyforge-decision.md:75` are mapped to observable, testable conditions below.

| Gate criterion | Acceptance condition | Measurement / how to test |
|----------------|----------------------|---------------------------|
| Intake completion rate ≥80% | ≥8 of 10 representative users complete the screener + all required sections in one session without abandonment. | Session-based usability tests + analytics funnel. |
| Median intake time <10 min | Median completion time ≤10 min across 10 test participants. | Timed sessions; exclude users who pause >2 min. |
| Preview generates in <5 sec | 95th percentile server response time for `POST /api/v1/packs/preview` <5 s over 50 calls. | Automated k6/Postman load + manual stopwatch. |
| Full pack generates in <5 min | End-to-end `packId` status reaches `ready` within 5 min for a representative SOC 2 stack in 9/10 runs. | Automated Inngest + API polling test. |
| Full pack cost < $5 | Claude + Inngest + R2 cost per successful pack ≤ $5.00 as measured by Stripe/Anthropic dashboards. | Cost tracker; run 5 sample packs. |
| Exports correct | DOCX/Markdown/CSV are downloadable, non-empty, correctly named, and contain expected policy titles and control mappings. | Automated download + content assertions. |
| No duplicate charges | Replaying a Stripe `checkout.session.completed` event or retrying `POST /api/v1/packs/:id/generate` with the same idempotency key does not create a second charge or pack. | Webhook replay + idempotency-key tests. |
| No PII leakage | Questionnaire answers and generated policy text do not appear in logs, error pages, Sentry, or unsigned URLs; users cannot access another user’s pack. | Log grep + cross-user access tests. |
| Disclaimer present | “This is a tailored first draft, not legal advice…” appears in preview, purchase flow, document footer, dashboard, and generated Markdown/DOCX. | Automated text search + manual review. |
| No critical security/privacy gaps | OWASP-style smoke tests pass; credentials rejected; RLS enforced; signed URLs expire. | Security checklist + automated assertions. |

---

## 3. High-Severity Hallucination Checks for Policy Output

The largest product risk is an auditor rejecting output because the LLM invented or mis-mapped content. Treat every finding below as a **Blocker / Critical** defect for Week 4 if it appears in a generated pack.

| Check | Failure mode | Pass definition |
|-------|--------------|-----------------|
| **Wrong control mapping** | Policy claims to map to SOC 2 CC6.1 but the control text describes an unrelated topic (e.g., CC7.2). | Every policy-control reference in the CSV matches the AICPA Trust Services Criteria mapping for SOC 2 Type I. |
| **Invented evidence** | Policy says “Configure AWS CloudTrail with log retention of 90 days” when the user never named AWS, or cites a non-existent screenshot/checklist as evidence. | Generated text only references tools, settings, and artifacts explicitly provided in the questionnaire or from a vetted baseline; no made-up filenames or screenshots. |
| **Contradictory statements** | One section requires MFA for all systems; another section says “MFA is optional for non-production tools.” | No two sentences in a policy directly contradict each other; contradictions with questionnaire answers are also flagged. |
| **Missing disclaimer** | Any generated document, preview, or download footer omits the “not legal advice / review with auditor or counsel” statement. | Disclaimer appears in every preview, full-pack file header/footer, purchase screen, and dashboard. |
| **Wrong framework references** | SOC 2 Type I pack mentions ISO 27001:2022 Annex A controls as binding requirements, or vice versa (after Week 5). | Only SOC 2 Type I TSC and AICPA references appear in the SOC 2 pack. |
| **Naming real tools incorrectly** | Policy refers to “GitLab” when the user selected GitHub, or invents a vendor spelling such as “AWS S3 buckets are managed by Cloudflare.” | Tool and vendor names match the intake exactly, including capitalization; unsupported tools fall back to generic language, never a guessed name. |
| **Unsupported jurisdiction** | Privacy section asserts GDPR applicability for a US-only company with no EU operations, or claims HIPAA compliance without a BAA. | Jurisdiction statements are consistent with selected geography and framework scope; no unearned compliance claims. |
| **Unearned certification** | Output contains phrases like “PolicyForge certifies SOC 2 compliance” or “guaranteed to pass audit.” | No certification, guarantee, or legal-opinion language appears anywhere. |

### 3.1 Sampling Plan for Hallucination Detection

- **Week 4 sample size:** 20 generated packs covering at least 5 distinct stack combinations.
- **Selection:** Include common stacks (Google Workspace + AWS + GitHub + Stripe), edge stacks (Azure + Office 365 + GitLab + Notion), and minimal stacks (Slack + Google Workspace only).
- **Method:** Manual expert review of Markdown and CSV by a single QA using the checklist above, plus automated string/regex scans for certification language and tool-name mismatches.

---

## 4. Test Cases

### 4.1 Legend

- **P/F:** Pass / Fail
- **Blocker:** Prevents Week 4 gate pass.
- **Manual:** Best done by a human eye or exploratory session.
- **Auto:** Can be scripted with Playwright / k6 / API tests.

### 4.2 Intake Validation

| ID | Title | Inputs | Expected outcome | P/F definition | Manual / Auto |
|----|-------|--------|------------------|----------------|---------------|
| I-01 | Complete SOC 2 intake | Framework = SOC 2 Type I; stack = AWS, GitHub, Slack, Google Workspace; team = 25; US; no EU. | Questionnaire saved; progress bar reaches 100%; `questionnaireId` returned. | 100% progress and valid `questionnaireId` within 10 min. | Manual for timing; Auto for persistence. |
| I-02 | Screener abandonment | User exits after section 1. | Auto-save preserves answers; returning user resumes at section 2. | Data reloaded and progress restored. | Manual. |
| I-03 | Credential rejection | Pastes `AKIAIOSFODNN7EXAMPLE` into “AWS account ID or tool name” field. | Form blocks submit with warning; answer not stored. | Input rejected, no persistence of secret-like string. | Auto + Manual. |
| I-04 | Unsupported framework | Selects ISO 27001 before launch. | UI disables or shows “coming Week 5” message; does not generate preview. | Correct gating message shown. | Manual. |
| I-05 | Empty required field | Leaves “team size” blank. | Inline validation message; cannot proceed. | Field-level error shown. | Auto. |

### 4.3 Preview Generation

| ID | Title | Inputs | Expected outcome | P/F definition | Manual / Auto |
|----|-------|--------|------------------|----------------|---------------|
| P-01 | Information Security preview — AWS stack | Questionnaire with AWS, GitHub, Slack. | Returns Markdown policy and partial CSV control map; mentions AWS/GitHub/Slack. | Response time <5 s; content relevant and accurate. | Auto for timing; Manual for accuracy. |
| P-02 | Access Control preview — Google Workspace stack | Questionnaire with Google Workspace, 1Password, AWS. | Access Control policy references Google Workspace SSO and 1Password. | No wrong tools; disclaimer present. | Manual. |
| P-03 | Preview with minimal stack | Only Slack + Google Workspace. | Policy uses generic controls where no specific tool applies; no invented vendors. | No hallucinated tools. | Manual. |
| P-04 | Preview rate limit | 100 rapid preview requests from one IP. | Rate limit returns 429; no bills generated. | 429 status and no crash. | Auto. |

### 4.4 Full-Pack Generation Queue

| ID | Title | Inputs | Expected outcome | P/F definition | Manual / Auto |
|----|-------|--------|------------------|----------------|---------------|
| G-01 | Successful SOC 2 full pack | Valid paid `packId`; SOC 2 questionnaire. | Inngest completes; status becomes `ready`; 15–25 files + CSV in R2. | Ready ≤5 min; all expected files non-empty. | Auto. |
| G-02 | LLM transient failure retry | Claude returns 529 twice, then 200. | Inngest retries with backoff; pack eventually completes. | Status `ready` after ≤5 retries; no duplicate files. | Auto (mocked) / Manual. |
| G-03 | Dead-letter after 5 failures | Claude fails 5 times on one policy. | Job marked `failed`; customer-visible error; refund path offered; email sent. | Status `failed`; support notified. | Auto (mocked). |
| G-04 | Duplicate generation request | Replay `POST /api/v1/packs/:id/generate` with same idempotency key. | Only one pack generated; one set of files in R2. | No duplicate `packFiles` rows or R2 objects. | Auto. |
| G-05 | Cost guardrail | 5 representative packs. | Anthropic dashboard total / 5 ≤ $5.00 per pack. | Cost ≤ $5.00/pack. | Manual. |

### 4.5 Payment Flow

| ID | Title | Inputs | Expected outcome | P/F definition | Manual / Auto |
|----|-------|--------|------------------|----------------|---------------|
| PY-01 | Starter one-time purchase | Stripe Checkout for $349; test card `4242 4242 4242 4242`. | `checkout.session.completed` webhook unlocks full-pack generation; dashboard shows “Starter — active.” | Payment recorded; generation allowed. | Auto (test mode). |
| PY-02 | Duplicate webhook | Same Stripe event sent twice. | Second event ignored; one invoice/pack entitlement. | No duplicate payment or pack. | Auto. |
| PY-03 | Growth annual subscription | Selects $599/year; test card. | `invoice.paid` activates subscription; dashboard shows renewal date. | Subscription active; download allowed for 1 year. | Auto + Manual. |
| PY-04 | Failed payment | Declined card `4000 0000 0000 0002`. | Payment declined; pack not generated; user sees error. | No pack created; error shown. | Auto. |
| PY-05 | Paywall before payment | Call `POST /api/v1/packs/:id/generate` without checkout completion. | 402 Payment Required; job not enqueued. | 402 response; no Inngest job. | Auto. |

### 4.6 Exports

| ID | Title | Inputs | Expected outcome | P/F definition | Manual / Auto |
|----|-------|--------|------------------|----------------|---------------|
| E-01 | Markdown export | Download `?format=md` for a pack. | Clean `.md` files; one per policy + README; disclaimer at top. | Files parse as Markdown; disclaimer present. | Auto + Manual. |
| E-02 | DOCX export | Download `?format=docx`. | Valid `.docx` opens in Word/Google Docs; contains all policies and control map. | File opens; content matches Markdown. | Manual. |
| E-03 | CSV control map | Download `?format=csv`. | Rows = policies × controls; columns include policy name, control ID, evidence needed. | CSV non-empty; mappings match SOC 2 TSC. | Auto. |
| E-04 | Signed URL expiry | Wait 1 hour (or force expiry) then reuse download URL. | 403 / URL expired; fresh request generates new signed URL. | Expired URL denied; new URL works. | Auto. |

### 4.7 Email Notifications

| ID | Title | Inputs | Expected outcome | P/F definition | Manual / Auto |
|----|-------|--------|------------------|----------------|---------------|
| N-01 | Pack ready email | Pack status reaches `ready`. | Resend sends email with download link; links use signed URLs. | Email received; link works; no PII in subject. | Manual. |
| N-02 | Payment receipt | Successful checkout. | Receipt email with amount, plan, and invoice link. | Correct amount and plan. | Auto. |
| N-03 | Generation failure email | Job dead-letters. | Email explains failure and next steps (retry/refund). | Sent; no stack details in body beyond plan name. | Manual. |

### 4.8 Dashboard

| ID | Title | Inputs | Expected outcome | P/F definition | Manual / Auto |
|----|-------|--------|------------------|----------------|---------------|
| D-01 | Pack list & status | User with 2 packs (1 ready, 1 failed). | Dashboard lists both with correct status and download/regenerate buttons. | Correct statuses and actions. | Auto + Manual. |
| D-02 | Cross-user isolation | User A tries `GET` user B’s `packId`. | 403 Forbidden; row-level security enforced. | No access to other tenant data. | Auto. |
| D-03 | 30-day regeneration | Click regenerate within 30 days. | New pack generated from saved questionnaire; diff view shows changes. | New `packId`; diff rendered. | Manual. |
| D-04 | Post-download checklist | Download pack. | Dashboard shows 4-step checklist (assign owners, customize procedures, collect evidence, review with auditor). | Checklist visible and interactive. | Manual. |

### 4.9 Security & Disclaimer

| ID | Title | Inputs | Expected outcome | P/F definition | Manual / Auto |
|----|-------|--------|------------------|----------------|---------------|
| S-01 | Log leakage scan | Generate full pack, then inspect Vercel/Sentry logs. | No full prompts, responses, or policy text in logs. | No policy text or PII found. | Manual + grep. |
| S-02 | SQL / XSS injection in intake | Input `'; DROP TABLE users; --` and `<script>alert(1)</script>`. | Input sanitized; no errors or script execution. | Stored safely; rendered escaped. | Auto. |
| S-03 | TLS & headers | `curl -I https://policyforge.auto-company.dev`. | HTTPS redirect, HSTS, secure cookies. | Correct headers. | Auto. |
| S-04 | Disclaimer everywhere | Preview, purchase, footer, generated files, dashboard. | Disclaimer text present on all surfaces. | 100% coverage. | Auto + Manual. |
| S-05 | GDPR delete | Call delete-account API. | Questionnaire and files removed; billing records retained. | 204 response; data gone. | Auto. |

---

## 5. Manual vs Automated Test Mix (One-Person Team)

### 5.1 Recommended Split

| Category | Share | Why |
|----------|-------|-----|
| **Automated smoke / regression checks** | ~40% | Core paths: intake persistence, preview latency, payment idempotency, file download, cross-user access, disclaimer grep. |
| **Manual exploratory sessions** | ~35% | Hallucination review, DOCX rendering, real email inbox checks, usability timing. |
| **Automated load / performance** | ~15% | Preview p95 <5 s; full-pack end-to-end <5 min. |
| **Manual security / privacy spot checks** | ~10% | Log review, Sentry scrubbing, credential-string attempts, signed URL expiry. |

### 5.2 What to Automate First (Week 1–2)

1. **API smoke test** — create questionnaire → preview → check response time.
2. **Idempotency test** — replay Stripe webhook and generation `POST` twice.
3. **Access-control test** — cross-user pack access must return 403.
4. **Export sanity test** — download Markdown and CSV; assert non-empty and disclaimer present.
5. **Payment-state test** — generate without payment returns 402; valid payment unlocks generation.

### 5.3 What to Keep Manual (Week 1–4)

1. **Hallucination review** of 20 sample packs against the checklist in Section 3.
2. **DOCX visual correctness** (opens, pagination, styles, headers/footers).
3. **Real email deliverability** and link expiration.
4. **5 moderated usability sessions** for intake completion rate and timing (owned by `product-norman`, QA observes).
5. **Exploratory sessions** using HICCUPPS/SFDPOT heuristics for 30 min each week.

### 5.4 Suggested Weekly Rhythm

| Week | Focus | Key deliverables |
|------|-------|------------------|
| **Week 1** | Environment + smoke automation | Run API health checks; validate preview endpoint scaffold. |
| **Week 2** | Intake + payment idempotency | Intake validation tests; Stripe webhook idempotency test; document defects. |
| **Week 3** | Preview SLA + hallucination baseline | p95 <5 s; review 10 preview outputs for invented tools/disclaimers. |
| **Week 4** | Full-pack end-to-end + gate evidence | Run 20-pack sample; verify all Week 4 gate criteria; produce gate report. |

---

## 6. Exploratory Testing Charter (SBTM)

Use two 30-minute sessions per week. Each session has a charter, notes, and a one-paragraph debrief.

### Charter A: “What could the LLM get wrong about our stack?”
- **Focus:** Use SFDPOT (Structure, Function, Data, Platform, Operations, Time) to vary stack inputs.
- **Question:** Does the model name tools correctly and avoid unsupported controls?
- **Risk targeted:** Hallucination, wrong tool naming.

### Charter B: “What if money or data goes wrong?”
- **Focus:** Retry payment webhooks, refresh signed URLs, swap user sessions, delete account.
- **Question:** Can we cause double charges, cross-tenant leaks, or data left behind?
- **Risk targeted:** Payment idempotency, PII leakage, access control.

---

## 7. Definition of Done for Week 4 Gate

The Week 4 gate is **PASS** when:

1. All automated smoke tests in Section 5.2 pass on the staging environment.
2. Intake completion rate ≥80% and median time <10 min from usability sessions.
3. Preview p95 response time <5 s over 50 calls.
4. Full-pack generation succeeds end-to-end in <5 min and costs < $5/pack in 9/10 runs.
5. DOCX, Markdown, and CSV exports are valid and contain the disclaimer.
6. No duplicate charges or duplicate packs under replay conditions.
7. No PII or policy text in logs, Sentry, or unsigned URLs.
8. Hallucination review of 20 packs shows zero Blocker/Critical findings from Section 3.
9. Disclaimer is present on preview, purchase, dashboard, and every generated file.
10. Cross-user access returns 403 for all pack endpoints.

---

## 8. References

- `docs/ceo/policyforge-decision.md` — Week 2/4/6/8 gates and scope cuts.
- `docs/ceo/prfaq-policyforge.md` — customer promise, pricing, metrics.
- `docs/cto/policyforge-architecture.md` — data flow, stack, failure modes, API surface.
- `memories/consensus.md` — Cycle 2 decision and adjusted MVP scope.
- `.claude/agents/qa-bach.md` — testing philosophy and risk-first approach.
- `.claude/skills/senior-qa` — test suite, coverage, and E2E scaffolding references.

---

*Prepared by `qa-bach` using the `senior-qa` skill. No human input requested.*
