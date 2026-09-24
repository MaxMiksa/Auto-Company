"""Require success from every selected CI job, including the routing job."""

import json
import os
import sys


JOBS = {
    "runtime": ("windows-config", "python-tests", "macos-runtime", "shell-syntax", "shell-contracts"),
    "browser": ("dashboard-browser",),
    "distribution": ("release-packages",),
    "tabledelta": ("tabledelta",),
    "cuecheck": ("cuecheck",),
    "snapog": ("snapog",),
}


def evaluate(needs):
    errors = []
    rows = []
    if not isinstance(needs, dict):
        return ["CI needs must be a JSON object."], rows
    changes = needs.get("changes", {})
    if not isinstance(changes, dict) or changes.get("result") != "success":
        errors.append("The changes job did not succeed.")
        changes = {}
    outputs = changes.get("outputs", {})
    if not isinstance(outputs, dict):
        outputs = {}
    for route, jobs in JOBS.items():
        selected = outputs.get(route)
        if selected not in ("true", "false"):
            errors.append(f"Missing or invalid {route} route; skipping is not authorized.")
        for job in jobs:
            item = needs.get(job, {})
            result = item.get("result") if isinstance(item, dict) else None
            rows.append((job, selected or "invalid", result or "missing"))
            if selected == "true" and result != "success":
                errors.append(f"Selected job {job} must succeed; got {result!r}.")
            elif selected == "false" and result not in ("success", "skipped"):
                errors.append(f"Unselected job {job} has an unexpected result: {result!r}.")
    known = {"changes"} | {job for jobs in JOBS.values() for job in jobs}
    for job in needs.keys() - known:
        item = needs[job]
        if not isinstance(item, dict) or item.get("result") != "success":
            errors.append(f"Unmapped job {job} did not succeed; it has no explicit skip policy.")
    return errors, rows


def main():
    try:
        errors, rows = evaluate(json.loads(os.environ["CI_NEEDS_JSON"]))
    except (KeyError, ValueError) as exc:
        print(f"CI gate could not read CI_NEEDS_JSON: {exc}", file=sys.stderr)
        return 1
    lines = ["## CI gate", "", "| Job | Selected | Result |", "| --- | --- | --- |"]
    lines.extend(f"| {job} | {selected} | {result} |" for job, selected, result in rows)
    lines.extend(["", "**FAILED**" if errors else "**PASSED**"])
    lines.extend(f"- {error}" for error in errors)
    report = "\n".join(lines) + "\n"
    print(report)
    if os.environ.get("GITHUB_STEP_SUMMARY"):
        with open(os.environ["GITHUB_STEP_SUMMARY"], "a", encoding="utf-8") as stream:
            stream.write(report)
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
