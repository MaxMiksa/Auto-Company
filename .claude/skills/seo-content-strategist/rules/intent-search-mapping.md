---
title: Search Intent Mapping
impact: MEDIUM-HIGH
tags: search-intent, user-intent, content-alignment, serp-analysis, journey-mapping
---

## Search Intent Mapping

**Impact: MEDIUM-HIGH**

Search intent is why someone searches, not what they type. Ranking #1 for a keyword with wrong intent means high bounce rates and no conversions. Match intent perfectly, and lower-authority pages beat stronger competitors.

### Intent Classification Framework

| Intent Type | User Goal | Content Match | Example Query |
|-------------|-----------|---------------|---------------|
| **Informational** | Learn something | Blog posts, guides, tutorials | "what is secrets management" |
| **Navigational** | Find specific site/page | Brand pages, product pages | "infisical login" |
| **Commercial** | Research before buying | Comparisons, reviews, lists | "best secrets management tools" |
| **Transactional** | Complete an action | Product, pricing, signup pages | "infisical pricing" |

### Intent Signals in Keywords

| Signal | Intent | Example |
|--------|--------|---------|
| **what, why, how** | Informational | "how to rotate api keys" |
| **[brand name]** | Navigational | "hashicorp vault docs" |
| **best, top, vs, review** | Commercial | "vault vs aws secrets manager" |
| **buy, pricing, demo, trial** | Transactional | "secrets management pricing" |
| **[location]** | Local (often commercial) | "security consultants near me" |
| **[year]** | Informational/Commercial | "best ci/cd tools 2024" |

### SERP-Based Intent Analysis

The SERP tells you what Google thinks the intent is:

```
Search: "secrets management"

SERP Analysis:
├── Position 1-3: Comprehensive guides (Informational)
├── Position 4-6: Tool pages/comparisons (Commercial)
├── People Also Ask: "What is...", "Why is..." (Informational)
├── SERP Features: No shopping, no local pack
└── Conclusion: Primarily informational, some commercial

Content strategy: Long-form educational guide, not product page
```

### Good Intent Matching

```
Query: "kubernetes secrets vs configmaps"
Intent: Informational (seeking to understand difference)
SERP: All educational articles explaining the comparison

Good match:
┌────────────────────────────────────────────────────┐
│ Title: Kubernetes Secrets vs ConfigMaps:          │
│        When to Use Each                           │
├────────────────────────────────────────────────────┤
│ Content:                                          │
│ - What are Secrets vs ConfigMaps (definitions)    │
│ - Key differences table                           │
│ - When to use Secrets (with examples)             │
│ - When to use ConfigMaps (with examples)          │
│ - Security considerations                         │
│ - Code examples for both                          │
└────────────────────────────────────────────────────┘

✓ Educational, explains concepts
✓ Comparison format matches query
✓ No hard sell, no pricing push
```

### Bad Intent Mismatch

```
Query: "kubernetes secrets vs configmaps"
Intent: Informational

Bad match:
┌────────────────────────────────────────────────────┐
│ Title: Try Our Kubernetes Secrets Platform        │
├────────────────────────────────────────────────────┤
│ Content:                                          │
│ - Why you need better secrets management          │
│ - Our product features                            │
│ - Pricing plans                                   │
│ - Customer testimonials                           │
│ - Sign up CTA                                     │
└────────────────────────────────────────────────────┘

✗ Product page for informational query
✗ Doesn't answer the comparison question
✗ User will bounce immediately
✗ Google will demote this result
```

### Intent Evolution Through Funnel

```
Awareness → Consideration → Decision

┌─────────────────────────────────────────────────────────────┐
│ AWARENESS (Informational)                                   │
│ "what is secrets management"                                │
│ → Educational blog post, pillar page                        │
├─────────────────────────────────────────────────────────────┤
│ CONSIDERATION (Commercial Investigation)                    │
│ "best secrets management tools"                             │
│ "vault vs aws secrets manager"                              │
│ → Comparison posts, buyer's guides, reviews                 │
├─────────────────────────────────────────────────────────────┤
│ DECISION (Transactional)                                    │
│ "infisical pricing"                                         │
│ "infisical free trial"                                      │
│ → Pricing page, signup page, demo page                      │
└─────────────────────────────────────────────────────────────┘
```

### Content Type by Intent

| Intent | Primary Content Types | CTA Approach |
|--------|----------------------|--------------|
| **Informational** | Blog posts, guides, tutorials, glossary | Soft (newsletter, related content) |
| **Navigational** | Homepage, product pages, docs | Direct (login, get started) |
| **Commercial** | Comparisons, reviews, best-of lists | Medium (try free, see demo) |
| **Transactional** | Pricing, signup, checkout | Strong (buy now, start trial) |

### Mixed Intent Keywords

Some keywords have multiple valid intents:

```
Query: "secrets management"

SERP shows:
├── 60% Educational guides (informational)
├── 30% Tool pages (commercial)
└── 10% Product pages (transactional)

Strategy:
1. Primary: Create comprehensive guide (matches majority)
2. Secondary: Include tools section with comparisons
3. Support: Link to product page for interested readers

Don't create product page for this query — it matches
minority of intent, won't rank well
```

### Intent Validation Checklist

Before creating content:

- [ ] Searched the exact keyword
- [ ] Noted what type of content ranks (blog, product, tool)
- [ ] Identified dominant content format (guide, list, comparison)
- [ ] Checked SERP features (PAA indicates informational)
- [ ] Analyzed word count of top results
- [ ] Verified content type matches user expectations
- [ ] Planned appropriate CTA for the intent

### SERP Intent Indicators

| SERP Element | Indicates |
|--------------|-----------|
| **PAA boxes** | Informational (people want to learn) |
| **Shopping results** | Transactional (ready to buy) |
| **Local pack** | Local intent (looking for nearby) |
| **Knowledge panel** | Navigational/Informational |
| **Image pack** | Visual search (how things look) |
| **Video results** | Tutorial/how-to intent |
| **News carousel** | Current events, timely info |
| **No SERP features** | Ambiguous or niche intent |

### Intent Mapping for Content Planning

| Keyword | Volume | Current Rank | SERP Intent | Our Content | Match? |
|---------|--------|--------------|-------------|-------------|--------|
| "secrets management" | 5,400 | 12 | Informational | Guide | Yes |
| "vault vs aws secrets" | 880 | - | Commercial | None | Need to create |
| "infisical pricing" | 320 | 1 | Transactional | Pricing page | Yes |
| "best secrets tools" | 720 | 45 | Commercial | Product page | No (mismatch!) |

### Fixing Intent Mismatches

```
Problem: Ranking poorly for "best secrets management tools"
Current page: Product page (transactional)
SERP intent: Commercial (comparison/review content)

Fix options:

1. Create new comparison page
   └── /blog/best-secrets-management-tools
   └── Compare 10 tools including yours
   └── Objective analysis, not just pitch

2. Repurpose existing page
   └── Transform product page → comparison hub
   └── Add competitor analysis
   └── Position as buyer's guide

3. Accept mismatch
   └── If intent truly doesn't fit your business
   └── Focus on keywords where you can match
```

### Intent-Based Internal Linking

```
Link from informational → commercial:
"For a detailed comparison of the top tools mentioned in this
guide, see our [secrets management tools comparison](/compare/
secrets-management-tools)."

Link from commercial → transactional:
"Ready to try the top-rated solution? [Start your free trial
of Infisical](/signup) with no credit card required."

Link from transactional → informational:
"New to secrets management? [Read our complete guide](/guides/
secrets-management) to understand the basics first."
```

### Measuring Intent Alignment

| Metric | Good Alignment | Bad Alignment |
|--------|----------------|---------------|
| **Bounce rate** | <50% | >70% |
| **Time on page** | >2 minutes (informational) | <30 seconds |
| **Pages per session** | >1.5 | 1.0 |
| **Scroll depth** | >60% | <20% |
| **Conversions** | Meeting intent-appropriate goals | Zero/minimal |

### Anti-Patterns

- **Forcing product pages** — Trying to rank product page for informational queries
- **Ignoring SERP** — Not checking what actually ranks before writing
- **Same content everywhere** — Same page targeting multiple intents
- **Hard sell on informational** — Aggressive CTAs on educational content
- **No CTAs on commercial** — Missing conversion opportunity
- **Keyword-only focus** — Targeting keyword without understanding intent
- **Static intent mapping** — Intent can shift; check SERPs regularly
- **Assuming intent** — "I think users want..." vs checking actual SERP
- **Ignoring mixed intent** — Not addressing multiple needs in content
- **Wrong metrics** — Measuring bounces on transactional like informational
