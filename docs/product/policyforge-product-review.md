# PolicyForge — Product Definition & Usability Review

*Prepared by product-norman (Don Norman lens), Cycle 2.*

---

## 1. Target User Groups and Primary Scenarios

### 1.1 Core user groups

PolicyForge serves B2B SaaS startups in the US/EU with **10–100 employees**, roughly **$1–10M ARR**, and **no dedicated security/compliance hire** (`docs/research/cycle-1-ideas.md:37`). The person who actually uses the product is rarely a compliance professional. More often, compliance has been dropped on them by a customer, an investor, or an upcoming audit date.

| Persona | Who they are | What they know | What they fear |
|---------|--------------|----------------|----------------|
| **The Accidental Compliance Owner (primary)** | Founder, CTO, VP of Ops, Head of IT/People | Cloud stack, company workflow, zero policy-writing experience | “I don’t know where to start,” “The auditor is going to reject this,” “I’ll waste money on the wrong thing.” |
| **The Security-Adjacent Operator** | Engineering manager, senior engineer, IT lead | Comfortable with GitHub, AWS, SaaS tools | Needs a draft they can review, customize, and defend to leadership. |
| **The Compliance Consultant / Fractional vCISO** | External advisor helping multiple seed-stage clients | Understands frameworks and auditor expectations | Wants exportable control mapping and a defensible baseline they can edit quickly. |
| **The Finance/Procurement Gatekeeper** | CFO, COO, or budget owner | Little about compliance mechanics | Worried about hidden recurring charges and legal liability. |

### 1.2 Primary scenarios

**Scenario A — “The audit clock is ticking.”**
A founder’s enterprise customer demands a SOC 2 report in 30 days. She searches “SOC 2 policy template startup,” lands on PolicyForge, and needs to know within minutes whether she can generate something she can hand to an auditor next week.

**Scenario B — “Can I trust this before I buy?”**
A CTO needs to show his CEO and part-time lawyer what the output looks like. He uses the free preview to generate one policy and a partial control map, then decides whether the $199 starter pack is worth it.

**Scenario C — “I bought it — now what?”**
After purchase, the user downloads a 15–25 document pack plus a CSV control map. He must edit the policies to match real procedures, assign owners, collect evidence, and submit to an auditor. He needs guidance, not just files.

**Scenario D — “It’s been a year.”**
A Growth/Scale customer needs an annual refresh. Frameworks or the company’s stack have changed. She expects a redline update and a clear signal of what has changed.

---

## 2. Cognitive-Design Evaluation of the Core Flow

The proposed MVP flow is: **landing page → intake questionnaire → free preview of one policy → payment → full-pack download** (`docs/ceo/prfaq-policyforge.md:75-79`). Below is a cognitive evaluation of each stage.

### 2.1 Intake questionnaire

**What is asked:** framework, stack, team, subprocessors, geography (`docs/ceo/prfaq-policyforge.md:76`).

**Cognitive findings:**

- **Vocabulary mismatch.** “Subprocessors” is compliance jargon. A founder is more likely to think in terms of “tools we pay for” or “apps we use.” When the system’s language does not match the user’s mental model, the user either guesses wrong or stops to search for definitions.
- **Hidden mapping.** The user cannot see how each answer changes the output. Every question feels like a tax, not a step toward a visible artifact.
- **Stack abstraction is brittle.** Pre-defined options like AWS/GCP/Azure, GitHub, Slack, Stripe, Notion/Linear are a good start (`docs/research/cycle-1-ideas.md:37`), but they miss adjacent tools the auditor will ask about: identity provider (Google Workspace, Okta, JumpCloud), endpoint management (Jamf, Fleet, Intune), SIEM/log aggregation (Splunk, Datadog, SentinelOne), and background checks (Checkr, Certn).
- **Progress and memory risk.** A 10–15 minute questionnaire is long for a single-session web form. If there is no save/resume, real interruptions will cause drop-off.
- **Expectation mismatch around evidence upload.** The press release states that users “upload key configuration evidence” (`docs/ceo/prfaq-policyforge.md:11`), but the MVP scope only lists a questionnaire (`docs/ceo/prfaq-policyforge.md:76`). Users will look for an upload affordance that does not exist.

### 2.2 Free preview

**What is shown:** one tailored policy (e.g., Acceptable Use Policy) and a partial control map (`docs/ceo/prfaq-policyforge.md:55`).

**Cognitive findings:**

- **Representativeness problem.** Acceptable Use Policy is one of the easier, more generic policies. It does not prove that the hard policies — Risk Assessment Procedure, Vendor Management Policy, Incident Response Plan — are accurate. A user who sees a good Acceptable Use Policy may overestimate the quality of the entire pack.
- **Teaser balance is fragile.** If the preview is too complete, the user may treat it as sufficient and never pay. If it is too thin, the user cannot judge value and abandons.
- **Paywall timing is unclear.** “You pay only when you download the full pack” (`docs/ceo/prfaq-policyforge.md:55`) implies a hard paywall at download. Users need to see price, deliverables, and format before they commit.
- **Mental-model risk.** The preview is a static document. Users may not understand that the full pack is also a *draft* that requires human review.

### 2.3 Full-pack download flow

**What is delivered:** 15–25 policies, DOCX/Markdown/PDF, control-mapping CSV, user account dashboard, 30-day edit window (`docs/ceo/prfaq-policyforge.md:78-80`).

**Cognitive findings:**

- **Information overload.** Receiving 15–25 documents at once, with no reading order or priority, is cognitively overwhelming. Users do not know which policy to edit first.
- **Missing task scaffolding.** The PR/FAQ frames the product as “ready for an auditor” (`docs/ceo/prfaq-policyforge.md:11`), but the downloaded files do not tell the user what to do next: assign owners, edit procedures, collect evidence, schedule review.
- **Format ambiguity.** A CSV control map may be unfamiliar to a non-compliance user. DOCX may format poorly when opened in Google Docs. Markdown may be ideal for GitHub but confusing for a lawyer used to Word.
- **Version and state uncertainty.** With a 30-day edit window (`docs/ceo/prfaq-policyforge.md:47-49`), users need clear version status: which file is current, what changed, and when the edits expire.

---

## 3. Predicted Affordance, Feedback, Mental-Model, and Error-Prevention Issues

### 3.1 Affordance issues

| Element | Predicted issue | Why it matters |
|---------|-----------------|----------------|
| **“Upload configuration evidence”** | False affordance. The PR/FAQ promises upload, the MVP does not support it (`docs/ceo/prfaq-policyforge.md:11` vs. `docs/ceo/prfaq-policyforge.md:76`). | Users will hunt for an upload button, conclude the product is broken, and churn. |
| **Preview document** | May not look like a preview. If it resembles a finished file, users may try to edit or download it. | Violates the “product should tell you what it does” principle. |
| **Progress bar** | Likely missing in a rapid MVP. | Users cannot tell if the questionnaire is 3 questions or 30. |
| **“Download” button at paywall** | May be mistaken for a free action. | Users feel tricked when payment appears. |

### 3.2 Feedback issues

- **Generation latency without status.** If policy generation takes “minutes” (`docs/ceo/prfaq-policyforge.md:31`), a blank screen or spinner-without-time-estimate will make users think the service failed.
- **No feedback on answer-to-output mapping.** The user does not see *why* the generated policy mentions AWS instead of GCP, so they cannot trust or debug the result.
- **No delivery confirmation.** If files are generated in the background and emailed, the system must confirm send, show a dashboard link, and allow re-send.
- **Weak renewal signals.** Growth/Scale customers may not understand when an annual refresh is due or what changed.

### 3.3 Mental-model issues

- **“AI-generated” is read as “final.”** Users may believe the policies are audit-ready out of the box. The disclaimer says “starting point” (`docs/ceo/prfaq-policyforge.md:35`), but the marketing language “audit-grade” and “auditor-grade” (`docs/research/cycle-1-ideas.md:34`, `docs/ceo/prfaq-policyforge.md:7`) can override that.
- **Tool vs. platform confusion.** Some users will expect continuous monitoring like Vanta or Drata. PolicyForge is a document-generation wedge (`docs/research/cycle-1-ideas.md:64`), and this distinction must be explicit.
- **One-time vs. recurring misunderstanding.** The Starter is one-time; Growth/Scale are annual (`docs/ceo/prfaq-policyforge.md:47-49`). A user may buy Starter and be surprised it does not auto-renew or update.
- **“Compliance in a box.”** Users may think the product certifies compliance. The output must be framed as a draft to be reviewed by an auditor, consultant, or legal counsel.

### 3.4 Error-prevention issues

- **Framework selection is hard to change.** If a user selects SOC 2 but needs ISO 27001, the system must allow correction before and after payment without re-entering all data.
- **Generic output from missing details.** If the user skips subprocessor questions, the system may emit a generic policy that falsely claims AWS is used. This creates audit risk.
- **Lost progress.** A 10–15 minute form without auto-save is a single accidental tab-close away from churn.
- **Pay-before-preview regret.** With no money-back guarantee or visible sample, users may pay and then discover the output does not match their mental model.
- **Data deletion without backup.** If a user deletes their account, they may lose the only copy of their edited policies. The system should warn and email a final archive.

---

## 4. Specific Design Recommendations

All recommendations follow human-centered design principles: match the user’s mental model, make affordances visible, provide immediate feedback, and prevent errors through constraints.

### 4.1 Reframe the intake as a diagnostic, not an exam

- **One-screen screener first.** Ask framework, team size, and primary cloud stack on the landing page. Immediately show a personalized scope statement: *“We’ll generate 18 policies for SOC 2 Type I + AWS + Google Workspace, mapped to 47 controls. Estimated time: 8 minutes.”* This closes the feedback loop before the user invests effort.
- **Progressive disclosure.** Split the full intake into three collapsible sections: (1) Scope, (2) Context, (3) Evidence. Show a progress bar and estimated time remaining. Save after every section.
- **Plain language.** Replace “subprocessors” with “Tools and vendors your company uses.” Provide an *“I’m not sure / we don’t have this yet”* option to prevent false precision.
- **Smart defaults and autocomplete.** Pre-populate common SaaS stacks and let users add custom tools. Use recognized names, not categories.

### 4.2 Make the preview prove value without giving away the pack

- **Pick a high-value preview policy.** Use Information Security Policy or Access Control Policy — policies that clearly differ by stack — instead of Acceptable Use Policy. This better signals the product’s unique value.
- **Show the control-mapping snippet next to the policy.** Make the connection to audit requirements visible: *“This policy satisfies SOC 2 CC6.1, CC6.2, CC6.3.”*
- **Lock the rest visually.** Use clear “Locked in full pack” indicators, a deliverables list, and price. Do not rely only on a generic paywall.
- **Add an “expectation check” callout at the top of the preview:** *“This is a tailored first draft. Every policy must be reviewed against your actual procedures before submission.”*

### 4.3 Clarify the paywall and purchase affordances

- **Rename the CTA.** Use *“Generate & buy full pack — $199”* instead of a vague *“Download.”* Show price and format before checkout.
- **Side-by-side plan comparison.** Show Starter, Growth, and Scale with one-line usage scenarios: *“Starter: one-time draft,”* *“Growth: annual review + evidence checklist,”* *“Scale: multi-framework + gap analysis.”* (`docs/ceo/prfaq-policyforge.md:47-49`)
- **Disclaim before payment.** Surface the “not legal advice” disclaimer and the “draft to be reviewed” message at the point of purchase, not buried in the FAQ.

### 4.4 Turn the download into a task-centered dashboard

- **Post-purchase checklist, not just files.** Show four steps: (1) Assign policy owners, (2) Customize procedures, (3) Collect evidence from control map, (4) Review with auditor/consultant. Each step links to the relevant document or CSV.
- **Format guidance.** Label each export: *“DOCX — edit in Word or Google Docs,”* *“Markdown — store in GitHub/Notion,”* *“CSV — import into Vanta/Drata/Secureframe.”*
- **Version and state visibility.** Show generation date, last edit date, and a “What changed since last version” diff for Growth/Scale renewals.
- **Email backup.** Automatically email a zipped copy of the generated pack and a link to the dashboard.

### 4.5 Prevent errors and support recovery

- **Validate critical answers.** If the user selects a framework but leaves key stack fields empty, show a warning: *“We can generate a generic pack, but policies will be more accurate with your tools listed.”*
- **Allow answer editing before final generation.** Give a review screen before payment so users can fix framework or stack choices.
- **Auto-save and resume.** Persist intake progress in browser/local storage and, after email capture, on the server.
- **30-day edit window as a safety net.** Make it visible in the dashboard and remind users before it expires.
- **Data deletion warning.** If a user deletes data, warn that downloaded files remain their responsibility and offer a final archive.

---

## 5. Lightweight User-Testing Plan

### 5.1 Goal

Validate that the target user can complete the intake, understand the preview, make a purchase decision, and know what to do with the downloaded pack — all without human support.

### 5.2 Participants

- **5 target users** for moderated sessions: founders, CTOs, VP Ops, or compliance consultants at 10–100 employee B2B SaaS companies preparing for or recently completing a first SOC 2/ISO 27001 audit.
- **10+ landing-page testers** for an unmoderated 5-second test: *“What is this? Who is it for? How much does it cost?”*

### 5.3 Tasks and metrics

| Task | What we ask the participant to do | Success metric |
|------|-----------------------------------|----------------|
| T1 — Comprehension | Look at the landing page for 5 seconds and describe the product in one sentence. | ≥80% correctly identify it as a policy generator for first-time audits. |
| T2 — Intake | Complete the questionnaire unaided. | ≥80% completion; median time <10 minutes; ≤1 major hesitation per user. |
| T3 — Preview judgment | Review the free preview and explain whether they would buy. | Participants can name at least one concrete reason for or against purchase. |
| T4 — Purchase & download | Complete checkout (test mode) and download the pack. | 100% find the right export format for their workflow. |
| T5 — Post-purchase orientation | Find the policy they would edit first and explain the next steps. | ≥80% identify the control map and the need for auditor review. |

**Qualitative signals to capture:**
- Where users ask for help or scroll back and forth.
- Words they use to describe the output (“draft,” “template,” “final,” “certification”).
- Whether they understand the Starter vs. Growth/Scale difference.
- Whether the preview policy feels representative of the full pack.

### 5.4 Timeline

- **Day 1:** Recruit participants.
- **Days 2–3:** Run moderated think-aloud sessions.
- **Day 4:** Run landing-page 5-second test in parallel.
- **Day 5:** Synthesize findings, prioritize fixes, and pass a design backlog to the engineering team.

### 5.5 Definition of “ready to ship”

- Intake completion rate ≥80% and median time <10 minutes.
- ≥4 of 5 participants correctly describe the output as a draft requiring review.
- ≥4 of 5 participants can locate the control map and connect it to evidence collection.
- No critical usability blocker (e.g., users consistently fail to find the preview, misread the price, or believe the product certifies compliance).

---

## 6. Go / No-Go / Iterate Recommendation

**Recommendation: ITERATE, then GO.**

PolicyForge is the strongest first-cycle bet for Auto Company: the paid signal is clear (`docs/research/cycle-1-ideas.md:39-43`), the infrastructure burden is low (`docs/research/cycle-1-ideas.md:126`), and it targets a high-urgency buying moment (`docs/research/cycle-1-ideas.md:65`). However, the current intake/preview/download flow carries enough cognitive friction and trust risk that shipping it as-is would likely miss the Cycle 2 success targets: 20 paid customers, ≥5% free-to-paid conversion, and ≥70% auditor acceptance (`docs/ceo/prfaq-policyforge.md:95-99`).

### 6.1 Required iteration (1–2 weeks)

1. **Simplify and scaffold the intake.** Convert the questionnaire into a diagnostic with progressive disclosure, plain language, and auto-save.
2. **Upgrade the preview.** Show a stack-sensitive, high-value policy and a partial control map, with clear “locked” indicators and visible pricing.
3. **Add post-download guidance.** Replace a static file list with a task-centered dashboard and format guidance.
4. **Clarify disclaimers and expectations.** Place “draft, not legal advice” messaging at the point of generation, preview, purchase, and in every exported document footer.
5. **Fix affordance and feedback gaps.** Add progress indicators, generation status, email delivery confirmation, and version state.

### 6.2 Conditions to GO

- User-testing completion rate for intake ≥80%, median time <10 minutes.
- ≥80% of test participants correctly understand that the output is a draft to be reviewed by an auditor, consultant, or legal counsel.
- ≥30% free-to-paid intent in test, or a paid smoke test with ≥5% conversion.
- Legal disclaimer and UPL posture reviewed and approved.
- 30-day edit window, save/resume, and email backup are functional.

### 6.3 Conditions to NO-GO / PIVOT

- If, after iteration, fewer than 50% of target users can complete the intake unaided.
- If no participant sees value in the preview or perceives the output as “just another template.”
- If legal/auditor acceptance cannot be de-risked (this is a non-usability blocker that must be resolved before launch).

**Next action:** hand these design recommendations to `interaction-cooper` and `ui-duarte` for flow and visual refinement, then to `fullstack-dhh` for implementation. Run the user-testing plan immediately after a clickable prototype is available. CEO should make the final GO / NO-GO / PIVOT call once usability and legal risk data are in.
