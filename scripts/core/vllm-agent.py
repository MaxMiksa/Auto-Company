#!/usr/bin/env python3
"""OpenAI-compatible vLLM agent for Auto Company (free LAN Qwen)."""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

ROOT = Path(os.environ.get("AUTO_COMPANY_ROOT") or os.getcwd()).resolve()
BASE_URL = os.environ.get("VLLM_BASE_URL", "http://58.241.131.10:30000/v1").rstrip("/")
MODEL = os.environ.get("MODEL") or os.environ.get("VLLM_MODEL", "Qwen/Qwen3.8-27B")
API_KEY = os.environ.get("VLLM_API_KEY", "EMPTY")
TIMEOUT = int(os.environ.get("VLLM_TIMEOUT", "180"))
MAX_STEPS = int(os.environ.get("VLLM_MAX_STEPS", "24"))

FORBIDDEN_PREFIXES = (
    str(Path.home() / ".ssh"),
    str(Path.home() / ".gnupg"),
    "/etc/ssh",
)

TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "read_file",
            "description": "Read a UTF-8 text file under the workspace.",
            "parameters": {
                "type": "object",
                "properties": {"path": {"type": "string"}},
                "required": ["path"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "write_file",
            "description": "Create or overwrite a UTF-8 text file under the workspace.",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string"},
                    "content": {"type": "string"},
                },
                "required": ["path", "content"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_dir",
            "description": "List files in a workspace directory.",
            "parameters": {
                "type": "object",
                "properties": {"path": {"type": "string"}},
                "required": ["path"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "bash",
            "description": "Run a shell command in the workspace. Do not touch ~/.ssh or system files.",
            "parameters": {
                "type": "object",
                "properties": {"command": {"type": "string"}},
                "required": ["command"],
            },
        },
    },
]


def safe_path(raw: str) -> Path:
    path = Path(raw)
    if not path.is_absolute():
        path = ROOT / path
    path = path.resolve()
    try:
        path.relative_to(ROOT)
    except ValueError as exc:
        raise PermissionError(f"path outside workspace: {path}") from exc
    text = str(path)
    for prefix in FORBIDDEN_PREFIXES:
        if text.startswith(prefix):
            raise PermissionError(f"forbidden path: {path}")
    return path


def tool_read_file(path: str) -> str:
    target = safe_path(path)
    if not target.is_file():
        return f"ERROR: not a file: {target}"
    data = target.read_bytes()
    if len(data) > 400_000:
        data = data[:400_000] + b"\n...[truncated]..."
    return data.decode("utf-8", errors="replace")


def tool_write_file(path: str, content: str) -> str:
    target = safe_path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content, encoding="utf-8")
    return f"WROTE {target} ({len(content)} chars)"


def tool_list_dir(path: str) -> str:
    target = safe_path(path)
    if not target.exists():
        return f"ERROR: missing: {target}"
    if target.is_file():
        return f"FILE {target}"
    names = sorted(p.name + ("/" if p.is_dir() else "") for p in target.iterdir())
    return "\n".join(names[:400]) or "(empty)"


def tool_bash(command: str) -> str:
    lowered = command.lower()
    if any(bad in lowered for bad in ("rm -rf /", "gh repo delete", "git push --force", "wrangler delete")):
        return "ERROR: blocked dangerous command"
    proc = subprocess.run(
        command,
        shell=True,
        cwd=str(ROOT),
        capture_output=True,
        text=True,
        timeout=90,
    )
    out = (proc.stdout or "") + (proc.stderr or "")
    if len(out) > 20_000:
        out = out[:20_000] + "\n...[truncated]..."
    return f"exit={proc.returncode}\n{out}"


DISPATCH = {
    "read_file": lambda a: tool_read_file(a.get("path", ".")),
    "write_file": lambda a: tool_write_file(a.get("path", ""), a.get("content", "")),
    "list_dir": lambda a: tool_list_dir(a.get("path", ".")),
    "bash": lambda a: tool_bash(a.get("command", "")),
}


def http_json(url: str, payload: dict[str, Any] | None = None) -> dict[str, Any]:
    data = None if payload is None else json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {API_KEY or 'EMPTY'}",
        },
        method="GET" if payload is None else "POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {exc.code} {url}: {body[:800]}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"Cannot reach vLLM at {url}: {exc.reason}") from exc


def chat(messages: list[dict[str, Any]], use_tools: bool) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "model": MODEL,
        "messages": messages,
        "temperature": 0.3,
    }
    if use_tools:
        payload["tools"] = TOOLS
        payload["tool_choice"] = "auto"
    return http_json(f"{BASE_URL}/chat/completions", payload)


def parse_args_obj(raw: Any) -> dict[str, Any]:
    if isinstance(raw, dict):
        return raw
    if not raw:
        return {}
    try:
        parsed = json.loads(raw)
        return parsed if isinstance(parsed, dict) else {}
    except json.JSONDecodeError:
        return {"command": str(raw)}


def run_tool_call(name: str, arguments: Any) -> str:
    args = parse_args_obj(arguments)
    handler = DISPATCH.get(name)
    if handler is None:
        return f"ERROR: unknown tool {name}"
    try:
        return str(handler(args))
    except Exception as exc:  # noqa: BLE001
        return f"ERROR: {exc}"


REACT_RE = re.compile(
    r"Action:\s*(read_file|write_file|list_dir|bash)\s*Action Input:\s*(\{.*?\}|.*?)(?:\n|$)",
    re.S,
)


def maybe_react(content: str) -> list[tuple[str, dict[str, Any]]]:
    found: list[tuple[str, dict[str, Any]]] = []
    for match in REACT_RE.finditer(content or ""):
        found.append((match.group(1), parse_args_obj(match.group(2).strip())))
    return found


def run_agent(prompt: str) -> dict[str, Any]:
    system = (
        "You are Auto Company's free LAN engine (vLLM Qwen). "
        "Work only inside this workspace. Use tools to read/write files and run shell. "
        "You MUST update memories/consensus.md before finishing, with sections: "
        "# Auto Company Consensus, ## Next Action, ## Company State. "
        "Prefer shipping files over discussion. Never delete repos or system files."
    )
    messages: list[dict[str, Any]] = [
        {"role": "system", "content": system},
        {"role": "user", "content": prompt},
    ]
    use_tools = True
    final_text = ""
    steps = 0

    for steps in range(1, MAX_STEPS + 1):
        try:
            data = chat(messages, use_tools=use_tools)
        except RuntimeError as exc:
            if use_tools and "tool" in str(exc).lower():
                use_tools = False
                continue
            raise

        choice = (data.get("choices") or [{}])[0]
        message = choice.get("message") or {}
        content = message.get("content") or ""
        tool_calls = message.get("tool_calls") or []
        messages.append(message if message else {"role": "assistant", "content": content})

        if tool_calls:
            for call in tool_calls:
                fn = call.get("function") or {}
                result = run_tool_call(fn.get("name", ""), fn.get("arguments"))
                messages.append(
                    {
                        "role": "tool",
                        "tool_call_id": call.get("id", "tool"),
                        "name": fn.get("name", ""),
                        "content": result,
                    }
                )
            continue

        react = maybe_react(content)
        if react and "Final Answer" not in content:
            for name, args in react:
                result = run_tool_call(name, args)
                messages.append({"role": "user", "content": f"Tool {name} result:\n{result}"})
            continue

        final_text = content.strip()
        break

    return {
        "type": "result",
        "subtype": "success" if final_text else "error",
        "engine": "vllm",
        "model": MODEL,
        "base_url": BASE_URL,
        "steps": steps,
        "result": final_text or "vLLM cycle produced no final text",
    }


def ping() -> int:
    try:
        data = http_json(f"{BASE_URL}/models")
    except RuntimeError as exc:
        print(f"vLLM unreachable: {exc}", file=sys.stderr)
        return 1
    models = [item.get("id") for item in data.get("data", []) if isinstance(item, dict)]
    print(f"vLLM OK  {BASE_URL}")
    print(f"configured model: {MODEL}")
    print("available:", ", ".join(str(m) for m in models) or "(none listed)")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Auto Company vLLM / Qwen engine")
    parser.add_argument("--ping", action="store_true")
    parser.add_argument("--prompt-file")
    parser.add_argument("--stdin", action="store_true")
    parser.add_argument("prompt", nargs="?")
    args = parser.parse_args()

    if args.ping:
        return ping()

    if args.prompt_file:
        prompt = Path(args.prompt_file).read_text(encoding="utf-8")
    elif args.stdin or not args.prompt:
        prompt = sys.stdin.read()
    else:
        prompt = args.prompt

    if not prompt.strip():
        print("Error: empty prompt", file=sys.stderr)
        return 2

    try:
        result = run_agent(prompt)
    except Exception as exc:  # noqa: BLE001
        result = {
            "type": "result",
            "subtype": "error",
            "engine": "vllm",
            "model": MODEL,
            "base_url": BASE_URL,
            "result": str(exc),
        }
        print(json.dumps(result, ensure_ascii=False))
        return 1

    print(json.dumps(result, ensure_ascii=False))
    return 0 if result.get("subtype") == "success" else 1


if __name__ == "__main__":
    sys.exit(main())
