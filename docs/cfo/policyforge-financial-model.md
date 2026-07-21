# PolicyForge Financial Model & Pricing Sanity Check

**Prepared by:** `cfo-campbell` (Patrick Campbell), Auto Company CFO  
**Scope:** Cycle 2 financial evaluation of PolicyForge, based on `docs/ceo/prfaq-policyforge.md` and `docs/research/cycle-1-ideas.md`.

---

## 1. Financial Conclusion (one sentence)

PolicyForge clears SaaS unit-economics hurdles in the base case (LTV:CAC > 10:1, gross margin > 90%, CAC payback < 2 months) and can be ramen-profitable with only a handful of paying customers, but the proposed $199 one-time Starter tier underprices the value delivered and drags ARPU; I recommend testing $349 / $599 / $1,199 instead.

---

## 2. Unit-Economics Model

### Core assumptions

| Variable | Base-case value | Stress-case value | Notes |
|---|---|---|---|
| **Pricing (current PR/FAQ)** | Starter $199 one-time, Growth $499/yr, Scale $999/yr | — | Tiers set by CEO PR/FAQ |
| **Tier mix** | 30% Starter / 60% Growth / 10% Scale | — | Assumed launch mix; validate with pricing-page data |
| **CAC** | $60 | $150 | Organic/self-serve launch (Product Hunt, SEO, cold outreach, marketplaces) |
| **Annual churn** | 30% | 60% | One-time Starter has 0% retention; recurring tiers assumed |
| **Variable cost per pack** | ~$2 API/storage + Stripe fee | — | LLM generation of 15–25 policies + control map |
| **Gross margin** | Derived from revenue − Stripe − variable cost | — | See calculation below |

### Step-by-step calculation (current prices)

**Blended Year-1 ARPU**

```
ARPU = 0.30 × $199 + 0.60 × $499 + 0.10 × $999
     = $59.70 + $299.40 + $99.90
     = $459.00
```

**Gross profit per customer by tier**

Stripe fee = 2.9% + $0.30 per transaction. Variable API/storage cost = $2.

| Tier | Price | Stripe fee | Variable cost | Gross profit | Gross margin |
|---|---:|---:|---:|---:|---:|
| Starter (one-time) | $199 | $6.07 | $2.00 | $190.93 | 96.0% |
| Growth (annual) | $499 | $14.77 | $2.00 | $482.23 | 96.6% |
| Scale (annual) | $999 | $29.27 | $2.00 | $967.73 | 96.9% |

**Blended gross profit and margin**

```
Blended GP = 0.30 × $190.93 + 0.60 × $482.23 + 0.10 × $967.73
           = $57.28 + $289.34 + $96.77
           = $443.39

Gross margin = $443.39 ÷ $459.00 = 96.6%
```

**LTV (Lifetime Value)**

For recurring tiers: `LTV = Gross profit ÷ Annual churn rate`.  
For one-time Starter: `LTV = Gross profit`.

| Churn scenario | Starter LTV | Growth LTV | Scale LTV | Blended LTV | LTV:CAC ($60) | LTV:CAC ($150) |
|---|---:|---:|---:|---:|---:|---:|
| **30% annual churn** | $190.93 | $1,607.43 | $3,225.76 | **$1,344.31** | **22.4:1** | **8.96:1** |
| **60% annual churn** | $190.93 | $803.72 | $1,612.88 | **$700.80** | **11.7:1** | **4.67:1** |

**CAC payback**

Recurring MRR from the mix:

```
MRR = 0.60 × ($499/12) + 0.10 × ($999/12)
    = $24.95 + $8.33
    = $33.28/mo
```

Monthly gross profit contribution:

```
Monthly GP = ($482.23/12 × 0.60) + ($967.73/12 × 0.10)
           = $24.11 + $8.06
           = $32.18/mo
```

```
CAC payback = $60 ÷ $32.18 = 1.86 months
CAC payback (stress CAC $150) = $150 ÷ $32.18 = 4.66 months
```

Because recurring tiers are billed annually upfront, **cash recovery is effectively immediate**: the first invoice covers the $60 CAC ~7×.

---

## 3. 8-Week Launch Cost Estimate (one-person team, cash out-of-pocket)

| Category | Item | 8-week cost | Notes |
|---|---|---:|---|
| **Infrastructure** | Domain (annual) | $12 | First-year registration |
| | Vercel Hobby / Cloudflare R2 / Resend | $0 | Free tiers cover launch volume |
| | Stripe | $0 | Transaction fees only |
| **Tools** | Analytics (Plausible, 2 months) | $18 | Can use free alternatives |
| | SEO / keyword research tool | $30 | One-month subscription |
| | GitHub, VS Code, etc. | $0 | Free plans |
| **API usage** | Claude API (dev, test, preview) | $60 | Test policy generations |
| **Marketing** | Product Hunt / Reddit / LinkedIn launch credits | $100 | Optional small paid validation |
| | Gumroad / template marketplace listing | $0 | Listing is free; transaction fees only |
| **One-time lean total** | | **$220** | |
| **+ 8-week operating reserve** | Fixed op cost ~$100/mo | **$200** | Covers tools before revenue |
| **Cash needed to launch + survive 8 weeks** | | **~$420** | Excludes founder/agent time |

### Ongoing operating cost baseline

Post-launch fixed operating cost is estimated at **$100/month**:

- Analytics, domain, light support tools, small marketing reserve.
- Production API costs are already included in the gross margin as a variable cost (~$2 per generated pack).

---

## 4. Pricing Recommendation

### Why the proposed $199 / $499 / $999 tiers need adjustment

| Proposed tier | Price | Financial problem |
|---|---|---|
| Starter | $199 one-time | Sits at the **point of marginal cheapness** and signals low quality; if too many buyers choose it, ARPU falls below the $350 PR/FAQ target and there is no recurring revenue. |
| Growth | $499/year | Revenue-maximizing in a static 1-year demand view, but likely underpriced versus value (replaces $7,500+ platforms or $1,000+ consultants). |
| Scale | $999/year | Multi-framework + gap analysis is worth far more than 2× Growth; direct AI competitors price all-framework offerings at $499/mo (~$6,000/year). |

### Recommended launch price test

| Tier | Recommended price | Includes |
|---|---|---|
| **Starter** (one-time) | **$349** | One framework, full 15–25 policy pack + control map, 30-day edits, no future updates |
| **Growth** (annual) | **$599/year** | One framework, annual policy review, evidence checklist, email support |
| **Scale** (annual) | **$1,199/year** | Multi-framework, gap analysis, annual refresh, priority support |
| **Custom / Audit support** | **Quote ($2,500+)** | Human review / vCISO-style support; acts as a high anchor and deflects liability |

### Impact of the recommended prices

Using the same 30/60/10 tier mix:

```
ARPU = 0.30 × $349 + 0.60 × $599 + 0.10 × $1,199
     = $104.70 + $359.40 + $119.90
     = $584.00

Blended GP = 0.30 × $336.58 + 0.60 × $579.33 + 0.10 × $1,161.93
           = $564.76

Gross margin = $564.76 ÷ $584.00 = 96.7%

LTV (30% churn) = $1,646.94
LTV:CAC ($60)   = 27.5:1
CAC payback     = $60 ÷ $38.65/mo = 1.55 months
```

Relative to the current prices, this raises blended ARPU by **27%** ($459 → $584) and LTV by **22%** ($1,344 → $1,647) with minimal incremental infrastructure cost.

### Van Westendorp reasoning (modeled, not survey-based)

Because we have no primary price-sensitivity survey, I inferred the four Van Westendorp curves from substitute pricing (template marketplaces, AI policy tools, compliance consultants) and known price floors.

| Price | Too cheap | Cheap / good value | Expensive | Too expensive |
|---:|---:|---:|---:|---:|
| $99 | 80% | 20% | 10% | 2% |
| $199 | 55% | 55% | 25% | 10% |
| $299 | 30% | 70% | 40% | 20% |
| $399 | 15% | 60% | 55% | 35% |
| $499 | 8% | 45% | 65% | 50% |
| $699 | 3% | 25% | 78% | 68% |
| $999 | 1% | 12% | 88% | 85% |
| $1,499 | 0% | 4% | 95% | 95% |

Derived price points:

- **Point of Marginal Cheapness (PMC):** ~$199 (too-cheap = cheap/good-value curves cross)
- **Optimal Price Point (OPP):** ~$332 (too-cheap = too-expensive curves cross)
- **Indifference Price Point (IDP):** ~$419 (cheap = expensive curves cross)
- **Point of Marginal Expensiveness (PME):** ~$1,499 (expensive = too-expensive curves cross)

**Interpretation:**

- The one-time optimal zone is roughly **$330–$420** (between OPP ~$332 and IDP ~$419). The proposed $199 one-time is below the PMC and risks signaling low quality. Raising it to **$349** (or testing $399) is safer.
- The PME (~$1,499) is far above the current Scale price, leaving room for a **$1,199+** premium tier.

### Gabor-Granger reasoning (projected demand curve)

For an 8-week launch audience of ~1,000 landing-page visitors, estimated purchase intent by price point:

| Price | Type | Est. conversion | Customers / 1,000 | First-year revenue / 1,000 |
|---:|---|---:|---:|---:|
| $199 | one-time | 7.5% | 75 | $14,925 |
| $299 | one-time | 5.5% | 55 | $16,445 |
| $349 | one-time | 5.0% | 50 | $17,450 |
| $399 | one-time | 4.5% | 45 | $17,955 |
| $499 | annual | 4.0% | 40 | $19,960 |
| $599 | annual | 3.3% | 33 | $19,767 |
| $699 | annual | 2.8% | 28 | $19,572 |
| $999 | annual | 1.8% | 18 | $17,982 |
| $1,199 | annual | 1.3% | 13 | $15,587 |

**Interpretation:**

- One-time revenue peaks near **$399**. **$349** is a conservative starting point; A/B test $349 vs. $399.
- Annual first-year revenue peaks near **$499**. Moving Growth from $499 to $599 is revenue-neutral if conversion drops only to ~3.33% (`$499/$599 × 4.0%`), which matches the estimate above. The upside is higher ARPU and stronger perceived value.
- Scale buyers are a smaller, less price-sensitive segment; the aggregate Gabor-Granger curve understates their willingness to pay because their alternative is a $5,000+ consultant or platform.

### Recommended pricing actions

1. **Launch with $349 / $599 / $1,199**, annual billing only. Do not offer monthly billing at launch (it adds churn and operational overhead).
2. **Run a 50/50 pricing-page A/B test** for 8 weeks: current prices vs. recommended prices. Optimize for **revenue per visitor**, not just conversion rate.
3. **Monitor Starter-to-Growth cannibalization.** If >40% of would-be Growth buyers choose Starter, de-feature Starter (e.g., limit to 5 core policies) or remove it.
4. **Add a "Contact us" custom tier** at $2,500+ as a high anchor and to deflect liability toward human review.
5. **If Starter conversion collapses, test $299 as the floor**, but do not go below PMC (~$199) or ARPU will miss the $350 target.

---

## 5. Ramen-Profitability Scenario

Assumption: post-launch **fixed operating cost = $100/month** (analytics, domain, light tools, modest marketing; no salary).

Variable cost per customer is already included in the gross margin. The break-even formula is:

```
Customers needed = Fixed monthly cost ÷ Monthly gross profit per customer
```

| Plan | Price | Monthly gross profit/customer | Customers needed at $100/mo | Customers needed at $300/mo |
|---|---|---:|---:|---:|
| Starter $199 (one-time, amortized) | $199 | $15.91/mo equiv. | 7/year | 19/year |
| **Starter $349 (recommended, one-time)** | $349 | **$28.05/mo equiv.** | **4/year** | **11/year** |
| Growth $499 (current, annual) | $499 | $40.19/mo | 3 | 8 |
| **Growth $599 (recommended, annual)** | $599 | **$48.28/mo** | **3** | **7** |
| Scale $999 (current, annual) | $999 | $80.64/mo | 2 | 4 |
| **Scale $1,199 (recommended, annual)** | $1,199 | **$96.83/mo** | **2** | **4** |
| **Recommended blended mix** (30/60/10) | $584 ARPU | **$38.65/mo** | **3** | **8** |

**Required ARPU for a given customer count**

At a 96.7% gross margin and $2 variable cost:

| Monthly op cost | Customers | Required ARPU/year | Required MRR/customer |
|---:|---:|---:|---:|
| $100 | 3 | $416 | $34.67 |
| $100 | 5 | $251 | $20.92 |
| $300 | 8 | $468 | $39.00 |
| $300 | 12 | $313 | $26.08 |

**Conclusion:** With the recommended prices, **3 paying customers** cover a $100/month operating cost. The PR/FAQ target of **20 paid customers in 8 weeks** would generate roughly **$11,680** in first-year revenue and immediately exceed ramen profitability.

---

## 6. Benchmarks vs SaaS Standards

| Metric | PolicyForge (current) | PolicyForge (recommended) | Healthy SaaS benchmark | Assessment |
|---|---|---|---|---|
| **Gross margin** | 96.6% | 96.7% | >80% (great >90%) | Excellent |
| **LTV:CAC** | 22.4:1 | 27.5:1 | >3:1 | Excellent; even stress >4.5:1 |
| **CAC payback** | 1.86 months | 1.55 months | <12 months | Excellent |
| **ARPU / ACV** | $459 | $584 | SMB SaaS $500–$1,000 | In range; improves with recommended pricing |
| **Annual churn** | 30% assumed | 30% assumed | B2B SaaS <20% | Biggest unknown; validate early |
| **NRR** | Unknown | Unknown | >100% with expansion | Depends on annual refresh / upsell |
| **One-person op cost** | ~$100/mo | ~$100/mo | N/A | Enables ramen profit with 3 customers |
| **Cash to launch** | ~$420 | ~$420 | N/A | Extremely lean |

---

## 7. Key Assumptions and Data Still Needed

| # | Assumption | Why it matters | Data needed |
|---|---|---|---|
| 1 | **30% annual churn** on recurring tiers | Drives LTV and payback | 12-month cohort retention; first renewal rate after audit |
| 2 | **CAC = $60** organic/self-serve | Determines LTV:CAC and scalability | Channel-level CAC after launch; paid acquisition ceiling |
| 3 | **Tier mix 30/60/10** | Drives blended ARPU and MRR | Actual pricing-page conversion by tier |
| 4 | **$2 variable cost per generated pack** | Determines gross margin | Log actual Anthropic API token usage per pack |
| 5 | **Auditor acceptance ≥70%** | Affects churn and word-of-mouth | Interviews with 3–5 auditors/consultants; customer-reported acceptance |
| 6 | **WTP curve inferred from substitutes** | Pricing recommendation is modeled, not measured | Run Van Westendorp / Gabor-Granger landing-page test for $349/$599/$1,199 |
| 7 | **Annual-only billing at launch** | Faster cash, lower churn | Test monthly billing only if annual conversion is too low |
| 8 | **No legal/liability cost** | UPL risk could add cost | Confirm disclaimer posture and any compliance-insurance requirement |

### Immediate next financial actions

1. **Build two pricing-page variants** (proposed vs. recommended) and split traffic 50/50 for the 8-week launch. Track **revenue per visitor**, not just conversion.
2. **Track CAC by channel** from day one (SEO, Product Hunt, cold outreach, template marketplaces).
3. **Measure 30-60-90 day retention and first renewal rate.** If annual churn is >50%, add a mandatory "audit readiness" milestone or annual-refresh upsell before renewal.
4. **Re-run this model at Cycle 2 close** with actual ARPU, CAC, and churn to set Cycle 3 pricing.

---

*No human input was requested. `memories/consensus.md` was not updated per current instructions.*
