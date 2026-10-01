"""Disposable center API fixture; no model, clone, or runtime dispatch."""
import argparse
import json
from pathlib import Path
import sys
import threading
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(ROOT / 'tests'), str(ROOT / 'dashboard'), str(ROOT / 'scripts/core')]
from test_center_catalog import CenterCatalogTests
from test_center_runtime import FakeAdapter
from center_runtime import CenterRuntime
from center_server import CenterServer
from runtime_artifacts import base_record, save
from cycle_reports import write_report

parser = argparse.ArgumentParser()
parser.add_argument('--cycles', type=int, choices=(6, 36), default=6)
parser.add_argument('--exploration-cycles', type=int, choices=(0, 3), default=0)
args = parser.parse_args()
case = CenterCatalogTests()
case.setUp()
server = None
try:
    for number in range(1, args.exploration_cycles + 1):
        cycle = case.cycle('', 'exploration-' + str(number), tokens=10,
                           created_project='projects/one' if number == args.exploration_cycles else None)
        write_report(case.root, cycle['cycleId'], {'title': f'Fixture exploration round {number}',
                     'summary': f'Recorded exploration detail {number}', 'phase': 'review', 'blocker': '', 'final': True}, '')
    for number in range(1, args.cycles + 1):
        cycle = case.cycle(attempt='browser-' + str(number), tokens=10)
        write_report(case.root, cycle['cycleId'], {'title': f'Fixture round {number}',
                     'summary': f'Recorded fixture detail {number}', 'phase': 'review', 'blocker': '', 'final': True}, 'projects/one')
    ledger = case.root / 'logs/usage.jsonl'
    rows = [json.loads(line) for line in ledger.read_text().splitlines()]
    for number, row in enumerate(rows, 1):
        row.update(started_at=f'2026-09-26T01:{number:02d}:00+00:00',
                   ended_at=f'2026-09-26T01:{number:02d}:30+00:00')
    ledger.write_text(''.join(json.dumps(row) + '\n' for row in rows))
    case.write('.auto-company.local', 'ACTIVE_PROJECT=projects/one\nAUTO_COMPANY_LANGUAGE=en\n')
    entry = next(row for row in case.import_root() if case.catalog.get_entry(row['entryId'])['kind'] == 'product')
    preview = base_record('projects/one', 'preview', case.root)
    preview.update(cycleId=None, state='running', lifetime='operator',
                   url='http://127.0.0.1:12345/', token='a' * 32)
    save(case.root, preview)
    runtime = CenterRuntime(case.store, case.catalog, ROOT, {'platform': 'posix'}, adapter=FakeAdapter())
    with case.store.transaction() as tx:
        preferences = tx.get('preferences', 'main')
        preferences.update(language='en', productLanguage='en')
        tx.put('preferences', 'main', preferences)

    def preparation_failure(callback, operation_id):
        # Keep the real create validation, persistence and HTTP response; replace
        # only the clone worker so the browser can observe a durable failure.
        with case.store.transaction() as tx:
            operation = tx.get('operations', operation_id)
            operation.update(state='failed', reason='FRAMEWORK_UNVERIFIED', revision=2)
            tx.put('operations', operation_id, operation)

    runtime._worker = preparation_failure
    # A health result is injected to test scoped links, not preview processes.
    with patch('observability_data.preview_available', return_value=True):
        server = CenterServer(('127.0.0.1', 0), case.store, case.catalog, runtime, case.root)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        print(json.dumps({'url': f'http://127.0.0.1:{server.server_address[1]}',
                          'entryId': entry['entryId'], 'sourceId': entry['sourceId'],
                          'firstCycleId': rows[0]['cycle_id'], 'previewUrl': preview['url'],
                          'explorationCycleIds': [row['cycle_id'] for row in rows[:args.exploration_cycles]]}), flush=True)
        sys.stdin.read()
finally:
    if server:
        server.shutdown()
        server.server_close()
        thread.join(5)
    case.doCleanups()
