"""No service/model starts: process reader and scope-bound observation tests."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
from concurrent.futures import ThreadPoolExecutor
import threading
import unittest
from unittest.mock import Mock, patch

ROOT = Path(os.environ.get('AUTO_COMPANY_TEST_SOURCE', Path(__file__).resolve().parents[1]))
sys.path[:0] = [str(ROOT / 'dashboard'), str(ROOT / 'scripts/core')]
from center_readonly import PROC_READER, ReadOnlyObserver, scoped_observation


class ReadOnlyObservationTests(unittest.TestCase):
    @unittest.skipUnless(Path('/proc').is_dir(), 'Requires Linux process evidence')
    def test_process_scan_distinguishes_matching_source_from_other_sources(self):
        with tempfile.TemporaryDirectory() as folder:
            source = Path(folder)
            command = str(source / 'scripts/core/auto-loop.sh')
            child = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(30)', command])
            def observe(root):
                return json.loads(subprocess.check_output([sys.executable, '-c', PROC_READER, str(root), '0']))
            try:
                self.assertEqual(observe(source), {'available': True, 'alive': True})
                self.assertEqual(observe(source / 'other'), {'available': True, 'alive': False})
            finally:
                child.terminate()
                child.wait()
            self.assertEqual(observe(source), {'available': True, 'alive': False})

    def test_wsl_is_never_started_when_no_distribution_is_running(self):
        observer = ReadOnlyObserver()
        with patch('center_readonly.os.name', 'nt'), patch('center_readonly.subprocess.run', return_value=Mock(returncode=0, stdout=b'')) as run:
            self.assertIsNone(observer._process(r'D:\Recorded\Source', 12))
            self.assertIsNone(observer._process(r'D:\Recorded\Other', 13))
        self.assertEqual(run.call_count, 1)
        self.assertEqual(run.call_args.args[0], ['wsl.exe', '--list', '--running', '--quiet'])

    def test_only_existing_distribution_gets_fixed_process_reader(self):
        observer = ReadOnlyObserver()
        replies = [Mock(returncode=0, stdout='Ubuntu\r\n'.encode('utf-16-le')), Mock(returncode=0, stdout=b'{"available":true,"alive":true}')]
        with patch('center_readonly.os.name', 'nt'), patch('center_readonly.subprocess.run', side_effect=replies) as run:
            value = observer._process(r'D:\Recorded\A $(unsafe)', 12)
        self.assertTrue(value['alive'])
        command = run.call_args.args[0]
        self.assertEqual(command[:6], ['wsl.exe', '--distribution', 'Ubuntu', '--exec', 'python3', '-c'])
        self.assertEqual(command[-2:], ['/mnt/d/Recorded/A $(unsafe)', '12'])
        self.assertNotIn('shell', run.call_args.kwargs)

    def test_timeout_is_unavailable_never_stopped_and_retries_are_bounded(self):
        observer = ReadOnlyObserver()
        observer._wsl_cache = (0, [])
        with patch('center_readonly.os.name', 'nt'), patch.object(observer, '_running_wsl', return_value=['Ubuntu']), patch('center_readonly.subprocess.run', side_effect=subprocess.TimeoutExpired('reader', 2)) as run:
            self.assertIsNone(observer._process(r'D:\Recorded\Source', 12))
            self.assertIsNone(observer._process(r'D:\Recorded\Other', 13))
        self.assertEqual(run.call_count, 1)

    def reader(self, state='running'):
        reader = Mock(root='recorded-source')
        reader.pairs.return_value = {'STATUS': state, 'PRODUCT_ID': 'product-one'}
        reader.read.return_value = ('12\n', False)
        return reader

    def test_pid_or_state_change_invalidates_observation(self):
        observer = ReadOnlyObserver()
        reader = self.reader()
        reader.read.side_effect = [('12\n', False), ('13\n', False)]
        with patch.object(observer, '_process', return_value={'alive': True, 'executionDomain': {'platform': 'posix'}}):
            self.assertIsNone(observer.status(reader))

    def test_batch_preserves_independent_evidence_and_rejects_changed_pid(self):
        observer = ReadOnlyObserver()
        first, second = self.reader(), self.reader()
        second.root = 'second-source'
        second.read.side_effect = [('12\n', False), ('13\n', False)]
        stopped = {'available': True, 'alive': False, 'executionDomain': {'platform': 'posix'}}
        with patch.object(observer, '_process_batch', return_value=[stopped, stopped]) as process:
            results = observer.status_many([first, second, first])
            self.assertEqual(results[0]['parsed']['loop']['state'], 'stopped')
            self.assertIsNone(results[1])
            self.assertIs(results[0], results[2])
            self.assertIs(observer.status(first), results[0])
        process.assert_called_once_with([('recorded-source', 12), ('second-source', 12)])

    def test_concurrent_requests_for_one_root_share_observation(self):
        observer = ReadOnlyObserver()
        barrier = threading.Barrier(2)
        def read():
            barrier.wait(timeout=2)
            return observer.status(self.reader())
        with patch.object(observer, '_process', return_value={'alive': False, 'executionDomain': {'platform': 'posix'}}) as process:
            with ThreadPoolExecutor(max_workers=2) as pool:
                results = list(pool.map(lambda _: read(), range(2)))
        self.assertIs(results[0], results[1])
        self.assertEqual(process.call_count, 1)

    @unittest.skipUnless(Path('/proc').is_dir(), 'Requires Linux process evidence')
    def test_batch_reader_keeps_source_order_and_matches_single_reads(self):
        with tempfile.TemporaryDirectory() as folder:
            roots = [folder, str(Path(folder) / 'other')]
            command = str(Path(folder) / 'scripts/core/auto-loop.sh')
            child = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(30)', command])
            try:
                result = json.loads(subprocess.check_output([sys.executable, '-c', PROC_READER, '--batch', json.dumps([(root, 0) for root in roots])]))
                self.assertEqual(result, [{'available': True, 'alive': True}, {'available': True, 'alive': False}])
            finally:
                child.terminate()
                child.wait()

    def test_saved_stopped_state_cannot_hide_a_live_process(self):
        observer = ReadOnlyObserver()
        reader = self.reader('stopped')
        with patch.object(observer, '_process', return_value={'alive': True, 'executionDomain': {'platform': 'posix'}}):
            status = observer.status(reader)
        self.assertFalse(status['ok'])
        self.assertIsNone(scoped_observation(reader, status))

    def test_missing_pid_requires_verified_process_absence(self):
        reader = self.reader()
        reader.read.return_value = ('', False)
        for observed, expected in [(None, None), ({'alive': True}, None),
                ({'alive': False, 'executionDomain': {'platform': 'posix'}}, 'stopped')]:
            with patch.object(ReadOnlyObserver, '_process', return_value=observed) as process:
                status = ReadOnlyObserver().status(reader)
            process.assert_called_once_with('recorded-source', 0)
            self.assertEqual(status['parsed']['loop']['state'] if status else None, expected)

    def test_invalid_pid_does_not_fall_back_to_process_absence(self):
        reader = self.reader()
        reader.read.return_value = ('invalid', False)
        with patch.object(ReadOnlyObserver, '_process') as process:
            self.assertIsNone(ReadOnlyObserver().status(reader))
        process.assert_not_called()

    def status(self, state='running'):
        return {'ok': True, 'timestamp': '2026-10-03T00:00:00+00:00', 'executionDomain': {'platform': 'posix'},
                'stateFile': {'PRODUCT_ID': 'product-one'}, 'parsed': {'loop': {'state': state, 'processState': 'running' if state != 'stopped' else 'stopped'}}}

    def test_live_cycle_must_belong_to_selected_identity(self):
        reader = self.reader()
        reader.active_cycle.return_value = {'id': 'another-cycle', 'number': 7, 'engine': 'fixture', 'model': 'no-model'}
        reader.scoped_cycle_ids.return_value = {'owned-cycle'}
        reader.scope.product_id = 'product-one'
        result = scoped_observation(reader, self.status())
        self.assertEqual(result['state'], 'read_only')
        self.assertFalse(result['scoped'])
        self.assertNotIn('liveConfirmedAt', result)
        reader.active_cycle.return_value['id'] = 'owned-cycle'
        result = scoped_observation(reader, self.status())
        self.assertEqual(result['state'], 'running')
        self.assertEqual(result['currentCycleId'], 'owned-cycle')
        self.assertTrue(result['readOnly'])

    def test_paused_phase_requires_stable_product_binding(self):
        reader = self.reader()
        reader.active_cycle.return_value = None
        reader.scope.product_id = 'other-product'
        self.assertEqual(scoped_observation(reader, self.status('paused'))['state'], 'read_only')
        reader.scope.product_id = 'product-one'
        self.assertEqual(scoped_observation(reader, self.status('paused'))['state'], 'paused')


if __name__ == '__main__':
    unittest.main()
