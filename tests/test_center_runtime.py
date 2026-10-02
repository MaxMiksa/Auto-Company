"""Queue crash/race contracts and real POSIX process ownership, no models."""
import importlib.util
import json
import os
from pathlib import Path
import shlex
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import unittest
import uuid
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tests'))
from isolation_fixture import install as install_fixture_boundary
sys.path.insert(0, str(ROOT / "dashboard"))
from center_runtime import CenterRuntime, CenterError, PosixAdapter, atomic_json, config_fingerprint, OPEN, TERMINAL
from center_store import CenterStore


def copy_control_entrypoints(root):
    install_fixture_boundary(root)
    for name in ("dashboard/server.py", "Makefile", "scripts/macos/start-daemon.sh", "scripts/macos/install-daemon.sh",
                 "scripts/wsl/dashboard-wsl.sh", "scripts/wsl/install-wsl-daemon.sh", "scripts/windows/start-win.ps1", "scripts/windows/stop-win.ps1"):
        target = root / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(ROOT / name, target)


class FakeCatalog:
    def __init__(self, store):
        self.store = store

    def resolve_source(self, entry_id, source_id=None):
        with self.store.transaction() as tx:
            entry = tx.get("entries", entry_id)
            source = tx.get("sources", source_id or entry["preferredSourceId"])
        return entry, source, None

    def refresh_source(self, source_id):
        with self.store.transaction() as tx:
            return tx.get("sources", source_id)


class FakeProcess:
    def __init__(self):
        self.exit = None

    def poll(self):
        return self.exit


class FakeAdapter:
    available = True

    def __init__(self):
        self.launched = []
        self.processes = []
        self.receipt = None
        self.slot_free = True
        self.owner_alive = False
        self.preflight = {"quiescent": True, "compatible": True}

    def path(self, path):
        return str(path)

    def query(self, action, **kwargs):
        if action == "preflight":
            return self.preflight
        return {"slotFree": self.slot_free, "ownerAlive": self.owner_alive, "owner": self.receipt,
                "receipt": self.receipt if kwargs.get("manifest") else None}

    def launch(self, manifest):
        self.launched.append(json.loads(Path(manifest).read_text()))
        process = FakeProcess()
        self.processes.append(process)
        return process

    def acknowledge(self, state="running", **kwargs):
        self.slot_free = state == "terminal"
        self.owner_alive = state != "terminal"
        self.receipt = {**self.launched[-1], "state": state, **kwargs}


class QueueTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.folder = Path(self.temp.name)
        self.store = CenterStore(self.folder / "center")
        self.addCleanup(self.store.close)
        self.catalog, self.adapter = FakeCatalog(self.store), FakeAdapter()
        self.runtime = CenterRuntime(self.store, self.catalog, ROOT, {"platform": "posix"}, adapter=self.adapter)
        self.a = self.source("a")
        self.b = self.source("b")

    def source(self, name):
        root = self.folder / name
        root.mkdir()
        entry_id, source_id, runtime_id = "entry_" + name * 8, "source_" + name * 8, "runtime_" + name * 8
        atomic_json(root / ".auto-company-center.json", {"protocolVersion": 1, "centerId": self.store.center_id,
                    "entryId": entry_id, "sourceId": source_id, "runtimeId": runtime_id})
        entry = {"entryId": entry_id, "preferredSourceId": source_id, "kind": "exploration", "archived": False, "revision": 1}
        source = {"entryId": entry_id, "sourceId": source_id, "runtimeId": runtime_id, "root": str(root), "kind": "exploration", "sourceRevision": 1, "revision": 1, "availability": "available", "capabilities": {}}
        runtime = {"runtimeId": runtime_id, "root": str(root), "managed": True, "executionDomain": {"platform": "posix"}, "frameworkRevision": "a" * 40}
        with self.store.transaction() as tx:
            tx.put("entries", entry_id, entry)
            tx.put("sources", source_id, source)
            tx.put("runtimes", runtime_id, runtime)
        return source

    def create(self, source=None, key="create-aaaa", **kwargs):
        source = source or self.a
        return self.runtime.create_request({"idempotencyKey": key, "entryId": source["entryId"], "sourceId": source["sourceId"],
                    "runtimeId": source["runtimeId"], "expectedSourceRevision": 1, **kwargs})

    def enable(self):
        self.runtime.queue_action("resume", {"idempotencyKey": "resume-aaaa"})

    def test_idempotency_and_single_open_request_with_two_threads(self):
        rows, errors = [], []
        def create():
            try:
                rows.append(self.create())
            except Exception as error:
                errors.append(error)
        threads = [threading.Thread(target=create) for _ in range(2)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()
        self.assertEqual(errors, [])
        self.assertEqual(rows[0]["requestId"], rows[1]["requestId"])
        with self.assertRaises(CenterError) as caught:
            self.create(executionMode="start_now")
        self.assertEqual(caught.exception.code, "IDEMPOTENCY_CONFLICT")
        with self.assertRaises(CenterError) as caught:
            self.create(key="different-key")
        self.assertEqual(caught.exception.code, "OPEN_REQUEST_EXISTS")
        self.assertEqual(len(self.runtime.list_requests()["items"]), 1)

    def test_fifo_holds_whole_lifetime_pause_and_stop_all(self):
        first = self.create()
        second = self.create(self.b, "create-bbbb")
        self.enable()
        self.runtime.tick()
        self.adapter.acknowledge()
        self.runtime.tick()
        self.assertEqual(len(self.adapter.launched), 1)
        self.runtime.queue_action("pause", {"idempotencyKey": "pause-aaaa"})
        self.runtime.tick()
        self.assertEqual(self.runtime.get_request(first["requestId"])["state"], "running")
        self.runtime.queue_action("stop-all", {"idempotencyKey": "stop-all-aa"})
        self.adapter.acknowledge("terminal", cleanupConfirmed=True, launched=True, reason="user_stop")
        self.runtime.tick()
        self.assertEqual(self.runtime.get_request(first["requestId"])["state"], "ended")
        self.assertEqual(self.runtime.get_request(second["requestId"])["state"], "queued")
        self.assertFalse(self.runtime.summary()["dispatchEnabled"])
        self.assertEqual(len(self.adapter.launched), 1)

    def test_start_now_does_not_enable_queue_or_jump_waiter(self):
        first = self.create(executionMode="start_now")
        self.create(self.b, "create-bbbb")
        self.runtime.tick()
        self.adapter.acknowledge("terminal", cleanupConfirmed=True, launched=True, reason="natural")
        self.runtime.tick()
        self.assertEqual(self.runtime.get_request(first["requestId"])["terminalReason"], "natural")
        self.assertEqual(len(self.adapter.launched), 1)
        self.assertFalse(self.runtime.summary()["dispatchEnabled"])
        with self.assertRaises(CenterError):
            self.create(key="third-request", executionMode="start_now")

    def test_waiting_config_change_pauses_without_launch(self):
        request = self.create()
        (Path(self.a["root"]) / ".auto-company.local").write_text("AUTO_COMPANY_LANGUAGE=en\n")
        self.enable()
        self.runtime.tick()
        observed = self.runtime.get_request(request["requestId"])
        self.assertEqual((observed["state"], observed["attentionReason"]), ("attention", "preflight"))
        self.assertEqual(self.adapter.launched, [])
        self.assertFalse(self.runtime.summary()["dispatchEnabled"])

    def test_pause_and_stop_all_revoke_unclaimed_start_now_without_canceling_history(self):
        for action in ("pause", "stop-all"):
            with self.subTest(action=action):
                request = self.create(key="create-before-" + action, executionMode="start_now")
                self.runtime.queue_action(action, {"idempotencyKey": "control-before-" + action})
                self.runtime.tick()
                observed = self.runtime.get_request(request["requestId"])
                self.assertEqual(observed["state"], "queued")
                self.assertFalse(observed["startAuthorized"])
                self.assertEqual(self.adapter.launched, [])
                self.assertFalse(self.runtime.summary()["dispatchEnabled"])
                self.runtime.request_action(request["requestId"], "cancel", {"idempotencyKey": "cancel-after-" + action})
        self.assertEqual(len(self.runtime.list_requests()["items"]), 2)

    def test_revoked_start_now_requires_new_explicit_queue_resume(self):
        request = self.create(executionMode="start_now")
        self.runtime.queue_action("pause", {"idempotencyKey": "pause-start-now"})
        self.runtime.tick()
        self.assertEqual(self.adapter.launched, [])
        self.enable()
        self.runtime.tick()
        self.assertEqual(self.runtime.get_request(request["requestId"])["state"], "starting")
        self.assertEqual(len(self.adapter.launched), 1)

    def test_late_running_receipt_does_not_undo_stop_and_cancel_race(self):
        request = self.create(executionMode="start_now")
        self.runtime.tick()
        starting = self.runtime.get_request(request["requestId"])
        with self.assertRaises(CenterError):
            self.runtime.request_action(request["requestId"], "cancel", {"idempotencyKey": "cancel-aaa"})
        self.runtime.request_action(request["requestId"], "stop", {"idempotencyKey": "stop-aaaaa", "expectedDispatchId": starting["dispatchId"]})
        self.adapter.acknowledge("running")
        self.runtime.tick()
        self.assertEqual(self.runtime.get_request(request["requestId"])["state"], "stopping")
        control = json.loads((self.store.data_dir / "runner" / starting["dispatchId"] / "control.json").read_text())
        self.assertTrue(control["stop"])

    def test_restart_never_replays_uncertain_dispatch_or_queued_start(self):
        request = self.create(executionMode="start_now")
        self.runtime.tick()
        other = CenterRuntime(self.store, self.catalog, ROOT, {"platform": "posix"}, adapter=FakeAdapter())
        other.tick()
        row = other.get_request(request["requestId"])
        self.assertEqual((row["state"], row["attentionReason"]), ("attention", "dispatch_uncertain"))
        self.assertEqual(other.adapter.launched, [])
        self.assertFalse(other.summary()["dispatchEnabled"])

    def test_terminal_requires_cleanup_and_free_os_slot(self):
        request = self.create(executionMode="start_now")
        self.runtime.tick()
        self.adapter.acknowledge("terminal", cleanupConfirmed=True, launched=True, reason="natural")
        self.adapter.slot_free = False
        self.adapter.processes[0].exit = 1
        self.runtime.tick()
        self.assertEqual(self.runtime.get_request(request["requestId"])["state"], "attention")
        self.adapter.slot_free = True
        self.runtime.tick()
        self.assertEqual(self.runtime.get_request(request["requestId"])["state"], "ended")

    def test_protection_pause_stops_dispatch_without_clearing_marker(self):
        first = self.create(executionMode="start_now")
        self.create(self.b, "create-bbbb")
        self.enable()
        self.runtime.tick()
        marker = Path(self.a["root"]) / ".auto-loop-budget-paused"
        marker.write_text("protected")
        self.adapter.acknowledge("terminal", cleanupConfirmed=True, launched=True, reason="budget_pause")
        self.runtime.tick()
        self.assertEqual(self.runtime.get_request(first["requestId"])["terminalReason"], "budget_pause")
        self.assertEqual(marker.read_text(), "protected")
        self.assertEqual(len(self.adapter.launched), 1)
        self.assertFalse(self.runtime.summary()["dispatchEnabled"])

    def test_terminal_event_is_idempotent_and_provenance_is_not_authenticated(self):
        request = self.create(executionMode="start_now")
        self.runtime.tick()
        self.adapter.acknowledge("terminal", cleanupConfirmed=True, launched=True, reason="natural")
        self.runtime.tick()
        count = len(self.runtime.get_request(request["requestId"])["events"])
        self.runtime._reconcile(self.runtime.get_request(request["requestId"]))
        events = self.runtime.get_request(request["requestId"])["events"]
        self.assertEqual(len(events), count)
        self.assertEqual({row["actorKind"] for row in events}, {"local_operator_intent", "center", "runner"})
        self.assertTrue(all(row["authenticatedUserId"] is None for row in events))
        self.assertTrue(all(row["toState"] in OPEN | TERMINAL for row in events))

    def test_media_readonly_and_active_rejected_on_backend(self):
        with self.assertRaises(CenterError) as caught:
            self.runtime.media_action(self.a["entryId"], "capture", {"idempotencyKey": "capture-aa"})
        self.assertEqual(caught.exception.code, "UNSUPPORTED")
        self.create(executionMode="start_now")
        self.runtime.tick()
        with self.assertRaises(CenterError) as caught:
            self.runtime.media_action(self.b["entryId"], "capture", {"idempotencyKey": "capture-bb"})
        self.assertEqual(caught.exception.code, "SLOT_BUSY")

    def test_display_running_requires_recent_live_receipt(self):
        request = self.create(executionMode="start_now")
        self.runtime.tick()
        view = {**self.a, "availability": "available"}
        self.assertEqual(self.runtime.decorate_entry(view)["executionSummary"]["state"], "unknown")
        self.adapter.acknowledge("running")
        self.runtime.tick()
        self.assertEqual(self.runtime.decorate_entry(view)["executionSummary"]["state"], "running")

    def test_incompatible_control_files_disable_execution_without_losing_owned_release(self):
        sys.path.insert(0, str(ROOT / "scripts/core"))
        from center_runner import CONTROL_FILES
        root = Path(self.a["root"])
        for name in CONTROL_FILES:
            target = root / name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(ROOT / name, target)
        view = {**self.a, "availability": "available"}
        self.assertTrue(self.runtime.decorate_entry(view)["capabilities"]["execute"])
        (root / "scripts/core/stop-loop.sh").write_text("incomplete control update fixture\n")
        observed = self.runtime.decorate_entry(view)
        self.assertFalse(observed["capabilities"]["execute"])
        self.assertEqual(observed["capabilityReasons"]["execute"], "runtime_incompatible")
        self.assertTrue(observed["capabilities"]["release"])

    def test_unresolved_p1_blocks_capability_enqueue_and_dispatch_without_editing_consensus(self):
        sys.path.insert(0, str(ROOT / "scripts/core"))
        from center_runner import CONTROL_FILES, governance_reason
        root = Path(self.a["root"])
        for name in CONTROL_FILES:
            target = root / name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(ROOT / name, target)
        original = self.adapter.query
        def query(action, **kwargs):
            if action == "preflight" and kwargs.get("require_context") != "0":
                reason = governance_reason(root)
                return {"compatible": True, "quiescent": reason is None, "reason": reason}
            return original(action, **kwargs)
        self.adapter.query = query
        request = self.create(executionMode="start_now")
        consensus = root / "memories/consensus.md"
        consensus.parent.mkdir()
        data = b"## Human Overrides\n- retain fixture\n## Priority Issues\n- [ ] P1: human decision required\n"
        consensus.write_bytes(data)
        view = self.runtime.decorate_entry({**self.a, "availability": "available"})
        self.assertFalse(view["capabilities"]["execute"])
        self.assertEqual(view["capabilityReasons"]["execute"], "unresolved_p1")
        self.runtime.tick()
        self.assertEqual(self.runtime.get_request(request["requestId"])["reasonDetail"], "UNRESOLVED_P1")
        self.assertEqual(self.adapter.launched, [])
        self.runtime.request_action(request["requestId"], "reconcile", {"idempotencyKey": "p1-reconcile-fixture"})
        with self.assertRaises(CenterError) as caught:
            self.create(key="p1-blocked-new-request")
        self.assertEqual(caught.exception.code, "UNRESOLVED_P1")
        self.assertTrue(self.runtime.decorate_entry({**self.a, "availability": "available"})["capabilities"]["release"])
        self.assertEqual(consensus.read_bytes(), data)
        self.assertFalse((root / ".auto-loop-paused").exists())

    def test_live_p1_block_is_work_state_holds_slot_and_still_allows_owned_stop(self):
        first = self.create(executionMode="start_now")
        second = self.create(self.b, "blocked-queued-fixture")
        self.enable()
        self.runtime.tick()
        self.adapter.acknowledge("running", executionBlockedReason="unresolved_p1", executionBlockedAt="2026-09-27T00:00:00+00:00")
        self.runtime.tick()
        observed = self.runtime.get_request(first["requestId"])
        self.assertEqual((observed["state"], observed["executionBlockedReason"]), ("running", "unresolved_p1"))
        self.assertEqual(self.runtime.summary()["currentRequest"]["executionBlockedReason"], "unresolved_p1")
        self.assertEqual(len(self.adapter.launched), 1)
        self.assertFalse(self.runtime.summary()["dispatchEnabled"])
        self.assertEqual(self.runtime.summary()["dispatchReason"], "unresolved_p1")
        self.assertFalse(observed.get("stopRequested"))
        view = {**self.a, "availability": "available"}
        self.assertEqual(self.runtime.decorate_entry(view)["executionSummary"]["state"], "blocked")
        count = len(observed["events"])
        self.runtime.tick()
        self.assertEqual(len(self.runtime.get_request(first["requestId"])["events"]), count)
        with self.store.transaction() as tx:
            row = tx.get("requests", first["requestId"])
            row["liveConfirmedAt"] = "2000-01-01T00:00:00+00:00"
            tx.put("requests", row["requestId"], row)
        self.assertEqual(self.runtime.decorate_entry(view)["executionSummary"]["state"], "unknown")
        self.assertIsNone(self.runtime.get_request(first["requestId"])["executionBlockedReason"])
        stopped = self.runtime.request_action(first["requestId"], "stop", {"idempotencyKey": "blocked-owned-stop"})
        self.assertEqual(stopped["state"], "stopping")
        self.assertIsNone(stopped["executionBlockedReason"])
        self.adapter.acknowledge("terminal", cleanupConfirmed=True, launched=True, reason="user_stop")
        self.runtime.tick()
        self.assertEqual(self.runtime.get_request(first["requestId"])["terminalReason"], "user_stop")
        self.assertEqual(self.runtime.get_request(second["requestId"])["state"], "queued")
        self.assertEqual(self.runtime.summary()["dispatchReason"], "unresolved_p1")
        self.assertFalse(self.runtime.summary()["dispatchEnabled"])
        self.assertEqual(len(self.adapter.launched), 1)

    def test_owned_p1_receipt_after_stop_intent_still_pauses_queue(self):
        first = self.create(executionMode="start_now")
        second = self.create(self.b, "late-block-waiter")
        self.enable()
        self.runtime.tick()
        self.runtime.request_action(first["requestId"], "stop", {"idempotencyKey": "late-block-stop"})
        self.adapter.acknowledge("running", executionBlockedReason="unresolved_p1")
        self.runtime.tick()
        self.assertEqual(self.runtime.get_request(first["requestId"])["state"], "stopping")
        self.assertEqual(self.runtime.summary()["dispatchReason"], "unresolved_p1")
        self.adapter.acknowledge("terminal", cleanupConfirmed=True, launched=True, reason="user_stop")
        self.runtime.tick()
        self.assertEqual(self.runtime.get_request(second["requestId"])["state"], "queued")
        self.assertEqual(len(self.adapter.launched), 1)

    def test_preflight_attention_can_be_confirmed_unstarted_then_replaced(self):
        request = self.create()
        self.adapter.preflight = {"quiescent": False, "reason": "governance_pause"}
        self.enable()
        self.runtime.tick()
        result = self.runtime.request_action(request["requestId"], "reconcile", {"idempotencyKey": "reconcile-aa"})
        self.assertEqual((result["state"], result["terminalReason"]), ("failed", "pre_start"))
        self.assertEqual(self.adapter.launched, [])

    def test_accepted_receipt_does_not_claim_loop_running(self):
        request = self.create(executionMode="start_now")
        self.runtime.tick()
        self.adapter.acknowledge("accepted")
        self.runtime.tick()
        self.assertEqual(self.runtime.get_request(request["requestId"])["state"], "starting")

    def test_lost_takeover_response_reconciles_same_binding_without_repeating_write(self):
        marker = Path(self.a["root"]) / ".auto-company-center.json"
        marker.unlink()
        with self.store.transaction() as tx:
            runtime = tx.get("runtimes", self.a["runtimeId"])
            runtime["managed"] = False
            tx.put("runtimes", runtime["runtimeId"], runtime)
        calls = []
        original = self.adapter.query
        def query(action, **kwargs):
            if action == "bind":
                calls.append(action)
                manifest = json.loads(Path(kwargs["manifest"]).read_text())
                atomic_json(Path(manifest["root"]) / ".auto-company-center.json", manifest["marker"])
                raise TimeoutError("fixture lost response")
            return original(action, **kwargs)
        self.adapter.query = query
        body = {"idempotencyKey": "takeover-loss-aa", "expectedRevision": 1}
        with self.assertRaises(TimeoutError):
            self.runtime.source_action(self.a["sourceId"], "takeover", body)
        operation = self.runtime.source_action(self.a["sourceId"], "takeover", body)
        self.assertEqual(operation["state"], "succeeded")
        self.assertTrue(operation["recovered"])
        self.assertEqual(calls, ["bind"])
        with self.store.transaction() as tx:
            self.assertTrue(tx.get("runtimes", operation["runtimeId"])["managed"])

    def test_control_loss_is_runtime_failure_not_authenticated_user_stop(self):
        for reason in ("center_disconnected", "runner_shutdown"):
            with self.subTest(reason=reason):
                request = self.create(key="failure-" + reason, executionMode="start_now")
                self.runtime.tick()
                self.adapter.acknowledge("terminal", cleanupConfirmed=True, launched=True, reason=reason)
                self.runtime.tick()
                observed = self.runtime.get_request(request["requestId"])
                self.assertEqual((observed["state"], observed["terminalReason"], observed["reasonDetail"]), ("failed", "runtime", reason))
                self.assertFalse(self.runtime.summary()["dispatchEnabled"])

    def test_lost_media_response_reconciles_receipt_without_repeating_capture(self):
        with self.store.transaction() as tx:
            source = tx.get("sources", self.a["sourceId"])
            source.update(productId="a" * 32, project="projects/fixture")
            tx.put("sources", source["sourceId"], source)
        calls = []
        def media(path):
            calls.append(str(path))
            self.adapter.receipt = {"state": "terminal", "cleanupConfirmed": True, "result": {"ok": False, "reason": "media_timeout"}}
            raise TimeoutError("fixture lost terminal response")
        self.adapter.media = media
        body = {"sourceId": self.a["sourceId"], "expectedRevision": 1, "idempotencyKey": "media-lost-response"}
        created = self.runtime.media_action(self.a["entryId"], "capture", body)
        for worker in list(self.runtime._workers):
            worker.join()
        self.assertEqual(self.runtime.operation(created["operationId"])["state"], "attention")
        recovered = self.runtime.media_action(self.a["entryId"], "capture", body)
        self.assertEqual((recovered["state"], recovered["reason"]), ("failed", "media_timeout"))
        self.assertTrue(recovered["recovered"])
        self.assertEqual(len(calls), 1)

    def test_invalid_registration_disables_execute_and_rechecks_enqueue_and_dispatch_but_allows_release(self):
        sys.path.insert(0, str(ROOT / "scripts/core"))
        from product_identity import register_project, transaction
        from center_runner import execution_context
        root = Path(self.a["root"])
        project = "projects/registered"
        (root / project / ".git").mkdir(parents=True)
        product = register_project(root, project)
        with transaction(root) as state:
            state["continuationProductId"] = product["id"]
        registry = root / "projects/registry.tsv"
        registry.write_text("name\tpath\tlifecycle\tcreated_at_utc\nregistered\tprojects/registered\tlocal\tfixture\n")
        with self.store.transaction() as tx:
            source = tx.get("sources", self.a["sourceId"])
            source.update(productId=product["id"], project=project, kind="product")
            tx.put("sources", source["sourceId"], source)
        original = self.adapter.query
        calls = []
        def query(action, **kwargs):
            calls.append((action, kwargs))
            if action == "preflight" and kwargs.get("require_context") != "0":
                result = execution_context(root, kwargs.get("expected_product_id"))
                return {"compatible": True, "quiescent": result["valid"], "reason": result["reason"]}
            if action == "bind":
                (root / ".auto-company-center.json").unlink()
                return {"ok": True}
            return original(action, **kwargs)
        self.adapter.query = query
        request = self.create(executionMode="start_now")
        registry.write_text("name\tpath\tlifecycle\tcreated_at_utc\n")
        view = self.runtime.decorate_entry({**source, "kind": "product", "availability": "available"})
        self.assertFalse(view["capabilities"]["execute"])
        self.assertEqual(view["capabilityReasons"]["execute"], "product_registration_invalid")
        self.runtime.tick()
        self.assertEqual(self.runtime.get_request(request["requestId"])["reasonDetail"], "PRODUCT_REGISTRATION_INVALID")
        self.assertEqual(self.adapter.launched, [])
        self.runtime.request_action(request["requestId"], "reconcile", {"idempotencyKey": "invalid-register-reconcile"})
        with self.assertRaises(CenterError) as caught:
            self.create(key="invalid-registration-new")
        self.assertEqual(caught.exception.code, "PRODUCT_REGISTRATION_INVALID")
        view = self.runtime.decorate_entry({**source, "kind": "product", "availability": "available"})
        self.assertTrue(view["capabilities"]["release"])
        self.assertTrue(view["capabilities"]["previewStop"])
        released = self.runtime.source_action(source["sourceId"], "release", {"idempotencyKey": "invalid-registration-release", "expectedRevision": 1})
        self.assertEqual(released["state"], "succeeded")
        self.assertTrue(any(action == "preflight" and options.get("require_context") == "0" for action, options in calls))


class PreparationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.folder = Path(self.temp.name)
        framework = self.folder / "framework"
        framework.mkdir()
        (framework / "scripts/core").mkdir(parents=True)
        shutil.copy2(ROOT / "scripts/core/center_runner.py", framework / "scripts/core/center_runner.py")
        shutil.copy2(ROOT / "scripts/core/localization.py", framework / "scripts/core/localization.py")
        (framework / "scripts/core/auto-loop.sh").write_text("#!/bin/bash\n# center_admission_check fixture\nexit 0\n")
        (framework / "memories").mkdir()
        (framework / "memories/consensus.template.md").write_text("# Consensus\n\n## Human Overrides\n\n## Current State\n")
        (framework / "PROMPT.md").write_text("Normal workflow fixture\n")
        (framework / ".gitignore").write_text("__pycache__/\n")
        for command in (["git", "init", str(framework)], ["git", "-C", str(framework), "add", "."],
                        ["git", "-C", str(framework), "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-m", "fixture"]):
            subprocess.run(command, check=True, capture_output=True)
        self.store = CenterStore(self.folder / "center")
        self.addCleanup(self.store.close)
        self.runtime = CenterRuntime(self.store, FakeCatalog(self.store), framework, {"platform": "posix"})

    def wait_operation(self, operation_id):
        deadline = time.monotonic() + 15
        while time.monotonic() < deadline:
            operation = self.runtime.operation(operation_id)
            if operation["state"] != "preparing":
                return operation
            time.sleep(0.05)
        self.fail("Preparation did not finish")

    def test_four_entities_atomic_stable_ids_and_no_provider_during_clone(self):
        body = {"idempotencyKey": "new-exploration-aa", "executionMode": "enqueue", "config": {"productLanguage": "en"}, "direction": "Explore the supplied operator direction."}
        initial = self.runtime.create_exploration(body)
        operation = self.wait_operation(initial["operationId"])
        self.assertEqual(operation["state"], "succeeded", operation)
        repeated = self.runtime.create_exploration(body)
        self.assertEqual(repeated["reserved"], initial["reserved"])
        with self.store.transaction() as tx:
            for kind in ("entries", "sources", "runtimes", "requests"):
                self.assertEqual(len(tx.list(kind)), 1)
            request = tx.list("requests")[0]
            source = tx.list("sources")[0]
        self.assertTrue(all(request[key] for key in ("entryId", "sourceId", "runtimeId")))
        self.assertEqual(request["state"], "queued")
        self.assertIsNone(source["productId"])
        root = Path(source["root"])
        self.assertTrue((root / ".git").is_dir())
        self.assertFalse((root / ".auto-company/product-state.json").exists())
        self.assertFalse((root / "logs").exists())
        self.assertEqual((root / "PROMPT.md").read_text(), "Normal workflow fixture\n")
        self.assertIn(body["direction"], (root / "memories/consensus.md").read_text())

    def test_restart_finishes_postcommit_projection_without_start_authorization(self):
        initial = self.runtime.create_exploration({"idempotencyKey": "prepare-crash-aa"})
        operation = self.wait_operation(initial["operationId"])
        request_id = operation["reserved"]["requestId"]
        with self.store.transaction() as tx:
            request = tx.get("requests", request_id)
            request.update(preparationPending=True, startAuthorized=True)
            tx.put("requests", request_id, request)
        restored = CenterRuntime(self.store, FakeCatalog(self.store), self.runtime.framework_root, {"platform": "posix"}, adapter=FakeAdapter())
        restored.tick()
        request = restored.get_request(request_id)
        self.assertFalse(request["preparationPending"])
        self.assertFalse(request["startAuthorized"])
        self.assertEqual(request["state"], "queued")
        self.assertEqual(restored.adapter.launched, [])

    def test_dirty_framework_failure_exposes_no_orphan_requests(self):
        (self.runtime.framework_root / "PROMPT.md").write_text("changed")
        initial = self.runtime.create_exploration({"idempotencyKey": "dirty-framework-aa"})
        operation = self.wait_operation(initial["operationId"])
        self.assertEqual(operation["reason"], "FRAMEWORK_UNVERIFIED")
        with self.store.transaction() as tx:
            self.assertEqual(tx.list("requests"), [])
            self.assertEqual(tx.list("entries"), [])
        revision = self.store.revision
        listed = self.runtime.list_operations()["items"]
        self.assertEqual(len(listed), 1)
        self.assertEqual((listed[0]["operationId"], listed[0]["state"], listed[0]["reason"]),
                         (initial["operationId"], "failed", "FRAMEWORK_UNVERIFIED"))
        self.assertEqual(set(listed[0]), {"operationId", "kind", "state", "createdAt", "endedAt", "revision", "reason", "reserved", "result"})
        self.assertEqual(self.runtime.list_operations({"state": "preparing"}), {"items": []})
        self.assertEqual(self.runtime.summary()["attentionCount"], 1)
        self.assertEqual(self.store.revision, revision)
        restored = CenterRuntime(self.store, FakeCatalog(self.store), self.runtime.framework_root, {"platform": "posix"}, adapter=FakeAdapter())
        self.assertEqual(restored.list_operations()["items"], listed)
        self.assertEqual(restored.summary()["attentionCount"], 1)
        self.assertEqual(restored.adapter.launched, [])

    def test_prepare_does_not_reenable_queue_paused_during_clone(self):
        original = self.runtime.adapter.clone
        entered, resume = threading.Event(), threading.Event()
        def controlled(*args):
            entered.set()
            resume.wait(5)
            return original(*args)
        self.runtime.adapter.clone = controlled
        initial = self.runtime.create_exploration({"idempotencyKey": "prepare-pause-aa", "executionMode": "start_now"})
        self.assertTrue(entered.wait(5))
        self.runtime.queue_action("pause", {"idempotencyKey": "pause-prepare-aa"})
        resume.set()
        operation = self.wait_operation(initial["operationId"])
        self.assertEqual(operation["state"], "succeeded", operation)
        request = self.runtime.get_request(operation["reserved"]["requestId"])
        self.assertEqual((request["state"], request["reasonDetail"]), ("attention", "slot_changed"))
        self.assertFalse(self.runtime.summary()["dispatchEnabled"])

    def test_stop_all_during_preparation_revokes_authorization_and_keeps_operation_discoverable(self):
        original = self.runtime.adapter.clone
        entered, release = threading.Event(), threading.Event()
        def controlled(*args):
            entered.set()
            release.wait(5)
            return original(*args)
        self.runtime.adapter.clone = controlled
        initial = self.runtime.create_exploration({"idempotencyKey": "prepare-stop-all", "executionMode": "start_now"})
        try:
            self.assertTrue(entered.wait(5))
            listed = self.runtime.list_operations({"state": "preparing"})["items"]
            self.assertEqual([row["operationId"] for row in listed], [initial["operationId"]])
            self.assertEqual(self.runtime.summary()["preparationCount"], 1)
            self.runtime.queue_action("stop-all", {"idempotencyKey": "stop-all-preparing"})
            self.assertTrue(self.runtime.operation(initial["operationId"])["authorizationRevoked"])
        finally:
            release.set()
        operation = self.wait_operation(initial["operationId"])
        self.assertEqual(operation["state"], "succeeded", operation)
        self.assertTrue(operation["authorizationRevoked"])
        self.assertFalse(self.runtime.get_request(operation["reserved"]["requestId"])["startAuthorized"])
        self.runtime.adapter = FakeAdapter()
        self.runtime.tick()
        self.assertEqual(self.runtime.adapter.launched, [])
        self.assertEqual(self.runtime.summary()["preparationCount"], 0)
        self.assertEqual(self.runtime.summary()["attentionCount"], 1)

    def test_restart_revokes_preparing_authorization_and_exposes_recovery(self):
        with patch.object(self.runtime, "_worker"):
            initial = self.runtime.create_exploration({"idempotencyKey": "prepare-restart-start", "executionMode": "start_now"})
        restored = CenterRuntime(self.store, FakeCatalog(self.store), self.runtime.framework_root, {"platform": "posix"}, adapter=FakeAdapter())
        operation = restored.operation(initial["operationId"])
        self.assertEqual((operation["state"], operation["reason"], operation["authorizationRevoked"]), ("attention", "recovery_required", True))
        self.assertEqual(restored.list_operations()["items"][0]["operationId"], initial["operationId"])
        self.assertEqual(restored.summary()["attentionCount"], 1)
        restored.adapter = self.runtime.adapter
        restored._prepare_exploration(initial["operationId"])
        request = restored.get_request(operation["reserved"]["requestId"])
        self.assertFalse(request["startAuthorized"])
        restored.adapter = FakeAdapter()
        restored.tick()
        self.assertEqual(restored.adapter.launched, [])

    def test_close_keeps_store_owned_until_preparation_audit_finishes(self):
        original = self.runtime.adapter.clone
        entered, release, closed = threading.Event(), threading.Event(), threading.Event()
        def controlled(*args):
            entered.set()
            release.wait(5)
            return original(*args)
        self.runtime.adapter.clone = controlled
        operation = self.runtime.create_exploration({"idempotencyKey": "close-prepare-aa"})
        self.assertTrue(entered.wait(5))
        thread = threading.Thread(target=lambda: (self.runtime.close(), closed.set()))
        thread.start()
        self.assertFalse(closed.wait(0.2))
        with self.assertRaises(CenterError):
            self.runtime.create_exploration({"idempotencyKey": "after-close-aa"})
        release.set()
        thread.join(timeout=10)
        self.assertTrue(closed.is_set())
        self.assertEqual(self.runtime.operation(operation["operationId"])["state"], "succeeded")


class ContextLanguageTests(unittest.TestCase):
    def test_actual_cycle_context_records_language_but_next_period_cannot_relabel_old_cycle(self):
        sys.path.insert(0, str(ROOT / "scripts/core"))
        from product_identity import register_project, reserve_cycle, update_cycle
        from localization import set_language, start_product, next_product
        from runtime_artifacts import write_context
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            project = "projects/context-fixture"
            (root / project).mkdir(parents=True)
            product = register_project(root, project)
            set_language(root, "en")
            language = start_product(root)
            cycle = reserve_cycle(root, project, "fixture-attempt", 1)["cycleId"]
            environment = {"AUTO_COMPANY_CYCLE": "1", "AUTO_COMPANY_CYCLE_ID": cycle,
                           "AUTO_COMPANY_STABLE_PRODUCT_ID": product["id"], "AUTO_COMPANY_LANGUAGE": "en"}
            with patch.dict(os.environ, environment):
                write_context(root, cycle, project)
            context = json.loads((root / "logs" / (cycle + ".context.json")).read_text())
            evidence = context["languageEvidence"]
            self.assertEqual(evidence, {"schemaVersion": 1, "productId": product["id"], "cycleId": cycle,
                                       "language": "en", "languagePeriodId": language["productId"], "recordedAt": context["recordedAt"]})
            update_cycle(root, cycle, "completed")
            set_language(root, "zh-CN")
            following = next_product(root, "NEXT")
            self.assertNotEqual(following["productId"], language["productId"])
            with patch.dict(os.environ, {**environment, "AUTO_COMPANY_LANGUAGE": "zh-CN"}):
                write_context(root, cycle, project)
            self.assertNotIn("languageEvidence", json.loads((root / "logs" / (cycle + ".context.json")).read_text()))
            exploration = reserve_cycle(root, "", "exploration-attempt", 2)["cycleId"]
            with patch.dict(os.environ, {**environment, "AUTO_COMPANY_CYCLE_ID": exploration}):
                write_context(root, exploration, "")
            self.assertNotIn("languageEvidence", json.loads((root / "logs" / (exploration + ".context.json")).read_text()))


class GovernanceObservationTests(unittest.TestCase):
    @unittest.skipUnless(sys.platform == "linux", "Bash state publication runs under Linux/WSL")
    def test_loop_state_publication_keeps_prior_snapshot_until_clock_field_is_ready(self):
        source = (ROOT / "scripts/core/auto-loop.sh").read_text()
        start = source.index("save_state() {")
        function = source[start:source.index("\n}\n", start) + 3]
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            state = root / ".auto-loop-state"
            prior = b"STATUS=paused\nPAUSE_REASON=unresolved_p1\n"
            state.write_bytes(prior)
            gate, ready = root / "hold-clock", root / "clock-held"
            gate.touch()
            binaries = root / "bin"
            binaries.mkdir()
            clock = binaries / "date"
            clock.write_text("#!/bin/bash\ntouch " + shlex.quote(str(ready)) + "\nwhile [ -f " + shlex.quote(str(gate)) + " ]; do sleep 0.01; done\nprintf '2026-10-02 00:00:00\\n'\n")
            clock.chmod(0o755)
            script = "set -euo pipefail\nSTATE_FILE=" + shlex.quote(str(state)) + "\nloop_count=2\nerror_count=0\nMODEL_LABEL=fixture\nENGINE=fixture\nCURRENT_PRODUCT_CYCLE_ID=fixture\n" + function + '\nsave_state "idle"\n'
            child = subprocess.Popen(["bash", "-c", script], env={**os.environ, "PATH": str(binaries) + os.pathsep + os.environ["PATH"]}, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            try:
                deadline = time.monotonic() + 5
                while not ready.exists() and child.poll() is None and time.monotonic() < deadline:
                    time.sleep(0.01)
                self.assertTrue(ready.exists(), "The actual state writer must reach the controlled clock read")
                self.assertEqual(state.read_bytes(), prior)
                self.assertIsNone(child.poll())
            finally:
                gate.unlink(missing_ok=True)
                stdout, stderr = child.communicate(timeout=5)
            self.assertEqual(child.returncode, 0, stderr.decode(errors="replace"))
            saved = dict(line.split("=", 1) for line in state.read_text().splitlines())
            self.assertEqual((saved["STATUS"], saved["PAUSE_REASON"], saved["LOOP_COUNT"]), ("idle", "", "2"))

    def test_incomplete_observation_preserves_confirmed_p1_until_valid_transition(self):
        sys.path.insert(0, str(ROOT / "scripts/core"))
        from center_runner import execution_blocked_reason
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            consensus = root / "memories/consensus.md"
            consensus.parent.mkdir()
            consensus.write_text("## Human Overrides\n## Priority Issues\n- [ ] P1: decision\n")
            state = root / ".auto-loop-state"
            blocked = "unresolved_p1"
            for partial in ("", "LOOP_COUNT=2\n", "STATUS=paused\n"):
                with self.subTest(partial=partial):
                    state.write_text(partial)
                    self.assertEqual(execution_blocked_reason(root, 0, blocked), blocked)
                    self.assertIsNone(execution_blocked_reason(root, 0), "An incomplete first observation cannot invent a block")
            state.unlink()
            self.assertEqual(execution_blocked_reason(root, 0, blocked), blocked)
            state.write_text("STATUS=paused\nPAUSE_REASON=unresolved_p1\n")
            self.assertEqual(execution_blocked_reason(root, time.time_ns() + 1000000000, blocked), blocked)
            consensus.write_text("invalid governance fixture")
            self.assertEqual(execution_blocked_reason(root, 0, blocked), blocked)
            consensus.write_text("## Human Overrides\n## Priority Issues\n- [x] P1: resolved\n")
            self.assertIsNone(execution_blocked_reason(root, 0, blocked))
            consensus.write_text("## Human Overrides\n## Priority Issues\n- [ ] P1: decision\n")
            state.write_text("STATUS=running\nPAUSE_REASON=\n")
            self.assertIsNone(execution_blocked_reason(root, 0, blocked))

    def test_original_priority_grammar_and_observation_are_read_only_and_require_current_guard(self):
        sys.path.insert(0, str(ROOT / "scripts/core"))
        from center_runner import governance_reason, execution_blocked_reason, protective_reason
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            consensus = root / "memories/consensus.md"
            consensus.parent.mkdir()
            prefix = "## Human Overrides\n- P1 outside the priority section\n## Priority Issues\n"
            for item, expected in (("- [ ] P1: decision\n", "unresolved_p1"), ("1. **P1**: decision\n", "unresolved_p1"),
                                   ("- [X] P1: human resolved fixture\n", None), ("- P2: other\n", None)):
                with self.subTest(item=item):
                    consensus.write_text(prefix + item)
                    before = {str(path): path.read_bytes() for path in root.rglob("*") if path.is_file()}
                    self.assertEqual(governance_reason(root), expected)
                    self.assertEqual({str(path): path.read_bytes() for path in root.rglob("*") if path.is_file()}, before)
            consensus.write_text(prefix + "- [ ] P1: decision\n")
            state = root / ".auto-loop-state"
            state.write_text("STATUS=paused\nPAUSE_REASON=unresolved_p1\n")
            since = time.time_ns()
            os.utime(state, ns=(since - 1000000000, since - 1000000000))
            self.assertIsNone(execution_blocked_reason(root, since))
            os.utime(state, ns=(since + 1000000, since + 1000000))
            self.assertEqual(execution_blocked_reason(root, since), "unresolved_p1")
            self.assertIsNone(protective_reason(root), "P1 observation must not enter the automatic stop path")
            state.write_text("STATUS=running\nPAUSE_REASON=unresolved_p1\n")
            self.assertIsNone(execution_blocked_reason(root, 0))
            consensus.write_text("invalid governance fixture")
            self.assertEqual(governance_reason(root), "context_unavailable")


class ExecutionContextTests(unittest.TestCase):
    def setUp(self):
        sys.path.insert(0, str(ROOT / "scripts/core"))
        from product_identity import register_project, transaction
        from center_runner import execution_context
        self.inspect = execution_context
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.project = "projects/registered"
        (self.root / self.project / ".git").mkdir(parents=True)
        self.product = register_project(self.root, self.project)
        with transaction(self.root) as state:
            state["continuationProductId"] = self.product["id"]
        self.registry = self.root / "projects/registry.tsv"
        self.header = "name\tpath\tlifecycle\tcreated_at_utc\n"
        self.row = "registered\tprojects/registered\tlocal\t2026-09-26T00:00:00Z\n"
        self.registry.write_text(self.header + self.row)

    def snapshot(self):
        return {str(path.relative_to(self.root)): path.read_bytes() if path.is_file() else None for path in self.root.rglob("*")}

    def test_registration_missing_duplicate_or_wrong_path_is_rejected_without_repair(self):
        self.assertTrue(self.inspect(self.root, self.product["id"])["valid"])
        for rows in ("", self.row + self.row, self.row.replace("projects/registered", "projects/other")):
            with self.subTest(rows=rows):
                self.registry.write_text(self.header + rows)
                before = self.snapshot()
                result = self.inspect(self.root, self.product["id"])
                self.assertEqual((result["valid"], result["reason"]), (False, "product_registration_invalid"))
                self.assertEqual(self.snapshot(), before)

    def test_human_selection_takes_precedence_and_cannot_redirect_another_product_request(self):
        from product_identity import register_project
        (self.root / "projects/selected/.git").mkdir(parents=True)
        selected = register_project(self.root, "projects/selected")
        self.registry.write_text(self.header + self.row + "selected\tprojects/selected\tlocal\t2026-09-26T00:00:00Z\n")
        (self.root / ".auto-company.local").write_text("ACTIVE_PROJECT=projects/selected\n")
        self.assertTrue(self.inspect(self.root, selected["id"])["valid"])
        self.assertFalse(self.inspect(self.root, self.product["id"])["valid"])
        (self.root / "projects/selected/.auto-company/identity.json").write_text('{}')
        self.assertFalse(self.inspect(self.root, selected["id"])["valid"])

    def test_pending_transactions_and_missing_git_remain_read_only(self):
        for relative in (".auto-company/product-state.transaction.json", ".auto-company/product-state.lock", ".auto-company.local.language-update"):
            with self.subTest(relative=relative):
                path = self.root / relative
                path.write_text("pending fixture")
                before = self.snapshot()
                self.assertFalse(self.inspect(self.root, self.product["id"])["valid"])
                self.assertEqual(self.snapshot(), before)
                path.unlink()
        (self.root / self.project / ".git").rmdir()
        self.assertFalse(self.inspect(self.root, self.product["id"])["valid"])

    @unittest.skipIf(os.name == "nt", "Execution-domain Git check runs on POSIX")
    def test_git_validation_rejects_nonrepository_and_framework_tracked_product(self):
        shutil.copytree(ROOT / "scripts/core", self.root / "scripts/core")
        before = self.snapshot()
        self.assertFalse(self.inspect(self.root, self.product["id"], check_git=True)["valid"])
        self.assertEqual(self.snapshot(), before)
        subprocess.run(["git", "init", str(self.root)], check=True, capture_output=True)
        subprocess.run(["git", "init", str(self.root / self.project)], check=True, capture_output=True)
        self.assertTrue(self.inspect(self.root, self.product["id"], check_git=True)["valid"])
        import fcntl
        with (self.root / ".auto-company/project-registry.lock").open("wb") as writer:
            fcntl.flock(writer, fcntl.LOCK_EX | fcntl.LOCK_NB)
            before = self.snapshot()
            self.assertFalse(self.inspect(self.root, self.product["id"], check_git=True)["valid"])
            self.assertEqual(self.snapshot(), before)
        (self.root / self.project / "source.txt").write_text("fixture")
        blob = subprocess.check_output(["git", "-C", str(self.root), "hash-object", "-w", str(self.root / self.project / "source.txt")], text=True).strip()
        subprocess.run(["git", "-C", str(self.root), "update-index", "--add", "--cacheinfo", "100644," + blob + ",projects/registered/source.txt"], check=True, capture_output=True)
        self.assertFalse(self.inspect(self.root, self.product["id"], check_git=True)["valid"])


@unittest.skipUnless(sys.platform == "linux", "POSIX owner integration runs under Linux/WSL")
class RunnerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.folder = Path(self.temp.name)
        self.root = self.folder / "中文 root % fixture"
        self.root.mkdir()
        shutil.copytree(ROOT / "scripts/core", self.root / "scripts/core")
        copy_control_entrypoints(self.root)
        shutil.copytree(ROOT / "i18n", self.root / "i18n")
        shutil.copytree(ROOT / "memories", self.root / "memories")
        shutil.copy2(ROOT / ".gitignore", self.root / ".gitignore")
        for script in (self.root / "scripts/core").glob("*.sh"):
            script.chmod(0o755)
        (self.root / "PROMPT.md").write_text("Offline process contract fixture.\n")
        subprocess.run(["git", "init", "--initial-branch=main", str(self.root)], check=True, capture_output=True)
        self.control = self.folder / "controls"
        self.control.mkdir()
        self.manifest = {"centerId": "center_fixture123", "entryId": "entry_fixture123", "sourceId": "source_fixture123", "runtimeId": "runtime_fixture123",
                         "requestId": "request_fixture123", "dispatchId": "dispatch_fixture123", "nonce": "nonce_fixture123", "root": str(self.root),
                         "controlDir": str(self.control), "environment": {"ENGINE": "claude", "MODEL": "fixture", "AUTO_COMPANY_LANGUAGE": "en"}}
        atomic_json(self.root / ".auto-company-center.json", {"protocolVersion": 1, **{key: self.manifest[key] for key in ("centerId", "runtimeId", "entryId", "sourceId")}})
        self.manifest_path = self.control / "manifest.json"
        atomic_json(self.manifest_path, self.manifest)
        self.runner = self.root / "scripts/core/center_runner.py"
        fake = self.root / "fake-engine"
        fake.write_text('''#!/bin/bash
if [ "${1:-}" = "--version" ]; then exit 0; fi
count=0
[ ! -f "$AUTO_COMPANY_ROOT/invocations" ] || count=$(cat "$AUTO_COMPANY_ROOT/invocations")
count=$((count+1))
echo "$count" > "$AUTO_COMPANY_ROOT/invocations"
if [ "${CREATE_ARTIFACT:-0}" = 1 ] && [ "$count" = 1 ]; then
  bash "$AUTO_COMPANY_ROOT/scripts/core/project.sh" new --name doc-fixture >/dev/null
  echo 'Offline artifact fixture' > "$AUTO_COMPANY_ROOT/projects/doc-fixture/README.md"
  python3 "$AUTO_COMPANY_ROOT/scripts/core/runtime_artifacts.py" --root "$AUTO_COMPANY_ROOT" --project projects/doc-fixture document README.md && touch "$AUTO_COMPANY_ROOT/artifact-ok"
fi
if [ "${SPAWN_ORPHAN:-0}" = 1 ]; then
    python3 -c 'import os,time; child=os.fork(); os._exit(0) if child else None; os.setsid(); open(os.environ["AUTO_COMPANY_ROOT"]+"/orphan","w").write(str(os.getpid())); time.sleep(120)' &
fi
if [ "${SLOW_ENGINE:-0}" = 1 ]; then sleep 120; fi
if [ "${ADD_P1:-0}" = 1 ]; then
    python3 -c 'import os,pathlib; p=pathlib.Path(os.environ["AUTO_COMPANY_ROOT"])/"memories/consensus.md"; p.write_text(p.read_text().replace("## Priority Issues", "## Priority Issues\\n- [ ] P1: fixture needs human decision"))'
fi
printf '{"type":"result","subtype":"success","result":"offline","usage":{"input_tokens":1,"output_tokens":1}}\\n'
if [ "$count" -ge "${STOP_AFTER:-2}" ]; then touch "$AUTO_COMPANY_ROOT/.auto-loop-stop"; fi
''')
        fake.chmod(0o755)
        self.env = dict(os.environ, CLAUDE_BIN=str(fake), CLAUDE_PERMISSION_MODE="default", LOOP_INTERVAL="0", CYCLE_TIMEOUT_SECONDS="30",
                        CYCLE_TERM_GRACE_SECONDS="1", CYCLE_KILL_WAIT_SECONDS="1", XDG_STATE_HOME=str(self.folder / "os-state"))
        self.processes = []
        self.addCleanup(self.cleanup)

    def heartbeat(self, stop=False):
        atomic_json(self.control / "control.json", {**{key: self.manifest[key] for key in ("centerId", "requestId", "dispatchId", "nonce")},
                                                   "heartbeat": time.time(), "stop": stop, "reason": "user_stop" if stop else None})

    def cleanup(self):
        self.heartbeat(True)
        for child in self.processes:
            if child.poll() is None:
                child.terminate()
                try:
                    child.wait(timeout=15)
                except subprocess.TimeoutExpired:
                    child.kill()
                    child.wait(timeout=5)

    def launch(self, **env):
        self.heartbeat()
        output = (self.folder / ("process-%d.log" % len(self.processes))).open("wb")
        process = subprocess.Popen([sys.executable, str(self.runner), "run", "--manifest", str(self.manifest_path)],
                                   env={**self.env, **env}, stdout=output, stderr=output)
        output.close()
        self.processes.append(process)
        return process

    def wait_for(self, predicate, timeout=15):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            self.heartbeat()
            if predicate():
                return
            time.sleep(0.1)
        details = "\n".join(path.read_text(errors="replace")[-5000:] for path in self.folder.glob("*.log"))
        details += (self.control / "runner.log").read_text(errors="replace")[-5000:] if (self.control / "runner.log").exists() else ""
        self.fail("Timed out: " + details)

    def test_direct_managed_cli_rejected_before_source_mutation(self):
        result = subprocess.run(["bash", str(self.root / "scripts/core/auto-loop.sh")], env=self.env, capture_output=True, timeout=10)
        self.assertEqual(result.returncode, 78)
        self.assertFalse((self.root / "logs").exists())
        result = subprocess.run(["bash", str(self.root / "scripts/core/stop-loop.sh"), "--resume"], env=self.env, capture_output=True, timeout=10)
        self.assertEqual(result.returncode, 78)
        self.assertFalse((self.root / ".auto-loop-stop").exists())
        result = subprocess.run([sys.executable, str(self.root / "scripts/core/runtime_artifacts.py"), "--root", str(self.root), "finalize", "--cycle", "cycle-test", "--cleanup-only"], env=self.env, capture_output=True, timeout=10)
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse((self.root / "logs").exists())

    def test_managed_provider_tool_without_inherited_fd_retains_artifact_access(self):
        process = self.launch(CREATE_ARTIFACT="1", STOP_AFTER="1")
        self.wait_for(lambda: process.poll() is not None, timeout=35)
        self.assertEqual(process.returncode, 0)
        self.assertTrue((self.root / "artifact-ok").exists())
        records = [json.loads(path.read_text()) for path in (self.root / "logs/artifacts").glob("*.json")]
        self.assertTrue(any(row.get("kind") == "document" for row in records))

    def test_one_slot_covers_two_complete_cycles_and_child_cleanup(self):
        process = self.launch(SPAWN_ORPHAN="1")
        self.wait_for(lambda: process.poll() is not None, timeout=35)
        self.assertEqual(process.returncode, 0)
        self.assertEqual((self.root / "invocations").read_text().strip(), "2")
        receipt = json.loads((self.control / "receipt.json").read_text())
        self.assertEqual(receipt["state"], "terminal")
        self.assertTrue(receipt["cleanupConfirmed"])
        orphan = int((self.root / "orphan").read_text())
        self.assertFalse(Path("/proc/%d" % orphan).exists())
        state = json.loads((self.root / ".auto-company/product-state.json").read_text())
        self.assertEqual(len(state["cycles"]), 2)
        duplicate = subprocess.run([sys.executable, str(self.runner), "run", "--manifest", str(self.manifest_path)], env=self.env, capture_output=True, timeout=10)
        self.assertEqual(duplicate.returncode, 78)
        self.assertEqual((self.root / "invocations").read_text().strip(), "2")

    def test_original_guard_p1_wait_is_reported_without_stopping_or_releasing_slot(self):
        process = self.launch(ADD_P1="1", STOP_AFTER="99", LOOP_INTERVAL="1")
        receipt_path = self.control / "receipt.json"
        self.wait_for(lambda: receipt_path.exists() and json.loads(receipt_path.read_text()).get("executionBlockedReason") == "unresolved_p1", timeout=25)
        self.wait_for(lambda: (self.root / "logs/auto-loop.log").read_text().count("[P1_BLOCK]") >= 2)
        self.assertIsNone(process.poll())
        self.assertEqual((self.root / "invocations").read_text().strip(), "1")
        receipt = json.loads(receipt_path.read_text())
        self.assertEqual(receipt["state"], "running")
        self.assertTrue(receipt["executionBlockedAt"])
        probe = subprocess.run([sys.executable, str(self.runner), "probe", "--center-id", self.manifest["centerId"], "--manifest", str(self.manifest_path)],
                               env=self.env, capture_output=True, text=True, check=True, timeout=10)
        self.assertFalse(json.loads(probe.stdout)["slotFree"])
        self.assertFalse((self.root / ".auto-loop-stop").exists())
        self.assertFalse((self.root / ".auto-loop-paused").exists())
        consensus = (self.root / "memories/consensus.md").read_bytes()
        self.heartbeat(True)
        process.wait(timeout=20)
        receipt = json.loads(receipt_path.read_text())
        self.assertEqual(receipt["reason"], "user_stop")
        self.assertTrue(receipt["cleanupConfirmed"])
        self.assertIsNone(receipt["executionBlockedReason"])
        self.assertEqual((self.root / "memories/consensus.md").read_bytes(), consensus)

    def test_guard_refresh_keeps_complete_p1_state_until_atomic_publication(self):
        sys.path.insert(0, str(ROOT / "scripts/core"))
        from center_runner import execution_blocked_reason
        # Hold the second real guard write after its first field. The reader
        # must still see the previous complete state while the new one is built.
        guard = self.root / "scripts/core/consensus-guard.sh"
        needle = "        printf 'LOOP_COUNT=%s\\n' \"$cycle\"\n"
        gate = self.root / "hold-state-write"
        ready = self.root / "state-write-held"
        source = guard.read_text()
        self.assertEqual(source.count(needle), 1)
        guard.write_text(source.replace(needle, needle + '''        if [ -f "$FRAMEWORK_DIR/hold-state-write" ]; then
            touch "$FRAMEWORK_DIR/state-write-held"
            while [ -f "$FRAMEWORK_DIR/hold-state-write" ]; do sleep 0.05; done
        fi
'''))
        self.addCleanup(lambda: gate.unlink(missing_ok=True))
        process = self.launch(ADD_P1="1", STOP_AFTER="99", LOOP_INTERVAL="1")
        receipt_path = self.control / "receipt.json"
        self.wait_for(lambda: receipt_path.exists() and json.loads(receipt_path.read_text()).get("executionBlockedReason") == "unresolved_p1", timeout=25)
        confirmed = json.loads(receipt_path.read_text())
        consensus = (self.root / "memories/consensus.md").read_bytes()
        gate.touch()
        self.wait_for(ready.exists)
        self.assertEqual(execution_blocked_reason(self.root, 0), "unresolved_p1")
        receipt = json.loads(receipt_path.read_text())
        self.assertEqual(receipt["executionBlockedReason"], "unresolved_p1")
        self.assertEqual(receipt["executionBlockedAt"], confirmed["executionBlockedAt"])
        self.assertIsNone(process.poll())
        self.assertEqual((self.root / "invocations").read_text().strip(), "1")
        probe = subprocess.run([sys.executable, str(self.runner), "probe", "--center-id", self.manifest["centerId"], "--manifest", str(self.manifest_path)],
                               env=self.env, capture_output=True, text=True, check=True, timeout=10)
        self.assertFalse(json.loads(probe.stdout)["slotFree"])
        self.assertFalse((self.root / ".auto-loop-stop").exists())
        self.assertFalse((self.root / ".auto-loop-paused").exists())
        self.assertEqual((self.root / "memories/consensus.md").read_bytes(), consensus)
        gate.unlink()

    def test_p1_rejects_runner_and_takeover_before_loop_but_does_not_prevent_release(self):
        consensus = self.root / "memories/consensus.md"
        data = b"## Human Overrides\n- retained fixture\n## Priority Issues\n- [ ] P1: human decision required\n"
        consensus.write_bytes(data)
        process = self.launch()
        process.wait(timeout=15)
        receipt = json.loads((self.control / "receipt.json").read_text())
        self.assertEqual((receipt["state"], receipt["reason"], receipt["launched"]), ("terminal", "unresolved_p1", False))
        self.assertTrue(receipt["cleanupConfirmed"])
        self.assertFalse((self.root / "invocations").exists())
        marker_path = self.root / ".auto-company-center.json"
        marker = json.loads(marker_path.read_text())
        marker_path.unlink()
        binding = self.control / "binding.json"
        manifest = {"root": str(self.root), "marker": marker}
        atomic_json(binding, {**manifest, "action": "takeover", "oldMarker": None})
        denied = subprocess.run([sys.executable, str(self.runner), "bind", "--manifest", str(binding)], env=self.env, capture_output=True, text=True, timeout=10)
        self.assertEqual(denied.returncode, 78)
        self.assertIn("unresolved_p1", denied.stderr)
        atomic_json(marker_path, marker)
        atomic_json(binding, {**manifest, "action": "release", "oldMarker": marker})
        released = subprocess.run([sys.executable, str(self.runner), "bind", "--manifest", str(binding)], env=self.env, capture_output=True, text=True, timeout=10)
        self.assertEqual(released.returncode, 0, released.stderr)
        self.assertFalse(marker_path.exists())
        self.assertEqual(consensus.read_bytes(), data)
        self.assertFalse((self.root / ".auto-loop-paused").exists())

    def test_competing_runner_and_owned_stop_preserve_unrelated_sentinel(self):
        sentinel = subprocess.Popen(["sleep", "60"])
        self.processes.append(sentinel)
        first = self.launch(SLOW_ENGINE="1")
        self.wait_for(lambda: (self.root / "invocations").exists())
        second = subprocess.run([sys.executable, str(self.runner), "run", "--manifest", str(self.manifest_path)], env=self.env, capture_output=True, timeout=10)
        self.assertEqual(second.returncode, 78)
        self.heartbeat(True)
        first.wait(timeout=20)
        self.assertIsNone(sentinel.poll())
        receipt = json.loads((self.control / "receipt.json").read_text())
        self.assertEqual(receipt["reason"], "user_stop")
        self.assertTrue(receipt["cleanupConfirmed"])

    def test_center_disconnected_stops_without_next_cycle(self):
        process = self.launch(SLOW_ENGINE="1")
        self.wait_for(lambda: (self.root / "invocations").exists())
        control = json.loads((self.control / "control.json").read_text())
        control["heartbeat"] = time.time() - 60
        atomic_json(self.control / "control.json", control)
        process.wait(timeout=20)
        receipt = json.loads((self.control / "receipt.json").read_text())
        self.assertEqual(receipt["reason"], "center_disconnected")
        self.assertEqual((self.root / "invocations").read_text().strip(), "1")
        self.assertTrue(receipt["cleanupConfirmed"])

    def test_media_timeout_and_stop_reap_detached_descendants_without_harming_sentinel(self):
        worker = self.folder / "media-worker.py"
        worker.write_text("import os,time,sys\nchild=os.fork()\nif child == 0:\n os.setsid()\n open(sys.argv[1], 'w').write(str(os.getpid()))\n time.sleep(120)\ntime.sleep(120)\n")
        helper = self.folder / "media-owner.py"
        helper.write_text("import json,os,sys\nsys.path.insert(0,sys.argv[1])\nfrom center_runner import media_command,lock_file\nfd=lock_file(sys.argv[2])\ntry:\n result=media_command([sys.executable,sys.argv[3],sys.argv[4]],sys.argv[1],None,False,fd,timeout=float(sys.argv[6]),control_path=sys.argv[5],operation_id='fixture')\n print(json.dumps(result))\nfinally:\n os.close(fd)\n")
        sentinel = subprocess.Popen(["sleep", "60"])
        self.processes.append(sentinel)
        for mode in ("timeout", "stop"):
            with self.subTest(mode=mode):
                pid_path = self.folder / (mode + ".pid")
                control = self.folder / (mode + ".control.json")
                atomic_json(control, {"operationId": "fixture", "heartbeat": time.time(), "stop": False})
                owner = subprocess.Popen([sys.executable, str(helper), str(ROOT / "scripts/core"), str(self.folder / "media.slot"),
                                          str(worker), str(pid_path), str(control), "0.5" if mode == "timeout" else "30"],
                                         stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
                self.processes.append(owner)
                self.wait_for(pid_path.exists)
                if mode == "stop":
                    atomic_json(control, {"operationId": "fixture", "heartbeat": time.time(), "stop": True})
                output, errors = owner.communicate(timeout=15)
                self.assertEqual(owner.returncode, 0, errors)
                self.assertEqual(json.loads(output), {"ok": False, "reason": "media_timeout" if mode == "timeout" else "media_interrupted"})
                self.assertFalse(Path("/proc/" + pid_path.read_text()).exists())
                self.assertIsNone(sentinel.poll())

    def test_takeover_does_not_strand_a_legacy_preview_without_verified_process_identity(self):
        sys.path.insert(0, str(ROOT / "scripts/core"))
        from product_identity import register_project
        project = "projects/preview-fixture"
        (self.root / project).mkdir(parents=True)
        product = register_project(self.root, project)
        marker = json.loads((self.root / ".auto-company-center.json").read_text())
        (self.root / ".auto-company-center.json").unlink()
        atomic_json(self.root / "logs/artifacts/legacy-preview.json", {"id": "legacy-preview", "kind": "preview", "state": "running",
                    "lifetime": "operator", "project": project, "productId": product["id"], "token": "old-fixture-token", "pid": 999999})
        binding = self.control / "binding.json"
        atomic_json(binding, {"action": "takeover", "root": str(self.root), "oldMarker": None, "marker": marker})
        result = subprocess.run([sys.executable, str(self.runner), "bind", "--manifest", str(binding)], env=self.env, capture_output=True, text=True, timeout=10)
        self.assertEqual(result.returncode, 78)
        self.assertIn("preview_owner_unconfirmed", result.stderr)
        self.assertFalse((self.root / ".auto-company-center.json").exists())

    def test_runner_and_takeover_reject_missing_registration_before_loop_but_release_still_works(self):
        sys.path.insert(0, str(ROOT / "scripts/core"))
        from product_identity import register_project, transaction
        project = "projects/registered"
        (self.root / project).mkdir(parents=True)
        subprocess.run(["git", "init", str(self.root / project)], check=True, capture_output=True)
        product = register_project(self.root, project)
        with transaction(self.root) as state:
            state["continuationProductId"] = product["id"]
        (self.root / "projects/registry.tsv").write_text("name\tpath\tlifecycle\tcreated_at_utc\n")
        self.manifest["productId"] = product["id"]
        atomic_json(self.manifest_path, self.manifest)
        process = self.launch()
        process.wait(timeout=15)
        self.assertNotEqual(process.returncode, 0)
        receipt = json.loads((self.control / "receipt.json").read_text())
        self.assertEqual((receipt["state"], receipt["reason"], receipt["launched"]), ("terminal", "product_registration_invalid", False))
        self.assertTrue(receipt["cleanupConfirmed"])
        self.assertFalse((self.root / "invocations").exists())
        self.assertFalse((self.root / ".auto-loop-paused").exists())
        marker_path = self.root / ".auto-company-center.json"
        marker = json.loads(marker_path.read_text())
        marker_path.unlink()
        binding = self.control / "binding.json"
        manifest = {"root": str(self.root), "marker": marker, "productId": product["id"]}
        atomic_json(binding, {**manifest, "action": "takeover", "oldMarker": None})
        denied = subprocess.run([sys.executable, str(self.runner), "bind", "--manifest", str(binding)], env=self.env, capture_output=True, text=True, timeout=10)
        self.assertEqual(denied.returncode, 78)
        self.assertIn("product_registration_invalid", denied.stderr)
        self.assertFalse(marker_path.exists())
        atomic_json(marker_path, marker)
        atomic_json(binding, {**manifest, "action": "release", "oldMarker": marker})
        released = subprocess.run([sys.executable, str(self.runner), "bind", "--manifest", str(binding)], env=self.env, capture_output=True, text=True, timeout=10)
        self.assertEqual(released.returncode, 0, released.stderr)
        self.assertFalse(marker_path.exists())


@unittest.skipUnless(os.name == "nt" and os.environ.get("AUTO_COMPANY_TEST_CENTER_WSL") == "1", "Explicit Windows/WSL bridge fixture")
class WindowsBridgeTests(unittest.TestCase):
    def test_native_center_controls_wsl_git_clone_and_runner_with_unicode_paths(self):
        with tempfile.TemporaryDirectory(prefix="center 中文 % ") as temporary:
            folder = Path(temporary)
            framework, target, control = folder / "framework", folder / "ordinary clone", folder / "control"
            framework.mkdir()
            control.mkdir()
            shutil.copytree(ROOT / "scripts/core", framework / "scripts/core")
            copy_control_entrypoints(framework)
            shutil.copytree(ROOT / "i18n", framework / "i18n")
            shutil.copytree(ROOT / "memories", framework / "memories")
            shutil.copy2(ROOT / ".gitignore", framework / ".gitignore")
            (framework / "PROMPT.md").write_text("Offline Windows bridge fixture.\n")
            for command in (["git", "init", str(framework)], ["git", "-C", str(framework), "add", "."],
                            ["git", "-C", str(framework), "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-m", "fixture"]):
                subprocess.run(command, check=True, capture_output=True)
            revision = subprocess.check_output(["git", "-C", str(framework), "rev-parse", "HEAD"], text=True).strip()
            domain = {"platform": "wsl", "distribution": os.environ.get("AUTO_COMPANY_TEST_WSL_DISTRO", "Ubuntu"), "user": os.environ.get("AUTO_COMPANY_TEST_WSL_USER", "max")}
            adapter = PosixAdapter(framework, domain)
            adapter.clone(framework, target, revision, control)
            self.assertTrue((target / ".git").is_dir())
            result = adapter._execute(adapter._wsl() + ["--exec", "git", "-C", adapter.path(target), "rev-parse", "HEAD"])
            self.assertEqual(result.stdout.strip(), revision)
            fake = target / "fake-engine"
            fake.write_text('#!/bin/bash\nif [ "${1:-}" = "--version" ]; then exit 0; fi\necho called > "$AUTO_COMPANY_ROOT/invocations"\nprintf \'{"type":"result","subtype":"success","result":"offline"}\\n\'\ntouch "$AUTO_COMPANY_ROOT/.auto-loop-stop"\n', encoding="utf-8", newline="\n")
            adapter._execute(adapter._wsl() + ["--exec", "chmod", "+x", adapter.path(fake)])
            ids = {key: prefix + "_" + uuid.uuid4().hex for key, prefix in (("centerId", "center"), ("entryId", "entry"), ("sourceId", "source"), ("runtimeId", "runtime"), ("requestId", "request"), ("dispatchId", "dispatch"))}
            atomic_json(target / ".auto-company-center.json", {"protocolVersion": 1, **{key: ids[key] for key in ("centerId", "runtimeId", "sourceId", "entryId")}})
            manifest = {**ids, "nonce": uuid.uuid4().hex, "root": adapter.path(target), "controlDir": adapter.path(control),
                        "environment": {"ENGINE": "claude", "MODEL": "fixture", "AUTO_COMPANY_LANGUAGE": "en"}}
            path = control / "manifest.json"
            atomic_json(path, manifest)
            heartbeat = {key: manifest[key] for key in ("centerId", "requestId", "dispatchId", "nonce")}
            atomic_json(control / "control.json", {**heartbeat, "heartbeat": time.time(), "stop": False})
            with patch.dict(os.environ, {"CLAUDE_BIN": adapter.path(fake), "CLAUDE_PERMISSION_MODE": "default", "LOOP_INTERVAL": "0"}):
                process = adapter.launch(path)
                try:
                    deadline = time.monotonic() + 45
                    while process.poll() is None and time.monotonic() < deadline:
                        atomic_json(control / "control.json", {**heartbeat, "heartbeat": time.time(), "stop": False})
                        time.sleep(0.2)
                    if process.poll() is None:
                        atomic_json(control / "control.json", {**heartbeat, "heartbeat": time.time(), "stop": True, "reason": "user_stop"})
                        process.wait(timeout=20)
                    logs = (control / "bridge.log").read_text(errors="replace")
                    logs += (control / "runner.log").read_text(errors="replace") if (control / "runner.log").exists() else ""
                    self.assertEqual(process.returncode, 0, logs)
                    self.assertEqual((target / "invocations").read_text().strip(), "called")
                    result = adapter.query("probe", center_id=ids["centerId"], manifest=path)
                    self.assertTrue(result["slotFree"])
                    self.assertTrue(result["receipt"]["cleanupConfirmed"])
                finally:
                    if process.poll() is None:
                        atomic_json(control / "control.json", {**heartbeat, "heartbeat": time.time(), "stop": True, "reason": "user_stop"})
                        process.wait(timeout=20)


@unittest.skipUnless(sys.platform == "linux" and os.environ.get("AUTO_COMPANY_TEST_CENTER_MEDIA") == "1", "Explicit real media integration fixture")
class MediaIntegrationTests(unittest.TestCase):
    def test_preview_capture_continue_and_release_cleanup(self):
        from center_catalog import CenterCatalog
        sys.path.insert(0, str(ROOT / "scripts/core"))
        from product_identity import register_project, transaction
        from runtime_artifacts import artifact_records, preview_request
        from center_runner import same_process
        import urllib.request
        modules = Path(os.environ["AUTO_COMPANY_TEST_MEDIA_MODULES"])
        self.assertTrue((modules / "playwright").is_dir(), "Explicit existing Playwright dependency is missing")
        with tempfile.TemporaryDirectory(prefix="center-media-fixture-") as temporary:
            folder = Path(temporary)
            root = folder / "runtime"
            root.mkdir()
            shutil.copytree(ROOT / "scripts/core", root / "scripts/core")
            copy_control_entrypoints(root)
            # The fake model is an orchestration fixture; media must still
            # exercise the actual host-to-namespace boundary.
            shutil.copy2(ROOT / "scripts/core/project_isolation.py", root / "scripts/core/project_isolation.py")
            shutil.copytree(ROOT / "i18n", root / "i18n")
            shutil.copytree(ROOT / "memories", root / "memories")
            shutil.copytree(ROOT / "examples/scopefence", root / "projects/scopefence")
            shutil.copy2(root / "memories/consensus.template.md", root / "memories/consensus.md")
            shutil.copy2(ROOT / ".gitignore", root / ".gitignore")
            (root / "PROMPT.md").write_text("Offline media lifecycle fixture; not product acceptance.\n")
            (root / "scripts/media").mkdir()
            shutil.copy2(ROOT / "scripts/media/package.json", root / "scripts/media/package.json")
            (root / "scripts/media/node_modules").symlink_to(modules, target_is_directory=True)
            for script in (root / "scripts/core").glob("*.sh"):
                script.chmod(0o755)
            subprocess.run(["git", "init", str(root)], check=True, capture_output=True)
            project = "projects/scopefence"
            subprocess.run(["git", "init", str(root / project)], check=True, capture_output=True)
            (root / "projects/registry.tsv").write_text("name\tpath\tlifecycle\tcreated_at_utc\nscopefence\tprojects/scopefence\tindependent-local-fixture\t2026-09-26T00:00:00Z\n")
            product = register_project(root, project)
            with transaction(root) as state:
                state["continuationProductId"] = product["id"]
            fake = root / "fake-engine"
            fake.write_text('#!/bin/bash\nif [ "${1:-}" = "--version" ]; then exit 0; fi\nprintf \'{"type":"result","subtype":"success","result":"offline fixture"}\\n\'\ntouch "$AUTO_COMPANY_ROOT/.auto-loop-stop"\n')
            fake.chmod(0o755)
            store = CenterStore(folder / "center")
            catalog = CenterCatalog(store)
            runtime = CenterRuntime(store, catalog, root, {"platform": "posix"})
            actual_media = runtime.adapter.media
            def checked_media(path):
                try:
                    return actual_media(path)
                except subprocess.CalledProcessError as error:
                    print("Fixture runner media diagnostic:", error.stdout, error.stderr)
                    raise
            runtime.adapter.media = checked_media
            previews = []
            def wait_operation(operation):
                deadline = time.monotonic() + 80
                while time.monotonic() < deadline:
                    observed = runtime.operation(operation["operationId"])
                    if observed["state"] not in {"running", "preparing"}:
                        return observed
                    time.sleep(0.1)
                self.fail("Media operation did not finish")
            def source():
                with store.transaction() as tx:
                    return tx.get("sources", source_id)
            def media(action):
                current = source()
                result = wait_operation(runtime.media_action(entry_id, action, {"sourceId": source_id, "expectedRevision": current["revision"], "idempotencyKey": str(uuid.uuid4())}))
                self.assertEqual(result["state"], "succeeded", result)
                return result
            with patch.dict(os.environ, {"CLAUDE_BIN": str(fake), "CLAUDE_PERMISSION_MODE": "default", "LOOP_INTERVAL": "0", "XDG_STATE_HOME": str(folder / "os-state")}):
                try:
                    candidate = catalog.probe({"root": str(root)})
                    imported = catalog.commit({"candidateId": candidate["candidateId"], "candidateHash": candidate["candidateHash"], "mode": "readonly", "idempotencyKey": str(uuid.uuid4())})
                    entry_id, source_id = imported["items"][0]["entryId"], imported["items"][0]["sourceId"]
                    operation = runtime.source_action(source_id, "takeover", {"expectedRevision": source()["revision"], "idempotencyKey": str(uuid.uuid4())})
                    self.assertEqual(operation["state"], "succeeded")
                    runtime.start()
                    self.assertEqual(media("preview_start")["state"], "succeeded")
                    previews = [row for row in artifact_records(root) if row.get("kind") == "preview" and row.get("state") == "running"]
                    self.assertEqual(len(previews), 1)
                    preview = previews[0]
                    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
                    with opener.open(preview["url"], timeout=3) as response:
                        self.assertEqual(response.status, 200)
                        self.assertIn(b"ScopeFence", response.read())
                    capture = media("capture")
                    evidence = json.loads((root / "logs/product-media" / product["id"] / "media.json").read_text())
                    self.assertEqual(capture["state"], "succeeded", evidence.get("attempt"))
                    self.assertEqual(evidence["attempt"]["state"], "success")
                    self.assertEqual({row["viewport"] for row in evidence["latestSuccess"]["variants"]}, {"desktop", "mobile"})
                    self.assertTrue(preview_request(preview), "Capture should not stop the retained read-only preview")
                    profile_path = root / project / ".auto-company/media.json"
                    atomic_json(profile_path, {"version": 1, "type": "static", "webRoot": ".", "readySelector": "#fixture-never-ready", "timeoutSeconds": 15})
                    current = source()
                    interrupted = runtime.media_action(entry_id, "capture", {"sourceId": source_id, "expectedRevision": current["revision"], "idempotencyKey": str(uuid.uuid4())})
                    receipt_path = store.data_dir / "operations" / interrupted["operationId"] / "receipt.json"
                    from product_media_process import posix_rows
                    from center_runner import identity
                    captured_owners = []
                    deadline = time.monotonic() + 10
                    while time.monotonic() < deadline:
                        receipt = json.loads(receipt_path.read_text()) if receipt_path.exists() else {}
                        runner_pid = (receipt.get("runner") or {}).get("pid")
                        parents, rows = {runner_pid}, posix_rows()
                        while True:
                            children = {row["pid"] for row in rows if row["ppid"] in parents} - parents
                            if not children:
                                break
                            parents.update(children)
                        observed = [identity(pid) for pid in parents if pid]
                        browser_started = False
                        for pid in parents:
                            try:
                                browser_started |= b"chrome" in Path("/proc/%s/cmdline" % pid).read_bytes()
                            except OSError:
                                pass
                        if browser_started:
                            captured_owners = [row for row in observed if row]
                            break
                        time.sleep(0.05)
                    self.assertTrue(captured_owners, "Real browser child must start before stop-all")
                    runtime.queue_action("stop-all", {"idempotencyKey": str(uuid.uuid4())})
                    interrupted = wait_operation(interrupted)
                    self.assertEqual((interrupted["state"], interrupted["reason"]), ("failed", "media_interrupted"))
                    receipt = json.loads(receipt_path.read_text())
                    self.assertTrue(receipt["cleanupConfirmed"])
                    self.assertFalse(any(same_process(row) for row in captured_owners))
                    self.assertTrue(preview_request(preview), "Stop-all capture cleanup must preserve the independent read-only preview")
                    profile_path.unlink()
                    catalog.refresh_source(source_id)
                    current = source()
                    request = runtime.create_request({"entryId": entry_id, "sourceId": source_id, "runtimeId": current["runtimeId"], "expectedSourceRevision": current["sourceRevision"],
                                                      "executionMode": "start_now", "kind": "continue", "config": {"engine": "claude", "model": "fixture"}, "idempotencyKey": str(uuid.uuid4())})
                    deadline = time.monotonic() + 80
                    while time.monotonic() < deadline:
                        request = runtime.get_request(request["requestId"])
                        if request["state"] in TERMINAL | {"attention"}:
                            break
                        time.sleep(0.1)
                    self.assertEqual(request["state"], "ended", request)
                    self.assertEqual(request["terminalReason"], "natural", request)
                    contexts = list((root / "logs").glob("cycle-*.context.json"))
                    self.assertTrue(contexts, "Offline continuation must actually run a cycle")
                    self.assertEqual(json.loads(contexts[0].read_text())["languageEvidence"]["productId"], product["id"])
                    self.assertTrue(preview_request(preview), "A retained read-only preview may coexist with model work")
                    self.assertEqual(media("preview_stop")["state"], "succeeded")
                    self.assertFalse(same_process(preview["processIdentity"]))
                    self.assertFalse(preview_request(preview))
                    self.assertEqual(media("preview_start")["state"], "succeeded")
                    previews = [row for row in artifact_records(root) if row.get("kind") == "preview" and row.get("state") == "running"]
                    self.assertEqual(len(previews), 1)
                    preview = previews[0]
                    preview_record = root / "logs/artifacts" / (preview["id"] + ".json")
                    atomic_json(preview_record, {**preview, "token": "incorrect-fixture-token"})
                    release_body = {"expectedRevision": source()["revision"], "idempotencyKey": str(uuid.uuid4())}
                    with self.assertRaises(subprocess.CalledProcessError):
                        runtime.source_action(source_id, "release", release_body)
                    self.assertTrue((root / ".auto-company-center.json").exists())
                    self.assertTrue(source()["capabilities"]["preview"])
                    self.assertTrue(preview_request(preview), "Unknown preview ownership cannot revoke management or kill by PID")
                    atomic_json(preview_record, preview)
                    recovered = runtime.source_action(source_id, "release", release_body)
                    self.assertEqual((recovered["state"], recovered["reason"]), ("failed", "binding_not_applied"))
                    released = runtime.source_action(source_id, "release", {"expectedRevision": source()["revision"], "idempotencyKey": str(uuid.uuid4())})
                    self.assertEqual(released["state"], "succeeded")
                    self.assertFalse((root / ".auto-company-center.json").exists())
                    for preview in previews:
                        self.assertFalse(same_process(preview["processIdentity"]))
                        self.assertFalse(preview_request(preview))
                finally:
                    for preview in artifact_records(root):
                        if preview.get("kind") == "preview" and preview.get("state") == "running":
                            preview_request(preview, stop=True)
                    runtime.close()
                    store.close()
                    deadline = time.monotonic() + 5
                    while any(same_process(row.get("processIdentity")) for row in previews) and time.monotonic() < deadline:
                        time.sleep(0.05)
                    self.assertFalse(any(same_process(row.get("processIdentity")) for row in previews), "Fixture must leave no live preview")


if __name__ == "__main__":
    unittest.main()
