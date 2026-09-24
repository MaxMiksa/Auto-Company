"""Read process identity for installer writer leases; never signal or remove one."""

import base64
import json
import os
from pathlib import Path
import platform
import shutil
import subprocess


def _windows_process(pid):
    if os.name == "nt":
        import ctypes
        from ctypes import wintypes
        kernel = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
        kernel.OpenProcess.restype = wintypes.HANDLE
        kernel.CloseHandle.argtypes = [wintypes.HANDLE]
        kernel.WaitForSingleObject.argtypes = [wintypes.HANDLE, wintypes.DWORD]
        kernel.WaitForSingleObject.restype = wintypes.DWORD
        kernel.GetProcessTimes.argtypes = [wintypes.HANDLE] + [ctypes.POINTER(wintypes.FILETIME)] * 4
        handle = kernel.OpenProcess(0x1000 | 0x100000, False, pid)
        if not handle:
            return (False, None) if ctypes.get_last_error() == 87 else (None, None)
        try:
            status = kernel.WaitForSingleObject(handle, 0)
            if status == 0:
                return False, None
            if status != 258:
                return None, None
            times = [wintypes.FILETIME() for _ in range(4)]
            if not kernel.GetProcessTimes(handle, *(ctypes.byref(value) for value in times)):
                return None, None
            return True, str((times[0].dwHighDateTime << 32) | times[0].dwLowDateTime)
        finally:
            kernel.CloseHandle(handle)
    executable = shutil.which("powershell.exe")
    if not executable:
        return None, None
    # PID is validated as an integer before interpolation. No path/lease string
    # enters PowerShell source; the fixed command performs a read-only query.
    command = (
        "$ErrorActionPreference='Stop'; try {"
        f"$process=Get-Process -Id {pid}; "
        "if ($process.HasExited) { '{\"alive\":false}' } else {"
        "@{alive=$true;start=[string]$process.StartTime.ToFileTimeUtc()} | ConvertTo-Json -Compress }"
        "} catch { if ($_.FullyQualifiedErrorId -like 'NoProcessFoundForGivenId*') {"
        "'{\"alive\":false}' } else { '{\"alive\":null}' } }"
    )
    encoded = base64.b64encode(command.encode("utf-16le")).decode("ascii")
    try:
        result = subprocess.run([executable, "-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", encoded],
                                capture_output=True, text=True, timeout=10)
        if result.returncode:
            return None, None
        value = json.loads(result.stdout.lstrip("\ufeff").strip())
        if value.get("alive") not in (True, False, None):
            return None, None
        return value.get("alive"), value.get("start")
    except (OSError, ValueError, AttributeError, subprocess.SubprocessError):
        return None, None


def writer_is_alive(record):
    """Return False only for proven stale identity; None means unverifiable."""
    pid = record.get("pid")
    if type(pid) is not int or not 1 < pid < 2**32:
        return None
    host = record.get("host")
    if host == "windows":
        alive, started = _windows_process(pid)
    elif host == platform.system().lower():
        try:
            os.kill(pid, 0)
        except ProcessLookupError:
            return False
        except (PermissionError, OSError):
            return None
        alive, started = True, None
        if host == "linux":
            try:
                started = Path(f"/proc/{pid}/stat").read_text().rsplit(")", 1)[1].split()[19]
            except (OSError, IndexError):
                return None
    else:
        return None
    expected = record.get("process_start")
    if alive is True and expected not in (None, "unknown") and started is not None and str(started) != str(expected):
        return False
    return alive
