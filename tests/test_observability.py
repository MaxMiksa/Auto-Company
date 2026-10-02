"""Deterministic contracts for events, session identity and tool artifacts."""
import contextlib
from datetime import datetime, timezone
import http.server
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts/core"))
sys.path.insert(0, str(ROOT / "dashboard"))
from runtime_events import Recorder, observed_config
from runtime_artifacts import base_record, save, fingerprint
from journal_data import JournalSource
from observability_data import artifact_projection, cycle_events, registered_artifacts, preview_available


class ObservabilityTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.project = self.root / "projects/probe"
        self.project.mkdir(parents=True)
        (self.root / ".auto-company.local").write_text("ACTIVE_PROJECT=projects/probe\n")
        self.source = JournalSource(self.root)

    def test_events_partial_and_wrong_cycle(self):
        recorder = Recorder(self.root, "cycle-probe")
        recorder.emit("process.started")
        recorder.ingest(b'{"type":"item.started","item":{"id":"a","type":"command_execution","command":"pytest"}}\n')
        recorder.ingest(b'{"type":"item.completed","item":{"id":"a","type":"command_execution","exit_code":1}}\n')
        recorder.ingest(b'{"type":[]}')
        recorder.ingest(b'{"type":{}}')
        with recorder.path.open("ab") as output:
            output.write(b'{"version":1,"cycleId":"other","sequence":99,"kind":"process.exited"}\n{"partial":')
        result = cycle_events(self.source, {"id": "cycle-probe", "active": False})
        self.assertEqual(result["eventStatus"], "partial")
        self.assertEqual(len(result["events"]), 3)
        self.assertEqual(result["events"][-1]["exitCode"], 1)

    def test_no_reasoning_or_credentials_in_projection(self):
        recorder = Recorder(self.root, "cycle-secret")
        with patch.dict(os.environ, {"OPENAI_API_KEY": "not-a-real-secret"}):
            recorder.ingest(json.dumps({"type": "item.started", "item": {"type": "command_execution", "command": "echo not-a-real-secret"}}))
            recorder.ingest(json.dumps({"type": "item.completed", "item": {"type": "reasoning", "text": "private reasoning"}}))
        text = recorder.path.read_text()
        self.assertNotIn("not-a-real-secret", text)
        self.assertNotIn("private reasoning", text)
        self.assertIn("[REDACTED]", text)

    def test_session_exact_identity_and_cwd_required(self):
        home = self.root / "codex"
        folder = home / "sessions" / datetime.now(timezone.utc).strftime("%Y/%m/%d")
        folder.mkdir(parents=True)
        thread = "11111111-1111-1111-1111-111111111111"
        path = folder / f"rollout-{thread}.jsonl"
        def write(cwd, identity):
            path.write_text(json.dumps({"type": "session_meta", "payload": {"id": identity, "cwd": str(cwd)}}) + "\n" +
                            json.dumps({"type": "turn_context", "payload": {"cwd": str(cwd), "model": "gpt-5.6-luna", "effort": "high"}}) + "\n")
        write(self.project, thread)
        self.assertIsNone(observed_config(home, thread, self.root))
        write(self.root, "other")
        self.assertIsNone(observed_config(home, thread, self.root))
        write(self.root, thread)
        self.assertEqual(observed_config(home, thread, self.root)["reasoning"], "high")
        self.assertIsNone(observed_config(home, "../../escape", self.root))

    def test_event_writer_failure_does_not_raise(self):
        (self.root / "logs").write_text("blocked")
        recorder = Recorder(self.root, "cycle-error")
        recorder.emit("process.started")
        self.assertEqual(recorder.dropped, 1)

    def test_interrupted_report_uses_message_not_raw_stream(self):
        from tests.test_dashboard_journal import record
        recorder = Recorder(self.root, "cycle-interrupted")
        recorder.emit("report", text="Recorded partial work", source="agent_report")
        logs = self.root / "logs"
        (logs / "usage.jsonl").write_text(json.dumps(record(identity="cycle-interrupted", status="interrupted")) + "\n")
        (logs / "cycle-interrupted.json").write_text(json.dumps({"result": 'Reading stdin... {"type":"thread.started"}'}))
        cycle = self.source.snapshot()["cycles"][0]
        self.assertEqual(cycle["summary"], "Recorded partial work")
        self.assertEqual(cycle["status"], "interrupted")
        self.assertTrue(cycle["reportObservedAt"])

    def test_registered_document_changed_and_wrong_project(self):
        path = self.project / "report.md"
        path.write_text("result")
        record = base_record("projects/probe", "document")
        record.update(path="projects/probe/report.md", sha256=fingerprint(path))
        save(self.root, record)
        self.assertTrue(registered_artifacts(self.source)[0]["available"])
        path.write_text("modified")
        self.assertFalse(registered_artifacts(self.source)[0]["available"])
        path.unlink()
        self.assertFalse(registered_artifacts(self.source)[0]["available"])
        (self.root / ".auto-company.local").write_text("ACTIVE_PROJECT=projects/other\n")
        self.assertEqual(registered_artifacts(self.source), [])

    def test_check_exit_and_junit_and_stale_report(self):
        runner = ROOT / "scripts/core/runtime_artifacts.py"
        prefix = [sys.executable, str(runner), "--root", str(self.root), "--project", "projects/probe", "check", "--report", "report.xml", "--"]
        script = "from pathlib import Path; Path('report.xml').write_text('<testsuite><testcase/><testcase><failure/></testcase><testcase><skipped/></testcase></testsuite>'); raise SystemExit(1)"
        result = subprocess.run(prefix + [sys.executable, "-c", script], capture_output=True)
        self.assertEqual(result.returncode, 1, result.stderr)
        record = registered_artifacts(self.source)[0]
        self.assertEqual(record["tests"], {"tests": 3, "failures": 1, "errors": 0, "skipped": 1})
        result = subprocess.run(prefix + [sys.executable, "-c", "pass"], capture_output=True)
        self.assertEqual(result.returncode, 0)
        records = registered_artifacts(self.source)
        self.assertEqual(len(records), 2, "distinct check executions retain their own evidence")
        self.assertTrue(any(row.get("reportStatus") == "missing_or_stale" and "tests" not in row for row in records))

    def test_projection_rejects_bad_identity_and_counts_and_binds_cycle(self):
        report = self.project / "report.xml"
        report.write_text("evidence")
        check = base_record("projects/probe", "check")
        check.update(cycleId="cycle-bound", path="projects/probe/report.xml", sha256=fingerprint(report),
                     state="completed", startedAt="2026-09-19T01:00:00+00:00",
                     endedAt="2026-09-19T01:00:01+00:00", exitCode=0, reportStatus="fresh",
                     tests={"tests": 1, "failures": 1, "errors": 1, "skipped": 0})
        save(self.root, check)
        folder = self.root / "logs/artifacts"
        (folder / "bad.json").write_text("{not-json")
        projection = artifact_projection(self.source)
        self.assertEqual(projection["status"], "partial")
        self.assertEqual(projection["invalidRecords"], 1)
        self.assertEqual(projection["items"][0]["associationStatus"], "bound")
        self.assertEqual(projection["items"][0]["evidenceStatus"], "invalid")
        self.assertEqual(projection["items"][0]["countsStatus"], "invalid")
        self.assertNotIn("tests", projection["items"][0])

    def test_projection_reports_output_limit_instead_of_silently_dropping_history(self):
        folder = self.root / "logs/artifacts"
        folder.mkdir(parents=True)
        for number in range(101):
            value = {"version": 1, "id": f"{number:032x}", "project": "projects/probe",
                     "kind": "check", "cycleId": f"cycle-{number}",
                     "recordedAt": "2026-09-19T01:00:00+00:00", "source": "runner",
                     "state": "completed", "exitCode": 0, "reportStatus": "unavailable"}
            (folder / f"{number:032x}.json").write_text(json.dumps(value))
        projection = artifact_projection(self.source)
        self.assertEqual(projection["scannedRecords"], 101)
        self.assertEqual(projection["returnedRecords"], 100)
        self.assertTrue(projection["truncated"])
        self.assertEqual(projection["status"], "partial")

    def test_file_limit_selects_newest_record_beyond_directory_prefix(self):
        folder = self.root / "logs/artifacts"
        folder.mkdir(parents=True)
        for number in range(500):
            path = folder / f"{number:032x}.json"
            path.write_text(json.dumps({
                "version": 1, "id": f"{number:032x}", "project": "projects/other",
                "kind": "check", "cycleId": f"old-{number}",
                "recordedAt": "2026-09-19T01:00:00+00:00", "source": "runner",
                "state": "completed", "exitCode": 0, "reportStatus": "unavailable"}))
            os.utime(path, (1700000000, 1700000000))
        newest_id = "f" * 32
        newest = folder / f"{newest_id}.json"
        newest.write_text(json.dumps({
            "version": 1, "id": newest_id, "project": "projects/probe",
            "kind": "check", "cycleId": "cycle-newest",
            "recordedAt": "2027-09-19T01:00:00+00:00", "source": "runner",
            "state": "completed", "exitCode": 0, "reportStatus": "unavailable"}))
        os.utime(newest, (1800000000, 1800000000))
        projection = artifact_projection(self.source)
        self.assertEqual(projection["scannedRecords"], 501)
        self.assertTrue(projection["truncated"])
        self.assertEqual([item["id"] for item in projection["items"]], [newest_id])

    def test_preview_identity_rejects_other_server_and_remote_url(self):
        class Handler(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                self.send_response(204)
                self.send_header("X-Auto-Company-Preview", "a" * 32)
                self.end_headers()
            def log_message(self, *args):
                pass
        server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            record = {"state": "running", "url": f"http://127.0.0.1:{server.server_port}/", "token": "a" * 32}
            self.assertTrue(preview_available(record))
            record["token"] = "b" * 32
            self.assertFalse(preview_available(record))
            record["url"] = "http://example.com/"
            self.assertFalse(preview_available(record))
        finally:
            server.shutdown()
            server.server_close()
            thread.join()

    def test_preview_runner_lifecycle(self):
        command = [sys.executable, str(ROOT / "scripts/core/runtime_artifacts.py"), "--root", str(self.root), "--project", "projects/probe", "preview"]
        process = subprocess.Popen(command, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
        try:
            deadline = time.monotonic() + 5
            while time.monotonic() < deadline:
                records = registered_artifacts(self.source)
                if records and records[0]["available"]:
                    break
                time.sleep(0.05)
            self.assertTrue(records and records[0]["available"])
        finally:
            process.terminate()
            process.wait(timeout=5)
            process.stderr.close()
        self.assertFalse(registered_artifacts(self.source)[0]["available"])

    @unittest.skipUnless(sys.platform == 'linux', 'Event execution uses real Linux/WSL isolation')
    def test_stream_passthrough_exit_and_unknown_events(self):
        script = "import sys; print('{\"type\":\"future.event\"}'); print('{\"type\":\"turn.failed\"}'); raise SystemExit(7)"
        import shutil
        shutil.copytree(ROOT / 'scripts/core', self.root / 'scripts/core')
        result = subprocess.run([sys.executable, str(ROOT / 'scripts/core/project_isolation.py'),
                                 '--workspace', str(self.root), '--', '/usr/bin/python3',
                                 '/workspace/scripts/core/runtime_events.py', '--root', '/workspace',
                                 '--cycle', 'cycle-exit', '--', '/usr/bin/python3', '-c', script], capture_output=True)
        self.assertEqual(result.returncode, 7, result.stderr)
        self.assertIn(b'future.event', result.stdout)
        events = cycle_events(self.source, {"id": "cycle-exit"})["events"]
        self.assertEqual([event["kind"] for event in events], ["process.started", "turn.failed", "process.exited"])
        self.assertEqual(events[-1]["exitCode"], 7)

    def test_rotation_removes_paired_events_only(self):
        import importlib.util
        spec = importlib.util.spec_from_file_location("event_rotation", ROOT / "scripts/core/rotate-logs.py")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        logs = self.root / "logs"
        logs.mkdir()
        for suffix in (".log", ".json", ".events.jsonl"):
            (logs / ("cycle-old" + suffix)).write_text("data")
        (logs / "usage.jsonl").write_text("retained")
        self.assertEqual(module.rotate(logs, 0), 1)
        self.assertEqual([path.name for path in logs.iterdir()], ["usage.jsonl"])


if __name__ == "__main__":
    unittest.main()
