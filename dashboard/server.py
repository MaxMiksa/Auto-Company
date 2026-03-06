#!/usr/bin/env python3
"""Local dashboard server for Auto Company (macOS + Windows + WSL runtime)."""

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

# Detect platform
IS_WINDOWS = platform.system() == "Windows"
IS_MACOS = platform.system() == "Darwin"

if IS_WINDOWS:
    STATUS_SCRIPT = REPO_ROOT / "scripts" / "windows" / "status-win.ps1"
    START_SCRIPT = REPO_ROOT / "scripts" / "windows" / "start-win.ps1"
    STOP_SCRIPT = REPO_ROOT / "scripts" / "windows" / "stop-win.ps1"
elif IS_MACOS:
    STATUS_SCRIPT = REPO_ROOT / "scripts" / "macos" / "status-mac.sh"
    START_SCRIPT = REPO_ROOT / "scripts" / "core" / "auto-loop.sh"
    STOP_SCRIPT = REPO_ROOT / "scripts" / "core" / "stop-loop.sh"
else:
    # WSL/Linux fallback
    STATUS_SCRIPT = REPO_ROOT / "scripts" / "core" / "monitor.sh"
    START_SCRIPT = REPO_ROOT / "scripts" / "core" / "auto-loop.sh"
    STOP_SCRIPT = REPO_ROOT / "scripts" / "core" / "stop-loop.sh"

LOG_FILE = REPO_ROOT / "logs" / "auto-loop.log"
STATE_FILE = REPO_ROOT / ".auto-loop-state"
CONSENSUS_FILE = REPO_ROOT / "memories" / "consensus.md"


def ps_quote(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def run_powershell_script(script_path: Path, args: list[str] | None = None, timeout: int = 90) -> dict[str, Any]:
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


def run_shell_script(script_path: Path, args: list[str] | None = None, timeout: int = 90) -> dict[str, Any]:
    """Run a shell script (macOS/Linux)."""
    cmd = [str(script_path)]
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


def run_status_script(timeout: int = 90) -> dict[str, Any]:
    """Run the appropriate status script for the current platform."""
    if IS_WINDOWS:
        return run_powershell_script(STATUS_SCRIPT, timeout=timeout)
    else:
        return run_shell_script(STATUS_SCRIPT, timeout=timeout)


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


def parse_status_output(raw: str) -> dict[str, Any]:
    section_re = re.compile(r"^=== (.+) ===$")
    sections: dict[str, list[str]] = {}
    current = None

    for line in raw.splitlines():
        line = line.rstrip("\n")
        m = section_re.match(line.strip())
        if m:
            current = m.group(1)
            sections[current] = []
            continue
        if current is not None:
            sections[current].append(line)

    parsed: dict[str, Any] = {
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

    # === Windows Guardian ===
    guardian_rows = sections.get("Windows Guardian", [])
    guardian_line = next((x.strip() for x in guardian_rows if x.strip().startswith("Awake guardian:")), "")
    parsed["guardian"]["raw"] = "\n".join(guardian_rows).strip()
    if guardian_line:
        parsed["guardian"]["raw"] = guardian_line
        if "RUNNING" in guardian_line:
            parsed["guardian"]["state"] = "running"
            pid_m = re.search(r"PID (\d+)", guardian_line)
            parsed["guardian"]["pid"] = int(pid_m.group(1)) if pid_m else None
        elif "STOPPED" in guardian_line:
            parsed["guardian"]["state"] = "stopped"

    # === macOS Guardian ===
    macos_guardian_rows = sections.get("macOS Guardian", [])
    if macos_guardian_rows:
        guardian_line = next((x.strip() for x in macos_guardian_rows if x.strip().startswith("Guardian:")), "")
        parsed["guardian"]["raw"] = "\n".join(macos_guardian_rows).strip()
        if guardian_line:
            parsed["guardian"]["raw"] = guardian_line
            if "RUNNING" in guardian_line:
                parsed["guardian"]["state"] = "running"
                pid_m = re.search(r"PID (\d+)", guardian_line)
                parsed["guardian"]["pid"] = int(pid_m.group(1)) if pid_m else None
            elif "STOPPED" in guardian_line:
                parsed["guardian"]["state"] = "stopped"

    # === Windows Autostart ===
    autostart_rows = sections.get("Windows Autostart Task", [])
    autostart_line = next((x.strip() for x in autostart_rows if x.strip().startswith("Autostart:")), "")
    parsed["autostart"]["raw"] = "\n".join(autostart_rows).strip()
    if autostart_line:
        parsed["autostart"]["raw"] = autostart_line
        if "NOT CONFIGURED" in autostart_line:
            parsed["autostart"]["state"] = "not_configured"
        elif "CONFIGURED" in autostart_line:
            parsed["autostart"]["state"] = "configured"
        else:
            parsed["autostart"]["state"] = "unknown"

    # === macOS Daemon (launchd) ===
    macos_daemon_rows = sections.get("macOS Daemon (launchd)", [])
    if macos_daemon_rows:
        parsed["daemon"]["raw"] = "\n".join(macos_daemon_rows).strip()
        daemon_compact = [x.strip() for x in macos_daemon_rows if x.strip()]
        if daemon_compact:
            first = daemon_compact[0]
            if "NOT LOADED" in first:
                parsed["daemon"]["state"] = "not_loaded"
            elif "PAUSED" in first:
                parsed["daemon"]["state"] = "paused"
            elif "ACTIVE" in first:
                parsed["daemon"]["state"] = "active"
                # Try to extract PID from launchctl output
                for row in daemon_compact:
                    if "PID" in row:
                        pid_m = re.search(r"(\d+)", row)
                        if pid_m:
                            parsed["daemon"]["mainPid"] = int(pid_m.group(1))
            else:
                parsed["daemon"]["state"] = first.lower()

    # === WSL Daemon (systemd --user) ===
    daemon_rows = sections.get("WSL Daemon (systemd --user)", [])
    if daemon_rows and not parsed["daemon"]["raw"]:
        parsed["daemon"]["raw"] = "\n".join(daemon_rows).strip()
        daemon_compact = [x.strip() for x in daemon_rows if x.strip()]
        if daemon_compact:
            first = daemon_compact[0]
            if "not installed" in first.lower():
                parsed["daemon"]["state"] = "not_installed"
            elif first in {"active", "inactive", "activating", "failed"}:
                parsed["daemon"]["state"] = first
            for row in daemon_compact:
                if row.startswith("MainPID="):
                    val = row.split("=", 1)[1].strip()
                    parsed["daemon"]["mainPid"] = int(val) if val.isdigit() else None
                elif row.startswith("ActiveState="):
                    parsed["daemon"]["activeState"] = row.split("=", 1)[1].strip()
                elif row.startswith("SubState="):
                    parsed["daemon"]["subState"] = row.split("=", 1)[1].strip()

    # === Loop Status ===
    loop_rows = sections.get("Loop Status (scripts/core/monitor.sh)") or sections.get("Loop Status (monitor.sh)", []) or sections.get("Loop Status", [])
    loop_status_rows = sections.get("Auto Company Status", [])
    merged_loop_rows = list(loop_rows) + list(loop_status_rows)
    parsed["loop"]["raw"] = "\n".join(merged_loop_rows).strip()
    loop_compact = [x.strip() for x in merged_loop_rows if x.strip()]
    for row in loop_compact:
        if row.startswith("Loop:"):
            if "RUNNING" in row:
                parsed["loop"]["state"] = "running"
                pid_m = re.search(r"PID (\d+)", row)
                parsed["loop"]["pid"] = int(pid_m.group(1)) if pid_m else None
            elif "NOT RUNNING" in row or "STOPPED" in row:
                parsed["loop"]["state"] = "stopped"
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

    # === State File (cross-platform) ===
    state_file_rows = sections.get("State File", [])
    if state_file_rows:
        for row in state_file_rows:
            if "=" in row:
                k, v = row.split("=", 1)
                k = k.strip()
                v = v.strip()
                if k == "LOOP_COUNT":
                    parsed["loop"]["loopCount"] = v
                elif k == "ERROR_COUNT":
                    parsed["loop"]["errorCount"] = v
                elif k == "LAST_RUN":
                    parsed["loop"]["lastRun"] = v
                elif k == "ENGINE":
                    parsed["loop"]["engine"] = v
                elif k == "MODEL":
                    parsed["loop"]["model"] = v

    consensus_rows = sections.get("Latest Consensus", [])
    parsed["consensusPreview"] = "\n".join(consensus_rows).strip()
    recent_rows = sections.get("Recent Log", [])
    parsed["recentLog"] = "\n".join(recent_rows).strip()

    return parsed


def gather_status_payload() -> dict[str, Any]:
    result = run_status_script(timeout=90)
    parsed = parse_status_output(result["output"])

    state_text = read_text_file(STATE_FILE, "").strip()
    state_pairs: dict[str, str] = {}
    if state_text:
        for row in state_text.splitlines():
            if "=" in row:
                k, v = row.split("=", 1)
                state_pairs[k.strip()] = v.strip()

    return {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "ok": result["ok"],
        "exitCode": result["exitCode"],
        "elapsedMs": result["elapsedMs"],
        "raw": result["output"],
        "parsed": parsed,
        "stateFile": state_pairs,
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

    def _text(self, text: str, code: int = 200, content_type: str = "text/plain; charset=utf-8") -> None:
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
            self._serve_file(DASHBOARD_DIR / "app.js", "application/javascript; charset=utf-8")
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
            lines = int(qs.get("lines", ["180"])[0])
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

        if path.endswith("/start"):
            res = run_shell_script(START_SCRIPT, timeout=120) if not IS_WINDOWS else run_powershell_script(START_SCRIPT, timeout=120)
        elif path.endswith("/stop"):
            res = run_shell_script(STOP_SCRIPT, timeout=120) if not IS_WINDOWS else run_powershell_script(STOP_SCRIPT, timeout=120)
        else:
            res = run_status_script(timeout=90)

        payload = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "action": path.rsplit("/", 1)[-1],
            "ok": res["ok"],
            "exitCode": res["exitCode"],
            "elapsedMs": res["elapsedMs"],
            "output": res["output"],
        }
        self._json(payload, code=HTTPStatus.OK if res["ok"] else HTTPStatus.BAD_REQUEST)

    def log_message(self, fmt: str, *args: Any) -> None:  # noqa: A003
        # Keep console noise low for dashboard usage.
        _ = (fmt, args)


def main() -> None:
    parser = argparse.ArgumentParser(description="Auto Company web dashboard server")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8787)
    args = parser.parse_args()

    server = ThreadingHTTPServer((args.host, args.port), DashboardHandler)
    print(f"[dashboard] serving on http://{args.host}:{args.port}")
    print(f"[dashboard] repo: {REPO_ROOT}")
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
