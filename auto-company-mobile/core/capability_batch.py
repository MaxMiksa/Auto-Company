"""Bounded, policy-gated batch execution for capability commands.

This is deliberately opt-in and does not execute anything through
``CapabilityRegistry`` itself.  Each command is checked by the canonical
``ExecutionPolicy`` before it reaches :class:`SandboxRunner`.
"""
from __future__ import annotations

from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Any, Sequence
import json
import time
import re

from core.canonical_contracts import ExecutionPolicy, PolicyVerdict, Task
from core.sandbox import SandboxRunner
from core.checkpoint_store import CheckpointStore


@dataclass(frozen=True)
class BatchCommand:
    command: str
    task_id: str
    project_id: str
    cwd: Path
    timeout_seconds: int | None = None


@dataclass(frozen=True)
class BatchResult:
    task_id: str
    status: str
    exit_code: int | None = None
    stdout: str = ""
    stderr: str = ""
    duration_seconds: float = 0.0
    reason: str = ""


class CapabilityBatchExecutor:
    """Execute a small serial batch with hard count/time/output bounds."""

    def __init__(self, policy: ExecutionPolicy, *, max_commands: int = 8,
                 max_runtime_seconds: int = 120, max_output_chars: int = 20_000,
                 runner: SandboxRunner | None = None, audit_path: str | Path | None = None,
                 checkpoint_store: CheckpointStore | None = None):
        if isinstance(max_commands, bool) or max_commands < 1:
            raise ValueError("max_commands must be positive")
        if isinstance(max_runtime_seconds, bool) or max_runtime_seconds < 1:
            raise ValueError("max_runtime_seconds must be positive")
        if isinstance(max_output_chars, bool) or max_output_chars < 1:
            raise ValueError("max_output_chars must be positive")
        self.policy = policy
        self.max_commands = max_commands
        self.max_runtime_seconds = max_runtime_seconds
        self.max_output_chars = max_output_chars
        self.runner = runner or SandboxRunner(max_runtime_s=max_runtime_seconds)
        self.audit: list[dict[str, Any]] = []
        self.audit_path = Path(audit_path).expanduser() if audit_path else None
        self.checkpoint_store = checkpoint_store
        if self.audit_path:
            self.audit_path.parent.mkdir(parents=True, exist_ok=True)

    def execute(self, commands: Sequence[BatchCommand]) -> tuple[BatchResult, ...]:
        if len(commands) > self.max_commands:
            raise ValueError("batch exceeds max_commands")
        started = time.monotonic()
        results: list[BatchResult] = []
        for item in commands:
            if time.monotonic() - started >= self.max_runtime_seconds:
                result = BatchResult(item.task_id, "timeout", -1, reason="batch runtime limit")
                results.append(result); self._record(item, result); continue
            if not item.cwd.exists():
                result = BatchResult(item.task_id, "denied", reason="cwd does not exist")
                decision = self.policy.decide_execution(
                    Task(item.task_id, item.project_id, item.command), cwd=item.cwd)
                results.append(result); self._record(item, result, decision); continue
            if not self.policy.path_allowed(item.cwd):
                result = BatchResult(item.task_id, "denied", reason="cwd outside allowed root")
                decision = self.policy.decide_execution(
                    Task(item.task_id, item.project_id, item.command), cwd=item.cwd)
                results.append(result); self._record(item, result, decision); continue
            task = Task(item.task_id, item.project_id, item.command)
            decision = self.policy.decide_execution(task, cwd=item.cwd)
            if decision.verdict is not PolicyVerdict.ALLOW:
                status = "denied" if decision.verdict is PolicyVerdict.DENY else "deferred"
                result = BatchResult(item.task_id, status, reason=decision.reason)
                results.append(result); self._record(item, result, decision); continue
            remaining = max(1, int(self.max_runtime_seconds - (time.monotonic() - started)))
            timeout = min(item.timeout_seconds or remaining, remaining)
            code, out, err, duration = self.runner.run(item.command, timeout=timeout, cwd=str(item.cwd))
            out, err = out[:self.max_output_chars], err[:self.max_output_chars]
            status = "succeeded" if code == 0 else ("timeout" if code == -1 else "failed")
            result = BatchResult(item.task_id, status, code, out, err, duration)
            results.append(result); self._record(item, result, decision)
        return tuple(results)

    def _record(self, item: BatchCommand, result: BatchResult,
                decision: Any = None) -> None:
        result_payload = asdict(result)
        result_payload["stdout"] = self._redact(result_payload.get("stdout", ""))
        result_payload["stderr"] = self._redact(result_payload.get("stderr", ""))
        result_payload["reason"] = self._redact(result_payload.get("reason", ""))
        record = {"timestamp": time.time(), "task_id": item.task_id,
                           "project_id": item.project_id,
                           "command": self._redact(item.command),
                           "cwd": str(item.cwd), "result": result_payload}
        # Record the pre-execution intent gate as a first-class receipt.  This
        # lets reviewers distinguish a policy denial/defer from a process
        # failure, following the upstream harness principle that the action
        # should be inspectable before (and independently of) its outcome.
        if decision is not None:
            record["policy"] = {
                "verdict": getattr(getattr(decision, "verdict", None), "value",
                                    str(getattr(decision, "verdict", ""))),
                "reason": self._redact(str(getattr(decision, "reason", ""))),
            }
            if self.checkpoint_store is not None:
                # The durable receipt is deliberately written alongside the
                # volatile JSONL audit. It remains queryable after restart and
                # can be joined to subsequent canonical evidence by task_id.
                self.checkpoint_store.record_policy_decision(
                    item.task_id, item.project_id,
                    record["policy"]["verdict"], record["policy"]["reason"],
                    "verified" if result.status == "succeeded" else
                    ("blocked" if result.status in {"denied", "deferred", "failed", "timeout"} else "pending"),
                )
        self.audit.append(record)
        if self.audit_path:
            with self.audit_path.open("a", encoding="utf-8") as stream:
                stream.write(json.dumps(record, sort_keys=True, default=str) + "\n")

    @staticmethod
    def _redact(value: str) -> str:
        value = re.sub(r"(?i)(api[_-]?key|token|password|secret)\s*=\s*[^\s]+",
                       r"\1=[REDACTED]", value)
        return re.sub(r"(?i)(--(?:api[-_]?key|token|password|secret))\s+[^\s]+",
                      r"\1 [REDACTED]", value)

    def audit_json(self) -> str:
        return json.dumps(self.audit, sort_keys=True, default=str)

    @staticmethod
    def load_audit(path: str | Path, *, max_records: int = 10_000) -> tuple[dict[str, Any], ...]:
        """Read bounded JSONL audit records without executing or mutating state."""
        if isinstance(max_records, bool) or max_records < 1:
            raise ValueError("max_records must be positive")
        records: list[dict[str, Any]] = []
        with Path(path).expanduser().open("r", encoding="utf-8") as stream:
            for line in stream:
                if len(records) >= max_records:
                    break
                try:
                    value = json.loads(line)
                except (TypeError, ValueError):
                    continue
                if isinstance(value, dict):
                    records.append(value)
        return tuple(records)
