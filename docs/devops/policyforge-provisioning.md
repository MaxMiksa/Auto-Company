# PolicyForge — Provisioning Runbook

**Scope:** One-time setup of the managed services and deployment pipeline for the PolicyForge monolith.  
**Do not commit secrets.** Every sensitive value is shown as a `${VAR}` placeholder.  
**Automation:** The same steps are encoded in `scripts/policyforge-provision.sh`.

---

## 1. Environment & Secrets Map

| Variable | Scope | How to obtain | Notes |
|----------|-------|---------------|-------|
| `VERCEL_TOKEN` | Vercel CLI, GitHub Actions | Vercel Dashboard → Tokens → Create | Needs `project` scope |
| `VERCEL_ORG_ID` | Vercel CLI, GitHub Actions | `vercel teams list --json` or dashboard URL | Personal account uses your user id |
| `VERCEL_PROJECT_ID` | Vercel CLI, GitHub Actions | Created by `vercel project add` or dashboard | Used by `vercel deploy` in CI |
| `VERCEL_PROJECT_NAME` | Provisioning script | Default `policyforge` | Overridable env var |
| `DATABASE_URL` | Vercel / Drizzle | Vercel Postgres dashboard after creation | Pooled connection string |
| `POSTGRES_URL_NON_POOLING` | Drizzle migrations | Vercel Postgres dashboard | Direct non-pooled connection |
| `NEXTAUTH_SECRET` | NextAuth.js | `openssl rand -base64 32` | Production only |
| `NEXTAUTH_URL` | NextAuth.js | `https://${DOMAIN}` | e.g. `https://policyforge.auto-company.dev` |
| `CLOUDFLARE_ACCOUNT_ID` | wrangler, S3 SDK | Cloudflare dashboard → Workers & Pages | Not a secret, but keep in secrets/vars |
| `CLOUDFLARE_API_TOKEN` | wrangler, S3 SDK | Cloudflare Dashboard → My Profile → API Tokens | R2 + D1 + KV + Cloudflare Zones edit |
| `R2_BUCKET_NAME` | App, wrangler | Default `policyforge-packs` | Set in `wrangler.toml` + env |
| `R2_ENDPOINT` | App S3 SDK | `https://${CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com` | Or custom public domain |
| `R2_ACCESS_KEY_ID` | App S3 SDK | Cloudflare dashboard → R2 → Manage API Tokens | Limited to this bucket |
| `R2_SECRET_ACCESS_KEY` | App S3 SDK | Generated with the access key | Store as GitHub secret |
| `R2_PUBLIC_DOMAIN` | App (optional) | R2 custom domain | e.g. `packs.policyforge.auto-company.dev` |
| `D1_DATABASE_NAME` | wrangler | Default `policyforge-db` | Optional; enable with `--d1` |
| `D1_DATABASE_ID` | wrangler | Output of `wrangler d1 create` or `wrangler d1 list` | Set in `wrangler.toml` |
| `KV_NAMESPACE_NAME` | wrangler | Default `policyforge-kv` | Optional; enable with `--kv` |
| `KV_NAMESPACE_ID` | wrangler | Output of `wrangler kv namespace create` or `list` | Set in `wrangler.toml` |
| `RESEND_API_KEY` | App / Auth.js | Resend dashboard → API Keys | `re_...` |
| `RESEND_FROM_EMAIL` | App | Verified sender, e.g. `no-reply@policyforge.auto-company.dev` | Must match verified domain |
| `RESEND_FROM_DOMAIN` | Resend | Domain added in Resend | Used for DNS verification records |
| `STRIPE_SECRET_KEY` | App (server) | Stripe Dashboard → Developers → API keys | `sk_live_...` / `sk_test_...` |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | App (browser) | Stripe Dashboard → API keys | `pk_...` |
| `STRIPE_WEBHOOK_SECRET` | App webhooks | Stripe webhook endpoint detail | `whsec_...` |
| `STRIPE_PRICE_STARTER` | App | Stripe product/price catalog | Price ID for `$199` one-time (or `$249` for the A/B test variant) |
| `STRIPE_PRICE_GROWTH` | App | Stripe product/price catalog | Price ID for `$499/year` |
| `STRIPE_PRICE_SCALE` | App | Stripe product/price catalog | Price ID for `$999/year` |
| `ANTHROPIC_API_KEY` | App | Anthropic Console | `sk-ant-...` |
| `INNGEST_SIGNING_KEY` | Inngest server | Inngest dashboard | For sync endpoint |
| `INNGEST_EVENT_KEY` | App / Inngest | Inngest dashboard | For sending events |
| `SENTRY_DSN` | App (optional) | Sentry project settings | Optional monitoring |
| `DOMAIN` | App, DNS, script | e.g. `policyforge.auto-company.dev` | Used for webhooks, email, NextAuth URL |
| `GITHUB_REPO` | `gh` CLI | e.g. `auto-company/policyforge` or `Auto-Company/Auto-Company` | Repo where secrets are stored |
| `GH_TOKEN` | `gh` CLI | GitHub Settings → Developer settings → Personal access tokens | `repo` + `workflow` scopes |

---

## 2. Quick Start (script-first)

```bash
# 1. Set required non-secrets
export CLOUDFLARE_ACCOUNT_ID="${CLOUDFLARE_ACCOUNT_ID}"
export CLOUDFLARE_API_TOKEN="${CLOUDFLARE_API_TOKEN}"
export VERCEL_TOKEN="${VERCEL_TOKEN}"
export GH_TOKEN="${GH_TOKEN}"
export DOMAIN="policyforge.auto-company.dev"
export GITHUB_REPO="auto-company/policyforge"

# 2. Dry-run to see what it would do
./scripts/policyforge-provision.sh --dry-run

# 3. Run with explicit confirmation (interactive)
./scripts/policyforge-provision.sh

# 4. Run non-interactively in CI/automation (only when all tokens are present)
./scripts/policyforge-provision.sh --yes
```

The script installs `wrangler` (npm or curl) and checks `gh`, then creates/configures the CLI-managed resources. Resources that require a web UI or paid signup (Vercel Postgres, Stripe, Resend, DNS) are verified and reported; the script does **not** perform interactive OAuth or paid provisioning without confirmation.

---

## 3. Step-by-Step Manual Provisioning

### 3.1 Install / verify CLIs

```bash
npm install -g vercel wrangler
# gh is preferred for GitHub secrets. Install from https://cli.github.com if missing.
```

### 3.2 Authenticate

```bash
wrangler whoami                                  # uses CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID
vercel whoami --token "${VERCEL_TOKEN}"          # Vercel dashboard token
gh auth status                                   # uses GH_TOKEN
```

If any step asks for a browser login, stop and run the CLI login manually first. Do not let the script drive interactive OAuth.

### 3.3 Cloudflare R2 bucket

```bash
wrangler r2 bucket create policyforge-packs
# or, idempotent:
wrangler r2 bucket info policyforge-packs >/dev/null 2>&1 || wrangler r2 bucket create policyforge-packs
```

Create an S3-compatible token scoped to this bucket:

1. Cloudflare dashboard → R2 → Manage API Tokens → Create.
2. Permissions: `Object Read & Write` on `policyforge-packs`.
3. Copy `Access Key ID` → `R2_ACCESS_KEY_ID` and `Secret Access Key` → `R2_SECRET_ACCESS_KEY`.

Optional CORS for public signed downloads:

```bash
# projects/policyforge/infra/r2-cors.json
# [
#   {
#     "AllowedOrigins": ["https://policyforge.auto-company.dev"],
#     "AllowedMethods": ["GET", "HEAD"],
#     "AllowedHeaders": ["*"],
#     "MaxAgeSeconds": 3600
#   }
# ]
wrangler r2 bucket cors set policyforge-packs --file=projects/policyforge/infra/r2-cors.json
```

### 3.4 Optional Cloudflare D1 database

```bash
wrangler d1 create policyforge-db
# Capture the database id from the output and place it in wrangler.toml and GitHub secrets.
wrangler d1 list --json | jq -r '.[] | select(.name=="policyforge-db") | .uuid'
```

### 3.5 Optional Cloudflare KV namespace

```bash
wrangler kv namespace create policyforge-kv
# Capture the namespace id.
wrangler kv namespace list --json | jq -r '.[] | select(.title=="policyforge-kv") | .id'
```

### 3.6 Vercel project

Inside `projects/policyforge`:

```bash
vercel project add policyforge --token "${VERCEL_TOKEN}"
# Capture:
#   VERCEL_PROJECT_ID=$(vercel project inspect policyforge --token "${VERCEL_TOKEN}" --json | jq -r '.id')
#   VERCEL_ORG_ID=$(vercel teams list --token "${VERCEL_TOKEN}" --json | jq -r '.[0].id')
```

Set the framework preset to Next.js in the Vercel dashboard (or during `vercel link`). The repo already contains `vercel.json` (build/headers config) and the root `.github/workflows/policyforge-ci-cd.yml` (CI/CD pipeline).

### 3.7 Vercel Postgres

1. Vercel Dashboard → Storage → Create Database → Postgres.
2. Select the `policyforge` project and connect it.
3. Copy the connection strings into Vercel environment variables:
   - `DATABASE_URL` (pooled)
   - `POSTGRES_URL_NON_POOLING` (direct)

Set these in Vercel, **not** in committed files:

```bash
printf '%s\n' "${DATABASE_URL}" | vercel env add DATABASE_URL production --token "${VERCEL_TOKEN}" --yes
printf '%s\n' "${POSTGRES_URL_NON_POOLING}" | vercel env add POSTGRES_URL_NON_POOLING production --token "${VERCEL_TOKEN}" --yes
```

### 3.8 Resend domain + API key

1. Resend Dashboard → Domains → Add domain → `policyforge.auto-company.dev`.
2. Add the displayed DNS records (DKIM, SPF, DMARC) to your DNS host.
3. Create an API key and copy it to `RESEND_API_KEY`.
4. Set `RESEND_FROM_EMAIL` (e.g. `no-reply@policyforge.auto-company.dev`).

### 3.9 Stripe account + products

1. Create/activate a Stripe account.
2. Dashboard → Developers → API keys → copy `STRIPE_SECRET_KEY` and `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`.
3. Create products/prices:
   - **Starter** — one-time, `$199` (and `$249` for the A/B test variant)
   - **Growth** — recurring yearly, `$499`
   - **Scale** — recurring yearly, `$999`
4. Copy each `price_id` to `STRIPE_PRICE_STARTER`, `STRIPE_PRICE_GROWTH`, `STRIPE_PRICE_SCALE`.
5. Add a webhook endpoint:
   - URL: `https://policyforge.auto-company.dev/api/v1/webhooks/stripe`
   - Events: `checkout.session.completed`, `invoice.paid`
6. Copy `STRIPE_WEBHOOK_SECRET`.

### 3.10 DNS

If Cloudflare is your DNS host:

```bash
# Apex / www to Vercel
wrangler record create --type CNAME --name policyforge.auto-company.dev --content cname.vercel-dns.com
wrangler record create --type CNAME --name www --content cname.vercel-dns.com

# Resend verification records (values from Resend dashboard; examples only)
# wrangler record create --type TXT --name resend._domainkey.policyforge.auto-company.dev --content "p=..."
# wrangler record create --type TXT --name _dmarc.policyforge.auto-company.dev --content "v=DMARC1; p=quarantine;"
```

If your registrar/DNS is elsewhere, add the same records through their UI.  
Vercel will prompt you to verify the domain and may supply A/AAAA/CNAME values; prefer the values Vercel gives you.

### 3.11 GitHub Actions secrets

With `gh`:

```bash
gh secret set VERCEL_TOKEN --repo "${GITHUB_REPO}" --body "${VERCEL_TOKEN}"
gh secret set VERCEL_ORG_ID --repo "${GITHUB_REPO}" --body "${VERCEL_ORG_ID}"
gh secret set VERCEL_PROJECT_ID --repo "${GITHUB_REPO}" --body "${VERCEL_PROJECT_ID}"
gh secret set DATABASE_URL --repo "${GITHUB_REPO}" --body "${DATABASE_URL}"
gh secret set POSTGRES_URL_NON_POOLING --repo "${GITHUB_REPO}" --body "${POSTGRES_URL_NON_POOLING}"
gh secret set CLOUDFLARE_ACCOUNT_ID --repo "${GITHUB_REPO}" --body "${CLOUDFLARE_ACCOUNT_ID}"
gh secret set CLOUDFLARE_API_TOKEN --repo "${GITHUB_REPO}" --body "${CLOUDFLARE_API_TOKEN}"
gh secret set R2_ACCESS_KEY_ID --repo "${GITHUB_REPO}" --body "${R2_ACCESS_KEY_ID}"
gh secret set R2_SECRET_ACCESS_KEY --repo "${GITHUB_REPO}" --body "${R2_SECRET_ACCESS_KEY}"
gh secret set RESEND_API_KEY --repo "${GITHUB_REPO}" --body "${RESEND_API_KEY}"
gh secret set STRIPE_SECRET_KEY --repo "${GITHUB_REPO}" --body "${STRIPE_SECRET_KEY}"
gh secret set STRIPE_WEBHOOK_SECRET --repo "${GITHUB_REPO}" --body "${STRIPE_WEBHOOK_SECRET}"
gh secret set NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY --repo "${GITHUB_REPO}" --body "${NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY}"
gh secret set STRIPE_PRICE_STARTER --repo "${GITHUB_REPO}" --body "${STRIPE_PRICE_STARTER}"
gh secret set STRIPE_PRICE_GROWTH --repo "${GITHUB_REPO}" --body "${STRIPE_PRICE_GROWTH}"
gh secret set STRIPE_PRICE_SCALE --repo "${GITHUB_REPO}" --body "${STRIPE_PRICE_SCALE}"
gh secret set ANTHROPIC_API_KEY --repo "${GITHUB_REPO}" --body "${ANTHROPIC_API_KEY}"
gh secret set INNGEST_SIGNING_KEY --repo "${GITHUB_REPO}" --body "${INNGEST_SIGNING_KEY}"
gh secret set INNGEST_EVENT_KEY --repo "${GITHUB_REPO}" --body "${INNGEST_EVENT_KEY}"
gh secret set NEXTAUTH_SECRET --repo "${GITHUB_REPO}" --body "${NEXTAUTH_SECRET}"
```

Or set them in the repository Settings → Secrets and variables → Actions.

---

## 4. Local `.env` Template

Save as `projects/policyforge/.env.local` (never commit):

```bash
# App
NEXTAUTH_URL=https://policyforge.auto-company.dev
NEXTAUTH_SECRET=${NEXTAUTH_SECRET}

# Database
DATABASE_URL=${DATABASE_URL}
POSTGRES_URL_NON_POOLING=${POSTGRES_URL_NON_POOLING}

# Object storage
R2_BUCKET_NAME=policyforge-packs
R2_ENDPOINT=https://${CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com
R2_ACCESS_KEY_ID=${R2_ACCESS_KEY_ID}
R2_SECRET_ACCESS_KEY=${R2_SECRET_ACCESS_KEY}
R2_PUBLIC_DOMAIN=${R2_PUBLIC_DOMAIN}

# Email
RESEND_API_KEY=${RESEND_API_KEY}
RESEND_FROM_EMAIL=no-reply@policyforge.auto-company.dev

# Payments
STRIPE_SECRET_KEY=${STRIPE_SECRET_KEY}
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=${NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY}
STRIPE_WEBHOOK_SECRET=${STRIPE_WEBHOOK_SECRET}
STRIPE_PRICE_STARTER=${STRIPE_PRICE_STARTER}
STRIPE_PRICE_GROWTH=${STRIPE_PRICE_GROWTH}
STRIPE_PRICE_SCALE=${STRIPE_PRICE_SCALE}

# LLM / queue
ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
INNGEST_SIGNING_KEY=${INNGEST_SIGNING_KEY}
INNGEST_EVENT_KEY=${INNGEST_EVENT_KEY}

# Monitoring (optional)
SENTRY_DSN=${SENTRY_DSN}
```

---

## 5. Post-Provisioning Validation

```bash
# 1. CLIs and auth
wrangler whoami
vercel whoami --token "${VERCEL_TOKEN}"
gh auth status

# 2. Resources exist
wrangler r2 bucket list
wrangler d1 list --json | jq '.[] | .name'
wrangler kv namespace list --json | jq '.[] | .title'
vercel project list --token "${VERCEL_TOKEN}"

# 3. App pipeline
vercel build --token "${VERCEL_TOKEN}" --yes
vercel deploy --prebuilt --token "${VERCEL_TOKEN}" --yes --prod

# 4. Health checks
curl -I "https://${DOMAIN}/api/health"        # to be implemented by fullstack-dhh
curl -I "https://${DOMAIN}"
```

---

## 6. Rollback / Decommission

Per the safety guardrails, **do not delete** repositories, Cloudflare projects, or R2 buckets. To pause/roll back:

- Revoke API tokens and keys.
- Pause the Vercel project or point DNS away.
- Delete GitHub Actions secrets via `gh secret remove` or the UI.
- Keep data in R2 / Postgres until a retention decision is made.

---

## 7. Automation

Run `scripts/policyforge-provision.sh --help` for flags (`--dry-run`, `--yes`, `--d1`, `--kv`, `--skip-gh`). The script never writes secrets to disk; it reads them from the environment and sets them via `gh secret set` and `vercel env add`.
