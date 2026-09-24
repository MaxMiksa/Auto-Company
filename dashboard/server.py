#!/usr/bin/env python3
"""Local dashboard server for Auto Company (Windows, Linux/WSL, and macOS)."""

from __future__ import annotations

import argparse
import html
import ipaddress
import json
import os
import platform
import re
import socket
import subprocess
import sys
import time
import threading
import webbrowser
from datetime import datetime, timezone
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse


REPO_ROOT = Path(__file__).resolve().parents[1]
DASHBOARD_DIR = Path(__file__).resolve().parent
CORE_SCRIPT_DIR = REPO_ROOT / "scripts" / "core"
if str(CORE_SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(CORE_SCRIPT_DIR))
if str(DASHBOARD_DIR) not in sys.path:
    sys.path.insert(0, str(DASHBOARD_DIR))

from usage_lib import UsageError, read_pause_state, summarize_usage  # noqa: E402
import localization  # noqa: E402
from installation_state import check_maintenance, writer_lease  # noqa: E402
from journal_data import JournalSource  # noqa: E402

WINDOWS_STATUS_SCRIPT = REPO_ROOT / "scripts" / "windows" / "status-win.ps1"
WINDOWS_START_SCRIPT = REPO_ROOT / "scripts" / "windows" / "start-win.ps1"
WINDOWS_STOP_SCRIPT = REPO_ROOT / "scripts" / "windows" / "stop-win.ps1"

MACOS_STATUS_SCRIPT = REPO_ROOT / "scripts" / "macos" / "status-mac.sh"
MACOS_START_SCRIPT = REPO_ROOT / "scripts" / "macos" / "start-daemon.sh"
MACOS_STOP_SCRIPT = REPO_ROOT / "scripts" / "core" / "stop-loop.sh"

LINUX_DASHBOARD_SCRIPT = REPO_ROOT / "scripts" / "wsl" / "dashboard-wsl.sh"

LOG_FILE = REPO_ROOT / "logs" / "auto-loop.log"
USAGE_FILE = REPO_ROOT / "logs" / "usage.jsonl"
STATE_FILE = REPO_ROOT / ".auto-loop-state"
CONSENSUS_FILE = REPO_ROOT / "memories" / "consensus.md"
BUDGET_PAUSE_FILE = REPO_ROOT / ".auto-loop-budget-paused"

CONTROL_LOCK = threading.Lock()
CONTROL_ACTION = ""

WINDOWS_HOST = "windows"
MACOS_HOST = "macos"
LINUX_HOST = "linux"

KNOWN_STATES = frozenset(
    {
        "active",
        "activating",
        "configured",
        "deactivating",
        "failed",
        "inactive",
        "idle",
        "mismatched",
        "paused",
        "waiting_limit",
        "circuit_break",
        "not_configured",
        "not_installed",
        "reloading",
        "running",
        "stopped",
        "unavailable",
        "unknown",
        "unsupported",
    }
)

DOCUMENTS = {
    "readme": ("README.md", "README-ZH.md"),
    "troubleshooting": ("docs/troubleshooting.md", None),
    "setup": ("docs/windows-setup.md", None),
    "language": ("i18n/en/README.md", "i18n/README.md"),
}


def documentation_page(name: str) -> str:
    """Only expose bundled documentation, never arbitrary repository files."""
    source, chinese = DOCUMENTS[name]
    language = localization.language_state(REPO_ROOT)["language"]
    if chinese is not None:
        selected = chinese if language == "zh-CN" else source
    else:
        selected = localization.resource_map(REPO_ROOT, language).get(source, source)
    allowed = {source, chinese, f"i18n/en/{source}", f"i18n/zh-CN/{source}"}
    if selected not in allowed:
        raise ValueError("invalid documentation path")
    path = REPO_ROOT / selected
    # Reject symlinks even when they point back inside the checkout, where a
    # private local configuration could otherwise be exposed as a document.
    if any((REPO_ROOT / Path(*Path(selected).parts[:index])).is_symlink()
           for index in range(1, len(Path(selected).parts) + 1)):
        raise ValueError("documentation must not use symlinks")
    path.resolve().relative_to(REPO_ROOT.resolve())
    content = path.read_text(encoding="utf-8")
    if language == "zh-CN":
        back = "返回控制台"
        labels = {"readme": "使用指南", "troubleshooting": "故障排查", "setup": "Windows 安装", "language": "语言设置"}
    else:
        back = "Back to dashboard"
        labels = {"readme": "Guide", "troubleshooting": "Troubleshooting", "setup": "Windows setup", "language": "Language settings"}
    navigation = f'<a href="/">{back}</a>' + "".join(
        f' <a href="/docs/{key}">{label}</a>' for key, label in labels.items()
    )
    return (
        f'<!doctype html><html lang="{language}"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width, initial-scale=1">'
        '<meta http-equiv="Content-Security-Policy" content="default-src &#39;none&#39;; '
        'style-src &#39;unsafe-inline&#39;; base-uri &#39;none&#39;">'
        f'<title>{labels[name]}</title><style>body{{max-width:960px;margin:32px auto;padding:0 20px;'
        'font:16px/1.65 system-ui,sans-serif;color:#172b38;background:#f7fafc}'
        'pre{white-space:pre-wrap;overflow-wrap:anywhere;font:inherit}a{color:#075a9e}'
        'nav{display:flex;gap:16px;flex-wrap:wrap}</style></head>'
        f'<body><nav>{navigation}</nav><h1>{labels[name]}</h1>'
        f'<pre>{html.escape(content)}</pre></body></html>'
    )


def ps_quote(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def detect_host_kind(system_name: str | None = None) -> str:
    name = system_name or platform.system()
    if name == "Windows":
        return WINDOWS_HOST
    if name == "Darwin":
        return MACOS_HOST
    if name == "Linux":
        return LINUX_HOST
    raise RuntimeError(
        "Dashboard only supports Windows hosts (with WSL backend), Linux/WSL, "
        "and macOS hosts."
    )


def run_powershell_script(
    script_path: Path, args: list[str] | None = None, timeout: int = 90
) -> dict[str, Any]:
    invocation = f"& {ps_quote(str(script_path))}"
    if args:
        invocation += " " + " ".join(ps_quote(arg) for arg in args)

    cmd = [
        "powershell",
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        (
            "$ErrorActionPreference='Stop'; "
            "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; "
            "$OutputEncoding=[System.Text.Encoding]::UTF8; "
            f"{invocation} *>&1 | Out-String"
        ),
    ]

    start = time.time()
    proc = subprocess.run(
        cmd,
        cwd=str(REPO_ROOT),
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=timeout,
    )
    elapsed_ms = int((time.time() - start) * 1000)

    output = (proc.stdout or "").strip()
    error = (proc.stderr or "").strip()
    combined = output
    if error:
        combined = f"{output}\n{error}".strip()

    return {
        "ok": proc.returncode == 0,
        "exitCode": proc.returncode,
        "elapsedMs": elapsed_ms,
        "output": combined,
    }


def run_shell_script(
    script_path: Path, args: list[str] | None = None, timeout: int = 90
) -> dict[str, Any]:
    cmd = ["/bin/bash", str(script_path)]
    if args:
        cmd.extend(args)

    start = time.time()
    proc = subprocess.run(
        cmd,
        cwd=str(REPO_ROOT),
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=timeout,
    )
    elapsed_ms = int((time.time() - start) * 1000)

    output = (proc.stdout or "").strip()
    error = (proc.stderr or "").strip()
    combined = output
    if error:
        combined = f"{output}\n{error}".strip()

    return {
        "ok": proc.returncode == 0,
        "exitCode": proc.returncode,
        "elapsedMs": elapsed_ms,
        "output": combined,
    }


def get_host_profile(system_name: str | None = None) -> dict[str, Any]:
    host = detect_host_kind(system_name)
    if host == WINDOWS_HOST:
        return {
            "host": host,
            "runner": run_powershell_script,
            "parser": parse_windows_status_output,
            "status_script": WINDOWS_STATUS_SCRIPT,
            "status_args": None,
            "start_script": WINDOWS_START_SCRIPT,
            "start_args": None,
            "stop_script": WINDOWS_STOP_SCRIPT,
            "stop_args": None,
        }
    if host == MACOS_HOST:
        return {
            "host": host,
            "runner": run_shell_script,
            "parser": parse_macos_status_output,
            "status_script": MACOS_STATUS_SCRIPT,
            "status_args": None,
            "start_script": MACOS_START_SCRIPT,
            "start_args": None,
            "stop_script": MACOS_STOP_SCRIPT,
            "stop_args": ["--pause-daemon"],
        }
    return {
        "host": host,
        "runner": run_shell_script,
        "parser": parse_linux_status_output,
        "status_script": LINUX_DASHBOARD_SCRIPT,
        "status_args": ["status"],
        "start_script": LINUX_DASHBOARD_SCRIPT,
        "start_args": ["start"],
        "stop_script": LINUX_DASHBOARD_SCRIPT,
        "stop_args": ["stop"],
    }


def read_text_file(path: Path, fallback: str = "") -> str:
    try:
        raw = path.read_bytes()
    except FileNotFoundError:
        return fallback
    except Exception as exc:  # pragma: no cover - defensive
        return f"(read error: {exc})"

    for enc in ("utf-8", "utf-8-sig", "gb18030", "cp936"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue

    return raw.decode("utf-8", errors="replace")


def read_tail(path: Path, lines: int = 120) -> str:
    if lines <= 0:
        return ""
    text = read_text_file(path, "")
    if not text:
        return ""
    rows = text.splitlines()
    return "\n".join(rows[-lines:])


def parse_sections(raw: str) -> dict[str, list[str]]:
    section_re = re.compile(r"^=== (.+) ===$")
    sections: dict[str, list[str]] = {}
    current: str | None = None

    for line in raw.splitlines():
        row = line.rstrip("\n")
        match = section_re.match(row.strip())
        if match:
            current = match.group(1)
            sections[current] = []
            continue
        if current is not None:
            sections[current].append(row)

    return sections


def parse_int(value: str | None) -> int | None:
    if not value:
        return None
    value = value.strip()
    return int(value) if value.isdigit() else None


def parse_positive_int(value: str | None, default: int) -> int:
    try:
        parsed = int(value or "")
    except (TypeError, ValueError):
        return default
    return parsed if parsed > 0 else default


def parse_key_values(rows: list[str]) -> dict[str, str]:
    values: dict[str, str] = {}
    for row in rows:
        if "=" not in row:
            continue
        key, value = row.split("=", 1)
        values[key.strip()] = value.strip()
    return values


def normalize_state(value: str | None, default: str = "unknown") -> str:
    state = (value or "").strip().lower()
    return state if state in KNOWN_STATES else default


def blank_parsed() -> dict[str, Any]:
    return {
        "guardian": {"state": "unknown", "pid": None, "raw": ""},
        "autostart": {"state": "unknown", "enabledState": "unknown", "raw": ""},
        "daemon": {
            "state": "unknown",
            "activeState": "unknown",
            "subState": "unknown",
            "mainPid": None,
            "raw": "",
        },
        "loop": {
            "state": "unknown",
            "pid": None,
            "daemonSummary": "unknown",
            "engine": "",
            "model": "",
            "lastRun": "",
            "errorCount": "",
            "loopCount": "",
            "pauseReason": "",
            "raw": "",
        },
        "consensusPreview": "",
        "recentLog": "",
    }


def parse_windows_status_output(raw: str) -> dict[str, Any]:
    sections = parse_sections(raw)
    parsed = blank_parsed()

    guardian_rows = sections.get("Windows Guardian", [])
    guardian_line = next(
        (x.strip() for x in guardian_rows if x.strip().startswith("Awake guardian:")),
        "",
    )
    parsed["guardian"]["raw"] = "\n".join(guardian_rows).strip()
    if guardian_line:
        parsed["guardian"]["raw"] = guardian_line
        if "STOPPED" in guardian_line:
            parsed["guardian"]["state"] = "stopped"
        elif "RUNNING" in guardian_line:
            parsed["guardian"]["state"] = "running"
            pid_match = re.search(r"PID (\d+)", guardian_line)
            parsed["guardian"]["pid"] = int(pid_match.group(1)) if pid_match else None

    autostart_rows = sections.get("Windows Autostart Task", [])
    autostart_line = next(
        (x.strip() for x in autostart_rows if x.strip().startswith("Autostart:")),
        "",
    )
    parsed["autostart"]["raw"] = "\n".join(autostart_rows).strip()
    if autostart_line:
        parsed["autostart"]["raw"] = autostart_line
        if "NOT CONFIGURED" in autostart_line:
            parsed["autostart"]["state"] = "not_configured"
        elif "CONFIGURED" in autostart_line:
            parsed["autostart"]["state"] = "configured"

    daemon_rows = sections.get("WSL Daemon (systemd --user)", [])
    parsed["daemon"]["raw"] = "\n".join(daemon_rows).strip()
    daemon_compact = [x.strip() for x in daemon_rows if x.strip()]
    if daemon_compact:
        first = daemon_compact[0]
        lowered = first.lower()
        if "not installed" in lowered:
            parsed["daemon"]["state"] = "not_installed"
        elif first == "active":
            parsed["daemon"]["state"] = "active"
        else:
            parsed["daemon"]["state"] = normalize_state(first)
        for row in daemon_compact:
            if row.startswith("MainPID="):
                parsed["daemon"]["mainPid"] = parse_int(row.split("=", 1)[1])
            elif row.startswith("ActiveState="):
                parsed["daemon"]["activeState"] = row.split("=", 1)[1].strip()
            elif row.startswith("SubState="):
                parsed["daemon"]["subState"] = row.split("=", 1)[1].strip()

    loop_rows = sections.get("Loop Status (scripts/core/monitor.sh)", [])
    if not loop_rows:
        loop_rows = sections.get("Loop Status (monitor.sh)", [])
    loop_status_rows = sections.get("Auto Company Status", [])
    merged_loop_rows = list(loop_rows) + list(loop_status_rows)
    parsed["loop"]["raw"] = "\n".join(merged_loop_rows).strip()
    for row in (x.strip() for x in merged_loop_rows if x.strip()):
        if row.startswith("Loop:"):
            if "NOT RUNNING" in row or "STOPPED" in row:
                parsed["loop"]["state"] = "stopped"
                parsed["loop"]["pid"] = None
            elif "RUNNING" in row:
                parsed["loop"]["state"] = "running"
                pid_match = re.search(r"PID (\d+)", row)
                parsed["loop"]["pid"] = int(pid_match.group(1)) if pid_match else None
        elif row.startswith("Daemon:"):
            parsed["loop"]["daemonSummary"] = row.replace("Daemon:", "", 1).strip()
        elif row.startswith("ENGINE="):
            parsed["loop"]["engine"] = row.split("=", 1)[1].strip()
        elif row.startswith("MODEL="):
            parsed["loop"]["model"] = row.split("=", 1)[1].strip()
        elif row.startswith("LAST_RUN="):
            parsed["loop"]["lastRun"] = row.split("=", 1)[1].strip()
        elif row.startswith("ERROR_COUNT="):
            parsed["loop"]["errorCount"] = row.split("=", 1)[1].strip()
        elif row.startswith("LOOP_COUNT="):
            parsed["loop"]["loopCount"] = row.split("=", 1)[1].strip()
        elif row.startswith("PAUSE_REASON="):
            parsed["loop"]["pauseReason"] = row.split("=", 1)[1].strip()

    parsed["consensusPreview"] = "\n".join(sections.get("Latest Consensus", [])).strip()
    parsed["recentLog"] = "\n".join(sections.get("Recent Log", [])).strip()
    return parsed


def parse_structured_status_output(raw: str) -> dict[str, Any]:
    sections = parse_sections(raw)
    parsed = blank_parsed()

    guardian_fields = parse_key_values(sections.get("Guardian", []))
    parsed["guardian"]["state"] = normalize_state(guardian_fields.get("State"))
    parsed["guardian"]["pid"] = parse_int(guardian_fields.get("Pid"))
    parsed["guardian"]["raw"] = guardian_fields.get("Raw", "")

    daemon_fields = parse_key_values(sections.get("Daemon", []))
    daemon_state = normalize_state(daemon_fields.get("State"))
    parsed["daemon"]["state"] = daemon_state
    parsed["daemon"]["mainPid"] = parse_int(daemon_fields.get("MainPID"))
    parsed["daemon"]["raw"] = daemon_fields.get("Raw", "")
    parsed["daemon"]["activeState"] = daemon_fields.get("ActiveState", daemon_state)
    parsed["daemon"]["subState"] = daemon_fields.get("SubState", "unknown")

    autostart_fields = parse_key_values(sections.get("Autostart", []))
    parsed["autostart"]["state"] = normalize_state(autostart_fields.get("State"))
    parsed["autostart"]["enabledState"] = autostart_fields.get(
        "EnabledState", "unknown"
    )
    parsed["autostart"]["raw"] = autostart_fields.get("Raw", "")

    loop_fields = parse_key_values(sections.get("Loop", []))
    parsed["loop"]["state"] = normalize_state(loop_fields.get("State"))
    parsed["loop"]["pid"] = parse_int(loop_fields.get("Pid"))
    parsed["loop"]["raw"] = "\n".join(sections.get("Loop", [])).strip()
    parsed["loop"]["daemonSummary"] = loop_fields.get("DaemonSummary", "unknown")

    state_file_fields = parse_key_values(sections.get("State File", []))
    parsed["loop"]["engine"] = state_file_fields.get("ENGINE", "")
    parsed["loop"]["model"] = state_file_fields.get("MODEL", "")
    parsed["loop"]["lastRun"] = state_file_fields.get("LAST_RUN", "")
    parsed["loop"]["errorCount"] = state_file_fields.get("ERROR_COUNT", "")
    parsed["loop"]["loopCount"] = state_file_fields.get("LOOP_COUNT", "")
    parsed["loop"]["pauseReason"] = state_file_fields.get("PAUSE_REASON", "")

    parsed["consensusPreview"] = "\n".join(sections.get("Latest Consensus", [])).strip()
    parsed["recentLog"] = "\n".join(sections.get("Recent Log", [])).strip()
    return parsed


def parse_macos_status_output(raw: str) -> dict[str, Any]:
    return parse_structured_status_output(raw)


def parse_linux_status_output(raw: str) -> dict[str, Any]:
    """Parse the structured status report emitted by dashboard-wsl.sh."""

    return parse_structured_status_output(raw)


def read_state_file_pairs() -> dict[str, str]:
    state_text = read_text_file(STATE_FILE, "").strip()
    state_pairs: dict[str, str] = {}
    if state_text:
        for row in state_text.splitlines():
            if "=" in row:
                key, value = row.split("=", 1)
                state_pairs[key.strip()] = value.strip()
    return state_pairs


def run_status_command(system_name: str | None = None) -> dict[str, Any]:
    profile = get_host_profile(system_name)
    runner = profile["runner"]
    if profile["status_args"] is None:
        return runner(profile["status_script"], timeout=90)
    return runner(profile["status_script"], args=profile["status_args"], timeout=90)


def run_dashboard_action(action: str, system_name: str | None = None) -> dict[str, Any]:
    profile = get_host_profile(system_name)
    if action == "start":
        return profile["runner"](
            profile["start_script"], args=profile["start_args"], timeout=120
        )
    if action == "stop":
        return profile["runner"](
            profile["stop_script"], args=profile["stop_args"], timeout=120
        )
    if action == "refresh":
        if profile["status_args"] is None:
            return profile["runner"](profile["status_script"], timeout=90)
        return profile["runner"](
            profile["status_script"], args=profile["status_args"], timeout=90
        )
    raise ValueError(f"Unsupported dashboard action: {action}")


def parse_status_output(raw: str, system_name: str | None = None) -> dict[str, Any]:
    profile = get_host_profile(system_name)
    return profile["parser"](raw)


def gather_status_payload(system_name: str | None = None) -> dict[str, Any]:
    try:
        result = run_status_command(system_name)
    except (subprocess.TimeoutExpired, OSError) as exc:
        result = {"ok": False, "exitCode": 1, "elapsedMs": 0,
                  "output": f"Dashboard status unavailable: {exc}"}
    parsed = parse_status_output(result["output"], system_name)
    state_file = read_state_file_pairs()
    # Saved runtime phases refine a live process only. A stale state file must
    # never turn a stopped process into a running or paused one.
    parsed["loop"]["processState"] = parsed["loop"]["state"]
    runtime_phase = state_file.get("STATUS")
    if parsed["loop"]["state"] == "running" and runtime_phase in {
        "running", "idle", "paused", "waiting_limit", "circuit_break"
    }:
        parsed["loop"]["state"] = runtime_phase
    return {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "ok": result["ok"],
        "exitCode": result["exitCode"],
        "elapsedMs": result["elapsedMs"],
        "raw": result["output"],
        "parsed": parsed,
        "stateFile": state_file,
        "consensusHead": read_text_file(CONSENSUS_FILE, "(no consensus file)")[:3000],
        "logTail": read_tail(LOG_FILE, lines=180),
    }


def gather_usage_payload(
    *,
    period: str = "day",
    target_date: str | None = None,
    ledger_path: Path = USAGE_FILE,
    pause_path: Path = BUDGET_PAUSE_FILE,
) -> dict[str, Any]:
    selected_date = target_date or datetime.now().astimezone().date().isoformat()
    return {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "summary": summarize_usage(
            ledger_path,
            period=period,
            target_date=selected_date,
        ),
        "budgetPause": read_pause_state(pause_path),
    }


def gather_journal_payload() -> dict[str, Any]:
    """Use the same runtime and language authority as the control endpoints."""
    source = JournalSource(REPO_ROOT)
    payload = source.snapshot(status=gather_status_payload(),
                              language_state=localization.language_state(REPO_ROOT))
    try:
        _, truncated = source.read(".auto-loop-budget-paused", 32 * 1024)
        if truncated:
            raise ValueError("Budget marker exceeds its size limit")
        payload["budgetPause"] = read_pause_state(source.safe_path(".auto-loop-budget-paused"))
    except FileNotFoundError:
        payload["budgetPause"] = None
    except (OSError, ValueError):
        payload["budgetPause"] = None
        payload["warnings"].append("budget_pause_unavailable")
    # Keep cleanup failures visible after reload, even if the model already exited.
    control = {"action": CONTROL_ACTION,
               "stopUnconfirmed": (REPO_ROOT / ".auto-loop-stop-pending").exists()}
    payload["control"] = control
    if control["action"] == "stop" or control["stopUnconfirmed"]:
        payload["runtime"]["state"] = "stopping" if control["action"] == "stop" else "stop_failed"
    return payload


def capture_product_media(product_id: str) -> dict[str, Any]:
    """Run the bounded media command in the runtime's OS, without a model call."""
    source = JournalSource(REPO_ROOT)
    project = source.project()["id"]
    from product_identity import get_identity
    identity = get_identity(REPO_ROOT, project, create=False) if project else None
    if not identity or identity["id"] != product_id:
        raise ValueError("The selected product has changed")
    arguments = ["scripts/core/runtime_artifacts.py", "--project", project, "media", "--retry"]
    if detect_host_kind() == WINDOWS_HOST:
        conversion = subprocess.run(["wsl.exe", "-d", "Ubuntu", "--exec", "wslpath", "-a", REPO_ROOT.as_posix()],
                                    capture_output=True, text=True, timeout=15, check=True,
                                    creationflags=subprocess.CREATE_NO_WINDOW)
        root = conversion.stdout.strip()
        if not root.startswith("/") or "\n" in root or "\r" in root:
            raise ValueError("Runtime path conversion failed")
        command = ["wsl.exe", "-d", "Ubuntu", "--cd", root, "--exec", "python3", *arguments]
    else:
        command = [sys.executable, *arguments]
    result = subprocess.run(command, cwd=REPO_ROOT, capture_output=True, timeout=150,
                            **({"creationflags": subprocess.CREATE_NO_WINDOW} if os.name == "nt" else {}))
    from product_media import media_projection
    return {"ok": result.returncode == 0, "productMedia": media_projection(REPO_ROOT, project),
            "error": None if result.returncode == 0 else "Product screenshot was not completed."}


class DashboardHandler(BaseHTTPRequestHandler):
    def _request_allowed(self) -> bool:
        address, port = self.server.server_address[:2]
        hosts = {f"localhost:{port}", f"{address}:{port}"}
        if ":" in address:
            hosts.add(f"[{address}]:{port}")
        host = self.headers.get("Host", "").lower()
        origin = self.headers.get("Origin")
        if (host not in hosts or (origin is not None and origin != f"http://{host}")
                or self.headers.get("Sec-Fetch-Site") == "cross-site"):
            self._json({"ok": False, "error": "Only same-origin local dashboard requests are allowed."},
                       code=HTTPStatus.FORBIDDEN)
            return False
        return True

    def _json(self, payload: dict[str, Any], code: int = 200) -> None:
        raw = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def _text(
        self, text: str, code: int = 200, content_type: str = "text/plain; charset=utf-8",
        *, truncated: bool = False,
    ) -> None:
        raw = text.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", content_type)
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        if truncated:
            self.send_header("X-Content-Truncated", "true")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def _serve_file(self, path: Path, content_type: str) -> None:
        if not path.exists():
            self._text("Not found", code=404)
            return
        self._text(path.read_text(encoding="utf-8"), content_type=content_type)

    def do_GET(self) -> None:  # noqa: N802
        if not self._request_allowed():
            return
        parsed = urlparse(self.path)
        path = parsed.path

        if path.startswith("/api/product-media/"):
            try:
                match = re.fullmatch(r"/api/product-media/([0-9a-f]{32})/([A-Za-z0-9_.-]+\.(?:png|svg))", path)
                if not match or parsed.query:
                    raise ValueError("Invalid media identity")
                raw, mime = JournalSource(REPO_ROOT).media_resource(*match.groups())
                self.send_response(200)
                self.send_header("Content-Type", mime)
                self.send_header("Content-Length", str(len(raw)))
                self.send_header("Cache-Control", "no-store")
                self.send_header("X-Content-Type-Options", "nosniff")
                self.send_header("Content-Security-Policy", "default-src 'none'; sandbox")
                self.end_headers()
                self.wfile.write(raw)
            except (ValueError, KeyError, UnicodeError):
                self._json({"ok": False, "error": "Invalid media resource."}, code=400)
            except OSError:
                self._json({"ok": False, "error": "Media resource unavailable."}, code=404)
            return
        if path in {"/api/journal", "/api/journal/log", "/api/journal/document"}:
            try:
                query = parse_qs(parsed.query, keep_blank_values=True, max_num_fields=12)
                if path == "/api/journal":
                    self._json(gather_journal_payload())
                elif path == "/api/journal/log":
                    if set(query) != {"id"} or len(query["id"]) != 1:
                        raise ValueError("One cycle identity is required")
                    source = JournalSource(REPO_ROOT)
                    try:
                        result = source.log(query["id"][0])
                    except ValueError:
                        result = source.log(query["id"][0], gather_status_payload())
                    self._json(result)
                else:
                    if set(query) != {"path"} or len(query["path"]) != 1:
                        raise ValueError("One document path is required")
                    text, truncated = JournalSource(REPO_ROOT).document(query["path"][0])
                    self._text(text, truncated=truncated)
            except (ValueError, KeyError, UnicodeError):
                self._json({"ok": False, "error": "Invalid or unavailable journal resource."}, code=400)
            except OSError:
                self._json({"ok": False, "error": "Journal resource unavailable."}, code=404)
            return
        if path == "/api/language":
            try:
                self._json({"ok": True, **localization.language_state(REPO_ROOT)})
            except (ValueError, OSError, UnicodeError):
                self._json({"ok": False, "errorCode": "language_invalid"}, code=HTTPStatus.BAD_REQUEST)
            return
        if path.startswith("/docs/") and path[6:] in DOCUMENTS:
            try:
                page = documentation_page(path[6:])
            except (KeyError, ValueError, OSError, UnicodeError):
                self._text("Documentation unavailable", code=HTTPStatus.NOT_FOUND)
                return
            self._text(page, content_type="text/html; charset=utf-8")
            return

        if path in {"/", "/index.html", "/journal", "/journal/", "/journal/index.html"}:
            self._serve_file(DASHBOARD_DIR / "index.html", "text/html; charset=utf-8")
            return
        if path in {"/app.js", "/i18n.js", "/journal/app.js", "/journal/i18n.js"}:
            self._serve_file(
                DASHBOARD_DIR / path.rsplit("/", 1)[-1],
                "application/javascript; charset=utf-8",
            )
            return
        if path in {"/styles.css", "/journal/styles.css"}:
            self._serve_file(DASHBOARD_DIR / "styles.css", "text/css; charset=utf-8")
            return
        if path == "/favicon.svg":
            self._serve_file(DASHBOARD_DIR / "favicon.svg", "image/svg+xml")
            return
        if path == "/api/status":
            self._json(gather_status_payload())
            return
        if path == "/api/usage":
            qs = parse_qs(parsed.query)
            period = qs.get("period", ["day"])[0]
            target_date = qs.get("date", [None])[0]
            try:
                self._json(
                    gather_usage_payload(period=period, target_date=target_date)
                )
            except UsageError as exc:
                self._json({"ok": False, "error": str(exc)}, code=HTTPStatus.BAD_REQUEST)
            return
        if path == "/api/log-tail":
            qs = parse_qs(parsed.query)
            lines = parse_positive_int(qs.get("lines", ["180"])[0], default=180)
            self._json(
                {
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                    "lines": lines,
                    "logTail": read_tail(LOG_FILE, lines=lines),
                }
            )
            return

        self._text("Not found", code=404)

    def do_POST(self) -> None:  # noqa: N802
        global CONTROL_ACTION
        if not self._request_allowed():
            return
        if self.headers.get("Content-Type", "").split(";", 1)[0] != "application/json":
            self._json({"ok": False, "error": "Actions require application/json."},
                       code=HTTPStatus.UNSUPPORTED_MEDIA_TYPE)
            return
        parsed = urlparse(self.path)
        path = parsed.path
        if path not in {"/api/action/stop", "/api/action/refresh"}:
            try:
                check_maintenance(REPO_ROOT)
            except ValueError as error:
                self._json({"ok": False, "errorCode": "installation_maintenance", "error": str(error)}, code=409)
                return
        if path == "/api/product-media/capture":
            if not CONTROL_LOCK.acquire(blocking=False):
                self._json({"ok": False, "error": "A runtime action is already in progress."}, code=409)
                return
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if not 0 < length <= 1024 or self.headers.get("Transfer-Encoding") or parsed.query:
                    raise ValueError("Invalid request size")
                body = json.loads(self.rfile.read(length).decode("utf-8"))
                if not isinstance(body, dict) or set(body) != {"productId"} or not isinstance(body["productId"], str) or not re.fullmatch(r"[0-9a-f]{32}", body["productId"]):
                    raise ValueError("Invalid product identity")
                status = gather_status_payload()
                process = status.get("parsed", {}).get("loop", {}).get("processState")
                if CONTROL_ACTION or (REPO_ROOT / ".auto-loop-stop-pending").exists() or status.get("ok") is not True or process not in {"stopped", "inactive"}:
                    self._json({"ok": False, "error": "Capture retries require an idle runtime."}, code=409)
                    return
                CONTROL_ACTION = "capture"
                payload = capture_product_media(body["productId"])
                self._json(payload, code=200 if payload["ok"] else 400)
            except (ValueError, KeyError, UnicodeError):
                self._json({"ok": False, "error": "Invalid or changed product identity."}, code=400)
            except (OSError, subprocess.SubprocessError):
                self._json({"ok": False, "error": "Product screenshot command unavailable."}, code=503)
            finally:
                CONTROL_ACTION = ""
                CONTROL_LOCK.release()
            return
        if path == "/api/language":
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if not 0 < length <= 1024 or self.headers.get("Transfer-Encoding"):
                    raise ValueError("invalid request size")
                body = json.loads(self.rfile.read(length).decode("utf-8"))
                if (not isinstance(body, dict) or set(body) != {"language"}
                        or body["language"] not in localization.LANGUAGES):
                    raise ValueError("invalid language selection")
                localization.set_language(REPO_ROOT, body["language"])
                self._json({"ok": True, **localization.language_state(REPO_ROOT)})
            except (ValueError, UnicodeError):
                self._json({"ok": False, "errorCode": "language_invalid"}, code=HTTPStatus.BAD_REQUEST)
            except OSError:
                self._json({"ok": False, "errorCode": "language_save_failed"}, code=HTTPStatus.INTERNAL_SERVER_ERROR)
            return
        if path not in {"/api/action/start", "/api/action/stop", "/api/action/refresh"}:
            self._text("Not found", code=404)
            return

        action = path.rsplit("/", 1)[-1]
        mutating = action in {"start", "stop"}
        if mutating and not CONTROL_LOCK.acquire(blocking=False):
            self._json({"ok": False, "error": "A runtime action is already in progress."},
                       code=HTTPStatus.CONFLICT)
            return
        pending = REPO_ROOT / ".auto-loop-stop-pending"
        try:
            if action == "start" and pending.exists():
                self._json({"ok": False, "error": "Stop cleanup is unconfirmed. Retry Stop first."},
                           code=HTTPStatus.CONFLICT)
                return
            if mutating:
                CONTROL_ACTION = action
            if action == "stop":
                pending.write_text("stopping\n", encoding="utf-8")
                (REPO_ROOT / ".auto-loop-stop").touch()
            result = run_dashboard_action(action)
            if action == "stop" and result["ok"]:
                pending.unlink(missing_ok=True)
        except (subprocess.TimeoutExpired, OSError) as exc:
            self._json({"ok": False, "output": f"Dashboard action failed: {exc}"},
                       code=HTTPStatus.GATEWAY_TIMEOUT)
            return
        finally:
            if mutating:
                CONTROL_ACTION = ""
                CONTROL_LOCK.release()
        payload = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "action": action,
            "ok": result["ok"],
            "exitCode": result["exitCode"],
            "elapsedMs": result["elapsedMs"],
            "output": result["output"],
        }
        self._json(payload, code=HTTPStatus.OK if result["ok"] else HTTPStatus.BAD_REQUEST)

    def log_message(self, fmt: str, *args: Any) -> None:  # noqa: A003
        _ = (fmt, args)


def main() -> None:
    parser = argparse.ArgumentParser(description="Auto Company web dashboard server")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8787)
    parser.add_argument("--open-browser", action="store_true")
    args = parser.parse_args()

    bind_host = "127.0.0.1" if args.host == "localhost" else args.host
    try:
        address = ipaddress.ip_address(bind_host)
    except ValueError:
        parser.error("--host must be a loopback IP address or localhost")
    if not address.is_loopback:
        parser.error("Dashboard controls are unauthenticated; --host must be loopback")

    try:
        host_kind = detect_host_kind()
    except RuntimeError as exc:
        print(f"[dashboard] {exc}")
        raise SystemExit(1) from exc

    class DashboardServer(ThreadingHTTPServer):
        address_family = socket.AF_INET6 if address.version == 6 else socket.AF_INET

    try:
        with writer_lease(REPO_ROOT):
            server = DashboardServer((bind_host, args.port), DashboardHandler)
            print(f"[dashboard] serving on http://{args.host}:{args.port}")
            print(f"[dashboard] repo: {REPO_ROOT}")
            print(f"[dashboard] host: {host_kind}")
            if args.open_browser:
                webbrowser.open(f"http://{args.host}:{args.port}")
            try:
                server.serve_forever()
            except KeyboardInterrupt:
                pass
            finally:
                server.server_close()
                print("[dashboard] stopped")
    except ValueError as error:
        parser.exit(78, str(error) + "\n")


if __name__ == "__main__":
    os.chdir(REPO_ROOT)
    main()
