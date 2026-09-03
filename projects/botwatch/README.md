# BotWatch v1

AI-crawler analytics and allow/block control for Cloudflare **Free/Pro** sites. Cloudflare
gates this behind Enterprise Bot Management — BotWatch gives it to everyone else.

See you exactly which AI crawlers (GPTBot, ClaudeBot, PerplexityBot, Google-Extended,
Bytespider, and more) are hitting your site, and allow or block the ones you don't want,
without paying for Cloudflare Enterprise.

Architecture decisions are recorded in
`docs/cto/adr-botwatch-v1-architecture.md`. Read that first if you're changing how
detection, storage, or enforcement works.

## How it works

1. A single Cloudflare Worker sits in front of your zone via a **Worker Route**
   (`example.com/*`) — Worker Routes work on Free/Pro, unlike Bot Management.
2. Every request's `User-Agent` is matched against a maintained list of known AI
   crawlers (`src/bot-list.ts`).
3. If it's a known crawler, the Worker looks up your rule for that bot in D1
   (`bot_rules`; default is **allow** if you haven't set one) and either:
   - returns `403` before touching your origin (`block`), or
   - proxies the request through to your origin (`allow`).
4. Every classified bot request is logged to `requests_log` asynchronously
   (`ctx.waitUntil`, doesn't add latency to the response).
5. Non-bot traffic (real visitors, search engines, unlisted bots) passes straight
   through, untouched and unlogged.
6. A token-gated dashboard at `/botwatch-dashboard` shows traffic by crawler over the
   last 7/30 days and lets you flip allow/block per bot.

**v1 scope, on purpose:** UA-string matching (spoofable, same trust model as
robots.txt — not a blocker, see ADR Decision 1), allow/block only (no `throttle`
enforcement — that needs shared edge state and is deferred to v1.1, see ADR Decision
3), single-tenant (one Worker + one D1 database per customer zone, no multi-tenant
router). Don't build past this until a second real customer needs more.

## File layout

```
src/
  worker.ts          entry module — ONLY exports the default fetch handler (see note below)
  enforcement.ts      site-request handling: classify UA, look up rule, log, block/proxy
  dashboard.ts         /botwatch-dashboard routes: HTML shell + JSON API (stats, rules)
  dashboard-html.ts    the dashboard's single-page HTML/CSS/JS, as a template string
  bot-list.ts          known AI-crawler UA signatures + classifyBot()
  auth.ts               bearer-token check for the dashboard API
  env.ts                 shared Env (bindings) type
  constants.ts            shared route-prefix constant
migrations/
  0001_init.sql       D1 schema: requests_log, bot_rules
tests/                  vitest unit tests (UA matching, auth, rule enforcement)
wrangler.toml
```

**Why `worker.ts` only has a default export:** Cloudflare's module Worker runtime
(workerd) inspects every top-level export of the file named in `main` as a candidate
handler binding. A plain value or function export there (other than `default`) makes
the Worker fail to start with `Incorrect type for map entry '<name>': the provided
value is not of type 'function or ExportedHandler'`. This was hit and fixed during
this build (confirmed with `wrangler dev` locally) — everything testable lives in
ordinary importable modules (`enforcement.ts`, `dashboard.ts`, ...) that don't have
this restriction, and `worker.ts` just wires them together behind `export default`.

## Auth model

The dashboard has two parts with different auth:

- **`GET /botwatch-dashboard`** (the HTML shell) is public and returns zero customer
  data — just static markup + JS that knows how to call the JSON API. It can't be
  bearer-token-gated because a plain browser navigation can't set an `Authorization`
  header, and gating it would make the token-entry screen itself unreachable.
- **Every `/botwatch-dashboard/api/*` route** requires
  `Authorization: Bearer <DASHBOARD_TOKEN>` (or `?token=` as a fallback for
  curl/scripting — documented risk: query params can end up in logs/history, prefer
  the header). No unauthenticated read or write ever reaches `bot_rules` or
  `requests_log`.

The dashboard's own JS stores the token in `localStorage` after a successful check
and sends it as a header on every API call.

## Local dev

```bash
npm install
cp .dev.vars.example .dev.vars    # local-only secret, gitignored — real deploys use `wrangler secret put`
npm run db:migrate:local          # applies migrations/0001_init.sql to a local D1
npm run dev                       # wrangler dev
```

**Known local-dev limitation:** this Worker is a *reverse proxy* — for allowed
requests it calls `fetch(request)` to forward to your real origin. In production,
attached via a Worker Route to a real zone, that subrequest goes straight to the
zone's actual origin server (Cloudflare's documented behavior: subrequests from a
Worker bypass the Route that dispatched it, so there's no loop). Locally with
`wrangler dev`, there is no separate origin — `fetch(request)` targets the same
`localhost:8787` the Worker is running on, so it calls itself and workerd's
subrequest-depth guard trips with a `500`. This is expected and specific to testing
a proxy Worker against itself with no real origin behind it; it does not happen in
production. The `block` path (no origin fetch) and the entire dashboard were verified
working end-to-end against a local D1 via `wrangler dev`. The proxy/pass-through path
is covered by `tests/enforcement.test.ts` with a mocked `fetch`.

Run the test suite and typecheck:

```bash
npm test
npm run typecheck
```

## Deploy runbook

This session has no Cloudflare account credentials — `wrangler` here is
unauthenticated, so none of the following has actually been run against a real
account. Whoever deploys this needs to:

```bash
# 1. Authenticate wrangler with the target Cloudflare account
wrangler login

# 2. Create the D1 database, then paste the printed database_id into wrangler.toml
npm run db:create
#   -> copy the "database_id" it prints into wrangler.toml [[d1_databases]]

# 3. Run the schema migration against the REAL (remote) database
npm run db:migrate:remote

# 4. Set the dashboard bearer token as a secret (never commit it)
npm run secret:dashboard-token
#   -> paste a long random token when prompted

# 5. Edit wrangler.toml:
#    - set SITE_ID to something identifying this customer/zone
#    - set routes = [{ pattern = "customer-domain.com/*", zone_name = "customer-domain.com" }]

# 6. Deploy
npm run deploy

# 7. Open https://customer-domain.com/botwatch-dashboard, enter the token from step 4
```

### Rollback / off switch

If BotWatch misbehaves in production, the fastest safe rollback is removing the
Worker Route from the zone (Cloudflare dashboard or `wrangler.toml` + redeploy) —
traffic then goes straight to origin as if BotWatch didn't exist. The D1 data is
untouched and can be re-attached later.

## API reference (dashboard)

All routes below require `Authorization: Bearer <DASHBOARD_TOKEN>`.

- `GET /botwatch-dashboard/api/stats?days=7` — traffic totals, daily breakdown, and
  per-bot counts for the last `days` (1–30, default 7).
- `GET /botwatch-dashboard/api/rules` — current allow/block rule for every known bot
  (unset bots default to `allow`).
- `POST /botwatch-dashboard/api/rules` — body `{ "bot_name": "GPTBot", "action":
  "allow" | "block" }`. Returns `501` for `"throttle"` (schema supports it for
  v1.1; not enforced yet).

## What wasn't verified in this environment

- No real `wrangler deploy` — no Cloudflare account credentials available this
  cycle. `wrangler deploy --dry-run` succeeds (bundles cleanly, bindings resolve).
- No real origin to proxy to locally, so the allow-path proxy behavior was verified
  via unit tests (mocked `fetch`) rather than an end-to-end `curl` through
  `wrangler dev` — see "Known local-dev limitation" above.
- `wrangler d1 execute --local` against the migration and the dashboard's
  read/write API (rules GET/POST, stats, auth 401s, throttle 501) were exercised
  end-to-end against a local D1 via `wrangler dev` and worked as expected.
