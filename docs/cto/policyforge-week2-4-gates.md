# PolicyForge — Week 2 & Week 4 Gate Checklists

**Source:** `docs/ceo/policyforge-decision.md` Section 6  
**Owner:** `cto-vogels` / `sales-ross`  
**Status:** Cycle 2 GO / NO-GO validation gates

---

## Week 2 — Validation Gate

**Deadline:** End of Week 2  
**Fail Action:** Pause build; run a 2-week validation sprint. If still not cleared by Week 4, **NO-GO** and pivot to FlowSpec or InvoicePipe.

### Pass Criteria

- [ ] **(a) Auditor / consultant acceptance evidence:** 3+ written statements from active SOC 2 Type I or ISO 27001 auditors / compliance consultants confirming that AI-generated first drafts with light human editing are acceptable, **or** explicit written acceptance criteria if they are not.
- [ ] **(b) Paid-signal smoke test:** Landing-page smoke test shows ≥50 qualified signups **or** ≥3 paid pre-orders / $599/year commitments at recommended prices ($349 Starter, $599 Growth, $1,199 Scale).
- [ ] **(c) Legal / disclaimer posture:** Terms, Privacy Policy, and output disclaimers drafted; UPL risk accepted; no “audit certification” or policy-editing-as-a-service language present.
- [ ] **(d) CAC sanity:** Target CAC ≤ $150 based on channel spend and early sign-up / pre-order data.

### Supporting Inputs

- Auditor/consultant outreach list and written responses (owner: `sales-ross`)
- Landing-page / price-test smoke-test metrics (owner: `operations-pg`)
- Terms, Privacy, and disclaimer drafts reviewed for UPL risk (owner: `ceo-bezos` + `critic-munger`)
- CAC estimate by channel (owner: `operations-pg` / `sales-ross`)

---

## Week 4 — Product-Technical Gate

**Deadline:** End of Week 4  
**Fail Action:** Cut more scope or extend Week 5/6; if core generation or payment cannot be made reliable, **NO-GO**.

### Pass Criteria

- [ ] **(a) Intake performance:** Intake completion rate ≥ 80%; median completion time < 10 minutes (target 10–15 min overall). Smart defaults and simplified screener + 3 progressive sections live.
- [ ] **(b) Preview speed & quality:** Preview endpoint generates one stack-sensitive policy (Information Security or Access Control) + partial control map in < 5 seconds; output is coherent and framework-aligned.
- [ ] **(c) End-to-end SOC 2 Type I pack generation:** Full pack generates end-to-end, cost < $5 per pack, with Markdown + DOCX + CSV control map downloadable; optional PDF fallback functional if time permits.
- [ ] **(d) Payment & dashboard:** Stripe Checkout live in test mode; dashboard lists packs, status, and download actions; no critical payment idempotency gaps.
- [ ] **(e) Security & privacy:** No critical security/privacy gaps; input sanitization, row-level access, signed URLs, and basic GDPR export/delete flows in place.

### Supporting Inputs

- Usability test results and intake analytics (owner: `product-norman`)
- Preview latency, token cost, and hallucination QA sample (owner: `qa-bach`)
- End-to-end generation logs and per-pack cost measurement (owner: `cto-vogels`)
- Stripe test-mode checkout flow + webhook idempotency test (owner: `fullstack-dhh`)
- Security/privacy review checklist (owner: `cto-vogels` / `qa-bach`)

---

*Checklists derived directly from `docs/ceo/policyforge-decision.md` and `memories/consensus.md`.*
