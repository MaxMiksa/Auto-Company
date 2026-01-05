# Financial Unit Economics Methodology

Advanced techniques for calculating, analyzing, and optimizing unit economics.

## Table of Contents
1. [Customer Acquisition Cost (CAC)](#1-customer-acquisition-cost-cac)
2. [Lifetime Value (LTV)](#2-lifetime-value-ltv)
3. [Contribution Margin Analysis](#3-contribution-margin-analysis)
4. [Cohort Analysis](#4-cohort-analysis)
5. [Interpreting Unit Economics](#5-interpreting-unit-economics)
6. [Advanced Topics](#6-advanced-topics)

---

## 1. Customer Acquisition Cost (CAC)

### Fully-Loaded CAC Components

**Formula**: CAC = (Total S&M Costs) ÷ New Customers Acquired

**Sales & Marketing (S&M) Costs to include**:
- **Marketing spend**: Paid ads (Google, Facebook, LinkedIn), content marketing, SEO tools, events, sponsorships
- **Sales team compensation**: Base salaries, commissions, bonuses, benefits, taxes
- **Marketing team compensation**: Marketers, designers, writers, contractors
- **Sales tools**: CRM (Salesforce, HubSpot), sales engagement (Outreach, SalesLoft), analytics
- **Marketing tools**: Marketing automation (Marketo, Pardot), analytics (Google Analytics, Mixpanel), advertising platforms
- **Overhead allocation**: Portion of office space, admin support, IT costs attributable to S&M teams
- **Agency/consultant fees**: External agencies, freelancers, consultants for marketing or sales

**What NOT to include** (not acquisition costs):
- Engineering/product development (build the product, not acquire customers)
- Customer success/support (retain customers, not acquire)
- General & administrative (not directly related to acquisition)

### Time Period for CAC

**Match costs to revenue period**: If calculating monthly CAC, use monthly S&M costs and monthly new customers.

**Lag effect**: CAC spent today may yield customers next month. Adjust if significant lag (e.g., long sales cycles). Use 1-3 month lag for enterprise sales.

**Example**:
- Month 1: $50k S&M spend, 100 customers acquired → CAC = $500
- But if customers from Month 1 spend came from ads run in Month 0, adjust accordingly.

### CAC by Channel

Breaking down CAC by channel reveals which channels are efficient vs. inefficient.

**Method**: Track spend and new customers per channel.

**Example**:

| Channel | S&M Spend | New Customers | CAC | LTV | LTV/CAC |
|---------|-----------|---------------|-----|-----|---------|
| Paid Search | $30k | 100 | $300 | $900 | 3.0 |
| Organic | $10k | 100 | $100 | $1,200 | 12.0 |
| Referral | $5k | 50 | $100 | $1,500 | 15.0 |
| Paid Social | $20k | 50 | $400 | $700 | 1.75 |

**Insight**: Organic and Referral have best economics (low CAC, high LTV). Paid Social is unprofitable (LTV/CAC <2:1). Action: Increase organic/referral investment, pause paid social.

### CAC Trends Over Time

**Monitor CAC trends**: Is CAC increasing or decreasing over time?

**Causes of rising CAC**:
- Market saturation (exhausted easy channels)
- Increased competition (competitors bidding up ad costs)
- Product-market fit weakening (harder to acquire customers)
- Inefficient spend (poor targeting, low conversion rates)

**Causes of falling CAC**:
- Improved conversion rates (better landing pages, messaging)
- Brand awareness (more direct/organic traffic)
- Product-led growth (virality, word-of-mouth)
- Channel optimization (focusing on best-performing channels)

---

## 2. Lifetime Value (LTV)

### LTV Calculation Methods

**Method 1: Simple LTV (Subscription)**

```
LTV = ARPU × Gross Margin % ÷ Monthly Churn Rate
```

**When to use**: Early-stage SaaS, limited data, need quick estimate.

**Example**:
- ARPU = $50/month
- Gross Margin = 80%
- Monthly Churn = 5%
- LTV = $50 × 80% ÷ 0.05 = $50 × 80% × 20 months = $800

**Method 2: Cohort-Based LTV (More Accurate)**

Track actual retention by cohort, sum revenue over observed periods.

```
LTV = ARPU × Gross Margin × Σ(Retention at month i)
```

**Example Cohort** (acquired Jan 2024):

| Month | Retention % | Revenue (ARPU × Retention) | Cumulative |
|-------|-------------|----------------------------|------------|
| 0 | 100% | $50 × 1.0 = $50 | $50 |
| 1 | 95% | $50 × 0.95 = $47.50 | $97.50 |
| 2 | 88% | $50 × 0.88 = $44 | $141.50 |
| 3 | 80% | $50 × 0.80 = $40 | $181.50 |
| 6 | 60% | $50 × 0.60 = $30 | ~$280 |
| 12 | 40% | $50 × 0.40 = $20 | ~$450 |

LTV = $450 × 80% gross margin = **$360**

Note: This is more conservative than simple LTV ($800) because early churn is higher than average.

**Method 3: Predictive LTV (Machine Learning)**

Use historical data to predict future retention and spending patterns. Advanced approach for companies with large datasets.

**Inputs**: Customer attributes (demographics, behavior, acquisition channel), historical purchase/churn data.

**Model**: Regression, survival analysis, or ML model predicts LTV for each customer segment.

### LTV for Different Business Models

**Transactional (E-commerce)**:

```
LTV = AOV × Purchase Frequency × Gross Margin % × Customer Lifetime (years)
```

**Example**:
- AOV = $100
- Purchases/year = 3
- Gross Margin = 50%
- Lifetime = 2 years
- LTV = $100 × 3 × 50% × 2 = $300

**Marketplace**:

```
LTV = GMV per user × Take Rate × Gross Margin % ÷ Churn Rate
```

**Example** (ride-sharing):
- Monthly GMV per rider = $200 (total rides)
- Take Rate = 25%
- Gross Margin = 80% (after payment processing)
- Monthly Churn = 10%
- Lifetime = 1 ÷ 0.10 = 10 months
- Monthly Revenue = $200 × 25% = $50
- LTV = $50 × 10 months × 80% = $400

**Freemium**:

```
Blended LTV = (Free-to-Paid Conversion % × Paid User LTV) - (Free User Costs × Avg Free User Lifetime)
```

**Example**:
- 100 free users, 5% convert to paid
- Paid LTV = $1,000
- Free user cost = $2/month (hosting), avg lifetime 6 months
- Blended LTV = (0.05 × $1,000) - ($2 × 6) = $50 - $12 = $38 per free user

### Improving LTV

**Levers to increase LTV**:

1. **Reduce churn**: Improve onboarding, product engagement, customer success. 1% churn reduction → 10-25% LTV increase.
2. **Increase ARPU**: Upsells, cross-sells, premium tiers, usage-based pricing.
3. **Improve gross margin**: Reduce COGS, optimize infrastructure, negotiate better rates.
4. **Extend lifetime**: Long-term contracts, annual billing (locks in customers).

**Example impact** (SaaS):
- Current: ARPU $50, Churn 5%, Margin 80% → LTV = $800
- Reduce churn to 4%: LTV = $50 × 80% ÷ 0.04 = $1,000 (+25%)
- Increase ARPU to $60: LTV = $60 × 80% ÷ 0.05 = $960 (+20%)
- Both: LTV = $60 × 80% ÷ 0.04 = $1,200 (+50%)

---

## 3. Contribution Margin Analysis

### Contribution Margin Formula

```
Contribution Margin = Revenue - Variable Costs
Contribution Margin % = (Revenue - Variable Costs) ÷ Revenue
```

**Variable costs** (scale with each unit):
- COGS (cost of goods sold)
- Hosting/infrastructure per user
- Payment processing fees (2-3% of revenue)
- Customer support (per-customer time)
- Shipping/fulfillment
- Transaction-specific costs

**Fixed costs** (do NOT include):
- Engineering salaries (build product once)
- Rent, utilities
- Admin, HR, finance teams

### Contribution Margin by Business Model

**SaaS**:
- Revenue: $100/month subscription
- Variable costs: $15 hosting + $3 payment fees = $18
- Contribution Margin: $100 - $18 = $82
- Margin %: 82%

**E-commerce**:
- Revenue: $80 product sale
- Variable costs: $30 COGS + $5 shipping + $2.40 payment fees = $37.40
- Contribution Margin: $80 - $37.40 = $42.60
- Margin %: 53%

**Marketplace**:
- GMV: $200 transaction
- Take Rate: 20% → Revenue = $40
- Variable costs: $2 payment fees + $3 support = $5
- Contribution Margin: $40 - $5 = $35
- Margin %: 87.5% (of platform revenue)

### Improving Contribution Margin

**Levers**:
1. **Increase prices**: Directly increases revenue per unit.
2. **Reduce COGS**: Negotiate supplier costs, economies of scale, vertical integration.
3. **Optimize infrastructure**: Right-size hosting, use cheaper providers, optimize usage.
4. **Automate support**: Self-service, chatbots, knowledge base reduce manual support time.
5. **Negotiate fees**: Lower payment processing rates (volume discounts), reduce transaction costs.

**Example** (E-commerce):
- Current: Revenue $80, COGS $30, Margin 53%
- Negotiate COGS to $25: Margin = ($80 - $32.40) / $80 = 59.5% (+6.5pp)
- Increase price to $90: Margin = ($90 - $37.65) / $90 = 58% (+5pp)
- Both: Margin = ($90 - $32.65) / $90 = 63.7% (+10.7pp)

---

## 4. Cohort Analysis

### Why Cohort Analysis Matters

**Problem with averages**: Blending all customers hides important trends. Early customers may have different behavior than recent customers.

**Cohort analysis**: Track customers grouped by acquisition period (month, quarter) to see how metrics evolve.

**Benefits**:
- Detect improving/worsening trends
- Compare channels/segments
- Forecast future LTV based on observed behavior

### Building a Retention Cohort Table

**Structure**: Rows = cohorts (acquisition month), Columns = months since acquisition.

**Example**:

| Cohort | M0 | M1 | M2 | M3 | M6 | M12 |
|--------|----|----|----|----|----|----|
| Jan 2024 | 100% | 92% | 84% | 78% | 62% | 42% |
| Feb 2024 | 100% | 90% | 81% | 75% | 60% | - |
| Mar 2024 | 100% | 93% | 86% | 80% | 65% | - |
| Apr 2024 | 100% | 91% | 83% | 77% | - | - |

**Insights**:
- **Improving retention**: Mar cohort (93% M1 retention) > Jan cohort (92%). Product improvements working.
- **Stable long-term retention**: ~60% at M6 across cohorts. Predictable LTV.

### Calculating LTV from Cohorts

**Method**: Sum revenue at each time period, weighted by retention.

**Example** (Jan 2024 cohort, ARPU $50, Margin 80%):

LTV = $50 × 80% × (1.0 + 0.92 + 0.84 + 0.78 + ... + 0.42 at M12)

Approximate sum of retention % = ~9.5 months equivalent

LTV = $50 × 80% × 9.5 = **$380**

**More accurate**: Sum all observed months, extrapolate tail based on churn rate stabilization.

### Cohort Analysis by Channel

Compare retention and LTV across acquisition channels.

**Example**:

| Channel | M0 | M1 | M3 | M6 | M12 | LTV |
|---------|----|----|----|----|-----|-----|
| Organic | 100% | 95% | 85% | 70% | 55% | $450 |
| Paid Search | 100% | 88% | 75% | 55% | 35% | $300 |
| Referral | 100% | 97% | 90% | 75% | 60% | $500 |

**Insight**: Referral has best retention and LTV. Paid Search has worst retention (high early churn). Focus on referral growth.

### Trends to Monitor

1. **Retention curve shape**: Does churn stabilize (flatten) after a few months, or continue accelerating?
2. **Cohort improvement**: Are newer cohorts retaining better than older cohorts? (Product improvements working)
3. **Channel differences**: Which channels yield stickiest customers?
4. **Time to payback**: How long until cumulative revenue (× margin) > CAC?

---

## 5. Interpreting Unit Economics

### LTV/CAC Ratio Benchmarks

| Ratio | Assessment | Recommendation |
|-------|------------|----------------|
| <1:1 | **Unsustainable** | Losing money on every customer. Fix or pivot. |
| 1-2:1 | **Marginal** | Barely profitable. Don't scale yet. |
| 2-3:1 | **Acceptable** | Unit economics work. Optimize before scaling. |
| 3-5:1 | **Good** | Can profitably grow. Scale marketing spend. |
| >5:1 | **Excellent** | Strong economics. Aggressive growth, raise capital. |

**Why 3:1 is the target**:
- 1× covers CAC
- 1× covers operating expenses (R&D, G&A, customer success)
- 1× profit

**Context matters**:
- **Payback period**: 10:1 LTV/CAC with 24-month payback is worse than 4:1 with 6-month payback (cash strain).
- **Market size**: Low LTV/CAC acceptable if huge market (can still build large business).
- **Stage**: Early-stage startups may accept 2-3:1 while finding product-market fit. Growth-stage should target >3:1.

### Payback Period Benchmarks

| Payback | Assessment | Cash Impact |
|---------|------------|-------------|
| <6 months | **Excellent** | Can reinvest quickly, fuel rapid growth. |
| 6-12 months | **Good** | Manageable, standard for SaaS. |
| 12-18 months | **Acceptable** | Need patient capital, slower growth. |
| >18 months | **Challenging** | High cash burn, risky. Hard to scale. |

**Why payback matters**: Short payback = fast capital recovery = can reinvest in growth without needing external funding.

**Example**:
- Company A: LTV/CAC 8:1, Payback 18 months → High cash burn, slow reinvestment despite good ratio.
- Company B: LTV/CAC 4:1, Payback 6 months → Faster reinvestment, can scale more aggressively.

### Cash Efficiency Metrics

**CAC Payback (SaaS-specific)**:

```
CAC Payback (months) = S&M Spend ÷ (New ARR × Gross Margin %)
```

**Example**:
- Q1 S&M spend: $100k
- New ARR added: $120k
- Gross Margin: 80%
- CAC Payback = $100k ÷ ($120k × 80%) = 1.04 quarters = ~3.1 months

**Sales Efficiency (Magic Number)**:

```
Sales Efficiency = (New ARR in Quarter) ÷ (S&M Spend in Prior Quarter)
```

**Benchmarks**:
- <0.75: Inefficient, unprofitable growth
- 0.75-1.0: Acceptable
- >1.0: Efficient, profitable growth
