# PolicyForge — Week 1–2 Validation Sprint User Flow

**Agent:** `interaction-cooper` (Alan Cooper)  
**Status:** Draft v1 for Week 1–2 validation sprint  
**Primary output for:** `ui-duarte` (mockups), `fullstack-dhh` (scaffold), `qa-bach` (test plan)  
**Source context:** `docs/ceo/policyforge-decision.md`, `memories/consensus.md`, `docs/ceo/prfaq-policyforge.md`, `docs/cto/policyforge-architecture.md`

---

## 1. Primary Persona & Scenario

**Primary Persona: Sam**  
- Seed/Series A founder, head of operations, or first compliance lead at a 10–100 person B2B SaaS startup.  
- Preparing for a first SOC 2 Type I or ISO 27001 audit in the next 60–90 days.  
- Non-expert in compliance, time-starved, budget-conscious but willing to pay to avoid a $10k+ consultant.  
- Primary device: laptop; occasional mobile check.  

**Scenario:** Sam lands on PolicyForge from a search for "SOC 2 policy template." They want to understand whether the tool can produce something their auditor will accept, without committing money until they see real output about *their* company.

**End Goal:** Walk away with a tailored policy pack, control map, and a clear post-download action plan they can hand to an auditor.  
**Experience Goal:** Feel guided, not interrogated; trust that the output is a credible starting draft; never be surprised by hidden steps.  
**Life Goal:** Pass the audit without derailing the company.

---

## 2. Flow Summary

```
Landing / SEO → Screener (1 screen) → Intake (3 progressive sections)
                                    ↓
                        Preview (1 stack-sensitive policy + partial control map)
                                    ↓
                        Purchase (Stripe checkout) → Generate → Download + 4-step checklist
```

- Every screen carries an **expectation/disclaimer banner** in the same visual location.
- The funnel is **single-session first**, but **auto-save** allows return on any device via magic-link.
- All progress is visible through a **persistent progress bar** once intake starts.

---

## 3. Screener — One Screen

### Purpose
Qualify the buyer, select the framework, set smart defaults for the rest of the intake, and surface the disclaimer before any data is entered.

### Screen Elements
1. **Header:** "Which audit are you preparing for?"  
2. **Single-select cards (not a dropdown):**
   - **SOC 2 Type I** — "Most popular for first-time U.S. SaaS audits" (recommended/default)
   - **ISO 27001:2022** — "Fast-follow: generate a draft now, final ISO pack ships Week 5"
   - **Not sure / both** — "Start with SOC 2 Type I; add ISO 27001 later"
3. **Optional urgency prompt:** "When do you need policies?" (this week / next 30 days / 60+ days out) — used for smart defaults and email cadence only.
4. **Primary CTA:** "Start free preview"  
5. **Footer link:** "Already purchased? Continue to dashboard"

### Routing Logic
| Selection | Route |
|-----------|-------|
| SOC 2 Type I | Intake pre-set to SOC 2 Type I framework; progress bar starts at 0% |
| ISO 27001:2022 | Intake pre-set to ISO 27001; banner explains "ISO 27001 is a fast-follow; the preview uses the SOC 2 baseline and your final ISO pack will be ready Week 5" |
| Not sure / both | Defaults to SOC 2 Type I; a later intake question asks if ISO 27001 is a future target |

### Expectation Banner (top of screen, persistent)
> "PolicyForge is a document-generation tool, not a law firm or compliance consultant. Your output is a tailored first draft and should be reviewed by your auditor, compliance consultant, or legal counsel before submission."

### Auto-save / Session
- Selecting a framework creates a lightweight `questionnaire` record and stores `framework` + `createdAt`.
- If the user leaves, returning to `/start?resume={id}` (via magic link or localStorage `pf_session_id`) restores the screener state.

---

## 4. Intake — 3 Progressive Sections

**Layout:** single-column, mobile-first, max-width `680px`, sticky progress bar at top.

**Progress Bar:**
- Screener 0% (not shown)
- Section 1: 10–35%
- Section 2: 40–70%
- Section 3: 75–100%
- Preview unlocks at 100%

**Auto-save behavior:**
- Debounced save (1.5s) on every field change.
- On field blur for text inputs.
- On step navigation.
- Save indicator: "Saved" / "Saving…" / "Couldn't save — retry" in the footer.
- If the session expires or the user is anonymous, persist to `localStorage` and reconcile on sign-in.

### 4.1 Section 1 — Company Profile

**Goal:** Establish identity, size, industry, and audit context so the policy language matches the business.

**Fields:**
| Field | Type | Smart Default / Notes |
|-------|------|-----------------------|
| Company name | text | Pre-filled from email domain if available; else blank |
| Website / domain | url | Used to infer common tools later; optional |
| Stage | select | "Seed" / "Series A" / "Series B+" / "Bootstrapped" |
| Approx. employee count | range / number | 10–100 default 25 |
| Industry | select | "B2B SaaS" pre-selected; other options: Fintech, HealthTech, AI/ML, Marketplace, Other |
| Primary data types handled | multi-select | "Customer PII" / "Payment data" / "Health data" / "AI model training data" / "None of the above" |
| Target framework | read-only badge | Carried from screener; editable via "Change" link |
| Desired audit timeline | select | "< 30 days" / "1–3 months" / "> 3 months" |

**Validation:**
- Company name: required, 2–100 chars.
- Domain: optional, validated URL format.
- Employee count: positive integer, max 10,000.

**Next:** Continue to Section 2; progress jumps to 35%.

### 4.2 Section 2 — Stack, Tools & Vendors

**Goal:** Capture the real systems the policies must name and describe.

**Instruction copy:** "Select the tools your company actually uses. We'll mention the ones you select by name in your policies."

**Fields (multi-select cards + "Other" free text):**

**Cloud & Infrastructure**
- AWS, GCP, Azure, Vercel, Heroku, DigitalOcean, Cloudflare, Other

**Identity & Access**
- Google Workspace, Microsoft 365 / Azure AD, Okta, JumpCloud, 1Password, Bitwarden, Other

**Productivity & Communication**
- Slack, Microsoft Teams, Notion, Google Docs, Confluence, Other

**Code & Operations**
- GitHub, GitLab, Bitbucket, Datadog, Sentry, PagerDuty, Linear, Jira, Other

**Finance & Billing**
- Stripe, QuickBooks, NetSuite, Bill.com, Other

**Security / Monitoring**
- Vanta, Drata, Secureframe, Obsidian, Wiz, CrowdStrike, Other

**Smart Defaults:**
- If a domain is provided and a known MX/cname is detected (future Week 4+ enhancement), pre-check Google Workspace / Microsoft 365.
- Default "typical seed SaaS stack" pre-checks: Google Workspace, Slack, GitHub, Stripe, AWS, Vercel, 1Password, Datadog.
- A visible "Clear all / This isn't us" link resets defaults without penalty.

**Vendor free-text question:**
- "Any other critical vendors that store or process customer data?" (e.g., CRM, support, analytics)
- Each entry becomes a row in the Vendor Management policy and control map.

**Validation:**
- Reject entries that look like credentials, secrets, API keys, or URLs containing tokens (`?key=`, `sk-`, `-----BEGIN`, etc.).
- Show inline message: "Please describe tools and vendors only. Do not paste credentials, keys, or access tokens."

**Next:** Continue to Section 3; progress jumps to 70%.

### 4.3 Section 3 — Geography & Team

**Goal:** Determine data residency, entity location, remote-work posture, and role assignments for policy customization.

**Fields:**
| Field | Type | Smart Default |
|-------|------|---------------|
| Company headquarters / legal entity location | select | "United States" pre-selected; EU countries grouped; Other |
| Where do employees work? | select | "Fully remote" / "Hybrid" / "In-office" / "Distributed across 2+ countries" |
| Primary data residency requirement | select | "No specific requirement" / "U.S. only" / "EU/EEA" / "UK" / "Other" |
| Do you have a designated security/compliance lead? | select | "No" / "Yes, me" / "Yes, someone else" |
| Person who will review policies before the auditor | select/email | Pre-fill with current user's email; editable |

**Smart Defaults:**
- If HQ is an EU/EEA country, pre-select "EU/EEA" data residency and add GDPR-related note in preview banner.
- If "No security lead" selected, post-download checklist step 1 (assign owners) is flagged as high priority.

**Validation:**
- Email for reviewer: optional, validated email format.

**Completion:**
- Progress bar reaches 100%; CTA becomes "Generate free preview".
- Before submission, show a **Review drawer** (collapsible) with the key answers and "Edit" links; no new wizard steps.

---

## 5. Preview — High-Value Stack-Sensitive Policy + Partial Control Map

### Policy Selection Logic
The preview generates **one** policy tailored to the stack:
- If Identity/Access tools (Google Workspace, Okta, 1Password, etc.) are selected → generate **Access Control Policy**.
- Otherwise → generate **Information Security Policy**.
- The choice is surfaced: "Because you use 1Password, Google Workspace, and GitHub, we generated your Access Control Policy first."

### Screen Layout
1. **Banner (persistent):**
   > "This is a tailored first draft, not legal advice. Review it with your auditor, compliance consultant, or legal counsel before submission. It is based on the answers you provided and standard control baselines."

2. **Left/top: Generated policy (Markdown rendered)**
   - Title, effective date, scope, roles, policy statements, procedures.
   - Company name, stack names, and geography are injected throughout.
   - A footer within the preview states: "Generated by PolicyForge — starting template; not legal advice."

3. **Right/bottom: Partial control map (CSV preview)**
   - Show 5–10 rows of the most relevant controls for the previewed policy.
   - Columns: Control ID, Control Name, Policy Mapping, Evidence Required, Owner (TBD).
   - Remaining rows are grayed with a lock icon and label "Included in full pack".

4. **Locked policy teasers (accordion or list)**
   - Show titles of the remaining 14–24 policies (e.g., Asset Management, Incident Response, Vendor Management, Data Classification, Privacy Notice).
   - Each row shows a 1-sentence value prop and a lock icon.
   - CTA row: "Unlock the full pack".

5. **Primary CTA:** "Buy full pack — from $349"  
   - If ISO 27001 was selected, CTA reads "Pre-order full pack — from $349" and subtext explains final ISO pack ships Week 5.

### Preview Error/Edge Flows
- **Generation timeout (> 5 seconds):**  
  Show a friendly fallback: "Your preview is taking a little longer. Here is a sample based on a similar stack while we finish yours." Serve a cached representative policy and poll `/api/v1/packs/:id/preview` in the background. If polling fails after 30s, offer "Retry" and "Email me when ready".
- **Invalid/hallucinated output:** Run client-side schema check; if sections are missing, show "We couldn't generate a complete preview from those answers. Try adding more tools or editing your responses."
- **LLM failure (5 retries exhausted):** Show generic baseline preview with explicit notice and a support email; do not block purchase.

---

## 6. Purchase Flow — Stripe Checkout

### 6.1 Pricing Screen

**Layout:** three-tier cards + optional Audit Assist anchor below.

| Tier | Price | What it includes | Best for |
|------|-------|------------------|----------|
| **Starter** | **$349** one-time | One framework, full 15–25 policy pack + control map, 30-day edit window, one free regeneration + diff | First audit, tight budget |
| **Growth** | **$599/year** | One framework, annual policy review, evidence checklist, email support | Recurring compliance rhythm |
| **Scale** | **$1,199/year** | Multi-framework, gap-analysis checklist, annual refresh, priority support | Teams planning multiple audits or frameworks |
| **Audit Assist** | **$2,500+** custom | Human compliance consultant review call + redline feedback on your draft | Teams that want an extra review before submission |

**Interaction Notes:**
- Starter price is subject to the 4-week A/B test (`$349` vs `$399`); the purchase flow UI remains identical.
- "Most popular" badge on Growth.
- "Audit Assist" is shown as an anchor card below the tiers to make Scale look like a bargain and deflect liability toward human review.
- A disclosure checkbox is required before checkout:
  > "I understand PolicyForge does not certify compliance, and I will review all generated policies with my auditor, compliance consultant, or legal counsel before submission."

### 6.2 Checkout

1. User clicks a tier CTA.
2. Browser redirects to **Stripe Checkout** with:
   - `price_id` (Starter one-time, Growth/Scale annual subscription, or Audit Assist custom quote)
   - `client_reference_id` = `questionnaireId`
   - `success_url` = `/purchase/success?session_id={CHECKOUT_SESSION_ID}`
   - `cancel_url` = `/purchase?canceled=1`
3. Stripe handles tax/VAT and payment method collection.

### 6.3 Purchase Banners
- On the pricing page:
  > "All purchases are for tailored document templates, not legal advice or audit certification. Output must be reviewed by your auditor or counsel."
- On checkout (Stripe-hosted, but included in the order summary footer we send):
  > "You are buying a starting policy pack. PolicyForge is not a law firm and does not guarantee audit acceptance."

### 6.4 Post-Purchase Success
- Stripe redirects to `/purchase/success`.
- The app validates the session server-side.
- A success banner shows:
  > "Payment confirmed. Your full pack is being generated. Most packs are ready in under 5 minutes. We'll email you a download link."
- Button: "Go to dashboard".

### 6.5 Error / Edge Flows

**Payment failure (card declined, 3DS fail, etc.)**
- Stripe returns user to `/purchase?canceled=1&error=payment_failed`.
- UI shows inline toast: "Your payment couldn't be processed. Please try a different card or contact your bank." with a "Retry checkout" button that creates a new Stripe session.

**Abandoned cart**
- If checkout is started but not completed within 1 hour, send a transactional email:
  - Subject: "Your PolicyForge pack is still waiting"
  - Body: recap of selected tier and a "Complete purchase" link that returns to Stripe Checkout with the same `questionnaireId`.
- Follow-up at 24 hours with a softer reminder and a link to reply with questions.

**Invalid price / session**
- If the Stripe session ID does not match the `questionnaireId` or is already paid, redirect to dashboard with a message: "We couldn't verify that checkout session. If you were charged, check your email for the receipt or contact support."

---

## 7. Download & Post-Download 4-Step Checklist

### 7.1 Generation Status
- After successful payment, the full pack is enqueued as an async Inngest job (`docs/cto/policyforge-architecture.md:70-73`).
- The dashboard shows a status card: "Generating your policies…" with a progress bar and estimated time (~3–5 minutes).
- On completion, the dashboard updates with:
  - Download buttons: Markdown, DOCX, CSV control map (PDF deferred to Week 6 stretch).
  - Expiry note: "Download links expire in 1 hour. You can re-generate from your dashboard at any time."
  - A copy-to-clipboard link to share with the auditor/reviewer.

### 7.2 Download Banner
- Above the download buttons:
  > "These are tailored first drafts, not final compliance documents. Every file footer includes the same disclaimer: review with your auditor, compliance consultant, or legal counsel before submission."
- Each generated document footer contains:
  > "Generated by PolicyForge on {date}. This document is a starting template and is not legal advice or a certification of compliance. Review with your auditor, compliance consultant, or legal counsel before submission."

### 7.3 Post-Download 4-Step Checklist

The dashboard converts into a task checklist. Each step has a checkbox, a brief instruction, and a default owner/pre-filled data where available.

**Step 1 — Assign policy owners**
- UI: table of all generated policies with an "Owner" dropdown per row (default = reviewer email from intake; editable).
- Suggested owners based on roles:
  - Information Security / Access Control → Security/Compliance Lead
  - Vendor Management → Operations / Finance
  - Incident Response → Engineering Lead
  - Privacy Notice → Legal / CEO
- CTA: "Save owners".

**Step 2 — Customize procedures to real practices**
- UI: each policy expands to show bracketed placeholders / "TBD" sections.
- Example guidance: "Replace '[describe your password reset process]' with the steps your team actually follows."
- CTA: "Mark as customized" (manual) or "Regenerate with updated answers" (30-day edit window).

**Step 3 — Collect evidence per control map**
- UI: render the full CSV control map with filters and checkboxes.
- Each control row shows:
  - Evidence required
  - Suggested evidence location (e.g., "GitHub MFA settings screenshot", "1Password admin report")
  - Status dropdown: "Not started" / "In progress" / "Collected" / "N/A for us"
- CTA: "Upload evidence to your own vault" (we only provide the checklist; no in-app upload in MVP per `docs/ceo/policyforge-decision.md:43`).

**Step 4 — Review with auditor/consultant**
- UI: prompt for auditor/consultant email + optional notes.
- CTA: "Send read-only link" (uses a signed, time-limited URL to the pack).
- Follow-up: auto-email 7 days later asking "Has your auditor reviewed the pack?" with a 1-question survey.

### 7.4 Download Error / Edge Flows

**Generation timeout / failure**
- If the full pack generation job fails or exceeds ~10 minutes, show:
  - "We're still working on your pack. If it isn't ready in 10 more minutes, we'll email you the download link."
  - Background polling continues; email sent on completion or failure.
- If Inngest exhausts 5 retries (`docs/cto/policyforge-architecture.md:104-110`):
  - Show "We couldn't generate your pack automatically. Our team has been notified and you will receive a refund or regeneration within 24 hours." with a "Contact support" button.
  - Auto-initiate refund for Starter; for subscriptions, cancel and alert.

**Signed URL expired**
- If the user clicks an expired link, show "This download link has expired. Generate a fresh one from your dashboard."
- The dashboard always offers fresh signed URLs.

---

## 8. Error & Edge Flows (Cross-Cutting)

| Scenario | System Behavior | User-Facing Message |
|----------|-----------------|---------------------|
| **Invalid input** | Field-level validation on blur/submit; reject credential-like strings | "Please check this field. Do not include credentials, keys, or URLs with tokens." |
| **Session / auto-save conflict** | Last-write-wins per field; show "Saved on this device" timestamp | "We've saved your progress. Sign in to access it from another device." |
| **Network drop during intake** | Queue saves in `localStorage`; retry on reconnect | "You're offline. We'll sync when your connection returns." |
| **Preview timeout** | Serve cached representative + background poll; after 30s offer retry/email | "This is taking longer than usual. Here's a similar sample while we finish yours." |
| **Payment failure** | Stripe cancels back to `/purchase?canceled=1` | "Your payment couldn't be processed. Try again or use a different method." |
| **Abandoned cart** | Trigger 1h and 24h Resend emails with checkout recovery link | Email: "Your policy pack is still waiting — complete your purchase." |
| **Duplicate payment/session** | Idempotency key on `checkout.session` and `packId` | "Looks like you already paid. Redirecting to your dashboard." |
| **ISO 27001 fast-follow** | Allow intake, generate SOC 2 preview, queue ISO pack for Week 5 | "ISO 27001 final output ships Week 5. Your draft will be ready then, and we'll email you." |
| **LLM output validation failure** | Zod schema check fails; retry up to 5 times; fallback to baseline | "We generated a safe baseline draft. You can customize it after purchase." |

---

## 9. Interaction Design Notes (from `frontend-design` skill)

- **Tone:** Professional but human. The compliance domain is intimidating; the UI should feel like a calm, competent assistant, not a government form.
- **Progress:** The sticky progress bar is the primary orientation device. Use a high-contrast accent color for completed steps and a subtle pulse for the current step.
- **Defaults first:** Pre-check the likely SaaS stack so most users only edit, not build from scratch. A "None of these" escape hatch must be visible.
- **Errors as guidance:** Never blame the user. Validation messages explain *why* and *how to fix*.
- **CTA hierarchy:** At every decision point there is exactly one primary action. The purchase screen keeps the three tiers visually equal but signals the recommended choice.
- **Trust surfaces:** Show the disclaimer in the same visual pattern (e.g., a calm blue/gray banner) at screener, preview, purchase, and download so users learn to expect it.
- **Motion restraint:** Use a single staggered page-load animation on the preview screen; otherwise keep transitions fast and functional.

---

## 10. Gate Criteria This Flow Supports

- **Week 2 validation:** Screener routing, preview value, and disclaimer placement can be tested in smoke tests and auditor/consultant interviews.
- **Week 4 gate:** Intake completion rate ≥80% and median time <10 min depend on the 3-section progressive intake, progress bar, auto-save, and smart defaults.
- **Week 4 gate:** Preview endpoint <5 sec depends on the synchronous preview path and graceful timeout fallback.
- **Week 6 gate:** Disclaimers in preview, purchase, and output footer are explicitly designed in.

---

## 11. Open Questions / Handoffs

1. `ui-duarte`: Produce high-fidelity mockups for screener, intake, preview, pricing, status dashboard, and checklist; include `$349` vs `$399` Starter variants.
2. `fullstack-dhh`: Scaffold routes `/start`, `/intake/[section]`, `/preview`, `/purchase`, `/purchase/success`, `/dashboard`, plus API endpoints per `docs/cto/policyforge-architecture.md:225-233`.
3. `qa-bach`: Use this flow as the basis for test cases covering validation, timeout, payment failure, abandoned cart, and disclaimer presence.
4. `product-norman`: Validate against 5 moderated usability sessions; watch especially for default-stack acceptance and the preview-to-purchase transition.

---

*Prepared by `interaction-cooper`. No human input requested.*
