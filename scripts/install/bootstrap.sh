#!/bin/bash
# Dependency bootstrap deliberately works before Python exists. Never source
# installer state or operator configuration. macOS ships Bash 3.2.
BOOTSTRAP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BOOTSTRAP_LANGUAGE=en

bootstrap_message() {
    local key="$1" id english chinese template token index
    shift
    local values=("$@")
    template="[$key]"
    while IFS=$'\t' read -r id english chinese; do
        if [ "$id" = "$key" ]; then
            template="$english"
            [ "$BOOTSTRAP_LANGUAGE" != zh-CN ] || template="$chinese"
            break
        fi
    done < "$BOOTSTRAP_DIR/bootstrap-messages.tsv"
    # Consume the template, so placeholder-looking user values stay literal.
    while [[ "$template" =~ \{([0-9]+)\} ]]; do
        token="${BASH_REMATCH[0]}"; index="${BASH_REMATCH[1]}"
        printf '%s' "${template%%"$token"*}" "${values[$index]:-$token}"
        template="${template#*"$token"}"
    done
    printf '%s\n' "$template"
}

bootstrap_system_language() {
    local os language=''
    os="$(uname -s)"
    if [ "$os" = Darwin ]; then
        language="$(defaults read -g AppleLanguages 2>/dev/null | sed -n 's/^[[:space:]]*"\{0,1\}\([a-zA-Z][a-zA-Z][-a-zA-Z_]*\).*$/\1/p' | head -n 1)"
    elif [ -n "${WSL_DISTRO_NAME:-}" ] && command -v powershell.exe >/dev/null 2>&1; then
        language="$(powershell.exe -NoProfile -NonInteractive -Command 'Add-Type -MemberDefinition '\''[DllImport("kernel32.dll")] public static extern ushort GetUserDefaultUILanguage();'\'' -Name BootstrapNative -Namespace AutoCompany; [Globalization.CultureInfo]::GetCultureInfo([AutoCompany.BootstrapNative]::GetUserDefaultUILanguage()).Name' 2>/dev/null | tr -d '\r')"
    fi
    [ -n "$language" ] || language="${LC_ALL:-${LANGUAGE:-${LC_MESSAGES:-${LANG:-en}}}}"
    case "$language" in zh|zh[-_.:@]*|ZH|ZH[-_.:@]*) printf 'zh-CN\n';; *) printf 'en\n';; esac
}

bootstrap_clean_value() {
    case "$1" in *$'\n'*|*$'\r'*|*$'\t'*) bootstrap_message path_invalid >&2; return 2;; esac
}

bootstrap_read_state() {
    local key value seen='|'
    [ ! -e "$BOOTSTRAP_STATE" ] || [ -f "$BOOTSTRAP_STATE" ] || return 1
    [ ! -L "$BOOTSTRAP_STATE" ] || return 1
    [ -f "$BOOTSTRAP_STATE" ] || return 0
    while IFS=$'\t' read -r key value; do
        bootstrap_clean_value "$value" || return 1
        case "$seen" in *"|$key|"*) return 1;; esac
        seen="$seen$key|"
        case "$key" in
            language) case "$value" in en|zh-CN) SAVED_LANGUAGE="$value";; *) return 1;; esac;;
            target) SAVED_TARGET="$value";;
            engine) case "$value" in claude|codex) SAVED_ENGINE="$value";; *) return 1;; esac;;
            media) case "$value" in yes|no) SAVED_MEDIA="$value";; *) return 1;; esac;;
            stage) :;;
            *) return 1;;
        esac
    done < "$BOOTSTRAP_STATE"
}

bootstrap_save_state() {
    local directory temporary
    directory="$(dirname "$BOOTSTRAP_STATE")"
    mkdir -p "$directory" || return
    [ ! -L "$BOOTSTRAP_STATE" ] || return 1
    temporary="$(mktemp "$directory/.setup-state.XXXXXX")" || return
    { printf 'language\t%s\ntarget\t%s\nengine\t%s\nmedia\t%s\nstage\t%s\n' \
        "$BOOTSTRAP_LANGUAGE" "$BOOTSTRAP_TARGET" "$BOOTSTRAP_ENGINE" "$BOOTSTRAP_MEDIA" "$1"; } > "$temporary"
    chmod 600 "$temporary" && mv -f "$temporary" "$BOOTSTRAP_STATE"
}

bootstrap_python_ok() {
    command -v python3 >/dev/null 2>&1 && python3 -c 'import sys; sys.exit(sys.version_info < (3, 10))' >/dev/null 2>&1
}

bootstrap_node_ok() {
    command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1 &&
        node -e 'process.exit(["linux","darwin"].includes(process.platform) && Number(process.versions.node.split(".")[0]) >= 22 ? 0 : 1)' >/dev/null 2>&1
}

bootstrap_engine_ok() {
    local executable
    executable="$(command -v "$BOOTSTRAP_ENGINE")" || return 1
    case "$executable" in *.exe|*.cmd|*.bat) return 1;; esac
    # WSL can inherit Windows npm shims in PATH. A successful --version from
    # such a shim is not evidence that the Linux engine has been installed.
    if [ -f "$executable" ]; then
        [ "$(head -c 2 "$executable")" != MZ ] || return 1
        if grep -Eq '^#!.*(ba)?sh([[:space:]]|$)' "$executable" && grep -Eq 'node\.exe|powershell\.exe|cmd\.exe' "$executable"; then return 1; fi
    fi
    "$BOOTSTRAP_ENGINE" --version >/dev/null 2>&1
}

bootstrap_ubuntu_supported() {
    # os-release is read as data, never evaluated as shell code.
    [ -r /etc/os-release ] && grep -Eq '^ID=("ubuntu"|ubuntu)$' /etc/os-release &&
        grep -Eq '^VERSION_ID=("24.04"|24.04)$' /etc/os-release
}

bootstrap_inspect() {
    local tool
    BOOTSTRAP_PACKAGES=''
    bootstrap_python_ok || BOOTSTRAP_PACKAGES='python3'
    for tool in git make; do
        if command -v "$tool" >/dev/null 2>&1; then
            bootstrap_message reuse "$tool"
        else
            BOOTSTRAP_PACKAGES="${BOOTSTRAP_PACKAGES:+$BOOTSTRAP_PACKAGES }$tool"
        fi
    done
    if bootstrap_python_ok; then bootstrap_message reuse 'Python 3.10+'; fi
    if [ -n "$BOOTSTRAP_PACKAGES" ]; then
        if [ "$BOOTSTRAP_OS" = Darwin ]; then
            if command -v brew >/dev/null 2>&1; then bootstrap_message brew_plan "$BOOTSTRAP_PACKAGES"
            else bootstrap_message brew_missing; fi
        elif bootstrap_ubuntu_supported && command -v apt-get >/dev/null 2>&1; then
            bootstrap_message apt_plan "$BOOTSTRAP_PACKAGES"
        else bootstrap_message manual_deps "$BOOTSTRAP_PACKAGES"; fi
    fi
    BOOTSTRAP_NEED_ENGINE=no
    if bootstrap_engine_ok; then
        bootstrap_message reuse "$BOOTSTRAP_ENGINE"
    else
        BOOTSTRAP_NEED_ENGINE=yes
        bootstrap_message engine_plan "$BOOTSTRAP_ENGINE"
    fi
    BOOTSTRAP_NEED_NODE=no
    if [ "$BOOTSTRAP_NEED_ENGINE" = yes ] || [ "$BOOTSTRAP_MEDIA" = yes ]; then
        if bootstrap_node_ok; then bootstrap_message reuse 'Node.js 22+'
        else
            BOOTSTRAP_NEED_NODE=yes; bootstrap_message node_plan
            command -v curl >/dev/null 2>&1 || bootstrap_message download_tool
        fi
    fi
    bootstrap_message tools_plan "$BOOTSTRAP_TOOLS"
    if [ "$BOOTSTRAP_MEDIA" = yes ]; then bootstrap_message media_plan
    else bootstrap_message media_skipped; fi
    bootstrap_message login_plan
    bootstrap_message service_plan
}

bootstrap_install_packages() {
    [ -n "$BOOTSTRAP_PACKAGES" ] || return 0
    # Only internally generated package names are intentionally word-split.
    if [ "$BOOTSTRAP_OS" = Darwin ]; then
        if ! command -v brew >/dev/null 2>&1; then bootstrap_message brew_missing >&2; return 3; fi
        brew install $BOOTSTRAP_PACKAGES || return
        if ! bootstrap_python_ok && command -v brew >/dev/null 2>&1; then
            PATH="$(brew --prefix python3)/libexec/bin:$PATH"; export PATH
        fi
    elif bootstrap_ubuntu_supported && command -v apt-get >/dev/null 2>&1; then
        sudo apt-get update && sudo apt-get install -y $BOOTSTRAP_PACKAGES ca-certificates || return
    else
        bootstrap_message manual_deps "$BOOTSTRAP_PACKAGES" >&2
        return 3
    fi
    bootstrap_python_ok || { bootstrap_message python_old >&2; return 3; }
}

bootstrap_install_node() {
    local platform architecture archive digest temporary actual destination
    [ "$BOOTSTRAP_NEED_NODE" = yes ] || return 0
    if ! command -v curl >/dev/null 2>&1; then
        BOOTSTRAP_PACKAGES=curl bootstrap_install_packages || return
    fi
    case "$BOOTSTRAP_OS" in Darwin) platform=darwin;; Linux) platform=linux;; *) return 3;; esac
    case "$(uname -m)" in x86_64) architecture=x64;; arm64|aarch64) architecture=arm64;; *) architecture=unsupported;; esac
    case "$platform-$architecture" in
        linux-x64) digest=c33c39ed9c80deddde77c960d00119918b9e352426fd604ba41638d6526a4744;;
        linux-arm64) digest=25ba95dfb96871fa2ef977f11f95ea90818c8fa15c0f2110771db08d4ba423be;;
        darwin-x64) digest=5ea50c9d6dea3dfa3abb66b2656f7a4e1c8cef23432b558d45fb538c7b5dedce;;
        darwin-arm64) digest=5ed4db0fcf1eaf84d91ad12462631d73bf4576c1377e192d222e48026a902640;;
        *) bootstrap_message unsupported_arch "$platform-$architecture" >&2; return 3;;
    esac
    archive="node-v22.22.0-$platform-$architecture.tar.gz"
    destination="$BOOTSTRAP_TOOLS/node-v22.22.0-$platform-$architecture"
    mkdir -p "$BOOTSTRAP_TOOLS" || return
    # Never overwrite unknown files in the shared, user-owned tools directory.
    [ ! -e "$destination" ] || { bootstrap_message env_conflict "$destination" >&2; return 3; }
    temporary="$(mktemp -d "$BOOTSTRAP_TOOLS/.node-download.XXXXXX")" || return
    if ! curl --fail --location --proto '=https' --tlsv1.2 "https://nodejs.org/dist/v22.22.0/$archive" -o "$temporary/$archive"; then return 3; fi
    actual="$(python3 -c 'import hashlib,sys; print(hashlib.sha256(open(sys.argv[1], "rb").read()).hexdigest())' "$temporary/$archive")" || return
    [ "$actual" = "$digest" ] || { bootstrap_message node_integrity >&2; return 3; }
    tar -xzf "$temporary/$archive" -C "$temporary" || return
    mv "$temporary/node-v22.22.0-$platform-$architecture" "$destination" || return
    # Delete only files just created by this invocation, never a caller path.
    rm -f "$temporary/$archive" && rmdir "$temporary" || return
    PATH="$destination/bin:$PATH"; export PATH
    bootstrap_node_ok || return
    BOOTSTRAP_NEED_NODE=no
}

bootstrap_install_engine() {
    local package
    [ "$BOOTSTRAP_NEED_ENGINE" = yes ] || return 0
    case "$BOOTSTRAP_ENGINE" in codex) package=@openai/codex;; claude) package=@anthropic-ai/claude-code;; *) return 2;; esac
    npm install --global --prefix "$BOOTSTRAP_TOOLS/npm" "$package" || return
    PATH="$BOOTSTRAP_TOOLS/npm/bin:$PATH"; export PATH
    "$BOOTSTRAP_ENGINE" --version >/dev/null 2>&1
}

bootstrap_environment() {
    # Refuse to silently replace user-owned settings on a resumed installation.
    python3 - "$BOOTSTRAP_TARGET" "$BOOTSTRAP_ENGINE" "$(command -v "$BOOTSTRAP_ENGINE")" "$PATH" "$BOOTSTRAP_DIR/../core" <<'PY'
import os
from pathlib import Path
import sys
import tempfile
root, engine, executable, path, modules = sys.argv[1:]
sys.path.insert(0, modules)
from installation_state import writer_lease
target = Path(root) / '.auto-loop.env'
values = {'ENGINE': engine, engine.upper() + '_BIN': executable, 'PATH': path}
def quote(value):
    return '"' + value.replace('\\', '\\\\').replace('"', '\\"') + '"'
expected = {key: key + '=' + quote(value) for key, value in values.items()}
with writer_lease(root, kind='installer-configuration'):
    if target.is_symlink():
        sys.exit(3)
    original = target.read_text(encoding='utf-8') if target.exists() else ''
    lines = original.splitlines()
    for key, wanted in expected.items():
        existing = [line for line in lines if line.startswith(key + '=')]
        if existing and (len(existing) != 1 or existing[0] != wanted):
            sys.exit(3)
        if not existing:
            lines.append(wanted)
    updated = '\n'.join(lines) + '\n'
    if updated != original:
        with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', newline='\n',
                                         prefix='.auto-loop.env.setup-', dir=root, delete=False) as stream:
            stream.write(updated)
            temporary = stream.name
        os.replace(temporary, target)
PY
}

bootstrap_media() {
    [ "$BOOTSTRAP_MEDIA" = yes ] || return 0
    (
        cd "$BOOTSTRAP_TARGET/scripts/media" || exit
        npm ci || exit
        if [ "$BOOTSTRAP_OS" = Linux ]; then
            if ! bootstrap_ubuntu_supported; then exit 3; fi
            ./node_modules/.bin/playwright install --with-deps chromium || exit
        else
            ./node_modules/.bin/playwright install chromium || exit
        fi
        node -e 'const {chromium}=require("playwright"); (async()=>{const b=await chromium.launch({headless:true});await b.close()})().catch(()=>process.exit(1));'
    )
}

bootstrap_login() {
    local command
    if [ "$BOOTSTRAP_ENGINE" = codex ]; then command="$(command -v codex) login"
    else command="$(command -v claude) auth login"; fi
    if [ "$BOOTSTRAP_LOGIN" = yes ]; then
        bootstrap_message login_now
        if [ "$BOOTSTRAP_ENGINE" = codex ]; then codex login || bootstrap_message login_failed
        else claude auth login || bootstrap_message login_failed; fi
    fi
    if { [ "$BOOTSTRAP_ENGINE" = codex ] && codex login status >/dev/null 2>&1; } ||
       { [ "$BOOTSTRAP_ENGINE" = claude ] && claude auth status >/dev/null 2>&1; }; then
        bootstrap_message login_ready
    else bootstrap_message login_needed "$command"; fi
}

bootstrap_main() {
    BOOTSTRAP_LANGUAGE="$(bootstrap_system_language)"
    BOOTSTRAP_STAGE="$(bootstrap_message stage_inspect)"
    BOOTSTRAP_OS="$(uname -s)"
    BOOTSTRAP_SOURCE="$(cd "$BOOTSTRAP_DIR/../.." && pwd)"
    BOOTSTRAP_STATE="${XDG_STATE_HOME:-$HOME/.local/state}/auto-company/setup-state.tsv"
    BOOTSTRAP_TARGET=''; BOOTSTRAP_ENGINE=''; BOOTSTRAP_MEDIA=''; BOOTSTRAP_LOGIN=no
    BOOTSTRAP_YES=no; BOOTSTRAP_PLAN=no; BOOTSTRAP_DASHBOARD=yes; BOOTSTRAP_DISTRO=''
    local override_language='' saved_key saved_value help=no
    SAVED_LANGUAGE=''; SAVED_TARGET=''; SAVED_ENGINE=''; SAVED_MEDIA=''
    # Select explicit language before any malformed-argument diagnostics.
    local previous='' argument
    for argument in "$@"; do
        if [ "$previous" = --language ]; then
            case "$argument" in en|zh-CN) BOOTSTRAP_LANGUAGE="$argument";; esac
        fi
        previous="$argument"
    done
    BOOTSTRAP_STAGE="$(bootstrap_message stage_inspect)"
    while [ "$#" -gt 0 ]; do
        case "$1" in
            --language|--target|--source|--engine|--distro)
                [ "$#" -ge 2 ] || { bootstrap_message invalid "$1" >&2; return 2; }
                bootstrap_clean_value "$2" || return
                case "$1" in
                    --language) override_language="$2";; --target) BOOTSTRAP_TARGET="$2";;
                    --source) BOOTSTRAP_SOURCE="$2";; --engine) BOOTSTRAP_ENGINE="$2";;
                    --distro) BOOTSTRAP_DISTRO="$2";;
                esac
                shift 2;;
            --media) BOOTSTRAP_MEDIA=yes; shift;; --skip-media) BOOTSTRAP_MEDIA=no; shift;; --login) BOOTSTRAP_LOGIN=yes; shift;;
            --yes) BOOTSTRAP_YES=yes; shift;; --plan) BOOTSTRAP_PLAN=yes; shift;;
            --no-dashboard|--wsl-runtime) BOOTSTRAP_DASHBOARD=no; shift;;
            --help|-h) help=yes; shift;;
            *) bootstrap_message invalid "$1" >&2; return 2;;
        esac
    done
    if [ "$help" = yes ]; then bootstrap_message help; return 0; fi
    if ! bootstrap_read_state; then bootstrap_message state_invalid "$BOOTSTRAP_STATE" >&2; return 2; fi
    BOOTSTRAP_TARGET="${BOOTSTRAP_TARGET:-${SAVED_TARGET:-$HOME/Auto-Company}}"
    BOOTSTRAP_ENGINE="${BOOTSTRAP_ENGINE:-${SAVED_ENGINE:-}}"
    BOOTSTRAP_MEDIA="${BOOTSTRAP_MEDIA:-${SAVED_MEDIA:-no}}"
    if [ -n "$override_language" ]; then BOOTSTRAP_LANGUAGE="$override_language"
    elif [ -n "$SAVED_LANGUAGE" ]; then BOOTSTRAP_LANGUAGE="$SAVED_LANGUAGE"
    elif [ -f "$BOOTSTRAP_TARGET/.auto-company.local" ] && [ ! -L "$BOOTSTRAP_TARGET/.auto-company.local" ]; then
        while IFS='=' read -r saved_key saved_value; do
            if [ "$saved_key" = AUTO_COMPANY_LANGUAGE ]; then
                case "$saved_value" in en|zh-CN) BOOTSTRAP_LANGUAGE="$saved_value";; esac
            fi
        done < "$BOOTSTRAP_TARGET/.auto-company.local"
    fi
    case "$BOOTSTRAP_LANGUAGE" in en|zh-CN) :;; *) BOOTSTRAP_LANGUAGE="$(bootstrap_system_language)"; bootstrap_message invalid "$override_language" >&2; return 2;; esac
    BOOTSTRAP_STAGE="$(bootstrap_message stage_inspect)"
    if [ -z "$BOOTSTRAP_ENGINE" ] && [ -t 0 ] && [ "$BOOTSTRAP_PLAN" != yes ] && [ "$BOOTSTRAP_YES" != yes ]; then
        bootstrap_message engine_choice
        read -r argument || return 2
        case "$argument" in 2) BOOTSTRAP_ENGINE=codex;; ''|1) BOOTSTRAP_ENGINE=claude;; *) bootstrap_message invalid "$argument" >&2; return 2;; esac
    fi
    BOOTSTRAP_ENGINE="${BOOTSTRAP_ENGINE:-claude}"
    case "$BOOTSTRAP_ENGINE" in claude|codex) :;; *) bootstrap_message invalid "$BOOTSTRAP_ENGINE" >&2; return 2;; esac
    bootstrap_clean_value "$BOOTSTRAP_TARGET" && bootstrap_clean_value "$BOOTSTRAP_SOURCE" || return
    case "$BOOTSTRAP_TARGET" in /*) :;; *) BOOTSTRAP_TARGET="$PWD/$BOOTSTRAP_TARGET";; esac
    [ -f "$BOOTSTRAP_SOURCE/release-files.json" ] || { bootstrap_message payload_missing >&2; return 2; }
    BOOTSTRAP_TOOLS="${XDG_DATA_HOME:-$HOME/.local/share}/auto-company/tools"
    # Reuse tools prepared by a previous, interrupted run without global PATH edits.
    for argument in "$BOOTSTRAP_TOOLS"/node-v22.22.0-*/bin; do
        [ ! -d "$argument" ] || PATH="$argument:$PATH"
    done
    PATH="$BOOTSTRAP_TOOLS/npm/bin:$PATH"; export PATH
    BOOTSTRAP_STAGE="$(bootstrap_message stage_inspect)"
    bootstrap_message title
    bootstrap_message plan "$BOOTSTRAP_OS" "$BOOTSTRAP_LANGUAGE" "$BOOTSTRAP_ENGINE"
    bootstrap_message target "$BOOTSTRAP_TARGET"
    bootstrap_message source "$BOOTSTRAP_SOURCE"
    bootstrap_inspect
    [ "$BOOTSTRAP_PLAN" != yes ] || return 0
    if [ "$BOOTSTRAP_YES" != yes ]; then
        bootstrap_message confirm
        read -r argument || argument=''
        case "$argument" in y|Y|yes|YES) :;; *) bootstrap_message cancelled; return 0;; esac
    fi
    bootstrap_save_state dependencies || return
    BOOTSTRAP_STAGE="$(bootstrap_message stage_dependencies)"
    [ "$(id -u)" != 0 ] || { bootstrap_message root_user >&2; return 3; }
    if [ "$BOOTSTRAP_OS" != Darwin ]; then
        command -v systemctl >/dev/null 2>&1 && systemctl --user show-environment >/dev/null 2>&1 || {
            bootstrap_message systemd_missing >&2; return 3;
        }
    fi
    bootstrap_message diagnostics
    bootstrap_install_packages || return
    if [ "$BOOTSTRAP_NEED_ENGINE" = yes ]; then bootstrap_install_node || return; fi
    bootstrap_install_engine || return
    BOOTSTRAP_STAGE="$(bootstrap_message stage_install)"
    local install_args=(install --source "$BOOTSTRAP_SOURCE" --target "$BOOTSTRAP_TARGET" --language "$BOOTSTRAP_LANGUAGE" --engine "$BOOTSTRAP_ENGINE" --yes)
    [ -z "$BOOTSTRAP_DISTRO" ] || install_args+=(--distro "$BOOTSTRAP_DISTRO")
    python3 "$BOOTSTRAP_SOURCE/scripts/install/manager.py" "${install_args[@]}" || return
    if [ "$BOOTSTRAP_MEDIA" = yes ]; then
        if bootstrap_install_node && bootstrap_media; then bootstrap_message media_ready
        else bootstrap_message media_failed; fi
    fi
    if ! bootstrap_environment; then bootstrap_message env_conflict "$BOOTSTRAP_TARGET/.auto-loop.env" >&2; return 3; fi
    BOOTSTRAP_STAGE="$(bootstrap_message stage_service)"
    local registration kind engine_path
    engine_path="$(command -v "$BOOTSTRAP_ENGINE")"
    if [ "$BOOTSTRAP_OS" = Darwin ]; then
        ENGINE="$BOOTSTRAP_ENGINE" CLAUDE_BIN="$engine_path" CODEX_BIN="$engine_path" \
            bash "$BOOTSTRAP_TARGET/scripts/macos/install-daemon.sh" --prepare || return
        registration="$HOME/Library/LaunchAgents/com.autocompany.loop.plist"; kind=launchd
    else
        bash "$BOOTSTRAP_TARGET/scripts/wsl/install-wsl-daemon.sh" --prepare || return
        registration="$HOME/.config/systemd/user/auto-company.service"; kind=systemd
    fi
    python3 "$BOOTSTRAP_TARGET/scripts/install/manager.py" register --root "$BOOTSTRAP_TARGET" --path "$registration" --kind "$kind" --language "$BOOTSTRAP_LANGUAGE" --yes || return
    bootstrap_login
    bootstrap_save_state complete || return
    bootstrap_message core_ready "$BOOTSTRAP_TARGET"
    if [ "$BOOTSTRAP_DASHBOARD" = yes ]; then
        BOOTSTRAP_STAGE="$(bootstrap_message stage_dashboard)"
        bootstrap_message dashboard http://127.0.0.1:8787/
        # The server opens the browser only after binding its own listener.
        python3 "$BOOTSTRAP_TARGET/dashboard/server.py" --host 127.0.0.1 --port 8787 --open-browser
    else
        bootstrap_message dashboard_later "$BOOTSTRAP_TARGET/dashboard/server.py"
    fi
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
    set -eo pipefail
    BOOTSTRAP_STAGE='setup'
    trap 'status=$?; bootstrap_message failed "$BOOTSTRAP_STAGE" >&2; exit "$status"' ERR
    bootstrap_main "$@"
fi
