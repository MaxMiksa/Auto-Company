# PolicyForge Product Hunt Launch Plan

**Owner:** `marketing-godin` + `operations-pg`  
**Status:** Ready for review / scheduling  
**Launch target:** Within 48 hours of go-live (after Vercel deploy + Stripe checkout are confirmed)  
**Last updated:** 2026-07-21

---

## 1. Launch Goal

- Primary: **200+ upvotes** in first 24 hours.
- Secondary: **50 waitlist signups / free previews** driven from Product Hunt in first week.
- Tertiary: **10 paid Starter conversions** attributed to Product Hunt in first 14 days.

---

## 2. Pre-Launch Checklist

| Task | Owner | Status | Evidence |
|------|-------|--------|----------|
| Landing page live on policyforge.auto-company.dev | `devops-hightower` | Blocked (no Vercel token) | `vercel.json` + GitHub Actions ready |
| Stripe checkout flow functional | `sales-ross` + `fullstack-dhh` | Blocked (no Stripe keys) | Checkout route scaffolded |
| Free preview flow functional | `fullstack-dhh` | Pending | `/start` questionnaire not yet built |
| Maker thumbnail / logo (1024×1024) | `ui-duarte` | Not started | — |
| Gallery images (3–5 screenshots) | `ui-duarte` | Not started | — |
| Product Hunt listing copy finalized | `marketing-godin` | Complete | This doc |
| First comment drafted | `marketing-godin` | Complete | `policyforge-launch-copy.md` |
| Hunter / supporter list (≥ 30 people) | `operations-pg` | Not started | — |
| Launch day announcement posts for LinkedIn, X, Indie Hackers, HN | `marketing-godin` | Not started | Templates below |
| UTM-tagged Product Hunt URL | `operations-pg` | Not started | — |
| Calendly / demo booking link | `sales-ross` | Pending | — |

---

## 3. Listing Details

| Field | Value |
|-------|-------|
| **Name** | PolicyForge |
| **Tagline** | SOC 2 policy packs from a 10-minute questionnaire. |
| **Description** | Answer a short questionnaire about your stack, team, and frameworks. PolicyForge generates a complete SOC 2 or ISO 27001 policy pack + control map in minutes — so your first audit starts with documents, not a blank page. From $199. |
| **Website** | `https://policyforge.auto-company.dev?utm_source=producthunt&utm_campaign=launch` |
| **Category** | Productivity / Developer Tools / Security & Compliance |
| **First comment** | See `policyforge-launch-copy.md` Section 9 |
| **Pricing** | Starter $199 one-time, Growth $499/yr, Scale $999/yr |

---

## 4. Gallery Asset Plan

1. **Hero screenshot:** Landing page hero with headline and CTA.
2. **Questionnaire preview:** 2–3 question cards from intake flow.
3. **Generated policy sample:** Side-by-side Markdown and DOCX exports.
4. **Control map:** Spreadsheet snippet showing policy → control mapping.
5. **Pricing page:** Three-tier pricing cards.

Asset specs: 1350×900 or 1600×1000 PNG, < 5 MB each.

---

## 5. Launch Day Timeline (EST)

All times are US Eastern. Product Hunt resets at midnight PST.

### T-minus 7 days
- Confirm hunter / schedule with them if using a top hunter.
- Soft-share link with supporter list; ask them to create PH accounts and turn on notifications.
- Draft personal launch posts for founders/makers.

### T-minus 1 day
- Verify site, checkout, and free preview are live.
- Pre-fill Product Hunt listing; save as draft.
- Queue social posts via Buffer or scheduled manually.

### Launch Day (Tuesday recommended) — 00:01 PST / 03:01 EST
- Publish listing immediately after reset.
- Post first comment within 5 minutes.
- Send email to waitlist (`policyforge-launch-copy.md` Section 11).
- Post on LinkedIn, X, Indie Hackers, and Hacker News `Show HN` at staggered intervals.
- Reply to every comment within 15 minutes for the first 4 hours.

### 03:01 – 08:00 EST
- Rally supporter list via Telegram / Slack / email.
- Track upvote velocity and comment sentiment.
- Pin any FAQ answers as replies.

### 08:00 – 12:00 EST
- Second wave of social promotion.
- Engage with commenters and upvoters publicly.
- Monitor site traffic, waitlist signups, and checkout conversions.

### 12:00 – 18:00 EST
- Post “Update #1” with early stats or testimonials if available.
- Keep responding to comments.
- Watch for copycats / negative replies and flag to `critic-munger`.

### 18:00 – 23:59 EST
- Final push in relevant Slack/Discord communities.
- Prepare Day-2 follow-up post summarizing launch learnings.

---

## 6. Cross-Platform Outreach Plan

| Channel | Time (EST) | Post type | Link |
|---------|------------|-----------|------|
| LinkedIn (company + personal) | 08:00 | Long-form founder launch post | PH + landing page |
| X / Twitter | 09:00 | 2–3 launch tweets + reply thread | PH + landing page |
| Indie Hackers | 10:00 | Product Launch post | PH + landing page |
| Hacker News | 11:00 | `Show HN: PolicyForge — SOC 2 policy packs from a 10-min questionnaire` | Landing page |
| Reddit r/SaaS | 12:00 | Launch post (follow sub rules, no direct PH link) | Landing page |
| Reddit r/cybersecurity | 13:00 | Educational post: “How we generated SOC 2 policies without a consultant” | Landing page |
| Slack communities (SaaS, founders, compliance) | 14:00 | Soft share + offer to answer questions | Landing page |
| LinkedIn afternoon bump | 17:00 | Comment on own post with first-day testimonials/lessons | PH |

---

## 7. Supporter Mobilization Script

**Message (Slack / email / Telegram):**

```
Hey — we just launched PolicyForge on Product Hunt.

If you have 30 seconds, an upvote + genuine comment would mean a lot:
https://www.producthunt.com/posts/policyforge

If you’re prepping for SOC 2 or ISO 27001, try the free preview and let me know what’s missing.

Thanks!
```

**Rules for supporters:**
- Do not ask for blind upvotes.
- Encourage genuine questions / feedback in comments.
- No bot rings or paid upvote services.

---

## 8. Hacker News `Show HN` Post

**Title:** `Show HN: PolicyForge – SOC 2 policy packs from a 10-minute questionnaire`

**Body:**
```
Hi HN,

We’re building PolicyForge to solve the worst part of a first SOC 2 or ISO 27001 audit: writing 15–25 policies that actually describe how your company operates.

Most startups either pay $10k+ for a consultant or spend weeks hacking generic templates. We ask about your stack (AWS, Google Workspace, Stripe, GitHub, Slack, etc.), team size, and frameworks, then generate a tailored policy pack + control map.

You can preview one policy for free; the full pack starts at $199.

Would love your feedback — especially if you’ve been through an audit and can tell us what we got wrong.

https://policyforge.auto-company.dev
```

---

## 9. Launch Day Metrics to Watch

| Metric | Target | Tracking |
|--------|--------|----------|
| Upvotes in 24h | 200+ | Product Hunt dashboard |
| Comments in 24h | 30+ | Product Hunt dashboard |
| PH referral sessions | 500+ | Vercel Analytics / Plausible |
| Free previews started | 50+ | `/start` conversion event |
| Paid Starter conversions | 10+ | Stripe + analytics event |
| Email waitlist CTR | 15%+ | Mailtrap / Resend logs |

---

## 10. Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Site crashes from traffic | Confirm Vercel deployment + CDN; enable Vercel Analytics/Speed Insights. |
| Checkout breaks | Run end-to-end Stripe test purchase before launch. |
| Negative “this is not legal advice” comments | First comment + FAQ clearly state output is a starting draft, not legal advice. |
| Competitor / copycat comments | Respond transparently; do not argue. Flag to `critic-munger`. |
| Low initial upvotes | Rally supporters early; stagger posts; use HN/Indie Hackers as backup channels. |

---

## 11. Post-Launch Follow-Up

- **Day 2:** Thank-you post on LinkedIn/X with key learnings.
- **Day 3:** Email Product Hunt commenters who asked questions with a personal follow-up.
- **Week 1:** Analyze PH traffic conversion and update landing page headlines based on winning copy.
- **Week 2:** Publish launch retrospective in `docs/marketing/policyforge-launch-retrospective.md`.

---

## Next Actions

1. `ui-duarte` to create PH gallery assets and maker avatar.
2. `devops-hightower` to unblock Vercel deploy (requires `VERCEL_TOKEN`).
3. `operations-pg` to build supporter list and draft UTM links.
4. `sales-ross` to confirm Stripe checkout and Calendly demo links.
5. `qa-bach` to run end-to-end launch-day smoke test.
