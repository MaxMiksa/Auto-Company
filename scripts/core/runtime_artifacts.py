"""Program-owned artifact registration, check execution and static previews.

No inference from messages or arbitrary URLs. Tools opt into this small
contract; unsupported project runners remain unsupported, not guessed.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
from functools import partial
import hashlib
import http.client
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path, PurePosixPath
import re
import signal
import stat
import subprocess
import sys
import tempfile
import threading
import time
import uuid
from urllib.parse import unquote, urlsplit
import xml.etree.ElementTree as ET

from check_adapters import ADAPTERS, bounded_bytes, report_summary
from runtime_events import bounded_text


def safe_path(root, relative):
    if not isinstance(relative, str) or not relative or "\\" in relative or ":" in relative:
        raise ValueError("Invalid artifact path")
    parts = PurePosixPath(relative)
    if parts.is_absolute() or ".." in parts.parts:
        raise ValueError("Artifact must stay in its project")
    path = root
    for part in parts.parts:
        path /= part
        if path.is_symlink() or getattr(path, "is_junction", lambda: False)():
            raise ValueError("Linked artifacts are not supported")
    path.resolve().relative_to(root.resolve())
    return path


def save(root, record):
    folder = safe_path(root, "logs/artifacts")
    folder.mkdir(parents=True, exist_ok=True)
    if not re.fullmatch(r"[0-9a-f]{32}", record["id"]):
        raise ValueError("Invalid artifact identity")
    target = safe_path(root, "logs/artifacts/" + record["id"] + ".json")
    descriptor, temporary = tempfile.mkstemp(prefix=".artifact-", dir=folder)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as output:
            json.dump(record, output, ensure_ascii=False)
            output.write("\n")
        os.replace(temporary, target)
    finally:
        Path(temporary).unlink(missing_ok=True)


def observe(root, record):
    try:
        save(root, record)
        return True
    except (OSError, ValueError) as error:
        print(f"Artifact observation unavailable: {error}", file=sys.stderr)
        return False


def now():
    return datetime.now(timezone.utc).isoformat()


def base_record(project, kind, root=None):
    record = {"version": 1, "id": uuid.uuid4().hex, "project": project,
            "kind": kind, "cycleId": os.environ.get("AUTO_COMPANY_CYCLE_ID"),
            "recordedAt": now(), "source": "runner"}
    if root is not None:
        from product_identity import get_identity
        try:
            identity = get_identity(root, project, create=False)
            if identity:
                record["productId"] = identity["id"]
        except (OSError, ValueError, TypeError, KeyError):
            # Observation cannot prevent checks from running. Consumers leave
            # records with no provable identity unassociated.
            pass
    return record


def fingerprint(path):
    return hashlib.sha256(bounded_bytes(path)).hexdigest()


def artifact_records(root):
    """Stream all record names; bounded reads cannot miss later lifecycle rows."""
    folder = safe_path(root, "logs/artifacts")
    for path in folder.glob("*.json"):
        try:
            target = safe_path(root, path.relative_to(root).as_posix())
            metadata = target.stat()
            if not stat.S_ISREG(metadata.st_mode) or metadata.st_size > 16 * 1024:
                continue
            with target.open("rb") as source:
                raw = source.read(16 * 1024 + 1)
            if len(raw) <= 16 * 1024:
                record = json.loads(raw)
                if isinstance(record, dict):
                    yield record
        except (OSError, ValueError, TypeError, RecursionError):
            continue


def check_command(adapter, arguments, report):
    """Return the actual argv and environment, never a shell expression."""
    environment = dict(os.environ)
    if adapter == "python-unittest":
        if report:
            return [sys.executable, str(Path(__file__).with_name("check_adapters.py")), str(report), *arguments], environment
        return [sys.executable, "-m", "unittest", *arguments], environment
    if adapter == "node-test":
        if any(arg.startswith("--test-reporter") for arg in arguments):
            raise ValueError("Pass test files/options only; reporter options are owned by the adapter")
        reporting = ["--test-reporter=spec", "--test-reporter-destination=stdout", "--test-reporter=junit", f"--test-reporter-destination={report}"] if report else []
        return ["node", "--test", *reporting, *arguments], environment
    if adapter == "playwright" and report:
        if any(arg.startswith("--reporter") for arg in arguments):
            raise ValueError("The Playwright adapter owns --reporter")
        environment["PLAYWRIGHT_JSON_OUTPUT_FILE"] = str(report)
        return [*arguments, "--reporter=json"], environment
    return arguments, environment


def recorded_command(command):
    """Bound optional display data while executing the original argv unchanged."""
    result, remaining, truncated = [], 8000, False
    for argument in command[:100]:
        redacted = bounded_text(argument, len(argument) + 100)
        shown = redacted[:2000]
        while len(json.dumps(shown, ensure_ascii=True)) + 2 > remaining:
            shown = shown[:len(shown) // 2]
        result.append(shown)
        remaining -= len(json.dumps(shown, ensure_ascii=True)) + 2
        truncated = truncated or len(shown) < len(redacted)
        if remaining < 8:
            break
    return result, truncated or len(result) < len(command)


def run_check(root, project, record, args):
    arguments = args.command[1:] if args.command[:1] == ["--"] else args.command
    adapter = args.adapter or ("junit" if args.report else "exit-code")
    if not arguments and adapter not in {"python-unittest", "node-test"}:
        raise ValueError("Check command required")
    if args.report and adapter not in {"junit", "exit-code"}:
        raise ValueError("Native adapters own their fresh report path; omit --report")
    if adapter == "junit" and not args.report:
        raise ValueError("JUnit requires --report <project-relative XML file>")
    relative = args.report
    if adapter in {"python-unittest", "node-test", "playwright"}:
        suffix = "xml" if adapter == "node-test" else "json"
        relative = f".auto-company/checks/{record['id']}.{suffix}"
    path = safe_path(project, relative) if relative else None
    before = None
    if path:
        try:
            if path.exists():
                previous_stat = path.stat()
                before = (previous_stat.st_mtime_ns, previous_stat.st_size, previous_stat.st_ino)
            path.parent.mkdir(parents=True, exist_ok=True)
        except (OSError, ValueError) as error:
            print(f"Check report unavailable: {error}", file=sys.stderr)
            path = None
    command, environment = check_command(adapter, arguments, path)
    display_command, command_truncated = recorded_command(command)
    record.update(adapter=adapter, command=display_command, commandTruncated=command_truncated,
                  state="running", startedAt=now(), endedAt=None,
                  exitCode=None, reportStatus="pending" if path else "unavailable")
    if path:
        record["path"] = path.relative_to(root).as_posix()
    observe(root, record)
    process = None
    launch_status = None
    interrupted = False
    previous = signal.getsignal(signal.SIGTERM)

    def stop(_sig, _frame):
        raise KeyboardInterrupt

    signal.signal(signal.SIGTERM, stop)
    try:
        from project_isolation import inside_boundary
        if not inside_boundary():
            # Checks execute product-authored code, even when triggered by a
            # human or the dashboard. Give them the same mandatory boundary.
            descriptor, launch_status = tempfile.mkstemp(prefix="auto-company-check-launch-")
            os.close(descriptor)
            Path(launch_status).write_text('{"started": false}')
            command = [sys.executable, str(Path(__file__).with_name("project_isolation.py")),
                       "--workspace", str(project), "--launch-status", launch_status,
                       "--", *[re.sub(re.escape(str(project)) + r"(?=$|[/\s`\"'])", "/workspace", value) for value in command]]
        process = subprocess.Popen(command, cwd=project, env=environment)
        code = process.wait()
        if launch_status and not json.loads(Path(launch_status).read_text()).get("started"):
            record["state"] = "launch_failed"
    except KeyboardInterrupt:
        interrupted = True
        if process and process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=2)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()
        code = 130
    except OSError as error:
        print(f"Check could not start: {error}", file=sys.stderr)
        code = 127
        record["state"] = "launch_failed"
    finally:
        signal.signal(signal.SIGTERM, previous)
        if launch_status:
            Path(launch_status).unlink(missing_ok=True)
    record.update(exitCode=code, endedAt=now(), recordedAt=now())
    if record["state"] != "launch_failed":
        record["state"] = "interrupted" if interrupted or code < 0 else "completed"
    if path:
        try:
            path = safe_path(project, relative)
            final_stat = path.stat()
            signature = (final_stat.st_mtime_ns, final_stat.st_size, final_stat.st_ino)
            if signature == before:
                record["reportStatus"] = "missing_or_stale"
            else:
                record["sha256"] = fingerprint(path)
                record.update(tests=report_summary(path, adapter), reportStatus="fresh")
        except FileNotFoundError:
            record["reportStatus"] = "missing_or_stale"
        except (OSError, ValueError, TypeError, KeyError, AttributeError, RecursionError, ET.ParseError):
            record["reportStatus"] = "unsupported"
    observe(root, record)
    return code if code >= 0 else 128 - code


def preview_request(record, stop=False):
    from urllib.parse import urlsplit
    try:
        parsed = urlsplit(record.get("url", ""))
        token = record.get("token", "")
        if parsed.scheme != "http" or parsed.hostname != "127.0.0.1" or parsed.path != "/" or not re.fullmatch(r"[0-9a-f]{32}", token):
            return False
        connection = http.client.HTTPConnection("127.0.0.1", parsed.port, timeout=0.3)
        try:
            connection.request("POST" if stop else "GET", "/.auto-company-stop" if stop else "/.auto-company-health",
                               headers={"X-Auto-Company-Preview": token})
            response = connection.getresponse()
            return response.status == 204 and response.getheader("X-Auto-Company-Preview") == token
        finally:
            connection.close()
    except (ValueError, OSError, http.client.HTTPException):
        return False


def finalize(root, cycle, capture=True):
    """Close only exact-cycle running records after the existing supervisor ends."""
    if not isinstance(cycle, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]{0,127}", cycle):
        raise ValueError("Valid cycle identity required")
    folder = safe_path(root, "logs/artifacts")
    for record in artifact_records(root):
        try:
            if record.get("version") != 1 or record.get("source") != "runner" or record.get("cycleId") != cycle or record.get("state") != "running":
                continue
            if record.get("kind") == "preview" and record.get("lifetime", "cycle") == "cycle":
                requested = preview_request(record, stop=True)
                # The live process writes its precise end time. A dead process
                # has no reliable end timestamp, even though cleanup is done.
                if not requested and not preview_request(record):
                    record.update(state="stopped", recordedAt=now())
                    observe(root, record)
            elif record.get("kind") == "check":
                record.update(state="interrupted", recordedAt=now())
                observe(root, record)
        except (OSError, ValueError, TypeError, KeyError):
            continue
    # The provider supervisor has already ended. Capture owns an independent,
    # bounded preview and therefore does not depend on a model opening one.
    if capture:
        try:
            from product_media import capture_cycle
            capture_cycle(root, cycle)
        except (OSError, ValueError, TypeError):
            pass


def write_context(root, cycle, project):
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]{0,127}", cycle):
        raise ValueError("Valid cycle identity required")
    if not isinstance(project, str) or (project and not re.fullmatch(r"projects/[a-z0-9](?:[a-z0-9-]*[a-z0-9])?", project)):
        raise ValueError("Valid project identity required")
    value = {"version": 1, "cycleId": cycle, "project": project, "recordedAt": now(), "source": "runtime_context"}
    # Capture actual cycle-start configuration, never infer historical language
    # from whatever NEXT period is currently selected in this runtime root.
    try:
        from product_identity import read_state
        from localization import language_state
        state = read_state(root)
        row = state["cycles"].get(cycle)
        identity = state["identities"].get(row["identityId"]) if row else None
        language = language_state(root)
        actual = os.environ.get("AUTO_COMPANY_LANGUAGE")
        if (row and identity and row["state"] == "reserved" and identity["kind"] == "product"
                and row["project"] == project == identity["project"]
                and os.environ.get("AUTO_COMPANY_CYCLE") == "1" and os.environ.get("AUTO_COMPANY_CYCLE_ID") == cycle
                and os.environ.get("AUTO_COMPANY_STABLE_PRODUCT_ID") == identity["id"]
                and language["locked"] and actual == language["language"] and actual in {"en", "zh-CN"}
                and re.fullmatch(r"[0-9a-f]{32}", language.get("productId") or "")):
            value["languageEvidence"] = {"schemaVersion": 1, "productId": identity["id"], "cycleId": cycle,
                                         "language": actual, "languagePeriodId": language["productId"], "recordedAt": value["recordedAt"]}
    except (OSError, ValueError, TypeError, KeyError):
        pass
    target = safe_path(root, f"logs/{cycle}.context.json")
    target.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(prefix=".cycle-context-", dir=target.parent)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as output:
            json.dump(value, output, ensure_ascii=False)
            output.write("\n")
        os.replace(temporary, target)
    finally:
        Path(temporary).unlink(missing_ok=True)


PROMPT = """## Product metadata, checks and delivery (normal workflow)
Use these program-owned tools from the framework directory; use absolute script paths if your cwd is the product. --root and --project default to the current runtime context. With no selected product, provide --project projects/<candidate> explicitly; never change human selection.
After creating a product with make project-new, or when selected metadata is absent/default, describe the product once in its language:
python3 scripts/core/project_metadata.py --display-name 'Product name' --description 'One sentence describing its purpose'
When checking product work, execute the actual check ONCE through the matching runner below. Do not run a check separately and rerun it for reporting. The runner owns command status, timestamps, fresh report path/hash and test counts. Choose the real framework; do not invent test totals or scrape PASS text. Pass arguments after -- as separate argv tokens; shell operators are not supported.
- Python unittest: python3 scripts/core/runtime_artifacts.py check --adapter python-unittest -- discover -s tests
- Node native node:test (Node supports built-in JUnit reporter): python3 scripts/core/runtime_artifacts.py check --adapter node-test -- tests/example.test.js
- Playwright Test: python3 scripts/core/runtime_artifacts.py check --adapter playwright -- npx playwright test
- Existing JUnit producer: python3 scripts/core/runtime_artifacts.py check --adapter junit --report report.xml -- <actual command and arguments producing report.xml>
- Other checks: python3 scripts/core/runtime_artifacts.py check --adapter exit-code -- <actual command and arguments> (records exit status only; test counts stay unknown)
Reports must be genuine runner output. If the project uses custom assertions, use the exit-code adapter; do not present source-code assertions as verified test counts. Observation failures must not alter business work, governance or check exit status.
At delivery, write/update a concise DELIVERY.md inside the product, then register that existing file:
python3 scripts/core/runtime_artifacts.py document DELIVERY.md
For a static UI, start a cycle-owned loopback preview with its explicit web root:
python3 scripts/core/runtime_artifacts.py preview --directory .
This is an intentionally long-running foreground command. Use your engine's persistent command session, keep that session open while checking the printed URL in the browser, then run python3 scripts/core/runtime_artifacts.py preview-stop. Do not wait for the preview command to finish before using its URL. Do not use --background, shell &, nohup or detach inside a cycle: a short-lived tool terminal can kill those children as soon as the tool command exits. If the engine cannot retain a command session, report that preview limitation rather than claiming a working link. Cycle previews stop with cycle cleanup; never promise a retained preview. Arbitrary Vite/Next/backend servers are not supported by this static runner. Do not start previews for non-UI products. Do not edit artifact JSON or manufacture a report if collection is unavailable.
"""


WEB_SUFFIXES = {".html", ".htm", ".css", ".js", ".mjs", ".cjs", ".json", ".webmanifest",
                ".svg", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".ico",
                ".woff", ".woff2", ".ttf", ".otf", ".eot", ".wasm", ".txt", ".xml",
                ".csv", ".pdf", ".mp3", ".mp4", ".ogg", ".ogv", ".wav", ".webm", ".vtt"}
PRIVATE_NAME = re.compile(r"(?:credentials?|secrets?|tokens?|auth|service[-_]account|id[-_](?:rsa|dsa|ecdsa|ed25519))(?:[._-]|$)", re.I)


class PreviewHandler(SimpleHTTPRequestHandler):
    """Loopback web assets only; control endpoints require their exact token."""

    def __init__(self, *args, token, **kwargs):
        self.token = token
        self.control_response = False
        super().__init__(*args, **kwargs)

    def request_allowed(self):
        port = self.server.server_port
        hosts = self.headers.get_all("Host", [])
        origins = self.headers.get_all("Origin", [])
        host = hosts[0].lower() if len(hosts) == 1 else ""
        if (host not in {f"localhost:{port}", f"127.0.0.1:{port}"}
                or len(origins) > 1 or (origins and origins[0] != f"http://{host}")
                or self.headers.get("Sec-Fetch-Site") == "cross-site"):
            self.send_error(403, "Only same-origin local preview requests are allowed")
            return False
        return True

    def translate_path(self, path):
        parsed = urlsplit(path)
        if parsed.scheme or parsed.netloc:
            raise ValueError("Invalid preview path")
        relative = unquote(parsed.path, errors="strict").lstrip("/") or "."
        if any(part.startswith(".") or PRIVATE_NAME.match(part) or part.endswith((" ", "."))
               for part in relative.split("/") if part and part != "."):
            raise ValueError("Private preview path")
        return str(safe_path(Path(self.directory), relative))

    def send_head(self):
        try:
            target = Path(self.translate_path(self.path))
            if target.is_dir():
                for name in ("index.html", "index.htm"):
                    index = safe_path(Path(self.directory), (target / name).relative_to(self.directory).as_posix())
                    if index.is_file():
                        break
                else:
                    self.send_error(403, "Directory listing is disabled")
                    return None
            elif target.suffix.lower() not in WEB_SUFFIXES:
                raise ValueError("Unsupported preview resource")
        except (OSError, ValueError, UnicodeError):
            self.send_error(404)
            return None
        return super().send_head()

    def list_directory(self, path):
        self.send_error(403, "Directory listing is disabled")
        return None

    def end_headers(self):
        if self.control_response:
            self.send_header("X-Auto-Company-Preview", self.token)
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def control(self, stop=False):
        if self.headers.get_all("X-Auto-Company-Preview", []) != [self.token]:
            self.send_error(403)
            return
        self.control_response = True
        self.send_response(204)
        self.end_headers()
        if stop:
            threading.Thread(target=self.server.shutdown, daemon=True).start()

    def do_GET(self):
        if not self.request_allowed():
            return
        if self.path == "/.auto-company-health":
            self.control()
        else:
            super().do_GET()

    def do_HEAD(self):
        if self.request_allowed():
            super().do_HEAD()

    def do_POST(self):
        if not self.request_allowed():
            return
        if self.path != "/.auto-company-stop":
            self.send_error(403)
            return
        self.control(stop=True)

    def log_message(self, *args):
        pass


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=os.environ.get("AUTO_COMPANY_ROOT") or Path(__file__).resolve().parents[2])
    parser.add_argument("--project", default=os.environ.get("ACTIVE_PROJECT"))
    sub = parser.add_subparsers(dest="action", required=True)
    sub.add_parser("prompt")
    finish = sub.add_parser("finalize")
    finish.add_argument("--cycle", required=True)
    finish.add_argument("--cleanup-only", action="store_true", help="Close records without starting new media work")
    context = sub.add_parser("context")
    context.add_argument("--cycle", required=True)
    document = sub.add_parser("document")
    document.add_argument("path")
    media = sub.add_parser("media", help="Capture the selected product without running a model")
    media.add_argument("--retry", action="store_true", help="Create a new attempt even when this version was already attempted")
    check = sub.add_parser("check")
    check.add_argument("--report")
    check.add_argument("--adapter", choices=ADAPTERS)
    check.add_argument("command", nargs=argparse.REMAINDER)
    preview = sub.add_parser("preview")
    preview.add_argument("--directory", default=".")
    preview.add_argument("--port", type=int, default=0)
    preview.add_argument("--background", action="store_true", help="Operator-only; inside a cycle keep the foreground tool session open")
    preview.add_argument("--identity", help=argparse.SUPPRESS)
    sub.add_parser("preview-stop")
    args = parser.parse_args()
    root = args.root.resolve()
    if args.action != "prompt" and ((root / ".auto-company-center.json").exists() or (root / ".auto-company-center.json").is_symlink()):
        from center_runner import artifact_admission
        artifact_admission(root, cleanup=args.action == "finalize" and args.cleanup_only)
    if args.action == "prompt":
        print(PROMPT)
        return 0
    if args.action == "finalize":
        finalize(root, args.cycle, capture=not args.cleanup_only)
        return 0
    if args.action == "context":
        write_context(root, args.cycle, args.project or "")
        return 0
    if not isinstance(args.project, str) or not re.fullmatch(r"projects/[a-z0-9][a-z0-9-]*", args.project):
        parser.error("Explicit project identity required")
    project = safe_path(root, args.project)
    if not project.is_dir():
        parser.error("Project does not exist")
    record = base_record(args.project, args.action, root)
    if args.action == "document":
        path = safe_path(project, args.path)
        record.update(path=path.relative_to(root).as_posix(), sha256=fingerprint(path),
                      modifiedAt=datetime.fromtimestamp(path.stat().st_mtime, timezone.utc).isoformat())
        observed = observe(root, record)
        if observed:
            try:
                from product_media import capture_product
                capture_product(root, args.project, record["cycleId"], "delivery")
            except (OSError, ValueError, TypeError):
                pass
        return 0 if observed else 1
    if args.action == "media":
        from product_media import capture_product, media_projection
        capture_product(root, args.project, record["cycleId"], "manual", retry=args.retry)
        projection = media_projection(root, args.project)
        print(json.dumps(projection, ensure_ascii=False))
        return 0 if projection["screenshot"]["state"] == "success" else 1
    if args.action == "check":
        return run_check(root, project, record, args)
    if args.action == "preview" and args.background and record["cycleId"]:
        parser.error("Cycle previews require a persistent foreground tool session; omit --background, keep the session open while checking the printed URL, then use preview-stop")
    if args.action == "preview-stop":
        stopped = True
        for existing in artifact_records(root):
            try:
                if (existing.get("kind") == "preview" and existing.get("project") == args.project and existing.get("state") == "running"
                        and (not record["cycleId"] or existing.get("cycleId") == record["cycleId"])):
                    if preview_request(existing):
                        stopped = preview_request(existing, stop=True) and stopped
            except (OSError, ValueError, TypeError):
                continue
        return 0 if stopped else 1
    directory = safe_path(project, args.directory)
    if not directory.is_dir():
        parser.error("Preview directory does not exist")
    token = uuid.uuid4().hex
    if args.identity:
        if not re.fullmatch(r"[0-9a-f]{32}", args.identity):
            parser.error("Invalid preview identity")
        record["id"] = args.identity
    if args.background:
        command = [sys.executable, str(Path(__file__).resolve()), "--root", str(root), "--project", args.project,
                   "preview", "--directory", args.directory, "--port", str(args.port), "--identity", record["id"]]
        options = {"creationflags": subprocess.CREATE_NO_WINDOW} if os.name == "nt" else {}
        child = subprocess.Popen(command, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, **options)
        target = safe_path(root, f"logs/artifacts/{record['id']}.json")
        deadline = time.monotonic() + 5
        while child.poll() is None and time.monotonic() < deadline:
            try:
                existing = json.loads(bounded_bytes(target))
                if preview_request(existing):
                    print(existing["url"])
                    return 0
            except (OSError, ValueError):
                pass
            time.sleep(0.05)
        if child.poll() is None:
            child.terminate()
            child.wait(timeout=3)
        print("Static preview did not become available", file=sys.stderr)
        return 1

    server = ThreadingHTTPServer(("127.0.0.1", args.port), partial(PreviewHandler, directory=str(directory), token=token))
    record.update(url=f"http://127.0.0.1:{server.server_port}/", token=token, state="running", pid=os.getpid(),
                  lifetime="cycle" if record["cycleId"] else "operator", directory=directory.relative_to(root).as_posix(),
                  startedAt=now(), endedAt=None)
    if (root / ".auto-company-center.json").exists():
        from center_runner import identity
        record["processIdentity"] = identity(os.getpid())
    if not observe(root, record):
        server.server_close()
        return 1
    print(record["url"], flush=True)

    def stop(_sig, _frame):
        raise KeyboardInterrupt

    signal.signal(signal.SIGTERM, stop)
    if hasattr(signal, "SIGHUP"):
        signal.signal(signal.SIGHUP, stop)
    try:
        server.serve_forever(poll_interval=0.2)
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        record.update(state="stopped", endedAt=now(), recordedAt=now())
        observe(root, record)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, ValueError, TypeError) as error:
        print(f"Artifact tool: {error}", file=sys.stderr)
        raise SystemExit(2)
