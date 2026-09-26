#!/usr/bin/env python3
"""POSIX execution-domain owner. Communication is files, never the center DB.

The admission protocol prevents accidental competing entry points for managed
roots. It is not a sandbox against another process running as the same user.
"""
from __future__ import annotations

import argparse
import ctypes
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import sys
import time

PROTOCOL = 1
MARKER = ".auto-company-center.json"
MAX_JSON = 128 * 1024
HEARTBEAT_TIMEOUT = 15
CONTROL_FILES = ("scripts/core/auto-loop.sh", "scripts/core/center_runner.py", "scripts/core/stop-loop.sh",
                 "scripts/core/project-context.py", "scripts/core/product_identity.py",
                 "scripts/core/localization.py", "scripts/core/runtime_artifacts.py", "dashboard/server.py", "Makefile",
                 "scripts/macos/start-daemon.sh", "scripts/macos/install-daemon.sh", "scripts/wsl/dashboard-wsl.sh",
                 "scripts/wsl/install-wsl-daemon.sh", "scripts/windows/start-win.ps1", "scripts/windows/stop-win.ps1")


def read_json(path):
    path = Path(path)
    if path.is_symlink() or path.stat().st_size > MAX_JSON:
        raise ValueError("unsafe_control_file")
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError("invalid_control_file")
    return value


def atomic_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + "." + str(os.getpid()) + ".tmp")
    with temporary.open("w", encoding="utf-8") as handle:
        json.dump(value, handle, ensure_ascii=False, sort_keys=True)
        handle.flush()
        os.fsync(handle.fileno())
    try:
        for attempt in range(51):
            try:
                os.replace(temporary, path)
                break
            except PermissionError:
                if attempt == 50:
                    raise
                time.sleep(0.02)
    finally:
        temporary.unlink(missing_ok=True)


def now():
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat()


def token(value):
    if not isinstance(value, str) or not re.fullmatch(r"[a-zA-Z0-9_-]{8,100}", value):
        raise ValueError("invalid_identity")
    return value


def domain_dir(center_id):
    base = Path(os.environ.get("XDG_STATE_HOME", str(Path.home() / ".local/state")))
    path = base / "auto-company/center-runners" / token(center_id)
    path.mkdir(mode=0o700, parents=True, exist_ok=True)
    return path


def lock_file(path):
    import fcntl
    descriptor = os.open(path, os.O_RDWR | os.O_CREAT, 0o600)
    try:
        fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BaseException:
        os.close(descriptor)
        raise
    return descriptor


def lock_free(path):
    try:
        descriptor = lock_file(path)
    except BlockingIOError:
        return False
    os.close(descriptor)
    return True


def existing_lock_free(path):
    """Observe a project writer lock without creating a source-side inode."""
    import fcntl
    try:
        descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    except FileNotFoundError:
        return True
    try:
        try:
            fcntl.flock(descriptor, fcntl.LOCK_SH | fcntl.LOCK_NB)
            return True
        except BlockingIOError:
            return False
    finally:
        os.close(descriptor)


def identity(pid):
    from product_media_process import proc_identity
    value = proc_identity(int(pid))
    if not value or value.get("state") == "Z":
        return None
    return {"pid": value["pid"], "start": value["start"], "boot": boot_id()}


def boot_id():
    path = Path("/proc/sys/kernel/random/boot_id")
    if path.is_file():
        return path.read_text().strip()
    result = subprocess.run(["sysctl", "-n", "kern.boottime"], capture_output=True, text=True, timeout=3, check=True)
    return result.stdout.strip()


def same_process(value):
    return bool(value and identity(value.get("pid", 0)) == value)


def marker_for(root):
    marker = read_json(Path(root) / MARKER)
    if marker.get("protocolVersion") != PROTOCOL:
        raise ValueError("incompatible_admission")
    for key in ("centerId", "runtimeId", "entryId", "sourceId"):
        token(marker.get(key))
    return marker


def control_for(manifest):
    value = read_json(Path(manifest["controlDir"]) / "control.json")
    for key in ("centerId", "requestId", "dispatchId", "nonce"):
        if value.get(key) != manifest.get(key):
            raise ValueError("control_identity_mismatch")
    if time.time() - float(value.get("heartbeat", 0)) > HEARTBEAT_TIMEOUT:
        raise ValueError("center_disconnected")
    if value.get("stop"):
        raise ValueError(value.get("reason") or "user_stop")
    return value


def admission(root):
    """Verify inherited OS lock ownership as well as dispatch/runner identity."""
    root = Path(root).resolve()
    if not (root / MARKER).exists() and not (root / MARKER).is_symlink():
        return
    import fcntl
    marker = marker_for(root)
    manifest = read_json(os.environ["AUTO_COMPANY_CENTER_MANIFEST"])
    if Path(manifest["root"]).resolve() != root:
        raise ValueError("root_mismatch")
    for key in ("centerId", "runtimeId", "entryId", "sourceId"):
        if manifest.get(key) != marker.get(key):
            raise ValueError("admission_identity_mismatch")
    descriptor = int(os.environ["AUTO_COMPANY_CENTER_SLOT_FD"])
    slot = domain_dir(marker["centerId"]) / "slot.lock"
    if (os.fstat(descriptor).st_dev, os.fstat(descriptor).st_ino) != (slot.stat().st_dev, slot.stat().st_ino):
        raise ValueError("admission_descriptor_mismatch")
    # An inherited descriptor references the same locked open-file description.
    fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
    if lock_free(slot):
        raise ValueError("admission_without_lock")
    owner = read_json(domain_dir(marker["centerId"]) / "owner.json")
    if any(owner.get(key) != manifest.get(key) for key in ("dispatchId", "requestId", "nonce", "runtimeId")):
        raise ValueError("admission_owner_mismatch")
    if not same_process(owner.get("runner")):
        raise ValueError("runner_disconnected")
    control_for(manifest)


def artifact_admission(root, cleanup=False):
    """Accept only descendants of the current loop/media owner.

    Model CLIs do not necessarily forward inherited FDs into tool shells. The
    process ancestry and pinned start identities prove that normal tool path;
    a caller-supplied cycle flag, manifest path or nonce alone does not.
    """
    root = Path(root).resolve()
    if not (root / MARKER).exists() and not (root / MARKER).is_symlink():
        return
    marker = marker_for(root)
    folder = domain_dir(marker["centerId"])
    owner = read_json(folder / "owner.json")
    if any(owner.get(key) != marker.get(key) for key in ("centerId", "runtimeId", "entryId", "sourceId")):
        raise ValueError("artifact_owner_mismatch")
    if Path(owner["root"]).resolve() != root or lock_free(folder / "slot.lock"):
        raise ValueError("artifact_owner_unavailable")
    candidates = [owner.get("runner"), owner.get("child")]
    if not cleanup:
        candidates = [value for value in candidates if same_process(value)]
    from product_media_process import proc_identity
    parent, seen = os.getppid(), set()
    while parent > 1 and parent not in seen:
        seen.add(parent)
        observed = identity(parent)
        if observed and observed in candidates:
            return
        row = proc_identity(parent)
        if not row:
            break
        parent = row["ppid"]
    raise ValueError("artifact_outside_managed_owner")


def protective_reason(root):
    for filename, reason in ((".auto-loop-budget-paused", "budget_pause"),
                             (".auto-loop-paused", "governance_pause"),
                             (".auto-loop-stop-pending", "stop_unconfirmed")):
        if (Path(root) / filename).exists():
            return reason
    return None


def compatible(root):
    root, framework = Path(root), Path(__file__).resolve().parents[2]
    try:
        # A partially upgraded context must stay read-only. Match the verified
        # framework's full control boundary, allowing native newline conversion.
        for name in CONTROL_FILES:
            source, reference = root / name, framework / name
            if source.is_symlink() or source.stat().st_size > 2 * 1024 * 1024:
                return False
            if hashlib.sha256(source.read_bytes().replace(b"\r\n", b"\n")).digest() != hashlib.sha256(reference.read_bytes().replace(b"\r\n", b"\n")).digest():
                return False
        return True
    except OSError:
        return False


def execution_context(root, expected_product_id=None, check_git=False):
    """Read the original effective target without recovering or writing state."""
    from localization import read_settings
    from product_identity import read_state, get_identity, project_value, safe_path
    root = Path(root).resolve()
    result = {"valid": False, "reason": "context_unavailable", "project": None, "productId": None}
    try:
        for relative in (".auto-company/product-state.transaction.json", ".auto-company/product-state.lock", ".auto-company.local.language-update"):
            if safe_path(root, relative).exists():
                return result
        if check_git and not existing_lock_free(safe_path(root, ".auto-company/project-registry.lock")):
            return result
        _, settings = read_settings(root)
        state = read_state(root)
        selected = settings.get("ACTIVE_PROJECT")
        if selected is not None:
            if not selected.startswith("projects/") or project_value(selected) != selected:
                return result
            project = selected
        else:
            continuation = state.get("continuationProductId")
            item = state["identities"].get(continuation) if continuation else None
            if continuation and (not item or item.get("kind") != "product"):
                return result
            project = item["project"] if item else ""
        if not project:
            if expected_product_id:
                return result
            return {**result, "valid": True, "reason": None}
        product = get_identity(root, project, create=False)
        if not product or product.get("kind") != "product" or expected_product_id and product["id"] != expected_product_id:
            return result
        result.update(project=project, productId=product["id"], reason="product_registration_invalid")
        registry = safe_path(root, "projects/registry.tsv")
        if registry.stat().st_size > 2 * 1024 * 1024:
            return result
        rows = [line.split("\t") for line in registry.read_text(encoding="utf-8").splitlines()[1:]]
        matching = [row for row in rows if row and row[0] == project.split("/")[1]]
        if len(matching) != 1 or len(matching[0]) != 4 or matching[0][1] != project:
            return result
        result["reason"] = "context_unavailable"
        if not safe_path(root, project + "/.git").is_dir():
            return result
        if check_git:
            # The original validator runs in the execution domain. Its validate
            # branch checks independent Git ownership and never takes config locks.
            checked = subprocess.run([sys.executable, "-B", str(root / "scripts/core/project-context.py"), "validate",
                                      "--root", str(root), "--project", project], stdin=subprocess.DEVNULL,
                                     capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=10)
            if checked.returncode:
                return result
        return {**result, "valid": True, "reason": None}
    except (OSError, ValueError, KeyError, TypeError, subprocess.SubprocessError):
        return result


def preflight(root, center_id=None, allow_protected=False, require_context=True, expected_product_id=None):
    root = Path(root).resolve()
    result = {"compatible": compatible(root), "quiescent": False, "reason": None}
    if not result["compatible"]:
        result["reason"] = "runtime_incompatible"
        return result
    if (root / ".auto-company.local.team-active").exists():
        result["reason"] = "interactive_team_active"
        return result
    if (reason := protective_reason(root)) and not allow_protected:
        result["reason"] = reason
        return result
    if require_context:
        context = execution_context(root, expected_product_id, check_git=True)
        if not context["valid"]:
            result["reason"] = context["reason"]
            return result
    if not lock_free(root / ".auto-loop.pid"):
        result["reason"] = "external_loop_active"
        return result
    # Enabled legacy service bindings must be explicitly retired by the operator.
    if sys.platform == "linux":
        command = ["systemctl", "--user", "show", "auto-company.service", "-p", "ExecStart", "-p", "ActiveState", "-p", "UnitFileState"]
    else:
        command = ["launchctl", "print", "gui/%s/com.autocompany.loop" % os.getuid()]
    try:
        service = subprocess.run(command, capture_output=True, text=True, timeout=3)
        if service.returncode:
            diagnostic = service.stderr.lower()
            missing_unit = "could not be found" in diagnostic or "could not find service" in diagnostic
            no_user_manager = sys.platform == "linux" and not Path("/run/user/%s/systemd/private" % os.getuid()).exists() and "failed to connect to bus" in diagnostic
            if not missing_unit and not no_user_manager:
                result["reason"] = "service_state_unknown"
                return result
        if str(root) in service.stdout and (sys.platform != "linux" or "ActiveState=active" in service.stdout or "UnitFileState=enabled" in service.stdout):
            result["reason"] = "legacy_service_bound"
            return result
    except FileNotFoundError:
        # A platform without this service manager cannot have its live binding.
        pass
    except (OSError, subprocess.SubprocessError):
        result["reason"] = "service_state_unknown"
        return result
    if center_id:
        folder = domain_dir(center_id)
        if not lock_free(folder / "slot.lock"):
            result["reason"] = "slot_busy"
            return result
        if (folder / "owner.json").exists():
            owner = read_json(folder / "owner.json")
            if owner.get("state") != "terminal" or not owner.get("cleanupConfirmed"):
                result["reason"] = "owner_recovery_required"
                return result
    result["quiescent"] = True
    return result


def probe(center_id, manifest_path=None):
    folder = domain_dir(center_id)
    result = {"slotFree": lock_free(folder / "slot.lock"), "owner": None, "receipt": None, "ownerAlive": False}
    try:
        result["owner"] = read_json(folder / "owner.json")
        result["ownerAlive"] = same_process(result["owner"].get("runner"))
    except (OSError, ValueError, KeyError):
        pass
    if manifest_path:
        manifest = read_json(manifest_path)
        try:
            receipt = read_json(Path(manifest["controlDir"]) / "receipt.json")
            if all(receipt.get(key) == manifest.get(key) for key in ("centerId", "runtimeId", "requestId", "dispatchId", "nonce")):
                result["receipt"] = receipt
        except (OSError, ValueError):
            pass
    return result


def signal_owned(value, sig):
    if not same_process(value):
        return
    if sys.platform == "linux":
        descriptor = os.pidfd_open(value["pid"])
        try:
            if same_process(value):
                signal.pidfd_send_signal(descriptor, sig)
        finally:
            os.close(descriptor)
    elif same_process(value):
        os.kill(value["pid"], sig)


def owned_children():
    from product_media_process import posix_rows
    rows = posix_rows()
    owned, parents = {}, {os.getpid()}
    while True:
        children = {row["pid"] for row in rows if row["ppid"] in parents and row["pid"] not in parents}
        if not children:
            break
        for pid in children:
            value = identity(pid)
            if value:
                owned[pid] = value
        parents.update(children)
    return owned


def run(manifest_path):
    manifest_path = Path(manifest_path).resolve()
    manifest = read_json(manifest_path)
    root = Path(manifest["root"]).resolve()
    marker = marker_for(root)
    if any(marker.get(key) != manifest.get(key) for key in ("centerId", "runtimeId", "entryId", "sourceId")):
        raise ValueError("managed_identity_mismatch")
    folder = domain_dir(manifest["centerId"])
    receipt_path = Path(manifest["controlDir"]) / "receipt.json"
    # Lock contention produces no terminal receipt: another dispatch may own it.
    descriptor = lock_file(folder / "slot.lock")
    os.set_inheritable(descriptor, True)
    if receipt_path.exists():
        os.close(descriptor)
        raise ValueError("dispatch_already_received")
    if (folder / "owner.json").exists():
        previous = read_json(folder / "owner.json")
        if previous.get("state") != "terminal" or not previous.get("cleanupConfirmed"):
            os.close(descriptor)
            raise ValueError("previous_owner_requires_recovery")
    runner = identity(os.getpid())
    receipt = {key: manifest[key] for key in ("centerId", "runtimeId", "entryId", "sourceId", "requestId", "dispatchId", "nonce")}
    receipt.update(runner=runner, root=str(root), state="accepted", acceptedAt=now(), cleanupConfirmed=False)
    atomic_json(folder / "owner.json", receipt)
    atomic_json(receipt_path, receipt)
    launched, child, child_identity, stopping, owned = False, None, None, None, {}

    def publish(state, **fields):
        receipt.update(state=state, observedAt=now(), **fields)
        atomic_json(receipt_path, receipt)
        atomic_json(folder / "owner.json", receipt)

    def stop_signal(_sig, _frame):
        nonlocal stopping
        stopping = stopping or "runner_shutdown"

    for sig in (signal.SIGTERM, signal.SIGINT, signal.SIGHUP):
        signal.signal(sig, stop_signal)
    if sys.platform == "linux":
        libc = ctypes.CDLL(None, use_errno=True)
        if libc.prctl(36, 1, 0, 0, 0) != 0:
            raise OSError(ctypes.get_errno(), "Cannot establish center child subreaper")
    try:
        control_for(manifest)
        check = preflight(root, expected_product_id=manifest.get("productId"))
        if not check["quiescent"]:
            raise ValueError(check["reason"])
        env = dict(os.environ)
        # Browser input never selects executable paths, shell text or credentials.
        env.update(manifest["environment"])
        env.update(AUTO_COMPANY_CENTER_MANIFEST=str(manifest_path), AUTO_COMPANY_CENTER_SLOT_FD=str(descriptor))
        control_for(manifest)
        command = ["bash", str(root / "scripts/core/auto-loop.sh")]
        with (Path(manifest["controlDir"]) / "runner.log").open("ab") as output:
            child = subprocess.Popen(command, cwd=root, env=env, stdin=subprocess.DEVNULL, stdout=output,
                                     stderr=subprocess.STDOUT, start_new_session=True, pass_fds=(descriptor,))
        launched, child_identity = True, identity(child.pid)
        publish("running", child=child_identity, startedAt=now())
        stop_started = None
        while child.poll() is None:
            owned.update(owned_children())
            try:
                control_for(manifest)
            except (OSError, ValueError, KeyError) as exc:
                stopping = stopping or str(exc)
            stopping = stopping or protective_reason(root)
            # Runtime capacity pauses are loop facts, unlike a model phase.
            try:
                state_text = (root / ".auto-loop-state").read_text()[:16384]
                if "STATUS=waiting_limit" in state_text or "STATUS=circuit_break" in state_text:
                    stopping = stopping or "provider_pause"
            except OSError:
                pass
            if stopping and stop_started is None:
                publish("stopping", reason=stopping)
                atomic_json(Path(manifest["controlDir"]) / "stop-observed.json", {"reason": stopping, "at": now()})
                (root / ".auto-loop-stop").touch()
                signal_owned(child_identity, signal.SIGTERM)
                stop_started = time.monotonic()
            if stop_started is not None and time.monotonic() - stop_started > 25:
                publish("attention", reason="stop_unconfirmed")
                for value in owned.values():
                    try:
                        signal_owned(value, signal.SIGKILL)
                    except (OSError, ValueError):
                        pass
            time.sleep(0.1)
        owned.update(owned_children())
        # Orphaned descendants remain descendants of the Linux subreaper.
        # On macOS retain and validate every observed descendant as well.
        cleanup_deadline = time.monotonic() + 10
        while True:
            owned.update(owned_children())
            live = [value for value in owned.values() if same_process(value)]
            while True:
                try:
                    reaped, _ = os.waitpid(-1, os.WNOHANG)
                    if not reaped:
                        break
                except ChildProcessError:
                    break
            if not live:
                break
            for value in live:
                try:
                    signal_owned(value, signal.SIGTERM if time.monotonic() < cleanup_deadline else signal.SIGKILL)
                except OSError:
                    pass
            if time.monotonic() >= cleanup_deadline:
                publish("attention", reason="stop_unconfirmed")
            # Never free the OS slot merely because a timeout elapsed.
            time.sleep(0.1)
        publish("terminal", reason=stopping or ("natural" if child.returncode == 0 else "runtime"),
                exitCode=child.returncode, launched=launched, cleanupConfirmed=True, endedAt=now())
        return 0
    except (OSError, ValueError, KeyError) as exc:
        if not launched:
            publish("terminal", reason=str(exc), launched=False, cleanupConfirmed=True, endedAt=now())
            return 1
        # A failed receipt write must not release ownership while descendants
        # still run. Do not rely on a DB/heartbeat timeout to reclaim this slot.
        try:
            publish("attention", reason="recovery_required")
        except OSError:
            pass
        while True:
            owned.update(owned_children())
            if child_identity:
                owned[child_identity["pid"]] = child_identity
            live = [value for value in owned.values() if same_process(value)]
            if not live:
                break
            for value in live:
                try:
                    signal_owned(value, signal.SIGTERM)
                except OSError:
                    pass
            if child:
                child.poll()
            time.sleep(0.1)
        raise
    finally:
        os.close(descriptor)


def operator_previews(root, project=None):
    from runtime_artifacts import artifact_records
    from product_identity import get_identity
    result = []
    for record in artifact_records(Path(root)):
        if (record.get("kind") != "preview" or record.get("state") != "running" or record.get("lifetime") != "operator"
                or project is not None and record.get("project") != project):
            continue
        product = get_identity(Path(root), record.get("project"), create=False)
        if not product or product["id"] != record.get("productId"):
            raise ValueError("preview_identity_unconfirmed")
        result.append(record)
    return result


def stop_operator_previews(root, project=None):
    """Token-addressed graceful stop; never signal an unverified old PID."""
    from runtime_artifacts import preview_request
    for record in operator_previews(root, project):
        process = record.get("processIdentity")
        if not process:
            raise ValueError("preview_owner_unconfirmed")
        alive = same_process(process)
        healthy = preview_request(record)
        if healthy:
            if not preview_request(record, stop=True):
                raise ValueError("preview_stop_unconfirmed")
        elif alive:
            raise ValueError("preview_owner_unconfirmed")
        deadline = time.monotonic() + 5
        while same_process(process) or preview_request(record):
            if time.monotonic() >= deadline:
                raise ValueError("preview_stop_unconfirmed")
            time.sleep(0.05)


def media_command(command, root, project, preserve_preview, descriptor, timeout=150, control_path=None, operation_id=None):
    """Retain the slot through confirmed capture cleanup, including orphans."""
    if sys.platform == "linux":
        libc = ctypes.CDLL(None, use_errno=True)
        if libc.prctl(36, 1, 0, 0, 0) != 0:
            raise OSError(ctypes.get_errno(), "Cannot establish media child subreaper")
    stopping, timed_out = False, False
    def stop(_sig, _frame):
        nonlocal stopping
        stopping = True
    previous = {sig: signal.signal(sig, stop) for sig in (signal.SIGTERM, signal.SIGINT, signal.SIGHUP)}
    child, owned, retained = None, {}, set()
    try:
        child = subprocess.Popen(command, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                 start_new_session=True, pass_fds=(descriptor,))
        child_identity = identity(child.pid)
        deadline = time.monotonic() + timeout
        while child.poll() is None:
            owned.update(owned_children())
            if control_path:
                try:
                    control = read_json(control_path)
                    stopping = stopping or control.get("operationId") != operation_id or bool(control.get("stop")) or time.time() - control.get("heartbeat", 0) > HEARTBEAT_TIMEOUT
                except (OSError, ValueError):
                    stopping = True
            if time.monotonic() >= deadline:
                stopping, timed_out = True, True
            if stopping:
                signal_owned(child_identity, signal.SIGTERM)
                break
            time.sleep(0.05)
        if preserve_preview and not stopping and child.returncode == 0:
            from runtime_artifacts import preview_request
            for preview in operator_previews(root, project):
                owner = preview.get("processIdentity")
                if owner and same_process(owner) and preview_request(preview):
                    retained.add(owner["pid"])
    finally:
        try:
            cleanup_deadline = time.monotonic() + 8
            while child is not None:
                owned.update(owned_children())
                live = [value for pid, value in owned.items() if pid not in retained and same_process(value)]
                child.poll()
                while True:
                    try:
                        pid, status = os.waitpid(-1, os.WNOHANG)
                        if not pid:
                            break
                        if pid == child.pid:
                            child.returncode = os.waitstatus_to_exitcode(status)
                    except ChildProcessError:
                        break
                if not live:
                    break
                for value in live:
                    try:
                        signal_owned(value, signal.SIGTERM if time.monotonic() < cleanup_deadline else signal.SIGKILL)
                    except OSError:
                        pass
                # Timeout changes diagnostics, never releases a still-owned process.
                time.sleep(0.05)
        finally:
            for sig, handler in previous.items():
                signal.signal(sig, handler)
    return {"ok": child.returncode == 0 and not stopping, "reason": "media_timeout" if timed_out else "media_interrupted" if stopping else None if child.returncode == 0 else "media_failed"}


def media_status(manifest_path):
    manifest = read_json(manifest_path)
    receipt_path = Path(manifest_path).with_name("receipt.json")
    result = {"slotFree": lock_free(domain_dir(manifest["centerId"]) / "slot.lock"), "receipt": None}
    if receipt_path.exists():
        receipt = read_json(receipt_path)
        if all(receipt.get(key) == manifest.get(key) for key in ("centerId", "runtimeId", "sourceId", "entryId", "operationId")):
            result["receipt"] = receipt
    return result


def media(manifest_path):
    manifest = read_json(manifest_path)
    root = Path(manifest["root"])
    marker = marker_for(root)
    if any(marker.get(key) != manifest.get(key) for key in ("centerId", "runtimeId", "entryId", "sourceId")):
        raise ValueError("managed_identity_mismatch")
    descriptor = lock_file(domain_dir(marker["centerId"]) / "slot.lock")
    owner_path = domain_dir(marker["centerId"]) / "owner.json"
    owner = {**{key: manifest[key] for key in ("centerId", "runtimeId", "entryId", "sourceId")},
             "operationId": manifest.get("operationId"), "root": str(root.resolve()), "runner": identity(os.getpid()),
             "state": "media", "cleanupConfirmed": False}
    published = False
    receipt_path = Path(manifest_path).with_name("receipt.json")
    try:
        if owner_path.exists():
            previous = read_json(owner_path)
            if previous.get("state") != "terminal" or not previous.get("cleanupConfirmed"):
                raise ValueError("previous_owner_requires_recovery")
        context = preflight(root, allow_protected=manifest["action"] == "preview_stop",
                            require_context=manifest["action"] != "preview_stop", expected_product_id=manifest.get("productId"))
        if not context["quiescent"]:
            raise ValueError(context.get("reason") or "context_busy")
        from product_identity import get_identity
        product = get_identity(root, manifest["project"], create=False)
        if not product or product["id"] != manifest["productId"]:
            raise ValueError("product_identity_changed")
        action = manifest["action"]
        command = [sys.executable, str(root / "scripts/core/runtime_artifacts.py"), "--root", str(root), "--project", manifest["project"]]
        if action == "capture":
            command += ["media", "--retry"]
        elif action == "preview_start":
            from product_media import load_profile
            profile = load_profile(root / manifest["project"])
            if profile["type"] != "static":
                raise ValueError("preview_unsupported")
            command += ["preview", "--background", "--directory", profile["webRoot"]]
        elif action == "preview_stop":
            command += ["preview-stop"]
        else:
            raise ValueError("unsupported_media_action")
        atomic_json(owner_path, owner)
        atomic_json(receipt_path, owner)
        published = True
        if action == "preview_stop":
            stop_operator_previews(root, manifest["project"])
            result = {"ok": True, "reason": None}
        else:
            result = media_command(command, root, manifest["project"], action == "preview_start", descriptor,
                                   control_path=Path(manifest_path).with_name("control.json"), operation_id=manifest["operationId"])
        owner.update(state="terminal", cleanupConfirmed=True, endedAt=now(), result=result)
        atomic_json(owner_path, owner)
        atomic_json(receipt_path, owner)
        return result
    except Exception:
        if published:
            owner.update(state="attention", reason="media_cleanup_unconfirmed")
            atomic_json(owner_path, owner)
            atomic_json(receipt_path, owner)
        else:
            # No subprocess was started. Record the failed attempt without
            # overwriting a previous uncertain domain owner.
            result = {"ok": False, "reason": "media_preflight_failed"}
            atomic_json(receipt_path, {**owner, "state": "terminal", "cleanupConfirmed": True, "endedAt": now(), "result": result})
            return result
        raise
    finally:
        os.close(descriptor)


def bind(manifest_path):
    """Close the check-to-bind race with normal auto-loop's actual root lock."""
    manifest = read_json(manifest_path)
    root = Path(manifest["root"]).resolve()
    marker = manifest["marker"]
    domain_lock = lock_file(domain_dir(marker["centerId"]) / "slot.lock")
    root_lock = None
    try:
        check = preflight(root, allow_protected=manifest["action"] == "release", require_context=manifest["action"] != "release",
                          expected_product_id=manifest.get("productId"))
        if not check["quiescent"]:
            raise ValueError(check["reason"])
        root_lock = lock_file(root / ".auto-loop.pid")
        target = root / MARKER
        existing = read_json(target) if target.exists() else None
        if existing != manifest.get("oldMarker"):
            raise ValueError("ownership_changed")
        if manifest["action"] == "takeover":
            if any(not record.get("processIdentity") for record in operator_previews(root)):
                # The old CLI is still available before binding, so an old
                # unverified preview can be stopped through its original owner.
                raise ValueError("preview_owner_unconfirmed")
            atomic_json(target, marker)
        elif manifest["action"] == "release":
            if existing:
                stop_operator_previews(root)
                target.unlink()
        else:
            raise ValueError("unsupported_binding")
        return {"ok": True}
    finally:
        if root_lock is not None:
            os.close(root_lock)
        os.close(domain_lock)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=("run", "probe", "admit", "preflight", "media", "media-status", "bind"))
    parser.add_argument("--manifest")
    parser.add_argument("--root")
    parser.add_argument("--center-id")
    parser.add_argument("--allow-protected", choices=("0", "1"), default="0")
    parser.add_argument("--require-context", choices=("0", "1"), default="1")
    parser.add_argument("--expected-product-id")
    args = parser.parse_args()
    try:
        if args.action == "run":
            return run(args.manifest)
        if args.action == "admit":
            admission(args.root)
            return 0
        if args.action == "preflight":
            result = preflight(args.root, args.center_id, args.allow_protected == "1", args.require_context == "1", args.expected_product_id)
        elif args.action == "media":
            result = media(args.manifest)
        elif args.action == "media-status":
            result = media_status(args.manifest)
        elif args.action == "bind":
            result = bind(args.manifest)
        else:
            result = probe(args.center_id, args.manifest)
        print(json.dumps(result, ensure_ascii=False))
        return 0
    except (OSError, ValueError, KeyError, subprocess.SubprocessError) as exc:
        print("Center admission/runtime refused: " + str(exc), file=sys.stderr)
        return 78


if __name__ == "__main__":
    raise SystemExit(main())
