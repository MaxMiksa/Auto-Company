"""Targeted stop ownership and interruption checks; no model or user service."""

import importlib.util
import json
import os
from pathlib import Path
import platform
import shutil
import signal
import subprocess
import sys
import tempfile
import time
import unittest
from unittest import mock


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tests'))
from isolation_fixture import install as install_fixture_boundary


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def until(predicate, timeout=10):
    deadline = time.monotonic() + timeout
    while not predicate():
        if time.monotonic() > deadline:
            raise AssertionError("Timed out waiting for test process")
        time.sleep(0.05)


@unittest.skipUnless(platform.system() == "Linux", "Linux ownership and process regression")
class LinuxStopTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        helper = self.root / "scripts/wsl/anchor.py"
        helper.parent.mkdir(parents=True)
        shutil.copyfile(ROOT / "scripts/wsl/anchor.py", helper)
        self.anchor = load("test_anchor", helper)
        self.processes = []

    def tearDown(self):
        for child in self.processes:
            if child.poll() is None:
                child.kill()
            child.wait(timeout=5)
        self.temp.cleanup()

    def start_anchor(self):
        child = subprocess.Popen(["python3", str(self.root / "scripts/wsl/anchor.py"), "run", "test-token"])
        self.processes.append(child)
        until(lambda: self.anchor.STATE.exists() and self.anchor.STATE.stat().st_size)
        until(lambda: self.anchor.owned() is not None)
        return child

    def test_keeper_exits_and_repeated_stop_preserves_unrelated_process(self):
        sentinel = subprocess.Popen(["sleep", "120"])
        self.processes.append(sentinel)
        child = self.start_anchor()
        self.anchor.stop()
        self.assertEqual(child.wait(timeout=3), 0)
        self.anchor.stop()
        self.assertIsNone(sentinel.poll())
        self.assertIsNone(self.anchor.owned())

    def test_stale_pid_record_never_signals_unrelated_process(self):
        sentinel = subprocess.Popen(["sleep", "120"])
        self.processes.append(sentinel)
        self.anchor.STATE.write_text(json.dumps(dict(self.anchor.identity(sentinel.pid), token="old")))
        self.anchor.stop()
        self.assertIsNone(sentinel.poll())

    def test_locked_wrong_generation_is_reported_without_signalling(self):
        import fcntl
        sentinel = subprocess.Popen(["sleep", "120"])
        self.processes.append(sentinel)
        with self.anchor.STATE.open("w+") as state:
            fcntl.flock(state, fcntl.LOCK_EX)
            json.dump(dict(self.anchor.identity(sentinel.pid), start="wrong", token="old"), state)
            state.flush()
            with self.assertRaisesRegex(RuntimeError, "ownership"):
                self.anchor.stop()
        self.assertIsNone(sentinel.poll())

    def test_frozen_owned_keeper_is_killed_with_bounded_wait(self):
        child = self.start_anchor()
        os.kill(child.pid, signal.SIGSTOP)
        started = time.monotonic()
        self.anchor.stop()
        self.assertLess(time.monotonic() - started, 7)
        self.assertEqual(child.wait(timeout=3), -signal.SIGKILL)

    def test_failed_signal_is_not_reported_as_stopped(self):
        child = self.start_anchor()
        os.kill(child.pid, signal.SIGSTOP)
        with mock.patch.object(self.anchor.signal, "pidfd_send_signal", side_effect=PermissionError("denied")):
            with self.assertRaises(PermissionError):
                self.anchor.stop()
        self.assertIsNotNone(self.anchor.owned())

    def test_interrupted_cycle_preserves_output_usage_and_saved_work(self):
        for reported in (True, False):
            with self.subTest(reported=reported), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                shutil.copytree(ROOT / "scripts/core", root / "scripts/core")
                install_fixture_boundary(root)
                (root / "memories").mkdir()
                shutil.copyfile(ROOT / "memories/consensus.template.md", root / "memories/consensus.template.md")
                (root / "PROMPT.md").write_text("Local stop fixture\n")
                fake = root / "fake-engine"
                result = {"type": "result", "result": "saved fixture evidence"}
                if reported:
                    result["usage"] = {"input_tokens": 7, "output_tokens": 3}
                fake.write_text("#!/usr/bin/env python3\nimport subprocess,sys,time\nfrom pathlib import Path\n"
                                "if '--version' in sys.argv: raise SystemExit(0)\n"
                                "Path('kept-result.txt').write_text('saved work')\n"
                                f"print({json.dumps(result)!r}, flush=True)\n"
                                "child=subprocess.Popen(['sleep','120'],start_new_session=True)\n"
                                "Path('child.pid').write_text(str(child.pid))\n"
                                "while True: time.sleep(1)\n")
                fake.chmod(0o755)
                env = dict(os.environ, ENGINE="claude", CLAUDE_BIN=str(fake),
                           CLAUDE_PERMISSION_MODE="default", LOOP_INTERVAL="3600",
                           CYCLE_TIMEOUT_SECONDS="120", CYCLE_TERM_GRACE_SECONDS="1",
                           CYCLE_KILL_WAIT_SECONDS="2")
                with (root / "loop.out").open("w") as output:
                    loop = subprocess.Popen(["bash", str(root / "scripts/core/auto-loop.sh")],
                                            env=env, stdout=output, stderr=output)
                    try:
                        try:
                            until(lambda: (root / "child.pid").exists(), 15)
                        except AssertionError:
                            self.fail((root / "loop.out").read_text())
                        child_pid = int((root / "child.pid").read_text())
                        stopped = subprocess.run(["bash", str(root / "scripts/core/stop-loop.sh")],
                                                 capture_output=True, text=True, timeout=15)
                        self.assertEqual(stopped.returncode, 0, stopped.stderr)
                        self.assertEqual(loop.wait(timeout=5), 0, (root / "loop.out").read_text())
                        self.assertFalse(Path(f"/proc/{child_pid}").exists())
                        records = [json.loads(line) for line in (root / "logs/usage.jsonl").read_text().splitlines()]
                        self.assertEqual(len(records), 1)
                        self.assertEqual(records[0]["status"], "interrupted")
                        self.assertEqual(records[0]["usage"]["total_tokens"], 10 if reported else None)
                        self.assertIn("saved fixture evidence", next((root / "logs").glob("cycle-*.log")).read_text())
                        self.assertEqual((root / "kept-result.txt").read_text(), "saved work")
                        self.assertFalse((root / "logs/usage.jsonl.pending").exists())
                    finally:
                        if loop.poll() is None:
                            loop.terminate()
                            loop.wait(timeout=10)


class DashboardStopTests(unittest.TestCase):
    def test_concurrent_action_rejected_and_failed_stop_retries(self):
        server = load("stop_server", ROOT / "dashboard/server.py")
        handler = server.DashboardHandler.__new__(server.DashboardHandler)
        handler.path = "/api/action/stop"
        handler.headers = {"Content-Type": "application/json"}
        handler._request_allowed = lambda: True
        handler._json = mock.Mock()
        success = {"ok": True, "exitCode": 0, "elapsedMs": 1, "output": ""}
        with tempfile.TemporaryDirectory() as directory, mock.patch.object(server, "REPO_ROOT", Path(directory)):
            with server.CONTROL_LOCK, mock.patch.object(server, "run_dashboard_action") as run:
                handler.do_POST()
                run.assert_not_called()
                self.assertEqual(handler._json.call_args.kwargs["code"], 409)
            with mock.patch.object(server, "run_dashboard_action", return_value=dict(success, ok=False, exitCode=1)):
                handler.do_POST()
            self.assertTrue((Path(directory) / ".auto-loop-stop-pending").exists())
            handler.path = "/api/action/start"
            with mock.patch.object(server, "run_dashboard_action") as run:
                handler.do_POST()
                run.assert_not_called()
            handler.path = "/api/action/stop"
            with mock.patch.object(server, "run_dashboard_action", return_value=success):
                handler.do_POST()
            self.assertFalse((Path(directory) / ".auto-loop-stop-pending").exists())


if __name__ == "__main__":
    unittest.main()
