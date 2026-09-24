"""Small runtime boundary for managed-install maintenance and active writers."""

import argparse
from contextlib import contextmanager
import json
import os
from pathlib import Path
import platform
import sys
import uuid


def _language(root):
    # Do not acquire the configuration lock: its owner also calls this guard.
    try:
        for line in (root / ".auto-company.local").read_text(encoding="utf-8").splitlines():
            if line.startswith("AUTO_COMPANY_LANGUAGE="):
                return line.partition("=")[2]
    except (OSError, UnicodeError):
        pass
    try:
        return json.loads((root / ".auto-company/install.json").read_text(encoding="utf-8")).get("language", "en")
    except (OSError, UnicodeError, ValueError, AttributeError):
        return "en"


def check_maintenance(root):
    root = Path(root)
    marker = root / ".auto-company/maintenance.json"
    if marker.exists() or marker.is_symlink():
        if _language(root) == "zh-CN":
            raise ValueError("安装维护尚未完成。请先使用安装管理器恢复或完成更新，再启动或修改配置。")
        raise ValueError("Installation maintenance is unfinished. Recover or finish the update before starting or changing configuration.")


def _process_start():
    try:
        if sys.platform == "linux":
            return Path("/proc/self/stat").read_text().rsplit(")", 1)[1].split()[19]
        if os.name == "nt":
            import ctypes
            from ctypes import wintypes
            kernel = ctypes.WinDLL("kernel32", use_last_error=True)
            kernel.GetCurrentProcess.restype = wintypes.HANDLE
            kernel.GetProcessTimes.argtypes = [wintypes.HANDLE] + [ctypes.POINTER(wintypes.FILETIME)] * 4
            times = [wintypes.FILETIME() for _ in range(4)]
            if kernel.GetProcessTimes(kernel.GetCurrentProcess(), *(ctypes.byref(value) for value in times)):
                return str((times[0].dwHighDateTime << 32) | times[0].dwLowDateTime)
    except (OSError, ValueError, IndexError):
        pass
    return "unknown"


@contextmanager
def writer_lease(root, kind="dashboard"):
    """Register before rechecking maintenance, closing the startup/scan race."""
    root = Path(root)
    check_maintenance(root)
    state = root / ".auto-company"
    metadata = state / "install.json"
    if not metadata.exists():
        yield
        return
    writers = state / "writers"
    if state.is_symlink() or metadata.is_symlink() or writers.is_symlink():
        if _language(root) == "zh-CN":
            raise ValueError("托管安装的进程登记路径不能是符号链接。")
        raise ValueError("Managed installation writer paths must not be symlinks.")
    writers.mkdir(exist_ok=True)
    identity = uuid.uuid4().hex
    record = writers / f"{identity}.json"
    data = {"schema": 1, "pid": os.getpid(), "host": platform.system().lower(),
            "kind": kind, "process_start": _process_start()}
    try:
        with record.open("x", encoding="utf-8") as output:
            json.dump(data, output)
        check_maintenance(root)
        yield
    finally:
        record.unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("check", "project"))
    parser.add_argument("--root", type=Path, required=True)
    args, remainder = parser.parse_known_args()
    if remainder[:1] == ["--"]:
        remainder = remainder[1:]
    if args.command == "check" and remainder:
        parser.error("unexpected arguments")
    try:
        check_maintenance(args.root)
        if args.command == "project":
            with writer_lease(args.root, kind="project-command"):
                os.environ["AUTO_COMPANY_PROJECT_WRITER"] = str(os.getpid())
                # A successful exec keeps this lease for the command lifetime.
                # Afterwards process identity proves the leftover record stale.
                script = args.root / "scripts/core/project.sh"
                os.execv("/bin/bash", ["/bin/bash", str(script), *remainder])
    except ValueError as error:
        print(str(error), file=sys.stderr)
        return 78
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
