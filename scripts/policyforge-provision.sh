#!/usr/bin/env bash
#
# PolicyForge — idempotent provisioning script.
#
# Reads all secrets from the environment; never commits them.
# Creates only CLI-managed resources (R2/D1/KV, Vercel project, GitHub Actions secrets).
# Stops before interactive OAuth or paid resource creation unless confirmed.
#
# Usage:
#   ./scripts/policyforge-provision.sh --dry-run
#   ./scripts/policyforge-provision.sh --yes         # only in CI/automation
#   ./scripts/policyforge-provision.sh --d1 --kv     # also create optional D1 + KV

set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd "$SCRIPT_DIR/.." && pwd)
PROJECT_DIR="$REPO_ROOT/projects/policyforge"

# Defaults
DRY_RUN=0
YES=0
SKIP_GH=0
WITH_D1=0
WITH_KV=0

BUCKET_NAME="${R2_BUCKET_NAME:-policyforge-packs}"
D1_NAME="${D1_DATABASE_NAME:-policyforge-db}"
KV_NAME="${KV_NAMESPACE_NAME:-policyforge-kv}"
PROJECT_NAME="${VERCEL_PROJECT_NAME:-policyforge}"
DOMAIN="${DOMAIN:-policyforge.auto-company.dev}"
REPO="${GITHUB_REPO:-auto-company/policyforge}"

# Command arrays (may be changed by installers)
WRANGLER_CMD=(wrangler)
VERCEL_CMD=(vercel)
GH_CMD=(gh)

usage() {
  cat <<EOF
Usage: $0 [options]

Options:
  -d, --dry-run    Print commands without executing them
  -y, --yes        Skip interactive confirmation (requires all tokens in env)
  --skip-gh        Skip GitHub CLI operations
  --d1             Create optional Cloudflare D1 database
  --kv             Create optional Cloudflare KV namespace
  -h, --help       Show this help

Required environment variables:
  CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN, VERCEL_TOKEN
  GH_TOKEN (unless --skip-gh)
EOF
}

log() { printf '[policyforge-provision] %s\n' "$*"; }
warn() { log "WARN: $*" >&2; }
fail() { log "ERROR: $*" >&2; exit 1; }

require_env() {
  local var=$1
  if [[ -z "${!var:-}" ]]; then
    fail "Missing required environment variable: $var"
  fi
}

confirm() {
  if [[ $YES -eq 1 ]]; then
    return 0
  fi
  if [[ ! -t 0 ]]; then
    warn "Non-interactive terminal. Pass --yes to confirm resource creation."
    return 1
  fi
  local ans
  read -rp "$* [y/N] " ans
  [[ "$ans" == [Yy]* ]]
}

run() {
  if [[ $DRY_RUN -eq 1 ]]; then
    printf 'DRY-RUN:'
    for a in "$@"; do printf ' %q' "$a"; done
    printf '\n'
  else
    "$@"
  fi
}

# Install or locate wrangler per task instructions.
ensure_wrangler() {
  if command -v wrangler >/dev/null 2>&1; then
    WRANGLER_CMD=(wrangler)
    log "wrangler found: $(wrangler --version 2>/dev/null || echo 'unknown')"
    return 0
  fi

  log "wrangler not found. Installing..."
  if command -v npm >/dev/null 2>&1; then
    run npm install -g wrangler
    if command -v wrangler >/dev/null 2>&1; then
      WRANGLER_CMD=(wrangler)
    else
      # Try npm global bin fallback
      local npm_bin
      npm_bin=$(npm bin -g 2>/dev/null || true)
      if [[ -n "$npm_bin" && -x "$npm_bin/wrangler" ]]; then
        WRANGLER_CMD=("$npm_bin/wrangler")
      else
        fail "wrangler installation via npm succeeded but binary not on PATH"
      fi
    fi
  elif command -v curl >/dev/null 2>&1; then
    log "Installing wrangler via official curl installer..."
    run curl -fsSL https://install.wrangler.workers.dev | bash
    if [[ -x "$HOME/.wrangler/bin/wrangler" ]]; then
      WRANGLER_CMD=("$HOME/.wrangler/bin/wrangler")
    else
      fail "wrangler curl install did not place binary at ~/.wrangler/bin/wrangler"
    fi
  else
    fail "Install wrangler manually: https://developers.cloudflare.com/workers/wrangler/install-and-update/"
  fi
}

# Install or locate gh if available.
ensure_gh() {
  if command -v gh >/dev/null 2>&1; then
    GH_CMD=(gh)
    log "gh found: $(gh --version | head -n1)"
    return 0
  fi

  if [[ $SKIP_GH -eq 1 ]]; then
    GH_CMD=()
    log "gh skipped by --skip-gh"
    return 0
  fi

  log "gh not found. Attempting install..."
  if command -v apt-get >/dev/null 2>&1 && command -v sudo >/dev/null 2>&1; then
    run sudo apt-get update
    run sudo apt-get install -y gh || warn "gh install via apt failed"
  elif command -v brew >/dev/null 2>&1; then
    run brew install gh || warn "gh install via brew failed"
  elif command -v dnf >/dev/null 2>&1; then
    run sudo dnf install -y gh || warn "gh install via dnf failed"
  else
    warn "No supported package manager for gh. Install from https://cli.github.com or use --skip-gh"
  fi

  if command -v gh >/dev/null 2>&1; then
    GH_CMD=(gh)
  else
    GH_CMD=()
    warn "gh not available; GitHub secret steps will be skipped"
  fi
}

# Locate Vercel CLI (not required by task wording, but needed for Vercel resources).
ensure_vercel() {
  if command -v vercel >/dev/null 2>&1; then
    VERCEL_CMD=(vercel)
    log "vercel found: $(vercel --version 2>/dev/null || echo 'unknown')"
    return 0
  fi

  if command -v npm >/dev/null 2>&1; then
    log "vercel not found. Installing..."
    run npm install -g vercel
    if command -v vercel >/dev/null 2>&1; then
      VERCEL_CMD=(vercel)
    else
      local npm_bin
      npm_bin=$(npm bin -g 2>/dev/null || true)
      if [[ -n "$npm_bin" && -x "$npm_bin/vercel" ]]; then
        VERCEL_CMD=("$npm_bin/vercel")
      else
        warn "vercel CLI installed but not on PATH; Vercel steps will be manual"
        VERCEL_CMD=()
      fi
    fi
  else
    warn "npm not available; Vercel steps must be done manually"
    VERCEL_CMD=()
  fi
}

# Check that tokens actually authenticate.
check_auth() {
  log "Checking Cloudflare auth..."
  if ! run "${WRANGLER_CMD[@]}" whoami >/dev/null 2>&1; then
    fail "wrangler not authenticated. Set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID."
  fi

  if [[ ${#VERCEL_CMD[@]} -gt 0 ]]; then
    log "Checking Vercel auth..."
    if ! run "${VERCEL_CMD[@]}" whoami --token "$VERCEL_TOKEN" >/dev/null 2>&1; then
      fail "Vercel token invalid. Set VERCEL_TOKEN."
    fi
  fi

  if [[ ${#GH_CMD[@]} -gt 0 ]]; then
    log "Checking GitHub auth..."
    if ! GH_TOKEN="${GH_TOKEN:-}" run "${GH_CMD[@]}" auth status >/dev/null 2>&1; then
      fail "gh not authenticated. Set GH_TOKEN or use --skip-gh."
    fi
  fi
}

# JSON helpers using jq if available, else python3.
json_get() {
  local filter=$1
  if command -v jq >/dev/null 2>&1; then
    jq -r "$filter"
  elif command -v python3 >/dev/null 2>&1; then
    # Naive fallback for simple top-level keys (.uuid, .id, etc.)
    local key=${filter#.}
    if [[ "$key" =~ ^[A-Za-z0-9_]+$ ]]; then
      python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('${key}', '') if isinstance(d,dict) else '')" 2>/dev/null || true
    else
      true
    fi
  else
    true
  fi
}

json_list_get() {
  local name_key=$1 target=$2 id_key=$3
  if command -v jq >/dev/null 2>&1; then
    jq -r --arg n "$target" ".[] | select(.${name_key} == \$n) | .${id_key}"
  elif command -v python3 >/dev/null 2>&1; then
    python3 -c "
import sys, json
name_key, target, id_key = sys.argv[1:4]
data = json.load(sys.stdin)
for item in data:
    if item.get(name_key) == target:
        print(item.get(id_key, ''))
" "$name_key" "$target" "$id_key" 2>/dev/null || true
  else
    true
  fi
}

provision_r2() {
  log "Provisioning Cloudflare R2 bucket: $BUCKET_NAME"

  local exists=0
  if run "${WRANGLER_CMD[@]}" r2 bucket info "$BUCKET_NAME" >/dev/null 2>&1; then
    exists=1
  elif run "${WRANGLER_CMD[@]}" r2 bucket list --json 2>/dev/null | json_list_get name "$BUCKET_NAME" bucket | grep -q .; then
    exists=1
  fi

  if [[ $exists -eq 1 ]]; then
    log "R2 bucket '$BUCKET_NAME' already exists."
  else
    confirm "Create R2 bucket '$BUCKET_NAME'?" || return 0
    run "${WRANGLER_CMD[@]}" r2 bucket create "$BUCKET_NAME"
  fi
}

provision_d1() {
  log "Provisioning optional Cloudflare D1 database: $D1_NAME"

  local id
  id=$(run "${WRANGLER_CMD[@]}" d1 list --json 2>/dev/null | json_list_get name "$D1_NAME" uuid || true)

  if [[ -n "$id" ]]; then
    log "D1 database '$D1_NAME' already exists: $id"
    D1_DATABASE_ID="$id"
  else
    confirm "Create D1 database '$D1_NAME'?" || return 0
    local out
    out=$(run "${WRANGLER_CMD[@]}" d1 create "$D1_NAME" --json 2>/dev/null || true)
    D1_DATABASE_ID=$(printf '%s' "$out" | json_get '.uuid' || true)
    if [[ -z "$D1_DATABASE_ID" ]]; then
      warn "D1 create did not return a uuid; create it manually in the dashboard."
    else
      log "D1 database '$D1_NAME' created: $D1_DATABASE_ID"
    fi
  fi
}

provision_kv() {
  log "Provisioning optional Cloudflare KV namespace: $KV_NAME"

  local id
  id=$(run "${WRANGLER_CMD[@]}" kv namespace list --json 2>/dev/null | json_list_get title "$KV_NAME" id || true)

  if [[ -n "$id" ]]; then
    log "KV namespace '$KV_NAME' already exists: $id"
    KV_NAMESPACE_ID="$id"
  else
    confirm "Create KV namespace '$KV_NAME'?" || return 0
    local out
    out=$(run "${WRANGLER_CMD[@]}" kv namespace create "$KV_NAME" --json 2>/dev/null || true)
    KV_NAMESPACE_ID=$(printf '%s' "$out" | json_get '.id' || true)
    if [[ -z "$KV_NAMESPACE_ID" ]]; then
      warn "KV create did not return an id; create it manually in the dashboard."
    else
      log "KV namespace '$KV_NAME' created: $KV_NAMESPACE_ID"
    fi
  fi
}

provision_vercel_project() {
  if [[ ${#VERCEL_CMD[@]} -eq 0 ]]; then
    warn "Vercel CLI not available; project setup must be manual."
    return 0
  fi

  log "Provisioning Vercel project: $PROJECT_NAME"

  local exists=0
  local inspect
  inspect=$(run "${VERCEL_CMD[@]}" project inspect "$PROJECT_NAME" --token "$VERCEL_TOKEN" --json 2>/dev/null || true)
  if [[ -n "$inspect" ]] && printf '%s' "$inspect" | json_get '.id' | grep -q .; then
    exists=1
  fi

  if [[ $exists -eq 1 ]]; then
    log "Vercel project '$PROJECT_NAME' already exists."
  else
    confirm "Create Vercel project '$PROJECT_NAME'?" || return 0
    run "${VERCEL_CMD[@]}" project add "$PROJECT_NAME" --token "$VERCEL_TOKEN"
    inspect=$(run "${VERCEL_CMD[@]}" project inspect "$PROJECT_NAME" --token "$VERCEL_TOKEN" --json 2>/dev/null || true)
  fi

  VERCEL_PROJECT_ID=$(printf '%s' "$inspect" | json_get '.id' || true)
  VERCEL_ORG_ID=$(printf '%s' "$inspect" | json_get '.orgId // .teamId // .accountId' || true)

  if [[ -z "$VERCEL_PROJECT_ID" ]]; then
    warn "Could not determine Vercel project id; set VERCEL_PROJECT_ID manually."
  else
    log "Vercel project id: $VERCEL_PROJECT_ID"
  fi
  if [[ -z "$VERCEL_ORG_ID" ]]; then
    warn "Could not determine Vercel org id; set VERCEL_ORG_ID manually."
  else
    log "Vercel org id: $VERCEL_ORG_ID"
  fi
}

set_vercel_env() {
  [[ ${#VERCEL_CMD[@]} -eq 0 ]] && return 0
  local key=$1
  local val=${!key:-}
  [[ -z "$val" ]] && return 0

  if [[ $DRY_RUN -eq 1 ]]; then
    log "DRY-RUN: Set Vercel env $key for production"
  else
    printf '%s\n' "$val" | "${VERCEL_CMD[@]}" env add "$key" production \
      --yes --cwd "$PROJECT_DIR" --token "$VERCEL_TOKEN" >/dev/null 2>&1 || warn "Failed to set Vercel env $key"
  fi
}

set_gh_secret() {
  [[ ${#GH_CMD[@]} -eq 0 ]] && return 0
  local key=$1
  local val=${!key:-}
  [[ -z "$val" ]] && return 0

  if [[ $DRY_RUN -eq 1 ]]; then
    log "DRY-RUN: Set GitHub secret $key for $REPO"
  else
    printf '%s\n' "$val" | "${GH_CMD[@]}" secret set "$key" --repo "$REPO" >/dev/null 2>&1 || warn "Failed to set GitHub secret $key"
  fi
}

provision_env_and_secrets() {
  if [[ ${#VERCEL_CMD[@]} -gt 1 ]] || { [[ ${#VERCEL_CMD[@]} -eq 1 ]] && command -v "${VERCEL_CMD[0]}" >/dev/null 2>&1; }; then
    confirm "Set Vercel environment variables from current shell?" || true
    # Only set the values that are actually present in the environment.
    for v in DATABASE_URL POSTGRES_URL_NON_POOLING NEXTAUTH_SECRET NEXTAUTH_URL RESEND_API_KEY RESEND_FROM_EMAIL STRIPE_SECRET_KEY STRIPE_WEBHOOK_SECRET NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY STRIPE_PRICE_STARTER STRIPE_PRICE_GROWTH STRIPE_PRICE_SCALE ANTHROPIC_API_KEY INNGEST_SIGNING_KEY INNGEST_EVENT_KEY SENTRY_DSN; do
      set_vercel_env "$v"
    done
  fi

  if [[ ${#GH_CMD[@]} -gt 0 ]]; then
    confirm "Set GitHub Actions secrets for $REPO from current shell?" || return 0
    for s in VERCEL_TOKEN VERCEL_ORG_ID VERCEL_PROJECT_ID DATABASE_URL POSTGRES_URL_NON_POOLING NEXTAUTH_SECRET NEXTAUTH_URL CLOUDFLARE_ACCOUNT_ID CLOUDFLARE_API_TOKEN R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY RESEND_API_KEY RESEND_FROM_EMAIL STRIPE_SECRET_KEY NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY STRIPE_WEBHOOK_SECRET STRIPE_PRICE_STARTER STRIPE_PRICE_GROWTH STRIPE_PRICE_SCALE ANTHROPIC_API_KEY INNGEST_SIGNING_KEY INNGEST_EVENT_KEY SENTRY_DSN; do
      set_gh_secret "$s"
    done
  fi
}

final_summary() {
  cat <<EOF

=== PolicyForge provisioning summary ===
Project directory : $PROJECT_DIR
Domain            : $DOMAIN
R2 bucket         : $BUCKET_NAME
$(if [[ -n "${D1_DATABASE_ID:-}" ]]; then echo "D1 database       : $D1_DATABASE_ID"; fi)
$(if [[ -n "${KV_NAMESPACE_ID:-}" ]]; then echo "KV namespace      : $KV_NAMESPACE_ID"; fi)
$(if [[ -n "${VERCEL_PROJECT_ID:-}" ]]; then echo "Vercel project id : $VERCEL_PROJECT_ID"; fi)
$(if [[ -n "${VERCEL_ORG_ID:-}" ]]; then echo "Vercel org id     : $VERCEL_ORG_ID"; fi)

Still manual (cannot be fully automated by this script):
1. Create Vercel Postgres and copy DATABASE_URL / POSTGRES_URL_NON_POOLING.
2. Create S3-compatible R2 API token (R2_ACCESS_KEY_ID + R2_SECRET_ACCESS_KEY).
3. Add domain in Resend, verify DNS, create RESEND_API_KEY.
4. Create Stripe account, products/prices, webhook endpoint, and webhook secret.
5. Configure DNS (Vercel + Resend records); point DOMAIN to Vercel.
6. Update projects/policyforge/wrangler.toml with D1/KV ids if you created them.
7. Verify GitHub Actions secrets are populated (see docs/devops/policyforge-provisioning.md).

Next validation:
  vercel build --token \$VERCEL_TOKEN --yes
  vercel deploy --prebuilt --token \$VERCEL_TOKEN --yes --prod

EOF
}

main() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      -d|--dry-run) DRY_RUN=1; shift ;;
      -y|--yes) YES=1; shift ;;
      --skip-gh) SKIP_GH=1; shift ;;
      --d1) WITH_D1=1; shift ;;
      --kv) WITH_KV=1; shift ;;
      -h|--help) usage; exit 0 ;;
      *) fail "Unknown option: $1" ;;
    esac
  done

  ensure_wrangler
  ensure_gh
  ensure_vercel

  require_env CLOUDFLARE_ACCOUNT_ID
  require_env CLOUDFLARE_API_TOKEN
  require_env VERCEL_TOKEN

  if [[ ${#GH_CMD[@]} -gt 0 ]]; then
    require_env GH_TOKEN
  fi

  if [[ $DRY_RUN -ne 1 && $YES -ne 1 ]]; then
    cat <<EOF

This script can create Cloudflare and Vercel resources that may incur charges.
It will never commit secrets, but it will read them from the current shell.

Required tokens:
  CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN, VERCEL_TOKEN
  GH_TOKEN (unless --skip-gh)

EOF
    confirm "Continue with provisioning?" || exit 0
  fi

  check_auth
  provision_r2
  [[ $WITH_D1 -eq 1 ]] && provision_d1
  [[ $WITH_KV -eq 1 ]] && provision_kv
  provision_vercel_project
  provision_env_and_secrets
  final_summary
}

main "$@"
