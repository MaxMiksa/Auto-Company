---
name: financial-unit-economics
description: Use when evaluating business model viability, analyzing profitability per customer/product/transaction, validating startup metrics (CAC, LTV, payback period), making pricing decisions, assessing scalability, comparing business models, or when user mentions unit economics, CAC/LTV ratio, contribution margin, customer profitability, break-even analysis, or needs to determine if a business can be profitable at scale.
---
# Financial Unit Economics

## Table of Contents
- [Purpose](#purpose)
- [When to Use](#when-to-use)
- [What Is It?](#what-is-it)
- [Workflow](#workflow)
- [Common Patterns](#common-patterns)
- [Guardrails](#guardrails)
- [Quick Reference](#quick-reference)

## Purpose

Financial Unit Economics analyzes the profitability of individual units (customers, products, transactions) to determine if a business model is viable and scalable. This skill guides you through calculating key metrics (CAC, LTV, contribution margin), interpreting ratios, conducting cohort analysis, and making data-driven decisions about pricing, marketing spend, and growth strategy.

## When to Use

Use this skill when:

- **Business model validation**: Determine if startup/new product can be profitable at scale
- **Pricing decisions**: Set prices based on target margins and customer economics
- **Marketing spend**: Assess ROI of acquisition channels, optimize CAC
- **Growth strategy**: Decide when to scale (raise funding, increase spend) based on unit economics
- **Product roadmap**: Prioritize features that improve retention or reduce churn (increase LTV)
- **Investor pitch**: Demonstrate business model viability with CAC, LTV, payback metrics
- **Channel optimization**: Compare profitability across customer segments or acquisition channels
- **Subscription models**: Analyze recurring revenue, churn, cohort retention curves
- **Marketplace economics**: Model take rate, supply/demand side economics, liquidity
- **Financial planning**: Forecast cash flow, runway, burn rate based on unit economics

Trigger phrases: "unit economics", "CAC/LTV", "customer acquisition cost", "lifetime value", "contribution margin", "payback period", "customer profitability", "break-even", "cohort analysis", "is this business viable?"

## What Is It?

**Financial Unit Economics** is the practice of measuring profitability at the most granular level (per customer, product, or transaction) to understand if revenue from a single unit exceeds the cost to acquire and serve it.

**Core components**:
- **CAC (Customer Acquisition Cost)**: Total sales/marketing spend ÷ new customers acquired
- **LTV (Lifetime Value)**: Revenue from customer over their lifetime minus variable costs
- **Contribution Margin**: (Revenue - Variable Costs) ÷ Revenue (as %)
- **LTV/CAC Ratio**: Measures return on acquisition investment (target: 3:1 or higher)
- **Payback Period**: Months to recover CAC from customer revenue
- **Cohort Analysis**: Track metrics over time for customer groups (by acquisition month/channel)

**Quick example:**

**Scenario**: SaaS startup, subscription model ($100/month), analyzing unit economics.

**Metrics**:
- **CAC**: $20k marketing spend, 100 new customers → CAC = $200
- **Monthly revenue per customer**: $100
- **Variable costs**: $20/customer/month (hosting, support)
- **Gross margin**: ($100 - $20) / $100 = 80%
- **Monthly churn**: 5% → Average lifetime = 1 / 0.05 = 20 months
- **LTV**: $100 revenue × 20 months × 80% margin = $1,600
- **LTV/CAC**: $1,600 / $200 = 8:1 ✓ (healthy, >3:1)
- **Payback period**: $200 CAC ÷ ($100 × 80% margin) = 2.5 months ✓ (good, <12 months)

**Interpretation**: Strong unit economics. Each customer generates 8× their acquisition cost. Can profitably scale marketing spend. Payback in 2.5 months means fast capital recovery.

**Core benefits**:
- **Early warning system**: Detect unsustainable business models before scaling losses
- **Data-driven growth**: Know when unit economics justify increasing spend
- **Channel optimization**: Identify which acquisition channels are profitable
- **Pricing power**: Quantify impact of price changes on profitability
- **Investor confidence**: Demonstrate path to profitability with clear metrics

## Workflow

Copy this checklist and track your progress:

```
Unit Economics Analysis Progress:
- [ ] Step 1: Define the unit
- [ ] Step 2: Calculate CAC
- [ ] Step 3: Calculate LTV
- [ ] Step 4: Assess contribution margin
- [ ] Step 5: Analyze cohorts
- [ ] Step 6: Interpret and recommend
```

**Step 1: Define the unit**

What is your unit of analysis? (Customer, product SKU, transaction, subscription). See [resources/template.md](resources/template.md#unit-definition-template).

**Step 2: Calculate CAC**

Total acquisition costs (sales + marketing) ÷ new units acquired. Break down by channel if applicable. See [resources/template.md](resources/template.md#cac-calculation-template) and [resources/methodology.md](resources/methodology.md#1-customer-acquisition-cost-cac).

**Step 3: Calculate LTV**

Revenue over unit lifetime minus variable costs. Use cohort data for retention/churn. See [resources/template.md](resources/template.md#ltv-calculation-template) and [resources/methodology.md](resources/methodology.md#2-lifetime-value-ltv).

**Step 4: Assess contribution margin**

(Revenue - Variable Costs) ÷ Revenue. Identify levers to improve margin. See [resources/template.md](resources/template.md#contribution-margin-template) and [resources/methodology.md](resources/methodology.md#3-contribution-margin-analysis).

**Step 5: Analyze cohorts**

Track retention, LTV, payback by customer cohort (acquisition month/channel/segment). See [resources/template.md](resources/template.md#cohort-analysis-template) and [resources/methodology.md](resources/methodology.md#4-cohort-analysis).

**Step 6: Interpret and recommend**

Assess LTV/CAC ratio, payback period, cash efficiency. Make recommendations (pricing, channels, growth). See [resources/template.md](resources/template.md#interpretation-template) and [resources/methodology.md](resources/methodology.md#5-interpreting-unit-economics).

Validate using [resources/evaluators/rubric_financial_unit_economics.json](resources/evaluators/rubric_financial_unit_economics.json). **Minimum standard**: Average score ≥ 3.5.

## Common Patterns

**Pattern 1: SaaS Subscription Model**
- **Key metrics**: MRR, ARR, churn rate, LTV/CAC, payback period, CAC payback
- **Calculation**: LTV = ARPU × Gross Margin % ÷ Churn Rate
- **Benchmarks**: LTV/CAC ≥3:1, Payback <12 months, Churn <5% monthly (B2C) or <2% (B2B)
- **Levers**: Reduce churn (increase LTV), upsell/cross-sell (increase ARPU), optimize channels (reduce CAC)
- **When**: Subscription business, recurring revenue, retention critical

**Pattern 2: E-commerce / Transactional**
- **Key metrics**: AOV (Average Order Value), repeat purchase rate, contribution margin per order, CAC
- **Calculation**: LTV = AOV × Purchase Frequency × Gross Margin % × Customer Lifetime (years)
- **Benchmarks**: Contribution margin ≥40%, Repeat purchase rate ≥25%, LTV/CAC ≥2:1
- **Levers**: Increase AOV (bundling, upsells), drive repeat purchases (loyalty programs), reduce variable costs
- **When**: Transactional business, e-commerce, retail

**Pattern 3: Marketplace / Platform**
- **Key metrics**: Take rate, GMV (Gross Merchandise Value), supply/demand CAC, liquidity
- **Calculation**: LTV = GMV per user × Take Rate × Gross Margin % ÷ Churn Rate
- **Benchmarks**: Take rate 10-30%, LTV/CAC ≥3:1 for both sides, network effects kicking in
- **Levers**: Increase take rate (value-added services), improve matching (increase GMV), balance supply/demand
- **When**: Two-sided marketplace, platform business

**Pattern 4: Freemium / PLG (Product-Led Growth)**
- **Key metrics**: Free-to-paid conversion rate, time to convert, paid user LTV, blended CAC
- **Calculation**: Blended LTV = (Free users × Conversion % × Paid LTV) - (Free user costs)
- **Benchmarks**: Conversion ≥2%, Time to convert <90 days, Paid LTV/CAC ≥4:1
- **Levers**: Increase conversion rate (improve product, optimize paywall), reduce time to value, lower CAC via virality
- **When**: Product-led growth, freemium model, viral product

**Pattern 5: Enterprise / High-Touch Sales**
- **Key metrics**: CAC (including sales team costs), sales cycle length, NRR (Net Revenue Retention), LTV
- **Calculation**: LTV = ACV (Annual Contract Value) × Gross Margin % × Average Customer Lifetime (years)
- **Benchmarks**: LTV/CAC ≥3:1, Sales efficiency (ARR added ÷ S&M spend) ≥1.0, NRR ≥110%
- **Levers**: Shorten sales cycle, increase ACV (upsell, premium tiers), improve retention (NRR)
- **When**: Enterprise sales, high ACV, long sales cycles

## Guardrails

**Critical requirements:**

1. **Fully-loaded CAC**: Include all acquisition costs (sales salaries, marketing spend, tools, overhead allocation). Underestimating CAC makes unit economics look better than reality. Common miss: excluding sales team salaries.

2. **True variable costs**: Only include costs that scale with each unit (COGS, hosting per user, transaction fees). Don't include fixed costs (rent, core engineering). LTV calculation requires accurate margin.

3. **Cohort-based LTV**: Don't average across all customers. Early cohorts ≠ recent cohorts. Track retention curves by cohort (acquisition month/channel). LTV should be based on observed retention, not assumptions.

4. **Time horizon matters**: LTV is a prediction. Use conservative assumptions. For new products, LTV estimates are unreliable (insufficient data). Weight recent cohorts more heavily.

5. **Payback period vs. LTV/CAC**: Both matter. High LTV/CAC but long payback (>18 months) strains cash. Fast payback (<6 months) allows rapid reinvestment. Optimize for both.

6. **Channel-level analysis**: Blended metrics hide truth. CAC and LTV vary by channel (paid search vs. referral vs. content). Analyze separately to optimize spend.

7. **Retention is king**: Small changes in churn have exponential impact on LTV. Improving monthly churn from 5% to 4% increases LTV by 25%. Retention improvements > acquisition improvements.

8. **Gross margin floor**: Need ≥60% gross margin for SaaS, ≥40% for e-commerce to be viable. Low margin means high LTV/CAC ratio still yields poor cash flow.

**Common pitfalls:**

- ❌ **Ignoring churn**: Assuming customers stay forever. Reality: churn compounds. Use cohort retention curves.
- ❌ **Vanity LTV**: Using unrealistic retention (e.g., 5 year LTV with 1 month of data). Stick to observed behavior.
- ❌ **Blended CAC**: Mixing profitable and unprofitable channels. Break down by channel, segment, cohort.
- ❌ **Not updating**: Unit economics change as product, market, competition evolve. Re-calculate quarterly.
- ❌ **Missing costs**: Forgetting support costs, payment processing fees, fraud losses, refunds. Track everything.
- ❌ **Premature scaling**: Growing before unit economics work (LTV/CAC <2:1). "We'll make it up in volume" rarely works.

## Quick Reference

**Key formulas:**

```
CAC = (Sales + Marketing Costs) ÷ New Customers Acquired

LTV (subscription) = ARPU × Gross Margin % ÷ Monthly Churn Rate

LTV (transactional) = AOV × Purchase Frequency × Gross Margin % × Lifetime (years)

Contribution Margin % = (Revenue - Variable Costs) ÷ Revenue

LTV/CAC Ratio = Lifetime Value ÷ Customer Acquisition Cost

Payback Period (months) = CAC ÷ (Monthly Revenue × Gross Margin %)

CAC Payback (months) = S&M Spend ÷ (New ARR × Gross Margin %)

Gross Margin % = (Revenue - COGS) ÷ Revenue

Customer Lifetime (months) = 1 ÷ Monthly Churn Rate

MRR (Monthly Recurring Revenue) = Sum of all monthly subscriptions

ARR (Annual Recurring Revenue) = MRR × 12

ARPU (Average Revenue Per User) = Total Revenue ÷ Total Users

NRR (Net Revenue Retention) = (Starting ARR + Expansion - Contraction - Churn) ÷ Starting ARR
```

**Benchmarks (varies by stage and industry):**

| Metric | Good | Acceptable | Poor |
|--------|------|------------|------|
| **LTV/CAC Ratio** | ≥5:1 | 3:1 - 5:1 | <3:1 |
| **Payback Period** | <6 months | 6-12 months | >18 months |
| **Gross Margin (SaaS)** | ≥80% | 60-80% | <60% |
| **Gross Margin (E-commerce)** | ≥50% | 40-50% | <40% |
| **Monthly Churn (B2C SaaS)** | <3% | 3-7% | >7% |
| **Monthly Churn (B2B SaaS)** | <1% | 1-3% | >3% |
| **CAC Payback (SaaS)** | <12 months | 12-18 months | >18 months |
| **NRR (SaaS)** | ≥120% | 100-120% | <100% |

**Decision framework:**

| LTV/CAC | Payback | Recommendation |
|---------|---------|----------------|
| <1:1 | Any | **Stop**: Losing money on every customer. Fix model or pivot. |
| 1:1 - 2:1 | >12 months | **Caution**: Marginal economics. Don't scale yet. Improve retention or reduce CAC. |
| 2:1 - 3:1 | 6-12 months | **Optimize**: Unit economics acceptable. Focus on improving before scaling. |
| 3:1 - 5:1 | <12 months | **Scale**: Good economics. Can profitably invest in growth. |
| >5:1 | <6 months | **Aggressive scale**: Excellent economics. Raise capital, increase spend rapidly. |

**Inputs required:**
- **Revenue data**: Pricing, ARPU, AOV, transaction frequency
- **Cost data**: Sales/marketing spend, COGS, variable costs per customer
- **Retention data**: Churn rate, cohort retention curves, repeat purchase behavior
- **Channel data**: CAC by acquisition channel, LTV by segment
- **Time period**: Cohort definition (monthly, quarterly), historical data range

**Outputs produced:**
- `unit-economics-analysis.md`: Full analysis with CAC, LTV, ratios, cohort breakdowns
- `cohort-retention-table.csv`: Retention curves by cohort
- `channel-profitability.csv`: CAC and LTV by acquisition channel
- `recommendations.md`: Pricing, channel, growth recommendations based on metrics
