#!/usr/bin/env python3
"""Local dashboard server for Auto Company (Windows + WSL + macOS runtime)."""

from __future__ import annotations

import argparse
import json
import os
import platform
import re
import subprocess
import time
from datetime import datetime, timezone
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse


REPO_ROOT = Path(__file__).resolve().parents[1]
DASHBOARD_DIR = Path(__file__).resolve().parent

WINDOWS_STATUS_SCRIPT = REPO_ROOT / "scripts" / "windows" / "status-win.ps1"
WINDOWS_START_SCRIPT = REPO_ROOT / "scripts" / "windows" / "start-win.ps1"
WINDOWS_STOP_SCRIPT = REPO_ROOT / "scripts" / "windows" / "stop-win.ps1"

MACOS_STATUS_SCRIPT = REPO_ROOT / "scripts" / "macos" / "status-mac.sh"
MACOS_START_SCRIPT = REPO_ROOT / "scripts" / "macos" / "install-daemon.sh"
MACOS_STOP_SCRIPT = REPO_ROOT / "scripts" / "core" / "stop-loop.sh"

LOG_FILE = REPO_ROOT / "logs" / "auto-loop.log"
STATE_FILE = REPO_ROOT / ".auto-loop-state"
CONSENSUS_FILE = REPO_ROOT / "memories" / "consensus.md"

WINDOWS_HOST = "windows"
MACOS_HOST = "macos"


def ps_quote(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def detect_host_kind(system_name: str | None = None) -> str:
    name = system_name or platform.system()
    if name == "Windows":
        return WINDOWS_HOST
    if name == "Darwin":
        return MACOS_HOST
    raise RuntimeError(
        "Dashboard only supports Windows hosts (with WSL backend) and macOS hosts."
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
            "start_script": WINDOWS_START_SCRIPT,
            "start_args": None,
            "stop_script": WINDOWS_STOP_SCRIPT,
            "stop_args": None,
        }
    return {
        "host": host,
        "runner": run_shell_script,
        "parser": parse_macos_status_output,
        "status_script": MACOS_STATUS_SCRIPT,
        "start_script": MACOS_START_SCRIPT,
        "start_args": None,
        "stop_script": MACOS_STOP_SCRIPT,
        "stop_args": ["--pause-daemon"],
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


def blank_parsed() -> dict[str, Any]:
    return {
        "guardian": {"state": "unknown", "pid": None, "raw": ""},
        "autostart": {"state": "unknown", "raw": ""},
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
        elif first in {"inactive", "activating", "failed"}:
            parsed["daemon"]["state"] = "inactive"
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

    parsed["consensusPreview"] = "\n".join(sections.get("Latest Consensus", [])).strip()
    parsed["recentLog"] = "\n".join(sections.get("Recent Log", [])).strip()
    return parsed


def parse_macos_status_output(raw: str) -> dict[str, Any]:
    sections = parse_sections(raw)
    parsed = blank_parsed()

    guardian_fields = parse_key_values(sections.get("Guardian", []))
    parsed["guardian"]["state"] = guardian_fields.get("State", "unknown") or "unknown"
    parsed["guardian"]["pid"] = parse_int(guardian_fields.get("Pid"))
    parsed["guardian"]["raw"] = guardian_fields.get("Raw", "")

    daemon_fields = parse_key_values(sections.get("Daemon", []))
    daemon_state = daemon_fields.get("State", "unknown") or "unknown"
    parsed["daemon"]["state"] = daemon_state
    parsed["daemon"]["mainPid"] = parse_int(daemon_fields.get("MainPID"))
    parsed["daemon"]["raw"] = daemon_fields.get("Raw", "")
    parsed["daemon"]["activeState"] = daemon_fields.get("ActiveState", daemon_state)
    parsed["daemon"]["subState"] = daemon_fields.get("SubState", "unknown")

    autostart_fields = parse_key_values(sections.get("Autostart", []))
    parsed["autostart"]["state"] = autostart_fields.get("State", "unknown") or "unknown"
    parsed["autostart"]["raw"] = autostart_fields.get("Raw", "")

    loop_fields = parse_key_values(sections.get("Loop", []))
    parsed["loop"]["state"] = loop_fields.get("State", "unknown") or "unknown"
    parsed["loop"]["pid"] = parse_int(loop_fields.get("Pid"))
    parsed["loop"]["raw"] = "\n".join(sections.get("Loop", [])).strip()
    parsed["loop"]["daemonSummary"] = loop_fields.get("DaemonSummary", "unknown")

    state_file_fields = parse_key_values(sections.get("State File", []))
    parsed["loop"]["engine"] = state_file_fields.get("ENGINE", "")
    parsed["loop"]["model"] = state_file_fields.get("MODEL", "")
    parsed["loop"]["lastRun"] = state_file_fields.get("LAST_RUN", "")
    parsed["loop"]["errorCount"] = state_file_fields.get("ERROR_COUNT", "")
    parsed["loop"]["loopCount"] = state_file_fields.get("LOOP_COUNT", "")

    parsed["consensusPreview"] = "\n".join(sections.get("Latest Consensus", [])).strip()
    parsed["recentLog"] = "\n".join(sections.get("Recent Log", [])).strip()
    return parsed


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
    return runner(profile["status_script"], timeout=90)


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
        return profile["runner"](profile["status_script"], timeout=90)
    raise ValueError(f"Unsupported dashboard action: {action}")


def parse_status_output(raw: str, system_name: str | None = None) -> dict[str, Any]:
    profile = get_host_profile(system_name)
    return profile["parser"](raw)


def gather_status_payload(system_name: str | None = None) -> dict[str, Any]:
    result = run_status_command(system_name)
    parsed = parse_status_output(result["output"], system_name)
    return {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "ok": result["ok"],
        "exitCode": result["exitCode"],
        "elapsedMs": result["elapsedMs"],
        "raw": result["output"],
        "parsed": parsed,
        "stateFile": read_state_file_pairs(),
        "consensusHead": read_text_file(CONSENSUS_FILE, "(no consensus file)")[:3000],
        "logTail": read_tail(LOG_FILE, lines=180),
    }


class DashboardHandler(BaseHTTPRequestHandler):
    def _json(self, payload: dict[str, Any], code: int = 200) -> None:
        raw = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def _text(
        self, text: str, code: int = 200, content_type: str = "text/plain; charset=utf-8"
    ) -> None:
        raw = text.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", content_type)
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def _serve_file(self, path: Path, content_type: str) -> None:
        if not path.exists():
            self._text("Not found", code=404)
            return
        self._text(path.read_text(encoding="utf-8"), content_type=content_type)

    def do_GET(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        path = parsed.path

        if path == "/" or path == "/index.html":
            self._serve_file(DASHBOARD_DIR / "index.html", "text/html; charset=utf-8")
            return
        if path == "/app.js":
            self._serve_file(
                DASHBOARD_DIR / "app.js",
                "application/javascript; charset=utf-8",
            )
            return
        if path == "/styles.css":
            self._serve_file(DASHBOARD_DIR / "styles.css", "text/css; charset=utf-8")
            return
        if path == "/favicon.svg":
            self._serve_file(DASHBOARD_DIR / "favicon.svg", "image/svg+xml")
            return
        if path == "/api/status":
            self._json(gather_status_payload())
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
        parsed = urlparse(self.path)
        path = parsed.path
        if path not in {"/api/action/start", "/api/action/stop", "/api/action/refresh"}:
            self._text("Not found", code=404)
            return

        action = path.rsplit("/", 1)[-1]
        result = run_dashboard_action(action)
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
    args = parser.parse_args()

    try:
        host_kind = detect_host_kind()
    except RuntimeError as exc:
        print(f"[dashboard] {exc}")
        raise SystemExit(1) from exc

    server = ThreadingHTTPServer((args.host, args.port), DashboardHandler)
    print(f"[dashboard] serving on http://{args.host}:{args.port}")
    print(f"[dashboard] repo: {REPO_ROOT}")
    print(f"[dashboard] host: {host_kind}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        print("[dashboard] stopped")


if __name__ == "__main__":
    os.chdir(REPO_ROOT)
    main()
