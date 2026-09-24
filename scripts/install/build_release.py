#!/usr/bin/env python3
"""Build deterministic, platform-labelled release archives from one Git commit."""

from __future__ import annotations

import argparse
import gzip
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import stat
import subprocess
import sys
import tarfile
import unicodedata
import zipfile


SCHEMA = 1
PLATFORMS = ("windows", "macos", "linux")
REQUIRED_PAYLOAD_PATHS = (
    "LICENSE", "package.json", "projects/registry.tsv", "setup.ps1", "setup.sh",
    "docs/install.md", "i18n/en/docs/install.md",
    "scripts/install/bootstrap-messages.tsv", "scripts/install/bootstrap.ps1",
    "scripts/install/bootstrap.sh", "scripts/install/build_release.py",
    "scripts/install/manager.py", "scripts/install/manifest.py", "scripts/install/messages.py",
)
VERSION_RE = re.compile(r"[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?\Z")
SHA_RE = re.compile(r"[0-9a-f]{40}\Z")
WINDOWS_RESERVED = {
    "con", "prn", "aux", "nul",
    *(f"com{number}" for number in range(1, 10)),
    *(f"lpt{number}" for number in range(1, 10)),
}
PRIVATE_ROOTS = {
    "acceptance", "runs", "worktrees", "Files", "logs", "node_modules", "ci-results",
    "test-results", "playwright-report", ".auto-company", ".git",
}
PRIVATE_NAMES = {
    ".auto-company.local", ".auto-loop.env", ".npmrc", ".pypirc",
    "credentials.json", "secrets.json", "id_rsa", "id_ed25519",
}
PRIVATE_ROOT_KEYS = {name.casefold() for name in PRIVATE_ROOTS}
PRIVATE_NAME_KEYS = {name.casefold() for name in PRIVATE_NAMES}
LOCAL_ROOT_NAMES = {"agents.md", "chat_logs.md", "project.md"}


class BuildError(RuntimeError):
    """A release cannot be built without weakening the release contract."""


def run_git(repo: Path, *args: str, input_bytes: bytes | None = None) -> bytes:
    result = subprocess.run(
        ["git", "-C", os.fspath(repo), *args],
        input=input_bytes,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )
    if result.returncode:
        detail = result.stderr.decode("utf-8", "replace").strip()
        raise BuildError(detail or f"git {' '.join(args)} failed")
    return result.stdout


def resolve_commit(repo: Path, ref: str) -> str:
    if not ref or "\0" in ref or "\n" in ref or "\r" in ref:
        raise BuildError("The source ref is invalid")
    raw = run_git(repo, "rev-parse", "--verify", "--end-of-options", f"{ref}^{{commit}}")
    commit = raw.decode("ascii", "strict").strip().lower()
    if not SHA_RE.fullmatch(commit):
        raise BuildError("Git did not resolve the source to a 40-character commit")
    return commit


def commit_epoch(repo: Path, commit: str) -> int:
    raw = run_git(repo, "show", "-s", "--format=%ct", commit).decode("ascii", "strict").strip()
    try:
        epoch = int(raw)
    except ValueError as exc:
        raise BuildError("The commit timestamp is invalid") from exc
    if not 0 <= epoch <= 0xFFFFFFFF:
        raise BuildError("The commit timestamp cannot be represented by the release formats")
    return epoch


def validate_path(path: str) -> None:
    if not path or path != unicodedata.normalize("NFC", path):
        raise BuildError(f"Tracked path is empty or not NFC-normalized: {path!r}")
    if "\\" in path or "\0" in path or PurePosixPath(path).is_absolute():
        raise BuildError(f"Tracked path is not portable: {path!r}")
    parts = path.split("/")
    if any(part in ("", ".", "..") for part in parts):
        raise BuildError(f"Tracked path contains an unsafe component: {path!r}")
    if parts[0].casefold() in PRIVATE_ROOT_KEYS:
        raise BuildError(f"Private or runtime path is tracked and cannot be released: {path}")
    first = parts[0].casefold()
    if first in LOCAL_ROOT_NAMES:
        raise BuildError(f"Private coordination file is tracked and cannot be released: {path}")
    if first.startswith((".auto-loop", ".auto-company")):
        raise BuildError(f"Private or runtime path is tracked and cannot be released: {path}")
    if first == "memories" and path not in ("memories/.gitkeep", "memories/consensus.template.md"):
        raise BuildError(f"Runtime memory is tracked and cannot be released: {path}")
    for part in parts:
        lowered = part.casefold()
        stem = lowered.split(".", 1)[0].rstrip(" ")
        if (
            any(ord(character) < 32 for character in part)
            or part.endswith((" ", "."))
            or any(character in part for character in '<>:"|?*')
            or stem in WINDOWS_RESERVED
        ):
            raise BuildError(f"Tracked path is unsafe on a supported platform: {path!r}")
        if lowered in PRIVATE_ROOT_KEYS or lowered in PRIVATE_NAME_KEYS:
            raise BuildError(f"Private or runtime path is tracked and cannot be released: {path}")
        if lowered == ".env" or (lowered.startswith(".env.") and lowered != ".env.example"):
            raise BuildError(f"Environment secret path is tracked and cannot be released: {path}")


def tracked_files(repo: Path, commit: str) -> list[dict[str, object]]:
    records = run_git(repo, "ls-tree", "-r", "-z", "--full-tree", commit).split(b"\0")
    files: list[dict[str, object]] = []
    portable: dict[str, str] = {}
    for record in records:
        if not record:
            continue
        metadata, separator, raw_path = record.partition(b"\t")
        if not separator:
            raise BuildError("Git returned an invalid tree record")
        try:
            mode, object_type, object_id = metadata.decode("ascii").split(" ")
            path = raw_path.decode("utf-8", "strict")
        except (UnicodeDecodeError, ValueError) as exc:
            raise BuildError("Git tree paths and metadata must be valid UTF-8") from exc
        validate_path(path)
        if object_type != "blob" or mode not in ("100644", "100755"):
            raise BuildError(f"Unsupported tracked object {mode} {object_type}: {path}")
        key = path.casefold()
        previous = portable.setdefault(key, path)
        if previous != path:
            raise BuildError(f"Tracked paths collide on a supported platform: {previous!r}, {path!r}")
        data = run_git(repo, "cat-file", "blob", object_id)
        files.append({"path": path, "mode": mode, "data": data})
    files.sort(key=lambda item: str(item["path"]).encode("utf-8"))
    if not files:
        raise BuildError("The source commit contains no tracked files")
    return files


def file_bytes(files: list[dict[str, object]], path: str) -> bytes:
    for item in files:
        if item["path"] == path:
            return item["data"]  # type: ignore[return-value]
    raise BuildError(f"Required release file is absent: {path}")


def release_metadata(files: list[dict[str, object]], version: str, commit: str) -> bytes:
    manifest = {
        "schema": SCHEMA,
        "version": version,
        "source_commit": commit,
        "files": [
            {
                "path": item["path"],
                "sha256": hashlib.sha256(item["data"]).hexdigest(),  # type: ignore[arg-type]
                "mode": item["mode"],
            }
            for item in files
        ],
        "registry_baseline": file_bytes(files, "projects/registry.tsv").decode("utf-8", "strict"),
    }
    return (json.dumps(manifest, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n").encode("utf-8")


def zip_time(epoch: int) -> tuple[int, int, int, int, int, int]:
    import time

    # ZIP cannot represent dates before 1980 and stores seconds in two-second units.
    value = max(epoch, 315532800)
    fields = time.gmtime(value)[:6]
    return (*fields[:5], fields[5] - fields[5] % 2)


def build_zip(path: Path, root: str, files: list[dict[str, object]], metadata: bytes, epoch: int) -> None:
    with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9, strict_timestamps=False) as archive:
        entries = [*files, {"path": "release-files.json", "mode": "100644", "data": metadata}]
        entries.sort(key=lambda item: str(item["path"]).encode("utf-8"))
        for item in entries:
            info = zipfile.ZipInfo(f"{root}/{item['path']}", zip_time(epoch))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.create_system = 3
            permissions = 0o755 if item["mode"] == "100755" else 0o644
            info.external_attr = (stat.S_IFREG | permissions) << 16
            info.flag_bits |= 0x800
            archive.writestr(info, item["data"], compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)


def build_tar_gz(path: Path, root: str, files: list[dict[str, object]], metadata: bytes, epoch: int) -> None:
    with path.open("wb") as raw_stream:
        with gzip.GzipFile(filename="", mode="wb", fileobj=raw_stream, compresslevel=9, mtime=epoch) as zipped:
            with tarfile.open(fileobj=zipped, mode="w", format=tarfile.GNU_FORMAT) as archive:
                entries = [*files, {"path": "release-files.json", "mode": "100644", "data": metadata}]
                entries.sort(key=lambda item: str(item["path"]).encode("utf-8"))
                for item in entries:
                    data = item["data"]
                    info = tarfile.TarInfo(f"{root}/{item['path']}")
                    info.size = len(data)  # type: ignore[arg-type]
                    info.mode = 0o755 if item["mode"] == "100755" else 0o644
                    info.mtime = epoch
                    info.uid = info.gid = 0
                    info.uname = info.gname = ""
                    archive.addfile(info, io.BytesIO(data))  # type: ignore[arg-type]


def write_exact(path: Path, data: bytes) -> None:
    if path.exists():
        if path.is_file() and path.read_bytes() == data:
            return
        raise BuildError(f"Refusing to replace an existing different output: {path}")
    temporary = path.with_name(f".{path.name}.write-{os.getpid()}")
    try:
        temporary.write_bytes(data)
        try:
            os.link(temporary, path)
        except FileExistsError:
            if not path.is_file() or path.read_bytes() != data:
                raise BuildError(f"Refusing to replace a concurrently-created different output: {path}")
    finally:
        temporary.unlink(missing_ok=True)


def build(repo: Path, ref: str, output: Path) -> dict[str, object]:
    repo = repo.resolve()
    if not (repo / ".git").exists():
        # Worktrees use a .git file, ordinary repositories use a directory.
        raise BuildError(f"Not a Git working tree: {repo}")
    commit = resolve_commit(repo, ref)
    epoch = commit_epoch(repo, commit)
    files = tracked_files(repo, commit)
    available = {str(item["path"]) for item in files}
    missing = [path for path in REQUIRED_PAYLOAD_PATHS if path not in available]
    if missing:
        raise BuildError(f"The committed ref is missing required installer files: {', '.join(missing)}")
    try:
        package = json.loads(file_bytes(files, "package.json"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise BuildError("package.json at the source commit is invalid") from exc
    version = package.get("version") if isinstance(package, dict) else None
    if not isinstance(version, str) or not VERSION_RE.fullmatch(version):
        raise BuildError("package.json must contain a supported semantic version")
    root = f"Auto-Company-v{version}"
    metadata = release_metadata(files, version, commit)
    output.mkdir(parents=True, exist_ok=True)
    if not output.is_dir():
        raise BuildError(f"Output is not a directory: {output}")

    assets = []
    for platform in PLATFORMS:
        suffix = "zip" if platform == "windows" else "tar.gz"
        name = f"{root}-{platform}.{suffix}"
        target = output / name
        temporary = output / f".{name}.tmp-{os.getpid()}"
        try:
            if platform == "windows":
                build_zip(temporary, root, files, metadata, epoch)
            else:
                build_tar_gz(temporary, root, files, metadata, epoch)
            data = temporary.read_bytes()
            write_exact(target, data)
        finally:
            temporary.unlink(missing_ok=True)
        assets.append({
            "name": name,
            "sha256": hashlib.sha256(data).hexdigest(),
            "size": len(data),
            "platform": platform,
        })

    outer = {"schema": SCHEMA, "version": version, "source_commit": commit, "assets": assets}
    outer_bytes = (json.dumps(outer, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n").encode("utf-8")
    sums = "".join(f"{asset['sha256']}  {asset['name']}\n" for asset in assets).encode("ascii")
    write_exact(output / "release-manifest.json", outer_bytes)
    write_exact(output / "SHA256SUMS.txt", sums)
    return outer


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ref", required=True, help="Committed Git ref to package")
    parser.add_argument("--output", required=True, type=Path, help="Directory for release assets")
    parser.add_argument("--repo", type=Path, default=Path.cwd(), help="Git working tree (default: current directory)")
    args = parser.parse_args(argv)
    try:
        manifest = build(args.repo, args.ref, args.output.resolve())
    except (BuildError, OSError) as exc:
        print(f"release build failed: {exc}", file=sys.stderr)
        return 1
    print(json.dumps(manifest, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
