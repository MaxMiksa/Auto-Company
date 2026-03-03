#!/usr/bin/env python3
"""Local dashboard server for Auto Company on macOS."""

from __future__ import annotations

import argparse
import json
import os
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

STATUS_SCRIPT = REPO_ROOT / "scripts" / "core" / "monitor.sh"
START_SCRIPT = REPO_ROOT / "scripts" / "macos" / "install-daemon.sh"
STOP_SCRIPT = REPO_ROOT / "scripts" / "core" / "stop-loop.sh"

LOG_FILE = REPO_ROOT / "logs" / "auto-loop.log"
STATE_FILE = REPO_ROOT / ".auto-loop-state"
CONSENSUS_FILE = REPO_ROOT / "memories" / "consensus.md"
PID_FILE = REPO_ROOT / ".auto-loop.pid"


def run_shell(script_path: Path, args: list[str] | None = None, timeout: int = 90) -> dict[str, Any]:
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


def read_text_file(path: Path, fallback: str = "") -> str:
    try:
        raw = path.read_bytes()
    except FileNotFoundError:
        return fallback
    except Exception as exc:
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


def detect_caffeinate_guard(loop_pid: int | None) -> tuple[str, int | None, str]:
    if loop_pid is None:
        return ("stopped", None, "Sleep guard: loop pid unknown")

    # Try to detect a caffeinate process tied to this loop pid.
    cmd = ["pgrep", "-f", f"caffeinate.*-w {loop_pid}"]
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=3)
        pids = [x.strip() for x in (proc.stdout or "").splitlines() if x.strip().isdigit()]
        if pids:
            return ("running", int(pids[0]), f"caffeinate -w {loop_pid}")
    except Exception:
        pass

    return ("stopped", None, "Sleep guard: not active (use make start-awake)")


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
        "platform": "macos",
        "guardian": {"state": "unknown", "pid": None, "raw": "Sleep guard: unknown"},
        "autostart": {"state": "unknown", "raw": "Autostart: launchd"},
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

    loop_rows = sections.get("Auto Company Status", [])
    parsed["loop"]["raw"] = "\n".join(loop_rows).strip()
    loop_compact = [x.strip() for x in loop_rows if x.strip()]

    for row in loop_compact:
        if row.startswith("Loop:"):
            if "RUNNING" in row:
                parsed["loop"]["state"] = "running"
                pid_m = re.search(r"PID (\d+)", row)
                parsed["loop"]["pid"] = int(pid_m.group(1)) if pid_m else None
            elif "NOT RUNNING" in row or "STOPPED" in row:
                parsed["loop"]["state"] = "stopped"
        elif row.startswith("Daemon:"):
            daemon_summary = row.replace("Daemon:", "", 1).strip()
            parsed["loop"]["daemonSummary"] = daemon_summary
            parsed["daemon"]["raw"] = row
            upper = daemon_summary.upper()
            if "LOADED" in upper or "ACTIVE" in upper:
                parsed["daemon"]["state"] = "active"
                parsed["daemon"]["activeState"] = "loaded"
                parsed["autostart"]["state"] = "configured"
                parsed["autostart"]["raw"] = "Autostart: launchd agent loaded"
            elif "PAUSED" in upper or "NOT LOADED" in upper:
                parsed["daemon"]["state"] = "inactive"
                parsed["daemon"]["activeState"] = "inactive"
                parsed["autostart"]["state"] = "not_configured"
                parsed["autostart"]["raw"] = "Autostart: launchd agent not loaded"
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

    guard_state, guard_pid, guard_raw = detect_caffeinate_guard(parsed["loop"].get("pid"))
    parsed["guardian"] = {"state": guard_state, "pid": guard_pid, "raw": guard_raw}

    if parsed["autostart"]["state"] == "unknown":
        parsed["autostart"]["state"] = "not_configured"
        parsed["autostart"]["raw"] = "Autostart: launchd status unknown"

    consensus_rows = sections.get("Latest Consensus", [])
    parsed["consensusPreview"] = "\n".join(consensus_rows).strip()
    recent_rows = sections.get("Recent Log", [])
    parsed["recentLog"] = "\n".join(recent_rows).strip()

    return parsed


def gather_status_payload() -> dict[str, Any]:
    result = run_shell(STATUS_SCRIPT, args=["--status"], timeout=90)
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

    def do_GET(self) -> None:
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

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        path = parsed.path
        if path not in {"/api/action/start", "/api/action/stop", "/api/action/refresh"}:
            self._text("Not found", code=404)
            return

        if path.endswith("/start"):
            res = run_shell(START_SCRIPT, timeout=120)
        elif path.endswith("/stop"):
            res = run_shell(STOP_SCRIPT, args=["--pause-daemon"], timeout=120)
        else:
            res = run_shell(STATUS_SCRIPT, args=["--status"], timeout=90)

        payload = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "action": path.rsplit("/", 1)[-1],
            "ok": res["ok"],
            "exitCode": res["exitCode"],
            "elapsedMs": res["elapsedMs"],
            "output": res["output"],
        }
        self._json(payload, code=HTTPStatus.OK if res["ok"] else HTTPStatus.BAD_REQUEST)

    def log_message(self, fmt: str, *args: Any) -> None:
        _ = (fmt, args)


def main() -> None:
    parser = argparse.ArgumentParser(description="Auto Company web dashboard server (macOS)")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8787)
    args = parser.parse_args()

    server = ThreadingHTTPServer((args.host, args.port), DashboardHandler)
    print(f"[dashboard-macos] serving on http://{args.host}:{args.port}")
    print(f"[dashboard-macos] repo: {REPO_ROOT}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        print("[dashboard-macos] stopped")


if __name__ == "__main__":
    os.chdir(REPO_ROOT)
    main()
