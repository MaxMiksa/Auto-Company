"""Bounded, program-triggered product media; reads never create or start anything.

The only executable profile is an explicitly configured local Node entrypoint.
Generated artifacts live outside the product and are served only by digest.
"""
from __future__ import annotations

from contextlib import contextmanager
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import signal
import stat
import subprocess
import sys
import tempfile
import threading
import time
import uuid
import xml.etree.ElementTree as ET
import zlib


SCHEMA = 1
MAX_BYTES = 24 * 1024 * 1024
MAX_FILES = 2048
MAX_IMAGE = 12 * 1024 * 1024
PROFILE = ".auto-company/media.json"
VIEWPORTS = [{"name": "desktop", "width": 1440, "height": 1000},
             {"name": "mobile", "width": 390, "height": 844}]
IGNORED = {".git", ".auto-company", "node_modules", "__pycache__", ".venv", "venv",
           "test-results", "playwright-report", "coverage"}
WEB_SUFFIXES = {".html", ".htm", ".css", ".js", ".mjs", ".cjs", ".json", ".svg", ".png",
                ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".woff", ".woff2", ".ttf", ".txt", ".wasm"}
SOURCE_SUFFIXES = WEB_SUFFIXES | {".ts", ".tsx", ".jsx", ".vue", ".svelte"}


class MediaError(ValueError):
    def __init__(self, code):
        self.code = code
        super().__init__(code)


def now():
    return datetime.now(timezone.utc).isoformat()


def digest(value):
    return hashlib.sha256(value).hexdigest()


def safe_path(root, relative):
    if not isinstance(relative, str) or not relative or "\\" in relative or ":" in relative or "\x00" in relative:
        raise MediaError("invalid_path")
    parts = PurePosixPath(relative)
    if parts.is_absolute() or ".." in parts.parts:
        raise MediaError("invalid_path")
    root = Path(root)
    path = root
    if root.is_symlink() or getattr(root, "is_junction", lambda: False)():
        raise MediaError("linked_path")
    for part in parts.parts:
        path /= part
        if path.is_symlink() or getattr(path, "is_junction", lambda: False)():
            raise MediaError("linked_path")
    path.resolve().relative_to(root.resolve())
    return path


def read_bytes(path, limit):
    metadata = path.stat()
    if not stat.S_ISREG(metadata.st_mode) or metadata.st_size > limit:
        raise MediaError("file_limit")
    with path.open("rb") as source:
        value = source.read(limit + 1)
    if len(value) > limit:
        raise MediaError("file_limit")
    return value


def read_json(path):
    value = json.loads(read_bytes(path, 128 * 1024))
    if not isinstance(value, dict):
        raise MediaError("invalid_record")
    return value


def atomic_bytes(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, name = tempfile.mkstemp(prefix=".media-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(value)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(name, path)
    finally:
        Path(name).unlink(missing_ok=True)


def atomic_json(path, value):
    atomic_bytes(path, (json.dumps(value, ensure_ascii=False, sort_keys=True) + "\n").encode())


def identity(root, project):
    from product_identity import get_identity
    result = get_identity(root, project, create=False)
    if not result or result.get("kind") != "product" or not re.fullmatch(r"[0-9a-f]{32}", result.get("id", "")):
        raise MediaError("identity_missing")
    return result


def media_folder(root, product_id):
    if not isinstance(product_id, str) or not re.fullmatch(r"[0-9a-f]{32}", product_id):
        raise MediaError("invalid_identity")
    return safe_path(root, "logs/product-media/" + product_id)


def local_url_path(value):
    if not isinstance(value, str) or not re.fullmatch(r"/[A-Za-z0-9_./-]*", value) or ".." in value.split("/"):
        raise MediaError("invalid_url_path")
    return value


def load_profile(project):
    path = safe_path(project, PROFILE)
    if path.exists():
        profile = read_json(path)
        if profile.get("version") != SCHEMA:
            raise MediaError("unsupported_profile")
    elif safe_path(project, "index.html").is_file():
        profile = {"version": SCHEMA, "type": "static", "webRoot": "."}
    else:
        return {"version": SCHEMA, "type": "unsupported"}
    if profile.get("type") in {"none", "unsupported"}:
        return {"version": SCHEMA, "type": profile["type"]}
    if profile.get("type") not in {"static", "node"}:
        raise MediaError("unsupported_profile")
    allowed = {"version", "type", "webRoot", "entry", "readySelector", "steps", "timeoutSeconds", "command", "healthPath", "icon"}
    if set(profile) - allowed:
        raise MediaError("unknown_profile_field")
    directory = profile.get("webRoot", ".")
    if not safe_path(project, directory).is_dir():
        raise MediaError("web_root_missing")
    result = {"version": SCHEMA, "type": profile["type"], "webRoot": directory,
              "entry": local_url_path(profile.get("entry", "/")),
              "readySelector": profile.get("readySelector", "body"),
              "timeoutSeconds": profile.get("timeoutSeconds", 10), "steps": profile.get("steps", [])}
    if (not isinstance(result["readySelector"], str) or not 1 <= len(result["readySelector"]) <= 200
            or type(result["timeoutSeconds"]) is not int or not 1 <= result["timeoutSeconds"] <= 15):
        raise MediaError("invalid_readiness")
    if not isinstance(result["steps"], list) or len(result["steps"]) > 6:
        raise MediaError("invalid_steps")
    for step in result["steps"]:
        if not isinstance(step, dict) or step.get("action") not in {"click", "fill"} or set(step) - {"action", "selector", "value"}:
            raise MediaError("invalid_steps")
        if not isinstance(step.get("selector"), str) or not 1 <= len(step["selector"]) <= 200:
            raise MediaError("invalid_steps")
        if step["action"] == "fill" and (not isinstance(step.get("value"), str) or len(step["value"]) > 500):
            raise MediaError("invalid_steps")
    if "icon" in profile:
        safe_path(project, profile["icon"])
        result["icon"] = profile["icon"]
    if result["type"] == "node":
        command = profile.get("command")
        if (not isinstance(command, list) or not 2 <= len(command) <= 32 or command[0] != "node"
                or any(not isinstance(arg, str) or len(arg) > 500 or "\x00" in arg for arg in command)):
            raise MediaError("invalid_command")
        executable = safe_path(project, command[1])
        if executable.suffix not in {".js", ".mjs", ".cjs"} or not executable.is_file():
            raise MediaError("node_entry_missing")
        if sum(arg.count("{port}") for arg in command) != 1:
            raise MediaError("port_placeholder_required")
        result.update(command=command, healthPath=local_url_path(profile.get("healthPath", "/")))
    return result


def content_version(project, profile):
    """Hash source bytes + normalized profile; ignore generated/check dependency trees."""
    web_root = safe_path(project, profile.get("webRoot", "."))
    root = project if profile.get("type") == "node" else web_root
    hasher = hashlib.sha256(json.dumps({"profile": profile, "viewports": VIEWPORTS, "captureVersion": 1}, sort_keys=True).encode())
    count = total = 0
    for directory, dirs, files in os.walk(root, followlinks=False):
        dirs[:] = sorted(name for name in dirs if name not in IGNORED and not name.startswith("."))
        for name in dirs:
            safe_path(root, (Path(directory) / name).relative_to(root).as_posix())
        for name in sorted(files):
            if name.startswith(".") or Path(name).suffix.lower() not in SOURCE_SUFFIXES:
                continue
            relative = (Path(directory) / name).relative_to(root).as_posix()
            path = safe_path(root, relative)
            raw = read_bytes(path, MAX_BYTES)
            count += 1
            total += len(raw)
            if count > MAX_FILES or total > MAX_BYTES:
                raise MediaError("source_limit")
            hasher.update(relative.encode() + b"\0" + digest(raw).encode() + b"\n")
    return hasher.hexdigest()


SVG_TAGS = {"svg", "g", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon"}
SVG_ATTRIBUTES = {"viewBox", "width", "height", "x", "y", "x1", "x2", "y1", "y2", "cx", "cy", "r", "rx", "ry", "d", "points",
                  "fill", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin", "fill-rule", "clip-rule", "opacity", "fill-opacity", "stroke-opacity", "transform"}


def validate_icon(raw):
    """Static shapes only: no links, style, text, entities, animation or foreign XML."""
    if len(raw) > 32 * 1024 or b"<!" in raw or b"<?" in raw:
        raise MediaError("unsafe_icon")
    try:
        element = ET.fromstring(raw)
    except ET.ParseError as error:
        raise MediaError("invalid_icon") from error
    nodes = list(element.iter())
    if len(nodes) > 64 or element.tag not in {"svg", "{http://www.w3.org/2000/svg}svg"}:
        raise MediaError("unsafe_icon")
    for node in nodes:
        tag = node.tag.removeprefix("{http://www.w3.org/2000/svg}")
        if tag not in SVG_TAGS or (node.text or "").strip() or (node.tail or "").strip():
            raise MediaError("unsafe_icon")
        for key, value in node.attrib.items():
            if key not in SVG_ATTRIBUTES or len(value) > 8192 or not re.fullmatch(r"[A-Za-z0-9#.,()+\-\s%]*", value) or "url" in value.lower():
                raise MediaError("unsafe_icon")
            if key in {"fill", "stroke"} and not re.fullmatch(r"#[0-9a-fA-F]{3,8}|none|currentColor|[A-Za-z]{1,20}", value):
                raise MediaError("unsafe_icon")
    viewbox = element.get("viewBox", "").replace(",", " ").split()
    try:
        bounds = [float(value) for value in viewbox]
        if len(bounds) != 4 or not all(-10000 < value < 10000 for value in bounds) or not (0 < bounds[2] <= 2048 and 0 < bounds[3] <= 2048):
            raise ValueError()
    except ValueError as error:
        raise MediaError("invalid_icon_dimensions") from error
    return raw


def register_icon(root, project, product_id, profile, previous=None):
    source = "default"
    reason = "icon_missing"
    raw = None
    for relative in dict.fromkeys([profile.get("icon", "icon.svg"), "favicon.svg", "public/icon.svg", "public/favicon.svg"]):
        try:
            path = safe_path(project, relative)
            if path.exists():
                raw = validate_icon(read_bytes(path, 32 * 1024))
                source, reason = "product", None
                break
        except (OSError, ValueError):
            reason = "icon_rejected"
    if raw is None:
        color = "#" + digest(product_id.encode())[:6]
        raw = f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect x="4" y="4" width="56" height="56" rx="14" fill="{color}"/><path d="M20 21h24v9H29v13h-9z" fill="#fff"/></svg>'.encode()
    checksum = digest(raw)
    name = f"{checksum}.svg"
    target = safe_path(media_folder(root, product_id), name)
    if not target.exists() or digest(read_bytes(target, 32 * 1024)) != checksum:
        atomic_bytes(target, raw)
    record = {"name": name, "sha256": checksum, "source": source, "reason": reason, "recordedAt": now(),
              "publicationStatus": "not_applicable"}
    if profile.get("type") in {"static", "node"}:
        relative = (PurePosixPath(profile.get("webRoot", ".")) / "auto-company-icon.svg").as_posix()
        try:
            published = safe_path(project, relative)
            previous = previous or {}
            old_hash = digest(read_bytes(published, 32 * 1024)) if published.exists() else None
            owned = (previous.get("publicationStatus") == "published" and previous.get("publishedPath") == relative
                     and previous.get("publishedSha256") == old_hash)
            if old_hash is None or owned:
                if old_hash != checksum:
                    atomic_bytes(published, raw)
                record.update(publicationStatus="published", publishedPath=relative, publishedSha256=checksum)
            elif old_hash == checksum:
                record.update(publicationStatus="existing_valid", publishedPath=relative)
            else:
                record.update(publicationStatus="conflict", publicationReason="existing_icon_preserved", publishedPath=relative)
        except (OSError, ValueError):
            record.update(publicationStatus="failed", publicationReason="icon_publication_failed")
    from product_icon_html import inspect_reference
    record["reference"] = inspect_reference(project, profile, record, write=True)
    return record


@contextmanager
def capture_lock(folder):
    """Bind one writer OS, then use its crash-released kernel lock.

    Windows byte locks and Linux flock are not equivalent on shared NTFS. The
    atomic writer binding prevents those APIs from becoming concurrent writers.
    """
    owner_path = safe_path(folder, "writer.json")
    try:
        descriptor = os.open(owner_path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    except FileExistsError:
        try:
            owner = read_json(owner_path)
        except (OSError, ValueError) as error:
            raise MediaError("writer_binding_unavailable") from error
        if owner.get("version") != 1 or owner.get("os") != os.name:
            raise MediaError("writer_runtime_mismatch")
    else:
        with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
            json.dump({"version": 1, "os": os.name}, stream)
            stream.flush()
            os.fsync(stream.fileno())
    lock = safe_path(folder, "capture.lock")
    with lock.open("a+b") as stream:
        if os.name == "nt":
            import msvcrt
            if os.fstat(stream.fileno()).st_size == 0:
                stream.write(b"0")
                stream.flush()
            stream.seek(0)
            try:
                msvcrt.locking(stream.fileno(), msvcrt.LK_NBLCK, 1)
            except OSError as error:
                raise MediaError("capture_busy") from error
            try:
                yield
            finally:
                stream.seek(0)
                msvcrt.locking(stream.fileno(), msvcrt.LK_UNLCK, 1)
        else:
            import fcntl
            try:
                fcntl.flock(stream, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except OSError as error:
                raise MediaError("capture_busy") from error
            try:
                yield
            finally:
                fcntl.flock(stream, fcntl.LOCK_UN)


def stop_worker(scope):
    scope.close()


def run_worker(project, profile, version, staging):
    node = shutil.which("node")
    if not node:
        raise MediaError("node_missing")
    request = {"project": str(project), "profile": profile, "version": version, "token": uuid.uuid4().hex,
               "output": str(staging), "viewports": VIEWPORTS, "webSuffixes": sorted(WEB_SUFFIXES)}
    atomic_json(staging / "request.json", request)
    command = [node, str(Path(__file__).with_name("product_media_worker.cjs")), str(staging / "request.json")]
    from project_isolation import inside_boundary
    if not inside_boundary():
        command = [sys.executable, str(Path(__file__).with_name("isolation_media.py")), str(staging / "request.json")]
    from product_media_process import ProcessScope
    scope = None
    previous_signal = None
    interrupted = False
    if threading.current_thread() is threading.main_thread():
        previous_signal = signal.getsignal(signal.SIGTERM)

        def interrupt_capture(_signal, _frame):
            # Do not raise asynchronously: process-stat parsing catches
            # ValueError, and a repeated signal must not interrupt teardown.
            nonlocal interrupted
            interrupted = True

        signal.signal(signal.SIGTERM, interrupt_capture)
    try:
        scope = ProcessScope(command)
        process = scope.process
        deadline = time.monotonic() + 45
        result_path = staging / "result.json"
        while not result_path.exists():
            scope.observe()
            if interrupted:
                raise MediaError("capture_interrupted")
            if process.poll() is not None:
                raise MediaError("worker_terminated")
            if time.monotonic() >= deadline:
                raise MediaError("capture_timeout")
            time.sleep(0.05)
        result = read_json(result_path)
        if result.get("state") != "success":
            reason = result.get("reason", "capture_failed")
            raise MediaError(reason if isinstance(reason, str) and re.fullmatch(r"[a-z_]{1,64}", reason) else "capture_failed")
        return result
    finally:
        try:
            if scope is not None:
                stop_worker(scope)
        finally:
            if previous_signal is not None:
                signal.signal(signal.SIGTERM, previous_signal)
        if interrupted:
            raise MediaError("capture_interrupted")


def load_record(folder):
    try:
        value = read_json(safe_path(folder, "media.json"))
        if any(key in value and not isinstance(value[key], dict) for key in ("attempt", "icon", "latestSuccess")):
            return {}
        return value if value.get("version") == SCHEMA else {}
    except (OSError, ValueError, RecursionError):
        return {}


def validate_variant(folder, variant):
    name = variant.get("name", "")
    if not re.fullmatch(r"[0-9a-f]{64}\.png", name) or variant.get("sha256") != name[:-4]:
        raise MediaError("invalid_image")
    raw = read_bytes(safe_path(folder, name), MAX_IMAGE)
    if digest(raw) != variant["sha256"] or not raw.startswith(b"\x89PNG\r\n\x1a\n") or len(raw) < 24:
        raise MediaError("invalid_image")
    width, height = int.from_bytes(raw[16:20], "big"), int.from_bytes(raw[20:24], "big")
    if width != variant.get("width") or height != variant.get("height") or not 1 <= width <= 2000 or not 1 <= height <= 2000:
        raise MediaError("invalid_image")
    offset, seen_data, ended = 8, False, False
    while offset + 12 <= len(raw):
        length = int.from_bytes(raw[offset:offset + 4], "big")
        end = offset + 12 + length
        if end > len(raw):
            raise MediaError("invalid_image")
        chunk = raw[offset + 4:offset + 8 + length]
        if zlib.crc32(chunk) != int.from_bytes(raw[offset + 8 + length:end], "big"):
            raise MediaError("invalid_image")
        seen_data = seen_data or chunk[:4] == b"IDAT"
        if chunk[:4] == b"IEND":
            ended = length == 0 and end == len(raw)
            break
        offset = end
    if not seen_data or not ended:
        raise MediaError("invalid_image")
    return raw


def valid_success(folder, value):
    if not isinstance(value, dict) or not re.fullmatch(r"[0-9a-f]{64}", value.get("version", "")):
        return None
    try:
        variants = value["variants"]
        if not isinstance(variants, list) or len(variants) != 2 or any(not isinstance(row, dict) for row in variants) or {row["viewport"] for row in variants} != {"desktop", "mobile"}:
            return None
        for row in variants:
            validate_variant(folder, row)
        return value
    except (OSError, ValueError, TypeError, KeyError):
        return None


def retain_images(folder, record):
    """Keep all distinct deliveries and five ordinary captures; keep all metadata."""
    retained = {record.get("icon", {}).get("name")}
    successes = [record.get("latestSuccess")]
    ordinary = []
    for path in folder.glob("attempt-*.json"):
        try:
            row = read_json(safe_path(folder, path.name))
            if row.get("state") == "success" and row.get("variants"):
                if row.get("retainedDelivery"):
                    successes.append(row)
                else:
                    ordinary.append(row)
        except (OSError, ValueError):
            continue
    successes.extend(sorted(ordinary, key=lambda row: row.get("endedAt", ""), reverse=True)[:5])
    for success in successes:
        if isinstance(success, dict):
            retained.update(row.get("name") for row in success.get("variants", []) if isinstance(row, dict))
    for path in folder.iterdir():
        if re.fullmatch(r"[0-9a-f]{64}\.(?:png|svg)", path.name) and path.name not in retained:
            safe_path(folder, path.name).unlink(missing_ok=True)


def capture_product(root, project, cycle_id=None, trigger="cycle", readonly=False, retry=False):
    """Normal cycle/delivery hook. Does not create product identity or affect checks."""
    if readonly:
        raise MediaError("readonly")
    root = Path(root)
    product = identity(root, project)
    source = safe_path(root, project)
    folder = media_folder(root, product["id"])
    folder.mkdir(parents=True, exist_ok=True)
    with capture_lock(folder):
        for candidate in folder.glob(".capture-*"):
            candidate = safe_path(folder, candidate.name)
            # A crashed owner's worker has its own 55-second deadline. Do not
            # remove a still-live worker's staging files during recovery.
            if candidate.is_dir() and time.time() - candidate.stat().st_mtime > 65:
                shutil.rmtree(candidate)
        record = load_record(folder)
        record.update(version=SCHEMA, productId=product["id"], project=project)
        old_attempt = record.get("attempt")
        if old_attempt and old_attempt.get("state") == "capturing":
            try:
                age = (datetime.now(timezone.utc) - datetime.fromisoformat(old_attempt["startedAt"])).total_seconds()
                if age < 60:
                    # The old owner may have crashed before cleanup; its worker
                    # watchdog still owns this short remaining preview scope.
                    raise MediaError("capture_busy")
            except (ValueError, TypeError, KeyError) as error:
                if isinstance(error, MediaError):
                    raise
            old_attempt.update(state="interrupted", reason="previous_capture_interrupted", endedAt=now())
            if re.fullmatch(r"[0-9a-f]{32}", str(old_attempt.get("id", ""))):
                atomic_json(safe_path(folder, f"attempt-{old_attempt['id']}.json"), old_attempt)
        attempt = {"id": uuid.uuid4().hex, "cycleId": cycle_id, "trigger": trigger, "startedAt": now(), "state": "capturing"}
        staging = None
        try:
            profile = load_profile(source)
            record["icon"] = register_icon(root, source, product["id"], profile, record.get("icon"))
            if profile["type"] in {"none", "unsupported"}:
                attempt.update(state="not_applicable" if profile["type"] == "none" else "unsupported", reason="profile_not_supported")
                return record
            version = content_version(source, profile)
            attempt["version"] = version
            previous = record.get("attempt", {})
            if not retry and previous.get("version") == version and previous.get("state") != "capturing":
                # Success is reusable only while every registered image is intact.
                if previous.get("state") != "success" or valid_success(folder, record.get("latestSuccess")):
                    attempt = previous
                    if trigger == "delivery" and previous.get("state") == "success":
                        attempt["retainedDelivery"] = True
                    return record
            record["attempt"] = attempt
            atomic_json(safe_path(folder, "media.json"), record)
            staging = Path(tempfile.mkdtemp(prefix=".capture-", dir=folder))
            result = run_worker(source, profile, version, staging)
            if content_version(source, profile) != version:
                raise MediaError("version_changed")
            variants = []
            for viewport in VIEWPORTS:
                raw = read_bytes(safe_path(staging, viewport["name"] + ".png"), MAX_IMAGE)
                checksum = digest(raw)
                variant = {"name": checksum + ".png", "sha256": checksum, "viewport": viewport["name"],
                           "width": viewport["width"], "height": viewport["height"]}
                target = safe_path(folder, variant["name"])
                atomic_bytes(target, raw)
                validate_variant(folder, variant)
                variants.append(variant)
            attempt.update(state="success", reason=None)
            record["latestSuccess"] = {"version": version, "cycleId": cycle_id, "capturedAt": now(),
                                       "pagePath": profile["entry"], "variants": variants, "attemptId": attempt["id"]}
            attempt["variants"] = variants
            if trigger == "delivery":
                attempt["retainedDelivery"] = True
        except KeyboardInterrupt:
            attempt.update(state="interrupted", reason="capture_interrupted")
            raise
        except (OSError, ValueError, TypeError, KeyError, subprocess.SubprocessError) as error:
            reason = error.code if isinstance(error, MediaError) else "capture_failed"
            attempt.update(state="interrupted" if reason == "capture_interrupted" else "failed", reason=reason)
            if not record.get("icon"):
                record["icon"] = register_icon(root, source, product["id"], {})
        finally:
            attempt.setdefault("endedAt", now())
            record["attempt"] = attempt
            atomic_json(safe_path(folder, f"attempt-{attempt['id']}.json"), attempt)
            atomic_json(safe_path(folder, "media.json"), record)
            if staging:
                shutil.rmtree(staging)
            retain_images(folder, record)
        return record


def resource_href(product_id, name):
    return f"/api/product-media/{product_id}/{name}"


def media_projection(root, project, readonly=False):
    """Pure read projection, also suitable for archives. Never invokes a browser."""
    result = {"version": SCHEMA, "productId": None, "screenshot": {"state": "missing", "reason": "identity_missing", "latestSuccess": None}, "icon": None}
    try:
        product = identity(root, project)
        product_id = product["id"]
        folder = media_folder(root, product_id)
        record = load_record(folder)
        if record.get("productId") not in {None, product_id}:
            raise MediaError("identity_mismatch")
        result["productId"] = product_id
        screenshot = result["screenshot"]
        attempt = record.get("attempt", {})
        screenshot.update(state=attempt.get("state", "missing"), reason=attempt.get("reason"), attemptedAt=attempt.get("startedAt"))
        if screenshot["state"] == "capturing":
            try:
                if (datetime.now(timezone.utc) - datetime.fromisoformat(attempt["startedAt"])).total_seconds() > 60:
                    screenshot.update(state="interrupted", reason="previous_capture_interrupted")
            except (ValueError, TypeError, KeyError):
                screenshot.update(state="interrupted", reason="invalid_capture_time")
        latest = valid_success(folder, record.get("latestSuccess"))
        if latest:
            screenshot["latestSuccess"] = {**latest, "variants": [{**row, "href": resource_href(product_id, row["name"])} for row in latest["variants"]]}
        elif record.get("latestSuccess"):
            screenshot.update(state="failed", reason="artifact_missing_or_modified")
        try:
            source = safe_path(root, project)
            profile = load_profile(source)
            if profile["type"] not in {"none", "unsupported"}:
                current = content_version(source, profile)
                screenshot["currentVersion"] = current
                screenshot["stale"] = bool(latest and latest["version"] != current)
                if latest and latest["version"] != current and screenshot["state"] == "success":
                    screenshot["state"] = "stale"
            elif not attempt:
                screenshot.update(state="not_applicable" if profile["type"] == "none" else "unsupported", reason="profile_not_supported")
            elif latest:
                screenshot["stale"] = True
        except (OSError, ValueError, TypeError):
            screenshot["stale"] = bool(latest)
            screenshot["reason"] = "source_unavailable"
        icon = record.get("icon")
        if isinstance(icon, dict) and re.fullmatch(r"[0-9a-f]{64}\.svg", icon.get("name", "")):
            raw = read_bytes(safe_path(folder, icon["name"]), 32 * 1024)
            if digest(validate_icon(raw)) == icon.get("sha256") == icon["name"][:-4]:
                result["icon"] = {**icon, "href": resource_href(product_id, icon["name"])}
                from product_icon_html import inspect_reference
                try:
                    reference_project = safe_path(root, project)
                    result["icon"]["reference"] = inspect_reference(reference_project, load_profile(reference_project), icon)
                except (OSError, ValueError, TypeError):
                    result["icon"]["reference"] = {"state": "unconfirmed", "reason": "source_unavailable", "unified": None, "managed": False}
                if icon.get("publicationStatus") in {"published", "existing_valid"}:
                    try:
                        published = safe_path(safe_path(root, project), icon["publishedPath"])
                        if digest(read_bytes(published, 32 * 1024)) != icon["sha256"]:
                            result["icon"].update(publicationStatus="stale", publicationReason="published_icon_modified")
                    except (OSError, ValueError, KeyError):
                        result["icon"].update(publicationStatus="unavailable", publicationReason="published_icon_missing")
    except (OSError, ValueError, TypeError, KeyError, RecursionError):
        pass
    return result


def read_resource(root, product_id, name):
    """Read only a currently registered, content-verified image or safe SVG."""
    try:
        folder = media_folder(root, product_id)
        record = load_record(folder)
        if record.get("productId") != product_id:
            return None
        if not isinstance(name, str) or not re.fullmatch(r"[0-9a-f]{64}\.(?:png|svg)", name):
            return None
        icon = record.get("icon", {})
        if name.endswith(".svg") and icon.get("name") == name:
            raw = validate_icon(read_bytes(safe_path(folder, name), 32 * 1024))
            return (raw, "image/svg+xml") if digest(raw) == icon.get("sha256") == name[:-4] else None
        success = valid_success(folder, record.get("latestSuccess"))
        if success:
            for variant in success["variants"]:
                if variant["name"] == name:
                    return validate_variant(folder, variant), "image/png"
    except (OSError, ValueError, TypeError, KeyError, RecursionError):
        pass
    return None


def capture_cycle(root, cycle):
    from product_identity import cycle_projects
    for project in cycle_projects(root, cycle):
        try:
            capture_product(root, project, cycle, "cycle")
        except (OSError, ValueError, TypeError):
            # Media diagnostics never change AI/check/governance outcomes.
            continue
