# PolicyForge Week 1–2 Metrics Dashboard

**Owner:** `operations-pg`  
**Purpose:** Track the validation-and-foundation sprint against the Week 2 gate criteria. Update daily; snapshot at 09:00 UTC every morning.  
**Cycle context:** Conditional GO. Week 2 gate must clear by Day 14 or we pause and consider pivot to FlowSpec / InvoicePipe.

---

## Week 2 Gate Summary

| Gate | Deadline | Pass Threshold | Source |
|------|----------|----------------|--------|
| Validation Gate | Day 14 / End of Week 2 | (a) 3+ written auditor/consultant acceptance statements; (b) ≥50 qualified waitlist signups **OR** ≥3 paid pre-orders / $599-year commitments; (c) Terms, Privacy, disclaimer drafted; (d) target CAC ≤ $150 | `docs/ceo/policyforge-decision.md:74` |
| Product-Technical Gate | Day 28 / End of Week 4 | Intake completion ≥80%, median intake <10 min, preview <5 sec, full pack cost < $5, Stripe test checkout live | `docs/ceo/policyforge-decision.md:75` |

---

## Metrics

### 1. Waitlist Signups

| Field | Definition | Formula | Data Source / Owner |
|-------|-----------|---------|---------------------|
| Total waitlist signups | Unique email addresses captured on landing page or price-test page | `COUNT(DISTINCT email)` from waitlist table | `fullstack-dhh` landing-page DB; `marketing-godin` traffic report |
| Qualified signups | Signups that match ICP: B2B SaaS, 10–100 employees, first-audit context, valid work email | `COUNT(DISTINCT email WHERE icp_flag = true)` | `sales-ross` enrichment + manual review |
| Signups by channel | `utm_source`/`utm_medium` attached at capture | `COUNT(DISTINCT email) GROUP BY utm_source, utm_medium` | `fullstack-dhh` DB + `marketing-godin` UTM map |
| Daily new signups | New emails in the last 24h | `COUNT(DISTINCT email WHERE created_at >= now() - interval '1 day')` | `fullstack-dhh` DB |

**Week 2 target:** ≥50 qualified signups or ≥3 pre-orders.

---

### 2. Unique Visitors

| Field | Definition | Formula | Data Source / Owner |
|-------|-----------|---------|---------------------|
| Unique visitors | Unique sessions / anonymous IDs on landing page, price-test page, and preview page | `COUNT(DISTINCT session_id)` | Vercel Analytics / Plausible / PostHog; `devops-hightower` |
| Unique visitors by page | Same, split by `pathname` | `COUNT(DISTINCT session_id) GROUP BY pathname` | Vercel Analytics; `fullstack-dhh` |
| Unique visitors by channel | Same, split by `utm_source`/`utm_medium` | `COUNT(DISTINCT session_id) GROUP BY utm_source, utm_medium` | `marketing-godin` UTM map + analytics |

**Note:** Do not optimize for traffic; optimize for qualified signups and pre-orders.

---

### 3. Conversion Rate to Preview

| Field | Definition | Formula | Data Source / Owner |
|-------|-----------|---------|---------------------|
| Preview conversion rate | Share of unique visitors who submit the intake screener and reach the free preview | `previews_generated / unique_visitors` | `fullstack-dhh` DB + analytics |
| Screener start rate | Share of unique visitors who start the screener | `screener_starts / unique_visitors` | `fullstack-dhh` + `interaction-cooper` events |
| Screener-to-preview rate | Share of screener starters who reach preview | `previews_generated / screener_starts` | `fullstack-dhh` + `interaction-cooper` events |

**Formula:**

```text
Preview Conversion Rate = Previews Generated / Unique Visitors
```

**Week 4 target preview latency:** <5 sec; free-to-paid target Week 6: ≥3% (target 5%).

---

### 4. Pre-Orders

| Field | Definition | Formula | Data Source / Owner |
|-------|-----------|---------|---------------------|
| Pre-orders | Paid or committed $599/year Growth (or higher) reservations before product is live | `COUNT(DISTINCT customer_id WHERE order_type = 'pre-order' AND plan IN ('Growth', 'Scale', 'Audit Assist'))` | Stripe test mode + `sales-ross` manual commits |
| Pre-order ARR | Annualized committed revenue from pre-orders | `SUM(plan_price) WHERE order_type = 'pre-order'` | Stripe / `sales-ross` |
| Pre-order by channel | Pre-orders grouped by acquisition channel | `COUNT(DISTINCT customer_id) GROUP BY channel` | `sales-ross` outreach tracker |

**Week 2 target:** ≥3 paid pre-orders / $599-year commitments.

---

### 5. Paid Conversions

| Field | Definition | Formula | Data Source / Owner |
|-------|-----------|---------|---------------------|
| Paid conversions | Completed Stripe checkout for any paid tier | `COUNT(DISTINCT customer_id WHERE checkout_status = 'paid')` | Stripe live/test + `fullstack-dhh` |
| Free-to-paid conversion rate | Paid conversions / previews generated | `paid_conversions / previews_generated` | Stripe + `fullstack-dhh` DB |
| Paid conversion by tier | Paid conversions split by Starter / Growth / Scale / Audit Assist | `COUNT(DISTINCT customer_id) GROUP BY plan` | Stripe + `fullstack-dhh` |
| Revenue per visitor | Total paid revenue / unique visitors | `SUM(revenue) / unique_visitors` | Stripe + analytics |

**Formulas:**

```text
Free-to-Paid Conversion = Paid Conversions / Previews Generated
Revenue per Visitor = Total Paid Revenue / Unique Visitors
```

**Week 6 target:** free-to-paid ≥3% (target 5%); Week 8 target: 20 paid customers.

---

### 6. Intake Completion Rate

| Field | Definition | Formula | Data Source / Owner |
|-------|-----------|---------|---------------------|
| Intake starts | Users who begin the screener / intake questionnaire | `COUNT(DISTINCT session_id WHERE event = 'intake_start')` | `fullstack-dhh` + `interaction-cooper` events |
| Intake completes | Users who submit all required sections and reach preview or paywall | `COUNT(DISTINCT session_id WHERE event = 'intake_complete')` | `fullstack-dhh` + `interaction-cooper` events |
| Intake completion rate | Completed intakes / started intakes | `intake_completes / intake_starts` | `fullstack-dhh` + `product-norman` usability |
| Drop-off by section | Share of users abandoning at each intake section | `1 - (users_reaching_section_n / users_starting_section_n)` | `interaction-cooper` event funnel |

**Formula:**

```text
Intake Completion Rate = Intake Completes / Intake Starts
```

**Week 4 target:** ≥80%.

---

### 7. Median Intake Time

| Field | Definition | Formula | Data Source / Owner |
|-------|-----------|---------|---------------------|
| Median intake time | Median wall-clock time from intake start to submission | `PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY (completed_at - started_at))` | `fullstack-dhh` DB timestamps |
| P95 intake time | 95th percentile completion time | `PERCENTILE_CONT(0.95) WITHIN GROUP ...` | `fullstack-dhh` DB |
| Time by section | Median time spent in each section | `PERCENTILE_CONT(0.5) GROUP BY section` | `interaction-cooper` events + `fullstack-dhh` |

**Formula:**

```text
Median Intake Time = MEDIAN(completed_at - started_at) for all completed intakes
```

**Week 4 target:** <10 minutes.

---

### 8. Preview Latency

| Field | Definition | Formula | Data Source / Owner |
|-------|-----------|---------|---------------------|
| Preview latency | Time from intake submission to first preview rendered | `preview_rendered_at - intake_submitted_at` | `fullstack-dhh` API logs + `cto-vogels` |
| P95 preview latency | 95th percentile preview latency | `PERCENTILE_CONT(0.95)` on latency | `fullstack-dhh` API logs |
| Preview error rate | Preview requests returning non-2xx / total preview requests | `error_responses / total_preview_requests` | `fullstack-dhh` logs + `qa-bach` |

**Formula:**

```text
Preview Latency = preview_rendered_at - intake_submitted_at
```

**Week 4 target:** <5 seconds.

---

### 9. Generation Cost Per Pack

| Field | Definition | Formula | Data Source / Owner |
|-------|-----------|---------|---------------------|
| LLM cost per pack | Claude API + token usage for one full SOC 2 pack | `SUM(claude_input_tokens * input_rate + claude_output_tokens * output_rate + retry_costs)` | `cto-vogels` / `fullstack-dhh` Inngest logs |
| Infrastructure cost per pack | Vercel compute + R2 storage + Resend email for one pack | `vercel_invocation_cost + r2_storage_cost + resend_cost` | `devops-hightower` billing exports |
| Total cost per pack | Sum of LLM + infra + export cost for one generated pack | `llm_cost + infra_cost + export_cost` | `cfo-campbell` cost tracker |
| Blended cost per pack | Total generation costs / packs generated | `SUM(generation_costs) / COUNT(packs_generated)` | `cfo-campbell` |

**Formula:**

```text
Generation Cost per Pack = (Claude Cost + Vercel/R2/Resend Cost + Export Cost) / Packs Generated
```

**Week 4 target:** < $5 per pack.  
**PRFAQ target:** operating cost per customer < $5 per generated pack.

---

### 10. CAC by Channel

| Field | Definition | Formula | Data Source / Owner |
|-------|-----------|---------|---------------------|
| Channel spend | Direct spend per channel (ads, PH launch, tools, outreach tools) | `SUM(spend) GROUP BY channel` | `marketing-godin` + `sales-ross` + `cfo-campbell` |
| Fully-loaded CAC | Total sales + marketing cost / new paid customers | `(marketing_spend + sales_spend + tool_costs + founder_time_cost) / paid_conversions` | `cfo-campbell` |
| CAC by channel | Channel spend / customers attributed to that channel | `channel_spend / attributed_customers` | UTM attribution + Stripe |
| Blended CAC | Total acquisition spend / total paid conversions | `total_spend / total_paid_conversions` | `cfo-campbell` |

**Formula:**

```text
CAC by Channel = Channel Spend / Attributed Paid Customers
Blended CAC = Total Sales & Marketing Spend / Total Paid Conversions
```

**Week 2 target:** CAC ≤ $150.  
**Model target:** CAC payback ~1.5 months; LTV:CAC 27.5:1.

---

### 11. Pipeline Stage Counts

| Stage | Definition | Count Formula | Data Source / Owner |
|-------|-----------|---------------|---------------------|
| Visitor | Unique visitor on landing or price-test page | `COUNT(DISTINCT session_id)` | Analytics |
| Screener Start | Visitor clicks "Start free preview" | `COUNT(DISTINCT session_id WHERE event = 'screener_start')` | `fullstack-dhh` |
| Intake Start | Visitor begins the full diagnostic intake | `COUNT(DISTINCT session_id WHERE event = 'intake_start')` | `fullstack-dhh` |
| Intake Complete | Visitor submits full intake | `COUNT(DISTINCT session_id WHERE event = 'intake_complete')` | `fullstack-dhh` |
| Preview Generated | System returns a tailored preview | `COUNT(DISTINCT session_id WHERE event = 'preview_generated')` | `fullstack-dhh` |
| Pre-Order | User commits to paid plan before launch | `COUNT(DISTINCT customer_id WHERE order_type = 'pre-order')` | Stripe / `sales-ross` |
| Paid Conversion | User completes checkout and downloads pack | `COUNT(DISTINCT customer_id WHERE checkout_status = 'paid')` | Stripe |
| Beta Pack Generated | Full SOC 2 pack generated in beta | `COUNT(DISTINCT customer_id WHERE pack_status = 'generated')` | `fullstack-dhh` |
| Auditor Acceptance | Customer reports they would show output to auditor | `COUNT(DISTINCT customer_id WHERE auditor_accept = true)` | `product-norman` usability + `qa-bach` |

**Stage-to-stage conversion:**

```text
Stage Conversion = Count(Stage N) / Count(Stage N-1)
```

**Example funnel (to track weekly):**

| Stage | Week 1 | Week 2 | Week 2 Target |
|-------|--------|--------|---------------|
| Visitors | — | — | — |
| Screener Start | — | — | — |
| Intake Start | — | — | — |
| Intake Complete | — | — | — |
| Preview Generated | — | — | — |
| Pre-Order | — | — | ≥3 |
| Paid Conversion | — | — | — |

---

## Daily Stand-up Snapshot Template

Copy into Slack/thread each morning:

```text
PolicyForge W1-2 Snapshot (YYYY-MM-DD)
- Qualified signups: X (+/-)
- Pre-orders: X / 3
- CAC (blended): $X
- Intake completion: X% (if live)
- Preview latency p50: Xs
- Gen cost/pack: $X
- Auditor statements: X / 3
- Blocker: [one line]
```

---

## What "Good" Looks Like by Day 14

1. **Signal over noise:** We have 50 qualified signups or 3 pre-orders, not 500 random emails.
2. **CAC is real:** Blended CAC ≤ $150, with channel-level attribution.
3. **Intake works:** ≥80% complete it and the median time is <10 min.
4. **Preview is fast:** p50 <5 sec, no high-severity hallucinations in QA sample.
5. **Cost is controlled:** Full pack cost < $5.
6. **Legal posture is documented:** Terms, Privacy, and output disclaimers are drafted and reviewed.

If any of these are red on Day 14, `critic-munger` escalates NO-GO recommendation to `ceo-bezos`.
