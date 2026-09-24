"""Resolve language resources without overwriting human-owned instructions."""

import argparse
from contextlib import contextmanager
import ctypes
import hashlib
import json
import locale
import os
from pathlib import Path
import platform
import re
import shutil
import signal
import subprocess
import sys
import tempfile
import time
import uuid


ROOT = Path(__file__).resolve().parents[2]
LANGUAGES = ("zh-CN", "en")
KEY = "AUTO_COMPANY_LANGUAGE"
PRODUCT_PREFIX = "AUTO_COMPANY_PRODUCT_"
PRODUCT_KEYS = tuple(PRODUCT_PREFIX + name for name in ("ID", "LANGUAGE", "STATUS"))
WINDOWS_UI_COMMAND = (
    "Add-Type -MemberDefinition '[DllImport(\"kernel32.dll\")] public static extern ushort GetUserDefaultUILanguage();' "
    "-Name Native -Namespace AutoCompany; "
    "[Globalization.CultureInfo]::GetCultureInfo([AutoCompany.Native]::GetUserDefaultUILanguage()).Name"
)


class LanguageLockedError(ValueError):
    """The current product retains its language through pauses and restarts."""


def _supported_locale(value):
    """Chinese UI locales use Simplified Chinese; all other locales use English."""
    return "zh-CN" if re.match(r"^zh(?:[-_.:@]|$)", value.strip(), re.I) else "en"


def _locale_command(arguments):
    try:
        result = subprocess.run(arguments, capture_output=True, text=True,
                                encoding="utf-8", errors="replace", timeout=4)
        return result.stdout.strip().lstrip("\ufeff") if result.returncode == 0 else ""
    except (OSError, subprocess.SubprocessError):
        return ""


def system_language(environ=None):
    """Use the host's UI language, including the Windows host when inside WSL."""
    environ = os.environ if environ is None else environ
    system = platform.system()
    wsl = system == "Linux" and (bool(environ.get("WSL_INTEROP") or environ.get("WSL_DISTRO_NAME"))
                                 or "microsoft" in platform.release().lower())
    if system == "Windows":
        try:
            language_id = ctypes.windll.kernel32.GetUserDefaultUILanguage()
            return _supported_locale(locale.windows_locale.get(language_id, "en"))
        except (AttributeError, OSError):
            return "en"
    if wsl:
        executable = shutil.which("powershell.exe")
        if executable is None and wsl:
            candidate = Path("/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe")
            if candidate.is_file():
                executable = str(candidate)
        if executable:
            host_locale = _locale_command([
                executable, "-NoProfile", "-NonInteractive", "-Command", WINDOWS_UI_COMMAND,
            ])
            if host_locale:
                return _supported_locale(host_locale)
    if system == "Darwin":
        languages = _locale_command(["defaults", "read", "-g", "AppleLanguages"])
        match = re.search(r"[A-Za-z]{2,3}(?:[-_][A-Za-z0-9]+)*", languages)
        return _supported_locale(match[0]) if match else "en"
    for key in ("LC_ALL", "LANGUAGE", "LC_MESSAGES", "LANG"):
        if environ.get(key):
            return _supported_locale(environ[key].split(":", 1)[0])
    return "en"


@contextmanager
def configuration_lock(root, timeout=5):
    """mkdir is shared by Windows and WSL; never guess that another host is dead."""
    path = root / ".auto-company.local.lock"
    deadline = time.monotonic() + timeout
    while True:
        try:
            path.mkdir()
            break
        except FileExistsError:
            if time.monotonic() >= deadline:
                raise ValueError("local configuration is busy; after stopping every loop, team, Dashboard and configuration writer, run localization.py recover-lock --confirm RECOVER")
            time.sleep(0.025)
    try:
        marker = root / ".auto-company/maintenance.json"
        if marker.exists() or marker.is_symlink():
            from installation_state import check_maintenance
            check_maintenance(root)
        yield
    finally:
        path.rmdir()


def diagnostic_language(root, environ=None):
    """Diagnostics remain readable when the configuration itself is broken."""
    environ = os.environ if environ is None else environ
    try:
        return resolve_language(root, environ)
    except (OSError, UnicodeError, ValueError):
        return "en"


def message(root, key, *values, language=None, fallback=None):
    language = language or diagnostic_language(root)
    try:
        catalog = json.loads((ROOT / "i18n/messages.json").read_text(encoding="utf-8"))
        entry = catalog[key]
        if not isinstance(entry, dict):
            raise ValueError("message catalog entries must be language maps")
        english = entry.get("en")
        if not isinstance(english, str) or not english.strip():
            raise ValueError("message catalog requires an English fallback")
        template = entry.get(language)
        if (not isinstance(template, str) or not template.strip()
                or sorted(re.findall(r"\{[0-9]+\}", template)) != sorted(re.findall(r"\{[0-9]+\}", english))):
            template = english
        # Substitute only numbered tokens, once. User values are never code or
        # format strings, even if they contain braces or shell metacharacters.
        return re.sub(r"\{([0-9]+)\}", lambda match: str(values[int(match[1])]), template)
    except (OSError, UnicodeError, ValueError, KeyError, IndexError, TypeError):
        return fallback if fallback is not None else f"[{key}] " + " | ".join(str(value) for value in values)


def read_settings(root):
    path = root / ".auto-company.local"
    if path.is_symlink():
        raise ValueError("local configuration must not be a symlink")
    data = path.read_bytes() if path.exists() else b""
    settings = {}
    for line in data.decode("utf-8").splitlines():
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        match = re.fullmatch(r"([A-Z][A-Z0-9_]*)=(.*)", line)
        if not match:
            raise ValueError("local configuration must contain plain KEY=value lines")
        if match[1] in settings:
            raise ValueError(f"duplicate {match[1]} entries")
        settings[match[1]] = match[2]
    return data, settings


def read_local(root):
    data, settings = read_settings(root)
    return data, settings.get(KEY)


def _product_state(settings):
    present = [key for key in settings if key.startswith(PRODUCT_PREFIX)]
    if not present:
        return None
    if set(present) != set(PRODUCT_KEYS):
        raise ValueError("product language state is incomplete or invalid")
    identity, language, status = (settings[key] for key in PRODUCT_KEYS)
    if (not re.fullmatch(r"[0-9a-f]{32}", identity) or language not in LANGUAGES
            or status != "active"):
        raise ValueError("product language state is invalid")
    if settings.get(KEY) not in LANGUAGES:
        raise ValueError("product language state requires a valid saved language")
    return {"id": identity, "language": language, "status": status}


def language_state(root, environ=None):
    # Atomic replacement makes reads consistent without taking a writer lease.
    # A crashed preference transaction is replayed by startup or the next write.
    _read_language_update(root)
    return _language_state(root, environ)


def _language_state(root, environ=None):
    environ = os.environ if environ is None else environ
    _, settings = read_settings(root)
    product = _product_state(settings)
    if KEY in settings:
        language, source = settings[KEY], "saved"
    elif KEY in environ:
        language, source = environ[KEY], "environment"
    else:
        language, source = system_language(environ), "system"
    if language not in LANGUAGES:
        raise ValueError(f"{KEY} must be zh-CN or en")
    locked = product is not None and product["status"] == "active"
    current = product["language"] if locked else language
    return {"language": current, "source": "cycle" if locked else source,
            "locked": locked, "nextLanguage": language, "nextSource": source,
            "pending": current != language, "productId": product["id"] if product else None}


def resolve_language(root, environ=None):
    return language_state(root, environ)["language"]


def set_language(root, language):
    if language not in LANGUAGES:
        raise ValueError("language must be zh-CN or en")
    with configuration_lock(root):
        recover_language_update(root)
        _, settings = read_settings(root)
        _product_state(settings)
        # Validate both destinations before publishing a replayable intent. The
        # baseline receives only the authorized preference, never engine edits.
        _language_update_targets(root, language)
        atomic_write(root / ".auto-company.local.language-update",
                     json.dumps({"version": 1, "language": language}).encode())
        recover_language_update(root)


def updated_settings(data, updates):
    lines = data.splitlines(keepends=True)
    for key, value in updates.items():
        replacement = f"{key}={value}".encode()
        for index, line in enumerate(lines):
            if line.startswith(f"{key}=".encode()):
                ending = b"\r\n" if line.endswith(b"\r\n") else b"\n" if line.endswith(b"\n") else b""
                lines[index] = replacement + ending
                break
        else:
            if lines and not lines[-1].endswith((b"\r", b"\n")):
                lines.append(b"\n")
            lines.append(replacement + b"\n")
    return b"".join(lines)


def atomic_write(path, data):
    descriptor, temporary = tempfile.mkstemp(prefix=".auto-company.local.", dir=path.parent)
    try:
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def write_settings(root, data, updates):
    atomic_write(root / ".auto-company.local", updated_settings(data, updates))


def _language_update_targets(root, language):
    data, _ = read_settings(root)
    current = updated_settings(data, {KEY: language})
    baseline_path = root / ".auto-company.local.cycle-backup"
    baseline = None
    if baseline_path.is_symlink():
        raise ValueError("configuration baseline must not be a symlink")
    if baseline_path.exists():
        baseline = json.loads(baseline_path.read_text(encoding="utf-8"))
        if (not isinstance(baseline, dict) or set(baseline) != {"present", "data"}
                or not isinstance(baseline["present"], bool) or not isinstance(baseline["data"], str)):
            raise ValueError("configuration baseline is invalid")
        original = bytes.fromhex(baseline["data"])
        original.decode("utf-8")
        baseline = {"present": True, "data": updated_settings(original, {KEY: language}).hex()}
    return current, baseline


def _read_language_update(root):
    journal = root / ".auto-company.local.language-update"
    if journal.is_symlink():
        raise ValueError("language update journal must not be a symlink")
    try:
        update = json.loads(journal.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return None
    if (not isinstance(update, dict) or set(update) != {"version", "language"}
            or update["version"] != 1 or update["language"] not in LANGUAGES):
        raise ValueError("language update journal is invalid")
    return update


def recover_language_update(root):
    """Replay an authorized preference update under configuration_lock."""
    update = _read_language_update(root)
    if update is None:
        return
    current, baseline = _language_update_targets(root, update["language"])
    atomic_write(root / ".auto-company.local", current)
    if baseline is not None:
        atomic_write(root / ".auto-company.local.cycle-backup", json.dumps(baseline).encode())
    (root / ".auto-company.local.language-update").unlink()


def recover_configuration_lock(root, confirmation):
    """RECOVER attests that the operator has stopped all configuration writers."""
    if confirmation != "RECOVER":
        raise ValueError("recover-lock requires --confirm RECOVER after stopping every loop, team, Dashboard and configuration writer")
    pid_file = root / ".auto-loop.pid"
    if pid_file.exists() and pid_file.read_text(encoding="utf-8").strip():
        raise LanguageLockedError("stop the loop before recovering the configuration lock")
    team_marker = root / ".auto-company.local.team-active"
    if team_marker.is_symlink() or (team_marker.exists() and not team_marker.is_file()):
        raise ValueError("interactive team marker must be a regular file")
    lock = root / ".auto-company.local.lock"
    if lock.is_symlink():
        raise ValueError("configuration lock must not be a symlink")
    try:
        lock.rmdir()  # Refuse nonempty directories; never delete state recursively.
    except FileNotFoundError:
        pass
    with configuration_lock(root):
        recover_language_update(root)
        if team_marker.exists():
            team_marker.unlink()
        return _language_state(root)


def start_product(root, environ=None):
    with configuration_lock(root):
        recover_language_update(root)
        return _start_product(root, environ)


def _start_product(root, environ=None):
    state = _language_state(root, environ)
    if not state["locked"]:
        data, _ = read_settings(root)
        write_settings(root, data, {KEY: state["nextLanguage"],
                       PRODUCT_KEYS[0]: uuid.uuid4().hex,
                       PRODUCT_KEYS[1]: state["nextLanguage"], PRODUCT_KEYS[2]: "active"})
    return _language_state(root, environ)


def interactive_team(root, engine):
    if engine not in ("claude", "codex"):
        raise ValueError("interactive engine must be claude or codex")
    executable = shutil.which(engine)
    if executable is None:
        raise ValueError(f"interactive engine was not found: {engine}")
    marker = root / ".auto-company.local.team-active"
    with configuration_lock(root):
        recover_language_update(root)
        if marker.exists() or marker.is_symlink():
            raise LanguageLockedError("an interactive team is already active; close it before starting another")
        state = _start_product(root)
        atomic_write(marker, str(os.getpid()).encode())
    previous_handler = signal.getsignal(signal.SIGTERM)

    def terminate(signum, frame):
        raise SystemExit(128 + signum)

    try:
        signal.signal(signal.SIGTERM, terminate)
        output_context = context(root, state["language"], resource_map(root, state["language"]))
        return subprocess.run([executable, output_context], cwd=root,
                              env=dict(os.environ, **{KEY: state["language"]})).returncode
    finally:
        signal.signal(signal.SIGTERM, previous_handler)
        with configuration_lock(root):
            marker.unlink()


def next_product(root, confirmation):
    if confirmation != "NEXT":
        raise ValueError("next-product requires --confirm NEXT")
    with configuration_lock(root):
        recover_language_update(root)
        pid_file = root / ".auto-loop.pid"
        if pid_file.exists() and pid_file.read_text(encoding="utf-8").strip():
            raise LanguageLockedError("stop the loop before starting the next product")
        if (root / ".auto-company.local.team-active").exists():
            raise LanguageLockedError("close the interactive team before starting the next product")
        if (root / "memories/.consensus-cycle-pending").exists():
            raise LanguageLockedError("recover the interrupted cycle before starting the next product")
        state = _language_state(root)
        data, _ = read_settings(root)
        write_settings(root, data, {KEY: state["nextLanguage"],
                       PRODUCT_KEYS[0]: uuid.uuid4().hex,
                       PRODUCT_KEYS[1]: state["nextLanguage"], PRODUCT_KEYS[2]: "active"})
        return _language_state(root)


def source_digest(path):
    # Checkouts may use CRLF; line-ending conversion is not a customization.
    return hashlib.sha256(path.read_bytes().replace(b"\r\n", b"\n")).hexdigest()


def resource_map(root, language):
    manifest = root / "i18n/source-hashes.json"
    if not manifest.is_file():
        return {}
    sources = json.loads(manifest.read_text(encoding="utf-8"))
    if not isinstance(sources, dict) or not all(isinstance(name, str) and isinstance(digest, str) for name, digest in sources.items()):
        raise ValueError("language resource manifest must map source paths to hashes")
    resolved = {}
    for name, digest in sources.items():
        relative = Path(name)
        if relative.is_absolute() or ".." in relative.parts or "\\" in name:
            raise ValueError("invalid language resource path")
        source = root / relative
        translated = root / "i18n" / language / relative
        # A changed source always wins, even if a packaged translation exists.
        if source.is_file():
            use_translation = (not name.startswith(".claude/skills/")
                               and translated.is_file() and source_digest(source) == digest)
            resolved[name] = translated.relative_to(root).as_posix() if use_translation else name
    return resolved


def context(root, language, resources):
    output = "English" if language == "en" else "简体中文"
    lines = [
        "## Product Language / 本产品工作语言",
        "",
        f"- AUTO_COMPANY_LANGUAGE={language}. This is the immutable language of the current product, from initial work through delivery, including pauses and restarts.",
        f"- Write new explanations, decisions, consensus prose, product interface text, user documentation and delivery materials in {output}.",
        "- Language preferences changed during this product apply only to the next product. Do not change the current product language in response to a mid-product request; record the preference for the next product instead.",
        "- Keep protocol headings (especially Human Overrides and Priority Issues), identifiers, commands, paths and quoted evidence unchanged.",
        "- Do not translate or rewrite existing history or the Human Overrides section. Never change product language state or run language configuration commands on the human's behalf.",
        "- All resource paths below are relative to the framework root. Resolve every bundled role/skill reference through this table before reading it; the selected path overrides references and auto-discovered defaults.",
        "- Bundled skill instructions remain English. Their source language does not determine the product's output language.",
        "- When delegating, pass the selected role instructions and this immutable product language to each subagent.",
        "- Before delivery, inspect the new product's visible UI, help, user documentation and delivery materials for the selected language; correct mismatches and report any remaining exceptions.",
        "- A customized source takes precedence over its packaged translation. Never regenerate or overwrite user-edited instructions.",
    ]
    if resources:
        lines.extend(["", "| Bundled resource | Selected resource |", "|---|---|"])
        lines.extend(f"| `{name}` | `{selected}` |" for name, selected in sorted(resources.items()))
    return "\n".join(lines)


def build_prompt(root, language):
    resources = resource_map(root, language)
    path = root / resources.get("PROMPT.md", "PROMPT.md")
    prompt = path.read_text(encoding="utf-8")
    return prompt + "\n\n---\n\n" + context(root, language, resources)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("check", "state", "start", "team", "next-product", "recover-lock", "prompt", "context", "set", "message", "help"))
    parser.add_argument("--root", type=Path, default=ROOT)
    parser.add_argument("--language")
    parser.add_argument("--key")
    parser.add_argument("--confirm")
    parser.add_argument("--engine")
    parser.add_argument("--arg", action="append", default=[])
    args = parser.parse_args()
    root = args.root.resolve()
    try:
        if args.command == "team":
            return interactive_team(root, args.engine)
        elif args.command == "message":
            if not args.key:
                parser.error("message requires --key")
            print(message(root, args.key, *args.arg))
        elif args.command == "help":
            language = diagnostic_language(root)
            for line in (root / "Makefile").read_text(encoding="utf-8").splitlines():
                match = re.match(r"^([a-zA-Z_-]+):.*?## (.*)$", line)
                if match:
                    print(f"  {match[1]:<24} {message(root, 'help.' + match[1], language=language, fallback=match[2])}")
        elif args.command == "set":
            if args.language is None:
                parser.error("set requires --language")
            set_language(root, args.language)
            print(message(root, "language.saved", args.language))
        elif args.command in ("state", "start", "next-product", "recover-lock"):
            if args.command == "start":
                state = start_product(root)
            elif args.command == "next-product":
                state = next_product(root, args.confirm)
            elif args.command == "recover-lock":
                state = recover_configuration_lock(root, args.confirm)
            else:
                state = language_state(root)
            print(json.dumps(state, ensure_ascii=False))
        else:
            language = resolve_language(root)
            if args.command == "prompt":
                print(build_prompt(root, language))
            elif args.command == "context":
                print(context(root, language, resource_map(root, language)))
            else:
                print(language)
    except (OSError, UnicodeError, ValueError, TypeError) as error:
        print(f"Error: {error}", file=sys.stderr)
        key = "language.running" if isinstance(error, LanguageLockedError) else "language.invalid"
        print(message(root, key), file=sys.stderr)
        return 78
    return 0


if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    sys.exit(main())
