# PolicyForge — 5-Session Moderated Usability Plan

**Owner:** `product-norman` (Don Norman thinking model)  
**Goal:** Validate the Cycle 2 clickable prototype against the Week 4 product-technical gate before full build commitment.  
**Status:** Plan. Actual sessions run once the prototype is ready (target Day 14).  
**Inputs:** `docs/ceo/policyforge-decision.md`, `docs/ceo/prfaq-policyforge.md`, `docs/cto/policyforge-architecture.md`, `memories/consensus.md`; with `user-research-synthesis` and `ux-audit-rethink` skill frameworks applied.

---

## 1. Research Questions

We are testing whether the redesigned PolicyForge experience matches the mental model of a founder/operator preparing a first SOC 2 Type I audit.

1. Can target users complete the intake without abandoning or needing help?
2. Do they understand the free preview as a *tailored first draft* and not the final deliverable?
3. Can they read the control map and connect policies to controls + evidence?
4. Can they select a tier, complete checkout, and download the pack with minimal friction?
5. Is the post-download checklist actionable — do users know what to do next?
6. Do users correctly describe what they are buying before they pay?

---

## 2. Method

- **Format:** Remote, moderated, think-aloud usability sessions.
- **N:** 5 target participants (with 2 alternates recruited in case of no-shows).
- **Duration:** 60 minutes each.
- **Environment:** Desktop browser (Chrome or Safari), screen share required.
- **Prototype:** Clickable Figma/Next.js prototype of intake → preview → pricing → checkout/dashboard → post-download checklist.
- **Data collected:** Task completion, time-on-task, error counts, help requests, verbalized confusion, critical-incident quotes, SUS-style ratings.

---

## 3. Target Participants & Personas

### Primary persona: “Founder-Operator under Audit Pressure”
- Role: Founder/CEO, COO, VP of Ops, Head of Security/Compliance, or first operations hire.
- Company: B2B SaaS, 5–100 employees, raising seed/Series A, no prior SOC 2.
- Context: Preparing for first SOC 2 Type I audit in the next 0–6 months.
- Tools: Google Workspace / Office 365, AWS/GCP/Azure, GitHub, Slack, Stripe, 1Password/Okta, Notion/Linear.
- Mental model: “I need policies and a control map an auditor will accept, without a $10k consultant.”

### Secondary persona: “Technical Founder doing compliance themselves”
- Role: CTO / VP Eng / founder who writes the first security docs.
- More skeptical of LLM output; cares about version control, exports, and correctness.

### Recruitment mix
- At least 3 actively preparing for a first SOC 2 Type I audit.
- At least 2 have already used a policy-template marketplace or trialed Vanta/Drata/Secureframe.
- At least 2 are the budget owner or can authorize a $300–$1,200 software spend.

---

## 4. Screener Criteria

A participant **must** meet all of the following to be scheduled:

| # | Criterion |
|---|-----------|
| 1 | Works at a B2B SaaS startup with 5–100 employees. |
| 2 | Is personally involved in preparing for a first SOC 2 Type I or ISO 27001 audit, OR has done so in the last 12 months. |
| 3 | Can name the core cloud / SaaS tools their company uses (email, cloud provider, code repo, chat, identity). |
| 4 | Has influence over a $300–$1,200 software/tool purchase. |
| 5 | Comfortable with English, screen sharing, and a 60-minute remote session. |
| 6 | Has not seen the PolicyForge prototype or landing page before. |

**Quotas:**
- 3+ “actively preparing for first SOC 2 Type I.”
- 2+ with prior template/compliance-platform exposure.
- 1–2 technical founders/CTOs.

### Recruitment / screener questions

1. What is your current role and company size?
2. Is your company currently preparing for a SOC 2 Type I or ISO 27001 audit? Where are you in that process?
3. Which of these does your company currently use? *(email/cloud/code repo/chat/identity/payments)*
4. Have you bought, downloaded, or trialed any compliance tools or policy templates before? Which ones?
5. Are you able to approve or strongly influence a $300–$1,200 purchase for compliance tooling?
6. Can you join a 60-minute remote video session with screen sharing in the next few days?
7. *(If yes to all)* Best email + timezone + preferred time slots?

---

## 5. Recruitment Sources & Incentives

- Sources: founder Slack groups, YC/startup alumni networks, LinkedIn outreach, Product Hunt community, personal warm intros, compliance consultant referrals.
- Incentive: $100 Amazon/Visa gift card or equivalent donation to a charity of the participant’s choice.
- Over-recruit to 7 completes to protect against no-shows; stop after 5 valid sessions.

---

## 6. Session Protocol

### 6.1 Pre-session (5 min)
- Send prototype link, consent form, and screen-share instructions 24 hours in advance.
- Moderator resets prototype state to a clean session before each call.
- Confirm: browser, screen sharing working, no distractions.

### 6.2 Intro (5 min)
- “We are testing the product, not you. Please think out loud.”
- Explain that the prototype is a draft; some interactions may be simulated.
- Get verbal consent to record (if allowed in jurisdiction).
- Background questions: role, audit timeline, current tools, current compliance pain.

### 6.3 Task Sequence (45 min)

Participants complete the following tasks in order. The moderator gives the task, then stays silent unless the participant asks a direct question or gets completely stuck for >30 seconds.

#### Task 1 — Complete the intake
- **Scenario:** “You just landed on PolicyForge because your auditor asked for a set of policies. Go through the questionnaire as you normally would.”
- **What to observe:**
  - Time from first question to submission.
  - Where participants hesitate, backtrack, or skip fields.
  - Whether smart defaults are accepted or changed.
  - Whether “Tools and vendors your company uses” is clearer than “subprocessors.”
  - When / if participants ask for help.
- **Probe after submission:**
  - “What do you think will happen next?”
  - “Was any question confusing?”
  - “Did the progress bar match your sense of how much was left?”

#### Task 2 — Review the free preview
- **Scenario:** “You see the preview. Take a look and tell me what you are looking at.”
- **What to observe:**
  - Time from click to the moment the participant verbally confirms the preview has loaded and makes sense.
  - Whether they recognize the generated policy as *their* policy (mentions their own tools).
  - Whether they notice the partial control map.
  - Whether they understand that locked sections are part of the paid pack.
- **Probe:**
  - “In your own words, what would you get if you paid?”
  - “What is a control map, in your understanding?”
  - “What did this preview tell you that a generic template would not?”

#### Task 3 — Interpret the control map
- **Scenario:** “Imagine your auditor is going to read this control map. Walk me through what one row means and what evidence you would collect for it.”
- **What to observe:**
  - Can they explain the relationship between a policy, a control, and evidence?
  - Do they understand which controls apply to their stack?
  - Do they feel confident or confused about the gaps?
- **Probe:**
  - “Pick one control. What evidence would you need to show your auditor?”
  - “What does the status / gap column tell you?”

#### Task 4 — Attempt purchase and download
- **Scenario:** “You decide to buy the full pack. Go through the pricing page, pick a tier, and complete the purchase so you can download the files.”
- **What to observe:**
  - Which tier they select and why.
  - Reaction to the Audit Assist anchor tier.
  - If shown the A/B variant, note response to $349 vs $399 Starter.
  - Any confusion about “annual” vs “one-time.”
  - Checkout completion (Stripe test mode) and dashboard arrival.
  - Download of Markdown, DOCX, and CSV.
- **Probe:**
  - “What made you choose that tier?”
  - “What do you think is included in Starter vs Growth?”
  - “How would you feel if the real price was $X?”

#### Task 5 — Use the post-download checklist
- **Scenario:** “You now have your files. This is your next-steps dashboard. What would you do first?”
- **What to observe:**
  - Do they see the 4-step checklist as a clear path forward?
  - Which step they choose first and why.
  - Whether “assign owners” is intuitive.
  - Whether they notice the disclaimer / “starting template, not legal advice” banner.
- **Probe:**
  - “Which of these steps is most useful? Which is hardest?”
  - “Would you show this output to your auditor before customizing it?”

### 6.4 Closing (5 min)
- 1–5 likelihood to recommend / likelihood to purchase.
- “Would you show these documents to your auditor as a starting point?”
- “What one thing would make you buy today?”
- “What one thing almost made you leave?”

---

## 7. Pass / Fail Criteria (Week 4 Gate Alignment)

| Week 4 Gate Criterion | Study Translation | Pass Bar (n=5) |
|---|---|---|
| Intake completion rate ≥ 80% | % of participants who submit the full intake without moderator rescue | ≥ 4 / 5 complete |
| Median intake time < 10 min | Time from first question to submission | Median < 10 min |
| Preview loads and is understood in < 5 sec | Time from preview trigger to participant verbalizing what they see | Median < 5 sec and all 5 can describe what loaded |
| ≥ 3 of 5 can describe what they are buying | Response to “What would you get if you paid?” and/or tier selection rationale | ≥ 3 / 5 correctly describe the full SOC 2 policy pack + control map + evidence checklist |

### Additional internal signals
- **Control-map comprehension:** ≥ 3 / 5 can explain at least one control-to-evidence mapping with no major confusion.
- **Checkout success:** ≥ 4 / 5 can select a tier and complete the simulated checkout/download without rescue.
- **Post-download next-step clarity:** ≥ 3 / 5 can name the first concrete action they would take from the checklist.
- **Auditor-confidence signal:** ≥ 3 / 5 say they would show the output to their auditor as a starting draft (early Week 6 indicator).
- **Critical confusion threshold:** If ≥ 2 participants cannot locate the disclaimer or believe the output is “audit-ready without review,” flag as a trust/safety blocker.

---

## 8. Moderator Observation Guide

Use the think-aloud protocol. Your job is to **watch, prompt, and record**, not to teach.

### General behaviors to capture
- **Affordance failures:** Did the participant know what was clickable / editable?
- **Feedback failures:** Did an action produce a visible, immediate response? Did loading states feel abandoned?
- **Mental-model mismatches:** Did they expect a web editor, an upload vault, a PDF, or a live lawyer?
- **Error & recovery:** Where did they make errors? Could they recover without help?
- **Language confusion:** Did any label, tooltip, or disclaimer trip them up?
- **Backtracking / scrolling:** Where did they return to a previous screen? Why?
- **Help requests:** How many times did they ask the moderator for clarification?
- **Emotional cues:** signs of confusion, delight, skepticism, or trust.

### Per-task signals

| Task | Critical observations |
|------|-----------------------|
| Intake | Drop-off point; time per section; defaults accepted; confusion on “Tools and vendors” vs old “subprocessors” term; credential-looking input attempts. |
| Preview | First verbal reaction within 5 sec; mentions own company/tools; notices locked indicators; understands “first draft” disclaimer. |
| Control map | Maps a policy to a control; identifies at least one evidence artifact; understands gap/status labels; asks “where do I upload evidence?” (scope trap). |
| Purchase / download | Tier rationale; reaction to Audit Assist anchor; A/B variant price reaction; confusion between one-time and annual; checkout completion; file download discovery. |
| Post-download checklist | First chosen step; belief that work is “done” vs “customization needed”; owner-assignment affordance; disclaimer noticed. |

### Recording template

For each participant create a row per task:

| Participant | Segment | Task | Start | End | Success Y/N | Errors | Prompts needed | Critical quote | Severity (0–3) |
|-------------|---------|------|-------|-----|-------------|--------|----------------|----------------|----------------|

---

## 9. Data Synthesis & Reporting

1. **Timings:** Compute median intake time, median preview load time, task completion rates.
2. **Thematic coding:** Tag critical incidents (affordance, feedback, language, mental model, trust, pricing, next steps).
3. **Pass/fail scoring:** Map each participant to the Week 4 gate pass/fail criteria.
4. **Top issues:** Rank by frequency × severity. Limit to 3–5 P0/P1 fixes.
5. **Deliverable:** 1-page executive summary + detailed findings in `docs/product/policyforge-usability-findings.md` by Day 17.

---

## 10. Schedule & Prerequisites

| Milestone | Target Date | Owner |
|-----------|-------------|-------|
| Clickable prototype ready | Day 5–7 | `interaction-cooper` + `ui-duarte` + `fullstack-dhh` |
| Test environment: Stripe test mode, mock packs, clean reset script | Day 10 | `fullstack-dhh` + `qa-bach` |
| Pilot session with internal user | Day 12 | `product-norman` |
| Recruitment complete (5 + 2 alternates) | Day 13 | `product-norman` / ops support |
| **5 moderated sessions** | **Day 14–16** | `product-norman` |
| Synthesis + report | Day 17 | `product-norman` |
| Week 4 gate review | Day 14–18 | `ceo-bezos` + `critic-munger` |

### Prototype readiness checklist
- [ ] Intake: one-screen screener + 3 progressive sections, progress bar, auto-save, smart defaults.
- [ ] Preview: one stack-sensitive policy + partial control map, <5 sec simulated load, “Included in full pack” locks.
- [ ] Control map: at least 3 rows with policy → control → evidence mapping and gap/status labels.
- [ ] Pricing: $349 Starter / $599 Growth / $1,199 Scale / $2,500+ Audit Assist; one-time vs annual clear.
- [ ] Checkout: Stripe test-mode flow and confirmation.
- [ ] Dashboard / download: mock Markdown + DOCX + CSV files available.
- [ ] Post-download checklist: 4 steps visible (assign owners, customize procedures, collect evidence, review with auditor/consultant).
- [ ] Disclaimer banners present on preview, purchase, and dashboard.

---

## 11. Risk & Mitigations

| Risk | Mitigation |
|------|------------|
| Prototype not ready by Day 14 | Buffer to Day 15–16; pilot with low-fidelity wireframes if needed. |
| No-shows / cancellations | Over-recruit to 7; keep a standby list. |
| Participants want to please us | Emphasize we are testing the product; ask behavioral questions, not opinion questions. |
| Moderator leading participants | Use scripted probes; avoid “Do you like…?” and ask “What are you trying to do?” |
| Scope confusion (evidence upload) | Watch for this specifically; if ≥ 2 participants expect an upload vault, flag to `interaction-cooper`. |
| Price sensitivity skews results | Test both $349 and $399 Starter variants where possible. |

---

## 12. Appendix

### A. Recruitment message (short)

> Hi [Name], we’re building PolicyForge — a tool that generates a SOC 2 policy pack and control map from a short questionnaire. We’re running 60-minute remote usability sessions next week and are looking for founders/ops leads at B2B SaaS startups preparing their first SOC 2. You’ll walk through a clickable prototype, think out loud, and receive a $100 gift card for your time. Interested?

### B. Consent summary
- Sessions recorded for internal research only.
- Data anonymized in reporting.
- Participants can skip any task or stop at any time.
- No personal credentials or real company secrets should be entered into the prototype.

### C. SUS-style closing questions
1. I found the intake easy to complete. (1–5)
2. The preview helped me understand what I would get. (1–5)
3. The control map was clear. (1–5)
4. I felt confident selecting a pricing tier. (1–5)
5. I would know what to do next after downloading the pack. (1–5)
6. I would show these documents to my auditor as a starting draft. (1–5)
7. Overall, this product feels trustworthy. (1–5)

### D. Skill invocation notes
This plan was informed by:
- `user-research-synthesis`: behavior-based screener, thematic coding, triangulation of task success + verbalized confusion + timing data.
- `ux-audit-rethink`: observation of 5 interaction dimensions (Words, Visual Representations, Physical/Space, Time, Behavior) and 5 usability characteristics (Effectiveness, Efficiency, Engagement, Error Tolerance, Ease of Learning) during each session.

---

*Prepared by `product-norman`. Target execution: Day 14–16. This is a plan; actual findings will be recorded separately.*
