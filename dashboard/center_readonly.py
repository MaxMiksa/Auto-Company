"""Observe existing source processes without executing source scripts or controls."""
from datetime import datetime, timezone
from contextlib import ExitStack
import json
import os
from pathlib import Path
import re
import subprocess
import threading
import time


# Fixed reader code; imported roots are data, never executable status scripts.
PROC_READER = """
import json, os, pathlib, sys
def observe(root, pid):
    root = pathlib.Path(root).resolve()
    try:
        expected = root / 'scripts/core/auto-loop.sh'
        folders = [pathlib.Path('/proc') / str(pid)] if pid else [p for p in pathlib.Path('/proc').iterdir() if p.name.isdigit()]
        alive = False
        for folder in folders:
            try:
                if not pid and folder.stat().st_uid != os.getuid():
                    continue
                command = (folder / 'cmdline').read_bytes().split(b'\\0')
                stat = (folder / 'stat').read_text().rsplit(')', 1)[1].split()
                for argument in command:
                    if not argument.endswith(b'scripts/core/auto-loop.sh'):
                        continue
                    path = pathlib.Path(os.fsdecode(argument))
                    if not path.is_absolute():
                        path = (folder / 'cwd').resolve() / path
                    if stat[0] != 'Z' and path.resolve() == expected:
                        alive = True
            except FileNotFoundError:
                continue
        return {'available': True, 'alive': alive}
    except FileNotFoundError:
        return {'available': True, 'alive': False}
    except (OSError, ValueError, IndexError):
        return {'available': False}

if sys.argv[1] == '--batch':
    print(json.dumps([observe(root, pid) for root, pid in json.loads(sys.argv[2])]))
else:
    print(json.dumps(observe(sys.argv[1], int(sys.argv[2]))))
"""


class ReadOnlyObserver:
    """Short cached observations; no owner DB, lock, queue or writer access."""
    def __init__(self):
        self._cache = {}
        self._lock = threading.Lock()
        self._root_locks = {}
        self._wsl_lock = threading.Lock()
        self._wsl_cache = (0, [])
        self._process_retry_after = 0

    def _running_wsl(self):
        with self._wsl_lock:
            return self._running_wsl_locked()

    def _running_wsl_locked(self):
        stamp, names = self._wsl_cache
        if time.monotonic() - stamp < 5:
            return names
        try:
            result = subprocess.run(['wsl.exe', '--list', '--running', '--quiet'], capture_output=True, timeout=2)
            raw = result.stdout
            text = raw.decode('utf-16-le') if b'\x00' in raw else raw.decode('utf-8')
            names = [line.strip() for line in text.splitlines() if line.strip()] if result.returncode == 0 else []
        except (OSError, subprocess.TimeoutExpired, UnicodeError):
            names = []
        self._wsl_cache = (time.monotonic(), names)
        return names

    def _process(self, root, pid):
        if time.monotonic() < self._process_retry_after:
            return None
        if os.name == 'nt':
            # Query only a distribution already running; never wake WSL for UI.
            names = self._running_wsl()
            if len(names) != 1 or not re.match(r'^[A-Za-z]:[\\/]', str(root)):
                return None
            path = str(root).replace('\\', '/')
            path = '/mnt/' + path[0].lower() + path[2:]
            command = ['wsl.exe', '--distribution', names[0], '--exec', 'python3', '-c', PROC_READER, path, str(pid)]
            domain = {'platform': 'wsl', 'distribution': names[0]}
        elif Path('/proc').is_dir():
            import sys
            command = [sys.executable, '-c', PROC_READER, str(root), str(pid)]
            domain = {'platform': 'posix'}
        else:
            return None
        try:
            result = subprocess.run(command, capture_output=True, timeout=2)
            value = json.loads(result.stdout) if result.returncode == 0 else {}
            if value.get('available') is not True or type(value.get('alive')) is not bool:
                self._process_retry_after = time.monotonic() + 5
                return None
            return {**value, 'executionDomain': domain}
        except (OSError, ValueError, subprocess.TimeoutExpired):
            self._process_retry_after = time.monotonic() + 5
            return None

    def _process_batch(self, inputs):
        if time.monotonic() < self._process_retry_after:
            return [None] * len(inputs)
        if os.name == 'nt':
            names = self._running_wsl()
            if len(names) != 1 or any(not re.match(r'^[A-Za-z]:[\\/]', str(root)) for root, _ in inputs):
                return [None] * len(inputs)
            paths = [(str(root).replace('\\', '/'), pid) for root, pid in inputs]
            paths = [('/mnt/' + path[0].lower() + path[2:], pid) for path, pid in paths]
            command = ['wsl.exe', '--distribution', names[0], '--exec', 'python3', '-c', PROC_READER]
            domain = {'platform': 'wsl', 'distribution': names[0]}
        elif Path('/proc').is_dir():
            import sys
            paths = [(str(root), pid) for root, pid in inputs]
            command = [sys.executable, '-c', PROC_READER]
            domain = {'platform': 'posix'}
        else:
            return [None] * len(inputs)
        try:
            result = subprocess.run(command + ['--batch', json.dumps(paths)], capture_output=True, timeout=2)
            values = json.loads(result.stdout) if result.returncode == 0 else None
            if not isinstance(values, list) or len(values) != len(inputs):
                raise ValueError('invalid_observations')
            return [{**value, 'executionDomain': domain} if isinstance(value, dict) and value.get('available') is True and type(value.get('alive')) is bool else None for value in values]
        except (OSError, ValueError, subprocess.TimeoutExpired):
            self._process_retry_after = time.monotonic() + 5
            return [None] * len(inputs)

    def status(self, reader):
        return self.status_many([reader])[0]

    def status_many(self, readers):
        # A single fixed reader invocation avoids one WSL startup per source.
        # Root locks deduplicate copies; the state/PID must still match before
        # and after observation, and no cached observation gains a new timestamp.
        unique = {str(reader.root): reader for reader in readers}
        with self._lock:
            locks = [self._root_locks.setdefault(root, threading.Lock()) for root in sorted(unique)]
        with ExitStack() as stack:
            for lock in locks:
                stack.enter_context(lock)
            pending = []
            for root, reader in unique.items():
                stamp, _ = self._cache.get(root, (0, None))
                if time.monotonic() - stamp < 5:
                    continue
                try:
                    state = reader.pairs('.auto-loop-state')
                    raw, truncated = reader.read('.auto-loop.pid', 128)
                    if truncated or raw.strip() and not re.fullmatch(r'[1-9][0-9]{0,9}', raw.strip()):
                        raise ValueError('invalid_pid')
                    pending.append((reader, state, raw, int(raw.strip()) if raw.strip() else 0))
                except (OSError, ValueError):
                    self._cache[root] = (time.monotonic(), None)
            inputs = [(reader.root, pid) for reader, _, _, pid in pending]
            observations = ([self._process(*inputs[0])] if len(inputs) == 1 else self._process_batch(inputs)) if inputs else []
            for (reader, state, raw, pid), observed in zip(pending, observations):
                value = None
                try:
                    if not pid and observed and observed['alive']:
                        observed = None
                    if observed and reader.pairs('.auto-loop-state') == state and reader.read('.auto-loop.pid', 128)[0] == raw:
                        phase = state.get('STATUS') if observed['alive'] else 'stopped'
                        if phase not in {'running', 'idle', 'paused', 'waiting_limit', 'circuit_break', 'stopped'} or observed['alive'] and phase == 'stopped':
                            phase = 'unavailable'
                        value = {'ok': phase != 'unavailable', 'timestamp': datetime.now(timezone.utc).isoformat(),
                                 'source': 'source_process', 'executionDomain': observed['executionDomain'],
                                 'stateFile': state, 'parsed': {'loop': {'state': phase,
                                     'processState': 'running' if observed['alive'] else 'stopped',
                                     'pid': pid if observed['alive'] else None}}}
                except (OSError, ValueError):
                    pass
                self._cache[str(reader.root)] = (time.monotonic(), value)
            return [self._cache[str(reader.root)][1] for reader in readers]


def scoped_observation(reader, status):
    if not status or not status.get('ok'):
        return None
    loop = status['parsed']['loop']
    state = loop['state']
    result = {'state': 'ended' if state == 'stopped' else 'read_only', 'source': 'source_process',
              'readOnly': True, 'observedAt': status['timestamp'], 'executionDomain': status['executionDomain'],
              'processState': loop['processState'], 'scoped': state == 'stopped'}
    if state == 'stopped':
        return result
    active = reader.active_cycle(status)
    allowed = reader.scoped_cycle_ids()
    if active and (allowed is None or active['id'] in allowed):
        result.update(state='running', scoped=True, liveConfirmedAt=status['timestamp'],
                      currentCycleId=active['id'], currentCycleNumber=active['number'],
                      engine=active['engine'], model=active['model'])
    elif reader.scope and reader.scope.product_id and status['stateFile'].get('PRODUCT_ID') == reader.scope.product_id:
        # Paused/idle phases describe this product only with a stable identity.
        if state in {'idle', 'paused', 'waiting_limit', 'circuit_break'}:
            result.update(state='idle' if state == 'idle' else 'paused', scoped=True,
                          liveConfirmedAt=status['timestamp'], pauseReason=status['stateFile'].get('PAUSE_REASON') or state)
    return result
