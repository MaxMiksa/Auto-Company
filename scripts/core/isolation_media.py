"""Isolate the browser AND every product-declared preview subprocess."""
import argparse
import json
import os
import re
from pathlib import Path
import shutil
import sys
import tempfile

from isolation_workspace import copy_tree, regular_bytes
from project_isolation import IsolationError, run_isolated


def run(request_path):
    request_path = Path(request_path)
    request = json.loads(regular_bytes(request_path))
    original_output = Path(request["output"])
    project = Path(request["project"])
    framework = Path(__file__).resolve().parents[2]
    with tempfile.TemporaryDirectory(prefix="auto-company-media-") as temporary:
        view = Path(temporary) / "workspace"
        view.mkdir()
        copy_tree(project, view / "project")
        (view / "output").mkdir()
        (view / "scripts/core").mkdir(parents=True)
        (view / "scripts/core/product_media_worker.cjs").write_bytes(regular_bytes(framework / "scripts/core/product_media_worker.cjs"))
        request.update(project="/workspace/project", output="/workspace/output", isolatedExit=True)
        (view / "request.json").write_text(json.dumps(request))
        readonly = []
        dependencies = framework / "scripts/media/node_modules"
        if not dependencies.is_dir():
            dependencies = framework / "tests/browser/node_modules"
        if not dependencies.is_dir():
            raise IsolationError("Project media needs framework-local Playwright dependencies")
        readonly.append((dependencies, "/workspace/scripts/media/node_modules"))
        browser = os.environ.get("AUTO_COMPANY_BROWSER_RUNTIME")
        if not browser:
            raise IsolationError("AUTO_COMPANY_BROWSER_RUNTIME must name a reviewed, browser-only Playwright runtime directory")
        for child in Path(browser).iterdir():
            if child.is_dir() and re.fullmatch(r"(?:chromium|chromium_headless_shell|ffmpeg)-[0-9]+", child.name):
                readonly.append((child, "/opt/browsers/" + child.name))
        code = run_isolated(["/usr/bin/node", "/workspace/scripts/core/product_media_worker.cjs", "/workspace/request.json"],
                            view, readonly=readonly, environment={"PLAYWRIGHT_BROWSERS_PATH": "/opt/browsers"})
        if code:
            return code
        for name in ("result.json", "desktop.png", "mobile.png"):
            source = view / "output" / name
            if source.exists():
                (original_output / name).write_bytes(regular_bytes(source))
        return 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("request")
    try:
        sys.exit(run(parser.parse_args().request))
    except (OSError, ValueError) as error:
        print(f"Isolated media refused: {error}", file=sys.stderr)
        sys.exit(78)
