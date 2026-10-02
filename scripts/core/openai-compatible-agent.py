#!/usr/bin/env python3
"""Minimal, sandbox-aware agent loop for OpenAI-compatible chat endpoints."""

from __future__ import annotations

import argparse
import ipaddress
import json
import math
import os
import shlex
import shutil
import subprocess
import sys
import urllib.error
import urllib.request
from urllib.parse import urlsplit
from pathlib import Path
from typing import Any


SECRET_ENV_NAMES = (
    "OPENAI_COMPATIBLE_API_KEY",
    "OPENAI_API_KEY",
    "CODEX_API_KEY",
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_AUTH_TOKEN",
    "CURSOR_API_KEY",
)
DEFAULT_SAFE_COMMANDS = (
    "git status --short",
    "git diff --no-ext-diff --no-textconv --stat",
    "git diff --cached --no-ext-diff --no-textconv --stat",
    "git log -n 20 --oneline",
    "git rev-parse --show-toplevel",
    "rg --files",
)
SENSITIVE_WORKSPACE_FILE_NAMES = {
    ".auto-loop.env",
    ".envrc",
    ".git-credentials",
    ".netrc",
    ".npmrc",
    ".pypirc",
    ".terraformrc",
    "application_default_credentials.json",
    "auth.json",
    "credentials.json",
    "credentials.tfrc.json",
    "id_dsa",
    "id_ecdsa",
    "id_ed25519",
    "id_rsa",
    "kubeconfig",
    "kubeconfig.yaml",
    "kubeconfig.yml",
    "service-account.json",
    "service_account.json",
    "secrets.json",
}
SENSITIVE_WORKSPACE_DIRECTORY_NAMES = {
    ".aws",
    ".azure",
    ".kube",
    ".ssh",
}
SENSITIVE_WORKSPACE_SUFFIXES = {".key", ".p12", ".pem", ".pfx"}
SENSITIVE_WORKSPACE_PATH_PREFIXES = {
    (".config", "gcloud"),
}
SENSITIVE_WORKSPACE_PATHS = {
    (".config", "gh", "hosts.yml"),
    (".config", "glab-cli", "config.yml"),
    (".docker", "config.json"),
    (".terraform.d", "credentials.tfrc.json"),
}
DOTENV_TEMPLATE_SUFFIXES = (".example", ".sample", ".template")


class AdapterError(RuntimeError):
    """Expected adapter failure that should be returned as a safe result."""


class NoRedirectHandler(urllib.request.HTTPRedirectHandler):
    def redirect_request(
        self,
        _req: urllib.request.Request,
        _fp: Any,
        code: int,
        _msg: str,
        _headers: Any,
        _newurl: str,
    ) -> None:
        raise AdapterError(f"HTTP redirect ({code}) is forbidden for authenticated adapter requests")


def redact(value: str) -> str:
    redacted = value
    for name in SECRET_ENV_NAMES:
        secret = os.environ.get(name, "")
        if secret:
            redacted = redacted.replace(secret, "[REDACTED]")
    return redacted


def safe_child_environment() -> dict[str, str]:
    blocked_fragments = ("SECRET", "TOKEN", "PASSWORD", "API_KEY", "AUTHORIZATION")
    blocked_names = {
        "GIT_EXTERNAL_DIFF",
        "GIT_CONFIG",
        "GIT_CONFIG_GLOBAL",
        "GIT_CONFIG_SYSTEM",
    }
    environment = {
        key: value
        for key, value in os.environ.items()
        if key.upper() not in blocked_names
        and not key.upper().startswith("GIT_")
        and key.upper() != "RIPGREP_CONFIG_PATH"
        and not any(fragment in key.upper() for fragment in blocked_fragments)
    }
    environment.update(GIT_CONFIG_NOSYSTEM="1", GIT_CONFIG_GLOBAL=os.devnull, GIT_TERMINAL_PROMPT="0")
    return environment


def contains_path_sequence(parts: tuple[str, ...], sequence: tuple[str, ...]) -> bool:
    width = len(sequence)
    return any(
        parts[index : index + width] == sequence
        for index in range(len(parts) - width + 1)
    )


def is_sensitive_workspace_path(relative: Path) -> bool:
    parts = tuple(part.casefold() for part in relative.parts)
    name = relative.name.casefold()
    suffix = relative.suffix.casefold()

    if any(part in SENSITIVE_WORKSPACE_DIRECTORY_NAMES for part in parts):
        return True
    if name in SENSITIVE_WORKSPACE_FILE_NAMES or suffix in SENSITIVE_WORKSPACE_SUFFIXES:
        return True
    if name == ".env" or (
        name.startswith(".env.") and not name.endswith(DOTENV_TEMPLATE_SUFFIXES)
    ):
        return True
    if any(
        contains_path_sequence(parts, prefix)
        for prefix in SENSITIVE_WORKSPACE_PATH_PREFIXES
    ):
        return True
    return any(contains_path_sequence(parts, path) for path in SENSITIVE_WORKSPACE_PATHS)


def resolve_workspace_path(workspace: Path, raw_path: str) -> Path:
    candidate = Path(raw_path)
    if not candidate.is_absolute():
        candidate = workspace / candidate
    resolved = candidate.resolve()
    try:
        relative = resolved.relative_to(workspace)
    except ValueError as exc:
        raise AdapterError("path is outside the workspace") from exc
    if ".git" in (part.casefold() for part in relative.parts):
        raise AdapterError("protected workspace path is not accessible")
    if is_sensitive_workspace_path(relative):
        raise AdapterError("secret-bearing workspace path is not accessible")
    return resolved


def parse_safe_commands(raw: str) -> tuple[tuple[str, ...], ...]:
    commands: list[tuple[str, ...]] = []
    for item in raw.split(","):
        item = item.strip()
        if not item:
            continue
        parts = tuple(shlex.split(item))
        if not parts or "/" in parts[0] or "\\" in parts[0]:
            raise AdapterError(f"invalid safe command prefix: {item}")
        commands.append(parts)
    if not commands:
        raise AdapterError("safe command list must not be empty")
    return tuple(commands)


def command_is_allowed(argv: list[str], prefixes: tuple[tuple[str, ...], ...]) -> bool:
    return tuple(argv) in prefixes


def run_tool(
    name: str,
    arguments: dict[str, Any],
    workspace: Path,
    safe_commands: tuple[tuple[str, ...], ...],
    allow_shell: bool,
) -> str:
    if name == "read_file":
        path = resolve_workspace_path(workspace, str(arguments.get("path", "")))
        if not path.is_file():
            raise AdapterError("file not found")
        return path.read_text(encoding="utf-8")

    if name == "write_file":
        path = resolve_workspace_path(workspace, str(arguments.get("path", "")))
        content = arguments.get("content")
        if not isinstance(content, str):
            raise AdapterError("write_file content must be a string")
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")
        return f"wrote {path.relative_to(workspace)}"

    if name == "run_command":
        argv = arguments.get("argv")
        if not isinstance(argv, list) or not argv or not all(isinstance(v, str) for v in argv):
            raise AdapterError("run_command argv must be a non-empty string array")
        if "/" in argv[0] or "\\" in argv[0]:
            raise AdapterError("run_command executable must be an allowlisted command name")
        if not command_is_allowed(argv, safe_commands):
            raise AdapterError(f"command is not allowlisted: {shlex.join(argv)}")
        executable = shutil.which(argv[0])
        if executable is None:
            raise AdapterError("allowlisted executable is unavailable")
        try:
            Path(executable).resolve().relative_to(workspace)
        except ValueError:
            pass
        else:
            raise AdapterError("workspace executables cannot implement safe commands")
        command = [executable, *argv[1:]]
        if argv[0] == "git":
            # Even read-only Git commands can run fsmonitor, pagers, and GPG
            # configured by the repository or inherited process environment.
            command = [
                executable, "--no-pager", "-c", "core.fsmonitor=false",
                "-c", "core.hooksPath=" + os.devnull,
                "-c", "log.showSignature=false", *argv[1:],
            ]
        elif argv[0] == "rg":
            command = [executable, "--no-config", *argv[1:]]
        timeout = min(max(int(arguments.get("timeout_seconds", 60)), 1), 300)
        completed = subprocess.run(
            command,
            cwd=workspace,
            env=safe_child_environment(),
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
        )
        return redact(
            json.dumps(
                {
                    "exit_code": completed.returncode,
                    "stdout": completed.stdout,
                    "stderr": completed.stderr,
                },
                ensure_ascii=False,
            )
        )

    if name == "run_shell":
        if not allow_shell:
            raise AdapterError("arbitrary shell is disabled")
        command = arguments.get("command")
        if not isinstance(command, str) or not command.strip():
            raise AdapterError("run_shell command must be a non-empty string")
        timeout = min(max(int(arguments.get("timeout_seconds", 60)), 1), 300)
        completed = subprocess.run(
            ["/bin/bash", "-lc", command],
            cwd=workspace,
            env=safe_child_environment(),
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
        )
        return redact(
            json.dumps(
                {
                    "exit_code": completed.returncode,
                    "stdout": completed.stdout,
                    "stderr": completed.stderr,
                },
                ensure_ascii=False,
            )
        )

    raise AdapterError(f"unsupported tool: {name}")


def tool_definitions(allow_shell: bool) -> list[dict[str, Any]]:
    tools: list[dict[str, Any]] = [
        {
            "type": "function",
            "function": {
                "name": "read_file",
                "description": (
                    "Read an allowed UTF-8 text file inside the workspace; conventional "
                    "credential paths are denied."
                ),
                "parameters": {
                    "type": "object",
                    "properties": {"path": {"type": "string"}},
                    "required": ["path"],
                    "additionalProperties": False,
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "write_file",
                "description": (
                    "Write an allowed UTF-8 text file inside the workspace; conventional "
                    "credential paths are denied."
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "path": {"type": "string"},
                        "content": {"type": "string"},
                    },
                    "required": ["path", "content"],
                    "additionalProperties": False,
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "run_command",
                "description": "Run one exact argv sequence from the configured safe-command list.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "argv": {"type": "array", "items": {"type": "string"}},
                        "timeout_seconds": {"type": "integer", "minimum": 1, "maximum": 300},
                    },
                    "required": ["argv"],
                    "additionalProperties": False,
                },
            },
        },
    ]
    if allow_shell:
        tools.append(
            {
                "type": "function",
                "function": {
                    "name": "run_shell",
                    "description": "Run an arbitrary bash command. This tool is explicitly enabled by the operator.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "command": {"type": "string"},
                            "timeout_seconds": {"type": "integer", "minimum": 1, "maximum": 300},
                        },
                        "required": ["command"],
                        "additionalProperties": False,
                    },
                },
            }
        )
    return tools


def endpoint_is_loopback(endpoint: str) -> bool:
    if any(character.isspace() or ord(character) < 32 for character in endpoint):
        raise AdapterError("endpoint must not contain whitespace or control characters")
    try:
        parsed = urlsplit(endpoint)
        host = parsed.hostname
        port = parsed.port
    except ValueError as exc:
        raise AdapterError("endpoint is not a valid HTTP(S) URL") from exc
    if (
        parsed.scheme not in {"http", "https"} or not host
        or parsed.username is not None or parsed.password is not None
        or parsed.query or parsed.fragment or "\\" in parsed.netloc or port == 0
    ):
        raise AdapterError("endpoint requires an HTTP(S) host without credentials, query, or fragment")
    try:
        loopback = ipaddress.ip_address(host).is_loopback
    except ValueError:
        loopback = host.lower().rstrip(".") == "localhost"
    if (
        parsed.scheme == "http" and not loopback
        and os.environ.get("OPENAI_COMPATIBLE_ALLOW_INSECURE_HTTP", "0") != "1"
    ):
        raise AdapterError("non-loopback HTTP endpoints are blocked")
    return loopback


def post_chat(endpoint: str, api_key: str, payload: dict[str, Any], timeout: float) -> dict[str, Any]:
    loopback = endpoint_is_loopback(endpoint)
    headers = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    request = urllib.request.Request(
        endpoint,
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers=headers,
        method="POST",
    )
    try:
        handlers: list[Any] = [NoRedirectHandler()]
        if loopback:
            handlers.append(urllib.request.ProxyHandler({}))
        opener = urllib.request.build_opener(*handlers)
        with opener.open(request, timeout=timeout) as response:
            body = response.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        raise AdapterError(f"HTTP {exc.code}: {redact(body)[:2000]}") from exc
    except urllib.error.URLError as exc:
        raise AdapterError(f"request failed: {redact(str(exc.reason))}") from exc
    try:
        decoded = json.loads(body)
    except json.JSONDecodeError as exc:
        raise AdapterError(f"endpoint returned invalid JSON: {redact(body)[:500]}") from exc
    if not isinstance(decoded, dict):
        raise AdapterError("endpoint returned a non-object JSON response")
    return decoded


def number(value: Any, *, integer: bool = False) -> int | float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    try:
        valid = math.isfinite(value) and value >= 0
    except OverflowError:
        return None
    if not valid or (integer and int(value) != value):
        return None
    return int(value) if integer else value


class UsageTotals:
    """Only report a complete total when every model response supplies it."""

    def __init__(self) -> None:
        self.values: dict[str, int | float | None] = {
            "input_tokens": 0, "output_tokens": 0, "total_tokens": 0, "cost_usd": 0.0,
        }
        self.responses = 0

    def add(self, response: dict[str, Any]) -> None:
        self.responses += 1
        usage = response.get("usage") if isinstance(response.get("usage"), dict) else {}
        incoming = number(usage.get("prompt_tokens", usage.get("input_tokens")), integer=True)
        outgoing = number(usage.get("completion_tokens", usage.get("output_tokens")), integer=True)
        total = number(usage.get("total_tokens"), integer=True)
        if total is None and incoming is not None and outgoing is not None:
            total = incoming + outgoing
        cost = number(response.get("cost_usd", usage.get("cost_usd")))
        for field, value in (
            ("input_tokens", incoming), ("output_tokens", outgoing),
            ("total_tokens", total), ("cost_usd", cost),
        ):
            previous = self.values[field]
            self.values[field] = previous + value if previous is not None and value is not None else None

    def payload(self) -> dict[str, Any]:
        return self.values.copy() if self.responses else {field: None for field in self.values}


def main() -> int:
    from project_isolation import inside_boundary
    if not inside_boundary():
        raise AdapterError("Direct host execution is forbidden; start this adapter through Auto Company project isolation")
    parser = argparse.ArgumentParser()
    parser.add_argument("--endpoint", required=True)
    parser.add_argument("--model", required=True)
    parser.add_argument("--workspace", required=True)
    parser.add_argument("--prompt-file", required=True)
    parser.add_argument("--request-timeout", type=float, default=120.0)
    parser.add_argument("--max-turns", type=int, default=12)
    args = parser.parse_args()
    totals = UsageTotals()
    try:
        endpoint_is_loopback(args.endpoint)
        if args.max_turns < 1 or not math.isfinite(args.request_timeout) or args.request_timeout <= 0:
            raise AdapterError("max turns and request timeout must be positive")
        return run_agent(args, totals)
    except (AdapterError, OSError, ValueError, TypeError) as exc:
        print(json.dumps({
            "status": "error", "type": "result", "subtype": "adapter_error",
            "result": redact(str(exc)), **totals.payload(),
        }, ensure_ascii=False))
        return 1


def run_agent(args: argparse.Namespace, totals: UsageTotals) -> int:
    workspace = Path(args.workspace).resolve()
    prompt_file = Path(args.prompt_file).resolve()
    if not workspace.is_dir():
        raise AdapterError(f"workspace does not exist: {workspace}")
    if not prompt_file.is_file():
        raise AdapterError("prompt file does not exist")

    allow_shell = os.environ.get("OPENAI_COMPATIBLE_ALLOW_SHELL", "0") == "1"
    safe_commands_raw = os.environ.get(
        "OPENAI_COMPATIBLE_SAFE_COMMANDS", ",".join(DEFAULT_SAFE_COMMANDS)
    )
    safe_commands = parse_safe_commands(safe_commands_raw)
    api_key = os.environ.get("OPENAI_COMPATIBLE_API_KEY", "")
    messages: list[dict[str, Any]] = [
        {
            "role": "system",
            "content": (
                "You are an autonomous coding agent. File tools are restricted to the workspace "
                "and deny conventional credential paths. "
                "Use run_command only for explicitly allowlisted exact argv sequences. Arbitrary shell is "
                + ("enabled by the operator." if allow_shell else "disabled.")
            ),
        },
        {"role": "user", "content": prompt_file.read_text(encoding="utf-8")},
    ]

    response_type = "result"
    subtype = "success"

    for _ in range(args.max_turns):
        try:
            response = post_chat(
                args.endpoint,
                api_key,
                {
                    "model": args.model,
                    "messages": messages,
                    "tools": tool_definitions(allow_shell),
                    "tool_choice": "auto",
                },
                args.request_timeout,
            )
        except (AdapterError, OSError):
            # A failed request may have incurred unreported usage. Do not
            # present preceding successful requests as a complete cycle total.
            totals.add({})
            raise
        totals.add(response)
        if response.get("is_error") is True or response.get("status") == "error":
            raise AdapterError("endpoint reported an error response")

        choices = response.get("choices")
        if not isinstance(choices, list) or not choices or not isinstance(choices[0], dict):
            raise AdapterError("endpoint response has no choices[0]")
        message = choices[0].get("message")
        if not isinstance(message, dict):
            raise AdapterError("endpoint response has no assistant message")
        response_type = str(response.get("type") or "result")
        subtype = str(response.get("subtype") or "success")
        messages.append(message)
        tool_calls = message.get("tool_calls")
        if not isinstance(tool_calls, list) or not tool_calls:
            content = message.get("content")
            if isinstance(content, list):
                content = "\n".join(
                    str(item.get("text", ""))
                    for item in content
                    if isinstance(item, dict) and item.get("type") == "text"
                )
            if not isinstance(content, str):
                content = ""
            print(
                json.dumps(
                    {
                        "status": "success",
                        "type": response_type,
                        "subtype": subtype,
                        "result": redact(content),
                        **totals.payload(),
                    },
                    ensure_ascii=False,
                )
            )
            return 0

        for call in tool_calls:
            call_id = str(call.get("id", "")) if isinstance(call, dict) else ""
            function = call.get("function") if isinstance(call, dict) else None
            name = str(function.get("name", "")) if isinstance(function, dict) else ""
            raw_arguments = function.get("arguments", "{}") if isinstance(function, dict) else "{}"
            try:
                arguments = json.loads(raw_arguments) if isinstance(raw_arguments, str) else raw_arguments
                if not isinstance(arguments, dict):
                    raise AdapterError("tool arguments must be a JSON object")
                tool_result = run_tool(name, arguments, workspace, safe_commands, allow_shell)
            except (AdapterError, ValueError, TypeError, OSError, subprocess.SubprocessError) as exc:
                tool_result = json.dumps({"error": redact(str(exc))}, ensure_ascii=False)
            messages.append(
                {
                    "role": "tool",
                    "tool_call_id": call_id,
                    "content": redact(tool_result)[:20000],
                }
            )

    raise AdapterError(f"tool loop exceeded max turns ({args.max_turns})")


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (AdapterError, OSError, ValueError) as exc:
        print(
            json.dumps(
                {
                    "status": "error",
                    "type": "result",
                    "subtype": "adapter_error",
                    "result": redact(str(exc)),
                    "cost_usd": None,
                    "input_tokens": None,
                    "output_tokens": None,
                    "total_tokens": None,
                },
                ensure_ascii=False,
            )
        )
        raise SystemExit(1)
