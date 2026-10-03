"""Parallel scheduling, default snapshots and actual POSIX ownership contracts."""
import json
import os
from pathlib import Path
import sys
import time
import threading
import unittest
from unittest.mock import patch

import test_center_runtime as fixtures
from test_center_runtime import ROOT
from center_runtime import atomic_json, CenterError, CenterRuntime
from center_store import CenterStore
from center_profiles import installation_defaults


class ParallelAdapter(fixtures.FakeAdapter):
    def __init__(self):
        super().__init__()
        self.receipts = {}
        self.fail_roots = set()

    def launch(self, manifest):
        process = super().launch(manifest)
        value = self.launched[-1]
        self.receipts[value['runtimeId']] = {**value, 'state': 'running', 'startedAt': '2026-10-02T00:00:00+00:00'}
        return process

    def query(self, action, **kwargs):
        if action == 'preflight':
            return {'quiescent': str(kwargs['root']) not in self.fail_roots, 'reason': 'unresolved_p1'}
        runtime_id = kwargs.get('runtime_id')
        if kwargs.get('manifest'):
            runtime_id = json.loads(Path(kwargs['manifest']).read_text())['runtimeId']
        receipt = self.receipts.get(runtime_id)
        free = not receipt or receipt['state'] == 'terminal'
        return {'slotFree': free, 'ownerAlive': not free, 'owner': receipt,
                'receipt': receipt if kwargs.get('manifest') else None}


class ParallelTests(unittest.TestCase):
    source = fixtures.QueueTests.source
    create = fixtures.QueueTests.create
    enable = fixtures.QueueTests.enable

    def setUp(self):
        fixtures.QueueTests.setUp(self)
        self.adapter = ParallelAdapter()
        self.runtime.adapter = self.adapter
        self.sources = [self.a, self.b] + [self.source(letter) for letter in 'cdef']
        for source in self.sources:
            marker = Path(source['root']) / '.auto-company-center.json'
            value = json.loads(marker.read_text())
            value['protocolVersion'] = 2
            atomic_json(marker, value)

    def capacity(self, value):
        self.runtime.queue_action('capacity', {'idempotencyKey': 'capacity-' + str(value), 'maxConcurrentProjects': value})

    def submit_all(self):
        return [self.create(source, 'create-' + str(index) * 8) for index, source in enumerate(self.sources)]

    def advance(self, count=8):
        for _ in range(count):
            self.runtime.tick()

    def finish(self, index, reason='natural'):
        self.adapter.receipts[self.sources[index]['runtimeId']].update(state='terminal', cleanupConfirmed=True, launched=True, reason=reason)

    def test_default_four_lowering_does_not_interrupt_and_unlimited_drains(self):
        self.submit_all()
        self.enable()
        self.advance()
        self.assertEqual(len(self.adapter.launched), 4)
        self.assertEqual(len(self.runtime.summary()['currentRequests']), 4)
        self.capacity(2)
        self.advance()
        self.assertEqual(len(self.adapter.launched), 4)
        self.assertFalse(any(row.get('stopRequested') for row in self.runtime.list_requests()['items']))
        self.finish(0)
        self.finish(1)
        self.advance()
        self.assertEqual(len(self.adapter.launched), 4)
        self.finish(2)
        self.advance()
        self.assertEqual(len(self.adapter.launched), 5)
        self.capacity(None)
        self.advance()
        self.assertEqual(len(self.adapter.launched), 6)

    def test_project_p1_and_failure_do_not_pause_other_projects(self):
        self.submit_all()
        self.enable()
        self.runtime.tick()
        self.adapter.receipts[self.a['runtimeId']].update(executionBlockedReason='unresolved_p1', executionBlockedAt='2026-10-02T00:00:00+00:00')
        self.advance()
        self.assertTrue(self.runtime.summary()['dispatchEnabled'])
        self.assertEqual(len(self.adapter.launched), 4)
        self.finish(1, 'runtime')
        self.advance()
        self.assertEqual(len(self.adapter.launched), 5)
        self.assertTrue(self.runtime.summary()['dispatchEnabled'])

    def test_preflight_failure_releases_capacity_but_preserves_attention(self):
        requests = self.submit_all()
        self.adapter.fail_roots.add(self.a['root'])
        self.enable()
        self.advance()
        self.assertEqual(self.runtime.get_request(requests[0]['requestId'])['state'], 'attention')
        self.assertEqual(len(self.adapter.launched), 4)
        self.assertTrue(self.runtime.summary()['dispatchEnabled'])

    def test_stop_one_retains_other_owners_and_stop_all_revokes_waiters(self):
        requests = self.submit_all()
        self.enable()
        self.advance()
        self.runtime.request_action(requests[0]['requestId'], 'stop', {'idempotencyKey': 'stop-only-first'})
        self.assertEqual(sum(bool(row.get('stopRequested')) for row in self.runtime.list_requests()['items']), 1)
        self.runtime.queue_action('stop-all', {'idempotencyKey': 'stop-all-parallel'})
        self.assertEqual(sum(bool(row.get('stopRequested')) for row in self.runtime.list_requests()['items']), 4)
        self.assertFalse(self.runtime.summary()['dispatchEnabled'])

    def test_capacity_validation_and_restart_preserve_settings_not_authorizations(self):
        for value in (0, -1, True, '4', 1.5):
            with self.assertRaises(CenterError):
                self.runtime.queue_action('capacity', {'idempotencyKey': 'bad-capacity-' + str(value), 'maxConcurrentProjects': value})
        self.capacity(None)
        self.create(executionMode='start_now')
        restarted = CenterRuntime(self.store, self.catalog, ROOT, {'platform': 'posix'}, adapter=self.adapter)
        self.assertIsNone(restarted.summary()['maxConcurrentProjects'])
        restarted.tick()
        self.assertFalse(self.adapter.launched)

    def test_batch_is_atomic_idempotent_and_snapshots_all_groups(self):
        config = dict(engine='codex', model='gpt-6.1-sol', effort='high', productLanguage='en')
        body = {'idempotencyKey': 'batch-four-config', 'executionMode': 'start_now',
                'groups': [{'count': 2, 'direction': '', 'config': config},
                           {'count': 2, 'config': {**config, 'effort': 'xhigh'}}]}
        with patch.object(self.runtime, '_worker') as worker:
            result = self.runtime.create_batch(body)
            replay = self.runtime.create_batch(body)
        self.assertEqual(result, replay)
        self.assertEqual(worker.call_count, 1)
        self.assertEqual([row['input']['config']['effort'] for row in result['items']], ['high', 'high', 'xhigh', 'xhigh'])
        self.assertEqual(len({row['order'] for row in result['items']}), 4)
        with self.assertRaises(CenterError):
            self.runtime.create_batch({**body, 'idempotencyKey': 'invalid-batch-config', 'groups': [body['groups'][0], {'count': 1, 'config': {'effort': 'bad'}}]})
        self.assertEqual(len(self.runtime.list_operations()['items']), 4)
        self.runtime.queue_action('pause', {'idempotencyKey': 'pause-preparing-batch'})
        self.assertTrue(all(self.runtime.operation(row['operationId']).get('authorizationRevoked') for row in result['items']))

    def test_templates_default_last_installation_and_existing_request_snapshot(self):
        installed = self.runtime.preferences()['defaults']
        custom = {**installed, 'model': 'gpt-6.1-sol', 'effort': 'xhigh'}
        saved = self.runtime.template_action({'idempotencyKey': 'save-custom-default', 'name': 'My model', 'config': custom, 'makeDefault': True})
        self.assertEqual(self.runtime.preferences()['defaults'], custom)
        request = self.create(config={'effort': 'high'})
        self.assertEqual(self.runtime.preferences()['defaults']['effort'], 'xhigh')
        self.runtime.template_action({'idempotencyKey': 'update-custom-default', 'templateId': saved['template']['templateId'],
                                      'name': 'My model', 'config': {**custom, 'model': 'next-model'}})
        self.assertEqual(self.runtime.get_request(request['requestId'])['config']['model'], 'gpt-6.1-sol')
        self.runtime.template_action({'idempotencyKey': 'clear-custom-default', 'action': 'default', 'templateId': None})
        self.assertEqual(self.runtime.preferences()['defaults']['effort'], 'high')
        self.assertEqual(self.runtime.preferences()['defaultsOrigin'], 'last')
        with self.assertRaises(CenterError):
            self.runtime.template_action({'idempotencyKey': 'template-excludes-direction', 'name': 'Bad', 'config': {**custom, 'direction': 'old topic'}})

    def test_installed_selection_is_read_as_data_without_secrets_or_shell_execution(self):
        root = self.folder / 'installed'
        root.mkdir()
        (root / '.auto-loop.env').write_text('ENGINE=codex\nMODEL="chosen-model"\nCODEX_REASONING_EFFORT=xhigh\nOPENAI_API_KEY=private\nUNRELATED=$(touch bad)\n')
        self.assertEqual(installation_defaults(root, 'en'), dict(engine='codex', model='chosen-model', effort='xhigh', productLanguage='en'))
        self.assertFalse((root / 'bad').exists())

    def test_heartbeat_is_not_blocked_by_slow_execution_probe(self):
        self.create(executionMode='start_now')
        self.runtime.tick()
        request = self.runtime.list_requests()['items'][0]
        control = self.runtime._control(request) / 'control.json'
        before = json.loads(control.read_text())['heartbeat']
        entered, release = threading.Event(), threading.Event()
        original = self.adapter.query

        def slow(action, **kwargs):
            if action == 'probe' and kwargs.get('manifest'):
                entered.set()
                release.wait(5)
            return original(action, **kwargs)

        self.adapter.query = slow
        self.runtime.start()
        try:
            self.assertTrue(entered.wait(2))
            before = json.loads(control.read_text())['heartbeat']
            deadline = time.monotonic() + 3
            while json.loads(control.read_text())['heartbeat'] <= before and time.monotonic() < deadline:
                time.sleep(.05)
            self.assertGreater(json.loads(control.read_text())['heartbeat'], before)
        finally:
            release.set()
            self.runtime.close()


class BatchPreparationTests(unittest.TestCase):
    def test_mixed_batch_prepares_independent_roots_with_exact_snapshots(self):
        case = fixtures.PreparationTests()
        case.setUp()
        self.addCleanup(case.doCleanups)
        config = dict(engine='codex', model='gpt-6.1-sol', effort='high', productLanguage='en')
        batch = case.runtime.create_batch({'idempotencyKey': 'real-batch-preparation',
                'groups': [{'count': 2, 'config': config}, {'count': 2, 'config': {**config, 'effort': 'xhigh'}}]})
        for operation in batch['items']:
            self.assertEqual(case.wait_operation(operation['operationId'])['state'], 'succeeded')
        requests = case.runtime.list_requests()['items']
        self.assertEqual([request['config']['effort'] for request in requests], ['high', 'high', 'xhigh', 'xhigh'])
        self.assertEqual(len({request['runtimeId'] for request in requests}), 4)
        self.assertEqual([request['ownershipProtocol'] for request in requests], [2] * 4)
        self.assertFalse(case.runtime.summary()['dispatchEnabled'])


@unittest.skipUnless(sys.platform == 'linux', 'Actual POSIX ownership requires Linux/WSL')
class ParallelRunnerTests(unittest.TestCase):
    def test_two_real_owners_stop_independently_and_reject_duplicate(self):
        cases = [fixtures.RunnerTests(), fixtures.RunnerTests()]
        for case in cases:
            case.setUp()
            self.addCleanup(case.doCleanups)
            marker = json.loads((case.root / '.auto-company-center.json').read_text())
            marker['protocolVersion'] = 2
            if case is cases[1]:
                for field in ('runtimeId', 'entryId', 'sourceId', 'requestId', 'dispatchId', 'nonce'):
                    case.manifest[field] += '_second'
                    if field in marker:
                        marker[field] = case.manifest[field]
                atomic_json(case.manifest_path, case.manifest)
            atomic_json(case.root / '.auto-company-center.json', marker)
            case.env['XDG_STATE_HOME'] = cases[0].env['XDG_STATE_HOME']
        processes = [case.launch(SLOW_ENGINE='1') for case in cases]
        deadline = time.monotonic() + 20
        while time.monotonic() < deadline:
            for case in cases:
                case.heartbeat()
            if all((case.root / 'invocations').exists() for case in cases):
                break
            time.sleep(.1)
        self.assertTrue(all((case.root / 'invocations').exists() for case in cases))
        duplicate = cases[0].launch(SLOW_ENGINE='1')
        self.assertEqual(duplicate.wait(5), 78)
        cases[0].heartbeat(stop=True)
        while processes[0].poll() is None and time.monotonic() < deadline:
            cases[1].heartbeat()
            time.sleep(.1)
        self.assertEqual(processes[0].poll(), 0)
        self.assertIsNone(processes[1].poll())
        self.assertTrue(json.loads((cases[0].control / 'receipt.json').read_text())['cleanupConfirmed'])
        cases[1].heartbeat(stop=True)
        self.assertEqual(processes[1].wait(10), 0)

    def test_legacy_lock_and_uncertain_owner_cannot_overlap_new_owners(self):
        sys.path.insert(0, str(ROOT / 'scripts/core'))
        from center_runner import execution_lock, domain_dir, owner_dir, bind
        import tempfile
        with tempfile.TemporaryDirectory() as folder, patch.dict(os.environ, XDG_STATE_HOME=folder):
            legacy = {'centerId': 'center_legacy_test', 'runtimeId': 'runtime_original', 'protocolVersion': 1}
            first = {**legacy, 'protocolVersion': 2}
            second = {**first, 'runtimeId': 'runtime_another'}
            with execution_lock(first), execution_lock(second):
                with self.assertRaises(BlockingIOError):
                    with execution_lock(first):
                        pass
                with self.assertRaises(BlockingIOError):
                    with execution_lock(legacy):
                        pass
            atomic_json(domain_dir(legacy['centerId']) / 'owner.json', {'state': 'attention', 'cleanupConfirmed': False})
            with self.assertRaises(ValueError):
                with execution_lock(first):
                    pass
            atomic_json(domain_dir(legacy['centerId']) / 'owner.json', {'state': 'terminal', 'cleanupConfirmed': True})
            atomic_json(owner_dir(first) / 'owner.json', {'state': 'attention', 'cleanupConfirmed': False})
            manifest = Path(folder) / 'binding.json'
            atomic_json(manifest, {'marker': first})
            with self.assertRaisesRegex(ValueError, 'owner_recovery_required'):
                bind(manifest)
