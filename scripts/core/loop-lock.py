#!/usr/bin/env python3
"""Acquire an advisory lock on the persistent PID-file inode, then exec Bash."""

import fcntl
import os
from pathlib import Path
import shlex
import signal
import subprocess
import sys
import time


def stop(pid_file: str, script: str, wait_seconds: str = "0") -> int:
    descriptor = os.open(pid_file, os.O_RDWR | os.O_CREAT, 0o600)
    try:
        fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        pass
    else:
        os.ftruncate(descriptor, 0)
        print("No running loop owns this checkout.")
        return 0
    value = Path(pid_file).read_text().strip()
    if not value.isdigit() or int(value) < 2:
        print("Loop is starting; the stop flag will be checked before its next cycle.")
        return 0
    pid = int(value)
    target = str(Path(script).resolve())
    process_fd = None
    try:
        if sys.platform == "linux":
            process_fd = os.pidfd_open(pid)
            argv = Path(f"/proc/{pid}/cmdline").read_bytes().decode().split("\0")
        else:
            argv = shlex.split(subprocess.check_output(
                ["ps", "-p", str(pid), "-o", "command="], text=True
            ).strip())
        if target not in argv:
            print("PID file does not identify this checkout's loop; refusing to signal it.", file=sys.stderr)
            return 1
        if process_fd is not None:
            signal.pidfd_send_signal(process_fd, signal.SIGTERM)
        else:
            os.kill(pid, signal.SIGTERM)
        print(f"Sent SIGTERM to the owned loop (PID {pid}).")
        # Dashboard service stop waits for the existing owner to seal records
        # before systemd sends its broader control-group termination signal.
        deadline = time.monotonic() + float(wait_seconds)
        while float(wait_seconds) > 0:
            try:
                fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except BlockingIOError:
                if time.monotonic() >= deadline:
                    print("Loop cleanup did not finish before the stop deadline.", file=sys.stderr)
                    return 1
                time.sleep(0.05)
    except (ProcessLookupError, FileNotFoundError):
        print("Loop owner has already exited.")
    finally:
        if process_fd is not None:
            os.close(process_fd)
        os.close(descriptor)
    return 0


def main() -> int:
    if sys.argv[1] == "--stop":
        return stop(*sys.argv[2:])
    pid_file, script, *args = sys.argv[1:]
    descriptor = os.open(pid_file, os.O_RDWR | os.O_CREAT, 0o600)
    try:
        fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        print("Auto loop already running for this checkout. Stop it first.", file=sys.stderr)
        return 1
    from installation_state import check_maintenance
    try:
        check_maintenance(Path(script).resolve().parents[2])
    except ValueError as error:
        os.close(descriptor)
        print(str(error), file=sys.stderr)
        return 78
    os.set_inheritable(descriptor, True)
    os.environ["AUTO_COMPANY_LOCK_PID"] = str(os.getpid())
    os.execv("/bin/bash", ["/bin/bash", str(Path(script).resolve()), *args])
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
