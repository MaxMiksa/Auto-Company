"""Real Bash loop lifecycle with a local fake engine; no service or model calls."""

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


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tests'))
from isolation_fixture import install as install_fixture_boundary


@unittest.skipUnless(platform.system() == "Linux", "Linux process lifecycle regression")
class LoopLifecycleTests(unittest.TestCase):
    def test_unconfirmed_cleanup_retains_lock_until_children_exit(self) -> None:
        import fcntl
        with tempfile.TemporaryDirectory() as tempdir:
            root = Path(tempdir)
            lock_file = root / ".auto-loop.pid"
            result_file = root / "result"
            release_file = root / "allow-kill"
            descriptor = os.open(lock_file, os.O_RDWR | os.O_CREAT, 0o600)
            fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
            code = """
import importlib.util
from pathlib import Path
import sys
helper = sys.argv.pop(1)
release = Path(sys.argv.pop(1))
spec = importlib.util.spec_from_file_location("supervisor", helper)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
original = module.send_owned
def delayed_signal(pid, identity, sig):
    if release.exists():
        original(pid, identity, sig)
module.send_owned = delayed_signal
raise SystemExit(module.main())
"""
            owner = subprocess.Popen([
                "python3", "-c", code, str(ROOT / "scripts/core/process-supervisor-linux.py"),
                str(release_file), str(result_file), "0", "0", "0", str(os.getpid()),
                str(root), "sleep", "30"
            ], pass_fds=(descriptor,))
            os.close(descriptor)
            try:
                deadline = time.monotonic() + 5
                while not result_file.exists():
                    self.assertLess(time.monotonic(), deadline)
                    time.sleep(0.025)
                self.assertEqual(result_file.read_text().split()[2], "1")
                self.assertIsNone(owner.poll())
                with lock_file.open("r+") as probe:
                    with self.assertRaises(BlockingIOError):
                        fcntl.flock(probe, fcntl.LOCK_EX | fcntl.LOCK_NB)
                release_file.touch()
                self.assertEqual(owner.wait(timeout=5), 1)
                with lock_file.open("r+") as probe:
                    fcntl.flock(probe, fcntl.LOCK_EX | fcntl.LOCK_NB)
            finally:
                release_file.touch()
                owner.wait(timeout=5)

    def test_concurrent_instance_and_term_during_long_budget_wait(self) -> None:
        with tempfile.TemporaryDirectory() as tempdir:
            root = Path(tempdir)
            shutil.copytree(ROOT / "scripts" / "core", root / "scripts" / "core")
            install_fixture_boundary(root)
            shutil.copytree(ROOT / "memories", root / "memories")
            (root / "PROMPT.md").write_text("Local lifecycle test\n")
            fake = root / "fake-engine"
            fake.write_text('#!/bin/bash\nif [ "${1:-}" = --version ]; then exit 0; fi\n'
                            'printf \'{"result":"local test","usage":{"input_tokens":2,"output_tokens":2}}\\n\'\n')
            fake.chmod(0o755)
            env = dict(os.environ, ENGINE="claude", CLAUDE_BIN=str(fake),
                       CLAUDE_PERMISSION_MODE="default", USAGE_HARD_LIMIT_TOKENS="1",
                       BUDGET_PAUSE_POLL_SECONDS="3600", LOOP_INTERVAL="3600",
                       CYCLE_TIMEOUT_SECONDS="10", CYCLE_TERM_GRACE_SECONDS="1",
                       CYCLE_KILL_WAIT_SECONDS="1")
            output = root / "loop.out"
            with output.open("w") as stream:
                loop = subprocess.Popen(["bash", str(root / "scripts/core/auto-loop.sh")],
                                        env=env, stdout=stream, stderr=stream)
                try:
                    deadline = time.monotonic() + 15
                    while not (root / ".auto-loop-budget-paused").exists():
                        if loop.poll() is not None or time.monotonic() > deadline:
                            self.fail(output.read_text() + "\n" + str(list(root.glob("logs/*"))))
                        time.sleep(0.05)
                    second = subprocess.run(["bash", str(root / "scripts/core/auto-loop.sh")],
                                            env=env, capture_output=True, text=True, timeout=5)
                    self.assertNotEqual(second.returncode, 0)
                    self.assertIn("already running", second.stderr)
                    self.assertEqual((root / ".auto-loop.pid").read_text().strip(), str(loop.pid))
                    time.sleep(0.15)
                    started = time.monotonic()
                    stopped = subprocess.run(["bash", str(root / "scripts/core/stop-loop.sh")],
                                             env=env, capture_output=True, text=True, timeout=5)
                    self.assertEqual(stopped.returncode, 0, stopped.stderr)
                    self.assertEqual(loop.wait(timeout=3), 0)
                    self.assertLess(time.monotonic() - started, 3)
                    self.assertEqual((root / ".auto-loop.pid").read_text(), "")
                finally:
                    if loop.poll() is None:
                        loop.send_signal(signal.SIGTERM)
                        loop.wait(timeout=5)

    def test_stale_pid_never_signals_unrelated_process(self) -> None:
        with tempfile.TemporaryDirectory() as tempdir:
            pid_file = Path(tempdir) / ".auto-loop.pid"
            sentinel = subprocess.Popen(["sleep", "20"])
            try:
                pid_file.write_text(str(sentinel.pid))
                result = subprocess.run(["python3", str(ROOT / "scripts/core/loop-lock.py"),
                                         "--stop", str(pid_file), str(ROOT / "scripts/core/auto-loop.sh")],
                                        capture_output=True, text=True, timeout=5)
                self.assertEqual(result.returncode, 0)
                self.assertIsNone(sentinel.poll())
                import fcntl
                with pid_file.open("w") as locked:
                    locked.write(str(sentinel.pid))
                    locked.flush()
                    fcntl.flock(locked, fcntl.LOCK_EX | fcntl.LOCK_NB)
                    result = subprocess.run(["python3", str(ROOT / "scripts/core/loop-lock.py"),
                                             "--stop", str(pid_file), str(ROOT / "scripts/core/auto-loop.sh")],
                                            capture_output=True, text=True, timeout=5)
                    self.assertEqual(result.returncode, 1)
                    self.assertIn("refusing to signal", result.stderr)
                    self.assertIsNone(sentinel.poll())
            finally:
                sentinel.terminate()
                sentinel.wait(timeout=3)


if __name__ == "__main__":
    unittest.main()
