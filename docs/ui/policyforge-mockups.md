# PolicyForge — High-Fidelity UI Mockups & Design System

> Agent: `ui-duarte`  
> Skill invoked: `.claude/skills/frontend-design.md` before layout work.  
> Audience: B2B SaaS founders and compliance leads preparing for a first SOC 2 Type I audit.

---

## 1. Design Tokens & Visual Language

### 1.1 Aesthetic direction — "Vault Editorial"

The interface should feel like a well-organized compliance binder that happens to be fast. The visual language combines editorial confidence (large type, generous whitespace, structured grids) with the material metaphor of layered paper: cards sit on a parchment surface, buttons have real thickness, and elevation carries meaning.

- **Tone:** Trustworthy, crisp, unapologetically premium.
- **Differentiator:** Unlike generic SaaS landing pages, PolicyForge uses deep ink, warm paper, and a single saturated cobalt action color. Progress and success are communicated with teal; caution (disclaimers, in-progress packs) with amber.
- **Motion principle:** Every transition explains spatial relationships. Sections fade up and in; the progress bar grows; cards lift on hover; buttons press down.

### 1.2 Color palette

| Token | Hex | Tailwind class | Usage |
|-------|-----|----------------|-------|
| `--color-ink` | `#0B132B` | `bg-ink` / `text-ink` | Hero background, footer, primary text, darkest surfaces |
| `--color-ink-light` | `#1C2541` | `bg-ink-light` | Secondary dark sections, hover for dark cards |
| `--color-cobalt` | `#1D4ED8` | `bg-cobalt` / `text-cobalt` | Primary buttons, links, active step, selected chips |
| `--color-cobalt-700` | `#1E40AF` | `bg-cobalt-700` | Button hover, emphasized links |
| `--color-cobalt-50` | `#EFF6FF` | `bg-cobalt-50` | Selected inputs, chip backgrounds, subtle highlights |
| `--color-amber` | `#F59E0B` | `bg-amber` / `text-amber` | Warning banner, "Most popular" badge, in-progress status |
| `--color-amber-50` | `#FFFBEB` | `bg-amber-50` | Disclaimer banner background, price-test indicator |
| `--color-teal` | `#14B8A6` | `bg-teal` / `text-teal` | Completed checklist items, "Ready" status, success accents |
| `--color-teal-50` | `#F0FDFA` | `bg-teal-50` | Success backgrounds, completed step chips |
| `--color-rose` | `#F43F5E` | `bg-rose` / `text-rose` | Errors, destructive actions, expired pack status |
| `--color-parchment` | `#FAF9F6` | `bg-parchment` | Page background |
| `--color-paper` | `#FFFFFF` | `bg-paper` | Cards, modal surfaces, input fields |
| `--color-stone-200` | `#E7E5E4` | `border-stone-200` | Card borders, dividers |
| `--color-stone-400` | `#A8A29E` | `text-stone-400` | Muted labels, placeholder text, disabled text |
| `--color-stone-900` | `#1C1917` | `text-stone-900` | Body copy on light surfaces |

### 1.3 Typography

Use a variable display font for headings, a clean humanist sans for body, and a monospace font for code, control maps, and data tables.

- **Display:** `"Bricolage Grotesque", system-ui, sans-serif` — used for H1, H2, H3, pricing numerals, and marketing callouts.
- **Body:** `"Manrope", system-ui, sans-serif` — used for body copy, labels, form text, and dashboard UI.
- **Mono:** `"JetBrains Mono", ui-monospace, monospace` — used for code snippets, policy filenames, control map tables, and status metadata.

| Scale | Size / Line-height | Weight | Tracking | Usage |
|-------|--------------------|--------|----------|-------|
| `hero` | 4.5rem / 5rem (mobile 3rem / 3.25rem) | 650 | -0.03em | Landing page H1 |
| `h2` | 2.25rem / 2.75rem | 600 | -0.02em | Section headlines |
| `h3` | 1.5rem / 2rem | 600 | -0.01em | Card titles, subsection heads |
| `h4` | 1.25rem / 1.75rem | 600 | 0 | Feature titles, policy names |
| `body-lg` | 1.125rem / 1.75rem | 400 | 0 | Hero subheads, empty-state copy |
| `body` | 1rem / 1.5rem | 400 | 0 | Paragraphs, form labels |
| `caption` | 0.875rem / 1.25rem | 500 | 0 | Captions, helper text |
| `label` | 0.75rem / 1rem | 600 | 0.08em | Uppercase labels, badges, overlines |
| `data` | 0.8125rem / 1.25rem | 500 | 0 | Table cells, filenames, status |

### 1.4 Spacing scale

Base unit: `4px`.

| Token | Value |
|-------|-------|
| `space-0` | 0 |
| `space-1` | 4px |
| `space-2` | 8px |
| `space-3` | 12px |
| `space-4` | 16px |
| `space-5` | 24px |
| `space-6` | 32px |
| `space-7` | 48px |
| `space-8` | 64px |
| `space-9` | 96px |
| `space-10` | 128px |

All vertical section padding defaults to `space-9` (96px) on desktop, `space-7` (48px) on mobile. Grid gaps default to `space-5` (24px). Card internal padding is `space-5` or `space-6`.

### 1.5 Elevation & shadows

Shadows are tinted with `--color-ink` at low opacity to keep the paper metaphor cohesive.

| Elevation | Token | Shadow |
|-----------|-------|--------|
| 0dp | `shadow-0` | none |
| 1dp | `shadow-1` | `0 1px 2px rgba(11, 19, 43, 0.04)` |
| 2dp | `shadow-2` | `0 4px 6px -1px rgba(11, 19, 43, 0.06)` |
| 4dp | `shadow-4` | `0 10px 15px -3px rgba(11, 19, 43, 0.08)` |
| 8dp | `shadow-8` | `0 20px 25px -5px rgba(11, 19, 43, 0.10)` |
| 12dp | `shadow-12` | `0 25px 50px -12px rgba(11, 19, 43, 0.16)` |

**Elevation semantics:**
- `shadow-2` — default cards, inputs at rest.
- `shadow-4` — hovered cards, sticky nav, elevated buttons.
- `shadow-8` — modals, dropdowns, pricing "Most popular" card.
- `shadow-12` — full-screen preview drawer, payment confirmation modal.

### 1.6 Buttons, links, inputs, chips, badges, progress

#### Buttons

- **Primary**
  ```
  bg-cobalt text-white rounded-lg px-6 py-3 font-semibold shadow-2
  hover:bg-cobalt-700 hover:shadow-4
  active:scale-[0.98]
  focus-visible:ring-2 focus-visible:ring-cobalt-500/30 focus-visible:ring-offset-2
  transition-all duration-150
  ```
- **Secondary**
  ```
  border-2 border-cobalt text-cobalt bg-transparent rounded-lg px-6 py-3 font-semibold
  hover:bg-cobalt-50 active:scale-[0.98]
  transition-all duration-150
  ```
- **Tertiary / Link button**
  ```
  text-cobalt font-medium underline-offset-4 hover:underline
  active:text-cobalt-700
  ```
- **Destructive**
  ```
  bg-rose text-white rounded-lg px-6 py-3 font-semibold
  hover:bg-rose-600 active:scale-[0.98]
  ```
- **Disabled**
  ```
  bg-stone-200 text-stone-400 cursor-not-allowed rounded-lg px-6 py-3 font-semibold
  ```

#### Links

- Inline: `text-cobalt font-medium underline-offset-4 hover:underline transition-colors`
- External: append the text ` (external)` in a `<span class="sr-only">` and visually show a small arrow icon (no emoji) in `text-cobalt`.

#### Inputs

```
min-h-[44px] w-full rounded-lg border border-stone-300 bg-paper px-4 py-2
 text-stone-900 placeholder:text-stone-400
 focus:border-cobalt-500 focus:ring-2 focus:ring-cobalt-500/20
 outline-none transition-shadow
```

- Radio/checkbox: `w-5 h-5 text-cobalt border-stone-300 focus:ring-cobalt-500`
- Textarea: same as input, `min-h-[120px]`
- Select: same as input, with a custom chevron SVG icon on the right

#### Chips (stack autocomplete)

```
inline-flex items-center gap-2 rounded-full bg-cobalt-50 text-cobalt-900
 px-3 py-1 text-sm font-medium border border-cobalt-100
```

Remove button inside chip is a 16x16 circle with `text-cobalt-700 hover:bg-cobalt-100`.

#### Badges

- `badge-most-popular`: `bg-amber text-ink uppercase tracking-wider text-[10px] font-bold rounded-full px-2 py-1`
- `badge-ready`: `bg-teal-50 text-teal-700 uppercase tracking-wider text-[10px] font-bold rounded-full px-2 py-1`
- `badge-generating`: `bg-amber-50 text-amber-700 uppercase tracking-wider text-[10px] font-bold rounded-full px-2 py-1`
- `badge-locked`: `bg-stone-100 text-stone-500 uppercase tracking-wider text-[10px] font-bold rounded-full px-2 py-1`

#### Progress bar

```
container: h-2 rounded-full bg-stone-200 overflow-hidden
bar:     h-full rounded-full bg-gradient-to-r from-cobalt to-teal transition-all duration-300 ease-out
```

### 1.7 Motion & transitions

- **Page load:** sections start with `opacity-0 translate-y-4` and animate to `opacity-100 translate-y-0` over `500ms` using `cubic-bezier(0.16, 1, 0.3, 1)`. Stagger children by `80ms`.
- **Card hover:** `translateY(-2px)` + `shadow-4` over `200ms`.
- **Button active:** `scale(0.98)` over `100ms`.
- **Progress bar:** width transition `300ms ease-out`.
- **Input focus:** `ring-2 ring-cobalt-500/20` + border color change over `150ms`.
- **Loading shimmer:** on generating packs, use a `bg-gradient-to-r from-stone-200 via-stone-100 to-stone-200` background with `background-size: 200% 100%` and a `1.5s` looping `translateX` animation.

### 1.8 Responsive breakpoints & mobile adaptations

| Breakpoint | Min width | Layout changes |
|------------|-----------|----------------|
| `sm` | 640px | larger tap targets, two-column pricing possible |
| `md` | 768px | nav becomes visible, preview page switches to sidebar + content, pricing grid 2 columns |
| `lg` | 1024px | hero switches to side-by-side, pricing grid 4 columns, dashboard table view |
| `xl` | 1280px | max content width `1280px` centered |

**Mobile rules:**
- All primary CTAs are full-width on viewports < `md`.
- Card padding reduces from `space-6` to `space-5`.
- Touch targets are at least `44px` x `44px`.
- The intake questionnaire collapses to a single column with a fixed sticky bottom bar for `Back` / `Next`.
- The dashboard switches from a table to stacked cards on mobile.
- Pricing cards scroll horizontally as a carousel on very small screens (`< 360px`) or stack vertically on `sm`+.

---

## 2. Page Mockups

### 2.1 Landing page

#### Purpose
Convert a founder or compliance lead from search/ referral into a free preview. The page must answer three questions in 5 seconds: what is it, who is it for, and what does it cost.

#### Visual description
- Background: `--color-parchment` top to bottom.
- Hero background: a full-width `--color-ink` band with an oversized, faint outline of a shield/lock glyph behind the headline in `--color-ink-light` at 10% opacity.
- Headline in `hero` type, white, left-aligned on desktop, centered on mobile.
- Subhead in `body-lg`, `--color-stone-400` on dark background.
- CTA row uses primary + secondary buttons with `space-4` gap.
- Trust bar under CTA: four horizontal pills on dark background, each with a small icon placeholder and `caption` text in `--color-stone-400`.
- Problem / Solution / How it works / Pricing teaser / Trust / Final CTA follow as alternating parchment and subtle white band sections.

#### ASCII layout — desktop

```
+--------------------------------------------------------------------------------------+
| [PolicyForge]    How it works    Pricing    Sign in    [Get started — free preview]  |
+--------------------------------------------------------------------------------------+
| BG: ink                                                                              |
|  +------------------------------------------+  +----------------------------------+  |
|  | HEADLINE                                 |  | [Hero preview card]              |  |
|  | SOC 2 Type I policy pack,                |  | Access Control Policy            |  |
|  | generated for your actual stack.         |  | — tailored first draft           |  |
|  |                                          |  | [icon: lock] [icon: check]       |  |
|  | SUBHEAD                                  |  | Generated from:                  |  |
|  | Answer a 10-minute questionnaire. Get    |  | Google Workspace, AWS, GitHub    |  |
|  | 15-25 tailored policies, a control map,  |  | Slack, Stripe                    |  |
|  | and an evidence checklist. No $10k       |  |                                  |  |
|  | consultant required.                     |  +----------------------------------+  |
|  |                                          |                                      |
|  | [Start your free preview]  [See pricing] |                                      |
|  |                                          |                                      |
|  | [SOC 2 Type I] [MD+DOCX+CSV] [30-day    |                                      |
|  | edits] [One free regeneration]           |                                      |
|  +------------------------------------------+                                      |
+--------------------------------------------------------------------------------------+
| PROBLEM                                                                              |
| "Your auditor wants policies. You have 47 open tabs."                                |
| +--------------------+ +--------------------+ +--------------------+                 |
| | Too generic        | | Too expensive      | | Too much tooling   |                 |
| | $49 templates      | | $1k-$15k           | | You don't need     |                 |
| | name controls you  | | consultants,       | | continuous         |                 |
| | don't have.        | | 3-week waits.      | | monitoring yet.    |                 |
| +--------------------+ +--------------------+ +--------------------+                 |
+--------------------------------------------------------------------------------------+
| SOLUTION                                                                             |
| "A tailored first draft in an afternoon."                                            |
| +--------------------+ +--------------------+ +--------------------+                 |
| | Stack-aware        | | Control map +      | | Auditor-ready      |                 |
| | generation         | | evidence checklist | | exports            |                 |
| | Names your real    | | Maps each policy   | | Markdown, DOCX,    |                 |
| | tools & vendors.   | | to tested controls.| | CSV.               |                 |
| +--------------------+ +--------------------+ +--------------------+                 |
+--------------------------------------------------------------------------------------+
| HOW IT WORKS                                                                         |
| 1. Screener  ->  2. Stack  ->  3. Preview  ->  4. Unlock & download                  |
+--------------------------------------------------------------------------------------+
| PRICING TEASER                                                                       |
| [Starter $349] [Growth $599/yr] [Scale $1,199/yr]  [View full pricing]               |
+--------------------------------------------------------------------------------------+
| TRUST                                                                                |
| "The first thing every auditor asks for is a coherent set of policies and evidence.  |
|  PolicyForge gets us from zero to ready in an afternoon."                            |
|  — Compliance lead, seed-stage fintech                                               |
|                                                                                      |
| [Banner] This is a starting template, not legal advice. Review with your auditor,    |
| compliance consultant, or legal counsel before submission.                           |
+--------------------------------------------------------------------------------------+
| FINAL CTA                                                                            |
| Ready to stop dreading the policy binder?                                            |
| [Start your free preview]                                                            |
+--------------------------------------------------------------------------------------+
| FOOTER                                                                               |
| (c) Auto Company · Privacy · Terms · Disclaimer                                      |
+--------------------------------------------------------------------------------------+
```

#### Copy snippets

- **Nav CTA:** `Get started — free preview`
- **Hero headline:** `SOC 2 Type I policy pack, generated for your actual stack.`
- **Hero subhead:** `Answer a 10-minute questionnaire. Get 15–25 tailored policies, a control map, and an evidence checklist—ready for your auditor, without the $10,000 consultant.`
- **Primary CTA:** `Start your free preview`
- **Secondary CTA:** `See pricing`
- **Trust pills:**
  - `SOC 2 Type I ready`
  - `Markdown + DOCX + CSV`
  - `30-day edit window`
  - `One free regeneration`
- **Problem headline:** `Your auditor wants policies. You have 47 open tabs.`
- **Problem cards:**
  1. `Too generic` / `$49 template packs name controls you do not have.`
  2. `Too expensive` / `$1,000–$15,000 consultants and three-week waits.`
  3. `Too much tooling` / `You do not need continuous monitoring yet. You need a first draft.`
- **Solution headline:** `A tailored first draft in an afternoon.`
- **Solution cards:**
  1. `Stack-aware generation` / `Names your real tools, vendors, and cloud environment.`
  2. `Control map + evidence checklist` / `Maps every policy to the controls your auditor will test.`
  3. `Auditor-ready exports` / `Markdown, DOCX, and CSV for Vanta, Drata, Secureframe, or your auditor.`
- **How it works steps:**
  1. `Answer the screener` — `2 minutes`
  2. `Tailor your stack` — `5 minutes`
  3. `Preview one policy` — `Instant`
  4. `Unlock & download` — `2 minutes`
- **Final CTA headline:** `Ready to stop dreading the policy binder?`
- **Disclaimer banner:** `This is a starting template, not legal advice. Review with your auditor, compliance consultant, or legal counsel before submission.`

#### Mobile adaptation
- Hero stacks vertically; headline is centered; preview card moves below CTA.
- Trust pills wrap 2x2.
- Problem/Solution/How it works cards stack 1 column.
- Pricing teaser cards stack.
- Hero headline shrinks from `hero` (3rem) to avoid overflow.

---

### 2.2 Pricing page — A/B test variants

#### Purpose
Convert free-preview visitors into paying customers and anchor Scale against the $2,500+ Audit Assist tier. The Starter price is A/B tested at `$349` (Variant A) and `$399` (Variant B). All other tiers remain constant.

#### Visual description
- Background: `--color-parchment`.
- Page header centered with `h2` and `body-lg` subhead.
- A subtle top banner in `--color-amber-50` with `text-amber-800` notes that this is a tailored first draft, not legal advice.
- Pricing grid: 4 cards on desktop. The **Growth** card is visually dominant with a `badge-most-popular` and `shadow-8`. **Starter** and **Scale** use `shadow-2`. **Audit Assist** is a wider, horizontal card below the grid spanning the full content width.
- Variant A/B is tracked by a hidden `data-variant` attribute and a visible test badge on the Starter card for the mockup (not for users): `Variant A: $349` / `Variant B: $399`.

#### ASCII layout — desktop (Variant A shown)

```
+--------------------------------------------------------------------------------------+
| [PolicyForge]    How it works    Pricing    Sign in    [Get started — free preview]  |
+--------------------------------------------------------------------------------------+
| [Amber banner] This is a starting template, not legal advice. Review with your       |
| auditor, compliance consultant, or legal counsel before submission.                  |
+--------------------------------------------------------------------------------------+
|                           Choose your plan                                           |
|       One-time for a single audit. Annual plans for ongoing readiness.               |
|                                                                                      |
|  +----------------+  +----------------+  +----------------+  +----------------+      |
|  | Starter        |  | Growth         |  | Scale          |  | Starter        |      |
|  | Variant A      |  | Most popular   |  | Best value     |  | Variant B      |      |
|  |                |  |                |  |                |  |                |      |
|  | $349           |  | $599           |  | $1,199         |  | $399           |      |
|  | one-time       |  | /year          |  | /year          |  | one-time       |      |
|  |                |  |                |  |                |  |                |      |
|  | Full SOC 2     |  | Full SOC 2     |  | Multi-         |  | Full SOC 2     |      |
|  | Type I pack    |  | Type I pack    |  | framework      |  | Type I pack    |      |
|  | 15-25 policies |  | 15-25 policies |  | (SOC 2 +       |  | 15-25 policies |      |
|  | Control map    |  | Control map    |  | ISO 27001:2022 |  | Control map    |      |
|  | Evidence       |  | Evidence       |  | after Week 5)  |  | Evidence       |      |
|  | checklist      |  | checklist      |  | Gap-analysis   |  | checklist      |      |
|  | Markdown,      |  | Markdown,      |  | checklist      |  | Markdown,      |      |
|  | DOCX, CSV      |  | DOCX, CSV      |  | Markdown,      |  | DOCX, CSV      |      |
|  |                |  |                |  | DOCX, CSV      |  |                |      |
|  | 30-day edit    |  | Annual review  |  | Annual refresh |  | 30-day edit    |      |
|  | window         |  | + redline      |  | + priority     |  | window         |      |
|  | One free       |  | Email support  |  | support        |  | One free       |      |
|  | regeneration   |  |                |  |                |  | regeneration   |      |
|  |                |  |                |  |                |  |                |      |
|  | [Buy Starter]  |  | [Buy Growth]   |  | [Buy Scale]    |  | [Buy Starter]  |      |
|  +----------------+  +----------------+  +----------------+  +----------------+      |
|                                                                                      |
|  +--------------------------------------------------------------------------------+  |
|  | Audit Assist — $2,500+                                                         |  |
|  | Custom human review and advisory engagement. Scoped separately.                 |  |
|  | Recommended for teams that want a compliance consultant to review the draft     |  |
|  | before submission.                                                              |  |
|  | [Request a quote]                                                              |  |
|  +--------------------------------------------------------------------------------+  |
|                                                                                      |
|  [Toggle] Monthly / Yearly (annual only at launch; toggle hidden until Monthly    |  |
|  add-on ships)                                                                    |  |
+--------------------------------------------------------------------------------------+
| FOOTER                                                                               |
+--------------------------------------------------------------------------------------+
```

#### Variant specification

| Variant | Starter price | CTA text | URL tracking parameter | Visual marker (mockup only) |
|---------|---------------|----------|------------------------|----------------------------|
| **A** | `$349` one-time | `Buy Starter — $349` | `?variant=a` | Small amber pill: `Variant A` |
| **B** | `$399` one-time | `Buy Starter — $399` | `?variant=b` | Small amber pill: `Variant B` |

All other tiers are identical across variants:
- **Growth:** `$599/year` (badge: `Most popular`)
- **Scale:** `$1,199/year`
- **Audit Assist:** `$2,500+`

The A/B test is optimized for **revenue per visitor**, so the Starter CTA button and price text are the only elements that change between variants.

#### Copy snippets

- **Page headline:** `Choose your plan`
- **Page subhead:** `One-time for a single audit. Annual plans for ongoing readiness.`
- **Starter card title:** `Starter`
- **Starter price Variant A:** `$349` `one-time`
- **Starter price Variant B:** `$399` `one-time`
- **Starter features:**
  - `Full SOC 2 Type I policy pack`
  - `15–25 tailored policies`
  - `Control map + evidence checklist`
  - `Markdown, DOCX, and CSV exports`
  - `30-day edit window`
  - `One free regeneration`
  - `No future updates`
- **Starter CTA Variant A:** `Buy Starter — $349`
- **Starter CTA Variant B:** `Buy Starter — $399`
- **Growth card title:** `Growth` (badge `Most popular`)
- **Growth price:** `$599` `/year`
- **Growth features:**
  - `Everything in Starter`
  - `Annual policy review`
  - `Evidence checklist updates`
  - `Email support`
  - `One framework`
- **Growth CTA:** `Buy Growth — $599/year`
- **Scale card title:** `Scale`
- **Scale price:** `$1,199` `/year`
- **Scale features:**
  - `Everything in Growth`
  - `Multi-framework (SOC 2 Type I + ISO 27001:2022 after Week 5)`
  - `Gap-analysis checklist`
  - `Annual refresh + priority support`
- **Scale CTA:** `Buy Scale — $1,199/year`
- **Audit Assist title:** `Audit Assist`
- **Audit Assist price:** `$2,500+`
- **Audit Assist copy:** `Custom human review and advisory engagement. Scoped separately. Recommended for teams that want a compliance consultant to review the draft before submission.`
- **Audit Assist CTA:** `Request a quote`
- **Disclaimer banner:** same as landing page.

#### Mobile adaptation
- Pricing cards stack vertically.
- Growth card keeps `shadow-8` and `badge-most-popular` but becomes full-width.
- Audit Assist card stacks its content vertically.
- Sticky bottom bar appears with the selected plan's CTA after a user scrolls past the pricing grid.

---

### 2.3 Intake screener & 3-section questionnaire

#### Purpose
Collect the minimum information needed to generate a stack-sensitive policy preview while keeping completion above 80% and median time below 10 minutes.

#### Visual description
- A centered, narrow container (`max-w-2xl`) on a `--color-parchment` background.
- The screener is a single full-screen card with the headline and form fields.
- The questionnaire replaces the screener with a sticky top bar containing:
  - Step indicator (4 dots: Screener, Company, Stack, Practices, Review)
  - Progress bar
  - `Saved` status text in `--color-stone-400`
  - `X` close / exit action (autosaves)
- Each section is a card with `shadow-2`, `space-6` padding, and a section title in `h3`.
- Questions stack vertically with `space-5` between them.
- Smart defaults are pre-selected where safe (e.g., `10–50 people`, `No` for having written incident response).
- "Not sure" options are always available as radio or checkbox choices to avoid drop-off.
- Bottom bar floats on mobile and is static on desktop: `Back` (secondary) on the left, `Next` (primary) on the right. On the Review step, `Next` becomes `Generate free preview`.

#### ASCII layout — screener

```
+--------------------------------------------------------------------------------------+
| [PolicyForge logo]                                            [Sign in]             |
+--------------------------------------------------------------------------------------+
|                                                                                      |
|                         Let's make sure PolicyForge fits your audit                  |
|                                                                                      |
|   +------------------------------------------------------------------------------+   |
|   |   Email address                                                                |   |
|   |   [you@company.com                                                    ]        |   |
|   |                                                                                |   |
|   |   Company name                                                                 |   |
|   |   [Acme, Inc.                                                         ]        |   |
|   |                                                                                |   |
|   |   Which audit framework are you preparing for?                                 |   |
|   |   (o) SOC 2 Type I                    ( ) ISO 27001:2022 [coming soon]        |   |
|   |                                                                                |   |
|   |   Team size                                                                    |   |
|   |   (o) 1–10   ( ) 11–50   ( ) 51–200   ( ) 200+                                |   |
|   |                                                                                |   |
|   |   Where is your company incorporated?                                          |   |
|   |   [United States ▼]                                                            |   |
|   |                                                                                |   |
|   |   [Start questionnaire]                                                        |   |
|   +------------------------------------------------------------------------------+   |
|                                                                                      |
+--------------------------------------------------------------------------------------+
```

#### ASCII layout — questionnaire (Section 2: Stack & vendors)

```
+--------------------------------------------------------------------------------------+
| [PolicyForge]                                                         [Saved]  [X]  |
| Step 2 of 4: Stack & vendors                                                         |
| [=======----------------] 50%                                                        |
+--------------------------------------------------------------------------------------+
|                                                                                      |
|   +------------------------------------------------------------------------------+   |
|   | Section 2: Stack & vendors                                                     |   |
|   |                                                                                |   |
|   | Which tools and vendors does your company use?                                 |   |
|   | Type to add; click to remove.                                                  |   |
|   | [Google Workspace] [x]  [AWS] [x]  [GitHub] [x]  [Slack] [x]  [Stripe] [x]    |   |
|   | [+ add tool...                                                         ]        |   |
|   |                                                                                |   |
|   | Primary production cloud provider                                              |   |
|   | (o) AWS  ( ) Google Cloud  ( ) Azure  ( ) Other  ( ) Not sure                 |   |
|   |                                                                                |   |
|   | Primary code host / CI/CD                                                      |   |
|   | (o) GitHub  ( ) GitLab  ( ) Bitbucket  ( ) Other  ( ) Not sure                |   |
|   |                                                                                |   |
|   | Identity and access management                                                 |   |
|   | (o) Google Workspace SSO  ( ) Okta  ( ) JumpCloud  ( ) None yet  ( ) Not sure |   |
|   |                                                                                |   |
|   | Password manager                                                               |   |
|   | (o) 1Password  ( ) Bitwarden  ( ) Dashlane  ( ) None yet  ( ) Not sure        |   |
|   +------------------------------------------------------------------------------+   |
|                                                                                      |
|   [Back]                                              [Next: Practices & data]       |
+--------------------------------------------------------------------------------------+
```

#### Questionnaire sections & questions

**Section 1 — Company & team**
1. `What should we call this pack?` (text, placeholder: `Acme — SOC 2 Type I`)
2. `How many people work at your company?` (radio: `1–10`, `11–50` default, `51–200`, `200+`)
3. `Do you have a designated security or compliance lead?` (radio: `Yes`, `No` default, `Not sure`)
4. `Where is your company incorporated?` (select, default `United States`; options: `United States`, `Canada`, `United Kingdom`, `EU member state`, `Other`)
5. `Which describes your team structure?` (checkboxes: `Fully remote`, `Hybrid`, `Contractors / freelancers`, `Subsidiaries or affiliates`, `None of these`)

**Section 2 — Stack & vendors** (replaces "subprocessors" with "tools and vendors")
1. `Which tools and vendors does your company use?` (multi-autocomplete chips). Suggested options: `Google Workspace`, `Microsoft 365`, `AWS`, `Google Cloud`, `Azure`, `GitHub`, `GitLab`, `Bitbucket`, `Slack`, `Notion`, `Stripe`, `QuickBooks`, `HubSpot`, `Salesforce`, `1Password`, `Okta`, `JumpCloud`.
2. `Primary production cloud provider` (radio with `Not sure`)
3. `Primary code host / CI/CD` (radio with `Not sure`)
4. `Identity and access management` (radio with `Not sure`)
5. `Password manager` (radio with `Not sure`)

**Section 3 — Practices & data**
1. `Where do you store customer data?` (checkboxes: `AWS / GCP / Azure`, `PostgreSQL`, `MongoDB`, `Snowflake`, `Third-party SaaS`, `Not sure`)
2. `Which of the following data types do you handle?` (checkboxes: `Standard contact/billing data`, `Payment card data`, `Protected health information (PHI)`, `Biometric data`, `Government ID numbers`, `None of the above`)
3. `Do you currently have written incident response, access control, and risk assessment procedures?` (radio: `Yes`, `Partial`, `No` default, `Not sure`)
4. `Do you have a target audit date or firm?` (optional text, placeholder: `Q2 2026, Firm Name`)
5. `Any other context that should shape your policies?` (optional textarea, placeholder: `e.g., we are a fintech serving US banks`)

**Review step**
- Summary card with editable section accordions.
- Primary action: `Generate free preview`.
- Secondary action: `Edit answers`.
- Disclaimer text below button: `This generates a tailored first draft, not a final policy. Review with your auditor or counsel before submission.`

#### Mobile adaptation
- The sticky top progress bar shrinks to just the percentage and step label.
- Question cards use full width with `space-5` padding.
- Autocomplete chips wrap and remain tappable at 44px min height.
- The `Back` / `Next` bar is fixed to the bottom of the viewport with a `--color-paper` background and a top border.
- Radios/checkboxes use larger touch targets (`min-h-[44px]` labels).

---

### 2.4 Preview page

#### Purpose
Show the value of the generated policy before asking for payment. The unlocked policy is the highest-value, stack-sensitive one: **Information Security Policy** or **Access Control Policy** depending on the user's stack. The control map shows the first 4 rows; the rest are locked behind a clear paywall.

#### Visual description
- Layout: two-column on desktop (`35%` sidebar, `65%` preview), single column on mobile.
- Top of the page has a global amber disclaimer banner.
- Sidebar:
  - Page title `Your free preview` in `h3`.
  - A list of 15–25 policies. The unlocked policy is highlighted with `--color-cobalt-50` background and a left `4px` cobalt border. Locked policies show a `badge-locked` and a subtle lock icon placeholder.
  - Below the policy list, a "What's in the full pack" summary.
- Main preview:
  - Card with `--color-paper` background, `shadow-2`, and generous padding.
  - Policy title in `h3` (e.g., `Information Security Policy`).
  - Rendered Markdown body in `body` type with `max-width: 70ch` for readability.
  - A faded "sample draft" watermark overlay at the bottom 20% of the document (text only, no logo): `SAMPLE PREVIEW`.
  - CTA bar at the bottom: `Unlock full pack — $349` (Variant A) or `$399` (Variant B), plus `Compare plans` link.
- Control map preview below the policy preview:
  - A table with columns `Policy`, `Control`, `Evidence needed`, `Status`.
  - First 4 rows visible.
  - Remaining rows hidden behind a gradient overlay and a centered CTA: `See all 12+ controls in the full pack`.

#### ASCII layout — desktop

```
+--------------------------------------------------------------------------------------+
| [< Back]                        Your free preview              [Unlock full pack]  |
+--------------------------------------------------------------------------------------+
| [Amber banner] This is a tailored first draft, not legal advice. Review with your    |
| auditor, compliance consultant, or legal counsel before submission.                  |
+--------------------------------------------------------------------------------------+
|  +-----------------------------+  +------------------------------------------------+  |
|  | Information Security Policy |  | Information Security Policy                      |  |
|  | (unlocked)                  |  | ------------------------------------------------ |  |
|  |                             |  | 1. Purpose and scope                             |  |
|  | Access Control Policy       |  | This policy defines the requirements...          |  |
|  | (locked)                    |  |                                                  |  |
|  |                             |  | 2. Roles and responsibilities                    |  |
|  | Asset Management Policy     |  | [Name] is responsible for...                     |  |
|  | (locked)                    |  |                                                  |  |
|  | Incident Response Plan      |  | 3. Information classification                    |  |
|  | (locked)                    |  | Customer data is classified as...                |  |
|  |                             |  |                                                  |  |
|  | ... 12 more                 |  |                                                  |  |
|  | (locked)                    |  | [SAMPLE PREVIEW watermark fades at bottom]       |  |
|  |                             |  |                                                  |  |
|  | What's included in full:    |  | [Unlock full pack — $349]  [Compare plans]       |  |
|  | 15-25 policies              |  |                                                  |  |
|  | Control map                 |  +------------------------------------------------+  |
|  | Evidence checklist          |                                                    |
|  | Markdown + DOCX + CSV       |  +------------------------------------------------+  |
|  +-----------------------------+  | Control map preview                              |  |
|                                   | Policy | Control | Evidence needed | Status     |  |
|                                   | InfoSec| CC6.1   | List of users   | Draft      |  |
|                                   | Access | CC6.2   | Access review   | Draft      |  |
|                                   | Risk   | CC3.1   | Risk register   | Draft      |  |
|                                   | Vendor | CC9.1   | Vendor list     | Draft      |  |
|                                   |                                      |            |  |
|                                   | [Gradient overlay]                   |            |  |
|                                   | 12+ more controls in the full pack   |            |  |
|                                   | [See full control map]               |            |  |
|                                   +------------------------------------------------+  |
+--------------------------------------------------------------------------------------+
```

#### Copy snippets

- **Page title:** `Your free preview`
- **Unlocked policy title:** `Information Security Policy` (or `Access Control Policy` for teams with complex IAM)
- **Sidebar section title:** `Included in full pack`
- **Locked policy label:** `Included in full pack`
- **Policy preview watermark:** `SAMPLE PREVIEW`
- **Primary CTA Variant A:** `Unlock full pack — $349`
- **Primary CTA Variant B:** `Unlock full pack — $399`
- **Secondary CTA:** `Compare plans`
- **Control map CTA:** `See all 12+ controls in the full pack`
- **Disclaimer banner:** `This is a tailored first draft, not legal advice. Review with your auditor, compliance consultant, or legal counsel before submission.`

#### Mobile adaptation
- Sidebar becomes a horizontal scrollable policy strip at the top of the page, with the unlocked item highlighted.
- Preview card uses full width; CTA bar becomes a fixed sticky bottom bar.
- Control map table converts to a stacked card list (one card per control).
- Locked rows show a blurred overlay instead of a gradient.

---

### 2.5 Customer dashboard

#### Purpose
Help the customer find their generated packs, download exports, track status, and complete the post-download checklist. The 4-step checklist turns a one-time document sale into a guided readiness workflow.

#### Visual description
- Background: `--color-parchment`.
- Top nav: logo, `Dashboard`, `Help`, `Account`.
- Page header: personalized greeting `Welcome back, {name}` on the left, `Start new pack` primary button on the right.
- Global disclaimer banner directly below the header.
- Two main areas:
  1. **Packs list** — a card/table hybrid. On desktop it is a table with columns `Pack`, `Framework`, `Created`, `Status`, `Downloads`, `Actions`. On mobile each row becomes a card with stacked fields and a row of icon-only download buttons labeled with tooltips.
  2. **Post-download checklist** — displayed as a collapsible panel inside each pack row/card. On desktop it expands below the row. On mobile it is an accordion inside the card.
- Status chips use color tokens:
  - `Draft` — `bg-stone-100 text-stone-600`
  - `Generating` — `bg-amber-50 text-amber-700` with a spinner dot
  - `Ready` — `bg-teal-50 text-teal-700`
  - `Edited` — `bg-cobalt-50 text-cobalt-700`
  - `Expired` — `bg-rose-50 text-rose-700`
- Each pack row has action buttons:
  - `Markdown`, `DOCX`, `CSV` as small secondary buttons.
  - `Regenerate` (enabled for 30 days after creation, otherwise disabled with tooltip).
  - `Checklist` toggle.
- The checklist shows 4 steps with checkboxes, progress percentage, and a small note under each step. Completing all 4 updates the pack status to `Ready to review`.

#### ASCII layout — desktop

```
+--------------------------------------------------------------------------------------+
| [PolicyForge]    Dashboard    Help    Account    [Start new pack]                   |
+--------------------------------------------------------------------------------------+
| Welcome back, Alex.                                       [Start new pack]           |
+--------------------------------------------------------------------------------------+
| [Amber banner] This is a starting template, not legal advice. Review with your       |
| auditor, compliance consultant, or legal counsel before submission.                  |
+--------------------------------------------------------------------------------------+
| YOUR PACKS                                                                           |
| +---------------------------------------------------------------------------------+  |
| | Pack                      | Framework    | Created   | Status   | Actions       |  |
| |---------------------------|--------------|-----------|----------|---------------|  |
| | Acme Seed — SOC 2 Type I  | SOC 2 Type I | Oct 21    | Ready    | [MD] [DOCX]   |  |
| |                           |              |           |          | [CSV] [Regen] |  |
| |                           |              |           |          | [Checklist]   |  |
| +---------------------------------------------------------------------------------+  |
|                                                                                      |
| POST-DOWNLOAD CHECKLIST — Acme Seed                                                  |
| [=======----------------] 50% complete                                               |
| +---------------------------------------------------------------------------------+  |
| | [x] 1. Assign policy owners                                                     |  |
| |      Name an owner for each generated policy.                                   |  |
| |                                                                                 |  |
| | [x] 2. Customize procedures to match your actual controls                       |  |
| |      Edit the Markdown or DOCX to reflect how your team really works.           |  |
| |                                                                                 |  |
| | [ ] 3. Collect evidence using the control map                                   |  |
| |      Use the CSV to map each control to screenshots, logs, or config exports.   |  |
| |                                                                                 |  |
| | [ ] 4. Review with your auditor, compliance consultant, or legal counsel        |  |
| |      Do not submit unreviewed drafts.                                           |  |
| +---------------------------------------------------------------------------------+  |
|                                                                                      |
| +---------------------------------------------------------------------------------+  |
| | Staging Audit — SOC 2 Type I  | SOC 2 Type I | Oct 23  | Generating  | ...       |  |
| +---------------------------------------------------------------------------------+  |
|                                                                                      |
| EMPTY STATE                                                                          |
| +---------------------------------------------------------------------------------+  |
| | You don't have any packs yet.                                                   |  |
| | Start with a free preview.                                                      |  |
| | [Start your free preview]                                                       |  |
| +---------------------------------------------------------------------------------+  |
+--------------------------------------------------------------------------------------+
```

#### 4-step post-download checklist copy

1. **Assign policy owners**
   - `Name an owner for each generated policy. The owner is responsible for keeping the document accurate.`
2. **Customize procedures to match your actual controls**
   - `Edit the Markdown or DOCX to reflect how your team really works. Do not submit the first draft unchanged.`
3. **Collect evidence using the control map**
   - `Use the CSV control map to map each control to screenshots, system logs, or configuration exports your auditor will ask for.`
4. **Review with your auditor, compliance consultant, or legal counsel**
   - `Do not submit unreviewed drafts. Your auditor or counsel must confirm the policies describe your actual environment.`

#### Status chips and actions copy

- **Status labels:** `Draft`, `Generating`, `Ready`, `Edited`, `Expired`
- **Download buttons:** `Markdown`, `DOCX`, `CSV`
- **Regenerate button:** `Regenerate` (active) / `Regenerate (expired)` (disabled)
- **Checklist toggle:** `Show checklist` / `Hide checklist`
- **Empty state headline:** `You don't have any packs yet.`
- **Empty state copy:** `Start with a free preview and generate your first SOC 2 Type I policy pack.`
- **Empty state CTA:** `Start your free preview`

#### Mobile adaptation
- The packs list becomes a vertical stack of cards. Each card contains:
  - Pack title, framework, created date, status chip.
  - A row of icon + text download buttons (e.g., `MD`, `DOCX`, `CSV`) stacked 2x2.
  - `Regenerate` and `Checklist` buttons below.
- The checklist is an accordion that expands within the card.
- The `Start new pack` button is full-width below the header.
- The table header is hidden; data is labeled with inline captions.

---

## 3. Cross-Cutting UI Rules

1. **Disclaimer presence.** The `This is a starting template, not legal advice...` banner appears on the landing page hero footer, pricing page, preview page, purchase modal, dashboard, and as a header in every generated document.
2. **A/B test surface area.** Only the Starter price, Starter CTA text, and URL parameter differ between Variant A and Variant B. All other layout, color, typography, and motion remain identical.
3. **Accessibility.** All focus states use `focus-visible` with a `2px` cobalt ring and `2px` offset. Color contrast meets WCAG AA for all body text and UI controls.
4. **Loading states.** Any action that triggers generation (preview, full pack, regeneration) shows a clear loading state: disabled button with a spinner, progress bar, and status text.
5. **Empty and error states.** Empty states use `body-lg` centered copy with a primary CTA. Error states use `rose` accents and always offer a recovery action (`Try again`, `Contact support`).
6. **Motion reduction.** Respect `prefers-reduced-motion` by disabling transforms and fades; only opacity changes or instant state changes remain.

---

## 4. Implementation Notes for `fullstack-dhh`

- Use **Tailwind CSS v4** with CSS variables mapped to the color tokens above. Add the custom colors to `theme.extend.colors` (or the v4 `@theme` block) as `ink`, `cobalt`, `parchment`, `paper`, `amber`, `teal`, `rose`.
- Load fonts via `next/font/google`:
  - `Bricolage_Grotesque`
  - `Manrope`
  - `JetBrains_Mono`
- The pricing page should read `?variant=a|b` and persist the variant in a cookie for consistency across the funnel.
- The intake should save answers to `localStorage` after every field blur and POST to `/api/v1/questionnaires` on `Next`.
- The preview page should fetch `POST /api/v1/packs/preview` and render Markdown with a lightweight parser; lock remaining policy list with CSS blur and an overlay.
- The dashboard should poll `GET /api/v1/packs/:id/status` for `Generating` packs every 3 seconds.
- Components to build: `Button`, `Input`, `RadioGroup`, `CheckboxGroup`, `ChipInput`, `ProgressBar`, `Card`, `Badge`, `PricingCard`, `PolicyPreview`, `ControlMapTable`, `PackRow`, `Checklist`.
