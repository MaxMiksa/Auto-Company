"""Validate extracted release payloads without trusting path names or Git filters."""

import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import platform
import re
import stat


class InstallError(Exception):
    def __init__(self, code, details=None):
        super().__init__(code)
        self.code = code
        self.details = details


def digest(path):
    value = hashlib.sha256()
    with path.open("rb") as stream:
        for part in iter(lambda: stream.read(1024 * 1024), b""):
            value.update(part)
    return value.hexdigest()


def no_links(path):
    path = Path(os.path.abspath(path))
    for item in (path, *path.parents):
        if item.is_symlink():
            # macOS exposes these OS-owned root aliases by default, including
            # tempfile's /var/folders. Resolve them, never payload-owned links.
            if (platform.system() == "Darwin" and str(item) in ("/tmp", "/var", "/etc")
                    and str(item.resolve()) == "/private" + str(item)):
                continue
            raise InstallError("unsafe_path", str(item))
    return path.resolve()


def relative_path(value):
    if not isinstance(value, str) or not value or "\\" in value or ":" in value:
        raise InstallError("unsafe_path", value)
    parts = value.split("/")
    if (PurePosixPath(value).is_absolute() or any(p in ("", ".", "..") for p in parts)
            or any(ord(c) < 32 for c in value)
            or any(p.endswith((".", " ")) for p in parts)
            or any(re.fullmatch(r"(?i)(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?", p) for p in parts)):
        raise InstallError("unsafe_path", value)
    return value


def managed_path(value):
    value = relative_path(value)
    parts = value.split("/")
    low = [p.lower() for p in parts]
    if (any(p in (".git", "node_modules", ".auto-company", "logs", "acceptance") for p in low)
            or low[0].startswith((".auto-loop", ".auto-company"))
            or low[0] in ("agents.md", "chat_logs.md", "project.md", "release-files.json")
            or any(p in (".env", "credentials.json", "secrets.json") for p in low)
            or (low[0] == "memories" and value not in ("memories/.gitkeep", "memories/consensus.template.md"))):
        raise InstallError("unsafe_path", value)
    return value


def at(root, relative):
    return no_links(root / relative_path(relative))


def validate_manifest(value):
    if (not isinstance(value, dict) or value.get("schema") != 1
            or not isinstance(value.get("version"), str)
            or not re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+(?:[-+][A-Za-z0-9.-]+)?", value["version"])
            or not re.fullmatch(r"[0-9a-f]{40}", str(value.get("source_commit", "")))
            or not isinstance(value.get("registry_baseline"), str)
            or not isinstance(value.get("files"), list) or not value["files"]):
        raise InstallError("invalid_manifest")
    names = {}
    for entry in value["files"]:
        if not isinstance(entry, dict):
            raise InstallError("invalid_manifest")
        name = managed_path(entry.get("path"))
        if (entry.get("mode") not in ("100644", "100755")
                or not re.fullmatch(r"[0-9a-f]{64}", str(entry.get("sha256", "")))
                or ("size" in entry and (type(entry["size"]) is not int or entry["size"] < 0))):
            raise InstallError("invalid_manifest", name)
        key = name.casefold()
        if key in names:
            raise InstallError("unsafe_path", name)
        names[key] = entry
    for key in names:
        if any(str(parent) in names for parent in PurePosixPath(key).parents if str(parent) != "."):
            raise InstallError("unsafe_path", key)
    registry = names.get("projects/registry.tsv")
    if registry is None or hashlib.sha256(value["registry_baseline"].encode()).hexdigest() != registry["sha256"]:
        raise InstallError("invalid_manifest", "registry_baseline")
    return value


def read_manifest(root):
    try:
        return validate_manifest(json.loads(at(root, "release-files.json").read_text(encoding="utf-8")))
    except (OSError, ValueError, TypeError) as error:
        raise InstallError("invalid_manifest", str(error)) from error


def verify_payload(root, *, strict=True):
    root = no_links(root)
    manifest = read_manifest(root)
    expected = {entry["path"] for entry in manifest["files"]} | {"release-files.json"}
    for entry in manifest["files"]:
        path = at(root, entry["path"])
        if (not path.is_file() or not stat.S_ISREG(path.stat().st_mode)
                or digest(path) != entry["sha256"]
                or ("size" in entry and path.stat().st_size != entry["size"])):
            raise InstallError("integrity", entry["path"])
    if strict:
        for path in root.rglob("*"):
            no_links(path)
            if not path.is_dir() and path.relative_to(root).as_posix() not in expected:
                raise InstallError("integrity", path.relative_to(root).as_posix())
    return manifest
