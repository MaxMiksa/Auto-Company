"""Managed roots must reject legacy service/config writes before side effects."""
import http.client
import importlib.util
import json
from pathlib import Path
import platform
import shutil
import subprocess
import tempfile
import threading
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('center_legacy_server', ROOT / 'dashboard/server.py')
legacy = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(legacy)


class CenterLegacyHttpTests(unittest.TestCase):
    def test_managed_root_rejects_every_legacy_write_without_calling_adapter(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / '.auto-company-center.json').write_text('{}')
            with mock.patch.object(legacy, 'REPO_ROOT', root), \
                    mock.patch.object(legacy, 'run_dashboard_action') as action, \
                    mock.patch.object(legacy, 'capture_product_media') as capture, \
                    mock.patch.object(legacy.localization, 'set_language') as language:
                server = legacy.ThreadingHTTPServer(('127.0.0.1', 0), legacy.DashboardHandler)
                worker = threading.Thread(target=server.serve_forever, daemon=True)
                worker.start()
                try:
                    for path in ('/api/action/start', '/api/action/stop', '/api/product-media/capture', '/api/language'):
                        connection = http.client.HTTPConnection('127.0.0.1', server.server_address[1], timeout=5)
                        connection.request('POST', path, '{}', {'Content-Type': 'application/json'})
                        response = connection.getresponse()
                        self.assertEqual(response.status, 409, path)
                        self.assertEqual(json.loads(response.read())['code'], 'CENTER_MANAGED')
                        connection.close()
                    action.assert_not_called()
                    capture.assert_not_called()
                    language.assert_not_called()
                finally:
                    server.shutdown()
                    server.server_close()
                    worker.join(5)


@unittest.skipUnless(platform.system() == 'Windows', 'Native PowerShell entrypoints')
class CenterLegacyWindowsTests(unittest.TestCase):
    def test_managed_start_and_stop_reject_before_configuration_or_wsl(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            scripts = root / 'scripts/windows'
            scripts.mkdir(parents=True)
            # No WSL invocation is allowed: the marker must be checked first.
            (scripts / 'messages-win.ps1').write_text(
                'function Get-AutoCompanyMessage { param($Key) return $Key }\n')
            (root / '.auto-company-center.json').write_text('{}')
            (root / '.auto-loop.env').write_text('PROTECTED=original\n')
            for script in ('start-win.ps1', 'stop-win.ps1'):
                shutil.copyfile(ROOT / 'scripts/windows' / script, scripts / script)
                result = subprocess.run(
                    ['powershell', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', str(scripts / script)],
                    cwd=root, capture_output=True, timeout=10)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn(b'This runtime is managed by the product center', result.stdout + result.stderr)
            self.assertEqual((root / '.auto-loop.env').read_text(), 'PROTECTED=original\n')
            self.assertFalse((root / '.auto-company.local').exists())
            self.assertFalse((root / '.auto-loop-stop').exists())


@unittest.skipIf(platform.system() == 'Windows', 'POSIX wrappers must run under WSL/Linux/macOS')
class CenterLegacyShellTests(unittest.TestCase):
    def test_managed_service_wrappers_exit_before_host_commands(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            scripts = ('scripts/macos/start-daemon.sh', 'scripts/macos/install-daemon.sh',
                       'scripts/wsl/install-wsl-daemon.sh', 'scripts/wsl/dashboard-wsl.sh')
            for script in scripts:
                destination = root / script
                destination.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(ROOT / script, destination)
            messages = root / 'scripts/core/ui-messages.sh'
            messages.parent.mkdir(parents=True)
            messages.write_text('ui_message() { echo "$1"; }\nif [ "${BASH_SOURCE[0]}" = "$0" ]; then ui_message "$@"; fi\n')
            (root / '.auto-company-center.json').write_text('{}')
            for script in scripts:
                arguments = ('start', 'stop', 'check') if script.endswith('dashboard-wsl.sh') else ('',)
                for argument in arguments:
                    with self.subTest(script=script, argument=argument):
                        command = ['bash', str(root / script)] + ([argument] if argument else [])
                        result = subprocess.run(command, cwd=root, capture_output=True, text=True, timeout=5)
                        self.assertNotEqual(result.returncode, 0)
                        self.assertIn('center.managed', result.stdout + result.stderr)
            self.assertFalse((root / '.auto-loop-stop').exists())
            self.assertFalse((root / '.auto-loop-paused').exists())


if __name__ == '__main__':
    unittest.main()
