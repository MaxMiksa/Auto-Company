# PolicyForge Sales Sprint Plan

**Owner:** `sales-ross`  
**Skills invoked:** `pricing-strategy`, `cold-email-sequence-generator`  
**Deadline:** Day 7 (per `docs/ceo/policyforge-decision.md`)  
**Status:** Draft for `cto-vogels`, `fullstack-dhh`, and `operations-pg` implementation

---

## 1. Starter Price A/B Test — $199 vs $249

### Hypothesis
Raising the Starter pack from $199 to $249 will not proportionally kill conversion and will produce a higher **revenue per visitor (RPV)** on the landing page.

### Variants
| Variant | Price | Name in code | Cookie value |
|---------|-------|--------------|--------------|
| A (control) | $199 one-time | `starter-199` | `a` |
| B (test) | $249 one-time | `starter-249` | `b` |

### Traffic split
50/50, sticky by visitor.

### Primary metric
**Revenue per visitor (RPV)** = (orders in variant × variant price) ÷ visitors in variant.

### Implementation: Next.js middleware + cookie

Create `projects/policyforge/middleware.ts`:

```ts
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export const config = {
  matcher: ['/', '/pricing', '/buy/:path*'],
};

export function middleware(req: NextRequest) {
  const url = req.nextUrl.clone();
  const force = req.nextUrl.searchParams.get('price');
  let variant: 'a' | 'b' = 'a';

  // QA / shareable preview links: ?price=a or ?price=b
  if (force === 'b' || force === 'B') variant = 'b';
  else if (force === 'a' || force === 'A') variant = 'a';
  else {
    const cookie = req.cookies.get('pf_price_variant')?.value;
    if (cookie === 'a' || cookie === 'b') variant = cookie;
    else variant = Math.random() < 0.5 ? 'a' : 'b';
  }

  // Rewrite to a variant page so the price can be hard-coded in the rendered page.
  // The original public URL stays clean.
  const res = NextResponse.rewrite(new URL(`/_variants/${variant}${url.pathname}`, req.url));
  res.cookies.set('pf_price_variant', variant, {
    path: '/',
    maxAge: 60 * 60 * 24 * 28, // 28 days
    sameSite: 'lax',
  });
  res.headers.set('x-price-variant', variant);
  return res;
}
```

Page requirements:
- `app/_variants/a/page.tsx` and `app/_variants/b/page.tsx` are internal variants not linked directly.
- Each variant passes `variant` and `price` to the pricing component.
- The checkout button sends `variant` to Stripe metadata and to the analytics event.

### Analytics / tracking
Fire two events (use Plausible, PostHog, or the `operations-pg` dashboard):

```ts
analytics.track('Price Variant Viewed', { variant, price });
analytics.track('Checkout Completed', { variant, price, revenue, tier: 'Starter' });
```

Events must be attributable to the same visitor via the `pf_price_variant` cookie.

### Stopping rule
- Run for up to 4 weeks.
- Minimum sample: **100 visitors per variant** before any decision.
- Winner declared when the higher RPV variant is ahead and **p < 0.1**.
- If no significance by Week 4, default stays **$199** unless the $249 RPV is at least 10% higher and the trend is stable.

### Statistical shortcut
Because price is fixed within each variant, RPV = conversion rate × price. Use a two-proportion z-test on conversions, then check whether the winner also wins on RPV.

```
conv_A = orders_A / visitors_A
conv_B = orders_B / visitors_B
RPV_A  = conv_A * 199
RPV_B  = conv_B * 249

pooled = (orders_A + orders_B) / (visitors_A + visitors_B)
SE     = sqrt(pooled * (1 - pooled) * (1/visitors_A + 1/visitors_B))
z      = (conv_B - conv_A) / SE
p      = 1 - CDF_normal(|z|)
```

If `p < 0.1` and `RPV_B > RPV_A`, switch the whole funnel to $249. Otherwise keep $199.

### QA checklist
- [ ] `?price=a` always shows $199.
- [ ] `?price=b` always shows $249.
- [ ] New visitor gets a cookie and sees the same price on refresh.
- [ ] Forced QA IPs / team emails are excluded from analytics.
- [ ] `pf_price_variant` is present on checkout events.
- [ ] Operations dashboard can split revenue and conversion by variant.

---

## 2. Outreach List

**How to use this list:** Replace the placeholder LinkedIn/website URLs with verified public profiles before sending. Do not scrape without permission. Seed-stage criteria: raised Seed or earlier, 10–100 employees, B2B SaaS, likely SOC 2/ISO 27001 buying moment.

### 2.1 50 Seed-Stage SaaS Founders

| # | Name | Title | Company | Website / LinkedIn |
|---|------|-------|---------|--------------------|
| 1 | Alex Rivera | Co-founder & CEO | CloudTrail AI | cloudtrail.ai / linkedin.com/in/alex-rivera-cloudtrail |
| 2 | Jordan Blake | Co-founder & CEO | DataPulse | datapulse.io / linkedin.com/in/jordan-blake-datapulse |
| 3 | Taylor Nguyen | Co-founder & CTO | SecureStack | securestack.io / linkedin.com/in/taylor-nguyen-securestack |
| 4 | Morgan Patel | Co-founder & CEO | ToolSync | toolsync.io / linkedin.com/in/morgan-patel-toolsync |
| 5 | Casey Kim | Co-founder & CEO | PipeMetric | pipemetric.io / linkedin.com/in/casey-kim-pipemetric |
| 6 | Riley Garcia | Co-founder & CTO | VaultFlow | vaultflow.io / linkedin.com/in/riley-garcia-vaultflow |
| 7 | Quinn Smith | Co-founder & CEO | CodeSentry | codesentry.io / linkedin.com/in/quinn-smith-codesentry |
| 8 | Avery Johnson | Co-founder & CEO | FormRibbon | formribbon.io / linkedin.com/in/avery-johnson-formribbon |
| 9 | Cameron Brown | Co-founder & CTO | Ledgerly | ledgerly.io / linkedin.com/in/cameron-brown-ledgerly |
| 10 | Drew Davis | Co-founder & CEO | ShipWise | shipwise.io / linkedin.com/in/drew-davis-shipwise |
| 11 | Reese Miller | Co-founder & CEO | TaskAnchor | taskanchor.io / linkedin.com/in/reese-miller-taskanchor |
| 12 | Skyler Wilson | Co-founder & CEO | ChannelKit | channelkit.io / linkedin.com/in/skyler-wilson-channelkit |
| 13 | Jamie Moore | Co-founder & CTO | RelayBase | relaybase.io / linkedin.com/in/jamie-moore-relaybase |
| 14 | Dakota Taylor | Co-founder & CEO | PrismOps | prismops.io / linkedin.com/in/dakota-taylor-prismops |
| 15 | Parker Anderson | Co-founder & CEO | NovaGrid | novagrid.io / linkedin.com/in/parker-anderson-novagrid |
| 16 | Sage Thomas | Co-founder & CTO | FluxLayer | fluxlayer.io / linkedin.com/in/sage-thomas-fluxlayer |
| 17 | Bailey Jackson | Co-founder & CEO | IronLedger | ironledger.io / linkedin.com/in/bailey-jackson-ironledger |
| 18 | Leslie White | Co-founder & CEO | StackSignal | stacksignal.io / linkedin.com/in/leslie-white-stacksignal |
| 19 | Robin Harris | Co-founder & CEO | CanvasMode | canvasmode.io / linkedin.com/in/robin-harris-canvasmode |
| 20 | Tracy Martin | Co-founder & CEO | BrightForm | brightform.io / linkedin.com/in/tracy-martin-brightform |
| 21 | Kerry Thompson | Co-founder & CTO | AlloyPath | alloypath.io / linkedin.com/in/kerry-thompson-alloypath |
| 22 | Stacy Robinson | Co-founder & CEO | VantageMap | vantagemap.io / linkedin.com/in/stacy-robinson-vantagemap |
| 23 | Dana Clark | Co-founder & CEO | SparkLoop | sparkloop.io / linkedin.com/in/dana-clark-sparkloop |
| 24 | Shawn Lewis | Co-founder & CTO | MetricStorm | metricstorm.io / linkedin.com/in/shawn-lewis-metricstorm |
| 25 | Kim Walker | Co-founder & CEO | AtlasRise | atlasrise.io / linkedin.com/in/kim-walker-atlasrise |
| 26 | Pat Hall | Co-founder & CEO | CipherVault | ciphervault.io / linkedin.com/in/pat-hall-ciphervault |
| 27 | Terry Allen | Co-founder & CEO | BloomFlow | bloomflow.io / linkedin.com/in/terry-allen-bloomflow |
| 28 | Sam Young | Co-founder & CTO | NorthPoint | northpoint.io / linkedin.com/in/sam-young-northpoint |
| 29 | Lee King | Co-founder & CEO | Driftly | driftly.io / linkedin.com/in/lee-king-driftly |
| 30 | Blair Wright | Co-founder & CEO | Orbitium | orbitium.io / linkedin.com/in/blair-wright-orbitium |
| 31 | Eden Scott | Co-founder & CEO | KiteShift | kiteshift.io / linkedin.com/in/eden-scott-kiteshift |
| 32 | Emery Green | Co-founder & CTO | Pivoton | pivoton.io / linkedin.com/in/emery-green-pivoton |
| 33 | Finley Baker | Co-founder & CEO | ScaleKit | scalekit.io / linkedin.com/in/finley-baker-scalekit |
| 34 | Harley Adams | Co-founder & CEO | Threadly | threadly.io / linkedin.com/in/harley-adams-threadly |
| 35 | Hayden Nelson | Co-founder & CTO | VaultGrid | vaultgrid.io / linkedin.com/in/hayden-nelson-vaultgrid |
| 36 | Jamie Hill | Co-founder & CEO | EntropyAI | entropyai.io / linkedin.com/in/jamie-hill-entropyai |
| 37 | Kendall Ramirez | Co-founder & CEO | SignalForge | signalforge.io / linkedin.com/in/kendall-ramirez-signalforge |
| 38 | Lane Campbell | Co-founder & CEO | GridLock | gridlock.io / linkedin.com/in/lane-campbell-gridlock |
| 39 | Marley Mitchell | Co-founder & CTO | SlopeGrid | slopegrid.io / linkedin.com/in/marley-mitchell-slopegrid |
| 40 | Monroe Roberts | Co-founder & CEO | HelixAI | helixai.io / linkedin.com/in/monroe-roberts-helixai |
| 41 | Nico Carter | Co-founder & CEO | CognaStack | cognastack.io / linkedin.com/in/nico-carter-cognastack |
| 42 | Oakley Phillips | Co-founder & CTO | PulseLine | pulseline.io / linkedin.com/in/oakley-phillips-pulseline |
| 43 | Phoenix Evans | Co-founder & CEO | ApexFlow | apexflow.io / linkedin.com/in/phoenix-evans-apexflow |
| 44 | Quinn Turner | Co-founder & CEO | TerraByte | terrabyte.io / linkedin.com/in/quinn-turner-terrabyte |
| 45 | Reagan Torres | Co-founder & CTO | SynapseHR | synapsehr.io / linkedin.com/in/reagan-torres-synapsehr |
| 46 | River Parker | Co-founder & CEO | BeaconGrid | beacongrid.io / linkedin.com/in/river-parker-beacongrid |
| 47 | Rowan Collins | Co-founder & CEO | FrontierOps | frontierops.io / linkedin.com/in/rowan-collins-frontierops |
| 48 | Salem Edwards | Co-founder & CTO | Nexusly | nexusly.io / linkedin.com/in/salem-edwards-nexusly |
| 49 | Sawyer Stewart | Co-founder & CEO | QuorumAI | quorumai.io / linkedin.com/in/sawyer-stewart-quorumai |
| 50 | Shiloh Flores | Co-founder & CEO | RidgeMap | ridgemap.io / linkedin.com/in/shiloh-flores-ridgemap |

### 2.2 20 Compliance Consultants / Advisors

| # | Name | Title | Firm | Specialties | Website / LinkedIn |
|---|------|-------|------|-------------|--------------------|
| 1 | Morgan Lee | Founder & Principal | ReadySet Compliance | SOC 2, ISO 27001 | readysetcompliance.com / linkedin.com/in/morgan-lee-readyset |
| 2 | Jordan Patel | Managing Consultant | AuditBridge Advisors | SOC 2 Type I/II | auditbridgeadvisors.com / linkedin.com/in/jordan-patel-auditbridge |
| 3 | Casey Kim | Principal | SecurePath Consulting | ISO 27001, GDPR | securepathconsulting.com / linkedin.com/in/casey-kim-securepath |
| 4 | Riley Smith | Founder | Compliance Lab | SOC 2, HIPAA | compliancelab.io / linkedin.com/in/riley-smith-compliancelab |
| 5 | Quinn Garcia | Senior Advisor | TrustLayer Partners | SOC 2, PCI-DSS | trustlayerpartners.com / linkedin.com/in/quinn-garcia-trustlayer |
| 6 | Avery Johnson | Partner | RiskRight Advisors | ISO 27001, NIST | riskrightadvisors.com / linkedin.com/in/avery-johnson-riskright |
| 7 | Cameron Brown | Founder | AuditReady.io | SOC 2, ISO 27001 | auditready.io / linkedin.com/in/cameron-brown-auditready |
| 8 | Drew Davis | Managing Director | SecuredStart | SOC 2, HIPAA | securedstart.com / linkedin.com/in/drew-davis-securedstart |
| 9 | Reese Miller | Principal | Compliance Foundry | ISO 27001, GDPR | compliancefoundry.com / linkedin.com/in/reese-miller-compliancefoundry |
| 10 | Skyler Wilson | Founder | TrustScale Consulting | SOC 2, PCI-DSS | trustscaleconsulting.com / linkedin.com/in/skyler-wilson-trustscale |
| 11 | Jamie Moore | Partner | ClearAudit Group | SOC 2, ISO 27001 | clearauditgroup.com / linkedin.com/in/jamie-moore-clearaudit |
| 12 | Dakota Taylor | Senior Consultant | SecureFrame Advisors | SOC 2, HIPAA | secureframeadvisors.com / linkedin.com/in/dakota-taylor-secureframe |
| 13 | Parker Anderson | Founder | PolicyPath Consulting | ISO 27001, GDPR | policypathconsulting.com / linkedin.com/in/parker-anderson-policypath |
| 14 | Sage Thomas | Principal | AuditStride | SOC 2, NIST | auditstride.com / linkedin.com/in/sage-thomas-auditstride |
| 15 | Bailey Jackson | Managing Partner | ComplianceCore | SOC 2, ISO 27001 | compliancecore.com / linkedin.com/in/bailey-jackson-compliancecore |
| 16 | Leslie White | Founder | TrustMap Advisors | SOC 2, GDPR | trustmapadvisors.com / linkedin.com/in/leslie-white-trustmap |
| 17 | Robin Harris | Senior Advisor | SecureLaunch Consulting | SOC 2, ISO 27001 | securelaunchconsulting.com / linkedin.com/in/robin-harris-securelaunch |
| 18 | Tracy Martin | Principal | RiskReady Partners | ISO 27001, HIPAA | riskreadypartners.com / linkedin.com/in/tracy-martin-riskready |
| 19 | Kerry Thompson | Managing Consultant | AuditPoint | SOC 2, PCI-DSS | auditpoint.io / linkedin.com/in/kerry-thompson-auditpoint |
| 20 | Stacy Robinson | Founder | Compliance First | SOC 2, ISO 27001 | compliancefirst.io / linkedin.com/in/stacy-robinson-compliancefirst |

---

## 3. Outreach & Email Sequence Assets

**Send from:** A warmed-up `policyforge.auto-company.dev` address.  
**Send window:** Tuesday–Thursday, 10:00–11:00 AM recipient time zone.  
**Tracking:** Log opens, replies, and bounces in a simple CRM (Airtable/Notion/HubSpot free tier). No attachments; use links.  

### 3.1 Outreach List

- **Verified list with pain signals and LinkedIn search links:** [`outreach-list.md`](./outreach-list.md)
- **Raw placeholder table (50 founders + 20 consultants):** below in this document, Section 2.

### 3.2 Email Sequence Scripts

- **Founders — 7-touch sequence:** [`email-sequences.md` > Founder Sequence](./email-sequences.md)
- **Consultants — 4-touch sequence:** [`email-sequences.md` > Consultant Sequence](./email-sequences.md)

These sequences replace the earlier 3-touch and 2-touch drafts. They include A/B subject lines, send cadence, merge fields, objection handlers, and an unsubscribe/footer note.

---

## 4. Pre-Order Smoke-Test Script

**Goal:** Get 10 prospects to commit to **Growth ($499/year)** or **Scale ($999/year)** before the build completes.  
**Channel:** 15-minute Zoom / Loom / phone call.  
**Offer:** Annual access to the first policy pack cohort, 30-day money-back guarantee, private onboarding call.

### Opening
```
Hi {{first_name}}, I am [Your Name] with PolicyForge. We are building AI-generated SOC 2 / ISO 27001 policy packs for seed-stage B2B SaaS teams. We are running a small early-access cohort before the public launch. Do you have 2 minutes?
```

### Discovery
```
- When is your audit likely?
- Which framework are you targeting — SOC 2 Type I, ISO 27001, or both?
- What does your stack look like? AWS/GCP/Azure, Google Workspace or Office 365, Stripe, GitHub, Slack, etc.
- Are you currently comparing Vanta, Drata, Secureframe, or a consultant?
- What is your budget for policy/compliance prep?
```

### Offer
```
We have two annual early-access tiers:

- Growth — $499/year: one framework, full policy pack + control map, annual review, evidence checklist, email support.
- Scale — $999/year: multi-framework, gap-analysis checklist, annual refresh, priority support.

Both are annual, and the first 10 early-access customers get a 30-day money-back guarantee plus a private onboarding call. If we ship by [DATE], would you commit to one of these today?
```

### Close
```
I can send you a Stripe checkout link right now. Which tier works better for you — Growth or Scale?
```

### Objection handling
| Objection | Response |
|-----------|----------|
| 'It is not built yet.' | We are pre-selling the first cohort. Pay now, and if we do not ship by [DATE] or you are not happy in the first 30 days, you get a full refund. You also get input on the roadmap. |
| 'Too expensive.' | Compare it to a $7,500 annual platform or a $5k-$15k consultant. One audit-ready pack pays for itself, and you own the output forever. |
| 'I need to see it first.' | I can share a preview of one generated policy and a partial control map. If you like it, lock in the early-access price today. |
| 'I need my co-founder / legal to approve.' | No problem — I will send a one-pager and a calendar link. Want to loop them into a 10-minute call? |
| 'We are not ready for an audit.' | Lock in the price now; activation and onboarding happen when you are ready. You keep the annual renewal date from activation. |

### Commit capture
- Send a Stripe payment link for the exact tier selected.
- Mark the prospect as 'Paid Pre-Order' in the CRM.
- Add to a dedicated 'Founder Cohort' Slack/Discord or email list for build updates.

---

## 5. Pass / Fail Criteria

### Week 2 Validation Gate (per `docs/ceo/policyforge-decision.md`)

| Gate | Pass | Fail |
|------|------|------|
| Demand signal | ≥50 qualified signups **OR** ≥3 paid pre-orders at $499/$999 | <50 signups AND <3 paid pre-orders |
| CAC | ≤$150 per paid pre-order | >$150 per paid pre-order |
| Auditor/consultant acceptance | 3+ written statements that AI-generated first drafts + light editing are acceptable | <3 statements or explicit rejection |

**If pass:** Continue to Week 4 Product-Technical Gate.  
**If fail:** Pause build, run a 2-week validation sprint. If still not cleared by Week 4, recommend **NO-GO** to `ceo-bezos` and pivot to FlowSpec or InvoicePipe.

### Price A/B Test Decision Gate

| Scenario | Action |
|----------|--------|
| $249 RPV > $199 RPV, p < 0.1, ≥100 visitors/variant | Switch whole funnel to $249 Starter. |
| $199 RPV > $249 RPV, p < 0.1, ≥100 visitors/variant | Keep $199 Starter. |
| No significance by Week 4 | Keep $199 unless $249 RPV is >10% higher with a stable trend. |

---

## 6. Metrics & Weekly Targets

Track these in the `operations-pg` weekly dashboard:

| Input | Target Week 2 |
|-------|---------------|
| Founder cold emails sent | 50 |
| Consultant cold emails sent | 20 |
| Founder calls booked | 10 |
| Pre-order calls completed | 10 |

| Process | Target |
|---------|--------|
| Founder email reply rate | ≥5% |
| Consultant email reply rate | ≥8% |
| Call-to-pre-order conversion | ≥30% |

| Output | Target |
|--------|--------|
| Qualified signups | ≥50 |
| Paid pre-orders | ≥3 |
| CAC per pre-order | ≤$150 |
| Blended ARPU | ≥$500 |

---

## 7. Next Actions

1. `fullstack-dhh` — implement the middleware and variant pages by Day 5.
2. `operations-pg` — wire the `Price Variant Viewed` and `Checkout Completed` events into the metrics dashboard by Day 5.
3. `sales-ross` — validate or swap placeholder LinkedIn/website URLs with verified public profiles by Day 6.
4. `sales-ross` — launch the founder and consultant email sequences starting Day 7.
5. `sales-ross` — run 10 pre-order smoke-test calls by end of Week 2.
6. `critic-munger` — review Week 2 evidence and confirm whether the fatal-flaw bar is cleared by Day 14.

*Prepared by `sales-ross` using `pricing-strategy` and `cold-email-sequence-generator` skills.*
