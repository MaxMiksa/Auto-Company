#!/usr/bin/env python3
"""Read human-owned project selection as data and validate local Git isolation."""

import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile

from localization import configuration_lock, recover_language_update


def project_name(value):
    value = value.removeprefix("projects/")
    if not re.fullmatch(r"[a-z0-9](?:[a-z0-9-]*[a-z0-9])?", value):
        raise ValueError("project name must use lowercase letters, digits, and hyphens")
    return value


def read_config(root):
    with configuration_lock(root):
        recover_language_update(root)
        return _read_config(root)


def _read_config(root):
    config = root / ".auto-company.local"
    if config.is_symlink():
        raise ValueError("local project configuration must not be a symlink")
    if not config.exists():
        return b"", None
    data = config.read_bytes()
    active = None
    for line in data.decode("utf-8").splitlines():
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        match = re.fullmatch(r"([A-Z][A-Z0-9_]*)=(.*)", line)
        if not match:
            raise ValueError("local project configuration must contain plain KEY=value lines")
        if match[1] == "ACTIVE_PROJECT":
            if active is not None:
                raise ValueError("local project configuration has duplicate ACTIVE_PROJECT entries")
            if not match[2].startswith("projects/"):
                raise ValueError("ACTIVE_PROJECT must be a projects/<name> path")
            active = project_name(match[2])
    return data, active


def git(root, *arguments):
    environment = {key: value for key, value in os.environ.items() if not key.startswith("GIT_")}
    result = subprocess.run(
        ["git", "-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null",
         "-c", "core.untrackedCache=false", "-C", str(root), *arguments], env=environment,
        capture_output=True, text=True,
    )
    if result.returncode:
        raise ValueError(f"cannot inspect local Git repository: {root}")
    return result.stdout.strip()


def project_path(root, name):
    name = project_name(name)
    projects = root / "projects"
    target = projects / name
    if projects.is_symlink() or target.is_symlink() or target.resolve() != target:
        raise ValueError("project path must remain inside the framework projects directory")
    return target


def validate_project(root, name):
    name = project_name(name)
    target = project_path(root, name)
    metadata = target / ".git"
    if not metadata.is_dir() or metadata.is_symlink():
        raise ValueError(f"not an independent local Git repository: {target}")
    if Path(git(target, "rev-parse", "--show-toplevel")).resolve() != target:
        raise ValueError(f"not an independent local Git repository: {target}")
    if git(root, "ls-files", "--", f"projects/{name}"):
        raise ValueError("project files are still tracked by the framework; migrate explicitly first")
    registry = root / "projects/registry.tsv"
    rows = [line.split("\t") for line in registry.read_text().splitlines()[1:]]
    matches = [row for row in rows if row and row[0] == name]
    if len(matches) != 1 or len(matches[0]) != 4 or matches[0][1] != f"projects/{name}":
        raise ValueError(f"project must have exactly one matching registry entry: {name}")
    return target


def select_project(root, name):
    name = project_name(name)
    validate_project(root, name)
    with configuration_lock(root):
        recover_language_update(root)
        _select_project(root, name)


def _select_project(root, name):
    data, _ = _read_config(root)
    replacement = f"ACTIVE_PROJECT=projects/{name}".encode()
    lines = data.splitlines(keepends=True)
    for index, line in enumerate(lines):
        if line.startswith(b"ACTIVE_PROJECT="):
            ending = b"\r\n" if line.endswith(b"\r\n") else b"\n" if line.endswith(b"\n") else b""
            lines[index] = replacement + ending
            break
    else:
        if data and not data.endswith((b"\n", b"\r")):
            lines.append(b"\n")
        lines.append(replacement + b"\n")
    atomic_write(root / ".auto-company.local", b"".join(lines))


def atomic_write(path, data):
    descriptor, temporary = tempfile.mkstemp(prefix=".auto-company.local.", dir=path.parent)
    try:
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(data)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def capture_selection(root):
    with configuration_lock(root):
        recover_language_update(root)
        data, _ = _read_config(root)
        baseline = {"present": (root / ".auto-company.local").exists(), "data": data.hex()}
        atomic_write(root / ".auto-company.local.cycle-backup", json.dumps(baseline).encode())


def verify_selection(root):
    with configuration_lock(root):
        recover_language_update(root)
        return _verify_selection(root)


def _verify_selection(root):
    baseline = json.loads((root / ".auto-company.local.cycle-backup").read_text())
    config = root / ".auto-company.local"
    original = bytes.fromhex(baseline["data"])
    present = config.exists() or config.is_symlink()
    if not config.is_symlink() and present == baseline["present"]:
        if not present or (config.is_file() and config.read_bytes() == original):
            return True
    if baseline["present"]:
        atomic_write(config, original)
    elif present:
        # Refuse to recursively delete a directory created at the config path.
        config.unlink()
    return False


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("active", "name", "validate", "path", "select", "capture", "verify"))
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--project")
    parser.add_argument("--optional", action="store_true")
    args = parser.parse_args()
    root = args.root.resolve()
    try:
        if args.command == "capture":
            capture_selection(root)
        elif args.command == "verify":
            if not verify_selection(root):
                print("Error: cycle changed human-owned project configuration; baseline restored", file=sys.stderr)
                return 42
        elif args.command in ("active", "name"):
            _, name = read_config(root)
            if name is None:
                if args.optional:
                    return 0
                raise ValueError("no ACTIVE_PROJECT selected; use project-select or edit .auto-company.local")
            if args.command == "name":
                print(name)
            else:
                print(validate_project(root, name))
        elif args.command == "select":
            select_project(root, args.project or "")
        elif args.command == "path":
            print(project_path(root, args.project or ""))
        else:
            print(validate_project(root, args.project or ""))
    except (OSError, UnicodeError, ValueError, KeyError) as error:
        print(f"Error: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
