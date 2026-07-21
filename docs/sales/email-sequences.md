# PolicyForge Cold Email Sequences

**Owner:** `sales-ross`  
**Status:** Ready-to-send templates  
**Send from:** A warmed-up `@policyforge.auto-company.dev` address  
**Send window:** Tuesday–Thursday, 10:00–11:00 AM recipient time zone  
**Tracking:** Log opens, replies, and bounces in a lightweight CRM (Notion/Airtable/HubSpot free tier).  

---

## Merge Fields

Use these variables in your mail-merge tool:

- `{{first_name}}` — recipient first name
- `{{company}}` — recipient company name
- `{{title}}` — recipient title
- `{{stack}}` — inferred stack (e.g., AWS, Google Workspace, Stripe, GitHub, Slack)
- `{{pain_signal}}` — one line from `outreach-list.md`
- `{{firm}}` — consultant firm name (consultant sequence)

---

## 1. Founder Sequence — 7 Touch

**Goal:** Reply + 10-minute preview call or waitlist signup.  
**Target:** Seed-stage B2B SaaS founders (10–100 employees) prepping for a first SOC 2 / ISO 27001 audit.  
**Expected reply rate:** 6–12%.

### Touch 1 — Intro (Day 0)

**Subject A:** Quick question about {{company}}'s SOC 2 prep  
**Subject B:** SOC 2 policy pack without the $10k consultant  

```
Hi {{first_name}},

I saw {{company}} is {{pain_signal}} — usually that means a SOC 2 or ISO 27001 audit is coming into view.

We are building PolicyForge to turn a 10-minute questionnaire into a tailored policy pack + control map, for a few hundred dollars instead of a $7,500 platform or consultant.

Worth a 30-second reply: are you prepping for an audit this quarter?

Best,
[Your Name]
PolicyForge

P.S. If you reply "yes," I will send a preview of the Information Security policy we would generate for {{company}}.
```

### Touch 2 — Value Proof (Day 3)

**Subject A:** How a 22-person SaaS got audit-ready in one day  
**Subject B:** From zero to a coherent SOC 2 draft in an afternoon

```
{{first_name}},

Following up — wanted to share a quick example.

A 22-person B2B SaaS (AWS, Google Workspace, Stripe, GitHub) used PolicyForge to generate their SOC 2 policy pack and control map in an afternoon. Their compliance lead said it got them "from zero to a coherent first draft before we committed to a $20k platform."

The output is a starting draft, not legal advice, but it is already mapped to the controls their auditor will test.

If you are in the same boat, happy to show you the preview for {{company}} — 10 minutes this week?

Best,
[Your Name]
```

### Touch 3 — Different Angle (Day 6)

**Subject A:** The hardest part of SOC 2 is not the audit — it is the writing  
**Subject B:** {{company}} + a 10-minute policy questionnaire

```
{{first_name}},

Most founders we talk to say the same thing: the auditor is not the blocker. The blocker is writing 15–25 policies that actually describe how {{company}} operates.

PolicyForge asks about your real stack — {{stack}} — and generates policies that name your actual systems, plus a control map the auditor can read first.

If SOC 2 prep is on your 2026 roadmap, a 10-minute preview call will show you whether the output is useful before you buy anything.

Worth it?

Best,
[Your Name]
```

### Touch 4 — Social Proof + Risk Reversal (Day 10)

**Subject A:** "We were quoted $15k for policy templates"  
**Subject B:** SOC 2 policy pack: $199 starter preview

```
{{first_name}},

One founder told us they were quoted $15,000 just for policy templates before the audit even started.

PolicyForge Starter is $199 one-time and generates the same foundational pack mapped to SOC 2 / ISO 27001 controls. If the draft is not useful, you are out the cost of a team lunch — not a five-figure retainer.

I can generate a preview for {{company}} in minutes. Reply "preview" and I will send the Information Security policy draft.

Best,
[Your Name]
```

### Touch 5 — Resource Share (Day 14)

**Subject A:** Free SOC 2 readiness checklist for {{company}}  
**Subject B:** 47 things auditors ask for first

```
{{first_name}},

No pitch — just a resource.

I put together a one-page SOC 2 readiness checklist that lists the 47 documents and evidence pieces auditors typically ask for first. It is the same list we used to build PolicyForge's intake questionnaire.

You can grab it here: [link to gated PDF or waitlist]

If you want the policy pack version generated for {{company}}, reply and I will send it.

Best,
[Your Name]
```

### Touch 6 — Direct Ask (Day 19)

**Subject A:** Can I close the {{company}} file?  
**Subject B:** Last call for a preview

```
{{first_name}},

I have reached out a few times about PolicyForge and SOC 2 prep for {{company}}. I do not want to clutter your inbox if this is not a priority right now.

If you would like a preview of the policy pack before we open the beta, just reply "yes" and I will generate it.

If not, no worries — I will close your file.

Best,
[Your Name]
```

### Touch 7 — Breakup (Day 25)

**Subject:** Closing your file (unless you reply)

```
{{first_name}},

I am closing the {{company}} file today. If SOC 2 prep becomes a priority later, feel free to grab the free checklist or book a preview at any time.

[Waitlist link]

Best,
[Your Name]
PolicyForge
```

---

## 2. Compliance Consultant Sequence — 4 Touch

**Goal:** 10-minute partner call + sample review + acceptance statement or rev-share discussion.  
**Target:** Independent compliance consultants and boutique advisory firms who write or review SOC 2 / ISO 27001 policies for startups.  
**Expected reply rate:** 10–20%.

### Touch 1 — Partnership Angle (Day 0)

**Subject A:** Partner question: AI policy drafts for your SOC 2 clients  
**Subject B:** Cut your SOC 2 policy prep time by 80%

```
Hi {{first_name}},

I noticed {{firm}} helps early-stage SaaS teams get through SOC 2 / ISO 27001 audits — a process that usually starts with writing (or rewriting) a stack of policies.

We are building PolicyForge to generate tailored first drafts: security, access, vendor, incident response, etc., plus a control map tied to the client's actual AWS/GCP, Google Workspace, Slack, Stripe, and the rest.

The idea is not to replace your review, but to give you a 90% complete draft you can edit and approve, so your clients spend less on billable hours and you can take on more engagements.

Worth a 10-minute call to see a sample?

Best,
[Your Name]
PolicyForge

P.S. Happy to set up a partner preview account and discuss a rev-share model if it makes sense.
```

### Touch 2 — Value Proof + Sample (Day 4)

**Subject A:** A sample Information Security policy for a 20-person SaaS  
**Subject B:** What PolicyForge output looks like for your clients

```
{{first_name}},

Here is a quick example of what PolicyForge generates.

For a 20-person SaaS on AWS, Google Workspace, Stripe, and GitHub, we produced a 12-page Information Security Policy, Access Control Policy, Vendor Management Policy, and Incident Response Plan — all mapped to the SOC 2 Trust Services Criteria and ISO 27001:2022 Annex A controls.

The draft took under 5 minutes to generate. Your team can edit, approve, and hand it to an auditor without starting from a blank page.

Can I send you a sample pack to review? No obligation — I would value your expert feedback.

Best,
[Your Name]
```

### Touch 3 — Objection Handler + Audit Acceptance (Day 9)

**Subject A:** Do auditors accept AI-generated policy drafts?  
**Subject B:** Your review + our draft = audit-ready policies

```
{{first_name}},

The most common question we get: will an auditor accept an AI-generated policy?

Our answer is no — not without human review. That is why we designed PolicyForge as a first-draft tool, not a substitute for a consultant. The client customizes the draft to their real practices, and a professional like you reviews and approves it before submission.

We are collecting acceptance statements from auditors and consultants who have reviewed the output. Would you be open to reviewing a sample and sharing a short written opinion on whether it is a viable starting draft?

Happy to compensate your time with a partner preview account or a small stipend.

Best,
[Your Name]
```

### Touch 4 — Final Ask / Breakup (Day 14)

**Subject:** Last call — partner preview for {{firm}}

```
{{first_name}},

This is my last note on the partner preview. If reviewing a stack of startup policies is part of your work at {{firm}}, I would love to send you a sample pack and get your candid feedback.

If the tool saves you time, we can talk about a partner arrangement. If not, I will close the loop and stop following up.

Just reply "send sample" if you are open to it.

Best,
[Your Name]
PolicyForge
```

---

## Sequence Timing Summary

| Sequence | Touches | Days between sends | Primary CTA |
|----------|---------|-------------------|-------------|
| Founder | 7 | 0, 3, 6, 10, 14, 19, 25 | Reply "yes" or book preview call |
| Consultant | 4 | 0, 4, 9, 14 | Review sample + acceptance statement / partner call |

---

## QA & Compliance Notes

- Always send from a warmed domain. Start with 5–10 manual emails per day, ramp to 50/day over two weeks.
- Track reply rate by sequence touch; pause any touch that drops below a 2% reply rate.
- Include an unsubscribe link in the footer from touch 1 onward.
- Never claim PolicyForge is legal advice or guarantees audit pass — use the same disclaimer language as the landing page.
- Update `{{stack}}` and `{{pain_signal}}` fields by scanning the recipient's website/job postings before sending.
