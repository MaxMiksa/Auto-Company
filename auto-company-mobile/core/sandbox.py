"""
Sandbox Runner — Isolated process execution with resource limits.
"""
import os
import resource
import signal
import subprocess
import time
from typing import Dict, Optional, Any, List, Tuple


class SandboxRunner:
    """Run commands in isolated subprocess with resource limits."""

    def __init__(self, max_memory_mb: int = 256, max_runtime_s: int = 30,
                 max_processes: int = 10, max_cpu_percent: int = 50):
        self.max_memory_mb = max_memory_mb
        self.max_runtime_s = max_runtime_s
        self.max_processes = max_processes
        self.max_cpu_percent = max_cpu_percent
        self._active_processes: Dict[int, subprocess.Popen] = {}

    def _set_resource_limits(self):
        """Set process resource limits."""
        # Memory limit in bytes
        mem_bytes = self.max_memory_mb * 1024 * 1024
        try:
            resource.setrlimit(resource.RLIMIT_AS, (mem_bytes, mem_bytes))
        except (ValueError, resource.error):
            pass

        # CPU limit
        cpu_seconds = self.max_runtime_s
        try:
            resource.setrlimit(resource.RLIMIT_CPU, (cpu_seconds, cpu_seconds))
        except (ValueError, resource.error):
            pass

        # File size limit (10MB)
        try:
            resource.setrlimit(resource.RLIMIT_FSIZE, (10 * 1024 * 1024, 10 * 1024 * 1024))
        except (ValueError, resource.error):
            pass

    def run(self, command: str, timeout: Optional[int] = None,
            cwd: Optional[str] = None,
            env: Optional[Dict[str, str]] = None,
            capture_output: bool = True) -> Tuple[int, str, str, float]:
        """Run a command in a sandboxed subprocess."""
        if timeout is None:
            timeout = self.max_runtime_s

        start_time = time.time()

        full_env = os.environ.copy()
        if env:
            full_env.update(env)

        try:
            proc = subprocess.Popen(
                command,
                shell=True,
                stdout=subprocess.PIPE if capture_output else None,
                stderr=subprocess.PIPE if capture_output else None,
                stdin=subprocess.DEVNULL,
                cwd=cwd,
                env=full_env,
                preexec_fn=self._set_resource_limits,
                start_new_session=True,
                text=True
            )

            self._active_processes[proc.pid] = proc

            try:
                stdout, stderr = proc.communicate(timeout=timeout)
                returncode = proc.returncode
            except subprocess.TimeoutExpired:
                proc.kill()
                proc.wait()
                stdout, stderr = proc.communicate()
                returncode = -1
                stdout = (stdout or "") + "\n[TIMEOUT]"
                stderr = (stderr or "") + f"\n[TIMEOUT]\n[Command killed after {timeout}s]"

            duration = time.time() - start_time

            if proc.pid in self._active_processes:
                del self._active_processes[proc.pid]

            return returncode, stdout or "", stderr or "", duration

        except Exception as e:
            duration = time.time() - start_time
            return -999, "", str(e), duration

    def run_parallel(self, commands: List[str], timeout: Optional[int] = None,
                     cwd: Optional[str] = None,
                     max_concurrent: int = 4) -> List[Tuple[int, str, str, float]]:
        """Run multiple commands in parallel with concurrency limit."""
        results = []
        processes = []

        for cmd in commands:
            while len(processes) >= max_concurrent:
                for p in processes:
                    if p[0].poll() is not None:
                        processes.remove(p)
                        break
                time.sleep(0.1)

            proc = subprocess.Popen(
                cmd,
                shell=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                stdin=subprocess.DEVNULL,
                cwd=cwd,
                preexec_fn=self._set_resource_limits,
                start_new_session=True,
                text=True
            )
            processes.append((proc, cmd))

        for proc, cmd in processes:
            stdout, stderr = proc.communicate(timeout=timeout)
            results.append((proc.returncode, stdout or "", stderr or "", 0.0))

        return results

    def kill_all(self):
        """Kill all running processes."""
        for pid, proc in list(self._active_processes.items()):
            try:
                os.killpg(os.getpgid(pid), signal.SIGTERM)
                proc.wait(timeout=5)
            except (ProcessLookupError, subprocess.TimeoutExpired):
                try:
                    os.killpg(os.getpgid(pid), signal.SIGKILL)
                except ProcessLookupError:
                    pass
        self._active_processes.clear()

    def get_resource_usage(self) -> Dict[str, Any]:
        """Get current resource usage."""
        try:
            usage = resource.getrusage(resource.RUSAGE_CHILDREN)
            return {
                'max_rss_mb': usage.ru_maxrss / 1024,
                'user_cpu_seconds': usage.ru_utime,
                'system_cpu_seconds': usage.ru_stime,
                'page_faults': usage.ru_majflt,
                'active_processes': len(self._active_processes),
                'configured_max_memory_mb': self.max_memory_mb
            }
        except Exception:
            return {'error': 'Could not retrieve resource usage'}
