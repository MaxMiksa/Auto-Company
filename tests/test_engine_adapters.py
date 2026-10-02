import functools
import importlib.util
import json
import os
import shutil
import stat
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from unittest import mock
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any


REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / 'tests'))
from isolation_fixture import install as install_fixture_boundary
ADAPTER_PATH = REPO_ROOT / "scripts" / "core" / "engine-adapters.sh"
OPENAI_AGENT_PATH = REPO_ROOT / "scripts" / "core" / "openai-compatible-agent.py"


def wsl_bash_contract(test_method: Any) -> Any:
    """Run Bash/PGID contracts inside WSL when unittest starts on Windows.

    Windows ``bash.exe`` is a WSL launcher, but Windows paths and a custom
    ``subprocess`` environment are not translated into the Linux process.
    Dispatching the same named test to WSL Python keeps the fake CLI, HTTP
    server, workspace, and adapter in one explicit Linux execution boundary.
    """

    @functools.wraps(test_method)
    def wrapper(self: "EngineAdapterTests") -> None:
        if os.name != "nt":
            test_method(self)
            return

        try:
            converted = subprocess.run(
                ["wsl.exe", "wslpath", "-a", "-u", REPO_ROOT.as_posix()],
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                check=True,
            )
        except (OSError, subprocess.CalledProcessError) as exc:
            self.fail(f"WSL path conversion failed: {exc}")
        wsl_repo_root = converted.stdout.strip()
        if not wsl_repo_root.startswith("/"):
            self.fail(f"WSL path conversion returned an invalid path: {wsl_repo_root!r}")

        test_name = (
            "tests.test_engine_adapters.EngineAdapterTests."
            f"{test_method.__name__}"
        )
        try:
            completed = subprocess.run(
                [
                    "wsl.exe",
                    "--cd",
                    wsl_repo_root,
                    "python3",
                    "-m",
                    "unittest",
                    "-v",
                    test_name,
                ],
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                check=False,
            )
        except OSError as exc:
            self.fail(f"WSL test runner could not start: {exc}")
        if completed.returncode != 0:
            self.fail(
                f"WSL Bash contract failed ({test_name})\n"
                f"stdout:\n{completed.stdout}\n"
                f"stderr:\n{completed.stderr}"
            )

    return wrapper


class FakeOpenAIServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, responses: list[dict[str, Any]]) -> None:
        super().__init__(("127.0.0.1", 0), FakeOpenAIHandler)
        self.responses = responses
        self.requests: list[dict[str, Any]] = []
        self.lock = threading.Lock()


class FakeOpenAIHandler(BaseHTTPRequestHandler):
    server: FakeOpenAIServer

    def do_POST(self) -> None:  # noqa: N802 - stdlib handler API
        length = int(self.headers.get("Content-Length", "0"))
        body = self.rfile.read(length)
        with self.server.lock:
            self.server.requests.append(
                {
                    "path": self.path,
                    "headers": dict(self.headers),
                    "body": json.loads(body),
                }
            )
            response = self.server.responses.pop(0)
        delay = float(response.get("delay", 0))
        if delay:
            time.sleep(delay)
        payload = response.get("body", {})
        encoded = (
            payload.encode("utf-8")
            if isinstance(payload, str)
            else json.dumps(payload).encode("utf-8")
        )
        self.send_response(int(response.get("status", 200)))
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(encoded)))
        for name, value in response.get("headers", {}).items():
            self.send_header(name, value)
        self.end_headers()
        try:
            self.wfile.write(encoded)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def log_message(self, _format: str, *_args: object) -> None:
        return


class RunningFakeServer:
    def __init__(self, responses: list[dict[str, Any]]) -> None:
        self.server = FakeOpenAIServer(responses)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)

    def __enter__(self) -> FakeOpenAIServer:
        self.thread.start()
        return self.server

    def __exit__(self, *_args: object) -> None:
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)


class EngineAdapterTests(unittest.TestCase):
    maxDiff = None

    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        # Registered first, so later process cleanups run before fixture removal.
        self.addCleanup(self.temp_dir.cleanup)
        self.workspace = Path(self.temp_dir.name) / "workspace"
        self.workspace.mkdir()
        shutil.copytree(REPO_ROOT / 'scripts/core', self.workspace / 'scripts/core')
        install_fixture_boundary(self.workspace)
        self.record = Path(self.temp_dir.name) / "record.json"

    def make_cli(self, body: str) -> Path:
        path = Path(self.temp_dir.name) / "fake-cli"
        path.write_text("#!/bin/bash\nset -euo pipefail\n" + body, encoding="utf-8")
        path.chmod(path.stat().st_mode | stat.S_IXUSR)
        return path

    def base_env(self, engine: str, **overrides: str) -> dict[str, str]:
        env = os.environ.copy()
        env.update(
            {
                "ADAPTER_PATH": str(self.workspace / 'scripts/core/engine-adapters.sh'),
                "PROJECT_DIR": str(self.workspace),
                "TEST_RECORD": str(self.record),
                "ENGINE": engine,
                "MODEL": "test-model",
                "MODEL_LABEL": "test-model",
                "CLAUDE_PERMISSION_MODE": "bypassPermissions",
                "CODEX_SANDBOX_MODE": "danger-full-access",
                "OPENAI_COMPATIBLE_ALLOW_INSECURE_HTTP": "0",
                "CYCLE_TIMEOUT_SECONDS": "5",
                "ADAPTER_TIMEOUT_GRACE_SECONDS": "0",
            }
        )
        env.update(overrides)
        return env

    def validate_adapter(
        self, engine: str, **overrides: str
    ) -> subprocess.CompletedProcess[str]:
        script = 'set -euo pipefail; source "$ADAPTER_PATH"; engine_adapter_validate'
        return subprocess.run(
            ["bash", "-lc", script],
            cwd=REPO_ROOT,
            env=self.base_env(engine, **overrides),
            capture_output=True,
            text=True,
            check=False,
        )

    def run_adapter(
        self, engine: str, *, outcome: str = "success", check: bool = True, **overrides: str
    ) -> subprocess.CompletedProcess[str]:
        script = r'''
set -euo pipefail
source "$ADAPTER_PATH"
engine_adapter_validate
RESOLVED_ENGINE_BIN="$(engine_adapter_resolve)"
engine_adapter_run "contract prompt"
engine_adapter_extract_metadata
engine_adapter_write_record "$TEST_RECORD" "$TEST_OUTCOME" ""
printf '%s\n' "$ADAPTER_OUTPUT"
'''
        env = self.base_env(engine, TEST_OUTCOME=outcome, **overrides)
        return subprocess.run(
            ["bash", "-lc", script],
            cwd=REPO_ROOT,
            env=env,
            capture_output=True,
            text=True,
            check=check,
        )

    def read_record(self) -> dict[str, Any]:
        return json.loads(self.record.read_text(encoding="utf-8"))

    def load_openai_agent(self) -> Any:
        spec = importlib.util.spec_from_file_location(
            "openai_compatible_agent", OPENAI_AGENT_PATH
        )
        if spec is None or spec.loader is None:
            self.fail("OpenAI-compatible agent module could not be loaded")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module

    def start_fake_loop(self, cli_body: str, **overrides: str) -> subprocess.Popen[str]:
        shutil.copytree(REPO_ROOT / "scripts" / "core", self.workspace / "scripts" / "core", dirs_exist_ok=True)
        install_fixture_boundary(self.workspace)
        (self.workspace / "memories").mkdir()
        shutil.copy2(REPO_ROOT / "memories" / "consensus.template.md", self.workspace / "memories" / "consensus.template.md")
        shutil.copy2(REPO_ROOT / ".gitignore", self.workspace / ".gitignore")
        (self.workspace / "PROMPT.md").write_text("Complete one fake cycle.\n", encoding="utf-8")
        cli = self.make_cli('if [ "${1:-}" = "--version" ]; then echo fake-cli; exit 0; fi\n' + cli_body)
        env = {key: value for key, value in os.environ.items() if not key.startswith("USAGE_")}
        env.update(ENGINE="claude", CLAUDE_BIN=str(cli), CLAUDE_PERMISSION_MODE="default",
                   FAKE_FRAMEWORK=str(self.workspace), LOOP_INTERVAL="0", BUDGET_PAUSE_POLL_SECONDS="0.1",
                   CYCLE_TIMEOUT_SECONDS="20", CYCLE_TERM_GRACE_SECONDS="0", CYCLE_KILL_WAIT_SECONDS="2")
        env.update(overrides)
        process = subprocess.Popen(["bash", str(self.workspace / "scripts" / "core" / "auto-loop.sh")],
                                   env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        self.loop_diagnostics_dir: Path | None = None
        def stop() -> None:
            if process.poll() is None:
                process.terminate()
            try:
                output = process.communicate(timeout=15)
            except subprocess.TimeoutExpired:
                process.kill()
                output = process.communicate(timeout=5)
            if self.loop_diagnostics_dir is not None:
                (self.loop_diagnostics_dir / "stdout.txt").write_text(output[0], encoding="utf-8")
                (self.loop_diagnostics_dir / "stderr.txt").write_text(output[1], encoding="utf-8")
        self.addCleanup(stop)
        return process

    def wait_for_loop(self, predicate: Any, process: subprocess.Popen[str]) -> None:
        deadline = time.monotonic() + 12
        while not predicate():
            if process.poll() is not None:
                self.fail(f"loop exited early: {process.communicate()}")
            if time.monotonic() > deadline:
                destination = REPO_ROOT / "logs" / "test-failures" / f"{self._testMethodName}-{time.time_ns()}"
                shutil.copytree(self.workspace, destination)
                self.loop_diagnostics_dir = destination
                self.fail(f"timed out waiting for fake loop state; preserved diagnostics: {destination}")
            time.sleep(0.05)

    @wsl_bash_contract
    def test_loop_provider_error_exit_zero_is_recorded_as_failure(self) -> None:
        process = self.start_fake_loop(
            'touch "$FAKE_FRAMEWORK/.auto-loop-stop"\n'
            "printf '%s\\n' '{\"is_error\":true,\"subtype\":\"error_during_execution\",\"result\":\"failed\",\"usage\":{\"input_tokens\":2,\"output_tokens\":1}}'\n"
        )
        output = process.communicate(timeout=15)
        self.assertEqual(process.returncode, 0, output)
        ledger = self.workspace / "logs" / "usage.jsonl"
        record = json.loads(ledger.read_text().splitlines()[0])
        self.assertEqual(record["status"], "failed")
        self.assertEqual(record["usage"]["total_tokens"], 3)
        sidecar = json.loads((self.workspace / "logs" / f"{record['cycle_id']}.json").read_text())
        self.assertEqual(sidecar["cycle_outcome"], "failure")
        self.assertIn("Adapter reported error", sidecar["failure_reason"])

    @wsl_bash_contract
    def test_loop_invalid_budget_is_rejected_before_provider_invocation(self) -> None:
        process = self.start_fake_loop('touch "$FAKE_FRAMEWORK/provider-called"\n', USAGE_HARD_LIMIT_USD="not-a-number")
        output = process.communicate(timeout=15)
        self.assertEqual(process.returncode, 78, output)
        self.assertFalse((self.workspace / "provider-called").exists())
        self.assertFalse((self.workspace / "logs" / "usage.jsonl").exists())

    @wsl_bash_contract
    def test_loop_openai_compatible_records_the_configured_model(self) -> None:
        response = {"choices": [{"message": {"role": "assistant", "content": "done"}}], "usage": {"total_tokens": 10}}
        with RunningFakeServer([{"body": response}]) as server:
            process = self.start_fake_loop(
                "exit 9\n", ENGINE="openai-compatible", MODEL="",
                OPENAI_COMPATIBLE_ADAPTER_ENABLED="1",
                OPENAI_COMPATIBLE_ENDPOINT=f"http://127.0.0.1:{server.server_port}/chat",
                OPENAI_COMPATIBLE_MODEL="actual-provider-model", USAGE_HARD_LIMIT_TOKENS="10",
            )
            self.wait_for_loop(lambda: (self.workspace / ".auto-loop-budget-paused").exists(), process)
            record = json.loads((self.workspace / "logs" / "usage.jsonl").read_text().splitlines()[0])
            self.assertEqual(record["model"], "actual-provider-model")
            (self.workspace / ".auto-loop-stop").touch()
            process.communicate(timeout=15)

    @wsl_bash_contract
    def test_loop_hard_budget_closes_cycle_and_resume_repauses_after_one_cycle(self) -> None:
        self.assert_budget_resume_repauses_after_one_cycle()

    @wsl_bash_contract
    def test_loop_budget_resume_accounts_for_cycle_during_clock_rollback(self) -> None:
        commands = Path(self.temp_dir.name) / "commands"
        commands.mkdir()
        date_command = commands / "date"
        count_file = Path(self.temp_dir.name) / "date-count"
        date_command.write_text(
            '#!/bin/bash\nset -euo pipefail\n'
            'if [ "${1:-}" = "+%Y-%m-%dT%H:%M:%S%z" ]; then\n'
            '  count=0\n'
            '  [ ! -f "$FAKE_DATE_COUNT" ] || read -r count < "$FAKE_DATE_COUNT"\n'
            '  count=$((count + 1))\n'
            '  printf "%s\\n" "$count" > "$FAKE_DATE_COUNT"\n'
            '  case "$count" in\n'
            '    1) echo "2026-09-09T22:38:44+0800" ;;\n'
            '    2) echo "2026-09-09T22:38:45+0800" ;;\n'
            '    3) echo "2026-09-09T22:38:50+0800" ;;\n'
            '    *) echo "2026-09-09T22:38:46+0800" ;;\n'
            '  esac\n'
            'else\n'
            '  exec /usr/bin/date "$@"\n'
            'fi\n', encoding="utf-8",
        )
        date_command.chmod(0o700)
        self.assert_budget_resume_repauses_after_one_cycle(
            PATH=str(commands) + os.pathsep + os.environ["PATH"], FAKE_DATE_COUNT=str(count_file),
        )
        records = [json.loads(row) for row in (self.workspace / "logs" / "usage.jsonl").read_text().splitlines()]
        self.assertEqual(records[1]["started_at"], "2026-09-09T22:38:50+0800")
        self.assertEqual(records[1]["ended_at"], "2026-09-09T22:38:46+0800")
        self.assertEqual(records[1]["clock_anomaly"]["wall_clock_delta_seconds"], -4)
        self.assertEqual(records[1]["usage"]["total_tokens"], 100)

    def assert_budget_resume_repauses_after_one_cycle(self, **overrides: str) -> None:
        process = self.start_fake_loop(
            "printf '%s\\n' '{\"result\":\"done\",\"usage\":{\"input_tokens\":70,\"output_tokens\":30}}'\n",
            USAGE_HARD_LIMIT_TOKENS="100", **overrides,
        )
        pause = self.workspace / ".auto-loop-budget-paused"
        ledger = self.workspace / "logs" / "usage.jsonl"
        self.wait_for_loop(pause.exists, process)
        self.assertEqual(len(ledger.read_text().splitlines()), 1)
        subprocess.run(["python3", str(self.workspace / "scripts" / "core" / "usage.py"), "resume", "--pause-file", str(pause)], check=True, capture_output=True)
        self.wait_for_loop(lambda: pause.exists() and len(ledger.read_text().splitlines()) == 2, process)
        time.sleep(0.2)
        self.assertEqual(len(ledger.read_text().splitlines()), 2)
        (self.workspace / ".auto-loop-stop").touch()
        process.communicate(timeout=15)

    @wsl_bash_contract
    def test_loop_signal_interruption_records_unknown_usage(self) -> None:
        process = self.start_fake_loop('touch "$FAKE_FRAMEWORK/provider-called"\nsleep 30\n')
        self.wait_for_loop(lambda: (self.workspace / "provider-called").exists(), process)
        process.terminate()
        output = process.communicate(timeout=15)
        self.assertEqual(process.returncode, 0, output)
        ledger = self.workspace / "logs" / "usage.jsonl"
        record = json.loads(ledger.read_text().splitlines()[0])
        self.assertEqual(record["status"], "interrupted")
        self.assertIsNone(record["usage"]["total_tokens"])
        self.assertIsNone(record["cost_usd"])
        self.assertFalse(ledger.with_name(ledger.name + ".pending").exists())

    @wsl_bash_contract
    def test_claude_accepts_current_cli_permission_modes(self) -> None:
        for mode in (
            "acceptEdits",
            "auto",
            "bypassPermissions",
            "default",
            "dontAsk",
            "plan",
        ):
            with self.subTest(mode=mode):
                completed = self.validate_adapter("claude", CLAUDE_PERMISSION_MODE=mode)
                self.assertEqual(completed.returncode, 0, completed.stderr)

    @wsl_bash_contract
    def test_claude_rejects_invalid_permission_mode_before_execution(self) -> None:
        completed = self.validate_adapter("claude", CLAUDE_PERMISSION_MODE="manual")
        self.assertNotEqual(completed.returncode, 0)
        self.assertIn("CLAUDE_PERMISSION_MODE must be one of", completed.stderr)
        self.assertIn("default", completed.stderr)

    @wsl_bash_contract
    def test_node_cli_resolution_prefers_native_path_over_stale_nvm_fallback(self) -> None:
        test_home = Path(self.temp_dir.name) / "home"
        path_bin = Path(self.temp_dir.name) / "path-bin"
        stale_nvm_bin = test_home / ".nvm" / "versions" / "node" / "v1" / "bin"
        path_bin.mkdir()
        stale_nvm_bin.mkdir(parents=True)
        current_cli = path_bin / "codex"
        stale_cli = stale_nvm_bin / "codex"
        for cli in (current_cli, stale_cli):
            cli.write_text("#!/bin/bash\nexit 0\n", encoding="utf-8")
            cli.chmod(cli.stat().st_mode | stat.S_IXUSR)

        script = 'set -euo pipefail; source "$ADAPTER_PATH"; engine_adapter_resolve'
        completed = subprocess.run(
            ["bash", "-lc", script],
            cwd=REPO_ROOT,
            env=self.base_env(
                "codex",
                CODEX_BIN="",
                HOME=str(test_home),
                PATH=f"{path_bin}:{os.environ.get('PATH', '')}",
            ),
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(completed.returncode, 0, completed.stderr)
        self.assertEqual(Path(completed.stdout.strip()), current_cli)

    @wsl_bash_contract
    def test_node_cli_resolution_prefers_user_local_install_over_stale_nvm(self) -> None:
        test_home = Path(self.temp_dir.name) / "home"
        user_local_bin = test_home / ".local" / "bin"
        stale_nvm_bin = test_home / ".nvm" / "versions" / "node" / "v1" / "bin"
        user_local_bin.mkdir(parents=True)
        stale_nvm_bin.mkdir(parents=True)
        current_cli = user_local_bin / "codex"
        stale_cli = stale_nvm_bin / "codex"
        for cli in (current_cli, stale_cli):
            cli.write_text("#!/bin/bash\nexit 0\n", encoding="utf-8")
            cli.chmod(cli.stat().st_mode | stat.S_IXUSR)

        script = 'set -euo pipefail; source "$ADAPTER_PATH"; engine_adapter_resolve'
        completed = subprocess.run(
            ["bash", "-lc", script],
            cwd=REPO_ROOT,
            env=self.base_env(
                "codex",
                CODEX_BIN="",
                HOME=str(test_home),
                PATH="/usr/bin:/bin",
            ),
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(completed.returncode, 0, completed.stderr)
        self.assertEqual(Path(completed.stdout.strip()), current_cli)

    @wsl_bash_contract
    def test_claude_preserves_cli_contract_and_normalizes_usage(self) -> None:
        args_file = Path(self.temp_dir.name) / "claude.args"
        cli = self.make_cli(
            'printf "%s\\n" "$@" > "$FAKE_ARGS"\n'
            "printf '%s\\n' "
            "'{\"type\":\"result\",\"subtype\":\"success\",\"result\":\"done\","
            "\"total_cost_usd\":0.125,\"usage\":{\"input_tokens\":11,\"output_tokens\":7}}'\n"
        )
        self.run_adapter("claude", CLAUDE_BIN=str(cli), FAKE_ARGS=str(args_file))
        args = args_file.read_text(encoding="utf-8").splitlines()
        self.assertEqual(args[0:3], ["-p", "--output-format", "json"])
        self.assertEqual(args[-1], "contract prompt")
        self.assertIn("--model", args)
        self.assertIn("--permission-mode", args)
        record = self.read_record()
        self.assertEqual(record["status"], "success")
        self.assertEqual(record["result"], "done")
        self.assertEqual(record["cost_usd"], 0.125)
        self.assertEqual(record["input_tokens"], 11)
        self.assertEqual(record["output_tokens"], 7)
        self.assertEqual(record["total_tokens"], 18)
        self.assertEqual(record["subtype"], "success")

    @wsl_bash_contract
    def test_codex_preserves_cli_contract_and_extracts_json_usage(self) -> None:
        args_file = Path(self.temp_dir.name) / "codex.args"
        cli = self.make_cli(
            'printf "%s\\n" "$@" > "$FAKE_ARGS"\n'
            'message_file=""\n'
            'while [ "$#" -gt 0 ]; do\n'
            '  if [ "$1" = "-o" ]; then message_file="$2"; shift 2; else shift; fi\n'
            'done\n'
            'printf "codex result" > "$message_file"\n'
            "printf '%s\\n' 'diagnostic: tokens used: 999999' "
            "'{\"type\":\"turn.completed\",\"usage\":{\"input_tokens\":1200,\"cached_input_tokens\":100,\"output_tokens\":34}}'\n"
        )
        self.run_adapter("codex", CODEX_BIN=str(cli), FAKE_ARGS=str(args_file))
        args = args_file.read_text(encoding="utf-8").splitlines()
        self.assertEqual(args[0], "exec")
        self.assertIn('sandbox_mode="danger-full-access"', args)
        self.assertIn("-o", args)
        self.assertIn("-m", args)
        self.assertIn("--json", args)
        record = self.read_record()
        self.assertEqual(record["result"], "codex result")
        self.assertEqual(record["total_tokens"], 1234)
        self.assertEqual(record["input_tokens"], 1200)
        self.assertEqual(record["output_tokens"], 34)
        self.assertIsNone(record["cost_usd"])

    @wsl_bash_contract
    def test_codex_does_not_treat_human_log_text_as_usage(self) -> None:
        cli = self.make_cli(
            'message_file=""\n'
            'while [ "$#" -gt 0 ]; do\n'
            '  if [ "$1" = "-o" ]; then message_file="$2"; shift 2; else shift; fi\n'
            'done\n'
            'printf "codex result" > "$message_file"\n'
            'printf "tokens usedAcceptance complete.\\n\\n1,234\\n"\n'
        )
        self.run_adapter("codex", CODEX_BIN=str(cli))
        record = self.read_record()
        self.assertEqual(record["result"], "codex result")
        self.assertIsNone(record["total_tokens"])
        self.assertIsNone(record["cost_usd"])

    @wsl_bash_contract
    def test_provider_success_cannot_override_failed_process(self) -> None:
        cli = self.make_cli("printf '%s\\n' '{\"status\":\"success\",\"result\":\"done\"}'\nexit 7\n")
        self.run_adapter("claude", CLAUDE_BIN=str(cli))
        self.assertEqual(self.read_record()["status"], "error")
        self.assertEqual(self.read_record()["exit_code"], 7)

    @wsl_bash_contract
    def test_codex_failed_turn_is_an_adapter_error_even_with_exit_zero(self) -> None:
        cli = self.make_cli("printf '%s\\n' '{\"type\":\"turn.failed\",\"error\":{\"message\":\"provider refused\"}}'\n")
        self.run_adapter("codex", CODEX_BIN=str(cli))
        self.assertEqual(self.read_record()["status"], "error")

    @wsl_bash_contract
    def test_openai_compatible_missing_usage_stays_unknown(self) -> None:
        response = {"choices": [{"message": {"role": "assistant", "content": "done"}}]}
        with RunningFakeServer([{"body": response}]) as server:
            self.run_adapter(
                "openai-compatible", OPENAI_COMPATIBLE_ADAPTER_ENABLED="1",
                OPENAI_COMPATIBLE_ENDPOINT=f"http://127.0.0.1:{server.server_port}/chat",
                OPENAI_COMPATIBLE_MODEL="fake-model",
            )
        record = self.read_record()
        for field in ("input_tokens", "output_tokens", "total_tokens", "cost_usd"):
            self.assertIsNone(record[field], field)

    def test_openai_usage_totals_do_not_hide_missing_or_invalid_turns(self) -> None:
        agent = self.load_openai_agent()
        totals = agent.UsageTotals()
        totals.add({"usage": {"prompt_tokens": 10, "completion_tokens": 4}, "cost_usd": 0.1})
        self.assertEqual(totals.payload()["total_tokens"], 14)
        totals.add({"usage": {"completion_tokens": 6}, "cost_usd": 0.2})
        self.assertIsNone(totals.payload()["input_tokens"])
        self.assertIsNone(totals.payload()["total_tokens"])
        self.assertEqual(totals.payload()["output_tokens"], 10)
        totals.add({"usage": {"completion_tokens": -1}})
        self.assertIsNone(totals.payload()["output_tokens"])
        self.assertIsNone(totals.payload()["cost_usd"])

    @wsl_bash_contract
    def test_openai_redirect_never_forwards_credentials_or_prompt(self) -> None:
        agent = self.load_openai_agent()
        with RunningFakeServer([]) as destination:
            target = f"http://127.0.0.1:{destination.server_port}/leak"
            with RunningFakeServer([{"status": 307, "headers": {"Location": target}}]) as source:
                endpoint = f"http://127.0.0.1:{source.server_port}/chat"
                with self.assertRaises(agent.AdapterError):
                    agent.post_chat(endpoint, "fake-secret", {"private": "prompt"}, 3)
            self.assertEqual(destination.requests, [])

    @wsl_bash_contract
    def test_safe_git_commands_disable_repository_and_inherited_execution_hooks(self) -> None:
        agent = self.load_openai_agent()
        subprocess.run(["git", "init", "-q", str(self.workspace)], check=True)
        marker = self.workspace / "hook-ran"
        hook = self.workspace / "fsmonitor-hook"
        hook.write_text(f"#!/bin/sh\ntouch '{marker}'\n", encoding="utf-8")
        hook.chmod(0o700)
        subprocess.run(["git", "-C", str(self.workspace), "config", "core.fsmonitor", str(hook)], check=True)
        commands = agent.parse_safe_commands(",".join(agent.DEFAULT_SAFE_COMMANDS))
        environment = {"GIT_CONFIG_COUNT": "1", "GIT_CONFIG_KEY_0": "core.fsmonitor", "GIT_CONFIG_VALUE_0": str(hook)}
        with mock.patch.dict(os.environ, environment):
            output = json.loads(agent.run_tool("run_command", {"argv": ["git", "status", "--short"]}, self.workspace, commands, False))
        self.assertEqual(output["exit_code"], 0, output)
        self.assertFalse(marker.exists(), "read-only command executed a repository hook")

    @wsl_bash_contract
    def test_safe_command_cannot_resolve_to_model_written_workspace_binary(self) -> None:
        agent = self.load_openai_agent()
        executable = self.workspace / "git"
        executable.write_text("#!/bin/sh\nexit 0\n", encoding="utf-8")
        executable.chmod(0o700)
        commands = agent.parse_safe_commands(",".join(agent.DEFAULT_SAFE_COMMANDS))
        with mock.patch.dict(os.environ, {"PATH": str(self.workspace) + os.pathsep + os.environ["PATH"]}):
            with self.assertRaises(agent.AdapterError):
                agent.run_tool("run_command", {"argv": ["git", "status", "--short"]}, self.workspace, commands, False)

    @wsl_bash_contract
    def test_cursor_refuses_until_native_isolation_is_supported(self) -> None:
        args_file = Path(self.temp_dir.name) / "cursor.args"
        cli = self.make_cli(
            'printf "%s\\n" "$@" > "$FAKE_ARGS"\n'
            "printf '%s\\n' '{\"type\":\"result\",\"subtype\":\"success\",\"result\":\"cursor done\"}'\n"
        )
        self.run_adapter(
            "cursor",
            CURSOR_ADAPTER_ENABLED="1",
            CURSOR_BIN=str(cli),
            FAKE_ARGS=str(args_file),
        )
        self.assertFalse(args_file.exists())
        self.assertEqual(self.read_record()["status"], "error")

    @wsl_bash_contract
    def test_cursor_rejects_force_with_disabled_sandbox(self) -> None:
        script = 'set -euo pipefail; source "$ADAPTER_PATH"; engine_adapter_validate'
        completed = subprocess.run(
            ["bash", "-lc", script],
            cwd=REPO_ROOT,
            env=self.base_env(
                "cursor",
                CURSOR_ADAPTER_ENABLED="1",
                CURSOR_SANDBOX_MODE="disabled",
                CURSOR_ALLOW_UNSANDBOXED="1",
                CURSOR_FORCE="1",
            ),
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertNotEqual(completed.returncode, 0)
        self.assertIn("forbidden", completed.stderr)

    @wsl_bash_contract
    def test_openai_compatible_contract_and_authorization(self) -> None:
        secret = "fake-openai-secret-value"
        response = {
            "choices": [{"message": {"role": "assistant", "content": "http done"}}],
            "usage": {"prompt_tokens": 20, "completion_tokens": 5, "total_tokens": 25},
            "cost_usd": 0.02,
            "subtype": "success",
        }
        with RunningFakeServer([{"body": response}]) as server:
            endpoint = f"http://127.0.0.1:{server.server_port}/v1/chat/completions"
            self.run_adapter(
                "openai-compatible",
                OPENAI_COMPATIBLE_ADAPTER_ENABLED="1",
                OPENAI_COMPATIBLE_ENDPOINT=endpoint,
                OPENAI_COMPATIBLE_MODEL="fake-model",
                OPENAI_COMPATIBLE_API_KEY=secret,
                HTTP_PROXY="http://192.0.2.20:9",
                HTTPS_PROXY="http://192.0.2.20:9",
                ALL_PROXY="http://192.0.2.20:9",
                NO_PROXY="",
                http_proxy="http://192.0.2.20:9",
                https_proxy="http://192.0.2.20:9",
                all_proxy="http://192.0.2.20:9",
                no_proxy="",
            )
            self.assertEqual(server.requests[0]["headers"]["Authorization"], f"Bearer {secret}")
            self.assertEqual(server.requests[0]["body"]["model"], "fake-model")
        record = self.read_record()
        self.assertEqual(record["result"], "http done")
        self.assertEqual(record["cost_usd"], 0.02)
        self.assertEqual(record["input_tokens"], 20)
        self.assertEqual(record["output_tokens"], 5)
        self.assertEqual(record["total_tokens"], 25)
        self.assertNotIn(secret, self.record.read_text(encoding="utf-8"))

    @wsl_bash_contract
    def test_openai_compatible_allows_https_endpoint_by_default(self) -> None:
        completed = self.validate_adapter(
            "openai-compatible",
            OPENAI_COMPATIBLE_ADAPTER_ENABLED="1",
            OPENAI_COMPATIBLE_ENDPOINT="https://api.example.test/v1/chat/completions",
            OPENAI_COMPATIBLE_MODEL="fake-model",
        )
        self.assertEqual(completed.returncode, 0, completed.stderr)

    @wsl_bash_contract
    def test_openai_compatible_allows_loopback_http_by_default(self) -> None:
        for endpoint in (
            "http://127.0.0.1:8080/v1/chat/completions",
            "http://127.42.0.8/v1/chat/completions",
            "http://localhost:8080/v1/chat/completions",
            "http://[::1]:8080/v1/chat/completions",
        ):
            with self.subTest(endpoint=endpoint):
                completed = self.validate_adapter(
                    "openai-compatible",
                    OPENAI_COMPATIBLE_ADAPTER_ENABLED="1",
                    OPENAI_COMPATIBLE_ENDPOINT=endpoint,
                    OPENAI_COMPATIBLE_MODEL="fake-model",
                )
                self.assertEqual(completed.returncode, 0, completed.stderr)

    @wsl_bash_contract
    def test_openai_compatible_rejects_non_loopback_http_by_default(self) -> None:
        secret = "fake-secret-must-not-appear-in-validation"
        for endpoint in (
            "http://192.0.2.10/v1/chat/completions",
            "http://localhost.example/v1/chat/completions",
            "http://127.0.0.1.example/v1/chat/completions",
            "http://127/v1/chat/completions",
        ):
            with self.subTest(endpoint=endpoint):
                completed = self.validate_adapter(
                    "openai-compatible",
                    OPENAI_COMPATIBLE_ADAPTER_ENABLED="1",
                    OPENAI_COMPATIBLE_ENDPOINT=endpoint,
                    OPENAI_COMPATIBLE_MODEL="fake-model",
                    OPENAI_COMPATIBLE_API_KEY=secret,
                )
                self.assertNotEqual(completed.returncode, 0)
                self.assertIn("non-loopback HTTP endpoints are blocked", completed.stderr)
                self.assertIn("OPENAI_COMPATIBLE_ALLOW_INSECURE_HTTP=1", completed.stderr)
                self.assertNotIn(secret, completed.stderr)

    @wsl_bash_contract
    def test_openai_compatible_allows_explicit_insecure_http_opt_in(self) -> None:
        completed = self.validate_adapter(
            "openai-compatible",
            OPENAI_COMPATIBLE_ADAPTER_ENABLED="1",
            OPENAI_COMPATIBLE_ENDPOINT="http://192.0.2.10/v1/chat/completions",
            OPENAI_COMPATIBLE_MODEL="fake-model",
            OPENAI_COMPATIBLE_ALLOW_INSECURE_HTTP="1",
        )
        self.assertEqual(completed.returncode, 0, completed.stderr)

    @wsl_bash_contract
    def test_openai_compatible_restricts_paths_and_shell_by_default(self) -> None:
        calls = [
            {
                "id": "shell-1",
                "type": "function",
                "function": {
                    "name": "run_shell",
                    "arguments": json.dumps({"command": "touch shell-escaped"}),
                },
            },
            {
                "id": "outside-1",
                "type": "function",
                "function": {
                    "name": "write_file",
                    "arguments": json.dumps({"path": "../outside.txt", "content": "bad"}),
                },
            },
            {
                "id": "inside-1",
                "type": "function",
                "function": {
                    "name": "run_command",
                    "arguments": json.dumps({"argv": ["rg", "secret", "/etc"]}),
                },
            },
            {
                "id": "inside-2",
                "type": "function",
                "function": {
                    "name": "write_file",
                    "arguments": json.dumps({"path": "inside.txt", "content": "allowed"}),
                },
            },
        ]
        responses = [
            {"body": {"choices": [{"message": {"role": "assistant", "content": None, "tool_calls": [call]}}]}}
            for call in calls
        ]
        responses.append(
            {"body": {"choices": [{"message": {"role": "assistant", "content": "policy handled"}}]}}
        )
        with RunningFakeServer(responses) as server:
            endpoint = f"http://127.0.0.1:{server.server_port}/chat"
            self.run_adapter(
                "openai-compatible",
                OPENAI_COMPATIBLE_ADAPTER_ENABLED="1",
                OPENAI_COMPATIBLE_ENDPOINT=endpoint,
                OPENAI_COMPATIBLE_MODEL="fake-model",
            )
            request_tools = server.requests[0]["body"]["tools"]
            tool_names = [tool["function"]["name"] for tool in request_tools]
            self.assertNotIn("run_shell", tool_names)
            self.assertIn("arbitrary shell is disabled", server.requests[1]["body"]["messages"][-1]["content"])
            self.assertIn("outside the workspace", server.requests[2]["body"]["messages"][-1]["content"])
            self.assertIn("not allowlisted", server.requests[3]["body"]["messages"][-1]["content"])
        self.assertFalse((self.workspace / "shell-escaped").exists())
        self.assertFalse((self.workspace.parent / "outside.txt").exists())
        self.assertEqual((self.workspace / "inside.txt").read_text(encoding="utf-8"), "allowed")

    @wsl_bash_contract
    def test_openai_compatible_sensitive_file_policy(self) -> None:
        agent = self.load_openai_agent()
        sensitive_content = "local-sensitive-content-must-not-leak"
        denied_paths = (
            ".NPMRC",
            "nested/.PyPiRc",
            "nested/.NeTrC",
            "certificates/client.P12",
            "certificates/client.PfX",
            "certificates/client.KEY",
            "certificates/client.PEM",
            ".ENV.production",
            ".envrc",
            ".auto-loop.env",
            ".AWS/credentials",
            ".Azure/msal_token_cache.json",
            ".config/GCloud/access_tokens.db",
            ".SSH/id_ed25519",
            ".KUBE/config",
            ".Docker/config.json",
            ".config/GH/hosts.yml",
            ".config/glab-cli/config.yml",
            ".terraform.d/credentials.tfrc.json",
            "nested/KUBECONFIG.YAML",
            "nested/service-account.json",
            "nested/id_rsa",
        )
        for relative_path in denied_paths:
            with self.subTest(relative_path=relative_path):
                path = self.workspace / relative_path
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(sensitive_content, encoding="utf-8")
                with self.assertRaises(agent.AdapterError) as raised:
                    agent.run_tool(
                        "read_file", {"path": relative_path}, self.workspace, (), False
                    )
                self.assertEqual(
                    str(raised.exception),
                    "secret-bearing workspace path is not accessible",
                )
                self.assertNotIn(relative_path, str(raised.exception))
                self.assertNotIn(sensitive_content, str(raised.exception))
                with self.assertRaises(agent.AdapterError) as write_error:
                    agent.run_tool(
                        "write_file",
                        {
                            "path": relative_path,
                            "content": "replacement-sensitive-content",
                        },
                        self.workspace,
                        (),
                        False,
                    )
                self.assertEqual(
                    str(write_error.exception),
                    "secret-bearing workspace path is not accessible",
                )
                self.assertEqual(path.read_text(encoding="utf-8"), sensitive_content)

        allowed_paths = (
            ".env.example",
            ".env.production.template",
            "src/private_key_parser.py",
            "docs/secrets-management.md",
            "certificates/public.crt",
            "fixtures/kubeconfig.example",
            "nested/not-credentials.json",
        )
        for relative_path in allowed_paths:
            with self.subTest(relative_path=relative_path):
                path = self.workspace / relative_path
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text("ordinary-source-content", encoding="utf-8")
                self.assertEqual(
                    agent.run_tool(
                        "read_file", {"path": relative_path}, self.workspace, (), False
                    ),
                    "ordinary-source-content",
                )

    @wsl_bash_contract
    def test_openai_compatible_resolves_escape_and_symlink_targets_before_read(self) -> None:
        agent = self.load_openai_agent()
        outside_content = "outside-sensitive-content-must-not-leak"
        outside = self.workspace.parent / "outside-sensitive-marker.txt"
        outside.write_text(outside_content, encoding="utf-8")
        (self.workspace / "outside-link.txt").symlink_to(outside)

        npm_content = "npm-sensitive-content-must-not-leak"
        npmrc = self.workspace / ".npmrc"
        npmrc.write_text(npm_content, encoding="utf-8")
        (self.workspace / "apparently-safe.txt").symlink_to(npmrc)

        cases = (
            (
                "../outside-sensitive-marker.txt",
                "path is outside the workspace",
                outside_content,
            ),
            ("outside-link.txt", "path is outside the workspace", outside_content),
            (
                "apparently-safe.txt",
                "secret-bearing workspace path is not accessible",
                npm_content,
            ),
        )
        for requested_path, expected_error, protected_content in cases:
            with self.subTest(requested_path=requested_path):
                with self.assertRaises(agent.AdapterError) as raised:
                    agent.run_tool(
                        "read_file", {"path": requested_path}, self.workspace, (), False
                    )
                self.assertEqual(str(raised.exception), expected_error)
                self.assertNotIn(requested_path, str(raised.exception))
                self.assertNotIn(protected_content, str(raised.exception))

        git_config = self.workspace / ".GiT" / "config"
        git_config.parent.mkdir()
        git_config.write_text("git-sensitive-content-must-not-leak", encoding="utf-8")
        with self.assertRaises(agent.AdapterError) as raised:
            agent.run_tool("read_file", {"path": ".GiT/config"}, self.workspace, (), False)
        self.assertEqual(
            str(raised.exception), "protected workspace path is not accessible"
        )
        self.assertNotIn("git-sensitive-content-must-not-leak", str(raised.exception))

    @wsl_bash_contract
    def test_openai_error_redacts_secret(self) -> None:
        secret = "fake-secret-must-not-leak"
        with RunningFakeServer([{"status": 500, "body": {"error": secret}}]) as server:
            endpoint = f"http://127.0.0.1:{server.server_port}/chat"
            completed = self.run_adapter(
                "openai-compatible",
                check=False,
                OPENAI_COMPATIBLE_ADAPTER_ENABLED="1",
                OPENAI_COMPATIBLE_ENDPOINT=endpoint,
                OPENAI_COMPATIBLE_MODEL="fake-model",
                OPENAI_COMPATIBLE_API_KEY=secret,
            )
        self.assertEqual(completed.returncode, 0)
        self.assertNotIn(secret, completed.stdout)
        self.assertNotIn(secret, self.record.read_text(encoding="utf-8"))
        self.assertIn("[REDACTED]", self.record.read_text(encoding="utf-8"))
        self.assertEqual(self.read_record()["status"], "error")

    @wsl_bash_contract
    def test_openai_http_timeout_uses_common_watchdog_contract(self) -> None:
        response = {
            "choices": [{"message": {"role": "assistant", "content": "too late"}}]
        }
        with RunningFakeServer([{"delay": 3, "body": response}]) as server:
            endpoint = f"http://127.0.0.1:{server.server_port}/chat"
            self.run_adapter(
                "openai-compatible",
                OPENAI_COMPATIBLE_ADAPTER_ENABLED="1",
                OPENAI_COMPATIBLE_ENDPOINT=endpoint,
                OPENAI_COMPATIBLE_MODEL="fake-model",
                CYCLE_TIMEOUT_SECONDS="1",
                OPENAI_COMPATIBLE_REQUEST_TIMEOUT_SECONDS="10",
            )
        record = self.read_record()
        self.assertEqual(record["status"], "timeout")
        self.assertEqual(record["exit_code"], 124)
        self.assertTrue(record["timed_out"])

    @wsl_bash_contract
    def test_common_watchdog_normalizes_timeout(self) -> None:
        cli = self.make_cli('sleep 5\n')
        self.run_adapter(
            "claude",
            CLAUDE_BIN=str(cli),
            CYCLE_TIMEOUT_SECONDS="1",
        )
        record = self.read_record()
        self.assertEqual(record["status"], "timeout")
        self.assertEqual(record["subtype"], "timeout")
        self.assertEqual(record["exit_code"], 124)
        self.assertTrue(record["timed_out"])

    @wsl_bash_contract
    def test_openai_adapter_requires_explicit_endpoint_and_model(self) -> None:
        script = 'set -euo pipefail; source "$ADAPTER_PATH"; engine_adapter_validate'
        completed = subprocess.run(
            ["bash", "-lc", script],
            cwd=REPO_ROOT,
            env=self.base_env(
                "openai-compatible",
                OPENAI_COMPATIBLE_ADAPTER_ENABLED="1",
                MODEL="",
                OPENAI_COMPATIBLE_MODEL="",
            ),
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertNotEqual(completed.returncode, 0)
        self.assertIn("ENDPOINT is required", completed.stderr)

    def test_platform_launchers_do_not_accept_or_persist_api_key(self) -> None:
        mac_installer = (REPO_ROOT / "scripts" / "macos" / "install-daemon.sh").read_text(
            encoding="utf-8"
        )
        windows_start = (REPO_ROOT / "scripts" / "windows" / "start-win.ps1").read_text(
            encoding="utf-8"
        )
        self.assertNotIn("<key>OPENAI_COMPATIBLE_API_KEY</key>", mac_installer)
        self.assertNotIn("<key>CURSOR_API_KEY</key>", mac_installer)
        self.assertNotIn("OpenAICompatibleApiKey", windows_start)
        self.assertNotIn("OPENAI_COMPATIBLE_API_KEY=", windows_start)
        self.assertIn("[switch]$OpenAICompatibleAllowInsecureHttp", windows_start)
        self.assertIn("OPENAI_COMPATIBLE_ALLOW_INSECURE_HTTP=1", windows_start)
        self.assertIn("launchd-config.py", mac_installer)


if __name__ == "__main__":
    unittest.main()
