# SaaS Market Sizing Example: AI-Powered Email Marketing for E-Commerce

Complete TAM/SAM/SOM calculation for a B2B SaaS startup using bottom-up and top-down methodologies.

## Company Overview

**Product:** AI-powered email marketing automation platform
**Target:** E-commerce companies with $1M+ annual revenue
**Geography:** North America (initial), global expansion planned
**Pricing:** $500/month average (scales by email volume)
**Timeline:** 3-5 year market opportunity

## Methodology 1: Bottom-Up Analysis (Primary)

### Step 1: Define Target Customer Segments

**Segment Criteria:**

- E-commerce companies (D2C and marketplace sellers)
- $1M+ in annual revenue
- North America based
- Currently using email marketing

**Segment Breakdown:**

| Segment               | Annual Revenue | Count  | ACV     | Priority |
| --------------------- | -------------- | ------ | ------- | -------- |
| Small E-commerce      | $1M-$5M        | 85,000 | $3,600  | High     |
| Mid-Market E-commerce | $5M-$50M       | 18,000 | $9,600  | High     |
| Enterprise E-commerce | $50M+          | 2,500  | $24,000 | Medium   |

**Data Sources:**

- U.S. Census Bureau: E-commerce business counts
- Shopify, BigCommerce, WooCommerce: Published merchant counts
- Statista: E-commerce market statistics
- LinkedIn Sales Navigator: Company search validation

### Step 2: Calculate TAM (Total Addressable Market)

**Formula:**

```
TAM = Σ (Segment Count × Annual Contract Value)
```

**Calculation:**

```
Small E-commerce:   85,000 × $3,600  = $306M
Mid-Market:         18,000 × $9,600  = $173M
Enterprise:          2,500 × $24,000 = $60M
                                      --------
TAM (North America):                  $539M
```

**Global Expansion Multiplier:**

- North America = 35% of global e-commerce market
- Global TAM = $539M / 0.35 = $1.54B

**TAM = $1.54B globally, $539M North America**

### Step 3: Calculate SAM (Serviceable Available Market)

**Filters Applied:**

1. **Geographic Filter: North America Only (Year 1-2)**
   - Base TAM: $539M
   - Filter: 100% (starting in North America)
   - Result: $539M

2. **Product Capability Filter: AI-Ready Customers**
   - Customers ready to adopt AI email marketing
   - Excludes: Companies with basic email needs only
   - Filter: 45% (based on survey data)
   - Result: $539M × 0.45 = $242M

3. **Current Tool Filter: Addressable Switching Market**
   - Customers using incumbent tools who would switch
   - Excludes: Recently switched, custom built solutions
   - Filter: 70% (typical B2B SaaS switching market)
   - Result: $242M × 0.70 = $169M

**SAM = $169M**

**SAM Breakdown by Segment:**

```
Small E-commerce:   $306M × 0.45 × 0.70 = $96M (57%)
Mid-Market:         $173M × 0.45 × 0.70 = $54M (32%)
Enterprise:         $60M × 0.45 × 0.70  = $19M (11%)
```

### Step 4: Calculate SOM (Serviceable Obtainable Market)

**Market Share Assumptions:**

**Year 3 Target: 2.5% of SAM**

- Typical new entrant market share
- Requires strong product-market fit
- Assumes $10M in funding for GTM

**Year 5 Target: 5% of SAM**

- Achievable with scale and brand
- Requires effective sales and marketing
- Assumes additional funding for growth

**Calculation:**

```
SOM (Year 3) = $169M × 2.5% = $4.2M ARR
SOM (Year 5) = $169M × 5.0% = $8.5M ARR
```

**SOM by Segment (Year 5):**

```
Small E-commerce:   $96M × 5% = $4.8M ARR (565 customers)
Mid-Market:         $54M × 5% = $2.7M ARR (281 customers)
Enterprise:         $19M × 5% = $1.0M ARR (42 customers)
                                --------
Total:                          $8.5M ARR (888 customers)
```
