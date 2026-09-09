"""Stable domain contracts for the next Auto-Company runtime.

Stdlib-only and intentionally independent of providers, UI, and shell runners.
"""
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Optional, Tuple
import uuid
import shlex


class TaskStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    VERIFYING = "verifying"
    VERIFIED = "verified"
    BLOCKED = "blocked"
    NEEDS_HUMAN = "needs_human"


class PolicyVerdict(str, Enum):
    ALLOW = "allow"
    DENY = "deny"
    ESCALATE = "escalate"
    DEFER = "defer"


@dataclass(frozen=True)
class Project:
    project_id: str
    workspace: Path
    lifecycle_phase: str = "discovery"


@dataclass(frozen=True)
class Task:
    task_id: str
    project_id: str
    action: str
    verification: Tuple[str, ...] = ()
    idempotency_key: str = field(default_factory=lambda: uuid.uuid4().hex)
    status: TaskStatus = TaskStatus.PENDING
    depends_on: Tuple[str, ...] = ()
    note: str = ""
    mission_id: str = ""
    run_id: str = ""
    requires_isolation: bool = False

    def __post_init__(self) -> None:
        # Reject malformed envelopes before they can reach the durable queue.
        # Whitespace-only shell commands are not meaningful canonical work.
        for name in ("task_id", "project_id", "action"):
            value = getattr(self, name)
            if not isinstance(value, str) or not value.strip():
                raise ValueError(f"task {name} must be non-empty text")
        if isinstance(self.verification, (str, bytes)):
            raise ValueError("task verification must be a sequence of commands")
        for command in self.verification:
            if not isinstance(command, str) or not command.strip():
                raise ValueError("task verification commands must be non-empty text")


_MUTATING_ACTION_PREFIXES = (
    "write", "edit", "delete", "remove", "create", "deploy",
    "push", "commit", "publish", "release", "build", "generate",
)


def infer_isolation(action: str) -> bool:
    """Heuristic: return True if the action string looks mutating."""
    lowered = action.lower()
    return any(lowered.startswith(prefix) for prefix in _MUTATING_ACTION_PREFIXES)


def requires_human_approval(action: str) -> bool:
    """Conservative gate for commands that can mutate a workspace."""
    try:
        token = shlex.split(action)[0].lower()
    except (ValueError, IndexError):
        return True
    return token.rsplit("/", 1)[-1] in {
        "touch", "mkdir", "rmdir", "rm", "mv", "cp", "install", "tee",
        "sed", "perl", "python", "python3", "node", "npm", "git",
        "flutter", "dart", "gradle", "mvn", "cargo", "go", "make",
    }


@dataclass(frozen=True)
class PolicyDecision:
    verdict: PolicyVerdict
    reason: str
    task_id: str
    project_id: str
    workspace: Path


@dataclass(frozen=True)
class ExecutionPolicy:
    allowed_root: Path
    allow_network: bool = False

    def decide(self, task: Task) -> PolicyDecision:
        """Return the hard gate verdict before any executor is reached."""
        if task.project_id == "":
            return PolicyDecision(PolicyVerdict.DENY, "missing project", task.task_id,
                                  task.project_id, self.allowed_root)
        if task.status is TaskStatus.NEEDS_HUMAN:
            return PolicyDecision(PolicyVerdict.DEFER, "human approval required", task.task_id,
                                  task.project_id, self.allowed_root)
        if not self.command_allowed(task.action):
            return PolicyDecision(PolicyVerdict.DENY, "action rejected by execution policy",
                                  task.task_id, task.project_id, self.allowed_root)
        for command in task.verification:
            if not self.command_allowed(command):
                return PolicyDecision(PolicyVerdict.DENY,
                                      "verification rejected by execution policy",
                                      task.task_id, task.project_id, self.allowed_root)
        return PolicyDecision(PolicyVerdict.ALLOW, "policy checks passed", task.task_id,
                              task.project_id, self.allowed_root)

    def decide_execution(self, task: Task, *, cwd: Optional[Path] = None) -> PolicyDecision:
        """Single pre-execution gate shared by every command runner.

        Callers must inspect the returned verdict before invoking a runner.  The
        method deliberately performs no side effects and treats a workspace
        escape as a deny, while preserving ``NEEDS_HUMAN`` as defer.
        """
        decision = self.decide(task)
        if decision.verdict is not PolicyVerdict.ALLOW:
            return decision
        execution_cwd = self.allowed_root if cwd is None else Path(cwd)
        if not self.path_allowed(execution_cwd):
            return PolicyDecision(PolicyVerdict.DENY, "execution cwd outside allowed root",
                                  task.task_id, task.project_id, self.allowed_root)
        return decision

    def decide_command(self, command: str, *, task_id: str = "command",
                       project_id: str = "", cwd: Optional[Path] = None) -> PolicyDecision:
        """Build a policy decision for ad-hoc commands (e.g. verification)."""
        task = Task(task_id, project_id or "policy", command)
        return self.decide_execution(task, cwd=cwd)

    def path_allowed(self, path: Path) -> bool:
        root, candidate = self.allowed_root.resolve(), path.resolve()
        return candidate == root or root in candidate.parents

    def command_allowed(self, command: str) -> bool:
        if not isinstance(command, str) or not command.strip():
            return False
        # Canonical execution is argv-only.  Reject every shell control
        # character/operator before a command can reach an executor.  This is
        # deliberately stricter than a deny-list: shell syntax must never be
        # interpreted by a canonical task, even when nested in quotes.
        if any(ord(char) < 32 or ord(char) == 127 for char in command):
            return False
        # Parentheses are valid arguments (notably Python ``-c`` snippets)
        # and are harmless once the command is executed argv-only.  Keep
        # actual shell composition/expansion operators blocked.
        if any(op in command for op in (";", "&&", "||", "|", "`", "$", ">", "<", "\\")):
            return False
        try:
            argv = shlex.split(command, posix=True)
        except ValueError:
            return False
        if not argv or any(not item for item in argv):
            return False
        # Never allow an alternate shell/interpreter entry point to smuggle a
        # second command through an otherwise argv-only runner.  Merely
        # rejecting shell metacharacters is insufficient for e.g.
        # ``/bin/sh -c 'touch escaped'`` or ``python -c ...``.
        executable = argv[0].rsplit("/", 1)[-1].lower()
        if "/" in argv[0] or executable in {
            "sh", "bash", "dash", "zsh", "fish", "csh", "tcsh",
            "ksh", "ash", "busybox", "cmd", "cmd.exe", "powershell",
            "pwsh", "wsl", "python", "python3", "pypy", "node",
            "perl", "ruby", "php",
        }:
            return False
        if any(item.lower() in {"-c", "--command", "/c", "-command"} for item in argv[1:]):
            return False
        # Canonical task paths are workspace-relative.  Reject absolute and
        # home-relative operands so a harmless-looking verifier such as
        # ``cat /etc/passwd`` cannot escape the policy-bound workspace.
        if any(
            item.startswith("~")
            or Path(item).is_absolute()
            # A relative ``..`` operand is still an escape from the policy
            # workspace once the command is run with cwd=allowed_root.  Do
            # not rely on lexical normalization here: the child process may
            # resolve the path differently (symlinks, deleted directories),
            # so fail closed before it reaches an executor.
            or ".." in Path(item).parts
            for item in argv[1:]
        ):
            return False
        if not self.allow_network and (
            executable in {"curl", "wget", "nc", "ncat", "netcat", "socat", "ftp", "sftp", "ssh", "scp", "telnet"}
            or (executable == "git" and any(item in {"clone", "fetch", "pull", "push", "ls-remote"} for item in argv[1:]))
            or (executable in {"npm", "pnpm", "yarn", "pip", "pip3", "cargo"} and any(item in {"install", "add", "publish", "push"} for item in argv[1:]))
        ):
            return False
        return True


@dataclass(frozen=True)
class Action:
    operation: str
    relative_paths: Tuple[str, ...] = ()
    command: Optional[str] = None
    timeout_seconds: int = 30


@dataclass(frozen=True)
class Observation:
    exit_code: int
    stdout: str = ""
    stderr: str = ""
    changed_files: Tuple[str, ...] = ()

    @property
    def success(self) -> bool:
        return self.exit_code == 0


@dataclass(frozen=True)
class Evidence:
    task_id: str
    project_id: str
    idempotency_key: str
    status: TaskStatus
    observation: Observation
    artifact: Optional[str] = None
    critic_reason: Optional[str] = None
    recovered: bool = False
    # Provider lifecycle audit (model id, load/unload state and latency).
    # Kept optional for backwards compatibility with existing evidence.
    model_metadata: Optional[dict] = None
    mission_id: str = ""
    run_id: str = ""
    attempt_id: str = ""
    provider_call_id: str = ""


@dataclass(frozen=True)
class Checkpoint:
    task_id: str
    status: TaskStatus
    evidence_digest: Optional[str] = None
    version: int = 1
