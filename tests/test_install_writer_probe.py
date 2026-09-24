import importlib.util
import os
from pathlib import Path
import platform
import subprocess
import sys
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts/install"))
from writer_probe import writer_is_alive


class WriterProbeTests(unittest.TestCase):
    def test_live_process_is_retained(self):
        self.assertIs(writer_is_alive({"pid": os.getpid(), "host": platform.system().lower()}), True)

    def test_ended_owned_process_is_stale(self):
        process = subprocess.Popen([sys.executable, "-c", "pass"])
        process.wait(timeout=10)
        self.assertIs(writer_is_alive({"pid": process.pid, "host": platform.system().lower()}), False)

    @unittest.skipUnless(os.name == "nt" or sys.platform == "linux", "requires a process creation identity")
    def test_reused_pid_is_not_the_recorded_writer(self):
        self.assertIs(writer_is_alive({"pid": os.getpid(), "host": platform.system().lower(), "process_start": "1"}), False)

    def test_invalid_pid_or_unavailable_host_is_unknown(self):
        for record in ({"pid": True, "host": "windows"}, {"pid": "1; evil", "host": "windows"},
                       {"pid": os.getpid(), "host": "different"}):
            self.assertIsNone(writer_is_alive(record))

    @unittest.skipIf(os.name == "nt", "cross-host query is only used from WSL")
    def test_failed_windows_query_remains_unknown(self):
        with mock.patch("writer_probe.shutil.which", return_value="powershell.exe"), \
             mock.patch("writer_probe.subprocess.run", side_effect=OSError("unavailable")):
            self.assertIsNone(writer_is_alive({"pid": 123, "host": "windows"}))


if __name__ == "__main__":
    unittest.main()
