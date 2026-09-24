#!/bin/bash
# Manage generated products without mixing their Git history into the framework.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
FRAMEWORK_DIR="${AUTO_COMPANY_ROOT:-$(cd "$SCRIPT_DIR/../.." && pwd)}"
PROJECTS_DIR="$FRAMEWORK_DIR/projects"
REGISTRY_FILE="$PROJECTS_DIR/registry.tsv"
CONTEXT_TOOL="$SCRIPT_DIR/project-context.py"

# Keep a managed project's registry writer visible for the complete command.
# exec preserves the PID and the lease's process identity through Bash startup.
if [ -f "$FRAMEWORK_DIR/.auto-company/install.json" ] && [ "${AUTO_COMPANY_PROJECT_WRITER:-}" != "$$" ]; then
    exec python3 "$SCRIPT_DIR/installation_state.py" project --root "$FRAMEWORK_DIR" -- "$@"
fi

die() {
    echo "Error: $*" >&2
    exit 1
}

validate_name() {
    local name="$1"
    case "$name" in
        ""|.*|-*|*-|*/*|*\\*|*[!a-z0-9-]*)
            die "project name must use lowercase letters, digits, and hyphens"
            ;;
    esac
}

read_active_project() {
    python3 "$CONTEXT_TOOL" name --root "$FRAMEWORK_DIR"
}

resolve_name() {
    local name="${1:-}"
    if [ -z "$name" ]; then
        name="$(read_active_project)" || return 1
    fi
    name="${name#projects/}"
    validate_name "$name"
    printf '%s\n' "$name"
}

require_human_operation() {
    [ "${AUTO_COMPANY_CYCLE:-0}" != "1" ] || die "this operation is human-only and unavailable inside a cycle"
    local pid_file="$FRAMEWORK_DIR/.auto-loop.pid" loop_pid=""
    if [ -f "$pid_file" ]; then
        IFS= read -r loop_pid < "$pid_file" || true
        if [[ "$loop_pid" =~ ^[0-9]+$ ]] && kill -0 "$loop_pid" 2>/dev/null; then
            die "stop the running loop before changing selection, publishing, or migrating"
        fi
    fi
}

ensure_registry() {
    [ ! -L "$PROJECTS_DIR" ] && [ ! -L "$REGISTRY_FILE" ] || die "project directory and registry must not be symlinks"
    mkdir -p "$PROJECTS_DIR"
    if [ ! -f "$REGISTRY_FILE" ]; then
        printf 'name\tpath\tlifecycle\tcreated_at_utc\n' > "$REGISTRY_FILE"
    fi
}

registry_has_project() {
    local name="$1"
    awk -F '\t' -v wanted="$name" 'NR > 1 && $1 == wanted { found=1 } END { exit !found }' "$REGISTRY_FILE"
}

set_registry_lifecycle() {
    local name="$1"
    local lifecycle="$2"
    local tmp
    ensure_registry
    tmp="$(mktemp "$PROJECTS_DIR/.registry.XXXXXX")"
    awk -F '\t' -v OFS='\t' -v wanted="$name" -v state="$lifecycle" '
        NR == 1 { print; next }
        $1 == wanted { $3=state; found=1 }
        { print }
        END { if (!found) exit 3 }
    ' "$REGISTRY_FILE" > "$tmp" || {
        rm -f "$tmp"
        die "project '$name' is missing from registry"
    }
    mv "$tmp" "$REGISTRY_FILE"
}

project_migrate_legacy() {
    local name="" confirmation=""
    while [ "$#" -gt 0 ]; do
        case "$1" in
            --name)
                [ "$#" -ge 2 ] || die "--name requires a value"
                name="$2"
                shift 2
                ;;
            --confirm)
                [ "$#" -ge 2 ] || die "--confirm requires a value"
                confirmation="$2"
                shift 2
                ;;
            *)
                die "unknown project-migrate-legacy argument: $1"
                ;;
        esac
    done

    [ "$confirmation" = "MIGRATE" ] || die "legacy migration is gated; pass CONFIRM=MIGRATE explicitly"
    require_human_operation
    [ -n "$name" ] || die "legacy migration requires an explicit NAME"
    name="$(resolve_name "$name")"
    local target relative="projects/$name"
    target="$(python3 "$CONTEXT_TOOL" path --root "$FRAMEWORK_DIR" --project "$name")"
    local migration_dir="$FRAMEWORK_DIR/.auto-company-migrations/$name"
    [ -d "$target" ] || die "legacy project directory not found: $target"
    [ ! -e "$target/.git" ] || die "project is already an independent Git repository"
    [ ! -e "$migration_dir" ] || die "migration evidence already exists: $migration_dir"
    ensure_registry
    registry_has_project "$name" || die "legacy project is missing from registry: $name"
    git -C "$FRAMEWORK_DIR" rev-parse --verify HEAD >/dev/null 2>&1 || die "framework must have a commit before migration"
    [ -z "$(git -C "$FRAMEWORK_DIR" status --porcelain --untracked-files=no)" ] || die "framework tracked worktree must be clean before migration"
    git -C "$FRAMEWORK_DIR" ls-files --error-unmatch -- "$relative" >/dev/null 2>&1 || die "project is not tracked by the framework; use project-new instead"

    local git_user git_email source_commit project_commit tracked rel
    git_user="$(git -C "$FRAMEWORK_DIR" config user.name || true)"
    git_email="$(git -C "$FRAMEWORK_DIR" config user.email || true)"
    [ -n "$git_user" ] && [ -n "$git_email" ] || die "configure framework git user.name and user.email before migration"
    source_commit="$(git -C "$FRAMEWORK_DIR" rev-parse HEAD)"

    mkdir -p "$migration_dir"
    cp "$REGISTRY_FILE" "$migration_dir/registry.before.tsv"
    printf '%s\n' "$source_commit" > "$migration_dir/source-framework-commit"

    if ! git -C "$target" init --initial-branch=main >/dev/null 2>&1; then
        git -C "$target" init >/dev/null
        git -C "$target" symbolic-ref HEAD refs/heads/main
    fi
    git -C "$target" config user.name "$git_user"
    git -C "$target" config user.email "$git_email"
    while IFS= read -r -d '' tracked; do
        rel="${tracked#${relative}/}"
        git -C "$target" add -f -- "$rel"
    done < <(git -C "$FRAMEWORK_DIR" ls-files -z -- "$relative")
    git -C "$target" commit -m "Import from Auto Company framework $source_commit" >/dev/null
    project_commit="$(git -C "$target" rev-parse HEAD)"
    git -C "$target" bundle create "$migration_dir/project.bundle" HEAD
    printf '%s\n' "$project_commit" > "$migration_dir/project-commit"

    git -C "$FRAMEWORK_DIR" rm -r --cached -- "$relative" >/dev/null
    set_registry_lifecycle "$name" "migration-staged"
    git -C "$FRAMEWORK_DIR" add -- "$REGISTRY_FILE"

    echo "Legacy project migrated locally without deleting its working files: $target"
    echo "Independent project commit: $project_commit"
    echo "Recoverable bundle: $migration_dir/project.bundle"
    echo "Framework untracking is staged for human review; no framework commit was created."
    echo "Rollback before committing with: make project-migrate-rollback NAME=$name CONFIRM=ROLLBACK"
}

project_migrate_rollback() {
    local name="" confirmation=""
    while [ "$#" -gt 0 ]; do
        case "$1" in
            --name)
                [ "$#" -ge 2 ] || die "--name requires a value"
                name="$2"
                shift 2
                ;;
            --confirm)
                [ "$#" -ge 2 ] || die "--confirm requires a value"
                confirmation="$2"
                shift 2
                ;;
            *)
                die "unknown project-migrate-rollback argument: $1"
                ;;
        esac
    done

    [ "$confirmation" = "ROLLBACK" ] || die "migration rollback is gated; pass CONFIRM=ROLLBACK explicitly"
    require_human_operation
    [ -n "$name" ] || die "migration rollback requires an explicit NAME"
    name="$(resolve_name "$name")"
    local target relative="projects/$name"
    target="$(python3 "$CONTEXT_TOOL" path --root "$FRAMEWORK_DIR" --project "$name")"
    local migration_dir="$FRAMEWORK_DIR/.auto-company-migrations/$name"
    [ -d "$target/.git" ] || die "independent project Git directory not found"
    [ -f "$migration_dir/registry.before.tsv" ] || die "registry rollback evidence not found"
    [ -f "$migration_dir/project.bundle" ] || die "project recovery bundle not found"
    [ ! -e "$migration_dir/project.git" ] || die "rollback Git backup already exists"
    [ "$(git -C "$FRAMEWORK_DIR" rev-parse HEAD)" = "$(cat "$migration_dir/source-framework-commit")" ] || die "framework HEAD changed; use git revert with the recovery bundle instead"

    # A rollback may only undo its own registry edit, never later user registrations.
    local expected_registry current_index
    expected_registry="$(awk -F '\t' -v OFS='\t' -v wanted="$name" '
        NR > 1 && $1 == wanted { $3="migration-staged" }
        { print }
    ' "$migration_dir/registry.before.tsv")"
    current_index="$(git -C "$FRAMEWORK_DIR" show :projects/registry.tsv)"
    [ "$(cat "$REGISTRY_FILE")" = "$expected_registry" ] && [ "$current_index" = "$expected_registry" ] || die "registry changed after migration; review rollback manually to preserve later registrations"

    git -C "$FRAMEWORK_DIR" restore --staged --source=HEAD -- "$relative" "$REGISTRY_FILE"
    cp "$migration_dir/registry.before.tsv" "$REGISTRY_FILE"
    mv "$target/.git" "$migration_dir/project.git"

    echo "Legacy migration staging rolled back; framework tracking is restored."
    echo "Independent Git metadata remains recoverable at: $migration_dir/project.git"
    echo "Bundle remains recoverable at: $migration_dir/project.bundle"
}

cleanup_project_new() {
    local status=$?
    # Keep cleanup state outside function locals: Bash errexit may unwind them
    # before invoking EXIT. Never restore a whole-registry snapshot.
    if [ "$NEW_CREATED" -eq 1 ]; then
        if python3 "$SCRIPT_DIR/project-lock.py" rollback-row "$FRAMEWORK_DIR" "$NEW_REGISTRY_ROW"; then
            rm -rf -- "$NEW_TARGET"
        else
            echo "Project creation failed; retained source and registry for recovery: $NEW_TARGET" >&2
        fi
    fi
    rm -f "$NEW_REGISTRY_TMP"
    return "$status"
}

project_new() {
    local name="" display_name="" description=""
    while [ "$#" -gt 0 ]; do
        case "$1" in
            --name)
                [ "$#" -ge 2 ] || die "--name requires a value"
                name="$2"
                shift 2
                ;;
            --display-name|--description)
                [ "$#" -ge 2 ] || die "$1 requires a value"
                if [ "$1" = "--display-name" ]; then display_name="$2"; else description="$2"; fi
                shift 2
                ;;
            *)
                die "unknown project-new argument: $1"
                ;;
        esac
    done

    validate_name "$name"
    ensure_registry
    local target
    target="$(python3 "$CONTEXT_TOOL" path --root "$FRAMEWORK_DIR" --project "$name")"
    [ ! -e "$target" ] || die "project already exists: $target"
    if registry_has_project "$name"; then
        die "project is already registered: $name"
    fi

    local created_at
    created_at="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
    NEW_TARGET="$target"
    NEW_CREATED=0
    NEW_REGISTRY_ROW="$(printf '%s\tprojects/%s\tlocal\t%s' "$name" "$name" "$created_at")"
    NEW_REGISTRY_TMP="$(mktemp "$PROJECTS_DIR/.registry.XXXXXX")"
    trap cleanup_project_new EXIT
    trap 'exit 143' TERM
    trap 'exit 130' INT

    cp "$REGISTRY_FILE" "$NEW_REGISTRY_TMP"
    printf '%s\n' "$NEW_REGISTRY_ROW" >> "$NEW_REGISTRY_TMP"

    mkdir "$target"
    NEW_CREATED=1
    if ! git -C "$target" init --initial-branch=main >/dev/null 2>&1; then
        git -C "$target" init >/dev/null
        git -C "$target" symbolic-ref HEAD refs/heads/main
    fi
    printf '# %s\n\nIndependent product repository managed by Auto Company.\n' "$name" > "$target/README.md"
    printf '# Local secrets and generated output\n.env\n.env.*\ndist/\nbuild/\n.auto-company/\n' > "$target/.gitignore"
    # Description is optional observation data and cannot change selection or
    # make a successfully created product fail because reporting is unavailable.
    python3 "$SCRIPT_DIR/project_metadata.py" --root "$FRAMEWORK_DIR" --project "projects/$name" \
        --display-name "${display_name:-$name}" --description "$description" || \
        echo "Project metadata unavailable; product creation continues." >&2

    mv "$NEW_REGISTRY_TMP" "$REGISTRY_FILE"
    # A normal creation event registers stable identity and, during exploration,
    # its explicit continuation. It never edits human-owned ACTIVE_PROJECT.
    if ! python3 "$SCRIPT_DIR/product_identity.py" --root "$FRAMEWORK_DIR" --project "projects/$name" register \
        --cycle "${AUTO_COMPANY_CYCLE_ID:-}" >/dev/null; then
        return 1
    fi
    NEW_CREATED=0
    trap - EXIT TERM INT

    echo "Created independent local Git repository: $target"
    echo "Human selection is unchanged. Select with: make project-select PROJECT=$name CONFIRM=SELECT"
    echo "No remote was created and nothing was pushed."
}

project_select() {
    local requested="" confirmation=""
    while [ "$#" -gt 0 ]; do
        case "$1" in
            --project|--confirm)
                [ "$#" -ge 2 ] || die "$1 requires a value"
                if [ "$1" = "--project" ]; then requested="$2"; else confirmation="$2"; fi
                shift 2
                ;;
            *) die "unknown project-select argument: $1" ;;
        esac
    done
    [ "$confirmation" = "SELECT" ] || die "selection is human-owned; pass CONFIRM=SELECT explicitly"
    require_human_operation
    [ -n "$requested" ] || die "selection requires an explicit PROJECT"
    python3 "$CONTEXT_TOOL" select --root "$FRAMEWORK_DIR" --project "$requested"
    echo "Selected ACTIVE_PROJECT=projects/$(resolve_name "$requested")"
}

project_status() {
    local requested=""
    while [ "$#" -gt 0 ]; do
        case "$1" in
            --project)
                [ "$#" -ge 2 ] || die "--project requires a value"
                requested="$2"
                shift 2
                ;;
            *)
                die "unknown project-status argument: $1"
                ;;
        esac
    done

    local name target branch worktree remote publish_ready framework_tracking selected
    name="$(resolve_name "$requested")"
    target="$(python3 "$CONTEXT_TOOL" validate --root "$FRAMEWORK_DIR" --project "$name")"
    selected="$(python3 "$CONTEXT_TOOL" name --root "$FRAMEWORK_DIR" --optional)"

    branch="$(git -C "$target" symbolic-ref --short HEAD 2>/dev/null || echo detached)"
    if [ -n "$(git -C "$target" status --porcelain)" ]; then
        worktree="dirty"
    else
        worktree="clean"
    fi
    remote="$(git -C "$target" remote get-url origin 2>/dev/null || echo none)"
    publish_ready="no"
    if git -C "$target" rev-parse --verify HEAD >/dev/null 2>&1 && [ "$worktree" = "clean" ]; then
        publish_ready="yes"
    fi
    framework_tracking="visible"
    if git -C "$FRAMEWORK_DIR" check-ignore -q -- "projects/$name" 2>/dev/null; then
        framework_tracking="ignored"
    fi

    echo "PROJECT=projects/$name"
    echo "ACTIVE_PROJECT=${selected:+projects/$selected}"
    echo "PROJECT_PATH=$target"
    echo "REPOSITORY=independent-local-git"
    echo "BRANCH=$branch"
    echo "WORKTREE=$worktree"
    echo "ORIGIN=$remote"
    echo "PUBLISH_READY=$publish_ready"
    echo "FRAMEWORK_PROJECT_FILES=$framework_tracking"
}

project_publish() {
    local requested="" remote_url="" confirmation=""
    while [ "$#" -gt 0 ]; do
        case "$1" in
            --project)
                [ "$#" -ge 2 ] || die "--project requires a value"
                requested="$2"
                shift 2
                ;;
            --remote-url)
                [ "$#" -ge 2 ] || die "--remote-url requires a value"
                remote_url="$2"
                shift 2
                ;;
            --confirm)
                [ "$#" -ge 2 ] || die "--confirm requires a value"
                confirmation="$2"
                shift 2
                ;;
            *)
                die "unknown project-publish argument: $1"
                ;;
        esac
    done

    [ "$confirmation" = "PUBLISH" ] || die "publishing is gated; pass CONFIRM=PUBLISH explicitly"
    require_human_operation

    local name target existing_remote remote_added=0
    name="$(resolve_name "$requested")"
    target="$(python3 "$CONTEXT_TOOL" validate --root "$FRAMEWORK_DIR" --project "$name")"
    ensure_registry
    registry_has_project "$name" || die "project is missing from registry: $name"
    git -C "$target" rev-parse --verify HEAD >/dev/null 2>&1 || die "project needs at least one local commit before publishing"
    [ -z "$(git -C "$target" status --porcelain)" ] || die "project worktree must be clean before publishing"

    existing_remote="$(git -C "$target" remote get-url origin 2>/dev/null || true)"
    if [ -n "$existing_remote" ]; then
        if [ -n "$remote_url" ] && [ "$existing_remote" != "$remote_url" ]; then
            die "origin already exists with a different URL"
        fi
    else
        [ -n "$remote_url" ] || die "no origin exists; pass REMOTE_URL=<url>"
        git -C "$target" remote add origin "$remote_url"
        remote_added=1
    fi

    if ! git -C "$target" push --set-upstream origin HEAD; then
        if [ "$remote_added" -eq 1 ]; then
            git -C "$target" remote remove origin
        fi
        die "push failed; newly added origin was rolled back"
    fi

    set_registry_lifecycle "$name" "published"
    echo "Published projects/$name through the explicit project-publish gate."
}

command="${1:-}"
[ -n "$command" ] || die "usage: project.sh <new|select|status|publish|migrate-legacy|migrate-rollback> [options]"
# Hold one checkout-wide lock over source creation, registry writes and identity
# registration, including publish/migration lifecycle changes and their checks.
# Identity/config helpers have their own locks, always acquired after this one.
case "$command" in
    new|select|status|publish|migrate-legacy|migrate-rollback)
        if [ "${AUTO_COMPANY_PROJECT_LOCK_PID:-}" != "$$" ]; then
            exec python3 "$SCRIPT_DIR/project-lock.py" run "$FRAMEWORK_DIR" "$0" "$@"
        fi
        ;;
esac
shift

case "$command" in
    new) project_new "$@" ;;
    select) project_select "$@" ;;
    status) project_status "$@" ;;
    publish) project_publish "$@" ;;
    migrate-legacy) project_migrate_legacy "$@" ;;
    migrate-rollback) project_migrate_rollback "$@" ;;
    *) die "unknown command: $command" ;;
esac
