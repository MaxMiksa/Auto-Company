# PolicyForge — Implementation Notes

**Agent:** `fullstack-dhh`  
**Scope:** scaffold `projects/policyforge`, landing page, pricing with A/B test, intake questionnaire, and waitlist API.

---

## Stack

- Next.js 15.5 (App Router, React 19)
- TypeScript 5
- Tailwind CSS v4 (`@tailwindcss/postcss`)
- `lucide-react` for icons
- Node.js `fs` for waitlist persistence (JSONL fallback to `/tmp` for serverless)

Created with `npx create-next-app@15` and then trimmed to a minimal, monolithic layout.

---

## Project Layout

```
projects/policyforge/
├── app/
│   ├── api/waitlist/route.ts   # POST email to Postgres or JSONL fallback
│   ├── globals.css             # Tailwind v4 tokens + theme colors
│   ├── layout.tsx              # Shared header, nav, footer disclaimer, Analytics/SpeedInsights
│   ├── page.tsx                # Landing page + waitlist form
│   ├── pricing/page.tsx        # 4 tiers + $199/$249 Starter A/B test
│   ├── intake/page.tsx         # Screener + 3-section questionnaire
│   ├── terms/page.tsx          # Terms of Service
│   ├── privacy/page.tsx        # Privacy Policy
│   └── disclaimer/page.tsx     # Disclaimer / not legal advice
├── data/                       # Waitlist JSONL fallback (created on first write)
├── .env.example                # Environment template
├── vercel.json                 # Vercel build + security headers
├── .github/workflows/          # CI/CD at repo root (see ../../.github/workflows/policyforge-ci-cd.yml)
├── next.config.ts
├── package.json
├── postcss.config.mjs
└── tsconfig.json
```

---

## Setup

```bash
cd /home/rej/QOSOD/Auto-Company/projects/policyforge
npm install
```

If you ever re-scaffold, delete `projects/policyforge` first. This project is intentionally not overwriting an existing app.

---

## Run

```bash
npm run dev
```

Open `http://localhost:3000`.

- `/` — landing page with hero, value prop, trust signals, disclaimer, waitlist form.
- `/pricing` — Starter ($199 control vs $249 variant), Growth ($499/yr), Scale ($999/yr), Audit Assist ($2,500+).
- `/intake` — screener + 3-section questionnaire with progress bar and localStorage auto-save.
- `/api/waitlist` — POST `{ "email": "..." }`, writes to Postgres when `POSTGRES_URL` is set, else appends to `data/waitlist.jsonl`.

---

## Build

```bash
npm run build
```

Uses Turbopack by default (`next dev --turbopack`, `next build --turbopack`). If you hit Tailwind v4 issues, remove `--turbopack` from `package.json` scripts.

---

## Deploy

### Vercel (recommended)

Production configuration is stored in `projects/policyforge/vercel.json` and automated by `.github/workflows/policyforge-ci-cd.yml`.

1. Set Vercel project secrets in GitHub: `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`.
2. Push to `main` or open a pull request. The workflow runs lint, type-check, tests, and build before deploying.
3. `vercel.json` enforces Next.js build settings and security headers.

The waitlist endpoint writes to Postgres when `POSTGRES_URL` is set, otherwise falls back to `/tmp/waitlist.jsonl` in serverless environments.

### Other Node hosts

```bash
npm ci
npm run build
npm start
```

Ensure the host provides a writable `data/` directory or the route falls back to `/tmp`.

---

## A/B Test (Starter pricing)

The `/pricing` page assigns a 50/50 `pf_starter_variant` cookie (`a` or `b`):

- `a` → Starter $199
- `b` → Starter $249

Override with the query string:

```
/pricing?variant=a
/pricing?variant=b
```

The query parameter sets the cookie and is picked up on future visits. Optimize for revenue per visitor; switch the default to `b` if it wins.

---

## Data Model Notes

- **Waitlist:** JSONL file of `{ email, createdAt }` objects.
- **Intake:** stored in the browser via `localStorage` under `policyforge_intake`.
- **No auth, no Postgres, no Stripe wiring yet.** These are Week 2–4 deliverables per `docs/ceo/policyforge-decision.md`.

---

## Known Limitations / Next Steps

1. **Waitlist persistence:** file-based and not safe across serverless cold starts. Swap for Postgres/Drizzle before public launch.
2. **Intake persistence:** localStorage only. Add `POST /api/intake` when generation is wired.
3. **Payments:** pricing is static. Integrate Stripe Checkout and Customer Portal for Week 4 gate.
4. **Preview/generation:** not implemented; this scaffold is the public shell for Week 1–2 validation.
5. **No tests yet.** Add unit tests for waitlist validation and intake state before Week 6 QA gate.

---

## Design Tokens

Colors and fonts are defined in `app/globals.css` using Tailwind v4 `@theme inline`:

- `bg-background` / `text-foreground`
- `bg-primary` / `text-primary-foreground`
- `bg-muted` / `text-muted-foreground`
- `bg-accent` / `text-accent-foreground`
- Font: Geist (Next.js Google font) via `--font-geist-sans`

Dark mode follows `prefers-color-scheme`.
