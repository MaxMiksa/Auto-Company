---
name: startup-financial-modeling
description: This skill should be used when the user asks to "create financial projections", "build a financial model", "forecast revenue", "calculate burn rate", "estimate runway", "model cash flow", or requests 3-5 year financial planning for a startup.
version: 1.0.0
---

# Startup Financial Modeling

Build comprehensive 3-5 year financial models with revenue projections, cost structures, cash flow analysis, and scenario planning for early-stage startups.

## Overview

Financial modeling provides the quantitative foundation for startup strategy, fundraising, and operational planning. Create realistic projections using cohort-based revenue modeling, detailed cost structures, and scenario analysis to support decision-making and investor presentations.

## Core Components

### Revenue Model

**Cohort-Based Projections:**
Build revenue from customer acquisition and retention by cohort.

**Formula:**

```
MRR = Σ (Cohort Size × Retention Rate × ARPU)
ARR = MRR × 12
```

**Key Inputs:**

- Monthly new customer acquisitions
- Customer retention rates by month
- Average revenue per user (ARPU)
- Pricing and packaging assumptions
- Expansion revenue (upsells, cross-sells)

### Cost Structure

**Operating Expenses Categories:**

1. **Cost of Goods Sold (COGS)**
   - Hosting and infrastructure
   - Payment processing fees
   - Customer support (variable portion)
   - Third-party services per customer

2. **Sales & Marketing (S&M)**
   - Customer acquisition cost (CAC)
   - Marketing programs and advertising
   - Sales team compensation
   - Marketing tools and software

3. **Research & Development (R&D)**
   - Engineering team compensation
   - Product management
   - Design and UX
   - Development tools and infrastructure

4. **General & Administrative (G&A)**
   - Executive team
   - Finance, legal, HR
   - Office and facilities
   - Insurance and compliance

### Cash Flow Analysis

**Components:**

- Beginning cash balance
- Cash inflows (revenue, fundraising)
- Cash outflows (operating expenses, CapEx)
- Ending cash balance
- Monthly burn rate
- Runway (months of cash remaining)

**Formula:**

```
Runway = Current Cash Balance / Monthly Burn Rate
Monthly Burn = Monthly Revenue - Monthly Expenses
```

### Headcount Planning

**Role-Based Hiring Plan:**
Track headcount by department and role.

**Key Metrics:**

- Fully-loaded cost per employee
- Revenue per employee
- Headcount by department (% of total)

**Typical Ratios (Early-Stage SaaS):**

- Engineering: 40-50%
- Sales & Marketing: 25-35%
- G&A: 10-15%
- Customer Success: 5-10%

## Financial Model Structure

### Three-Scenario Framework

**Conservative Scenario (P10):**

- Slower customer acquisition
- Lower pricing or conversion
- Higher churn rates
- Extended sales cycles
- Used for cash management

**Base Scenario (P50):**

- Most likely outcomes
- Realistic assumptions
- Primary planning scenario
- Used for board reporting

**Optimistic Scenario (P90):**

- Faster growth
- Better unit economics
- Lower churn
- Used for upside planning

### Time Horizon

**Detailed Projections: 3 Years**

- Monthly detail for Year 1
- Monthly detail for Year 2
- Quarterly detail for Year 3

**High-Level Projections: Years 4-5**

- Annual projections
- Key metrics only
- Support long-term planning

## Step-by-Step Process

### Step 1: Define Business Model

Clarify revenue model and pricing.

**SaaS Model:**

- Subscription pricing tiers
- Annual vs. monthly contracts
- Free trial or freemium approach
- Expansion revenue strategy

**Marketplace Model:**

- GMV projections
- Take rate (% of transactions)
- Buyer and seller economics
- Transaction frequency

**Transactional Model:**

- Transaction volume
- Revenue per transaction
- Frequency and seasonality

### Step 2: Build Revenue Projections

Use cohort-based methodology for accuracy.

**Monthly Customer Acquisition:**
Define new customers acquired each month.

**Retention Curve:**
Model customer retention over time.

**Typical SaaS Retention:**

- Month 1: 100%
- Month 3: 90%
- Month 6: 85%
- Month 12: 75%
- Month 24: 70%

**Revenue Calculation:**
For each cohort, calculate retained customers × ARPU for each month.

### Step 3: Model Cost Structure

Break down costs by category and behavior.

**Fixed vs. Variable:**

- Fixed: Salaries, software, rent
- Variable: Hosting, payment processing, support

**Scaling Assumptions:**

- COGS as % of revenue
- S&M as % of revenue (CAC payback)
- R&D growth rate
- G&A as % of total expenses

### Step 4: Create Hiring Plan

Model headcount growth by role and department.

**Inputs:**

- Starting headcount
- Hiring velocity by role
- Fully-loaded compensation by role
- Benefits and taxes (typically 1.3-1.4x salary)

**Example:**

```
Engineer: $150K salary × 1.35 = $202K fully-loaded
Sales Rep: $100K OTE × 1.30 = $130K fully-loaded
```

### Step 5: Project Cash Flow

Calculate monthly cash position and runway.

**Monthly Cash Flow:**

```
Beginning Cash
+ Revenue Collected (consider payment terms)
- Operating Expenses Paid
- CapEx
= Ending Cash
```

**Runway Calculation:**

```
If Ending Cash < 0:
  Funding Need = Negative Cash Balance
  Runway = 0
Else:
  Runway = Ending Cash / Average Monthly Burn
```

### Step 6: Calculate Key Metrics

Track metrics that matter for stage.

**Revenue Metrics:**

- MRR / ARR
- Growth rate (MoM, YoY)
- Revenue by segment or cohort

**Unit Economics:**

- CAC (Customer Acquisition Cost)
- LTV (Lifetime Value)
- CAC Payback Period
- LTV / CAC Ratio

**Efficiency Metrics:**

- Burn multiple (Net Burn / Net New ARR)
- Magic number (Net New ARR / S&M Spend)
- Rule of 40 (Growth % + Profit Margin %)

**Cash Metrics:**

- Monthly burn rate
- Runway (months)
- Cash efficiency

### Step 7: Scenario Analysis

Create three scenarios with different assumptions.

**Variable Assumptions:**

- Customer acquisition rate (±30%)
- Churn rate (±20%)
- Average contract value (±15%)
- CAC (±25%)

**Fixed Assumptions:**

- Pricing structure
- Core operating expenses
- Hiring plan (adjust timing, not roles)

## Business Model Templates

### SaaS Financial Model

**Revenue Drivers:**

- New MRR (customers × ARPU)
- Expansion MRR (upsells)
- Contraction MRR (downgrades)
- Churned MRR (lost customers)

**Key Ratios:**

- Gross margin: 75-85%
- S&M as % revenue: 40-60% (early stage)
- CAC payback: < 12 months
- Net retention: 100-120%

**Example Projection:**

```
Year 1: $500K ARR, 50 customers, $100K MRR by Dec
Year 2: $2.5M ARR, 200 customers, $208K MRR by Dec
Year 3: $8M ARR, 600 customers, $667K MRR by Dec
```

### Marketplace Financial Model

**Revenue Drivers:**

- GMV (Gross Merchandise Value)
- Take rate (% of GMV)
- Net revenue = GMV × Take rate

**Key Ratios:**

- Take rate: 10-30% depending on category
- CAC for buyers vs. sellers
- Contribution margin: 60-70%

**Example Projection:**

```
Year 1: $5M GMV, 15% take rate = $750K revenue
Year 2: $20M GMV, 15% take rate = $3M revenue
Year 3: $60M GMV, 15% take rate = $9M revenue
```

### E-Commerce Financial Model

**Revenue Drivers:**

- Traffic (visitors)
- Conversion rate
- Average order value (AOV)
- Purchase frequency

**Key Ratios:**

- Gross margin: 40-60%
- Contribution margin: 20-35%
- CAC payback: 3-6 months

### Services / Agency Financial Model

**Revenue Drivers:**

- Billable hours or projects
- Hourly rate or project fee
- Utilization rate
- Team capacity

**Key Ratios:**

- Gross margin: 50-70%
- Utilization: 70-85%
- Revenue per employee

## Fundraising Integration

