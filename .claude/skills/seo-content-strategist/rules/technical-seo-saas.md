---
title: Technical SEO for SaaS Sites
impact: HIGH
tags: technical-seo, site-architecture, crawlability, indexation, core-web-vitals, schema
---

## Technical SEO for SaaS Sites

**Impact: HIGH**

Technical SEO is the foundation that enables content to rank. A technically sound site with average content outperforms a technically broken site with excellent content. For SaaS, this includes specific challenges around app vs. marketing pages, JavaScript rendering, and documentation.

### Technical SEO Audit Checklist

```
Crawlability
├── [ ] Robots.txt configured correctly
├── [ ] XML sitemap submitted and updated
├── [ ] No critical pages blocked
├── [ ] Crawl budget not wasted on low-value pages
└── [ ] Internal linking enables discovery

Indexation
├── [ ] Target pages are indexed (site: search)
├── [ ] No unwanted pages indexed (filters, params)
├── [ ] Canonical tags implemented correctly
├── [ ] No duplicate content issues
└── [ ] Hreflang for international (if applicable)

Performance
├── [ ] Core Web Vitals passing
├── [ ] Mobile-friendly (responsive)
├── [ ] HTTPS enabled
├── [ ] Fast TTFB (<200ms)
└── [ ] Images optimized

Structure
├── [ ] Clear URL hierarchy
├── [ ] Breadcrumbs implemented
├── [ ] Schema markup on key pages
├── [ ] 404 page exists and is helpful
└── [ ] Redirects are 301 (not 302)
```

### Robots.txt for SaaS

```
# Good robots.txt for SaaS site

User-agent: *
Allow: /
Disallow: /app/
Disallow: /dashboard/
Disallow: /api/
Disallow: /admin/
Disallow: /*?*utm_
Disallow: /*?*ref=
Disallow: /search?

# Allow marketing/docs pages that might be under /app path
Allow: /app/signup
Allow: /app/login

Sitemap: https://example.com/sitemap.xml
```

### Bad Robots.txt Mistakes

```
✗ User-agent: *
  Disallow: /
  (Blocks entire site!)

✗ No robots.txt at all
  (Bots crawl everything, including app pages)

✗ Disallow: /blog
  (Blocking your main content!)

✗ Forgetting sitemap reference
  (Bots have to discover sitemap another way)
```

### XML Sitemap Best Practices

| Rule | Guideline |
|------|-----------|
| **Include** | All pages you want indexed |
| **Exclude** | Thin pages, duplicates, app pages |
| **Update** | Automatically when content changes |
| **Size** | Max 50,000 URLs or 50MB per sitemap |
| **Priority** | Homepage > main pages > blog posts |
| **Frequency** | Reflect actual update frequency |

### Core Web Vitals Targets

| Metric | What It Measures | Good | Needs Work | Poor |
|--------|------------------|------|------------|------|
| **LCP** | Largest Contentful Paint | <2.5s | 2.5-4s | >4s |
| **INP** | Interaction to Next Paint | <200ms | 200-500ms | >500ms |
| **CLS** | Cumulative Layout Shift | <0.1 | 0.1-0.25 | >0.25 |

### Common CWV Fixes for SaaS Sites

| Issue | Cause | Fix |
|-------|-------|-----|
| **Poor LCP** | Large hero images | Preload, compress, use WebP |
| **Poor LCP** | Slow server response | CDN, edge caching |
| **Poor LCP** | Render-blocking JS | Defer non-critical scripts |
| **Poor INP** | Heavy JavaScript | Code splitting, lazy loading |
| **Poor INP** | Third-party scripts | Delay analytics, chat widgets |
| **High CLS** | Images without dimensions | Set width/height attributes |
| **High CLS** | Dynamic content injection | Reserve space for ads/embeds |
| **High CLS** | Web fonts | font-display: swap, preload |

### JavaScript SEO for SaaS

```
Common issue: Marketing site uses same React/Next.js stack as app

Problems:
├── Content rendered client-side → not indexed
├── Slow initial load → poor CWV
├── Links not crawlable → poor internal linking
└── Dynamic routing → canonical issues

Solutions:
├── SSR (Server-Side Rendering) for marketing pages
├── SSG (Static Site Generation) for blog/docs
├── Prerendering service as fallback
├── Test with Google's URL Inspection Tool
└── Check "View Rendered Source" vs "View Source"
```

### Canonical Tag Implementation

| Scenario | Canonical Should Point To |
|----------|---------------------------|
| **Single URL, no variants** | Self-referencing canonical |
| **www vs non-www** | Preferred version |
| **HTTP vs HTTPS** | HTTPS version |
| **With/without trailing slash** | Chosen standard |
| **Paginated content** | Usually self-referencing |
| **Filtered/sorted versions** | Base URL (no parameters) |
| **Syndicated content** | Original source |

### Good Canonical Implementation

```html
<!-- On page: https://example.com/blog/secrets-management -->
<link rel="canonical" href="https://example.com/blog/secrets-management" />

