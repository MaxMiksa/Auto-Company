# PolicyForge Pre-Mortem — Fatal-Flaw Analysis

**One-sentence judgment:** Oppose the current plan and **do not proceed** with a full Cycle 2 MVP until three fatal gaps are closed with real evidence — auditor acceptance, recurring willingness-to-pay, and defensible legal posture — because the current PR/FAQ is a bet that a low-infrastructure document generator can carry recurring revenue and legal immunity, and neither of those is proven.

---

## Pre-mortem: how PolicyForge died

Assume it is twelve months from now and PolicyForge is dead. We burned an 8-week cycle, launched on ProductHunt, sold a few dozen $199 Starter packs, got almost no renewals, and one angry customer whose auditor rejected the policies and blogged about it. Vanta or Drata released a cheap policy pack two weeks later. We are left with a Stripe account full of refunds, a GitHub repo nobody trusts, and a business that was a document sale pretending to be SaaS.

Why did it die? Invert the plan and the killers become obvious.

---

## Fatal flaws and how each kills us

### 1. It is a one-time document sale, not a recurring SaaS business.

Template marketplaces already monetize the same artifact for $41.30–$599 one-time (`docs/research/cycle-1-ideas.md:42`). The PR/FAQ prices the Starter at $199 one-time and the recurring tiers at $499–$999/year (`docs/ceo/prfaq-policyforge.md:47-49`). The supposed ongoing value — annual review, gap analysis, evidence checklist — is weak: a first-audit startup's stack does not change meaningfully in year one, and once policies are accepted, the natural behavior is to renew only if forced.

**How this kills us:** Most customers buy the $199 Starter and never upgrade or renew. Self-serve SEO or ProductHunt traffic converts at a CAC of $100–$250 per paying customer. With a natural lifetime value near $199, the LTV:CAC target of >3:1 (`docs/ceo/prfaq-policyforge.md:134`) is mathematically impossible. We end up with a consulting-style revenue line masquerading as SaaS, and the "recurring" Growth/Scale tiers become a fantasy.

### 2. Auditor acceptance is an unvalidated assumption, and if it is wrong the product is worthless.

The PR/FAQ admits this is a risk and says "early validation interviews with compliance professionals will confirm acceptance criteria before public launch" (`docs/ceo/prfaq-policyforge.md:39`) — but those interviews have not happened yet. The consensus memory explicitly lists "Will auditors/consultants accept AI-generated policies with light human editing?" as Open Question #1 (`memories/consensus.md:18`). Meanwhile the press release calls the output "auditor-grade" (`docs/ceo/prfaq-policyforge.md:7`) and promises it is "what auditors actually read first" (`docs/ceo/prfaq-policyforge.md:27`). That is a promise built on hope.

**How this kills us:** A customer takes the generated pack to a SOC 2 audit. The auditor says the policies are generic templates that do not map to actual implemented controls and require a consultant rewrite. The customer demands a refund, posts the story on Hacker News or Reddit, and the founder/compliance community treats PolicyForge as a cautionary tale. Trust — the only asset that matters in compliance — is destroyed before we reach 100 customers. No disclaimer repairs reputation damage.

### 3. Legal and unauthorized-practice-of-law risk is real and cannot be disclaimed away.

The product generates formal security, privacy, and compliance policies that are submitted to auditors and, indirectly, regulators (`docs/ceo/prfaq-policyforge.md:23`). The PR/FAQ's entire legal posture is "include a clear disclaimer" and "not a law firm or compliance consultancy" (`docs/ceo/prfaq-policyforge.md:34-35`). That is not a legal strategy; that is a prayer that a judge or regulator agrees with the disclaimer.

**How this kills us:** A customer fails an audit, loses an enterprise deal, and sues for negligent misrepresentation or breach of an implied warranty of fitness. Alternatively, a state bar or regulator classifies customized, fee-based policy generation as the unauthorized practice of law and issues a cease-and-desist. Even if we eventually win, the legal fees and operational distraction consume a young company with no legal budget. One lawsuit or one C&D erases the entire Year-1 SOM of $200k–$500k (`docs/research/cycle-1-ideas.md:51`).

### 4. There is no moat, and incumbents can copy the wedge in weeks.

The PR/FAQ's defensibility section claims a flywheel in which "more customers generate more stack combinations, which improves prompt coverage and policy quality" (`docs/ceo/prfaq-policyforge.md:83-85`). That is not a moat; that is data exhaust. The research file already lists at least six AI-native competitors — CyberPolicify, PoliWriter, GenIsec, ComplyAgent, GRC Policy Engine — plus static template stores and vCISO substitutes (`docs/research/cycle-1-ideas.md:43`, `docs/research/cycle-1-ideas.md:55-58`). Vanta, Drata, and Secureframe own trust, auditor relationships, and distribution; adding a document-only module is trivial for them.

**How this kills us:** Two weeks after we launch, Vanta announces a $99 AI policy pack for its installed base and prospects. Drata and Secureframe match. We cannot outspend them on trust or distribution, so our only lever becomes price. The race to the bottom turns the $499/year "Growth" plan into a $49 one-time offer, and we end up as a marginally prettier version of ComplianceDocs ($41.30 per pack, `docs/research/cycle-1-ideas.md:42`).

### 5. Garbage-in, garbage-out plus LLM hallucination can actively harm customers.

The intake is a "short questionnaire" completed in 10–15 minutes (`docs/ceo/prfaq-policyforge.md:31`), and the output is supposed to be "mapped to the controls each startup actually needs" (`docs/ceo/prfaq-policyforge.md:9`). First-time compliance buyers do not reliably know their own subprocessors, data flows, or control boundaries. Asked to generate 15–25 formal policies (`docs/ceo/prfaq-policyforge.md:23`), an LLM will confidently cite controls that do not apply, omit required evidence, or use boilerplate that contradicts the customer's actual practices.

**How this kills us:** A customer submits a pack with a wrong control mapping or a missing GDPR/HIPAA clause. The auditor issues a finding; the customer loses the deal that justified the audit in the first place. They blame us publicly, demand refunds, and possibly sue. Our support queue fills with "your AI gave me the wrong policy" tickets. The operating-cost target of < $5 per pack (`docs/ceo/prfaq-policyforge.md:100`) assumes zero human QA, which is incompatible with avoiding these errors at any scale.

### 6. The 8-week MVP scope is dangerously optimistic.

The MVP list includes a public landing page, Stripe checkout, intake questionnaire, LLM pipeline with stack-aware prompts and control mapping, DOCX/Markdown/PDF export, control-mapping CSV, free preview paywall, user dashboard, 30-day edit window, basic SEO, and marketplace listing (`docs/ceo/prfaq-policyforge.md:74-81`). The timeline is listed as 4–6 weeks (`docs/research/cycle-1-ideas.md:126`) despite multiple frameworks (SOC 2 Type I, ISO 27001:2022) and export formats. Building reliable, accurate, multi-framework policy generation in that window is a recipe for shipping garbage.

**How this kills us:** We rush to launch, the first customers receive inconsistent or inaccurate outputs, and the ProductHunt/Hacker News launch becomes a public demonstration of failure. First impressions in a trust-driven market are permanent. We do not get a second launch.

---

## Inversion checklist

| Question | Answer |
|---|---|
| Can this be done more simply? | Yes — sell a $99 one-time policy pack on Gumroad. But that is not the recurring $499/year business in the PR/FAQ. |
| Are we solving a real problem? | Yes, but so are $41 template packs and ChatGPT + Notion. Real problem ≠ defensible business. |
| What is the worst case? | Customer fails an audit and sues; Vanta releases a $99 competitor; CAC > LTV. All three are plausible. |
| If we proceed now, will we regret it in a year? | Very likely. The plan is confirmation bias dressed up as validation: the team saw Vanta's price umbrella and template-market sales and assumed those buyers will pay SaaS prices for AI output, while ignoring that Vanta owns the trust and distribution that create that umbrella. |

---

## Do not proceed — and what would change my mind

**Do not proceed** with a full Cycle 2 build as currently scoped. The open questions are not details to be filled in later; they are binary, company-killing risks that are being deferred until after engineering has been spent.

I will lift this veto if the following evidence is produced before the first line of production code is written:

1. **Auditor acceptance proof.** Three written statements from active SOC 2 Type I / ISO 27001 auditors or compliance consultants confirming that, with only light customer editing, an AI-generated policy pack is acceptable for a first audit. Not a sales call, not "sounds interesting" — acceptance criteria in writing.
2. **Recurring willingness-to-pay proof.** A landing-page or ad price test showing that at least 5% of qualified first-audit visitors will pre-pay or commit to a **$499/year** recurring plan (not just a $199 one-time pack).
3. **Legal clearance.** A credible, jurisdiction-specific opinion on unauthorized-practice-of-law risk and disclaimers in the U.S. (and EU, if targeting there) with a defensible position beyond "we have a disclaimer."
4. **Competitive moat or channel proof.** Evidence that we can acquire customers profitably and retain them for at least one renewal even if Vanta/Drata release a cheap document module, or a clear niche/channel they will not bother to serve.

If those four are positive, the idea becomes a "proceed with conditions" candidate. Until then, the answer is **no**.

Munger said: *"Invert, always invert."* Invert this plan and the ways it fails are obvious, numerous, and unmitigated. Do not proceed.
