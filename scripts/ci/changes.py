"""Route CI from the event's actual commit range, without shell interpolation."""

import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import sys


ROUTES = ("runtime", "browser", "distribution", "tabledelta", "cuecheck", "snapog")
PRODUCTS = ("tabledelta", "cuecheck", "snapog")
ROOT = Path(__file__).resolve().parents[2]
SHA = re.compile(r"[0-9a-fA-F]{40}(?:[0-9a-fA-F]{24})?\Z")
RUNTIME_FILES = {
    ".gitattributes", ".gitignore", "CLAUDE.md", "ENGINE_ADAPTERS.md",
    "INDEX.md", "Makefile", "PROMPT.md", "package.json", "projects/registry.tsv",
    "setup.ps1", "setup.sh",
}
RUNTIME_PREFIXES = (".claude/", "dashboard/", "i18n/", "memories/", "scripts/", "tests/")
BROWSER_PREFIXES = (
    "dashboard/", "i18n/", "scripts/core/", "scripts/windows/", "scripts/macos/",
    "scripts/wsl/", "scripts/media/", "tests/browser/", "tests/fixtures/",
)
DISTRIBUTION_FILES = {
    "package.json", "setup.ps1", "setup.sh", "docs/install.md",
    "i18n/en/docs/install.md", "tests/test_release_packages.py",
}
DISTRIBUTION_PREFIXES = ("scripts/install/",)


def all_routes():
    return dict.fromkeys(ROUTES, True)


def route_paths(paths):
    selected = dict.fromkeys(ROUTES, False)
    for path in paths:
        if path.startswith((".github/workflows/", ".github/actions/", "scripts/ci/")) or path == "tests/test_ci_policy.py":
            return all_routes()
        product = next((name for name in PRODUCTS if path.startswith(f"projects/{name}/")), None)
        if product:
            selected[product] = True
        runtime = path in RUNTIME_FILES or path.startswith(RUNTIME_PREFIXES) or path.endswith(".sh")
        if runtime:
            selected["runtime"] = True
        if path.startswith(BROWSER_PREFIXES) or path.startswith("tests/test_dashboard") or path == "tests/test_product_media.py":
            selected["browser"] = True
        if path in DISTRIBUTION_FILES or path.startswith(DISTRIBUTION_PREFIXES):
            selected["distribution"] = True
        if product or runtime:
            continue
        # Ordinary prose and presentation assets explicitly need no test jobs.
        if path.endswith(".md") or path.startswith(("docs/", "presentation/")) or path == "LICENSE":
            continue
        # A new build/config area must not silently escape CI coverage.
        return all_routes()
    return selected


def git(repo, *args):
    return subprocess.run(
        ["git", "-C", str(repo), *args], stdout=subprocess.PIPE,
        stderr=subprocess.PIPE, check=False,
    )


def commit_sha(value, field):
    if not isinstance(value, str) or not SHA.fullmatch(value):
        raise ValueError(f"Event has an invalid {field} commit SHA")
    return value.lower()


def changed_paths(repo, base, head):
    result = git(repo, "diff", "--no-ext-diff", "--no-renames", "--name-only", "-z", base, head, "--")
    if result.returncode:
        raise RuntimeError("Git could not compare the event commits")
    # Disabling rename detection preserves BOTH old and new names; -z preserves
    # tabs/newlines and prevents Git's quoted-path representation changing routes.
    return [os.fsdecode(path) for path in result.stdout.split(b"\0") if path]


def select_routes(repo, event_name, event):
    if event_name == "workflow_dispatch":
        return all_routes(), "Manual run: all checks selected.", []
    if event_name == "pull_request":
        pr = event.get("pull_request", {})
        base = commit_sha(pr.get("base", {}).get("sha"), "pull request base")
        head = commit_sha(pr.get("head", {}).get("sha"), "pull request head")
    elif event_name == "push":
        base = commit_sha(event.get("before"), "push before")
        head = commit_sha(event.get("after"), "push after")
    else:
        raise ValueError(f"Unsupported CI event: {event_name!r}")
    for name, commit in (("head", head), ("base", base)):
        if set(commit) == {"0"} or git(repo, "cat-file", "-e", f"{commit}^{{commit}}").returncode:
            return all_routes(), f"Event {name} commit unavailable: conservatively selected all checks.", []
    if event_name == "pull_request":
        ancestor = git(repo, "merge-base", base, head)
        if ancestor.returncode:
            return all_routes(), "No pull request merge base: conservatively selected all checks.", []
        base = commit_sha(ancestor.stdout.decode("ascii").strip(), "merge base")
    paths = changed_paths(repo, base, head)
    selected = route_paths(paths)
    reason = f"Compared {len(paths)} changed path(s)."
    if not any(selected.values()):
        reason += " Documentation-only or empty change: test jobs explicitly skipped."
    return selected, reason, paths


def append_summary(selected, reason):
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        lines = ["## CI change routing", "", reason, "", "| Check group | Selected |", "| --- | --- |"]
        lines.extend(f"| {name} | {str(value).lower()} |" for name, value in selected.items())
        with open(summary, "a", encoding="utf-8") as stream:
            stream.write("\n".join(lines) + "\n")


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", type=Path, default=ROOT)
    parser.add_argument("--event-name", default=os.environ.get("GITHUB_EVENT_NAME"))
    parser.add_argument("--event-path", type=Path, default=os.environ.get("GITHUB_EVENT_PATH"))
    args = parser.parse_args(argv)
    try:
        if args.event_path is None:
            raise ValueError("GITHUB_EVENT_PATH is required")
        event = json.loads(args.event_path.read_text(encoding="utf-8"))
        if not isinstance(event, dict):
            raise ValueError("The GitHub event must be a JSON object")
        selected, reason, paths = select_routes(args.repo, args.event_name, event)
        output = "".join(f"{name}={str(value).lower()}\n" for name, value in selected.items())
        if os.environ.get("GITHUB_OUTPUT"):
            with open(os.environ["GITHUB_OUTPUT"], "a", encoding="utf-8") as stream:
                stream.write(output)
        print(reason)
        print(json.dumps(paths, ensure_ascii=True))
        print(output, end="")
        append_summary(selected, reason)
        return 0
    except (OSError, ValueError, RuntimeError, AttributeError) as exc:
        print(f"CI routing failed: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
