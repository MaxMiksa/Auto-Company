"""Render launchd configuration without interpolating unescaped XML or secrets."""

import argparse
import os
from pathlib import Path
import plistlib
import sys
from xml.parsers.expat import ExpatError


# Only non-secret runtime settings may cross the service-manager boundary.
RUNTIME_SETTINGS = (
    "ENGINE", "MODEL", "AUTO_COMPANY_LANGUAGE", "CLAUDE_BIN", "CLAUDE_PERMISSION_MODE", "CODEX_BIN",
    "CODEX_SANDBOX_MODE", "CURSOR_BIN", "CURSOR_ADAPTER_ENABLED",
    "CURSOR_SANDBOX_MODE", "CURSOR_FORCE", "CURSOR_ALLOW_UNSANDBOXED",
    "OPENAI_COMPATIBLE_ADAPTER_ENABLED", "OPENAI_COMPATIBLE_ENDPOINT",
    "OPENAI_COMPATIBLE_MODEL", "OPENAI_COMPATIBLE_ALLOW_SHELL",
    "OPENAI_COMPATIBLE_ALLOW_INSECURE_HTTP", "OPENAI_COMPATIBLE_SAFE_COMMANDS",
    "OPENAI_COMPATIBLE_REQUEST_TIMEOUT_SECONDS", "OPENAI_COMPATIBLE_MAX_TURNS",
    "LOOP_INTERVAL", "CYCLE_TIMEOUT_SECONDS", "CYCLE_TERM_GRACE_SECONDS",
    "CYCLE_KILL_WAIT_SECONDS", "MAX_CONSECUTIVE_ERRORS", "COOLDOWN_SECONDS",
    "LIMIT_WAIT_SECONDS", "MAX_LOGS", "AUTO_LOOP_PROTECT_GITIGNORE",
    "USAGE_BUDGET_PERIOD", "USAGE_WARNING_USD", "USAGE_HARD_LIMIT_USD",
    "USAGE_WARNING_TOKENS", "USAGE_HARD_LIMIT_TOKENS", "BUDGET_PAUSE_POLL_SECONDS",
)


def render(project: str, path: str, environ: dict[str, str], prepare: bool = False) -> bytes:
    settings = {key: environ[key] for key in RUNTIME_SETTINGS if key in environ}
    settings.update({"PATH": path, "HOME": environ["HOME"]})
    return plistlib.dumps({
        "Label": "com.autocompany.loop",
        "ProgramArguments": ["/bin/bash", f"{project}/scripts/core/auto-loop.sh", "--daemon"],
        "WorkingDirectory": project,
        "KeepAlive": False if prepare else {"PathState": {f"{project}/.auto-loop-paused": False}},
        "RunAtLoad": not prepare,
        "StandardOutPath": f"{project}/logs/launchd-stdout.log",
        "StandardErrorPath": f"{project}/logs/launchd-stderr.log",
        "EnvironmentVariables": settings,
        "ThrottleInterval": 30,
    }, sort_keys=False)


def validate(project: str, config: object, loaded: bool = False) -> None:
    """Reject malformed or foreign agents without rewriting their settings."""
    if not isinstance(config, dict) or config.get("Label") != "com.autocompany.loop":
        raise ValueError("invalid Auto Company LaunchAgent label")
    root = Path(project).resolve()
    directory = config.get("WorkingDirectory")
    arguments = config.get("ProgramArguments")
    # launchd job_export() omits WorkingDirectory. The installed plist must
    # provide it; loaded-job metadata is identified by its exact command below.
    if not loaded or "WorkingDirectory" in config:
        if not isinstance(directory, str) or not Path(directory).is_absolute() or Path(directory).resolve() != root:
            raise ValueError("LaunchAgent WorkingDirectory does not belong to this checkout")
    if (not isinstance(arguments, list) or len(arguments) != 3 or arguments[0] != "/bin/bash"
            or arguments[2] != "--daemon" or not isinstance(arguments[1], str)
            or not Path(arguments[1]).is_absolute()
            or Path(arguments[1]).resolve() != root / "scripts/core/auto-loop.sh"
            or config.get("Program", "/bin/bash") != "/bin/bash"):
        raise ValueError("LaunchAgent command does not belong to this checkout")
    # Loaded-job output contains launchd metadata rather than all plist keys.
    if loaded:
        return
    environment = config.get("EnvironmentVariables", {})
    if not isinstance(environment, dict) or any(
            not isinstance(key, str) or not isinstance(value, str) for key, value in environment.items()):
        raise ValueError("LaunchAgent EnvironmentVariables must contain strings")
    if "RunAtLoad" in config and not isinstance(config["RunAtLoad"], bool):
        raise ValueError("LaunchAgent RunAtLoad must be a boolean")
    keep_alive = config.get("KeepAlive", False)
    if not isinstance(keep_alive, (bool, dict)):
        raise ValueError("LaunchAgent KeepAlive must be a boolean or dictionary")
    if isinstance(keep_alive, dict) and "PathState" in keep_alive:
        paths = keep_alive["PathState"]
        if (not isinstance(paths, dict) or any(not isinstance(key, str) or not isinstance(value, bool)
                                              for key, value in paths.items())):
            raise ValueError("LaunchAgent PathState must map paths to booleans")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project", required=True)
    parser.add_argument("--path")
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--output", type=Path)
    mode.add_argument("--validate", type=Path)
    mode.add_argument("--validate-loaded", action="store_true")
    mode.add_argument("--is-prepared", type=Path)
    parser.add_argument("--prepare", action="store_true")
    args = parser.parse_args()
    if args.is_prepared:
        try:
            config = plistlib.loads(args.is_prepared.read_bytes())
            validate(args.project, config)
        except (OSError, ValueError, TypeError, ExpatError, plistlib.InvalidFileException) as exc:
            parser.exit(2, str(exc) + "\n")
        raise SystemExit(0 if config.get("RunAtLoad") is False and config.get("KeepAlive") is False else 1)
    if args.validate or args.validate_loaded:
        try:
            raw = args.validate.read_bytes() if args.validate else sys.stdin.buffer.read()
            validate(args.project, plistlib.loads(raw), args.validate_loaded)
        except (OSError, ValueError, TypeError, ExpatError, plistlib.InvalidFileException) as exc:
            parser.exit(1, f"Error: cannot control LaunchAgent: {exc}\n")
        return
    if args.path is None:
        parser.error("--path is required with --output")
    encoded = render(args.project, args.path, dict(os.environ), args.prepare)
    temporary = args.output.with_suffix(".plist.tmp")
    try:
        temporary.write_bytes(encoded)
        temporary.chmod(0o600)
        temporary.replace(args.output)
    finally:
        temporary.unlink(missing_ok=True)


if __name__ == "__main__":
    main()
