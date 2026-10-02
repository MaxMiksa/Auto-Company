"""Prepare the smallest company view, run an engine, and collect bounded output.

Framework control code is never collected back. Old examples, other products,
parent evaluations, shared HOME, settings, MCPs and session history are absent.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import sys
import tempfile

from project_isolation import IsolationError, checked_tree, run_isolated, runtime_binary
from product_identity import empty_state, read_state, transaction, validate_state, safe_path

HERE = Path(__file__).resolve().parent
TEMPLATES = json.loads((HERE / "isolation-runtime-files.json").read_text(encoding="utf-8-sig"))


def regular_bytes(path):
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        info = os.fstat(descriptor)
        if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
            raise IsolationError("Only private regular files may cross the isolation boundary")
        with os.fdopen(descriptor, "rb", closefd=False) as stream:
            return stream.read()
    finally:
        os.close(descriptor)


def copy_tree(source, target):
    source, target = Path(source), Path(target)
    checked_tree(source)
    target.mkdir(parents=True, exist_ok=True)
    # Directory descriptors would also guard a concurrent hostile host writer.
    # Host-side writers are excluded by the runtime ownership contract; all
    # untrusted descendants have exited before collection starts.
    for folder, directories, files in os.walk(source, followlinks=False):
        relative = Path(folder).relative_to(source)
        for name in directories + files:
            incoming, outgoing = Path(folder) / name, target / relative / name
            info = incoming.lstat()
            if stat.S_ISLNK(info.st_mode):
                outgoing.symlink_to(os.readlink(incoming), target_is_directory=incoming.is_dir())
            elif stat.S_ISDIR(info.st_mode):
                outgoing.mkdir(exist_ok=True)
            elif stat.S_ISREG(info.st_mode):
                outgoing.write_bytes(regular_bytes(incoming))
                outgoing.chmod(info.st_mode & 0o777)
    checked_tree(target)


def fingerprint(root):
    checked_tree(root)
    digest = hashlib.sha256()
    for folder, directories, files in os.walk(root, followlinks=False):
        directories.sort()
        for name in sorted(directories + files):
            path = Path(folder) / name
            info = path.lstat()
            digest.update(path.relative_to(root).as_posix().encode())
            digest.update(str(info.st_mode).encode())
            if stat.S_ISLNK(info.st_mode):
                digest.update(os.readlink(path).encode())
            elif stat.S_ISREG(info.st_mode):
                digest.update(hashlib.sha256(regular_bytes(path)).digest())
    return digest.hexdigest()


def write_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def durable_json(path, data):
    temporary = path.with_name(path.name + ".tmp")
    with temporary.open("w", encoding="utf-8") as stream:
        json.dump(data, stream)
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temporary, path)


def collect_transaction(root, ready, replacements):
    """Journal each rename. Interrupted collection blocks further execution."""
    marker = safe_path(root, ".auto-company/isolation-pending.json")
    if marker.exists():
        raise IsolationError("Interrupted isolation collection requires recovery after stopping writers")
    operations = []
    for index, (source, target) in enumerate(replacements):
        target = safe_path(root, Path(target).relative_to(root))
        backup = ready / f"previous-{index}"
        operations.append({"source": str(Path(source).relative_to(root)), "target": str(target.relative_to(root)),
                           "backup": str(backup.relative_to(root)), "existed": target.exists(), "started": False})
    journal = {"version": 1, "status": "applying", "operations": operations}
    durable_json(marker, journal)
    try:
        for operation in operations:
            source = safe_path(root, operation["source"])
            target = safe_path(root, operation["target"])
            backup = safe_path(root, operation["backup"])
            target.parent.mkdir(parents=True, exist_ok=True)
            operation["started"] = True
            durable_json(marker, journal)
            if operation["existed"]:
                target.rename(backup)
            source.rename(target)
        journal["status"] = "committed"
        durable_json(marker, journal)
        marker.rename(ready / "collection.json")
    except BaseException:
        # Preserve both the candidate and original. Recovery is an explicit
        # stopped-writer operation; never silently discard partial work.
        raise IsolationError("Collection interrupted; stop writers and use isolation_workspace.py --recover --root <runtime>") from None


def recover_collection(root):
    root = Path(root).resolve()
    pid_file = safe_path(root, ".auto-loop.pid")
    if pid_file.exists():
        try:
            os.kill(int(regular_bytes(pid_file)), 0)
        except (ProcessLookupError, ValueError):
            pass
        else:
            raise IsolationError("Stop the loop before recovering isolated output")
    marker = safe_path(root, ".auto-company/isolation-pending.json")
    if not marker.exists():
        return
    journal = json.loads(regular_bytes(marker))
    if journal.get("version") != 1 or journal.get("status") not in ("applying", "committed"):
        raise IsolationError("Invalid isolation recovery journal")
    for operation in reversed(journal["operations"]):
        if not operation["started"] or journal["status"] == "committed":
            continue
        source, target, backup = (safe_path(root, operation[key]) for key in ("source", "target", "backup"))
        # Sources/backups are always in the private collection store. Refuse
        # a malformed journal instead of treating it as filesystem authority.
        for path in (source, backup):
            path.relative_to(root / ".auto-company/isolation")
        if backup.exists():
            if target.exists():
                target.rename(source.with_name(source.name + ".rejected"))
            backup.rename(target)
        elif not operation["existed"] and target.exists() and not source.exists():
            target.rename(source)
    marker.rename(marker.with_name("isolation-recovered-" + str(os.getpid()) + ".json"))
    lock = safe_path(root, ".auto-company/product-state.lock")
    if lock.is_dir():
        lock.rmdir()


def filtered_state(state, project, cycle):
    result = empty_state()
    identity = state["paths"].get(project) if project else state.get("explorationId")
    wanted = {identity} if identity else set()
    if identity:
        item = state["identities"][identity]
        wanted.update(value for value in (item.get("explorationId"), item.get("linkedProductId")) if value)
    result["identities"] = {key: value for key, value in state["identities"].items() if key in wanted}
    result["paths"] = {key: value for key, value in state["paths"].items() if value in wanted}
    result["cycles"] = {key: value for key, value in state["cycles"].items() if key == cycle}
    for key in ("explorationId", "continuationProductId"):
        result[key] = state.get(key) if state.get(key) in wanted else None
    return result


def sanitize_git(project):
    metadata = project / ".git"
    if not metadata.exists():
        return
    if not metadata.is_dir() or metadata.is_symlink():
        raise IsolationError("Product Git metadata must be independent")
    # Object history and refs remain intact. No model-produced hooks, helper,
    # alternates, includeIf, fsmonitor or external worktree configuration can
    # become a command/file read in the trusted host's later git inspection.
    for name in ("hooks", "objects/info/alternates", "objects/info/http-alternates", "commondir", "gitdir", "worktrees"):
        path = metadata / name
        if path.is_symlink() or path.is_file():
            path.unlink()
        elif path.is_dir():
            shutil.rmtree(path)
    (metadata / "config").write_text("[core]\n\trepositoryformatversion = 0\n\tfilemode = true\n\tbare = false\n\tlogallrefupdates = true\n\thooksPath = /dev/null\n\tfsmonitor = false\n", encoding="utf-8")


class CompanyView:
    def __init__(self, root, project, cycle):
        self.root = Path(root).resolve()
        if safe_path(self.root, ".auto-company/isolation-pending.json").exists():
            raise IsolationError("Interrupted isolation collection requires stopped-writer recovery")
        if project and not re.fullmatch(r"projects/[a-z0-9][a-z0-9-]*", project):
            raise IsolationError("Invalid selected project")
        if cycle and not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]{0,127}", cycle):
            raise IsolationError("Invalid cycle")
        self.project, self.cycle = project, cycle
        self.state = read_state(root)
        identity = self.state["paths"].get(project) if project else self.state.get("explorationId")
        self.scope = identity or hashlib.sha256(project.encode()).hexdigest()[:32]
        self.store = safe_path(self.root, ".auto-company/isolation/" + self.scope)
        self.store.mkdir(parents=True, exist_ok=True)
        self.active_record = self.store / "active-run.json"
        if self.active_record.exists():
            prior = json.loads(regular_bytes(self.active_record))
            pid = prior.get("pid")
            alive = False
            if type(pid) is int and pid > 0:
                try:
                    current = Path(f"/proc/{pid}/stat").read_text().rsplit(")", 1)[1].split()[19]
                    alive = current == prior.get("processStart")
                except OSError:
                    pass
            if alive:
                raise IsolationError("This project already has an isolated writer")
            self.active_record.rename(self.store / ("retained-" + str(prior.get("pid")) + "-" + str(self.active_record.stat().st_mtime_ns) + ".json"))
        # Native Linux temporary storage avoids a shared Windows drive-backed
        # /tmp, retains files for interrupted collection, and has mode 0700.
        self.folder = Path(tempfile.mkdtemp(prefix="auto-company-view-"))
        self.workspace = self.folder / "workspace"
        self.workspace.mkdir()
        self.home = self.folder / "home"
        self.home.mkdir()
        self.before = {}
        self.initial = filtered_state(self.state, project, cycle)
        self.collected = False
        self.retain_view = False

    def prepare(self):
        start = Path(f"/proc/{os.getpid()}/stat").read_text().rsplit(")", 1)[1].split()[19] if sys.platform == "linux" else "unknown"
        durable_json(self.active_record, {"pid": os.getpid(), "processStart": start, "cycle": self.cycle,
                                         "view": str(self.folder), "project": self.project})
        for name in TEMPLATES:
            source, target = self.root / name, self.workspace / name
            if source.is_file():
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(regular_bytes(source))
                target.chmod(source.stat().st_mode & 0o777)
            else:
                raise IsolationError("Runtime template is incomplete: " + name)
        # Do not load repository-authored Codex MCP/hook/plugin configuration.
        # Role prompts are public framework resources, not user plugin config.
        for name in ("projects", "memories", "docs", "logs", ".auto-company"):
            (self.workspace / name).mkdir(exist_ok=True)
        registry = self.root / "projects/registry.tsv"
        lines = regular_bytes(registry).decode().splitlines() if registry.exists() else ["name\tpath\tlifecycle\tcreated_at_utc"]
        rows = [lines[0]] + [line for line in lines[1:] if self.project and line.split("\t")[1:2] == [self.project]]
        (self.workspace / "projects/registry.tsv").write_text("\n".join(rows) + "\n")
        if self.project:
            source = safe_path(self.root, self.project)
            self.before[self.project] = fingerprint(source)
            copy_tree(source, self.workspace / self.project)
            sanitize_git(self.workspace / self.project)
        consensus = self.root / "memories/consensus.md"
        if consensus.exists():
            self.consensus_before = regular_bytes(consensus)
            previous = [row for key, row in self.state["cycles"].items() if key != self.cycle]
            previous.sort(key=lambda row: row["reservedAt"])
            owner = self.state["identities"].get(previous[-1]["identityId"], {}) if previous else {}
            same_scope = (owner.get("id") == self.scope or owner.get("linkedProductId") == self.scope
                          or owner.get("explorationId") == self.scope)
            scoped = self.store / "consensus.md"
            if same_scope:
                self.consensus_input = self.consensus_before
            else:
                spec = importlib.util.spec_from_file_location("isolation_consensus", HERE / "consensus-format.py")
                rules = importlib.util.module_from_spec(spec)
                spec.loader.exec_module(rules)
                protected = rules.sections(consensus)
                # Human constraints and unresolved governance remain exact.
                # Unattributed legacy product prose is never guessed to belong
                # to a newly selected product.
                body = regular_bytes(scoped) if scoped.exists() else b"# Auto Company Consensus\n\n## Current Phase\nIsolated project start\n\n"
                if scoped.exists():
                    old = rules.sections(scoped)
                    for heading in rules.HEADINGS:
                        body = body.replace(old[heading], protected[heading])
                else:
                    body += protected[rules.HEADINGS[0]] + protected[rules.HEADINGS[1]]
                self.consensus_input = body
            (self.workspace / "memories/consensus.md").write_bytes(self.consensus_input)
        else:
            self.consensus_before = None
            self.consensus_input = None
        # Only this product's previously collected working documents return.
        if (self.store / "docs").is_dir():
            copy_tree(self.store / "docs", self.workspace / "docs")
        write_json(self.workspace / ".auto-company/product-state.json", self.initial)
        configuration = []
        if self.project:
            configuration.append("ACTIVE_PROJECT=" + self.project)
        from localization import read_settings
        _, settings = read_settings(self.root)
        for key, value in settings.items():
            if key in ("AUTO_COMPANY_LANGUAGE", "AUTO_COMPANY_PRODUCT_ID", "AUTO_COMPANY_PRODUCT_LANGUAGE", "AUTO_COMPANY_PRODUCT_STATUS"):
                configuration.append(f"{key}={value}")
        (self.workspace / ".auto-company.local").write_text("\n".join(configuration) + "\n")
        (self.workspace / ".gitignore").write_text("projects/*\n.auto-company/\nlogs/\n")
        subprocess.run(["git", "init", "-q", str(self.workspace)], check=True, env={"PATH": "/usr/bin:/bin", "HOME": str(self.home), "GIT_CONFIG_NOSYSTEM": "1"})
        if self.cycle:
            context = self.root / "logs" / f"{self.cycle}.context.json"
            if context.exists():
                (self.workspace / "logs" / context.name).write_bytes(regular_bytes(context))

    def authentication(self, engine):
        if engine == "codex":
            original = Path(os.environ.get("CODEX_HOME", str(Path.home() / ".codex"))) / "auth.json"
            target = self.home / ".codex"
            target.mkdir()
            if original.exists():
                # Copy the single authentication record; never config, skills,
                # plugins, MCP servers, SQLite state or session directories.
                (target / "auth.json").write_bytes(regular_bytes(original))
            (target / "config.toml").write_text('approval_policy = "never"\nsandbox_mode = "danger-full-access"\n[features]\nmulti_agent = true\n')
        elif engine == "claude":
            original = Path.home() / ".claude/.credentials.json"
            if original.exists():
                target = self.home / ".claude"
                target.mkdir()
                (target / ".credentials.json").write_bytes(regular_bytes(original))

    def collect(self):
        checked_tree(self.workspace)
        expected_roots = {Path(name).parts[0] for name in TEMPLATES} | {
            "projects", "memories", "docs", "logs", ".auto-company", ".auto-company.local", ".git", ".gitignore", "prompt.txt"}
        uncollected = sorted(path.name for path in self.workspace.iterdir() if path.name not in expected_roots)
        self.retain_view = bool(uncollected)
        incoming = read_state(self.workspace)
        additions = {key: value for key, value in incoming["identities"].items() if key not in self.initial["identities"]}
        if len(additions) > 1 or (self.project and additions):
            raise IsolationError("Only one new product may be registered by an exploration cycle")
        expected = json.loads(json.dumps(self.initial))
        projects = [self.project] if self.project else []
        for identity, item in additions.items():
            project = item["project"]
            if item["kind"] != "product" or item["lastCycleNumber"] != 0 or project in self.state["paths"] or (self.root / project).exists():
                raise IsolationError("Invalid new product registration")
            expected["identities"][identity] = item
            expected["paths"][project] = identity
            if self.cycle:
                row = expected["cycles"][self.cycle]
                owner = expected["identities"][row["identityId"]]
                if owner["kind"] != "exploration":
                    raise IsolationError("Product creation requires an exploration owner")
                owner["linkedProductId"] = identity
                row["createdProductIds"] = [identity]
                expected["continuationProductId"] = identity
            projects.append(project)
        if incoming != expected:
            raise IsolationError("Untrusted changes to existing identity/selection state refused")
        validate_state(incoming)
        for project, digest in self.before.items():
            if fingerprint(safe_path(self.root, project)) != digest:
                raise IsolationError("Product changed on host during isolated execution; output retained for recovery")
        consensus = self.root / "memories/consensus.md"
        if (regular_bytes(consensus) if consensus.exists() else None) != self.consensus_before:
            raise IsolationError("Consensus changed on host; output retained for recovery")
        # Prepare validated replacement trees before changing any host target.
        ready = self.store / ("collect-" + self.folder.name)
        ready.mkdir()
        for project in projects:
            candidate = self.workspace / project
            sanitize_git(candidate)
            copy_tree(candidate, ready / Path(project).name)
            original_git = self.root / project / ".git"
            collected_git = ready / Path(project).name / ".git"
            if original_git.is_dir() and collected_git.is_dir():
                # Keep existing operator remotes and hooks on the host only.
                # Neither was available to the model or replaced by its output.
                if (original_git / "config").is_file():
                    (collected_git / "config").write_bytes(regular_bytes(original_git / "config"))
                if (original_git / "hooks").is_dir():
                    copy_tree(original_git / "hooks", collected_git / "hooks")
        replacements = [(ready / Path(project).name, self.root / project) for project in projects]
        state = json.loads(json.dumps(self.state))
        for identity, item in additions.items():
            state["identities"][identity] = item
            state["paths"][item["project"]] = identity
        if additions and self.cycle:
            state["cycles"][self.cycle] = incoming["cycles"][self.cycle]
            owner = incoming["cycles"][self.cycle]["identityId"]
            state["identities"][owner] = incoming["identities"][owner]
            state["continuationProductId"] = incoming["continuationProductId"]
        validate_state(state)
        if additions:
            original = regular_bytes(self.root / "projects/registry.tsv").decode()
            rows = regular_bytes(self.workspace / "projects/registry.tsv").decode().splitlines()[1:]
            for item in additions.values():
                matching = [row for row in rows if row.split("\t")[1:2] == [item["project"]]]
                if len(matching) != 1 or len(matching[0].split("\t")) != 4:
                    raise IsolationError("Invalid new product registry row")
                original += matching[0] + "\n"
            (ready / "registry.tsv").write_text(original)
            replacements.append((ready / "registry.tsv", self.root / "projects/registry.tsv"))
        candidate = self.workspace / "memories/consensus.md"
        if candidate.exists():
            data = regular_bytes(candidate)
            (ready / "consensus.md").write_bytes(data)
            (ready / "scope-consensus.md").write_bytes(data)
            replacements += [(ready / "consensus.md", consensus), (ready / "scope-consensus.md", self.store / "consensus.md")]
        docs = self.store / "docs"
        copy_tree(self.workspace / "docs", ready / "docs")
        replacements.append((ready / "docs", docs))
        # Artifact JSON is data, never a command passed back to a host shell.
        for folder, _, files in os.walk(self.workspace / "logs"):
            for name in files:
                source = Path(folder) / name
                relative = source.relative_to(self.workspace)
                permitted = ((source.parent == self.workspace / "logs" and name == self.cycle + ".events.jsonl")
                             or (source.parent == self.workspace / "logs/artifacts" and re.fullmatch(r"[0-9a-f]{32}\.json", name)))
                if not permitted:
                    continue
                data = regular_bytes(source)
                if source.parent.name == "artifacts":
                    record = json.loads(data)
                    if record.get("cycleId") != self.cycle or record.get("project") not in projects:
                        raise IsolationError("Artifact does not belong to this isolated cycle")
                    if record.get("kind") == "preview" and record.get("state") == "running":
                        # Its loopback belongs to the exited network namespace.
                        # Never ask a same-port host service to health-check or
                        # stop a model-authored preview record after collection.
                        observed = ready / "original-preview-records" / name
                        observed.parent.mkdir(exist_ok=True)
                        observed.write_bytes(data)
                        record.update(state="stopped", isolationState="namespace_ended")
                        data = (json.dumps(record, ensure_ascii=False) + "\n").encode()
                target = safe_path(self.root, relative)
                if target.exists():
                    raise IsolationError("An isolated cycle cannot overwrite existing observations")
                staged = ready / relative
                staged.parent.mkdir(parents=True, exist_ok=True)
                staged.write_bytes(data)
                replacements.append((staged, target))
        session_target = self.store / ("sessions-" + (self.cycle or self.folder.name))
        if (self.home / ".codex/sessions").is_dir():
            copy_tree(self.home / ".codex/sessions", ready / "sessions")
            replacements.append((ready / "sessions", session_target))
        write_json(ready / "last-run.json", {"backend": "bubblewrap", "scope": self.scope,
                   "cycle": self.cycle, "workspace": str(self.folder), "collected": True,
                   "project": self.project, "sessions": str(session_target), "uncollectedRootOutputs": uncollected})
        write_json(ready / "product-state.json", state)
        replacements += [(ready / "last-run.json", self.store / "last-run.json"),
                         (ready / "product-state.json", self.root / ".auto-company/product-state.json")]
        lock = safe_path(self.root, ".auto-company/product-state.lock")
        lock.mkdir()
        try:
            if read_state(self.root) != self.state:
                raise IsolationError("Host identity changed during isolated execution")
            collect_transaction(self.root, ready, replacements)
        finally:
            lock.rmdir()
        self.collected = True


def run_engine(root, project, engine, binary, prompt, model="", effort="", interactive=False, language=None):
    runtime_binary()  # Refuse before making a view when the boundary is absent.
    if engine not in ("codex", "claude", "cursor", "openai-compatible"):
        raise IsolationError("Unsupported engine")
    cycle = os.environ.get("AUTO_COMPANY_CYCLE_ID", "")
    view = CompanyView(root, project, cycle)
    try:
        view.prepare()
        view.authentication(engine)
        # Match a complete path prefix, not an unrelated sibling whose name
        # begins with the runtime's basename (for example run vs run-other).
        prompt = re.sub(re.escape(str(Path(root).resolve())) + r"(?=$|[/\s`\"'])", "/workspace", prompt)
        if view.consensus_before is not None:
            prompt = prompt.replace(view.consensus_before.decode(), view.consensus_input.decode())
        env = {key: value for key, value in os.environ.items() if key in
               ("AUTO_COMPANY_CYCLE", "AUTO_COMPANY_CYCLE_ID", "AUTO_COMPANY_LANGUAGE",
                "AUTO_COMPANY_STABLE_PRODUCT_ID", "AUTO_COMPANY_PRODUCT_CYCLE_NUMBER")}
        env.update(AUTO_COMPANY_ROOT="/workspace", ACTIVE_PROJECT=project,
                   ACTIVE_PROJECT_PATH="/workspace/" + project if project else "")
        if language is not None:
            env["AUTO_COMPANY_LANGUAGE"] = language
        native = binary
        if engine == "codex":
            command = ["/opt/engine/agent"]
            if not interactive:
                command += ["exec", "--json", "--skip-git-repo-check", "-o", "/workspace/logs/last-message.txt"]
            mode = os.environ.get("CODEX_SANDBOX_MODE", "danger-full-access")
            if mode not in ("read-only", "workspace-write", "danger-full-access"):
                raise IsolationError("Invalid inner Codex sandbox mode")
            command += ["-c", f'sandbox_mode="{mode}"', "-c", 'approval_policy="never"']
            if model:
                command += ["-m", model]
            if effort:
                command += ["-c", f'model_reasoning_effort="{effort}"']
            command.append(prompt)
            for key in ("OPENAI_API_KEY", "CODEX_API_KEY"):
                if os.environ.get(key):
                    env[key] = os.environ[key]
            if cycle:
                command = ["/usr/bin/python3", "/workspace/scripts/core/runtime_events.py", "--root", "/workspace", "--cycle", cycle, "--", *command]
        elif engine == "claude":
            command = ["/opt/engine/agent"] + ([] if interactive else ["-p", "--output-format", "json"])
            if model:
                command += ["--model", model]
            if os.environ.get("CLAUDE_PERMISSION_MODE"):
                command += ["--permission-mode", os.environ["CLAUDE_PERMISSION_MODE"]]
            command += [prompt]
            for key in ("ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"):
                if os.environ.get(key):
                    env[key] = os.environ[key]
        elif engine == "cursor":
            raise IsolationError("Cursor native engine packaging/authentication is not yet verified; execution refused")
        else:
            native = None
            (view.workspace / "prompt.txt").write_text(prompt)
            command = ["/usr/bin/python3", "/workspace/scripts/core/openai-compatible-agent.py", "--endpoint", os.environ["OPENAI_COMPATIBLE_ENDPOINT"],
                       "--model", model, "--workspace", "/workspace", "--prompt-file", "/workspace/prompt.txt",
                       "--request-timeout", os.environ.get("OPENAI_COMPATIBLE_REQUEST_TIMEOUT_SECONDS", "120"),
                       "--max-turns", os.environ.get("OPENAI_COMPATIBLE_MAX_TURNS", "12")]
            for key, value in os.environ.items():
                if key.startswith("OPENAI_COMPATIBLE_"):
                    env[key] = value
        readonly = [(view.workspace / name, "/workspace/" + name) for name in ("scripts", ".claude", "i18n", "Makefile", ".auto-company.local") if (view.workspace / name).exists()]
        dependencies = Path(root) / "scripts/media/node_modules"
        if dependencies.is_dir():
            (view.workspace / "scripts/media/node_modules").mkdir(parents=True, exist_ok=True)
            readonly.append((dependencies, "/workspace/scripts/media/node_modules"))
        browsers = os.environ.get("AUTO_COMPANY_BROWSER_RUNTIME")
        if browsers:
            for child in Path(browsers).iterdir():
                if child.is_dir() and re.fullmatch(r"(?:chromium|chromium_headless_shell|ffmpeg)-[0-9]+", child.name):
                    readonly.append((child, "/opt/browsers/" + child.name))
            env["PLAYWRIGHT_BROWSERS_PATH"] = "/opt/browsers"
        code = run_isolated(command, view.workspace, home=view.home, engine=native, environment=env,
                            readonly=readonly, interactive=interactive)
        last_message = view.workspace / "logs/last-message.txt"
        if engine == "codex" and last_message.exists():
            message = regular_bytes(last_message).decode("utf-8", errors="replace")
            print(json.dumps({"type": "item.completed", "item": {"id": "auto-company-last-message",
                  "type": "agent_message", "text": message}}, ensure_ascii=False), flush=True)
        view.collect()
        return code
    finally:
        if view.collected:
            view.active_record.unlink(missing_ok=True)
            if view.retain_view:
                print(f"Additional framework-root outputs retained at: {view.folder}", file=sys.stderr)
            else:
                shutil.rmtree(view.folder)
        else:
            if view.active_record.exists():
                view.active_record.rename(view.store / ("retained-" + view.folder.name + ".json"))
            print(f"Isolated output retained for recovery: {view.folder}", file=sys.stderr)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--project", default="")
    parser.add_argument("--engine")
    parser.add_argument("--binary")
    parser.add_argument("--model", default="")
    parser.add_argument("--effort", default="")
    parser.add_argument("--interactive", action="store_true")
    parser.add_argument("--recover", action="store_true")
    parser.add_argument("prompt", nargs="?")
    args = parser.parse_args()
    if args.recover:
        recover_collection(args.root)
        return 0
    if not args.engine or not args.binary or args.prompt is None:
        parser.error("--engine, --binary and prompt are required for execution")
    return run_engine(args.root, args.project, args.engine, args.binary, args.prompt, args.model, args.effort, args.interactive)


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (IsolationError, OSError, ValueError, subprocess.SubprocessError) as error:
        print(f"Project isolation refused execution/collection: {error}", file=sys.stderr)
        sys.exit(78)
