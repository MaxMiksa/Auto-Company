"""Runs after the kernel boundary is established. No host paths are available."""
import json
import os
from pathlib import Path
import subprocess
import sys


def main():
    # A marker is diagnostic only. Callers must not treat an environment value
    # as authority to skip isolation at a host execution boundary.
    settings = json.loads(Path("/run/auto-company/command.json").read_text())
    proxy = subprocess.Popen(["/usr/bin/python3", "/run/auto-company/isolation_proxy.py"],
                             stdin=subprocess.DEVNULL)
    try:
        try:
            process = subprocess.Popen(settings["command"], cwd=settings["cwd"], env=settings["env"])
        except OSError as error:
            Path("/run/auto-company/launch.json").write_text(json.dumps({"started": False}))
            print(f"Isolated command could not start: {error}", file=sys.stderr)
            return 127
        Path("/run/auto-company/launch.json").write_text(json.dumps({"started": True}))
        return process.wait()
    finally:
        proxy.terminate()
        proxy.wait()


if __name__ == "__main__":
    sys.exit(main())
