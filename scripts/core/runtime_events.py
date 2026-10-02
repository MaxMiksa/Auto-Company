"""Observe Codex JSONL without interpreting prose or changing engine results.

The normal cycle supervisor owns this process and its CLI child. Only this
cycle's thread ID can resolve session metadata. Local rollout format is an
optional capability: absent/unrecognized data remains unknown.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone, timedelta
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import sys

LIMIT = 256 * 1024
IDENTITY = re.compile(r"[A-Za-z0-9][A-Za-z0-9_-]{0,127}\Z")
THREAD = re.compile(r"[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\Z")


def now():
    return datetime.now(timezone.utc).isoformat()


def bounded_text(value, limit=1000):
    if not isinstance(value, str):
        return ""
    for name, secret in os.environ.items():
        if secret and len(secret) >= 4 and any(part in name.upper() for part in ("TOKEN", "SECRET", "PASSWORD", "API_KEY", "AUTH_TOKEN")):
            value = value.replace(secret, "[REDACTED]")
    value = re.sub(r"(?i)(Bearer\s+)\S+", r"\1[REDACTED]", value)
    return value[:limit]


def observed_config(home, thread, root):
    if not THREAD.fullmatch(thread):
        return None
    # Exec starts a fresh thread. Search only adjacent UTC days, bounded files
    # and bytes, never all transcripts or a guessed 'latest' conversation.
    for offset in (0, -1, 1):
        day = datetime.now(timezone.utc) + timedelta(days=offset)
        folder = home / "sessions" / day.strftime("%Y/%m/%d")
        for path in list(folder.glob(f"*{thread}.jsonl"))[:2]:
            if path.is_symlink():
                continue
            try:
                with path.open("rb") as source:
                    raw = source.read(2 * 1024 * 1024)
                identity_ok = False
                for line in raw.splitlines():
                    try:
                        item = json.loads(line)
                    except (ValueError, RecursionError):
                        continue
                    if not isinstance(item, dict) or not isinstance(item.get("payload"), dict):
                        continue
                    payload = item["payload"]
                    if item.get("type") == "session_meta":
                        identity_ok = payload.get("id") == thread and Path(payload.get("cwd", "")).resolve() == root.resolve()
                    if identity_ok and item.get("type") == "turn_context" and Path(payload.get("cwd", "")).resolve() == root.resolve():
                        model, effort = payload.get("model"), payload.get("effort")
                        if isinstance(model, str) and isinstance(effort, str) and effort in {"none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"}:
                            return {"model": bounded_text(model, 200), "reasoning": effort, "source": "session_context", "threadId": thread}
            except (OSError, ValueError, TypeError):
                continue
    return None


class Recorder:
    def __init__(self, root, cycle, home=None):
        if not IDENTITY.fullmatch(cycle):
            raise ValueError("Invalid cycle ID")
        self.root, self.cycle = Path(root).resolve(), cycle
        self.home = Path(home or os.environ.get("CODEX_HOME") or Path.home() / ".codex")
        self.path = self.root / "logs" / f"{cycle}.events.jsonl"
        self.sequence = 0
        self.thread = ""
        self.configured = False
        self.bytes = 0
        self.dropped = 0

    def emit(self, kind, **fields):
        # The stream has one writer and unique cycle ownership. A partial final
        # line is ignored by readers; observation failure never kills the CLI.
        if self.sequence >= 2000 or self.bytes >= 2 * 1024 * 1024:
            self.dropped += 1
            return
        self.sequence += 1
        item = {"version": 1, "cycleId": self.cycle, "sequence": self.sequence,
                "observedAt": now(), "kind": kind, **fields}
        raw = (json.dumps(item, ensure_ascii=False) + "\n").encode()
        try:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            if self.path.is_symlink() or self.path.parent.is_symlink():
                return
            with self.path.open("ab") as target:
                target.write(raw)
            self.bytes += len(raw)
        except OSError:
            self.dropped += 1

    def metadata(self):
        if self.thread and not self.configured:
            config = observed_config(self.home, self.thread, self.root)
            if config:
                self.emit("session.config", **config)
                self.configured = True

    def ingest(self, raw):
        try:
            value = json.loads(raw)
        except (ValueError, RecursionError):
            self.dropped += 1
            return
        if not isinstance(value, dict):
            self.dropped += 1
            return
        kind = value.get("type")
        if not isinstance(kind, str):
            self.dropped += 1
            return
        if kind == "thread.started" and isinstance(value.get("thread_id"), str) and THREAD.fullmatch(value["thread_id"]):
            self.thread = value["thread_id"]
            self.emit(kind, threadId=self.thread)
        elif kind in {"turn.started", "turn.completed", "turn.failed", "error"}:
            self.emit(kind)
        elif kind in {"item.started", "item.updated", "item.completed"}:
            item = value.get("item")
            if isinstance(item, dict):
                item_type = item.get("type")
                fields = {"itemId": bounded_text(item.get("id"), 120), "phase": kind.split(".")[1]}
                if item_type == "command_execution":
                    code = item.get("exit_code")
                    self.emit("command", **fields, command=bounded_text(item.get("command")),
                              commandTruncated=len(bounded_text(item.get("command"), 1001)) > 1000,
                              exitCode=code if type(code) is int else None)
                elif item_type == "file_change":
                    changes = item.get("changes")
                    paths = [bounded_text(row.get("path"), 300) for row in changes[:30] if isinstance(row, dict)] if isinstance(changes, list) else []
                    self.emit("files", **fields, paths=paths)
                elif item_type == "agent_message" and kind == "item.completed":
                    self.emit("report", **fields, text=bounded_text(item.get("text"), 3000), source="agent_report")
                # Reasoning and tool output are deliberately not projected.
        self.metadata()


def run(root, cycle, command):
    from project_isolation import inside_boundary
    if not inside_boundary():
        raise ValueError("Engine observation may only launch commands inside project isolation")
    recorder = Recorder(root, cycle)
    recorder.emit("process.started")
    stopping = False

    def stop(_sig, _frame):
        nonlocal stopping
        stopping = True
        # The enclosing supervisor signals the complete owned process tree.

    for sig in (signal.SIGTERM, signal.SIGINT):
        signal.signal(sig, stop)
    child = subprocess.Popen(command, stdout=subprocess.PIPE)
    skipping = False
    while True:
        chunk = child.stdout.readline(LIMIT + 1)
        if not chunk:
            break
        sys.stdout.buffer.write(chunk)
        sys.stdout.buffer.flush()
        complete = chunk.endswith(b"\n")
        if not skipping and len(chunk) <= LIMIT and complete:
            recorder.ingest(chunk)
        elif not skipping:
            recorder.dropped += 1
        skipping = not complete
    child.stdout.close()
    code = child.wait()
    recorder.metadata()
    recorder.emit("process.exited", exitCode=code, interrupted=stopping, dropped=recorder.dropped)
    return code if code >= 0 else 128 - code


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", required=True)
    parser.add_argument("--cycle", required=True)
    parser.add_argument("command", nargs=argparse.REMAINDER)
    args = parser.parse_args()
    command = args.command[1:] if args.command[:1] == ["--"] else args.command
    if not command:
        parser.error("command required")
    raise SystemExit(run(args.root, args.cycle, command))
