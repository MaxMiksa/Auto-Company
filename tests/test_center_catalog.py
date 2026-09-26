"""Center registration, transactions and cross-identity read boundaries."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import sqlite3
import sys
import tempfile
import unittest

ROOT = Path(os.environ.get('AUTO_COMPANY_TEST_SOURCE', Path(__file__).resolve().parents[1]))
sys.path[:0] = [str(ROOT / 'dashboard'), str(ROOT / 'scripts/core')]
from center_store import CenterStore, CenterError
from center_catalog import CenterCatalog
import product_identity as products


class CenterCatalogTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        self.root = self.base / 'run'
        self.root.mkdir()
        self.store = CenterStore(self.base / 'center')
        self.addCleanup(self.store.close)
        self.catalog = CenterCatalog(self.store)

    def write(self, relative, text):
        path = self.root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding='utf-8')
        return path

    def cycle(self, project='projects/one', attempt='first', tokens=13):
        (self.root / project).mkdir(parents=True, exist_ok=True)
        row = products.reserve_cycle(self.root, project, attempt, 1, 'fixture', 'no-model')
        products.update_cycle(self.root, row['cycleId'], 'completed')
        record = {'schema_version': 1, 'kind': 'cycle_usage', 'cycle_id': row['cycleId'], 'cycle_number': 1,
                  'project': project, 'started_at': '2026-09-26T01:00:00+00:00', 'ended_at': '2026-09-26T01:01:00+00:00',
                  'status': 'completed', 'usage': {'input_tokens': tokens - 1, 'output_tokens': 1, 'total_tokens': tokens}}
        path = self.root / 'logs/usage.jsonl'
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open('a', encoding='utf-8') as output:
            output.write(json.dumps(record) + '\n')
        self.write('logs/' + row['cycleId'] + '.log', project + ' private log')
        return row

    def import_root(self, root=None):
        candidate = self.catalog.probe({'root': str(root or self.root)})
        result = self.catalog.commit({'candidateId': candidate['candidateId'], 'candidateHash': candidate['candidateHash'], 'idempotencyKey': candidate['candidateId']})
        return result['items']

    def hashes(self):
        return {str(path.relative_to(self.root)): hashlib.sha256(path.read_bytes()).hexdigest() for path in self.root.rglob('*') if path.is_file()}

    def test_transactions_rollback_and_read_revision(self):
        revision = self.store.revision
        with self.store.transaction() as tx:
            self.assertEqual(tx.list('entries'), [])
        self.assertEqual(self.store.revision, revision)
        with self.assertRaises(RuntimeError):
            with self.store.transaction() as tx:
                tx.put('entries', 'x', {'entryId': 'x'})
                raise RuntimeError('fail')
        with self.store.transaction() as tx:
            self.assertIsNone(tx.get('entries', 'x'))
        self.assertEqual(self.store.revision, revision)

    def test_second_owner_rejected(self):
        with self.assertRaises(CenterError) as context:
            CenterStore(self.base / 'center')
        self.assertEqual(context.exception.code, 'CENTER_BUSY')

    def test_store_identity_persists(self):
        identity = self.store.center_id
        self.store.close()
        self.store = CenterStore(self.base / 'center')
        self.addCleanup(self.store.close)
        self.assertEqual(self.store.center_id, identity)

    def test_import_and_read_never_mutate_source(self):
        self.cycle()
        self.write('memories/consensus.md', '# Other global report\n## Current Phase\nWrong phase')
        before = self.hashes()
        item, = self.import_root()
        self.catalog.journal(item['entryId'])
        self.catalog.usage(item['entryId'])
        self.assertEqual(self.hashes(), before)

    def test_multi_product_logs_usage_consensus_isolated(self):
        one = self.cycle(tokens=13)
        two = self.cycle('projects/two', 'second', 90)
        self.write('.auto-company.local', 'ACTIVE_PROJECT=projects/two\n')
        self.write('memories/consensus.md', '# Other global report\n## Current Phase\nWrong phase')
        entries = self.import_root()
        item = next(item for item in entries if self.catalog.get_entry(item['entryId'])['productId'] == one['productId'])
        snapshot = self.catalog.journal(item['entryId'])
        self.assertEqual([row['id'] for row in snapshot['cycles']], [one['cycleId']])
        self.assertEqual(snapshot['consensus']['raw'], '')
        self.assertEqual(self.catalog.usage(item['entryId'])['usage']['totalTokens'], 13)
        with self.assertRaises(CenterError):
            self.catalog.resource(item['entryId'], 'log-' + two['cycleId'])
        content, mime = self.catalog.resource(item['entryId'], 'log-' + one['cycleId'])
        self.assertIn(b'projects/one', content)

    def test_duplicate_import_is_idempotent(self):
        self.cycle()
        first, = self.import_root()
        second, = self.import_root()
        self.assertEqual(first['entryId'], second['entryId'])
        self.assertEqual(first['sourceId'], second['sourceId'])
        self.assertTrue(second['duplicate'])
        self.assertEqual(self.catalog.list_entries()['total'], 1)

    def test_source_change_between_probe_commit_rejected(self):
        self.cycle()
        candidate = self.catalog.probe({'root': str(self.root)})
        self.cycle('projects/two', 'second')
        with self.assertRaises(CenterError) as context:
            self.catalog.commit(candidate)
        self.assertEqual(context.exception.code, 'SOURCE_CHANGED')

    def test_inherited_examples_are_not_products(self):
        self.write('projects/example/README.md', '# bundled example')
        with self.assertRaises(CenterError) as context:
            self.catalog.probe({'root': str(self.root)})
        self.assertEqual(context.exception.code, 'NO_RECORDED_PRODUCTS')

    def test_relocated_identity_keeps_history(self):
        original = self.cycle()
        item, = self.import_root()
        (self.root / 'projects/one').rename(self.root / 'projects/moved')
        products.relocate_identity(self.root, original['productId'], 'projects/moved')
        snapshot = self.catalog.journal(item['entryId'])
        self.assertEqual(snapshot['project']['id'], 'projects/moved')
        self.assertEqual(snapshot['cycles'][0]['stableProductId'], original['productId'])

    def test_reused_path_never_exposes_replacement_metadata(self):
        original = self.cycle()
        item, = self.import_root()
        (self.root / 'projects/one/.auto-company/identity.json').unlink()
        replacement = products.register_project(self.root, 'projects/one')
        self.assertNotEqual(replacement['id'], original['productId'])
        self.write('projects/one/.auto-company/project.json', json.dumps({'displayName': 'wrong replacement'}))
        snapshot = self.catalog.journal(item['entryId'])
        self.assertEqual(snapshot['project']['status'], 'historical')
        self.assertNotEqual(snapshot['project']['displayName'], 'wrong replacement')
        self.assertIsNone(snapshot['productMedia'])

    def test_missing_and_corrupt_source_isolated_from_catalog(self):
        self.cycle()
        item, = self.import_root()
        self.write('.auto-company/product-state.json', '{broken')
        self.catalog.refresh_source(item['sourceId'])
        self.assertEqual(self.catalog.list_entries()['items'][0]['availability'], 'conflict')
        self.assertEqual(self.catalog.list_entries()['total'], 1)

    def test_backup_is_same_entry_with_distinct_readonly_source(self):
        self.cycle()
        one, = self.import_root()
        backup = self.base / 'backup'
        shutil.copytree(self.root, backup)
        two, = self.import_root(backup)
        self.assertEqual(one['entryId'], two['entryId'])
        self.assertNotEqual(one['sourceId'], two['sourceId'])
        entry = self.catalog.get_entry(one['entryId'])
        self.assertEqual(len(entry['sources']), 2)
        self.assertFalse(entry['capabilities']['execute'])
        sources = {row['sourceId']: row for row in entry['sources']}
        self.assertEqual(sources[one['sourceId']]['displayName'], self.root.name)
        self.assertEqual(sources[two['sourceId']]['rootName'], backup.name)
        self.assertEqual(sources[two['sourceId']]['displayPath'], str(backup.resolve()))
        self.assertTrue(sources[two['sourceId']]['lastVerifiedAt'])
        self.assertNotIn('root', sources[one['sourceId']])
        self.assertNotIn('displayPath', self.catalog.list_entries()['items'][0])

    def test_cursor_expires_when_catalog_changes(self):
        self.cycle()
        self.cycle('projects/two', 'second')
        entries = self.import_root()
        page = self.catalog.list_entries({'limit': 1})
        self.assertIsNotNone(page['nextCursor'])
        self.catalog.entry_action(entries[0]['entryId'], 'archive', {'expectedRevision': 1})
        with self.assertRaises(CenterError) as context:
            self.catalog.list_entries({'cursor': page['nextCursor'], 'limit': 1})
        self.assertEqual(context.exception.code, 'CURSOR_EXPIRED')

    def test_archive_open_request_and_stale_revision_rejected(self):
        self.cycle()
        item, = self.import_root()
        with self.store.transaction() as tx:
            tx.put('requests', 'request', {'entryId': item['entryId'], 'state': 'queued'})
        with self.assertRaises(CenterError):
            self.catalog.entry_action(item['entryId'], 'archive', {'expectedRevision': 1})
        with self.assertRaises(CenterError):
            self.catalog.entry_action(item['entryId'], 'restore', {'expectedRevision': 999})

    def test_detach_tombstone_preserves_source(self):
        self.cycle()
        item, = self.import_root()
        before = self.hashes()
        self.catalog.entry_action(item['entryId'], 'detach', {'expectedRevision': 1})
        self.assertEqual(self.catalog.list_entries()['total'], 0)
        with self.store.transaction() as tx:
            self.assertTrue(tx.get('entries', item['entryId'])['detached'])
        self.assertEqual(self.hashes(), before)

    def test_reconnect_same_identity_and_reject_wrong_identity(self):
        self.cycle()
        item, = self.import_root()
        backup = self.base / 'moved'
        shutil.copytree(self.root, backup)
        candidate = self.catalog.probe({'root': str(backup)})
        body = {**candidate, 'expectedRevision': 1, 'idempotencyKey': 'relocate'}
        source = self.catalog.reconnect(item['sourceId'], body)
        self.assertEqual(self.catalog.reconnect(item['sourceId'], body), source)
        self.assertEqual(source['root'], str(backup.resolve()))
        self.assertEqual(self.catalog.journal(item['entryId'])['sourceId'], item['sourceId'])

    def test_explicit_foreign_source_id_rejected(self):
        self.cycle()
        self.cycle('projects/two', 'second')
        one, two = self.import_root()
        with self.assertRaises(CenterError):
            self.catalog.journal(one['entryId'], {'sourceId': two['sourceId']})

    def test_stat_refresh_skips_unchanged_and_marks_missing(self):
        self.cycle()
        item, = self.import_root()
        self.assertEqual(self.catalog.refresh_changed_sources()['refreshed'], 1)
        self.assertEqual(self.catalog.refresh_changed_sources()['refreshed'], 0)
        self.root.rename(self.base / 'removed')
        self.assertEqual(self.catalog.refresh_changed_sources()['refreshed'], 1)
        self.assertEqual(self.catalog.get_entry(item['entryId'])['availability'], 'missing')

    def test_sqlite_backup_includes_committed_wal(self):
        with self.store.transaction() as tx:
            tx.put('entries', 'saved', {'entryId': 'saved'})
        backup = self.store.backup()
        with sqlite3.connect(backup) as connection:
            self.assertIsNotNone(connection.execute("SELECT body FROM records WHERE id='saved'").fetchone())
        connection.close()
        with self.assertRaises(CenterError):
            self.store.backup(backup)

    def test_unknown_schema_does_not_change_journal_mode(self):
        self.store.close()
        path = self.base / 'center/center.sqlite3'
        with sqlite3.connect(str(path)) as connection:
            connection.execute("UPDATE metadata SET value='999' WHERE key='schemaVersion'")
            connection.commit()
            connection.execute('PRAGMA journal_mode=DELETE')
        connection.close()
        before = path.read_bytes()
        with self.assertRaises(CenterError):
            CenterStore(self.base / 'center')
        self.assertEqual(path.read_bytes(), before)

    def test_conflicting_backup_stays_candidate(self):
        row = self.cycle()
        self.import_root()
        backup = self.base / 'conflicting'
        shutil.copytree(self.root, backup)
        path = backup / '.auto-company/product-state.json'
        state = json.loads(path.read_text())
        state['cycles'][row['cycleId']]['state'] = 'failed'
        path.write_text(json.dumps(state))
        candidate = self.catalog.probe({'root': str(backup)})
        with self.assertRaises(CenterError) as context:
            self.catalog.commit(candidate)
        self.assertEqual(context.exception.code, 'SOURCE_CONFLICT')
        with self.store.transaction() as tx:
            self.assertEqual(len(tx.list('sources')), 1)
            self.assertIsNotNone(tx.get('candidates', candidate['candidateId']))

    def test_conflicting_usage_is_unknown_not_summed(self):
        row = self.cycle()
        path = self.root / 'logs/usage.jsonl'
        record = json.loads(path.read_text())
        record['usage']['total_tokens'] = 200
        with path.open('a') as output:
            output.write(json.dumps(record) + '\n')
        item, = self.import_root()
        usage = self.catalog.usage(item['entryId'])
        self.assertIsNone(usage['usage']['totalTokens'])
        self.assertEqual(usage['conflicting'], 1)
        self.assertEqual(usage['unknown'], 1)

    def test_managed_exploration_transition_preserves_entry(self):
        entry = {'entryId': 'entry', 'kind': 'exploration', 'productId': None, 'explorationId': None,
                 'preferredSourceId': 'source', 'revision': 1, 'archived': False, 'detached': False}
        source = {'sourceId': 'source', 'entryId': 'entry', 'runtimeId': 'runtime', 'root': str(self.root),
                  'kind': 'exploration', 'productId': None, 'explorationId': None, 'revision': 1, 'sourceRevision': 1}
        with self.store.transaction() as tx:
            tx.put('entries', 'entry', entry)
            tx.put('sources', 'source', source)
        self.assertEqual(self.catalog.refresh_source('source')['availability'], 'available')
        row = products.reserve_cycle(self.root, '', 'first', 1, 'fixture', 'no-model')
        self.catalog.refresh_source('source')
        (self.root / 'projects/created').mkdir(parents=True)
        product = products.register_project(self.root, 'projects/created', row['cycleId'])
        self.catalog.refresh_source('source')
        result = self.catalog.get_entry('entry')
        self.assertEqual(result['kind'], 'product')
        self.assertEqual(result['productId'], product['id'])
        self.assertEqual(result['entryId'], 'entry')

    def test_linked_exploration_separate_from_default_product_list(self):
        row = products.reserve_cycle(self.root, '', 'first', 1, 'fixture', 'no-model')
        (self.root / 'projects/created').mkdir(parents=True)
        products.register_project(self.root, 'projects/created', row['cycleId'])
        self.import_root()
        self.assertEqual(self.catalog.list_entries()['total'], 1)
        self.assertEqual(self.catalog.list_entries({'filter': 'exploration'})['total'], 1)
        exploration = self.catalog.list_entries({'filter': 'exploration'})['items'][0]
        self.assertEqual(exploration['availability'], 'available')
        self.assertEqual(self.catalog.journal(exploration['entryId'])['cycles'][0]['projectStatus'], 'current')

    def test_cycle_cursor_bound_to_history_snapshot(self):
        self.cycle(attempt='first')
        self.cycle(attempt='second')
        item, = self.import_root()
        page = self.catalog.journal(item['entryId'], {'limit': 1})
        next_page = self.catalog.journal(item['entryId'], {'before': page['nextBefore'], 'limit': 1})
        self.assertNotEqual(page['cycles'][0]['id'], next_page['cycles'][0]['id'])
        self.cycle(attempt='third')
        with self.assertRaises(CenterError) as context:
            self.catalog.journal(item['entryId'], {'before': page['nextBefore']})
        self.assertEqual(context.exception.code, 'CURSOR_EXPIRED')

    def test_missing_product_directory_keeps_identity_history(self):
        row = self.cycle()
        item, = self.import_root()
        (self.root / 'projects/one').rename(self.root / 'projects/gone')
        data = self.catalog.journal(item['entryId'])
        self.assertEqual(data['cycles'][0]['stableProductId'], row['productId'])
        self.assertEqual(data['project']['status'], 'historical')

    def test_usage_period_does_not_silently_return_all(self):
        self.cycle()
        item, = self.import_root()
        usage = self.catalog.usage(item['entryId'], {'period': 'day', 'date': '2025-01-01'})
        self.assertIsNone(usage['usage']['totalTokens'])
        self.assertEqual(usage['recorded'], 0)
        with self.assertRaises(CenterError):
            self.catalog.usage(item['entryId'], {'period': 'month'})

    def test_runtime_terminal_vocabulary_allows_archive(self):
        self.cycle()
        item, = self.import_root()
        with self.store.transaction() as tx:
            for state in ('ended', 'canceled'):
                tx.put('requests', state, {'entryId': item['entryId'], 'state': state})
        archived = self.catalog.entry_action(item['entryId'], 'archive', {'expectedRevision': 1})
        self.assertTrue(archived['archived'])

    def test_uncertain_binding_cannot_be_hidden_by_detach(self):
        self.cycle()
        item, = self.import_root()
        with self.store.transaction() as tx:
            tx.put('operations', 'uncertain', {'entryId': item['entryId'], 'kind': 'takeover', 'state': 'attention'})
        with self.assertRaises(CenterError) as context:
            self.catalog.entry_action(item['entryId'], 'detach', {'expectedRevision': 1})
        self.assertEqual(context.exception.code, 'ENTRY_BUSY')

    def test_preparing_entry_null_metadata_is_searchable_and_sortable(self):
        with self.store.transaction() as tx:
            tx.put('entries', 'preparing', {'entryId': 'preparing', 'kind': 'exploration', 'displayName': None,
                                          'description': None, 'revision': 1, 'preferredSourceId': None})
        self.assertEqual(self.catalog.list_entries({'filter': 'all', 'sort': 'name'})['total'], 1)
        self.assertEqual(self.catalog.list_entries({'filter': 'all', 'q': 'example'})['total'], 0)

    def test_source_only_reference_is_explicit_readonly_and_content_verified(self):
        self.write('README.md', '# Reference only\n')
        before = self.hashes()
        with self.assertRaises(CenterError):
            self.catalog.probe({'root': str(self.root)})
        candidate = self.catalog.probe({'root': str(self.root), 'kindHint': 'reference'})
        item, = self.catalog.commit({**candidate, 'idempotencyKey': 'reference-import'})['items']
        self.assertEqual(self.catalog.list_entries()['total'], 0)
        reference = self.catalog.list_entries({'filter': 'reference'})['items'][0]
        self.assertEqual(reference['displayName'], self.root.name)
        self.assertIsNone(reference['productId'])
        self.assertFalse(reference['capabilities']['execute'])
        self.assertEqual(self.catalog.resource(item['entryId'], 'reference-readme')[0], (self.root / 'README.md').read_bytes())
        self.assertEqual(self.hashes(), before)
        self.write('README.md', '# Changed reference\n')
        with self.assertRaises(CenterError) as context:
            self.catalog.resource(item['entryId'], 'reference-readme')
        self.assertEqual(context.exception.code, 'SOURCE_CHANGED')

    def test_registered_root_discovers_new_product_without_merging_history(self):
        original = self.cycle()
        old_item, = self.import_root()
        self.catalog.refresh_changed_sources()
        new_product = self.cycle('projects/two', 'new-product', 91)
        before = self.hashes()
        self.catalog.refresh_changed_sources()
        entries = self.catalog.list_entries()['items']
        self.assertEqual(len(entries), 2)
        discovered = next(row for row in entries if row['productId'] == new_product['productId'])
        self.assertIsNone(discovered['runtimeId'])
        self.assertFalse(discovered['capabilities']['execute'])
        self.assertEqual(self.catalog.usage(old_item['entryId'])['usage']['totalTokens'], 13)
        self.assertEqual(self.catalog.usage(discovered['entryId'])['usage']['totalTokens'], 91)
        self.assertEqual(self.hashes(), before)
        self.catalog.entry_action(discovered['entryId'], 'detach', {'expectedRevision': discovered['revision']})
        self.cycle(attempt='trigger-another-refresh')
        self.catalog.refresh_changed_sources()
        self.assertEqual(self.catalog.list_entries()['total'], 1)

    def test_discovery_waits_for_committed_identity_and_matching_marker(self):
        self.cycle()
        self.import_root()
        self.catalog.refresh_changed_sources()
        self.write('projects/metadata-only/.auto-company-project.json', '{"displayName":"not a product"}')
        self.catalog.refresh_changed_sources()
        self.assertEqual(self.catalog.list_entries()['total'], 1)
        new_product = self.cycle('projects/two', 'second')
        pending = self.write('.auto-company/product-state.transaction.json', '{"synthetic":"pending"}')
        self.catalog.refresh_changed_sources()
        self.assertEqual(self.catalog.list_entries()['total'], 1)
        pending.unlink()
        marker = self.root / 'projects/two/.auto-company/identity.json'
        marker.unlink()
        self.catalog.refresh_changed_sources()
        self.assertEqual(self.catalog.list_entries()['total'], 1)
        marker.write_text(json.dumps({'schemaVersion': 1, 'id': new_product['productId']}))
        self.write('.auto-company/product-state.lock/fixture', 'busy')
        self.catalog.refresh_changed_sources()
        self.assertEqual(self.catalog.list_entries()['total'], 1)
        (self.root / '.auto-company/product-state.lock/fixture').unlink()
        (self.root / '.auto-company/product-state.lock').rmdir()
        self.catalog.refresh_changed_sources()
        self.assertEqual(self.catalog.list_entries()['total'], 2)

    def test_language_period_is_not_a_stable_product_identity(self):
        from localization import start_product, next_product
        row = products.reserve_cycle(self.root, '', 'explore', 1, 'fixture', 'no-model')
        (self.root / 'projects/created').mkdir(parents=True)
        product = products.register_project(self.root, 'projects/created', row['cycleId'])
        products.update_cycle(self.root, row['cycleId'], 'completed')
        self.write('.auto-company.local', 'AUTO_COMPANY_LANGUAGE=en\n')
        original_language = start_product(self.root)
        ledger = (self.root / '.auto-company/product-state.json').read_bytes()
        marker = (self.root / 'projects/created/.auto-company/identity.json').read_bytes()
        settings = (self.root / '.auto-company.local').read_text().replace('AUTO_COMPANY_LANGUAGE=en', 'AUTO_COMPANY_LANGUAGE=zh-CN')
        self.write('.auto-company.local', settings)
        next_language = next_product(self.root, 'NEXT')
        self.assertNotEqual(original_language['productId'], next_language['productId'])
        self.assertEqual(next_language['language'], 'zh-CN')
        self.assertEqual((self.root / '.auto-company/product-state.json').read_bytes(), ledger)
        self.assertEqual((self.root / 'projects/created/.auto-company/identity.json').read_bytes(), marker)
        self.import_root()
        item = next(item for item in self.catalog.list_entries()['items'] if item['productId'] == product['id'])
        before = self.hashes()
        language = self.catalog.journal(item['entryId'])['languageState']
        self.assertIsNone(language['productLanguage'])
        self.assertEqual(language['productLanguageStatus'], 'unknown')
        self.assertEqual(self.hashes(), before)

    def test_actual_language_evidence_is_scoped_and_survives_root_period_change(self):
        one = self.cycle()
        two = self.cycle('projects/two', 'second')
        at = '2026-09-26T01:00:00+00:00'
        def context(row, project, language):
            return {'version': 1, 'cycleId': row['cycleId'], 'project': project, 'source': 'runtime_context', 'recordedAt': at,
                    'languageEvidence': {'schemaVersion': 1, 'productId': row['productId'], 'cycleId': row['cycleId'],
                                         'language': language, 'languagePeriodId': 'a' * 32, 'recordedAt': at}}
        self.write('logs/' + one['cycleId'] + '.context.json', json.dumps(context(one, 'projects/one', 'en')))
        self.write('logs/' + two['cycleId'] + '.context.json', json.dumps(context(two, 'projects/two', 'zh-CN')))
        self.write('.auto-company.local', 'AUTO_COMPANY_LANGUAGE=zh-CN\nAUTO_COMPANY_PRODUCT_LANGUAGE=zh-CN\nAUTO_COMPANY_PRODUCT_STATUS=active\n')
        self.import_root()
        items = self.catalog.list_entries()['items']
        item = next(item for item in items if item['productId'] == one['productId'])
        self.assertEqual(item['productLanguage'], 'en')
        before = self.hashes()
        snapshot = self.catalog.journal(item['entryId'])
        self.assertEqual(snapshot['languageState']['productLanguage'], 'en')
        self.assertEqual(snapshot['languageState']['productLanguageStatus'], 'recorded')
        self.assertEqual(snapshot['cycles'][0]['projectIdentity']['status'], 'recorded')
        self.assertEqual(self.hashes(), before)
        newer = self.cycle(attempt='newer')
        foreign = context(newer, 'projects/one', 'zh-CN')
        foreign['languageEvidence']['productId'] = two['productId']
        self.write('logs/' + newer['cycleId'] + '.context.json', json.dumps(foreign))
        self.assertEqual(self.catalog.journal(item['entryId'])['languageState']['productLanguage'], 'en')
        (self.root / 'projects/one').rename(self.root / 'projects/moved')
        products.relocate_identity(self.root, one['productId'], 'projects/moved')
        self.assertEqual(self.catalog.journal(item['entryId'])['languageState']['productLanguage'], 'en')

    def test_catalog_icon_is_verified_cached_and_source_scoped(self):
        from unittest.mock import patch
        one = self.cycle()
        two = self.cycle('projects/two', 'second')
        raw = b'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="24" fill="#123456"/></svg>'
        digest = hashlib.sha256(raw).hexdigest()
        folder = 'logs/product-media/' + one['productId'] + '/'
        self.write(folder + digest + '.svg', raw.decode())
        self.write(folder + 'media.json', json.dumps({'version': 1, 'productId': one['productId'], 'icon': {'name': digest + '.svg', 'sha256': digest}}))
        self.import_root()
        with patch('center_catalog.JournalSource.snapshot', side_effect=AssertionError('list must use cache')):
            entries = self.catalog.list_entries()['items']
        item = next(item for item in entries if item['productId'] == one['productId'])
        other = next(item for item in entries if item['productId'] == two['productId'])
        self.assertEqual(item['iconUrl'], '/api/center/v1/entries/' + item['entryId'] + '/resources/media-' + digest + '.svg?sourceId=' + item['sourceId'])
        self.assertIsNone(other['iconUrl'])
        self.assertEqual(self.catalog.resource(item['entryId'], 'media-' + digest + '.svg', item['sourceId'])[0], raw)
        with self.assertRaises(CenterError):
            self.catalog.resource(other['entryId'], 'media-' + digest + '.svg', item['sourceId'])
        self.catalog.refresh_changed_sources()
        self.write(folder + digest + '.svg', 'changed')
        self.catalog.refresh_changed_sources()
        self.assertIsNone(self.catalog.get_entry(item['entryId'])['iconUrl'])


if __name__ == '__main__':
    unittest.main()
