"""Real POSIX loop/creation/stop integration with a local fake provider only."""
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

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tests'))
from isolation_fixture import install as install_fixture_boundary


@unittest.skipUnless(platform.system() == "Linux", "POSIX loop exercised under Linux/WSL")
class ProductCycleLoopTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        shutil.copytree(ROOT / "scripts/core", self.root / "scripts/core")
        install_fixture_boundary(self.root)
        shutil.copytree(ROOT / "i18n", self.root / "i18n")
        shutil.copytree(ROOT / "memories", self.root / "memories")
        shutil.copy2(ROOT / ".gitignore", self.root / ".gitignore")
        (self.root / "PROMPT.md").write_text("Offline integration fixture.\n")
        subprocess.run(["git", "init", "--initial-branch=main", str(self.root)], check=True, capture_output=True)
        self.fake = self.root / "fake-engine"
        self.fake.write_text('''#!/bin/bash
if [ "${1:-}" = "--version" ]; then exit 0; fi
count=0
[ ! -f "$AUTO_COMPANY_ROOT/invocations" ] || count=$(cat "$AUTO_COMPANY_ROOT/invocations")
count=$((count + 1))
printf '%s' "$count" > "$AUTO_COMPANY_ROOT/invocations"
printf '%s\\n' "$*" > "$AUTO_COMPANY_ROOT/prompt-$count"
if [ "${CREATE_PRODUCT:-0}" = 1 ] && [ "$count" = 1 ]; then
  "$AUTO_COMPANY_ROOT/scripts/core/project.sh" new --name created-product
fi
printf '{"type":"result","subtype":"success","result":"Recorded offline invocation","usage":{"input_tokens":2,"output_tokens":2}}\\n'
if [ "${INTERRUPT_FIXTURE:-0}" = 1 ]; then
  touch "$AUTO_COMPANY_ROOT/provider-running"
  sleep 30
fi
if [ "$count" -ge "${STOP_AFTER:-1}" ]; then touch "$AUTO_COMPANY_ROOT/.auto-loop-stop"; fi
''')
        self.fake.chmod(0o755)
        self.env = dict(os.environ, ENGINE="claude", CLAUDE_BIN=str(self.fake),
                        CLAUDE_PERMISSION_MODE="default", AUTO_COMPANY_LANGUAGE="en",
                        LOOP_INTERVAL="0", CYCLE_TIMEOUT_SECONDS="15", CYCLE_TERM_GRACE_SECONDS="1",
                        CYCLE_KILL_WAIT_SECONDS="1", MAX_LOGS="1")
        for key in ("AUTO_COMPANY_CYCLE", "AUTO_COMPANY_CYCLE_ID", "AUTO_COMPANY_LOCK_PID", "ACTIVE_PROJECT"):
            self.env.pop(key, None)
        self.loop = self.root / "scripts/core/auto-loop.sh"

    def run_loop(self, **environment):
        result = subprocess.run(["bash", str(self.loop)], env={**self.env, **environment}, capture_output=True, text=True, timeout=45)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        return self.state()

    def state(self):
        return json.loads((self.root / ".auto-company/product-state.json").read_text())

    def create_selected(self):
        tool = self.root / "scripts/core/project.sh"
        for args in (("new", "--name", "test-product"), ("select", "--project", "test-product", "--confirm", "SELECT")):
            result = subprocess.run(["bash", str(tool), *args], env={**self.env, "AUTO_COMPANY_ROOT": str(self.root)}, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_real_loop_resumes_1_2_then_3_and_rotates_logs(self):
        self.create_selected()
        self.run_loop(STOP_AFTER="2")
        state = self.run_loop(STOP_AFTER="3", MODEL="changed-model")
        rows = list(state["cycles"].values())
        self.assertEqual(sorted(row["productCycleNumber"] for row in rows), [1, 2, 3])
        self.assertEqual(sorted(row["runCycleNumber"] for row in rows), [1, 1, 2])
        self.assertEqual({row["state"] for row in rows}, {"completed"})
        self.assertEqual(len({row["identityId"] for row in rows}), 1)
        self.assertLess(len(list((self.root / "logs").glob("cycle-*.log"))), 3)
        self.assertIn("product cycle #3 (process-local attempt #1)", (self.root / "prompt-3").read_text())

    def test_failed_preflight_allocates_no_cycle(self):
        result = subprocess.run(["bash", str(self.loop)], env={**self.env, "USAGE_HARD_LIMIT_TOKENS": "invalid"}, capture_output=True, text=True, timeout=20)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("usage budget preflight failed", result.stdout)
        self.assertFalse((self.root / ".auto-company/product-state.json").exists())
        self.assertFalse((self.root / "invocations").exists())

    def test_creation_registration_failure_rolls_back_source_and_registry(self):
        (self.root / "projects").mkdir()
        registry = self.root / "projects/registry.tsv"
        original = b"name\tpath\tlifecycle\tcreated_at_utc\n"
        registry.write_bytes(original)
        (self.root / ".auto-company").mkdir()
        (self.root / ".auto-company/product-state.json").write_text("invalid state")
        result = subprocess.run(["bash", str(self.root / "scripts/core/project.sh"), "new", "--name", "failed-project"],
                                env={**self.env, "AUTO_COMPANY_ROOT": str(self.root)}, capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse((self.root / "projects/failed-project").exists())
        self.assertEqual(registry.read_bytes(), original)

    def test_normal_creation_links_exploration_without_editing_selection(self):
        self.run_loop(STOP_AFTER="1", CREATE_PRODUCT="1")
        self.assertNotIn("ACTIVE_PROJECT=", (self.root / ".auto-company.local").read_text())
        state = self.run_loop(STOP_AFTER="2")
        rows = list(state["cycles"].values())
        self.assertEqual(sorted(row["productCycleNumber"] for row in rows), [1, 1])
        product_id = state["continuationProductId"]
        self.assertEqual(state["identities"][product_id]["project"], "projects/created-product")
        prompt = (self.root / "prompt-2").read_text()
        self.assertIn("projects/created-product", prompt)
        self.assertIn("registered exploration continuation", prompt)
        self.assertIn("product cycle #1", prompt)

    def test_stop_records_interruption_and_restart_does_not_reuse_number(self):
        self.create_selected()
        output = self.root / "loop.out"
        with output.open("w") as stream:
            loop = subprocess.Popen(["bash", str(self.loop)], env={**self.env, "INTERRUPT_FIXTURE": "1"}, stdout=stream, stderr=stream)
            try:
                deadline = time.monotonic() + 20
                while not (self.root / "provider-running").exists():
                    if loop.poll() is not None or time.monotonic() > deadline:
                        self.fail(output.read_text())
                    time.sleep(0.05)
                loop.send_signal(signal.SIGTERM)
                self.assertEqual(loop.wait(timeout=10), 0, output.read_text())
            finally:
                if loop.poll() is None:
                    loop.terminate()
                    loop.wait(timeout=10)
        self.assertEqual(next(iter(self.state()["cycles"].values()))["state"], "interrupted")
        pause = self.root / ".auto-loop-paused"
        self.assertIn("interrupted_cycle", pause.read_text())
        # Preserve the existing human review/resume gate after interruption.
        pause.unlink()
        state = self.run_loop(STOP_AFTER="2")
        self.assertEqual(sorted(row["productCycleNumber"] for row in state["cycles"].values()), [1, 2])
        self.assertEqual({row["state"] for row in state["cycles"].values()}, {"interrupted", "completed"})

    def slow_capture_stop(self, flag_only):
        self.create_selected()
        project = self.root / "projects/test-product"
        (project / "index.html").write_text("<main>Offline media stop fixture</main>")
        # Exercise the actual Python media supervisor and loop cancellation with
        # a harmless long-lived renderer subtree; no browser or model is needed.
        (self.root / "scripts/core/product_media_worker.cjs").write_text('''
const fs = require("node:fs"), path = require("node:path"), {spawn} = require("node:child_process");
const request = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const child = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], {stdio:"ignore"});
fs.appendFileSync(path.join(request.project,".review-captures"), "capture\\n");
fs.writeFileSync(path.join(request.project,".review-processes"), JSON.stringify([process.pid, child.pid]));
setInterval(()=>{},1000);
''')
        output = self.root / "slow-capture.out"
        with output.open("w") as stream:
            process = subprocess.Popen(["bash", str(self.loop)], env={**self.env, "STOP_AFTER": "100", "LOOP_INTERVAL": "1"}, stdout=stream, stderr=stream)
            try:
                deadline = time.monotonic() + 20
                marker = project / ".review-processes"
                while not marker.exists():
                    if process.poll() is not None or time.monotonic() > deadline:
                        self.fail(output.read_text())
                    time.sleep(0.05)
                pids = json.loads(marker.read_text())
                self.assertEqual(next(iter(self.state()["cycles"].values()))["state"], "completed")
                started = time.monotonic()
                if flag_only:
                    (self.root / ".auto-loop-stop").touch()
                else:
                    stopped = subprocess.run(["bash", str(self.root / "scripts/core/stop-loop.sh"), "--wait"],
                                             capture_output=True, text=True, timeout=20)
                    self.assertEqual(stopped.returncode, 0, stopped.stdout + stopped.stderr)
                self.assertEqual(process.wait(timeout=15), 0, output.read_text())
                self.assertLess(time.monotonic() - started, 15)
                self.assertEqual((project / ".review-captures").read_text(), "capture\n")
                self.assertEqual((self.root / "invocations").read_text(), "1")
                self.assertEqual(next(iter(self.state()["cycles"].values()))["state"], "completed")
                usage = [json.loads(line) for line in (self.root / "logs/usage.jsonl").read_text().splitlines()]
                self.assertEqual([row["status"] for row in usage], ["completed"])
                manifests = list((self.root / "logs/product-media").glob("*/media.json"))
                self.assertEqual(len(manifests), 1)
                attempt = json.loads(manifests[0].read_text())["attempt"]
                self.assertEqual(attempt["state"], "interrupted")
                for pid in pids:
                    status = Path(f"/proc/{pid}/stat")
                    self.assertTrue(not status.exists() or status.read_text().split()[2] == "Z", f"media process {pid} survived")
                self.assertFalse((self.root / ".auto-loop-paused").exists())
            finally:
                if process.poll() is None:
                    process.terminate()
                    process.wait(timeout=15)

    @unittest.skipUnless(shutil.which("node"), "Node runtime is required for the harmless renderer subtree")
    def test_signal_during_slow_capture_cleans_scope_without_changing_completed_cycle(self):
        self.slow_capture_stop(flag_only=False)

    @unittest.skipUnless(shutil.which("node"), "Node runtime is required for the harmless renderer subtree")
    def test_stop_flag_during_slow_capture_cancels_without_starting_another_capture(self):
        self.slow_capture_stop(flag_only=True)


if __name__ == "__main__":
    unittest.main()
