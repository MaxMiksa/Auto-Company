#!/usr/bin/env python3
"""Verified local installations and externally staged, recoverable maintenance.

The release manifest identifies program files. Runtime data is never enumerated
as a deletion target. A maintenance marker survives every uncertain failure.
"""

import argparse
from contextlib import contextmanager
import errno
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import platform
import plistlib
import re
import shutil
import subprocess
import sys
import tempfile
import time
import uuid

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
from manifest import InstallError, at, digest, no_links, read_manifest, validate_manifest, verify_payload
from messages import message, system_language
from writer_probe import writer_is_alive

META = ".auto-company/install.json"
MARKER = ".auto-company/maintenance.json"
REGISTRY = "projects/registry.tsv"
BRANCH = "refs/heads/installed"
EXECUTOR_FILES = ("manager.py", "manifest.py", "messages.py", "writer_probe.py")


def sync_directory(path):
    """Persist rename/journal directory entries where the filesystem supports it."""
    if os.name != "posix":
        return
    descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
    try:
        try:
            os.fsync(descriptor)
        except OSError as error:
            # Some shared/virtual filesystems cannot fsync a directory. File
            # bytes still use fsync; do not claim hardware-level atomicity.
            if error.errno not in (errno.EINVAL, errno.ENOTSUP, errno.EBADF):
                raise
    finally:
        os.close(descriptor)


def clear_marker(root):
    marker = at(root, MARKER)
    if marker.exists():
        # A crash directly after link publication may leave its temporary name.
        # Only remove aliases proven to be this exact marker inode.
        for path in marker.parent.glob(".maintenance-*"):
            if not path.is_symlink() and path.is_file() and os.path.samefile(path, marker):
                path.unlink()
    marker.unlink(missing_ok=True)
    sync_directory(root / ".auto-company")


def publish_marker(root, marker):
    """Atomically publish complete JSON without replacing another maintainer."""
    destination = at(root, MARKER)
    descriptor, temporary = tempfile.mkstemp(prefix=".maintenance-", dir=destination.parent)
    try:
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(json.dumps(marker, ensure_ascii=False).encode())
            stream.flush()
            os.fsync(stream.fileno())
        try:
            # link is an atomic create-if-absent on the same filesystem. Unlike
            # O_EXCL + write, every visible marker already has complete JSON.
            os.link(temporary, destination)
        except FileExistsError as error:
            raise InstallError("maintenance", str(destination)) from error
        sync_directory(destination.parent)
    finally:
        Path(temporary).unlink(missing_ok=True)


def atomic_bytes(path, data, mode=None):
    no_links(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, name = tempfile.mkstemp(prefix=".install-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        if mode is not None:
            os.chmod(name, mode)
        os.replace(name, path)
        sync_directory(path.parent)
    finally:
        if os.path.exists(name):
            os.unlink(name)


def write_json(path, value):
    atomic_bytes(path, (json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2) + "\n").encode(), 0o600)


def read_json(path, code="not_managed"):
    try:
        no_links(path)
        value = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(value, dict):
            raise ValueError("expected object")
        return value
    except (OSError, ValueError, TypeError) as error:
        raise InstallError(code, str(path)) from error


def posix_required():
    if os.name != "posix":
        raise InstallError("posix_required")


def localization(root):
    path = root / "scripts/core/localization.py"
    spec = importlib.util.spec_from_file_location("installer_localization", path)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


def language_for(explicit=None, root=None):
    if explicit in ("zh-CN", "en"):
        return explicit
    if root:
        try:
            value = read_json(root / META).get("language")
            if value in ("zh-CN", "en"):
                return value
        except InstallError:
            pass
    # Never import the possibly damaged installation during external recovery.
    return system_language()


def default_home():
    if os.environ.get("WSL_DISTRO_NAME"):
        # A WSL-native private directory avoids Windows/WSL permission ambiguity.
        return Path(os.environ.get("XDG_DATA_HOME", str(Path.home() / ".local/share"))) / "auto-company/maintenance"
    if platform.system() == "Darwin":
        return Path.home() / "Library/Application Support/Auto-Company/maintenance"
    return Path(os.environ.get("XDG_DATA_HOME", str(Path.home() / ".local/share"))) / "auto-company/maintenance"


def external_home(path, root, create=True):
    path = no_links(path)
    if path == root or root in path.parents or path in root.parents:
        raise InstallError("unsafe_path", str(path))
    if create:
        path.mkdir(parents=True, exist_ok=True, mode=0o700)
    if not path.is_dir() or path.stat().st_uid != os.getuid():
        raise InstallError("unsafe_path", str(path))
    if create:
        os.chmod(path, 0o700)
    return path


def metadata(root):
    root = no_links(root)
    value = read_json(at(root, META))
    if (value.get("schema") != 1 or not re.fullmatch(r"[0-9a-f]{32}", str(value.get("install_id", "")))
            or value.get("root") != str(root)
            or value.get("language") not in ("zh-CN", "en")
            or value.get("engine") not in ("claude", "codex")
            or not isinstance(value.get("manager_home"), str)):
        raise InstallError("not_managed")
    external_home(Path(value["manager_home"]), root, create=False)
    return value


def git(root, *args, input=None, index=None):
    environ = {key: value for key, value in os.environ.items() if not key.startswith("GIT_")}
    environ.update({"GIT_CONFIG_NOSYSTEM": "1", "GIT_CONFIG_GLOBAL": os.devnull,
                    "GIT_NO_REPLACE_OBJECTS": "1",
                    "GIT_AUTHOR_NAME": "Auto Company Installer", "GIT_AUTHOR_EMAIL": "installer@localhost",
                    "GIT_COMMITTER_NAME": "Auto Company Installer", "GIT_COMMITTER_EMAIL": "installer@localhost"})
    if index:
        environ["GIT_INDEX_FILE"] = str(index)
    try:
        result = subprocess.run(["git", "-c", "core.hooksPath=" + str(root / ".git/installer-empty-hooks"),
                                 "-c", "commit.gpgsign=false", "-c", "core.autocrlf=false",
                                 "-c", "core.eol=lf", "-C", str(root), *args],
                                env=environ, input=input, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=90)
    except FileNotFoundError as error:
        raise InstallError("dependency", "git") from error
    if result.returncode:
        raise InstallError("git_changed", result.stderr.decode("utf-8", "replace")[-4000:])
    return result.stdout


def initialize_git(root):
    if (root / ".git").exists():
        raise InstallError("existing_target")
    with tempfile.TemporaryDirectory(prefix="auto-company-empty-template-") as template:
        git(root, "init", "--template=" + template, "--initial-branch=installed")
    git(root, "config", "core.autocrlf", "false")
    git(root, "config", "core.eol", "lf")
    git(root, "config", "core.filemode", "false" if os.environ.get("WSL_DISTRO_NAME") else "true")
    git(root, "config", "core.hooksPath", str(root / ".git/installer-empty-hooks"))


def baseline(root, manifest, parent=None):
    # Hash raw bytes, bypassing attributes, filters, user identity and signing.
    with tempfile.TemporaryDirectory(prefix="auto-company-index-") as temp:
        index = Path(temp) / "index"
        records = []
        for entry in manifest["files"]:
            data = manifest["registry_baseline"].encode() if entry["path"] == REGISTRY else at(root, entry["path"]).read_bytes()
            if hashlib.sha256(data).hexdigest() != entry["sha256"]:
                raise InstallError("integrity", entry["path"])
            oid = git(root, "hash-object", "--no-filters", "-w", "--stdin", input=data).strip()
            records.append(entry["mode"].encode() + b" " + oid + b"\t" + entry["path"].encode() + b"\0")
        git(root, "update-index", "-z", "--index-info", input=b"".join(records), index=index)
        tree = git(root, "write-tree", index=index).decode().strip()
        args = ["commit-tree", tree]
        if parent:
            args += ["-p", parent]
        commit = git(root, *args, input=("Local distribution baseline " + manifest["version"] + "\nUpstream source: " + manifest["source_commit"] + "\n").encode()).decode().strip()
        git(root, "update-ref", BRANCH, commit, parent or "0" * 40)
        git(root, "symbolic-ref", "HEAD", BRANCH)
        atomic_bytes(root / ".git/index", index.read_bytes(), 0o600)
    return commit


def check_git(root, meta, manifest):
    if (meta.get("version") != manifest["version"] or meta.get("source_commit") != manifest["source_commit"]
            or meta.get("registry_baseline") != manifest["registry_baseline"]):
        raise InstallError("git_changed", "release identity")
    if not (root / ".git").is_dir() or (root / ".git").is_symlink():
        raise InstallError("git_changed", ".git")
    for path in (root / ".git").rglob("*"):
        no_links(path)
    if (git(root, "rev-parse", "--show-toplevel").decode().strip() != str(root)
            or git(root, "symbolic-ref", "HEAD").decode().strip() != BRANCH
            or git(root, "rev-parse", "HEAD").decode().strip() != meta.get("managed_baseline")
            or git(root, "for-each-ref", "--format=%(refname)").decode().splitlines() != [BRANCH]
            or git(root, "remote").strip()
            or git(root, "diff", "--cached", "--name-only").strip()):
        raise InstallError("git_changed")
    names = set(git(root, "ls-files", "-z").decode().strip("\0").split("\0"))
    if names != {item["path"] for item in manifest["files"]}:
        raise InstallError("git_changed", "index paths")
    # Also verify that the recorded baseline itself is the distribution tree.
    # A changed manifest cannot silently redefine ownership of user files.
    tree = git(root, "ls-tree", "-rz", "HEAD")
    entries = {}
    for record in tree.split(b"\0"):
        if record:
            info, name = record.split(b"\t", 1)
            mode, kind, oid = info.split()
            entries[name.decode()] = (mode.decode(), oid)
    for entry in manifest["files"]:
        mode, oid = entries.get(entry["path"], (None, b""))
        if mode != entry["mode"] or hashlib.sha256(git(root, "cat-file", "blob", oid.decode())).hexdigest() != entry["sha256"]:
            raise InstallError("git_changed", entry["path"])


def registry_rows(text):
    lines = text.splitlines()
    header = "name\tpath\tlifecycle\tcreated_at_utc"
    if not lines or lines[0] != header:
        raise InstallError("conflict", REGISTRY)
    rows = {}
    for line in lines[1:]:
        cells = line.split("\t")
        if len(cells) != 4 or not all(cells) or cells[0] in rows:
            raise InstallError("conflict", REGISTRY)
        rows[cells[0]] = tuple(cells)
    return rows


def merge_registry(old, local, new):
    old_rows, local_rows, new_rows = (registry_rows(text) for text in (old, local, new))
    result = {}
    for name, before in old_rows.items():
        current = local_rows.get(name)
        if current != before:
            raise InstallError("conflict", REGISTRY + ": " + name)
        if name in new_rows:
            result[name] = new_rows[name]
    for name, row in local_rows.items():
        if name not in old_rows:
            if name in new_rows and row != new_rows[name]:
                raise InstallError("conflict", REGISTRY + ": " + name)
            # A same-name user row is never silently adopted as a release row.
            if name in new_rows:
                raise InstallError("conflict", REGISTRY + ": " + name)
            result[name] = row
    for name, row in new_rows.items():
        if name not in old_rows:
            if any(existing[1] == row[1] for existing in result.values()):
                raise InstallError("conflict", REGISTRY + ": " + name)
            result[name] = row
    return "name\tpath\tlifecycle\tcreated_at_utc\n" + "".join("\t".join(row) + "\n" for row in result.values())


def file_conflicts(root, old, new=None):
    conflicts = []
    old_names = {entry["path"] for entry in old["files"]}
    for entry in old["files"]:
        if entry["path"] == REGISTRY:
            continue
        path = at(root, entry["path"])
        if not path.is_file() or digest(path) != entry["sha256"]:
            conflicts.append(entry["path"])
        elif not os.environ.get("WSL_DISTRO_NAME") and bool(path.stat().st_mode & 0o111) != (entry["mode"] == "100755"):
            conflicts.append(entry["path"])
    if new:
        for entry in new["files"]:
            path = at(root, entry["path"])
            if entry["path"] not in old_names and path.exists():
                conflicts.append(entry["path"])
    if conflicts:
        raise InstallError("conflict", conflicts)


def health_check(root, manifest):
    """Check program syntax and package identity without importing application code."""
    for entry in manifest["files"]:
        if entry["path"].endswith(".py"):
            try:
                compile(at(root, entry["path"]).read_bytes(), entry["path"], "exec")
            except (SyntaxError, ValueError) as error:
                raise InstallError("integrity", entry["path"] + ": " + str(error)) from error
    package = at(root, "package.json")
    if package.is_file() and read_json(package, "integrity").get("version") != manifest["version"]:
        raise InstallError("integrity", "package.json version")


def copy_payload(source, destination, manifest):
    for entry in manifest["files"]:
        path = at(destination, entry["path"])
        atomic_bytes(path, at(source, entry["path"]).read_bytes(), int(entry["mode"], 8) & 0o777)
    write_json(destination / "release-files.json", manifest)


def require_space(root, size):
    if shutil.disk_usage(root).free < size * 2 + 8 * 1024 * 1024:
        raise InstallError("space")


def install(args):
    posix_required()
    source, root = no_links(Path(args.source)), no_links(Path(args.target))
    manifest = verify_payload(source, strict=False)
    language = language_for(args.language, root)
    if (root / MARKER).exists():
        marker = read_json(root / MARKER, "transaction_invalid")
        if marker.get("operation") == "install":
            return resume_install(args, root, source, manifest, marker)
        raise InstallError("maintenance", marker.get("transaction"))
    if (root / META).exists():
        meta = metadata(root)
        if (root / MARKER).exists():
            raise InstallError("maintenance", recovery_command(root, meta))
        if (meta.get("source_commit") != manifest["source_commit"] or meta.get("engine") != args.engine
                or meta.get("distro") != args.distro):
            raise InstallError("existing_target")
        if not args.yes:
            raise InstallError("confirmation", {"operation": "resume", "target": str(root)})
        with maintenance_locks(root):
            if (root / MARKER).exists():
                raise InstallError("maintenance", recovery_command(root, meta))
            check_git(root, meta, read_manifest(root))
            file_conflicts(root, read_manifest(root))
            registrations(root, meta)
            if args.language:
                meta["language"] = args.language
                write_json(root / META, meta)
        return {"code": "installed", "root": str(root), "version": meta["version"], "resumed": True}
    if root.exists() and (root != source or (root / ".git").exists()):
        raise InstallError("existing_target")
    if root == source:
        verify_payload(source, strict=True)
    if not args.yes:
        raise InstallError("confirmation", {"operation": "install", "target": str(root), "version": manifest["version"]})
    home = external_home(Path(args.manager_home) if args.manager_home else default_home(), root)
    root.parent.mkdir(parents=True, exist_ok=True)
    payload_size = sum(at(source, entry["path"]).stat().st_size for entry in manifest["files"])
    require_space(root.parent, payload_size)
    require_space(home, payload_size)
    install_id = uuid.uuid4().hex
    state_dir = home / install_id
    state_dir.mkdir(mode=0o700)
    # Initial install intent and executor are external before the first copy.
    executor = stage_executor(state_dir)
    cache = state_dir / "payload"
    cache.mkdir()
    copy_payload(source, cache, manifest)
    verify_payload(cache)
    intent = {"schema": 1, "install_id": install_id, "root": str(root), "source": str(cache),
              "original_source": str(source),
              "source_commit": manifest["source_commit"], "language": language, "phase": "installing",
              "in_place": root == source, "engine": args.engine, "distro": args.distro,
              "manager_home": str(home), "manifest": manifest}
    write_json(state_dir / "install-intent.json", intent)
    if root != source:
        root.mkdir()
    write_json(root / MARKER, {"schema": 1, "install_id": install_id, "manager_home": str(home),
                              "operation": "install", "transaction": str(state_dir)})
    try:
        copy_payload(cache, root, manifest)
        health_check(root, manifest)
        initialize_git(root)
        commit = baseline(root, manifest)
        # Only NEW installation config gets a language. Existing product pins
        # cannot enter this branch because nonempty arbitrary targets are denied.
        # Reuse the shared plain-settings formatter while the installer owns
        # maintenance; calling its public writer would correctly hit the guard.
        if (root / "scripts/core/localization.py").is_file():
            module = localization(root)
            atomic_bytes(root / ".auto-company.local", module.updated_settings(b"", {module.KEY: language}), 0o600)
        else:
            atomic_bytes(root / ".auto-company.local", ("AUTO_COMPANY_LANGUAGE=" + language + "\n").encode())
        meta = {"schema": 1, "install_id": install_id, "root": str(root), "source_commit": manifest["source_commit"],
                "version": manifest["version"], "managed_baseline": commit, "language": language,
                "engine": args.engine, "distro": args.distro, "manager_home": str(home),
                "registry_baseline": manifest["registry_baseline"], "registrations": [], "status": "ready"}
        write_json(root / META, meta)
        file_conflicts(root, manifest)
        check_git(root, meta, manifest)
        intent["phase"] = "complete"
        write_json(state_dir / "install-intent.json", intent)
        clear_marker(root)
    except Exception:
        # Do not guess what can be deleted after an interrupted initial install.
        # The external intent makes the partial target identifiable for recovery.
        write_json(root / MARKER, {"schema": 1, "install_id": install_id, "manager_home": str(home),
                                  "operation": "install", "transaction": str(state_dir)})
        raise
    return {"code": "installed", "root": str(root), "version": manifest["version"], "executor": str(executor)}


def resume_install(args, root, source, manifest, marker):
    """Resume only an externally identified initial copy; reject new user data."""
    directory = no_links(Path(marker.get("transaction", "")))
    intent = read_json(directory / "install-intent.json", "transaction_invalid")
    if (directory != Path(intent.get("manager_home", "/missing")) / str(intent.get("install_id", "missing"))
            or intent.get("root") != str(root) or intent.get("install_id") != marker.get("install_id")
            or intent.get("manifest") != manifest or intent.get("engine") != args.engine
            or intent.get("phase") not in ("installing", "complete")):
        raise InstallError("transaction_invalid")
    if not args.yes:
        raise InstallError("confirmation", {"operation": "resume", "target": str(root)})
    allowed = {entry["path"]: entry for entry in manifest["files"]}
    for path in root.rglob("*"):
        no_links(path)
        relative = path.relative_to(root).as_posix()
        if path.is_dir() or relative.startswith(".git/") or relative in ("release-files.json", MARKER, META):
            continue
        if relative == ".auto-company.local":
            expected = ("AUTO_COMPANY_LANGUAGE=" + intent["language"] + "\n").encode()
            if path.read_bytes() == expected:
                continue
        entry = allowed.get(relative)
        if entry is None or digest(path) != entry["sha256"]:
            raise InstallError("conflict", relative)
    # Retain partial Git evidence outside the install, never delete or reset it.
    if (root / ".git").exists():
        if git(root, "remote").strip():
            raise InstallError("git_changed")
        archive_git(root, directory / ("partial-git-" + uuid.uuid4().hex))
    language = args.language or intent["language"]
    intent["language"] = language
    write_json(directory / "install-intent.json", intent)
    copy_payload(source, root, manifest)
    health_check(root, manifest)
    initialize_git(root)
    commit = baseline(root, manifest)
    atomic_bytes(root / ".auto-company.local", ("AUTO_COMPANY_LANGUAGE=" + language + "\n").encode(), 0o600)
    meta = {"schema": 1, "install_id": intent["install_id"], "root": str(root), "source_commit": manifest["source_commit"],
            "version": manifest["version"], "managed_baseline": commit, "language": language, "engine": args.engine,
            "distro": intent.get("distro"), "manager_home": intent["manager_home"],
            "registry_baseline": manifest["registry_baseline"], "registrations": [], "status": "ready"}
    write_json(root / META, meta)
    file_conflicts(root, manifest)
    check_git(root, meta, manifest)
    health_check(root, manifest)
    intent["phase"] = "complete"
    write_json(directory / "install-intent.json", intent)
    clear_marker(root)
    return {"code": "installed", "root": str(root), "version": manifest["version"], "resumed": True}


def stage_executor(directory):
    executor = directory / "executor"
    executor.mkdir(mode=0o700)
    for name in EXECUTOR_FILES:
        atomic_bytes(executor / name, (Path(__file__).resolve().parent / name).read_bytes(), 0o600)
    return executor / "manager.py"


def copy_git_tree(source, destination):
    """Copy raw Git bytes durably; no checkout, filters, symlinks or device files."""
    destination.mkdir()
    entries = {}
    for path in source.rglob("*"):
        no_links(path)
        if path.is_dir():
            continue
        if not path.is_file():
            raise InstallError("unsafe_path", str(path))
        relative = path.relative_to(source).as_posix()
        data = path.read_bytes()
        expected = hashlib.sha256(data).hexdigest()
        atomic_bytes(at(destination, relative), data, path.stat().st_mode & 0o777)
        if digest(path) != expected or digest(at(destination, relative)) != expected:
            raise InstallError("git_changed", relative)
        entries[relative] = expected
    return entries


def archive_git(root, destination):
    """Cross-filesystem archive of this installation's own exact .git directory."""
    source = at(root, ".git")
    entries = copy_git_tree(source, destination)
    current = {path.relative_to(source).as_posix() for path in source.rglob("*") if path.is_file()}
    if current != set(entries):
        raise InstallError("git_changed", ".git")
    for relative, expected in entries.items():
        path = at(source, relative)
        if digest(path) != expected:
            raise InstallError("git_changed", relative)
    for relative in entries:
        at(source, relative).unlink()
    for path in sorted(source.rglob("*"), key=lambda item: len(item.parts), reverse=True):
        no_links(path)
        path.rmdir()  # A new/unknown file makes this fail instead of being deleted.
    source.rmdir()
    sync_directory(root)


def recovery_command(root, meta, transaction=None):
    if transaction is None:
        try:
            transaction = read_json(root / MARKER, "transaction_invalid")["transaction"]
        except (InstallError, KeyError):
            transaction = meta.get("last_transaction", "")
    return [sys.executable, str(Path(transaction) / "executor/manager.py"), "recover", "--root", str(root),
            "--transaction", str(transaction), "--language", meta.get("language", "en"), "--yes"]


def process_alive(pid):
    if type(pid) is not int or pid <= 0:
        return True
    try:
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False
    except (PermissionError, OSError):
        return True


def check_writers(root):
    for relative in (".auto-company.local.team-active", ".auto-company.local.language-update"):
        if at(root, relative).exists():
            raise InstallError("busy", relative)
    writers = at(root, ".auto-company/writers")
    if writers.exists():
        for path in writers.iterdir():
            state = read_json(path, "busy")
            if writer_is_alive(state) is not False:
                raise InstallError("busy", str(path))
    # Explicit process markers are not treated as proof of death across hosts.
    for relative in (".auto-loop-wsl-anchor.pid", ".auto-loop-awake.pid"):
        if at(root, relative).exists() and at(root, relative).read_bytes().strip():
            raise InstallError("busy", relative)


@contextmanager
def maintenance_locks(root, recovering=False):
    # Project helpers inherit this flock even if their parent shell exits.
    # Match the runtime's project -> configuration lock order and retain the
    # persistent inode so waiting helpers cannot enter through a replaced lock.
    import fcntl
    project_lock = at(root, ".auto-company/project-registry.lock")
    descriptor = os.open(project_lock, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    with os.fdopen(descriptor, "r+") as project:
        try:
            fcntl.flock(project, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            raise InstallError("busy", str(project_lock)) from error
        with maintenance_config_locks(root, recovering=recovering):
            yield


@contextmanager
def maintenance_config_locks(root, recovering=False):
    import fcntl
    config = at(root, ".auto-company.local.lock")
    git_lock = at(root, ".git/index.lock") if (root / ".git").is_dir() else None
    owned_git_lock = None
    if recovering and config.is_dir():
        owner = read_json(config / "installer-owner.json", "busy")
        marker = read_json(root / MARKER, "transaction_invalid") if (root / MARKER).exists() else {"transaction": None}
        if (owner.get("host") == platform.system().lower() and not process_alive(owner.get("pid"))
                and owner.get("transaction") == marker.get("transaction")
                and list(config.iterdir()) == [config / "installer-owner.json"]):
            (config / "installer-owner.json").unlink()
            config.rmdir()
    try:
        config.mkdir()
    except FileExistsError as error:
        raise InstallError("busy", str(config)) from error
    try:
        marker = read_json(root / MARKER, "transaction_invalid") if (root / MARKER).exists() else {"transaction": None}
        write_json(config / "installer-owner.json", {"pid": os.getpid(), "host": platform.system().lower(),
                                                     "transaction": marker["transaction"]})
        with at(root, ".auto-loop.pid").open("a+") as lock:
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError as error:
                raise InstallError("busy", ".auto-loop.pid") from error
            check_writers(root)
            if git_lock:
                if recovering and git_lock.exists():
                    owner = read_json(git_lock, "git_changed")
                    if (owner.get("installer") == 1 and owner.get("host") == platform.system().lower()
                            and not process_alive(owner.get("pid")) and owner.get("transaction") == marker["transaction"]):
                        git_lock.unlink()
                owned_git_lock = json.dumps({"installer": 1, "pid": os.getpid(), "host": platform.system().lower(),
                                             "transaction": marker["transaction"]}).encode()
                try:
                    descriptor = os.open(git_lock, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
                except FileExistsError as error:
                    owned_git_lock = None
                    raise InstallError("git_changed", ".git/index.lock") from error
                with os.fdopen(descriptor, "wb") as stream:
                    stream.write(owned_git_lock)
                    stream.flush()
                    os.fsync(stream.fileno())
            yield
    finally:
        if owned_git_lock is not None and git_lock.is_file() and git_lock.read_bytes() == owned_git_lock:
            git_lock.unlink()
        (config / "installer-owner.json").unlink(missing_ok=True)
        config.rmdir()


def service_owned(path, kind, root):
    no_links(path)
    data = path.read_bytes()
    if kind == "systemd":
        lines = data.decode("utf-8").splitlines()
        workdirs = [line.split("=", 1)[1].replace("%%", "%") for line in lines if line.startswith("WorkingDirectory=")]
        escaped = str(root).replace("\\", "\\\\").replace('"', '\\"').replace("%", "%%")
        starts = [line.split("=", 1)[1] for line in lines if line.startswith("ExecStart=")]
        if workdirs != [str(root)] or starts != ['/usr/bin/bash "' + escaped + '/scripts/core/auto-loop.sh"']:
            raise InstallError("service_conflict", str(path))
        if path.name != "auto-company.service":
            raise InstallError("service_conflict", str(path))
    elif kind == "launchd":
        value = plistlib.loads(data)
        if (value.get("WorkingDirectory") != str(root) or value.get("Label") != "com.autocompany.loop"
                or value.get("ProgramArguments") != ["/bin/bash", str(root / "scripts/core/auto-loop.sh"), "--daemon"]):
            raise InstallError("service_conflict", str(path))
    else:
        # Launchers must contain their exact installation path and be registered
        # explicitly by the bootstrap, not discovered by broad filesystem scans.
        if str(root).encode() not in data:
            raise InstallError("service_conflict", str(path))


def service_stopped(path, kind):
    try:
        if kind == "systemd":
            result = subprocess.run(["systemctl", "--user", "show", "auto-company.service", "--property=ActiveState,SubState,MainPID,FragmentPath"], capture_output=True, text=True, timeout=10)
            values = dict(line.split("=", 1) for line in result.stdout.splitlines() if "=" in line)
            if (result.returncode or values.get("ActiveState") not in ("inactive", "failed")
                    or values.get("MainPID") != "0" or values.get("SubState") not in ("dead", "failed")
                    or Path(values.get("FragmentPath", "")).resolve() != path.resolve()):
                raise InstallError("service_conflict", str(path))
        elif kind == "launchd":
            result = subprocess.run(["launchctl", "print", "gui/" + str(os.getuid()) + "/com.autocompany.loop"], capture_output=True, text=True, timeout=10)
            if result.returncode == 0 or "Could not find service" not in result.stderr:
                raise InstallError("service_conflict", str(path))
    except (OSError, subprocess.SubprocessError) as error:
        raise InstallError("service_conflict", str(path)) from error


def registrations(root, meta, uninstall=False):
    result = meta.get("registrations", [])
    if not isinstance(result, list):
        raise InstallError("not_managed")
    for item in result:
        if not isinstance(item, dict) or item.get("kind") not in ("systemd", "launchd", "launcher"):
            raise InstallError("service_conflict")
        path = no_links(Path(item.get("path", "")))
        if not path.is_file() or digest(path) != item.get("sha256"):
            raise InstallError("service_conflict", str(path))
        service_owned(path, item["kind"], root)
        service_stopped(path, item["kind"])
        if uninstall and item["kind"] == "systemd":
            enabled = subprocess.run(["systemctl", "--user", "is-enabled", "auto-company.service"], capture_output=True, text=True, timeout=10)
            if enabled.stdout.strip() != "disabled":
                raise InstallError("service_conflict", "systemctl --user disable auto-company.service")
    return result


def refresh_services(entries):
    if any(entry["kind"] == "systemd" for entry in entries):
        try:
            result = subprocess.run(["systemctl", "--user", "daemon-reload"], capture_output=True, text=True, timeout=15)
        except (OSError, subprocess.SubprocessError) as error:
            raise InstallError("service_conflict", "systemctl --user daemon-reload") from error
        if result.returncode:
            raise InstallError("service_conflict", result.stderr[-2000:])


def register(args):
    posix_required()
    root = no_links(Path(args.root))
    meta = metadata(root)
    if (root / MARKER).exists():
        raise InstallError("maintenance", recovery_command(root, meta))
    with maintenance_locks(root):
        if (root / MARKER).exists():
            raise InstallError("maintenance", recovery_command(root, meta))
        path = no_links(Path(args.path))
        service_owned(path, args.kind, root)
        service_stopped(path, args.kind)
        item = {"path": str(path), "kind": args.kind, "sha256": digest(path)}
        meta["registrations"] = [entry for entry in meta.get("registrations", []) if entry["path"] != str(path)] + [item]
        write_json(root / META, meta)
    return {"code": "registered", "registration": item}


def runtime_fingerprint(root):
    files = []
    for relative in (".auto-company.local", ".auto-loop.env", ".auto-company"):
        candidate = at(root, relative)
        files.extend(candidate.rglob("*") if candidate.is_dir() else [candidate])
    result = {}
    for path in files:
        name = path.relative_to(root).as_posix()
        if name in (META, MARKER) or name.startswith(".auto-company/writers/") or path.is_dir() or not path.exists():
            continue
        no_links(path)
        result[name] = digest(path)
    return result


def doctor(args):
    root = no_links(Path(args.root))
    meta = metadata(root)
    if (root / MARKER).exists():
        raise InstallError("maintenance", recovery_command(root, meta))
    manifest = read_manifest(root)
    file_conflicts(root, manifest)
    check_git(root, meta, manifest)
    merge_registry(manifest["registry_baseline"], at(root, REGISTRY).read_text(encoding="utf-8"), manifest["registry_baseline"])
    return {"code": "healthy", "root": str(root), "version": meta["version"], "engine": meta["engine"],
            "model_check": "not_requested", "login": "unverified", "maintenance": False}


def backup_file(root, relative, directory):
    path = at(root, relative)
    if path.exists():
        if not path.is_file():
            raise InstallError("unsafe_path", str(path))
        target = directory / relative
        atomic_bytes(target, path.read_bytes(), path.stat().st_mode & 0o777)
        return {"present": True, "sha256": digest(target), "mode": path.stat().st_mode & 0o777}
    return {"present": False}


def snapshot(root, transaction, state, paths):
    backup = transaction / "backup"
    backup.mkdir()
    state["files"] = {name: backup_file(root, name, backup) for name in sorted(set(paths) | {META, "release-files.json"})}
    git_dir = at(root, ".git")
    for path in git_dir.rglob("*"):
        no_links(path)
    state["git_files"] = copy_git_tree(git_dir, transaction / "git-backup")
    state["git_files"].pop("index.lock", None)  # This process owns the maintenance index lock.
    state["external"] = []
    for index, entry in enumerate(state["metadata"].get("registrations", [])):
        target = transaction / "external" / str(index)
        path = Path(entry["path"])
        atomic_bytes(target, path.read_bytes(), path.stat().st_mode & 0o777)
        state["external"].append({**entry, "backup": str(index), "mode": path.stat().st_mode & 0o777})
    state["phase"] = "backed_up"
    write_json(transaction / "transaction.json", state)


def verify_backup(transaction, state):
    for name, entry in state.get("files", {}).items():
        at(Path(state["root"]), name)
        if entry["present"] and digest(at(transaction / "backup", name)) != entry["sha256"]:
            raise InstallError("transaction_invalid", name)
    for name, expected in state.get("git_files", {}).items():
        if digest(at(transaction / "git-backup", name)) != expected:
            raise InstallError("transaction_invalid", ".git/" + name)
    for entry in state.get("external", []):
        if digest(at(transaction / "external", entry["backup"])) != entry["sha256"]:
            raise InstallError("transaction_invalid", entry["path"])


def restore(root, transaction, state):
    verify_backup(transaction, state)
    state["phase"] = "restoring"
    write_json(transaction / "transaction.json", state)
    for name, entry in state["files"].items():
        path = at(root, name)
        if entry["present"]:
            atomic_bytes(path, at(transaction / "backup", name).read_bytes(), entry["mode"])
        elif path.exists():
            if not path.is_file():
                raise InstallError("transaction_invalid", name)
            path.unlink()
    # Restore individual raw Git bytes; no checkout/reset or filter conversion.
    git_dir = at(root, ".git")
    git_dir.mkdir(exist_ok=True)
    # Unreferenced objects written by the failed update are harmless. Preserve
    # any additional Git files rather than deleting unknown concurrent data.
    for name in state["git_files"]:
        source = at(transaction / "git-backup", name)
        atomic_bytes(at(git_dir, name), source.read_bytes(), source.stat().st_mode & 0o777)
    for entry in state.get("external", []):
        path = no_links(Path(entry["path"]))
        # Never overwrite an external file changed after the transaction began.
        if path.exists() and digest(path) != entry["sha256"]:
            raise InstallError("service_conflict", str(path))
        atomic_bytes(path, at(transaction / "external", entry["backup"]).read_bytes(), entry["mode"])
    if state["operation"] == "uninstall":
        refresh_services(state.get("external", []))
    meta = metadata(root)
    check_git(root, meta, read_manifest(root))
    file_conflicts(root, read_manifest(root))
    state["phase"] = "recovered"
    write_json(transaction / "transaction.json", state)


def load_transaction(root, transaction):
    transaction = no_links(transaction)
    state = read_json(transaction / "transaction.json", "transaction_invalid")
    meta = state.get("metadata", {})
    expected = Path(meta.get("manager_home", "/missing")) / str(meta.get("install_id", "missing")) / "transactions" / transaction.name
    if (state.get("schema") != 1 or state.get("root") != str(root) or transaction != expected
            or state.get("install_id") != meta.get("install_id")
            or state.get("operation") not in ("update", "rollback", "uninstall")):
        raise InstallError("transaction_invalid")
    old = validate_manifest(state.get("old_manifest"))
    new = validate_manifest(state["new_manifest"]) if state.get("new_manifest") is not None else None
    permitted = {entry["path"] for entry in old["files"]} | {META, "release-files.json"}
    if new:
        permitted.update(entry["path"] for entry in new["files"])
    if "files" in state and set(state["files"]) != permitted:
        raise InstallError("transaction_invalid", "backup paths")
    if "external" in state and [{key: item[key] for key in ("path", "kind", "sha256")} for item in state["external"]] != meta.get("registrations", []):
        raise InstallError("transaction_invalid", "external registrations")
    return state


def stage_operation(args):
    posix_required()
    root = no_links(Path(args.root))
    meta = metadata(root)
    if (root / MARKER).exists():
        raise InstallError("maintenance", recovery_command(root, meta))
    old = read_manifest(root)
    check_git(root, meta, old)
    file_conflicts(root, old)
    source = None
    if args.command == "update":
        source = no_links(Path(args.source))
        new = verify_payload(source, strict=False)
    elif args.command == "rollback":
        previous = meta.get("last_transaction")
        if not previous:
            raise InstallError("rollback_unavailable")
        previous_path = no_links(Path(previous))
        prior = load_transaction(root, previous_path)
        if prior.get("phase") != "complete" or prior.get("operation") != "update":
            raise InstallError("rollback_unavailable")
        if runtime_fingerprint(root) != prior.get("runtime_fingerprint"):
            raise InstallError("data_changed")
        verify_backup(previous_path, prior)
        new = validate_manifest(prior["old_manifest"])
        source = previous_path / "backup"
    else:
        new = None
    merged = merge_registry(old["registry_baseline"], at(root, REGISTRY).read_text(encoding="utf-8"),
                            new["registry_baseline"] if new else "name\tpath\tlifecycle\tcreated_at_utc\n")
    file_conflicts(root, old, new)
    registrations(root, meta, uninstall=args.command == "uninstall")
    if not args.yes:
        raise InstallError("confirmation", {"operation": args.command, "from": old["version"], "to": new["version"] if new else None})
    home = external_home(Path(meta["manager_home"]), root)
    directory = home / meta["install_id"] / "transactions" / uuid.uuid4().hex
    directory.mkdir(parents=True, mode=0o700)
    estimate = sum(at(root, entry["path"]).stat().st_size for entry in old["files"])
    estimate += sum(path.stat().st_size for path in (root / ".git").rglob("*") if path.is_file())
    if new:
        estimate += sum(at(source, entry["path"]).stat().st_size for entry in new["files"])
    require_space(home, estimate)
    require_space(root, estimate)
    executor = stage_executor(directory)
    if new:
        stage = directory / "payload"
        stage.mkdir()
        copy_payload(source, stage, new)
        # Rollback backups contain the mixed registry; always use the exact
        # original distribution bytes for the next Git baseline.
        atomic_bytes(stage / REGISTRY, new["registry_baseline"].encode(), 0o644)
        verify_payload(stage)
    state = {"schema": 1, "install_id": meta["install_id"], "root": str(root), "operation": args.command,
             "metadata": meta, "old_manifest": old, "new_manifest": new, "merged_registry": merged,
             "phase": "prepared", "created": int(time.time()), "language": language_for(args.language, root)}
    if args.command == "rollback":
        state["required_runtime_fingerprint"] = prior["runtime_fingerprint"]
    write_json(directory / "transaction.json", state)
    result = subprocess.run([sys.executable, "-B", str(executor), "_execute", "--root", str(root),
                             "--transaction", str(directory), "--language", state["language"], "--json"], capture_output=True, text=True)
    try:
        output = json.loads(result.stdout)
    except ValueError as error:
        raise InstallError("operation_failed", {"transaction": str(directory), "recovery": recovery_command(root, meta, directory),
                                                "diagnostics": (result.stderr or result.stdout)[-4000:]}) from error
    if result.returncode:
        raise InstallError(output.get("code", "operation_failed"), output.get("details"))
    return output


def execute_transaction(args):
    posix_required()
    root, transaction = no_links(Path(args.root)), no_links(Path(args.transaction))
    state = load_transaction(root, transaction)
    if state["phase"] != "prepared":
        raise InstallError("transaction_invalid")
    meta = metadata(root)
    if meta != state["metadata"]:
        raise InstallError("transaction_invalid")
    marker = {"schema": 1, "install_id": meta["install_id"], "transaction": str(transaction),
              "manager_home": meta["manager_home"], "operation": state["operation"]}
    # Atomic publication arbitrates concurrent maintainers; the marker closes the
    # runtime-start race before acquiring the runtime's own locks.
    publish_marker(root, marker)
    try:
        with maintenance_locks(root):
            old, new = state["old_manifest"], state["new_manifest"]
            check_git(root, meta, old)
            file_conflicts(root, old, new)
            registrations(root, meta, uninstall=state["operation"] == "uninstall")
            if (state["operation"] == "rollback"
                    and runtime_fingerprint(root) != state.get("required_runtime_fingerprint")):
                raise InstallError("data_changed")
            current_merge = merge_registry(old["registry_baseline"], at(root, REGISTRY).read_text(encoding="utf-8"),
                                            new["registry_baseline"] if new else "name\tpath\tlifecycle\tcreated_at_utc\n")
            if current_merge != state["merged_registry"]:
                raise InstallError("conflict", REGISTRY)
            paths = {entry["path"] for entry in old["files"]}
            if new:
                paths.update(entry["path"] for entry in new["files"])
            snapshot(root, transaction, state, paths)
            try:
                state["phase"] = "applying"
                write_json(transaction / "transaction.json", state)
                if new:
                    verify_payload(transaction / "payload")
                    copy_payload(transaction / "payload", root, new)
                    new_names = {entry["path"] for entry in new["files"]}
                    for entry in old["files"]:
                        if entry["path"] not in new_names:
                            at(root, entry["path"]).unlink()
                    atomic_bytes(root / REGISTRY, state["merged_registry"].encode(), 0o644)
                    meta.update({"version": new["version"], "source_commit": new["source_commit"],
                                 "registry_baseline": new["registry_baseline"],
                                 "managed_baseline": baseline(root, new, meta["managed_baseline"]),
                                 "last_transaction": str(transaction), "language": state["language"]})
                    write_json(root / META, meta)
                    file_conflicts(root, new)
                    check_git(root, meta, new)
                    health_check(root, new)
                else:
                    for entry in old["files"]:
                        if entry["path"] != REGISTRY:
                            at(root, entry["path"]).unlink()
                    atomic_bytes(root / REGISTRY, state["merged_registry"].encode(), 0o644)
                    for entry in state["external"]:
                        path = no_links(Path(entry["path"]))
                        if digest(path) != entry["sha256"]:
                            raise InstallError("service_conflict", str(path))
                        path.unlink()
                    refresh_services(state["external"])
                    # Move the managed Git repository into the transaction;
                    # independent product repositories never enter this path.
                    archive_git(root, transaction / "uninstalled-git")
                    meta["status"] = "uninstalled"
                    meta["last_transaction"] = str(transaction)
                    write_json(root / META, meta)
                    at(root, "release-files.json").unlink()
                state["runtime_fingerprint"] = runtime_fingerprint(root)
                state["phase"] = "complete"
                write_json(transaction / "transaction.json", state)
            except Exception as error:
                state["failure"] = str(error)
                write_json(transaction / "transaction.json", state)
                try:
                    restore(root, transaction, state)
                except Exception as recovery_error:
                    raise InstallError("recovery_failed", {"transaction": str(transaction), "recovery": recovery_command(root, meta, transaction),
                                                           "diagnostics": str(recovery_error)}) from error
                raise InstallError("operation_failed", {"transaction": str(transaction), "recovered": True, "diagnostics": str(error)}) from error
    except Exception:
        # Preflight failures have not changed program bytes. Removing our own
        # marker here is safe; incomplete snapshots/apply always retain it.
        if state["phase"] == "prepared":
            clear_marker(root)
            state["phase"] = "aborted"
            write_json(transaction / "transaction.json", state)
        elif state["phase"] == "recovered":
            clear_marker(root)
        raise
    clear_marker(root)
    return {"code": {"update": "updated", "rollback": "rolled_back", "uninstall": "uninstalled"}[state["operation"]],
            "transaction": str(transaction), "root": str(root), "version": meta.get("version")}


def recover(args):
    posix_required()
    root = no_links(Path(args.root))
    marker = read_json(at(root, MARKER), "transaction_invalid")
    transaction = no_links(Path(args.transaction or marker.get("transaction", "")))
    if marker.get("operation") == "install":
        intent = read_json(transaction / "install-intent.json", "transaction_invalid")
        args.source = intent.get("source")
        args.target = str(root)
        args.engine = intent.get("engine")
        args.distro = intent.get("distro")
        args.manager_home = intent.get("manager_home")
        return resume_install(args, root, no_links(Path(args.source)), verify_payload(Path(args.source), strict=False), marker)
    state = load_transaction(root, transaction)
    if marker.get("install_id") != state["install_id"] or marker.get("transaction") != str(transaction):
        raise InstallError("transaction_invalid")
    if not args.yes:
        raise InstallError("confirmation", recovery_command(root, state["metadata"], transaction))
    with maintenance_locks(root, recovering=True):
        if state["phase"] in ("prepared", "aborted"):
            pass  # No program bytes changed; release locks before the marker.
        elif state["phase"] == "complete":
            # Commit record is durable before marker removal. Verify installed
            # state before finishing this narrow crash window.
            if state["operation"] != "uninstall":
                meta = metadata(root)
                file_conflicts(root, read_manifest(root))
                check_git(root, meta, read_manifest(root))
        else:
            restore(root, transaction, state)
    clear_marker(root)
    return {"code": "recovered", "transaction": str(transaction)}


class Parser(argparse.ArgumentParser):
    def error(self, text):
        raise InstallError("invalid_arguments", text)


def parser():
    result = Parser(add_help=False)
    commands = result.add_subparsers(dest="command", required=True, parser_class=Parser)
    for name in ("install", "doctor", "update", "rollback", "uninstall", "recover", "register", "_execute"):
        command = commands.add_parser(name, add_help=False)
        command.add_argument("--language", choices=("zh-CN", "en"))
        command.add_argument("--json", action="store_true")
        command.add_argument("--yes", action="store_true")
        if name == "install":
            command.add_argument("--source", required=True)
            command.add_argument("--target", required=True)
            command.add_argument("--engine", choices=("claude", "codex"), required=True)
            command.add_argument("--distro")
            command.add_argument("--manager-home")
        else:
            command.add_argument("--root", required=True)
        if name == "update":
            command.add_argument("--source", required=True)
        if name in ("recover", "_execute"):
            command.add_argument("--transaction", required=name == "_execute")
        if name == "register":
            command.add_argument("--path", required=True)
            command.add_argument("--kind", choices=("systemd", "launchd", "launcher"), required=True)
    return result


def main(argv=None):
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")
    arguments = sys.argv[1:] if argv is None else argv
    explicit = arguments[arguments.index("--language") + 1] if "--language" in arguments and len(arguments) > arguments.index("--language") + 1 else None
    language = explicit if explicit in ("zh-CN", "en") else "en"
    try:
        if not arguments or "--help" in arguments or "-h" in arguments:
            language = language_for(explicit)
            result = {"ok": True, "code": "help", "message": message("help", language), "language": language}
            print(json.dumps(result, ensure_ascii=False) if "--json" in arguments else result["message"])
            return 0
        args = parser().parse_args(arguments)
        root = Path(getattr(args, "root", getattr(args, "target", "."))).absolute()
        language = language_for(args.language, root)
        handler = {"install": install, "doctor": doctor, "register": register, "recover": recover, "_execute": execute_transaction}.get(args.command, stage_operation)
        result = handler(args)
        result.update({"ok": True, "message": message(result["code"], language), "language": language})
        status = 0
    except InstallError as error:
        if error.code == "invalid_arguments":
            language = language_for(explicit)
        result = {"ok": False, "code": error.code, "message": message(error.code, language), "language": language, "details": error.details}
        status = 2 if error.code == "confirmation" else 1
    except (OSError, ValueError, subprocess.SubprocessError) as error:
        result = {"ok": False, "code": "operation_failed", "message": message("operation_failed", language), "language": language, "details": str(error)}
        status = 1
    if "--json" in arguments:
        print(json.dumps(result, ensure_ascii=False))
    else:
        print(result["message"])
        if result.get("details") is not None:
            print(json.dumps(result["details"], ensure_ascii=False, indent=2))
        if result.get("transaction"):
            print(result["transaction"])
    return status


if __name__ == "__main__":
    sys.exit(main())
