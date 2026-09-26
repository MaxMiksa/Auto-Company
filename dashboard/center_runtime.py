"""Persistent operator intent and FIFO scheduling, separate from source facts.

Only this process writes center storage. The POSIX adapter owns OS process/lock
evidence and exchanges bounded JSON receipts; neither layer guesses success.
"""
from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import threading
import time
import uuid

from center_store import CenterError

STATES = frozenset(("queued", "starting", "running", "stopping", "attention", "ended", "failed", "canceled"))
OPEN = frozenset(("queued", "starting", "running", "stopping", "attention"))
ACTIVE = frozenset(("starting", "running", "stopping", "attention"))
TERMINAL = STATES - OPEN
EDGES = {"queued": {"canceled", "attention", "starting"},
         "starting": {"running", "stopping", "attention", "failed", "ended"},
         "running": {"stopping", "attention", "ended", "failed"},
         "stopping": {"attention", "ended", "failed"},
         "attention": {"running", "stopping", "ended", "failed", "canceled"}}
MARKER = ".auto-company-center.json"
ENGINES = {"claude", "codex", "cursor", "openai-compatible"}
EFFORTS = {"low", "medium", "high", "xhigh", "minimal", "none"}
RUNTIME_ENV_NAMES = {"CODEX_BIN", "CODEX_SANDBOX_MODE", "CLAUDE_BIN", "CLAUDE_PERMISSION_MODE", "CURSOR_BIN",
                     "CURSOR_ADAPTER_ENABLED", "CURSOR_SANDBOX_MODE", "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN",
                     "OPENAI_BASE_URL", "ANTHROPIC_BASE_URL", "OPENAI_COMPATIBLE_ADAPTER_ENABLED", "OPENAI_COMPATIBLE_ENDPOINT",
                     "OPENAI_COMPATIBLE_API_KEY", "OPENAI_COMPATIBLE_ALLOW_INSECURE_HTTP", "OPENAI_COMPATIBLE_MODEL",
                     "LOOP_INTERVAL", "CYCLE_TIMEOUT_SECONDS", "CYCLE_TERM_GRACE_SECONDS", "CYCLE_KILL_WAIT_SECONDS",
                     "USAGE_BUDGET_PERIOD", "USAGE_WARNING_USD", "USAGE_HARD_LIMIT_USD", "USAGE_WARNING_TOKENS", "USAGE_HARD_LIMIT_TOKENS"}


def now():
    return datetime.now(timezone.utc).isoformat()


def uid(prefix):
    return prefix + "_" + uuid.uuid4().hex


def digest(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def atomic_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + "." + uuid.uuid4().hex + ".tmp")
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
                # Windows/WSL readers can briefly hold a non-delete-shared
                # handle. Preserve the previous durable control during retry.
                if attempt == 50:
                    raise
                time.sleep(0.02)
    finally:
        temporary.unlink(missing_ok=True)


def read_json(path):
    path = Path(path)
    if path.is_symlink() or path.stat().st_size > 128 * 1024:
        raise ValueError("Unsafe control file")
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError("Invalid control file")
    return value


def config_fingerprint(root):
    result = {}
    for name in (".auto-company.local", "PROMPT.md", ".auto-loop.env", "scripts/core/auto-loop.sh",
                 "scripts/core/center_runner.py", "scripts/core/engine-adapters.sh", "scripts/core/loop-lock.py"):
        path = Path(root) / name
        if path.exists():
            if path.is_symlink() or path.stat().st_size > 1024 * 1024:
                raise CenterError("CONTEXT_UNAVAILABLE", "Configuration is unsafe or oversized", 409)
            result[name] = hashlib.sha256(path.read_bytes()).hexdigest()
        else:
            result[name] = None
    return digest(result)


class PosixAdapter:
    """Fixed argv bridge; all WSL processes use the saved distro and user."""
    def __init__(self, framework_root, domain):
        self.framework_root = Path(framework_root)
        self.domain = domain
        self.paths = {}

    @property
    def available(self):
        return bool(self.domain and self.domain.get("platform") in {"posix", "wsl"})

    def _wsl(self):
        return ["wsl.exe", "--distribution", self.domain["distribution"], "--user", self.domain["user"]]

    def path(self, path):
        path = str(Path(path).resolve())
        if self.domain.get("platform") != "wsl":
            return path
        if path not in self.paths:
            value = self._execute(self._wsl() + ["--exec", "wslpath", "-a", path], timeout=15).stdout.strip()
            if not value.startswith("/") or "\n" in value or "\r" in value:
                raise CenterError("CONTEXT_UNAVAILABLE", "WSL path conversion failed", 503)
            self.paths[path] = value
        return self.paths[path]

    def _execute(self, command, timeout=15):
        return subprocess.run(command, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=timeout,
                              env=self.environment(),
                              **({"creationflags": subprocess.CREATE_NO_WINDOW} if os.name == "nt" else {}), check=True)

    def environment(self):
        environment = dict(os.environ)
        if self.domain and self.domain.get("platform") == "wsl":
            # Controlled process environment references never enter manifests,
            # SQLite, log messages, or HTTP configuration snapshots.
            forwarded = sorted(name for name in RUNTIME_ENV_NAMES if name in environment)
            environment["WSLENV"] = ":".join(filter(None, [environment.get("WSLENV", ""), *forwarded]))
        return environment

    def command(self, action, **kwargs):
        if not self.available:
            raise CenterError("EXECUTION_DOMAIN_UNCONFIGURED", "Select an explicit execution domain first", 409)
        command = ["python3", self.path(self.framework_root / "scripts/core/center_runner.py"), action]
        for name, value in kwargs.items():
            if value is not None:
                command += ["--" + name.replace("_", "-"), self.path(value) if name in {"root", "manifest"} else str(value)]
        return self._wsl() + ["--exec", *command] if self.domain["platform"] == "wsl" else command

    def query(self, action, **kwargs):
        return json.loads(self._execute(self.command(action, **kwargs), timeout=15).stdout)

    def launch(self, manifest):
        path = Path(manifest)
        output = (path.parent / "bridge.log").open("ab")
        try:
            return subprocess.Popen(self.command("run", manifest=manifest), stdin=subprocess.DEVNULL, stdout=output,
                                    env=self.environment(),
                                    stderr=subprocess.STDOUT, **({"creationflags": subprocess.CREATE_NO_WINDOW} if os.name == "nt" else {"start_new_session": True}))
        finally:
            output.close()

    def media(self, manifest):
        return json.loads(self._execute(self.command("media", manifest=manifest), timeout=165).stdout)

    def clone(self, source, prepared, revision, staging):
        if self.domain.get("platform") == "wsl":
            # Windows worktree administrative paths are not valid in WSL. A
            # bundle preserves the full Git baseline without sharing metadata.
            bundle = Path(staging) / "framework.bundle"
            self._execute(["git", "-C", str(source), "bundle", "create", str(bundle), "HEAD"], timeout=180)
            self._execute(self._wsl() + ["--exec", "git", "clone", "--no-checkout", self.path(bundle), self.path(prepared)], timeout=180)
            self._execute(self._wsl() + ["--exec", "git", "-C", self.path(prepared), "checkout", "--detach", revision], timeout=90)
        else:
            self._execute(["git", "clone", "--no-hardlinks", "--no-checkout", "--local", str(source), str(prepared)], timeout=180)
            self._execute(["git", "-C", str(prepared), "checkout", "--detach", revision], timeout=90)


class CenterRuntime:
    def __init__(self, store, catalog, framework_root, execution_domain=None, *, adapter=None):
        self.store, self.catalog, self.framework_root = store, catalog, Path(framework_root).resolve()
        self.data_dir = Path(store.data_dir)
        self._mutex = threading.RLock()
        self._prepare_mutex = threading.Lock()
        self._session_id = uid("session")
        self._closing = threading.Event()
        self._thread = None
        self._workers = set()
        self._children = {}
        self._last_refresh = {}
        if execution_domain is None and os.name != "nt":
            execution_domain = {"platform": "posix"}
        self._validate_domain(execution_domain)
        with store.transaction() as tx:
            domain = tx.get("controls", "execution_domain")
            if domain and execution_domain and domain["domain"] != execution_domain:
                raise CenterError("EXECUTION_DOMAIN_CONFLICT", "This center already owns another execution domain", 409)
            if not domain and execution_domain:
                domain = {"domain": execution_domain}
                tx.put("controls", "execution_domain", domain)
            self.domain = domain["domain"] if domain else None
            queue = tx.get("controls", "queue") or {"revision": 0}
            queue.update(dispatchEnabled=False, revision=queue["revision"] + 1, reason="center_restarted")
            tx.put("controls", "queue", queue)
            if not tx.get("preferences", "main"):
                sys.path.insert(0, str(self.framework_root / "scripts/core"))
                from localization import system_language
                language = system_language(os.environ)
                tx.put("preferences", "main", {"language": language, "productLanguage": language, "engine": "codex", "model": "", "effort": "high", "revision": 1})
            # A single-item authorization also expires at a center restart.
            for request in tx.list("requests"):
                if request["state"] == "queued" and request.get("startAuthorized"):
                    request["startAuthorized"] = False
                    tx.put("requests", request["requestId"], request)
            for operation in tx.list("operations"):
                if operation.get("state") in {"preparing", "running"}:
                    operation.update(state="attention", reason="recovery_required")
                    tx.put("operations", operation["operationId"], operation)
        self.adapter = adapter or PosixAdapter(self.framework_root, self.domain)

    @staticmethod
    def _validate_domain(domain):
        if domain is None:
            return
        if not isinstance(domain, dict) or domain.get("platform") not in {"posix", "wsl"}:
            raise CenterError("INVALID_DOMAIN", "Invalid execution domain")
        if domain["platform"] == "wsl":
            for key in ("distribution", "user"):
                if not isinstance(domain.get(key), str) or not re.fullmatch(r"[A-Za-z0-9_. -]{1,80}", domain[key]) or domain[key].startswith("-"):
                    raise CenterError("INVALID_DOMAIN", "WSL requires an explicit distribution and user")

    def start(self):
        if self._thread is None:
            with self.store.transaction() as tx:
                preparations = [row["operationId"] for row in tx.list("operations") if row.get("kind") == "exploration"
                                and row.get("state") == "attention" and row.get("reason") == "recovery_required"]
            for operation_id in preparations:
                self._worker(self._prepare_exploration, operation_id)
            self._thread = threading.Thread(target=self._supervise, name="center-supervisor", daemon=True)
            self._thread.start()

    def close(self):
        # Callers intentionally shutting down the backend also stop its work.
        self._closing.set()
        with self._mutex:
            with self.store.transaction() as tx:
                self._pause(tx, "center_shutdown")
                for request in tx.list("requests"):
                    if request["state"] in {"starting", "running", "stopping"} or request["state"] == "attention" and request.get("dispatchId"):
                        self._stop_tx(tx, request, {}, "center", "center_shutdown")
                self._stop_media_tx(tx)
            self._write_controls()
        if self._thread:
            self._thread.join()
        for worker in list(self._workers):
            # Clone/media commands have their own bounded deadlines. Storage
            # ownership outlives their final audit write, including shutdown.
            worker.join()

    def _expected(self, body, record=None):
        expected = body.get("expectedRevision")
        actual = record.get("revision", 0) if record else self.store.revision
        if expected is not None and expected != actual:
            raise CenterError("REVISION_CONFLICT", "The item changed; refresh before retrying", 409, {"revision": actual})

    def _idempotent(self, tx, scope, body):
        if self._closing.is_set():
            raise CenterError("CENTER_CLOSING", "Center is shutting down", 503)
        key = body.get("idempotencyKey")
        if not isinstance(key, str) or not 8 <= len(key) <= 200:
            raise CenterError("IDEMPOTENCY_REQUIRED", "A stable idempotency key is required")
        identity = digest([scope, key])
        body_hash = digest({key: value for key, value in body.items() if key != "_provenance"})
        previous = tx.get("idempotency", identity)
        if previous and previous["bodyHash"] != body_hash:
            raise CenterError("IDEMPOTENCY_CONFLICT", "The idempotency key belongs to different input", 409)
        return identity, body_hash, previous.get("result") if previous else None

    def _remember(self, tx, identity, body_hash, result):
        tx.put("idempotency", identity, {"bodyHash": body_hash, "result": result, "createdAt": now()})

    def _event(self, tx, request, before, actor, reason=None, body=None):
        event_id = uid("event")
        supplied = (body or {}).get("_provenance", {})
        provenance = {key: supplied[key] for key in ("channel", "actionId", "sessionId", "receiptId") if key in supplied}
        provenance.setdefault("channel", {"local_operator_intent": "local_api", "runner": "runner_receipt", "recovery": "reconciliation"}.get(actor, "center"))
        if actor == "runner" and request.get("dispatchId"):
            provenance.setdefault("receiptId", request["dispatchId"])
        tx.put("events", event_id, {"eventId": event_id, "requestId": request["requestId"], "fromState": before,
                                   "toState": request["state"], "actorKind": actor, "authenticatedUserId": None,
                                   "provenance": provenance, "recordedAt": now(), "reason": reason})

    def _transition(self, tx, request, state, actor, reason=None, body=None, **fields):
        old = request["state"]
        if state != old and state not in EDGES.get(old, set()):
            raise CenterError("INVALID_TRANSITION", "The request is already in a different state", 409)
        if old in TERMINAL:
            return request
        request.update(state=state, revision=request.get("revision", 0) + 1, **fields)
        if state in TERMINAL:
            request["endedAt"] = now()
            request["attentionReason"] = None
        tx.put("requests", request["requestId"], request)
        self._event(tx, request, old, actor, reason, body)
        return request

    def _pause(self, tx, reason):
        queue = tx.get("controls", "queue")
        if queue.get("dispatchEnabled") or queue.get("reason") != reason:
            queue.update(dispatchEnabled=False, reason=reason, revision=queue["revision"] + 1)
            tx.put("controls", "queue", queue)

    def summary(self):
        with self.store.transaction() as tx:
            requests, queue = tx.list("requests"), tx.get("controls", "queue")
            entries = [entry for entry in tx.list("entries") if not entry.get("detached")]
            current = next((request for request in requests if request["state"] in ACTIVE and request.get("dispatchId")), None)
            current = self._request_view(tx, current) if current else None
            return {"dispatchEnabled": queue["dispatchEnabled"], "queueRevision": queue["revision"], "currentRequest": current,
                    "queuedCount": sum(row["state"] == "queued" for row in requests),
                    "attentionCount": sum(row["state"] == "attention" for row in requests),
                    "counts": {kind: sum(row.get("kind") == kind for row in entries) for kind in ("product", "exploration", "legacy", "reference")},
                    "language": tx.get("preferences", "main")["language"], "executionDomain": self.domain,
                    "executionAvailable": self.adapter.available, "dispatchReason": queue.get("reason")}

    def decorate_entry(self, entry):
        """Cheap list projection; live evidence is cached by the supervisor."""
        result = dict(entry)
        with self.store.transaction() as tx:
            rows = sorted([row for row in tx.list("requests") if row["entryId"] == entry["entryId"]], key=lambda row: row["createdAt"], reverse=True)
            request = next((row for row in rows if row["state"] in OPEN), rows[0] if rows else None)
            runtime = tx.get("runtimes", entry.get("runtimeId")) if entry.get("runtimeId") else None
            source = tx.get("sources", entry.get("sourceId")) if entry.get("sourceId") else None
            busy = any(row["state"] in ACTIVE for row in tx.list("requests")) or self._busy_operation(tx)
            preparations = [row for row in tx.list("operations") if row.get("reserved", {}).get("entryId") == entry["entryId"] and row.get("state") == "preparing"]
        if request:
            state = request["state"]
            if state in {"starting", "running", "stopping"} and not request.get("liveConfirmedAt"):
                state = "unknown"
            elif state in {"starting", "running", "stopping"}:
                try:
                    if (datetime.now(timezone.utc) - datetime.fromisoformat(request["liveConfirmedAt"])).total_seconds() > 15:
                        state = "unknown"
                except (TypeError, ValueError):
                    state = "unknown"
            if state == "failed":
                state = "attention"
            elif state == "canceled":
                state = "ended"
            result["executionSummary"] = {"state": state, "requestId": request["requestId"], "terminalReason": request.get("terminalReason"), "attentionReason": request.get("attentionReason")}
        else:
            result["executionSummary"] = {"state": "preparing" if preparations else "idle" if runtime and runtime.get("managed") else "unknown",
                                          "reason": None if runtime and runtime.get("managed") else "unmanaged_source"}
        executable = bool(runtime and runtime.get("managed") and runtime.get("executionDomain") == self.domain and self.adapter.available
                          and entry.get("availability") == "available" and not entry.get("archived") and not entry.get("detached"))
        if executable:
            try:
                marker = read_json(Path(runtime["root"]) / MARKER)
                executable = all(marker.get(key) == value for key, value in {"centerId": self.store.center_id, "runtimeId": runtime["runtimeId"],
                                      "entryId": entry["entryId"], "sourceId": entry["sourceId"]}.items())
            except (OSError, ValueError, KeyError):
                executable = False
        takeover = False
        if source and not (runtime and runtime.get("managed")) and self.adapter.available and entry.get("kind") in {"product", "exploration"} and entry.get("availability") == "available" and not entry.get("archived"):
            sys.path.insert(0, str(self.framework_root / "scripts/core"))
            from center_runner import compatible
            takeover = compatible(source["root"])
        result["capabilities"] = {**entry.get("capabilities", {}), "execute": executable,
                                  "preview": executable and bool(entry.get("productId")) and not busy,
                                  "capture": executable and bool(entry.get("productId")) and not busy,
                                  "takeover": takeover, "release": executable and not any(row["state"] in OPEN for row in rows) and not busy}
        result["sourceRecordRevision"] = source.get("revision") if source else None
        result["capabilityReasons"] = {"execute": None if executable else "read_only_source" if self.adapter.available else "execution_domain_unconfigured",
                                       "takeover": None if takeover else "runtime_incompatible" if self.adapter.available else "execution_domain_unconfigured",
                                       "release": "execution_domain_unconfigured" if not self.adapter.available else "read_only_source" if not executable else
                                                  "open_request_exists" if any(row["state"] in OPEN for row in rows) else "slot_busy" if busy else None,
                                       "media": "slot_busy" if busy else None}
        return result

    def list_requests(self, query=None):
        query = query or {}
        with self.store.transaction() as tx:
            items = tx.list("requests")
            if query.get("state"):
                items = [row for row in items if row["state"] == query["state"]]
            items.sort(key=lambda row: (row.get("order", 0), row["createdAt"]))
            return {"items": [self._request_view(tx, row) for row in items], "revision": tx.get("controls", "queue")["revision"]}

    @staticmethod
    def _request_view(tx, request):
        entry = tx.get("entries", request["entryId"]) or {}
        projection = tx.get("projections", request["sourceId"]) or {}
        visible = {key: value for key, value in request.items() if key not in {"nonce", "configFingerprint"}}
        if isinstance(visible.get("receipt"), dict):
            visible["receipt"] = {key: value for key, value in visible["receipt"].items() if key not in {"root", "nonce"}}
        return {**visible, "displayName": projection.get("displayName") or entry.get("displayName"),
                "entryKind": entry.get("kind"), "cycleNumber": projection.get("cycleNumber"), "reportedPhase": projection.get("reportedPhase")}

    def get_request(self, request_id):
        with self.store.transaction() as tx:
            request = tx.get("requests", request_id)
            if not request:
                raise CenterError("NOT_FOUND", "Request not found", 404)
            return {**self._request_view(tx, request), "events": sorted([row for row in tx.list("events") if row.get("requestId") == request_id], key=lambda row: row["recordedAt"])}

    def _source(self, entry_id, source_id=None):
        entry, source, _ = self.catalog.resolve_source(entry_id, source_id)
        with self.store.transaction() as tx:
            runtime = tx.get("runtimes", source.get("runtimeId")) if source.get("runtimeId") else None
        if entry.get("archived") or entry.get("detached") or source.get("availability") not in {"available", None}:
            raise CenterError("CONTEXT_UNAVAILABLE", "Source is unavailable or archived", 409)
        if not runtime or not runtime.get("managed") or runtime.get("executionDomain") != self.domain:
            raise CenterError("READ_ONLY_SOURCE", "Source has no managed execution context", 403)
        marker = read_json(Path(source["root"]) / MARKER)
        if any(marker.get(key) != value for key, value in {"centerId": self.store.center_id, "runtimeId": runtime["runtimeId"], "entryId": entry_id, "sourceId": source["sourceId"]}.items()):
            raise CenterError("SOURCE_CONFLICT", "Managed source identity changed", 409)
        return entry, source, runtime

    def _config(self, body, root=None, tx=None):
        if tx is not None:
            preferences = tx.get("preferences", "main")
        else:
            with self.store.transaction() as config_tx:
                preferences = config_tx.get("preferences", "main")
        config = {key: preferences[key] for key in ("engine", "model", "effort", "productLanguage")}
        supplied = body.get("config", {})
        if not isinstance(supplied, dict) or set(supplied) - set(config):
            raise CenterError("INVALID_CONFIG", "Unsupported execution configuration")
        config.update(supplied)
        if config["engine"] not in ENGINES or config["effort"] not in EFFORTS or config["productLanguage"] not in {"en", "zh-CN"}:
            raise CenterError("INVALID_CONFIG", "Invalid engine, effort or product language")
        if not isinstance(config["model"], str) or len(config["model"]) > 200 or any(ord(char) < 32 for char in config["model"]):
            raise CenterError("INVALID_CONFIG", "Invalid model name")
        if body.get("configRevision") is not None and body["configRevision"] != preferences["revision"]:
            raise CenterError("REVISION_CONFLICT", "Default configuration changed", 409)
        if root:
            sys.path.insert(0, str(self.framework_root / "scripts/core"))
            from localization import language_state
            language = language_state(Path(root), {"AUTO_COMPANY_LANGUAGE": config["productLanguage"]})
            if language["locked"]:
                if "productLanguage" in supplied and supplied["productLanguage"] != language["language"]:
                    raise CenterError("PRODUCT_LANGUAGE_LOCKED", "Existing product language is immutable", 409)
                config["productLanguage"] = language["language"]
        config["configRevision"] = preferences["revision"]
        return config

    def _new_request(self, tx, entry, source, runtime, body, request_id=None):
        kind, mode = body.get("kind", "continue"), body.get("executionMode", "enqueue")
        if kind not in {"explore", "continue"} or mode not in {"enqueue", "start_now"}:
            raise CenterError("INVALID_REQUEST", "Invalid request kind or execution mode")
        rows = tx.list("requests")
        if any(row["entryId"] == entry["entryId"] and row["state"] in OPEN for row in rows):
            raise CenterError("OPEN_REQUEST_EXISTS", "This entry already has an open request", 409)
        if mode == "start_now" and (any(row["state"] in OPEN for row in rows) or self._busy_operation(tx)):
            raise CenterError("SLOT_BUSY", "A running or earlier waiting request occupies the slot", 409)
        config = self._config(body, source["root"], tx)
        request_id = request_id or uid("request")
        request = {"requestId": request_id, "entryId": entry["entryId"], "sourceId": source["sourceId"], "runtimeId": runtime["runtimeId"],
                   "displayName": entry.get("displayName"), "kind": kind, "state": "queued", "executionMode": mode,
                   "startAuthorized": mode == "start_now", "createdAt": now(), "startedAt": None, "endedAt": None,
                   "dispatchId": None, "revision": 1, "order": max([row.get("order", 0) for row in rows] + [0]) + 1,
                   "terminalReason": None, "attentionReason": None, "reasonDetail": None, "config": config,
                   "sourceRevision": source["sourceRevision"], "configFingerprint": config_fingerprint(source["root"]),
                   "frameworkRevision": runtime.get("frameworkRevision"), "previousRequestId": body.get("previousRequestId"),
                   "executionScope": "managed_runtime", "budgetConfigRevision": digest({key: os.environ.get(key) for key in sorted(RUNTIME_ENV_NAMES) if key.startswith("USAGE_")}),
                   "permissionConfigRevision": digest({key: os.environ.get(key) for key in ("CODEX_SANDBOX_MODE", "CLAUDE_PERMISSION_MODE", "CURSOR_SANDBOX_MODE")})}
        tx.put("requests", request_id, request)
        self._event(tx, request, None, "local_operator_intent", "request_created", body)
        return request

    def create_request(self, body):
        with self._mutex:
            with self.store.transaction() as tx:
                key, body_hash, previous = self._idempotent(tx, "request", body)
                if previous:
                    return self._request_view(tx, tx.get("requests", previous["requestId"]))
                self._expected(body)
            entry, source, runtime = self._source(body.get("entryId"), body.get("sourceId"))
            if body.get("runtimeId") not in {None, runtime["runtimeId"]} or body.get("expectedSourceRevision") != source["sourceRevision"]:
                raise CenterError("SOURCE_CHANGED", "Source revision changed", 409)
            if not self.adapter.available:
                raise CenterError("EXECUTION_DOMAIN_UNCONFIGURED", "Execution domain is not configured", 409)
            check = self.adapter.query("preflight", root=source["root"])
            if not check.get("quiescent"):
                raise CenterError(str(check.get("reason", "CONTEXT_UNAVAILABLE")).upper(), "Source cannot start until its current protection or owner is resolved", 409)
            with self.store.transaction() as tx:
                request = self._new_request(tx, entry, source, runtime, body)
                self._remember(tx, key, body_hash, {"requestId": request["requestId"]})
                return self._request_view(tx, request)

    def _stop_tx(self, tx, request, body, actor="local_operator_intent", reason="user_stop"):
        if request["state"] not in {"starting", "running", "stopping", "attention"} or not request.get("dispatchId"):
            raise CenterError("NOT_STARTED", "Only an owned dispatch can be stopped", 409)
        if body.get("expectedDispatchId") not in {None, request["dispatchId"]}:
            raise CenterError("DISPATCH_CONFLICT", "Dispatch identity changed", 409)
        request["stopRequested"] = True
        request["stopReason"] = reason
        self._transition(tx, request, "stopping", actor, reason, body)
        tx.put("controls", request["dispatchId"], {"stop": True, "reason": reason, "requestId": request["requestId"], "dispatchId": request["dispatchId"]})
        return request

    def request_action(self, request_id, action, body):
        with self._mutex:
            with self.store.transaction() as tx:
                key, body_hash, previous = self._idempotent(tx, request_id + "/" + action, body)
                if previous:
                    return tx.get("requests", request_id)
                request = tx.get("requests", request_id)
                if not request:
                    raise CenterError("NOT_FOUND", "Request not found", 404)
                self._expected(body, request)
                if action == "cancel":
                    if request["state"] != "queued":
                        raise CenterError("ALREADY_STARTED", "This request can no longer be canceled; use Stop", 409)
                    self._transition(tx, request, "canceled", "local_operator_intent", "user_cancel", body, terminalReason="user_cancel")
                elif action == "stop":
                    self._stop_tx(tx, request, body)
                elif action != "reconcile":
                    raise CenterError("INVALID_ACTION", "Unknown request action")
                self._remember(tx, key, body_hash, {"requestId": request_id})
            if action == "reconcile":
                self._reconcile(request)
            else:
                self._write_controls()
            return self.get_request(request_id)

    @staticmethod
    def _busy_operation(tx):
        return any(row.get("kind") != "exploration" and row.get("state") in {"running", "preparing", "attention"} for row in tx.list("operations"))

    @staticmethod
    def _stop_media_tx(tx):
        for operation in tx.list("operations"):
            if operation.get("kind") in {"capture", "preview_start", "preview_stop"} and operation.get("state") == "running":
                operation["stopRequested"] = True
                tx.put("operations", operation["operationId"], operation)

    def queue_action(self, action, body):
        with self._mutex:
            with self.store.transaction() as tx:
                key, body_hash, previous = self._idempotent(tx, "queue/" + action, body)
                if previous:
                    return tx.get("controls", "queue")
                queue = tx.get("controls", "queue")
                self._expected(body, queue)
                requests = tx.list("requests")
                if action == "resume":
                    if not self.adapter.available or any(row["state"] == "attention" for row in requests) or self._busy_operation(tx):
                        raise CenterError("RECOVERY_REQUIRED", "Resolve outstanding ownership or operation issues first", 409)
                    queue.update(dispatchEnabled=True, reason=None)
                elif action in {"pause", "stop-all"}:
                    queue.update(dispatchEnabled=False, reason="user_pause" if action == "pause" else "stop_all")
                    if action == "stop-all":
                        self._stop_media_tx(tx)
                        for request in requests:
                            if request["state"] in ACTIVE and request.get("dispatchId"):
                                self._stop_tx(tx, request, body, reason="user_stop")
                elif action == "order":
                    ordered = body.get("requestIds")
                    waiting = {row["requestId"] for row in requests if row["state"] == "queued"}
                    if not isinstance(ordered, list) or len(ordered) != len(set(ordered)) or set(ordered) != waiting:
                        raise CenterError("REVISION_CONFLICT", "Queue order must contain every waiting request exactly once", 409)
                    for index, request_id in enumerate(ordered):
                        request = tx.get("requests", request_id)
                        request.update(order=index, revision=request["revision"] + 1)
                        tx.put("requests", request_id, request)
                else:
                    raise CenterError("INVALID_ACTION", "Unknown queue action")
                queue["revision"] += 1
                tx.put("controls", "queue", queue)
                event_id = uid("event")
                tx.put("events", event_id, {"eventId": event_id, "actorKind": "local_operator_intent", "authenticatedUserId": None,
                                           "provenance": body.get("_provenance", {"channel": "local_api"}), "action": "queue/" + action, "recordedAt": now()})
                self._remember(tx, key, body_hash, queue)
            self._write_controls()
            return queue

    def preferences(self, body=None):
        with self.store.transaction() as tx:
            preferences = tx.get("preferences", "main")
            if body is None:
                return {**preferences, "executionDomain": self.domain, "executionAvailable": self.adapter.available}
            key, body_hash, previous = self._idempotent(tx, "preferences", body)
            if previous:
                return previous
            self._expected(body, preferences)
            updates = body.get("preferences", {key: value for key, value in body.items() if key in preferences and key != "revision"})
            if not isinstance(updates, dict) or set(updates) - {"language", "productLanguage", "engine", "model", "effort"}:
                raise CenterError("INVALID_PREFERENCE", "Unknown preference")
            candidate = {**preferences, **updates}
            if candidate["language"] not in {"zh-CN", "en"} or candidate["productLanguage"] not in {"zh-CN", "en"} or candidate["engine"] not in ENGINES or candidate["effort"] not in EFFORTS:
                raise CenterError("INVALID_PREFERENCE", "Invalid preference")
            if not isinstance(candidate["model"], str) or len(candidate["model"]) > 200 or any(ord(c) < 32 for c in candidate["model"]):
                raise CenterError("INVALID_PREFERENCE", "Invalid model name")
            candidate["revision"] += 1
            tx.put("preferences", "main", candidate)
            self._remember(tx, key, body_hash, candidate)
            return candidate

    def operation(self, operation_id):
        with self.store.transaction() as tx:
            operation = tx.get("operations", operation_id)
            if not operation:
                raise CenterError("NOT_FOUND", "Operation not found", 404)
            return operation

    def _worker(self, function, *args):
        if self._closing.is_set():
            raise CenterError("CENTER_CLOSING", "Center is shutting down", 503)
        def target():
            try:
                function(*args)
            finally:
                self._workers.discard(threading.current_thread())
        worker = threading.Thread(target=target, daemon=True)
        self._workers.add(worker)
        worker.start()

    def create_exploration(self, body):
        with self._mutex:
            with self.store.transaction() as tx:
                key, body_hash, previous = self._idempotent(tx, "exploration", body)
                if previous:
                    operation = tx.get("operations", previous["operationId"])
                    if operation["state"] == "attention" and operation.get("reason") == "recovery_required":
                        self._worker(self._prepare_exploration, operation["operationId"])
                    return operation
                self._expected(body)
                if not self.adapter.available:
                    raise CenterError("EXECUTION_DOMAIN_UNCONFIGURED", "Execution domain is not configured", 409)
                direction = body.get("direction", "")
                if not isinstance(direction, str) or len(direction) > 5000:
                    raise CenterError("INVALID_DIRECTION", "Direction must be bounded text")
                mode = body.get("executionMode", "enqueue")
                if mode not in {"enqueue", "start_now"}:
                    raise CenterError("INVALID_REQUEST", "Invalid execution mode")
                if mode == "start_now" and any(row["state"] in OPEN for row in tx.list("requests")):
                    raise CenterError("SLOT_BUSY", "An earlier request occupies the slot", 409)
                operation_id = uid("operation")
                reserved = {key: uid(prefix) for key, prefix in (("entryId", "entry"), ("sourceId", "source"), ("runtimeId", "runtime"), ("requestId", "request"))}
                operation = {"operationId": operation_id, "kind": "exploration", "state": "preparing", "createdAt": now(),
                             "reserved": reserved, "input": {"direction": direction, "executionMode": mode, "config": self._config(body, tx=tx)},
                             "authorizationSession": self._session_id, "queueRevision": tx.get("controls", "queue")["revision"],
                             "revision": 1, "actorKind": "local_operator_intent", "authenticatedUserId": None,
                             "provenance": body.get("_provenance", {"channel": "local_api"})}
                tx.put("operations", operation_id, operation)
                self._remember(tx, key, body_hash, {"operationId": operation_id})
            self._worker(self._prepare_exploration, operation_id)
            return operation

    def _framework(self):
        status = subprocess.run(["git", "-C", str(self.framework_root), "status", "--porcelain", "--untracked-files=all"], capture_output=True, text=True, check=True, timeout=15).stdout
        if status.strip():
            raise CenterError("FRAMEWORK_UNVERIFIED", "New contexts require a clean committed compatible framework", 409)
        revision = subprocess.run(["git", "-C", str(self.framework_root), "rev-parse", "HEAD"], capture_output=True, text=True, check=True, timeout=15).stdout.strip()
        if not re.fullmatch(r"[0-9a-f]{40,64}", revision):
            raise CenterError("FRAMEWORK_UNVERIFIED", "Framework revision cannot be verified", 409)
        return revision

    def _prepare_exploration(self, operation_id):
        # Preparation may safely resume from the manifest, but never grants a
        # fresh execution authorization after restart or queue pause.
        with self._prepare_mutex:
            operation = self.operation(operation_id)
            if operation["state"] == "succeeded":
                return
            reserved = operation["reserved"]
            staging = self.data_dir / "staging" / operation_id
            target = self.data_dir / "runtimes" / reserved["runtimeId"]
            try:
                revision = operation.get("frameworkRevision") or self._framework()
                staging.mkdir(parents=True, exist_ok=True)
                intent = staging / "intent.json"
                manifest = {"operationId": operation_id, "centerId": self.store.center_id, "reserved": reserved, "frameworkRevision": revision, "target": str(target)}
                if intent.exists() and read_json(intent) != manifest:
                    raise CenterError("RECOVERY_REQUIRED", "Preparation ownership manifest differs", 409)
                atomic_json(intent, manifest)
                with self.store.transaction() as tx:
                    operation.update(frameworkRevision=revision, state="preparing", reason=None)
                    tx.put("operations", operation_id, operation)
                prepared = staging / "runtime"
                if not target.exists():
                    if not prepared.exists():
                        self.adapter.clone(self.framework_root, prepared, revision, staging)
                    actual = subprocess.run(["git", "-C", str(prepared), "rev-parse", "HEAD"], check=True, capture_output=True, text=True, timeout=15).stdout.strip()
                    if actual != revision or not (prepared / "scripts/core/center_runner.py").is_file():
                        raise CenterError("RUNTIME_INCOMPATIBLE", "Prepared framework identity differs", 409)
                    configuration = operation["input"]["config"]
                    (prepared / ".auto-company.local").write_text("AUTO_COMPANY_LANGUAGE=" + configuration["productLanguage"] + "\n", encoding="utf-8")
                    if operation["input"]["direction"]:
                        consensus = prepared / "memories/consensus.md"
                        if not consensus.exists():
                            shutil.copyfile(prepared / "memories/consensus.template.md", consensus)
                        text = consensus.read_text(encoding="utf-8")
                        heading = "## Human Overrides"
                        if heading not in text:
                            raise CenterError("RUNTIME_INCOMPATIBLE", "Framework has no human direction section", 409)
                        text = text.replace(heading, heading + "\n\n" + operation["input"]["direction"], 1)
                        consensus.write_text(text, encoding="utf-8")
                    atomic_json(prepared / MARKER, {"protocolVersion": 1, "centerId": self.store.center_id, **{key: reserved[key] for key in ("entryId", "sourceId", "runtimeId")}, "operationId": operation_id})
                    target.parent.mkdir(parents=True, exist_ok=True)
                    os.replace(prepared, target)
                marker = read_json(target / MARKER)
                if marker.get("operationId") != operation_id or marker.get("centerId") != self.store.center_id:
                    raise CenterError("RECOVERY_REQUIRED", "Prepared target ownership cannot be verified", 409)
                entry = {"entryId": reserved["entryId"], "kind": "exploration", "productId": None, "explorationId": None,
                         "preferredSourceId": reserved["sourceId"], "archived": False, "detached": False, "revision": 1,
                         "displayName": None, "description": None}
                source = {"sourceId": reserved["sourceId"], "entryId": reserved["entryId"], "runtimeId": reserved["runtimeId"], "root": str(target),
                          "project": None, "productId": None, "explorationId": None, "kind": "exploration", "availability": "available",
                          "sourceRevision": 1, "revision": 1, "fingerprint": None, "identityFingerprint": None,
                          "capabilities": {"readJournal": True, "readMedia": True, "execute": True, "preview": False, "capture": False}}
                runtime = {"runtimeId": reserved["runtimeId"], "root": str(target), "entryId": reserved["entryId"], "sourceId": reserved["sourceId"],
                           "centerId": self.store.center_id, "protocolVersion": 1, "managed": True, "executionDomain": self.domain, "frameworkRevision": revision}
                with self.store.transaction() as tx:
                    tx.put("entries", entry["entryId"], entry)
                    tx.put("sources", source["sourceId"], source)
                    tx.put("runtimes", runtime["runtimeId"], runtime)
                    config = {key: value for key, value in operation["input"]["config"].items() if key != "configRevision"}
                    request_body = {"kind": "explore", "executionMode": "enqueue", "config": config, "_provenance": operation["provenance"]}
                    request = self._new_request(tx, entry, source, runtime, request_body, reserved["requestId"])
                    request["config"] = operation["input"]["config"]
                    request["preparationPending"] = True
                    tx.put("requests", request["requestId"], request)
                    if operation["input"]["executionMode"] == "start_now":
                        if (any(row["requestId"] != request["requestId"] and row["state"] in OPEN for row in tx.list("requests"))
                                or tx.get("controls", "queue")["revision"] != operation["queueRevision"]):
                            self._transition(tx, request, "attention", "center", "slot_changed", attentionReason="preflight", reasonDetail="slot_changed")
                        elif operation.get("authorizationSession") == self._session_id and not self._closing.is_set():
                            request.update(startAuthorized=True, executionMode="start_now")
                            tx.put("requests", request["requestId"], request)
                    operation.update(state="succeeded", endedAt=now(), result=reserved, revision=operation["revision"] + 1)
                    tx.put("operations", operation_id, operation)
                # Source discovery owns product/exploration identities, never us.
                self._refresh_source(source["sourceId"], update_waiting=True)
                with self.store.transaction() as tx:
                    request = tx.get("requests", reserved["requestId"])
                    request["preparationPending"] = False
                    tx.put("requests", request["requestId"], request)
            except Exception as exc:
                with self.store.transaction() as tx:
                    operation.update(state="attention" if target.exists() or (staging / "runtime").exists() else "failed",
                                     reason=getattr(exc, "code", "preparation_failed"), endedAt=now(), revision=operation["revision"] + 1)
                    tx.put("operations", operation_id, operation)

    def _refresh_source(self, source_id, update_waiting=False):
        source = self.catalog.refresh_source(source_id)
        if update_waiting:
            with self.store.transaction() as tx:
                for request in tx.list("requests"):
                    if request["sourceId"] == source_id and request["state"] == "queued":
                        request["sourceRevision"] = source["sourceRevision"]
                        tx.put("requests", request["requestId"], request)
        return source

    def source_action(self, source_id, action, body):
        if action not in {"takeover", "release"}:
            raise CenterError("INVALID_ACTION", "Source action is not supported by runtime")
        with self._mutex:
            with self.store.transaction() as tx:
                _, _, previous_result = self._idempotent(tx, source_id + "/" + action, body)
                previous_operation = tx.get("operations", previous_result["operationId"]) if previous_result else None
            if previous_operation:
                return self._recover_binding(previous_operation) if previous_operation.get("state") == "attention" else previous_operation
            with self.store.transaction() as tx:
                key, body_hash, previous = self._idempotent(tx, source_id + "/" + action, body)
                if previous:
                    return tx.get("operations", previous["operationId"])
                source = tx.get("sources", source_id)
                if not source:
                    raise CenterError("NOT_FOUND", "Source not found", 404)
                self._expected(body, source)
                if any(row["state"] in OPEN and row["sourceId"] == source_id for row in tx.list("requests")):
                    raise CenterError("OPEN_REQUEST_EXISTS", "Resolve open requests before changing ownership", 409)
                entry = tx.get("entries", source["entryId"])
                if action == "takeover":
                    matching_entries = {row["entryId"] for row in tx.list("entries") if row["entryId"] == entry["entryId"] or
                                        entry.get("productId") and row.get("productId") == entry["productId"]}
                    if any(row.get("managed") and row.get("entryId") in matching_entries and row.get("sourceId") != source_id for row in tx.list("runtimes")):
                        raise CenterError("OWNER_CONFLICT", "Another managed source owns this product; release it first", 409)
            self.catalog.resolve_source(source["entryId"], source_id)
            if source.get("kind") in {"archive", "reference", "legacy"} or entry.get("kind") in {"legacy", "reference"}:
                raise CenterError("READ_ONLY_SOURCE", "This source cannot be taken over", 403)
            check = self.adapter.query("preflight", root=source["root"], center_id=self.store.center_id, allow_protected="1" if action == "release" else "0")
            if not check.get("quiescent"):
                raise CenterError(str(check.get("reason", "CONTEXT_UNAVAILABLE")).upper(), "Source is not safely available for ownership change", 409)
            root = Path(source["root"])
            marker_path = root / MARKER
            existing = read_json(marker_path) if marker_path.exists() else None
            if existing and (existing.get("centerId") != self.store.center_id or existing.get("sourceId") != source_id):
                raise CenterError("OWNER_CONFLICT", "Another center or source owns this root", 409)
            if action == "takeover":
                # Only the current original-ledger continuation context may write.
                sys.path.insert(0, str(self.framework_root / "scripts/core"))
                from product_identity import read_state
                state = read_state(root)
                current = state.get("continuationProductId")
                if source.get("productId") and current != source["productId"]:
                    raise CenterError("CONTEXT_UNAVAILABLE", "The source does not own the current continuation context", 409)
            operation_id = uid("operation")
            runtime_id = (existing or {}).get("runtimeId") or source.get("runtimeId") or uid("runtime")
            marker = {"protocolVersion": 1, "centerId": self.store.center_id, "runtimeId": runtime_id, "entryId": source["entryId"], "sourceId": source_id}
            operation = {"operationId": operation_id, "kind": action, "state": "running", "entryId": source["entryId"], "sourceId": source_id, "createdAt": now(), "revision": 1,
                         "actorKind": "local_operator_intent", "authenticatedUserId": None, "provenance": body.get("_provenance", {"channel": "local_api"})}
            with self.store.transaction() as tx:
                current_source = tx.get("sources", source_id)
                current_entry = tx.get("entries", source["entryId"])
                if (not current_source or current_source.get("revision") != source.get("revision") or current_source.get("sourceRevision") != source.get("sourceRevision") or current_source.get("root") != source.get("root")
                        or not current_entry or current_entry.get("detached") or current_entry.get("archived")
                        or current_entry.get("revision") != entry.get("revision")):
                    raise CenterError("SOURCE_CHANGED", "Source changed during ownership preflight", 409)
                if any(row.get("sourceId") == source_id and row.get("state") in {"running", "preparing", "attention"} for row in tx.list("operations")):
                    raise CenterError("OPERATION_BUSY", "Source has an unresolved operation", 409)
                tx.put("operations", operation_id, operation)
                tx.put("bindings", operation_id, {"operationId": operation_id, "sourceId": source_id, "oldMarker": existing, "marker": marker,
                                                    "root": str(root), "sourceRevision": source["sourceRevision"], "entryId": entry["entryId"],
                                                    "configFingerprint": config_fingerprint(root), "state": "prepared"})
                self._remember(tx, key, body_hash, {"operationId": operation_id})
            try:
                binding_path = self.data_dir / "operations" / operation_id / "binding.json"
                atomic_json(binding_path, {"action": action, "root": self.adapter.path(root), "oldMarker": existing, "marker": marker})
                self.adapter.query("bind", manifest=binding_path)
                with self.store.transaction() as tx:
                    if action == "takeover":
                        runtime = {**marker, "root": str(root), "managed": True, "executionDomain": self.domain, "frameworkRevision": body.get("frameworkRevision")}
                        tx.put("runtimes", runtime_id, runtime)
                        source.update(runtimeId=runtime_id, revision=source["revision"] + 1)
                        source["capabilities"].update(execute=True, preview=bool(source.get("productId")), capture=bool(source.get("productId")))
                        tx.put("sources", source_id, source)
                    else:
                        runtime = tx.get("runtimes", runtime_id)
                        if runtime:
                            runtime["managed"] = False
                            tx.put("runtimes", runtime_id, runtime)
                        source["capabilities"].update(execute=False, preview=False, capture=False)
                        source["revision"] += 1
                        tx.put("sources", source_id, source)
                    binding = tx.get("bindings", operation_id)
                    binding["state"] = "committed"
                    tx.put("bindings", operation_id, binding)
                    operation.update(state="succeeded", endedAt=now(), runtimeId=runtime_id)
                    tx.put("operations", operation_id, operation)
                return operation
            except Exception:
                with self.store.transaction() as tx:
                    operation.update(state="attention", reason="recovery_required")
                    tx.put("operations", operation_id, operation)
                raise

    def _recover_binding(self, operation):
        """Reconcile the existing intent only; never repeat uncertain OS writes."""
        operation_id, action = operation["operationId"], operation["kind"]
        with self.store.transaction() as tx:
            binding = tx.get("bindings", operation_id)
            source = tx.get("sources", operation["sourceId"])
            entry = tx.get("entries", source["entryId"]) if source else None
        if (not binding or not source or not entry or entry.get("detached") or entry.get("archived")
                or source["root"] != binding.get("root") or config_fingerprint(source["root"]) != binding.get("configFingerprint")):
            raise CenterError("RECOVERY_REQUIRED", "Binding source no longer matches its preparation manifest", 409)
        check = self.adapter.query("preflight", root=source["root"], center_id=self.store.center_id,
                                   allow_protected="1" if action == "release" else "0")
        if not check.get("quiescent"):
            raise CenterError("RECOVERY_REQUIRED", "Binding process ownership is not confirmed stopped", 409)
        target = Path(source["root"]) / MARKER
        actual = read_json(target) if target.exists() else None
        desired = binding["marker"] if action == "takeover" else None
        if actual != desired and actual != binding.get("oldMarker"):
            raise CenterError("OWNER_CONFLICT", "Binding marker belongs to an unknown owner", 409)
        with self.store.transaction() as tx:
            if actual == desired:
                runtime_id = binding["marker"]["runtimeId"]
                if action == "takeover":
                    if any(row.get("managed") and row.get("entryId") == entry["entryId"] and row.get("sourceId") != source["sourceId"] for row in tx.list("runtimes")):
                        raise CenterError("OWNER_CONFLICT", "Another managed source owns this entry", 409)
                    runtime = {**binding["marker"], "root": source["root"], "managed": True, "executionDomain": self.domain, "frameworkRevision": None}
                    tx.put("runtimes", runtime_id, runtime)
                    source.update(runtimeId=runtime_id, revision=source["revision"] + 1)
                    source["capabilities"].update(execute=True, preview=bool(source.get("productId")), capture=bool(source.get("productId")))
                    tx.put("sources", source["sourceId"], source)
                else:
                    runtime = tx.get("runtimes", runtime_id)
                    if runtime:
                        runtime["managed"] = False
                        tx.put("runtimes", runtime_id, runtime)
                    source["capabilities"].update(execute=False, preview=False, capture=False)
                    source["revision"] += 1
                    tx.put("sources", source["sourceId"], source)
                binding["state"] = "committed"
                operation.update(state="succeeded", reason=None, endedAt=now(), runtimeId=runtime_id, recovered=True)
            else:
                binding["state"] = "not_started"
                operation.update(state="failed", reason="binding_not_applied", endedAt=now(), recovered=True)
            operation["revision"] += 1
            tx.put("bindings", operation_id, binding)
            tx.put("operations", operation_id, operation)
            event_id = uid("event")
            tx.put("events", event_id, {"eventId": event_id, "operationId": operation_id, "actorKind": "recovery",
                                       "authenticatedUserId": None, "provenance": {"channel": "binding_receipt"}, "recordedAt": now(), "state": operation["state"]})
        return operation

    def media_action(self, entry_id, action, body):
        action = {"preview/start": "preview_start", "preview/stop": "preview_stop", "media/capture": "capture"}.get(action, action)
        if action not in {"capture", "preview_start", "preview_stop"}:
            raise CenterError("INVALID_ACTION", "Unknown media action")
        with self._mutex:
            with self.store.transaction() as tx:
                _, _, previous_result = self._idempotent(tx, entry_id + "/" + action, body)
                previous_operation = tx.get("operations", previous_result["operationId"]) if previous_result else None
            if previous_operation:
                return self._recover_media(previous_operation) if previous_operation.get("state") == "attention" else previous_operation
            with self.store.transaction() as tx:
                key, body_hash, previous = self._idempotent(tx, entry_id + "/" + action, body)
                if previous:
                    return tx.get("operations", previous["operationId"])
                if any(row["state"] in ACTIVE for row in tx.list("requests")) or self._busy_operation(tx):
                    raise CenterError("SLOT_BUSY", "Media and managed execution are serialized", 409)
            entry, source, runtime = self._source(entry_id, body.get("sourceId"))
            self._expected(body, source)
            if not source.get("productId") or not source.get("project"):
                raise CenterError("UNSUPPORTED", "Media requires a current product", 422)
            operation_id = uid("operation")
            operation = {"operationId": operation_id, "kind": action, "state": "running", "entryId": entry_id, "sourceId": source["sourceId"], "createdAt": now(), "revision": 1}
            manifest = {"operationId": operation_id, "centerId": self.store.center_id, "runtimeId": runtime["runtimeId"], "entryId": entry_id, "sourceId": source["sourceId"],
                        "root": self.adapter.path(source["root"]), "project": source["project"], "productId": source["productId"], "action": action}
            path = self.data_dir / "operations" / operation_id / "manifest.json"
            atomic_json(path, manifest)
            with self.store.transaction() as tx:
                tx.put("operations", operation_id, operation)
                self._remember(tx, key, body_hash, {"operationId": operation_id})
            self._write_controls()
            self._worker(self._run_media, operation_id, path)
            return operation

    def _run_media(self, operation_id, path):
        try:
            result = self.adapter.media(path)
            state, reason = ("succeeded", None) if result.get("ok") else ("failed", result.get("reason", "media_failed"))
        except Exception:
            state, reason = "attention", "media_cleanup_unconfirmed"
        with self.store.transaction() as tx:
            operation = tx.get("operations", operation_id)
            operation.update(state=state, reason=reason, endedAt=now(), revision=operation["revision"] + 1)
            tx.put("operations", operation_id, operation)

    def _recover_media(self, operation):
        path = self.data_dir / "operations" / operation["operationId"] / "manifest.json"
        observed = self.adapter.query("media-status", manifest=path)
        receipt = observed.get("receipt")
        if observed.get("slotFree") and receipt and receipt.get("cleanupConfirmed") and receipt.get("state") == "terminal":
            result = receipt.get("result", {})
            with self.store.transaction() as tx:
                operation.update(state="succeeded" if result.get("ok") else "failed", reason=result.get("reason"), recovered=True,
                                 endedAt=receipt.get("endedAt"), revision=operation["revision"] + 1)
                tx.put("operations", operation["operationId"], operation)
        return operation

    def _control(self, request):
        path = self.data_dir / "runner" / request["dispatchId"]
        return path

    def _write_controls(self):
        with self.store.transaction() as tx:
            requests = [row for row in tx.list("requests") if row["state"] in ACTIVE and row.get("dispatchId")]
            operations = [row for row in tx.list("operations") if row.get("kind") in {"capture", "preview_start", "preview_stop"} and row.get("state") == "running"]
        for operation in operations:
            atomic_json(self.data_dir / "operations" / operation["operationId"] / "control.json",
                        {"operationId": operation["operationId"], "heartbeat": time.time(), "stop": bool(operation.get("stopRequested"))})
        for request in requests:
            if not request.get("nonce"):
                continue
            atomic_json(self._control(request) / "control.json", {"centerId": self.store.center_id, "requestId": request["requestId"],
                        "dispatchId": request["dispatchId"], "nonce": request["nonce"], "heartbeat": time.time(),
                        "stop": bool(request.get("stopRequested")), "reason": request.get("stopReason")})

    def _dispatch(self):
        with self.store.transaction() as tx:
            requests = tx.list("requests")
            if any(row["state"] in ACTIVE for row in requests) or self._busy_operation(tx):
                return
            queued = sorted([row for row in requests if row["state"] == "queued"], key=lambda row: (row["order"], row["createdAt"]))
            if not queued:
                return
            request = queued[0]
            if request.get("preparationPending"):
                pending = request
            else:
                pending = None
            if not tx.get("controls", "queue")["dispatchEnabled"] and not request.get("startAuthorized"):
                if pending is None:
                    return
        if pending:
            self._refresh_source(pending["sourceId"], update_waiting=True)
            with self.store.transaction() as tx:
                pending = tx.get("requests", pending["requestId"])
                pending["preparationPending"] = False
                tx.put("requests", pending["requestId"], pending)
            return
        try:
            entry, source, runtime = self._source(request["entryId"], request["sourceId"])
            fresh = self.catalog.refresh_source(source["sourceId"])
            if fresh["sourceRevision"] != request["sourceRevision"] or config_fingerprint(source["root"]) != request["configFingerprint"]:
                raise CenterError("SOURCE_CHANGED", "Source or configuration changed while waiting", 409)
            if request.get("budgetConfigRevision") != digest({key: os.environ.get(key) for key in sorted(RUNTIME_ENV_NAMES) if key.startswith("USAGE_")}):
                raise CenterError("CONFIG_CHANGED", "Budget configuration changed while waiting", 409)
            if request.get("permissionConfigRevision") != digest({key: os.environ.get(key) for key in ("CODEX_SANDBOX_MODE", "CLAUDE_PERMISSION_MODE", "CURSOR_SANDBOX_MODE")}):
                raise CenterError("CONFIG_CHANGED", "Permission configuration changed while waiting", 409)
            probe = self.adapter.query("probe", center_id=self.store.center_id)
            check = self.adapter.query("preflight", root=source["root"])
            previous_owner = probe.get("owner")
            if (not probe["slotFree"] or not check["quiescent"] or
                    previous_owner and (previous_owner.get("state") != "terminal" or not previous_owner.get("cleanupConfirmed"))):
                raise CenterError(str(check.get("reason") or "owner_conflict").upper(), "Slot or source ownership requires attention", 409)
        except Exception as exc:
            with self.store.transaction() as tx:
                self._transition(tx, request, "attention", "center", getattr(exc, "code", "preflight_failed"), attentionReason="preflight", reasonDetail=getattr(exc, "code", "preflight_failed"))
                self._pause(tx, "preflight_failed")
            return
        with self.store.transaction() as tx:
            request = tx.get("requests", request["requestId"])
            if request["state"] != "queued":
                return
            self._transition(tx, request, "starting", "center", "dispatch_reserved", dispatchId=uid("dispatch"), nonce=uuid.uuid4().hex,
                             startAuthorized=False, launchIssued=False)
        try:
            control_dir = self._control(request)
            configuration = request["config"]
            environment = {"ENGINE": configuration["engine"], "MODEL": configuration["model"], "AUTO_COMPANY_LANGUAGE": configuration["productLanguage"]}
            if configuration["engine"] == "codex":
                environment["CODEX_REASONING_EFFORT"] = configuration["effort"]
            manifest = {key: request[key] for key in ("requestId", "dispatchId", "nonce", "runtimeId", "entryId", "sourceId")}
            manifest.update(centerId=self.store.center_id, root=self.adapter.path(source["root"]), controlDir=self.adapter.path(control_dir), environment=environment)
            atomic_json(control_dir / "manifest.json", manifest)
            self._write_controls()
            # Durable launch intent precedes Popen. A crash at this boundary is
            # ambiguous and must never produce a second dispatch automatically.
            with self.store.transaction() as tx:
                request = tx.get("requests", request["requestId"])
                if request.get("stopRequested"):
                    self._transition(tx, request, "ended", "center", "user_stop", terminalReason="user_stop")
                    return
                request["launchIssued"] = True
                tx.put("requests", request["requestId"], request)
            self._children[request["dispatchId"]] = self.adapter.launch(control_dir / "manifest.json")
        except Exception as exc:
            with self.store.transaction() as tx:
                current = tx.get("requests", request["requestId"])
                if current.get("launchIssued"):
                    self._transition(tx, current, "attention", "center", "dispatch_uncertain", attentionReason="dispatch_uncertain", reasonDetail=type(exc).__name__)
                else:
                    self._transition(tx, current, "failed", "center", "pre_start", terminalReason="pre_start", reasonDetail=type(exc).__name__)
                self._pause(tx, "dispatch_uncertain")

    def _reconcile(self, request):
        if not request.get("dispatchId"):
            if request["state"] == "attention" and request.get("attentionReason") == "preflight":
                with self.store.transaction() as tx:
                    current = tx.get("requests", request["requestId"])
                    self._transition(tx, current, "failed", "recovery", "pre_start", terminalReason="pre_start", reasonDetail=current.get("reasonDetail"))
            return
        path = self._control(request) / "manifest.json"
        try:
            probe = self.adapter.query("probe", center_id=self.store.center_id, manifest=path if path.exists() else None)
        except Exception:
            with self.store.transaction() as tx:
                current = tx.get("requests", request["requestId"])
                if current["state"] in OPEN and current["state"] != "attention":
                    self._transition(tx, current, "attention", "recovery", "runner_unavailable", attentionReason="recovery_required", reasonDetail="runner_unavailable")
                self._pause(tx, "runner_unavailable")
            return
        receipt = probe.get("receipt")
        with self.store.transaction() as tx:
            current = tx.get("requests", request["requestId"])
            if current["state"] in TERMINAL:
                if not probe["slotFree"] and probe.get("owner", {}).get("dispatchId") == current["dispatchId"]:
                    self._pause(tx, "terminal_owner_conflict")
                return
            if receipt and receipt.get("state") == "terminal" and receipt.get("cleanupConfirmed") and probe["slotFree"]:
                reason = receipt.get("reason")
                if reason in {"budget_pause", "governance_pause"}:
                    state, terminal = "ended", reason
                    self._pause(tx, reason)
                elif reason in {"user_stop", "center_shutdown"} or current.get("stopRequested"):
                    state, terminal = "ended", "user_stop"
                    if reason != "user_stop":
                        self._pause(tx, reason)
                elif reason == "natural" and receipt.get("launched"):
                    state, terminal = "ended", "natural"
                else:
                    state, terminal = "failed", "runtime" if receipt.get("launched") else "pre_start"
                    self._pause(tx, reason or "runtime_failed")
                self._transition(tx, current, state, "runner", reason, terminalReason=terminal, reasonDetail=reason, receipt=receipt)
                child = self._children.get(current["dispatchId"])
                if child is not None and child.poll() is not None:
                    self._children.pop(current["dispatchId"], None)
            elif receipt and probe.get("ownerAlive") and (probe.get("owner") or {}).get("dispatchId") == current["dispatchId"] and not probe["slotFree"]:
                current["liveConfirmedAt"] = now()
                tx.put("requests", current["requestId"], current)
                receipt_state = receipt.get("state")
                if receipt_state in {"accepted", "terminal"}:
                    return  # accepted is not a launched loop; terminal still owns cleanup lock
                state = "stopping" if current.get("stopRequested") or receipt_state == "stopping" else "running"
                if receipt_state == "attention":
                    state = "attention"
                    if current["state"] != state:
                        self._transition(tx, current, state, "runner", "stop_unconfirmed", attentionReason="stop_unconfirmed", reasonDetail=receipt.get("reason"))
                    self._pause(tx, "stop_unconfirmed")
                elif current["state"] != state:
                    self._transition(tx, current, state, "runner", receipt.get("reason"), startedAt=receipt.get("startedAt"), attentionReason=None)
                    if state == "stopping" and receipt.get("reason") in {"budget_pause", "governance_pause", "provider_pause"}:
                        self._pause(tx, receipt["reason"])
            elif not current.get("launchIssued") and probe["slotFree"]:
                self._transition(tx, current, "failed", "recovery", "pre_start", terminalReason="pre_start", reasonDetail="runner_not_issued")
            else:
                child = self._children.get(current["dispatchId"])
                if child is not None and child.poll() is None and current["state"] == "starting":
                    return  # launch bridge has not published its first receipt yet
                reason = "stop_unconfirmed" if current.get("stopRequested") else "dispatch_uncertain"
                if current["state"] != "attention":
                    self._transition(tx, current, "attention", "recovery", reason, attentionReason=reason)
                self._pause(tx, reason)
        if receipt and (time.monotonic() - self._last_refresh.get(request["sourceId"], 0) > 5 or receipt.get("state") == "terminal"):
            try:
                self._refresh_source(request["sourceId"])
                self._last_refresh[request["sourceId"]] = time.monotonic()
            except Exception:
                pass  # read projection failure cannot fabricate an execution outcome

    def tick(self):
        with self._mutex:
            for dispatch_id, child in list(self._children.items()):
                if child.poll() is not None:
                    self._children.pop(dispatch_id, None)
            self._write_controls()
            with self.store.transaction() as tx:
                requests = [row for row in tx.list("requests") if row["state"] in ACTIVE and row.get("dispatchId")]
            for request in requests:
                self._reconcile(request)
            if not self._closing.is_set() and self.adapter.available:
                self._dispatch()

    def _supervise(self):
        while not self._closing.is_set():
            try:
                self.tick()
            except Exception:
                # A failed DB write or heartbeat stops further dispatch; runner
                # independently detects lost control and performs cleanup.
                try:
                    with self.store.transaction() as tx:
                        self._pause(tx, "center_error")
                except Exception:
                    pass
            self._closing.wait(0.5)
