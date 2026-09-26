"""Read-only source registration and identity-scoped catalog projections."""
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
import base64
import hashlib
import json
import os
import stat
import threading
import uuid
from urllib.parse import quote

from center_store import CenterError
from journal_data import JournalSource, ProductScope, CYCLE_ID


TERMINAL = {'completed', 'failed', 'cancelled', 'canceled', 'ended', 'stopped', 'interrupted', 'not_started'}


def now():
    return datetime.now(timezone.utc).isoformat()


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False, allow_nan=False).encode()).hexdigest()


def uid(prefix):
    return prefix + '-' + uuid.uuid4().hex


def bounded_int(value, default, maximum):
    try:
        result = int(value if value is not None else default)
    except (ValueError, TypeError, OverflowError) as error:
        raise CenterError('INVALID_INPUT', 'Invalid page size.') from error
    if isinstance(value, bool) or not 1 <= result <= maximum:
        raise CenterError('INVALID_INPUT', 'Page size is outside supported bounds.')
    return result


def root_path(value):
    if not isinstance(value, str) or not value or len(value) > 4096:
        raise CenterError('INVALID_INPUT', 'An explicit absolute source directory is required.')
    candidate = Path(value).expanduser()
    if not candidate.is_absolute():
        raise CenterError('INVALID_INPUT', 'Source directory must be absolute.')
    for part in (candidate, *candidate.parents):
        if part.is_symlink() or getattr(part, 'is_junction', lambda: False)():
            raise CenterError('UNSAFE_SOURCE', 'Linked source directories are unsupported.', 422)
        try:
            if getattr(part.lstat(), 'st_file_attributes', 0) & getattr(stat, 'FILE_ATTRIBUTE_REPARSE_POINT', 0):
                raise CenterError('UNSAFE_SOURCE', 'Reparse source directories are unsupported.', 422)
        except OSError:
            pass
    if not candidate.is_dir():
        raise CenterError('SOURCE_MISSING', 'Source directory is unavailable.', 404)
    return candidate.resolve()


class CenterCatalog:
    def __init__(self, store):
        self.store = store
        self._refresh_index = 0
        self._stat_signatures = {}
        self._refresh_lock = threading.Lock()
        self._source_refresh_lock = threading.RLock()

    def _scan(self, root, kind_hint=None):
        source = JournalSource(root)
        try:
            state = source.identity_state()
        except (OSError, ValueError, TypeError, KeyError, RecursionError) as error:
            raise CenterError('SOURCE_CONFLICT', 'Product identity ledger is invalid or unsupported.', 409) from error
        if len(state['identities']) > 1000:
            raise CenterError('SOURCE_TOO_LARGE', 'This source exceeds the supported identity limit.', 422)
        items = []
        legacy_evidence = None
        for identity, row in state['identities'].items():
            project = row.get('project') or None
            scoped = JournalSource(root, scope=ProductScope(row['kind'], identity if row['kind'] == 'product' else None,
                                                            identity if row['kind'] == 'exploration' else row.get('explorationId'), project))
            metadata = scoped.project()
            items.append({'itemId': identity, 'kind': row['kind'], 'productId': identity if row['kind'] == 'product' else None,
                          'explorationId': identity if row['kind'] == 'exploration' else row.get('explorationId'),
                          'project': project, 'displayName': metadata['displayName'], 'description': metadata['description'],
                          'identityFingerprint': digest({'id': identity, 'kind': row['kind']}),
                          'cycleEvidence': {key: digest(value) for key, value in state['cycles'].items() if value['identityId'] == identity},
                          'linkedProductId': row.get('linkedProductId'), 'cycleCount': row['lastCycleNumber']})
        if not items:
            records, warnings = source.ledger()
            legacy_evidence = {'records': records, 'delivery': source.optional('DELIVERY.md')}
            # An explicitly selected checkout with only bundled example projects
            # is not a user product. Legacy evidence must come from run records.
            if records or source.optional('DELIVERY.md'):
                items.append({'itemId': 'legacy', 'kind': 'legacy', 'productId': None, 'explorationId': None,
                              'project': source.project()['id'], 'displayName': source.project()['displayName'],
                              'description': '', 'identityFingerprint': digest({'legacyRoot': [root.stat().st_dev, root.stat().st_ino], 'project': source.project()['id']}),
                              'cycleCount': len(records)})
            elif kind_hint == 'reference':
                documents = []
                try:
                    content, truncated = source.read('README.md')
                    if not truncated:
                        documents.append({'id': 'reference-readme', 'path': 'README.md', 'label': 'README.md',
                                          'sha256': hashlib.sha256(content.encode('utf-8')).hexdigest()})
                except (OSError, ValueError):
                    pass
                items.append({'itemId': 'reference', 'kind': 'reference', 'productId': None, 'explorationId': None,
                              'project': None, 'displayName': root.name, 'description': '', 'cycleCount': 0,
                              'identityFingerprint': digest({'referenceRoot': [root.stat().st_dev, root.stat().st_ino]}),
                              'registeredDocuments': documents})
            else:
                raise CenterError('NO_RECORDED_PRODUCTS', 'No recorded product or exploration was found in this directory.', 422)
        evidence = {'state': state, 'items': items, 'legacyEvidence': legacy_evidence, 'rootIdentity': [root.stat().st_dev, root.stat().st_ino]}
        return {'root': str(root), 'items': items, 'fingerprint': digest(evidence), 'warnings': []}

    def probe(self, body):
        root = root_path(body.get('root'))
        kind_hint = body.get('kindHint')
        if kind_hint not in {None, 'reference'}:
            raise CenterError('INVALID_INPUT', 'Unsupported source kind hint.')
        scan = self._scan(root, kind_hint)
        candidate = {**scan, 'candidateId': uid('candidate'), 'candidateHash': digest(scan),
                     'kindHint': kind_hint,
                     'createdAt': now(), 'expiresAt': (datetime.now(timezone.utc) + timedelta(minutes=15)).isoformat()}
        with self.store.transaction() as tx:
            existing = tx.list('entries')
            for item in candidate['items']:
                matches = [entry for entry in existing if item['productId'] and entry.get('productId') == item['productId'] and not entry.get('detached')]
                item['existingEntryId'] = matches[0]['entryId'] if matches else None
                item['readOnly'] = True
            tx.put('candidates', candidate['candidateId'], candidate)
        return candidate

    def _candidate(self, body):
        with self.store.transaction() as tx:
            candidate = tx.get('candidates', body.get('candidateId'))
        if not candidate or body.get('candidateHash') != candidate['candidateHash']:
            raise CenterError('CANDIDATE_INVALID', 'Import candidate is missing or does not match.', 409)
        if datetime.fromisoformat(candidate['expiresAt']) < datetime.now(timezone.utc):
            raise CenterError('CANDIDATE_EXPIRED', 'Import candidate expired; probe again.', 409)
        current = self._scan(root_path(candidate['root']), candidate.get('kindHint'))
        if current['fingerprint'] != candidate['fingerprint']:
            raise CenterError('SOURCE_CHANGED', 'Source changed after inspection; probe again.', 409)
        return candidate

    def commit(self, body):
        key = body.get('idempotencyKey')
        body_hash = digest(body)
        if key:
            with self.store.transaction() as tx:
                prior = tx.get('idempotency', 'import:' + str(key))
                if prior:
                    if prior['hash'] != body_hash:
                        raise CenterError('IDEMPOTENCY_CONFLICT', 'This key has different input.', 409)
                    return prior['result']
        candidate = self._candidate(body)
        mode = body.get('mode', 'readonly')
        if mode not in {'readonly', 'reference', 'read_only'}:
            raise CenterError('INVALID_INPUT', 'Import does not grant execution authority.')
        selected = body.get('itemIds', [row['itemId'] for row in candidate['items']])
        if not isinstance(selected, list) or not selected or any(item not in {row['itemId'] for row in candidate['items']} for item in selected):
            raise CenterError('INVALID_INPUT', 'Select inspected candidate items.')
        results = []
        with self.store.transaction() as tx:
            if key:
                prior = tx.get('idempotency', 'import:' + str(key))
                if prior:
                    if prior['hash'] != body_hash:
                        raise CenterError('IDEMPOTENCY_CONFLICT', 'This key has different input.', 409)
                    return prior['result']
            for item in candidate['items']:
                if item['itemId'] not in selected:
                    continue
                entries, sources = tx.list('entries'), tx.list('sources')
                duplicate = next((row for row in sources if os.path.normcase(row['root']) == os.path.normcase(candidate['root'])
                                  and row.get('identityFingerprint') == item['identityFingerprint'] and not row.get('detached')), None)
                if duplicate:
                    if duplicate.get('kind') == 'reference' and duplicate.get('registeredDocuments') != item.get('registeredDocuments', []):
                        duplicate.update(registeredDocuments=item.get('registeredDocuments', []), fingerprint=candidate['fingerprint'],
                                         sourceRevision=duplicate['sourceRevision'] + 1)
                        tx.put('sources', duplicate['sourceId'], duplicate)
                    results.append({'entryId': duplicate['entryId'], 'sourceId': duplicate['sourceId'], 'duplicate': True})
                    continue
                entry = next((row for row in entries if not row.get('detached') and
                              ((item['productId'] and row.get('productId') == item['productId']) or
                               (item['kind'] == 'exploration' and row.get('explorationId') == item['explorationId'] and row['kind'] == 'exploration'))), None)
                # Additional copies can only be registered as read-only sources.
                # Conflicting cycle IDs remain explicit and cannot gain authority.
                conflicts = []
                if entry:
                    for other in sources:
                        if other['entryId'] == entry['entryId']:
                            previous, incoming = other.get('cycleEvidence', {}), item.get('cycleEvidence', {})
                            if any(previous[key] != incoming[key] for key in previous.keys() & incoming.keys()) or (previous.keys() - incoming.keys() and incoming.keys() - previous.keys()):
                                raise CenterError('SOURCE_CONFLICT', 'These copies contain conflicting cycle history; candidate retained for inspection.', 409)
                source_id = uid('source')
                if not entry:
                    entry = {'entryId': uid('entry'), 'kind': 'reference' if mode == 'reference' else item['kind'],
                             'productId': item['productId'], 'explorationId': item['explorationId'],
                             'displayName': item['displayName'], 'description': item['description'],
                             'preferredSourceId': source_id, 'archived': False, 'detached': False,
                             'createdAt': now(), 'revision': 1}
                    tx.put('entries', entry['entryId'], entry)
                source = {'sourceId': source_id, 'entryId': entry['entryId'], 'runtimeId': None,
                          'root': candidate['root'], 'project': item['project'], 'productId': item['productId'],
                          'explorationId': item['explorationId'], 'kind': item['kind'],
                          'identityFingerprint': item['identityFingerprint'], 'fingerprint': candidate['fingerprint'],
                          'cycleEvidence': item.get('cycleEvidence', {}),
                          'registeredDocuments': item.get('registeredDocuments', []),
                          'sourceRevision': 1, 'revision': 1, 'availability': 'available', 'warnings': conflicts,
                          'capabilities': {'readJournal': True, 'readMedia': bool(item['productId']), 'execute': False, 'preview': False, 'capture': False},
                          'lastVerifiedAt': now()}
                tx.put('sources', source_id, source)
                results.append({'entryId': entry['entryId'], 'sourceId': source_id, 'duplicate': False})
            result = {'items': results}
            if key:
                tx.put('idempotency', 'import:' + str(key), {'hash': body_hash, 'result': result})
        for result in results:
            self.refresh_source(result['sourceId'])
        return {'items': results}

    def resolve_source(self, entry_id, source_id=None):
        with self.store.transaction() as tx:
            entry = tx.get('entries', entry_id)
            if not entry or entry.get('detached'):
                raise CenterError('ENTRY_NOT_FOUND', 'Entry is unavailable.', 404)
            source = tx.get('sources', source_id or entry.get('preferredSourceId'))
        if not source or source['entryId'] != entry_id or source.get('detached'):
            raise CenterError('SOURCE_NOT_FOUND', 'Source does not belong to this entry.', 404)
        root = root_path(source['root'])
        reader = JournalSource(root)
        try:
            state = reader.identity_state()
        except (OSError, ValueError, TypeError, KeyError, RecursionError) as error:
            raise CenterError('SOURCE_CONFLICT', 'Registered source identity records are unreadable.', 409) from error
        identity = source.get('productId') or source.get('explorationId')
        if identity:
            row = state['identities'].get(identity)
            if not row:
                raise CenterError('SOURCE_CONFLICT', 'The registered identity is missing from this source.', 409)
            # Relocation changes the location, never the identity. Reused paths
            # remain historical and cannot expose their replacement metadata.
            project = row.get('project') or None
        elif state['identities'] and source['kind'] == 'exploration':
            identity = state.get('explorationId')
            if not identity:
                raise CenterError('SOURCE_CHANGED', 'Exploration identity is unavailable.', 409)
            project = None
        elif state['identities']:
            raise CenterError('SOURCE_CHANGED', 'Legacy source now contains stable identities; inspect it again.', 409)
        else:
            project = source.get('project')
        scope = ProductScope(source['kind'], source.get('productId'), source.get('explorationId') or (identity if source['kind'] == 'exploration' else None), project)
        return entry, source, JournalSource(root, scope=scope)

    def refresh_source(self, source_id):
        with self._source_refresh_lock:
            return self._refresh_source(source_id)

    def _refresh_source(self, source_id):
        with self.store.transaction() as tx:
            source = tx.get('sources', source_id)
        if not source:
            raise CenterError('SOURCE_NOT_FOUND', 'Source is unavailable.', 404)
        try:
            entry, old_source, reader = self.resolve_source(source['entryId'], source_id)
            state = reader.identity_state()
            identity = source.get('productId') or source.get('explorationId')
            # New managed roots have no exploration ID until the first reserve.
            transition = state.get('continuationProductId') if source['kind'] == 'exploration' and source.get('runtimeId') else None
            if source['kind'] == 'exploration' and not identity:
                source['explorationId'] = state.get('explorationId')
            if transition:
                with self.store.transaction() as tx:
                    conflict = next((row for row in tx.list('entries') if row.get('productId') == transition and row['entryId'] != entry['entryId'] and not row.get('detached')), None)
                if conflict:
                    raise CenterError('SOURCE_CONFLICT', 'The new product identity is already registered.', 409)
                source.update(kind='product', productId=transition, project=state['identities'][transition]['project'])
                entry.update(kind='product', productId=transition)
                reader = JournalSource(reader.root, scope=ProductScope('product', transition, source.get('explorationId'), source['project']))
            source['project'] = reader.scope.project
            identity = source.get('productId') or source.get('explorationId')
            if identity:
                source['identityFingerprint'] = digest({'id': identity, 'kind': source['kind']})
                source['cycleEvidence'] = {key: digest(value) for key, value in state['cycles'].items() if value['identityId'] == identity}
            snapshot = reader.snapshot()
            cycles = [row for row in snapshot['cycles'] if row.get('identityKind') != 'exploration' or source['kind'] == 'exploration']
            latest = cycles[0] if cycles else {}
            metadata = snapshot['project']
            if source['kind'] == 'reference':
                metadata = {**metadata, 'displayName': reader.root.name, 'description': ''}
            icon_name = ((snapshot.get('productMedia') or {}).get('icon') or {}).get('name')
            icon_resource = None
            if icon_name and source.get('productId'):
                try:
                    reader.media_resource(source['productId'], icon_name)
                    icon_resource = 'media-' + icon_name
                except (OSError, ValueError):
                    pass
            projection = {'displayName': metadata['displayName'], 'description': metadata['description'],
                          'iconResourceId': icon_resource,
                          'productLanguage': snapshot['languageState'].get('productLanguage'),
                          'productLanguageStatus': snapshot['languageState'].get('productLanguageStatus', 'unknown'),
                          'languagePeriodId': snapshot['languageState'].get('languagePeriodId'),
                          'latestTitle': (latest.get('workReport') or {}).get('title') if isinstance(latest.get('workReport'), dict) else None,
                          'cycleNumber': latest.get('number'), 'reportedPhase': (latest.get('workReport') or {}).get('phase') if isinstance(latest.get('workReport'), dict) else None,
                          'lastActivityAt': latest.get('endedAt') or latest.get('startedAt') or latest.get('reservedAt'),
                          'warnings': snapshot['warnings']}
            fingerprint = digest({'state': state, 'projection': projection})
            if source.get('projectionFingerprint') != fingerprint:
                source['sourceRevision'] = source.get('sourceRevision', 0) + 1
            source.update(projectionFingerprint=fingerprint, availability='available', lastVerifiedAt=now())
            entry.update(displayName=metadata['displayName'], description=metadata['description'])
            with self.store.transaction() as tx:
                current = tx.get('sources', source_id)
                if current and current.get('revision') == old_source.get('revision'):
                    if source.get('productId') and any(row.get('productId') == source['productId'] and row['entryId'] != entry['entryId'] and not row.get('detached') for row in tx.list('entries')):
                        raise CenterError('SOURCE_CONFLICT', 'Product identity is already registered.', 409)
                    tx.put('sources', source_id, source)
                    tx.put('projections', source_id, projection)
                    current_entry = tx.get('entries', entry['entryId'])
                    if current_entry:
                        changes = {'kind': entry['kind'], 'productId': source.get('productId'), 'explorationId': source.get('explorationId'),
                                   'displayName': metadata['displayName'], 'description': metadata['description']}
                        if any(current_entry.get(key) != value for key, value in changes.items()):
                            current_entry.update(changes)
                            current_entry['revision'] += 1
                            tx.put('entries', entry['entryId'], current_entry)
            return source
        except (CenterError, OSError, ValueError, TypeError, KeyError, RecursionError, OverflowError) as error:
            with self.store.transaction() as tx:
                source = tx.get('sources', source_id) or source
                source.update(availability='missing' if isinstance(error, CenterError) and error.code == 'SOURCE_MISSING' else 'conflict',
                              warnings=[error.code if isinstance(error, CenterError) else 'source_unreadable'])
                tx.put('sources', source_id, source)
            return source

    def _entry_view(self, tx, entry, source_id=None):
        source = tx.get('sources', source_id or entry.get('preferredSourceId')) or {}
        if source and source.get('entryId') != entry['entryId']:
            raise CenterError('SOURCE_NOT_FOUND', 'Source does not belong to this entry.', 404)
        projection = tx.get('projections', source.get('sourceId')) or {}
        capabilities = dict(source.get('capabilities', {}))
        if entry.get('archived') or source.get('availability') != 'available':
            capabilities.update(execute=False, preview=False, capture=False)
        reason = 'ENTRY_ARCHIVED' if entry.get('archived') else 'SOURCE_UNAVAILABLE' if source.get('availability') != 'available' else 'READ_ONLY_SOURCE'
        return {**entry, **projection, 'sourceId': source.get('sourceId'), 'runtimeId': source.get('runtimeId'),
                'sourceRevision': source.get('sourceRevision'), 'availability': source.get('availability', 'unknown'),
                'capabilities': capabilities, 'capabilityReasons': {key: reason for key in ('execute', 'preview', 'capture') if not capabilities.get(key)}, 'executionSummary': {'state': 'unknown'},
                'iconUrl': '/api/center/v1/entries/' + quote(entry['entryId']) + '/resources/' + quote(projection['iconResourceId']) + '?sourceId=' + quote(source['sourceId'])
                if projection.get('iconResourceId') and source.get('availability') == 'available' else None,
                'warnings': list(dict.fromkeys(projection.get('warnings', []) + source.get('warnings', [])))}

    def list_entries(self, query=None):
        query = query or {}
        limit = bounded_int(query.get('limit'), 30, 100)
        search = str(query.get('q', '')).casefold()
        if len(search) > 500:
            raise CenterError('INVALID_INPUT', 'Search is too long.')
        filter_value, sort_value = query.get('filter', 'active'), query.get('sort', 'activity')
        if filter_value not in {'active', 'all', 'archived', 'product', 'exploration', 'legacy', 'reference'} or sort_value not in {'activity', 'name'}:
            raise CenterError('INVALID_INPUT', 'Unsupported catalog filter or sort.')
        query_hash = digest([search, filter_value, sort_value])
        with self.store.transaction() as tx:
            items = [self._entry_view(tx, row) for row in tx.list('entries') if not row.get('detached')]
        items = [row for row in items if (filter_value != 'active' or not row.get('archived') and row['kind'] in {'product', 'legacy'})
                 and (filter_value != 'archived' or row.get('archived'))
                 and (filter_value not in {'product', 'exploration', 'legacy', 'reference'} or row['kind'] == filter_value)
                 and (not search or search in ((row.get('displayName') or '') + ' ' + (row.get('description') or '')).casefold())]
        items.sort(key=lambda row: ((row.get('displayName') or '').casefold() if sort_value == 'name' else row.get('lastActivityAt') or '', row['entryId']), reverse=sort_value == 'activity')
        snapshot = digest(items)
        offset = 0
        if query.get('cursor'):
            try:
                if len(query['cursor']) > 2048:
                    raise ValueError()
                cursor = json.loads(base64.urlsafe_b64decode(query['cursor'].encode()))
                if cursor['query'] != query_hash or cursor['snapshot'] != snapshot or type(cursor['offset']) is not int or cursor['offset'] < 0:
                    raise ValueError()
                offset = cursor['offset']
            except (ValueError, TypeError, KeyError) as error:
                raise CenterError('CURSOR_EXPIRED', 'Catalog changed; reload the first page.', 409) from error
        selected = items[offset:offset + limit]
        cursor = base64.urlsafe_b64encode(json.dumps({'query': query_hash, 'snapshot': snapshot, 'offset': offset + limit}).encode()).decode() if offset + limit < len(items) else None
        return {'items': selected, 'nextCursor': cursor, 'total': len(items)}

    def get_entry(self, entry_id, source_id=None):
        with self.store.transaction() as tx:
            entry = tx.get('entries', entry_id)
            if not entry or entry.get('detached'):
                raise CenterError('ENTRY_NOT_FOUND', 'Entry is unavailable.', 404)
            result = self._entry_view(tx, entry, source_id)
            result['sources'] = []
            for row in tx.list('sources'):
                if row['entryId'] != entry_id or row.get('detached'):
                    continue
                display_path = row.get('root') or ''
                root_name = display_path.replace('\\', '/').rstrip('/').rsplit('/', 1)[-1]
                result['sources'].append({**{key: value for key, value in row.items() if key not in {'root', 'fingerprint', 'identityFingerprint'}},
                                          'displayName': root_name, 'rootName': root_name, 'displayPath': display_path,
                                          'lastVerifiedAt': row.get('lastVerifiedAt')})
            return result

    def journal(self, entry_id, query=None):
        query = query or {}
        entry, source, reader = self.resolve_source(entry_id, query.get('sourceId'))
        data = reader.snapshot()
        exploration = query.get('section') == 'exploration'
        if entry['kind'] == 'product':
            items = [row for row in data['cycles'] if (row.get('identityKind') == 'exploration') == exploration]
        else:
            items = data['cycles']
        total = len(items)
        cursor_scope = digest([entry_id, source['sourceId'], exploration, [(row['id'], row.get('startedAt'), row.get('status')) for row in items]])
        before = query.get('before')
        if before:
            try:
                if len(before) > 2048:
                    raise ValueError()
                cursor = json.loads(base64.urlsafe_b64decode(before.encode()))
                positions = [index for index, row in enumerate(items) if row['id'] == cursor['cycleId']]
                if cursor['scope'] != cursor_scope or not positions:
                    raise ValueError()
            except (ValueError, KeyError, TypeError) as error:
                raise CenterError('CURSOR_EXPIRED', 'Cycle history changed; reload the first page.', 409) from error
            items = items[positions[0] + 1:]
        limit = bounded_int(query.get('limit'), 20 if before else 5, 100)
        data['cycles'] = items[:limit]
        data['nextBefore'] = base64.urlsafe_b64encode(json.dumps({'cycleId': items[limit - 1]['id'], 'scope': cursor_scope}).encode()).decode() if len(items) > limit else None
        data['total'] = total
        data.update(entryId=entry_id, sourceId=source['sourceId'], sourceRevision=source['sourceRevision'], entry=self.get_entry(entry_id, source['sourceId']))
        data['explorationAvailable'] = any(row.get('identityKind') == 'exploration' for row in data['cycles']) if exploration else bool(entry.get('explorationId'))
        base = '/api/center/v1/entries/' + quote(entry_id) + '/resources/'
        if source['kind'] == 'reference':
            for item in source.get('registeredDocuments', []):
                try:
                    content, truncated = reader.read(item['path'])
                    available = not truncated and hashlib.sha256(content.encode('utf-8')).hexdigest() == item['sha256']
                except (OSError, ValueError):
                    available = False
                data['artifacts'].append({**item, 'kind': 'document', 'available': available,
                                          'url': base + item['id'] + '?sourceId=' + quote(source['sourceId']) if available else None})
        for row in data['cycles']:
            row['logUrl'] = base + 'log-' + quote(row['id']) + '?sourceId=' + quote(source['sourceId']) if row.get('logAvailable') else None
        for item in data['artifacts']:
            if item.get('id') and not item['id'].startswith('reference-'):
                item['url'] = base + 'artifact-' + quote(item['id']) + '?sourceId=' + quote(source['sourceId'])
        media = data.get('productMedia') or {}
        images = [media.get('icon'), *((media.get('screenshot') or {}).get('latestSuccess') or {}).get('variants', [])]
        for item in images:
            if item and item.get('name'):
                item['href'] = base + 'media-' + quote(item['name']) + '?sourceId=' + quote(source['sourceId'])
        return data

    def usage(self, entry_id, query=None):
        query = query or {}
        entry, source, reader = self.resolve_source(entry_id, query.get('sourceId'))
        snapshot = reader.snapshot()
        include = query.get('includeExploration') in {True, 'true', '1'}
        cycles = [row for row in snapshot['cycles'] if include or entry['kind'] != 'product' or row.get('identityKind') != 'exploration']
        period = query.get('period', 'day' if query.get('date') else 'all')
        if period not in {'all', 'day', 'week'}:
            raise CenterError('INVALID_INPUT', 'Unsupported usage period.')
        start = end = None
        unknown_time = 0
        if period != 'all':
            try:
                target = date.fromisoformat(query['date']) if query.get('date') else datetime.now().astimezone().date()
            except (ValueError, TypeError) as error:
                raise CenterError('INVALID_INPUT', 'Invalid usage date.') from error
            start = target if period == 'day' else target - timedelta(days=target.weekday())
            end = start if period == 'day' else start + timedelta(days=6)
            selected = []
            for row in cycles:
                value = row.get('endedAt') or row.get('startedAt') or row.get('reservedAt')
                if not value:
                    unknown_time += 1
                elif start <= datetime.fromisoformat(value).astimezone().date() <= end:
                    selected.append(row)
            cycles = selected
        usage = {}
        for key in ('inputTokens', 'outputTokens', 'totalTokens'):
            values = [row['usage'].get(key) for row in cycles]
            known = [value for value in values if type(value) is int]
            usage[key] = sum(known) if known else None
        timestamps = sorted(row.get('startedAt') or row.get('reservedAt') for row in cycles if row.get('startedAt') or row.get('reservedAt'))
        conflicting = sum(int(warning.rsplit(':', 1)[1]) for warning in snapshot['warnings'] if warning.startswith('ledger_conflicting_ids:'))
        return {'entryId': entry_id, 'sourceId': source['sourceId'], 'sourceRevision': source['sourceRevision'], 'usage': usage,
                'period': period, 'startDate': start.isoformat() if start else None, 'endDate': end.isoformat() if end else None, 'unknownTime': unknown_time,
                'recorded': sum(row['usage'].get('totalTokens') is not None for row in cycles),
                'unknown': sum(row['usage'].get('totalTokens') is None for row in cycles), 'conflicting': conflicting,
                'truncated': any('truncated' in warning for warning in snapshot['warnings']),
                'coverageStart': timestamps[0] if timestamps else None, 'coverageEnd': timestamps[-1] if timestamps else None,
                'warnings': snapshot['warnings']}

    def record(self, entry_id, record_id, source_id=None):
        entry, source, reader = self.resolve_source(entry_id, source_id)
        if not isinstance(record_id, str) or not CYCLE_ID.fullmatch(record_id):
            raise CenterError('RECORD_NOT_FOUND', 'Record is unavailable.', 404)
        row = next((row for row in reader.snapshot()['cycles'] if row['id'] == record_id), None)
        if not row:
            raise CenterError('RECORD_NOT_FOUND', 'Record does not belong to this entry.', 404)
        if row.get('detailStatus') == 'limited':
            from cycle_reports import read_report
            from observability_data import cycle_events
            row.update(read_report(reader, row))
            row.update(cycle_events(reader, row))
            row['detailStatus'] = 'recorded'
        return row

    def resource(self, entry_id, resource_id, source_id=None):
        entry, source, reader = self.resolve_source(entry_id, source_id)
        if source['kind'] == 'reference' and resource_id == 'reference-readme':
            item = next((row for row in source.get('registeredDocuments', []) if row['id'] == resource_id), None)
            if item:
                content, truncated = reader.read(item['path'])
                if not truncated and hashlib.sha256(content.encode('utf-8')).hexdigest() == item['sha256']:
                    return content.encode('utf-8'), 'text/plain; charset=utf-8'
                raise CenterError('SOURCE_CHANGED', 'Registered reference document changed; inspect it again.', 409)
        if resource_id.startswith('log-'):
            cycle_id = resource_id[4:]
            self.record(entry_id, cycle_id, source_id)
            try:
                raw, truncated = reader.read('logs/' + cycle_id + '.log', 128 * 1024, tail=True)
            except (OSError, ValueError) as error:
                raise CenterError('RESOURCE_NOT_FOUND', 'Recorded log was not retained.', 404) from error
            return raw.encode('utf-8'), 'text/plain; charset=utf-8'
        if resource_id.startswith('artifact-'):
            artifact_id = resource_id[9:]
            item = next((item for item in reader.documents() if item.get('id') == artifact_id and item.get('available')), None)
            if item and item.get('path'):
                raw, truncated = reader.document(item['path'])
                return raw.encode('utf-8'), 'text/plain; charset=utf-8'
        if resource_id.startswith('media-') and source.get('productId'):
            return reader.media_resource(source['productId'], resource_id[6:])
        raise CenterError('RESOURCE_NOT_FOUND', 'Resource does not belong to this entry.', 404)

    def _idle(self, tx, entry_id):
        if any(row.get('entryId') == entry_id and row.get('state') not in TERMINAL for row in tx.list('requests')):
            raise CenterError('ENTRY_BUSY', 'This entry has an open request.', 409)
        if any(row.get('entryId') == entry_id and row.get('state') in {'preparing', 'running', 'pending', 'attention'} for row in tx.list('operations')):
            raise CenterError('ENTRY_BUSY', 'This entry has an active operation.', 409)

    def entry_action(self, entry_id, action, body):
        with self.store.transaction() as tx:
            entry = tx.get('entries', entry_id)
            if not entry or entry.get('detached'):
                raise CenterError('ENTRY_NOT_FOUND', 'Entry is unavailable.', 404)
            if body.get('expectedRevision') != entry['revision']:
                raise CenterError('REVISION_CONFLICT', 'Entry changed; reload it.', 409)
            if action in {'archive', 'detach'}:
                self._idle(tx, entry_id)
            if action == 'source-selection':
                source = tx.get('sources', body.get('sourceId'))
                if not source or source['entryId'] != entry_id or source.get('detached'):
                    raise CenterError('SOURCE_NOT_FOUND', 'Source does not belong to this entry.', 404)
                entry['preferredSourceId'] = source['sourceId']
            elif action == 'archive':
                entry['archived'] = True
            elif action == 'restore':
                entry['archived'] = False
            elif action == 'detach':
                sources = [row for row in tx.list('sources') if row['entryId'] == entry_id]
                if any(row.get('runtimeId') and (tx.get('runtimes', row['runtimeId']) or {}).get('managed') for row in sources):
                    raise CenterError('MANAGED_SOURCE', 'Release managed sources before detaching.', 409)
                entry.update(detached=True, detachedAt=now())
                for source in sources:
                    source['detached'] = True
                    tx.put('sources', source['sourceId'], source)
            else:
                raise CenterError('INVALID_ACTION', 'Unsupported entry action.')
            entry['revision'] += 1
            tx.put('entries', entry_id, entry)
            event_id = uid('event')
            tx.put('events', event_id, {'eventId': event_id, 'entryId': entry_id, 'action': action, 'actorKind': 'local_operator_intent', 'createdAt': now()})
            return entry

    def reconnect(self, source_id, body):
        key = 'reconnect:' + source_id + ':' + str(body['idempotencyKey']) if body.get('idempotencyKey') else None
        body_hash = digest({key: value for key, value in body.items() if key != '_provenance'})
        if key:
            with self.store.transaction() as tx:
                prior = tx.get('idempotency', key)
                if prior:
                    if prior['hash'] != body_hash:
                        raise CenterError('IDEMPOTENCY_CONFLICT', 'This key has different input.', 409)
                    return prior['result']
        candidate = self._candidate(body)
        with self.store.transaction() as tx:
            if key:
                prior = tx.get('idempotency', key)
                if prior:
                    if prior['hash'] != body_hash:
                        raise CenterError('IDEMPOTENCY_CONFLICT', 'This key has different input.', 409)
                    return prior['result']
            source = tx.get('sources', source_id)
            if not source:
                raise CenterError('SOURCE_NOT_FOUND', 'Source is unavailable.', 404)
            if body.get('expectedRevision') != source.get('revision'):
                raise CenterError('REVISION_CONFLICT', 'Source changed; reload it.', 409)
            self._idle(tx, source['entryId'])
            if source.get('runtimeId') and (tx.get('runtimes', source['runtimeId']) or {}).get('managed'):
                raise CenterError('MANAGED_SOURCE', 'Release managed sources before reconnecting.', 409)
            item = next((item for item in candidate['items'] if item['identityFingerprint'] == source.get('identityFingerprint')), None)
            if not item or not source.get('productId') and not source.get('explorationId'):
                raise CenterError('SOURCE_CONFLICT', 'Reconnect requires the same stable identity.', 409)
            previous, incoming = source.get('cycleEvidence', {}), item.get('cycleEvidence', {})
            if any(previous[key] != incoming[key] for key in previous.keys() & incoming.keys()) or previous.keys() - incoming.keys():
                raise CenterError('SOURCE_CONFLICT', 'Reconnect source does not preserve recorded lineage.', 409)
            if any(row['sourceId'] != source_id and row['root'] == candidate['root'] and row.get('identityFingerprint') == item['identityFingerprint'] and not row.get('detached') for row in tx.list('sources')):
                raise CenterError('SOURCE_CONFLICT', 'This location is already registered.', 409)
            source.update(root=candidate['root'], project=item['project'], fingerprint=candidate['fingerprint'], revision=source['revision'] + 1,
                          sourceRevision=source['sourceRevision'] + 1, availability='available')
            tx.put('sources', source_id, source)
            operation_id = uid('operation')
            operation = {'operationId': operation_id, 'kind': 'reconnect', 'state': 'succeeded', 'sourceId': source_id,
                         'entryId': source['entryId'], 'revision': 1, 'createdAt': now(), 'endedAt': now(),
                         'actorKind': 'local_operator_intent', 'authenticatedUserId': None,
                         'provenance': body.get('_provenance', {'channel': 'local_api'})}
            tx.put('operations', operation_id, operation)
            result = {**source, 'operationId': operation_id}
            if key:
                tx.put('idempotency', key, {'hash': body_hash, 'result': result})
        self.refresh_source(source_id)
        return result

    def refresh_changed_sources(self, batch_size=8):
        """Round-robin cheap stat probes; only changed sources rebuild projections."""
        batch_size = bounded_int(batch_size, 8, 100)
        if not self._refresh_lock.acquire(blocking=False):
            return {'checked': 0, 'refreshed': 0}
        try:
            with self.store.transaction() as tx:
                sources = [row for row in tx.list('sources') if not row.get('detached')]
                icon_resources = {row['sourceId']: (tx.get('projections', row['sourceId']) or {}).get('iconResourceId') for row in sources}
            if not sources:
                return {'checked': 0, 'refreshed': 0}
            selected = [sources[(self._refresh_index + index) % len(sources)] for index in range(min(batch_size, len(sources)))]
            self._refresh_index = (self._refresh_index + len(selected)) % len(sources)
            refreshed = 0
            for source in selected:
                paths = ['', '.auto-company', '.auto-company/product-state.json', '.auto-company/product-state.transaction.json',
                         '.auto-company/product-state.lock', '.auto-company.local', 'projects/registry.tsv', 'logs/usage.jsonl', 'logs', 'logs/artifacts']
                if source.get('project'):
                    paths += [source['project'], source['project'] + '/.auto-company/identity.json', source['project'] + '/.auto-company-project.json', source['project'] + '/.auto-company/media.json']
                if source.get('productId'):
                    paths.append('logs/product-media/' + source['productId'] + '/media.json')
                    if icon_resources.get(source['sourceId']):
                        paths.append('logs/product-media/' + source['productId'] + '/' + icon_resources[source['sourceId']][6:])
                if source.get('kind') == 'reference':
                    paths.append('README.md')
                signature = []
                for relative in paths:
                    try:
                        value = (Path(source['root']) / relative).lstat()
                        signature.append((value.st_dev, value.st_ino, value.st_mtime_ns, value.st_size))
                    except OSError:
                        signature.append(None)
                if self._stat_signatures.get(source['sourceId']) != signature:
                    current = self.refresh_source(source['sourceId'])
                    if current.get('availability') == 'available' and current.get('kind') != 'reference':
                        self._discover_products(current)
                    self._stat_signatures[source['sourceId']] = signature
                    refreshed += 1
            return {'checked': len(selected), 'refreshed': refreshed}
        finally:
            self._refresh_lock.release()

    def _discover_products(self, anchor):
        """Discover committed identities only inside an already registered root.

        A newly observed product is read-only; the existing context remains its
        own authority. Tombstones and any globally known identity are retained.
        """
        try:
            root = root_path(anchor['root'])
            reader = JournalSource(root)
            pending = ('.auto-company/product-state.transaction.json', '.auto-company/product-state.lock')
            if any(reader.safe_path(name).exists() for name in pending):
                return []
            state = reader.identity_state()
            if len(state['identities']) > 1000:
                return []
            with self.store.transaction() as tx:
                known = {row.get('productId') for row in tx.list('entries') if row.get('productId')}
            candidates = []
            registry = reader.safe_path('projects/registry.tsv')
            registered_paths = None
            if registry.exists():
                raw, truncated = reader.read('projects/registry.tsv', 256 * 1024)
                if truncated:
                    return []
                registered_paths = {fields[1] for line in raw.splitlines()[1:] if len(fields := line.split('\t')) == 4}
            from product_identity import get_identity
            for identity, row in state['identities'].items():
                project = row.get('project')
                if row['kind'] != 'product' or identity in known or not project or state['paths'].get(project) != identity:
                    continue
                if registered_paths is not None and project not in registered_paths:
                    continue
                try:
                    original = get_identity(root, project, create=False)
                    if not original or original['id'] != identity:
                        continue
                    metadata = JournalSource(root, scope=ProductScope('product', identity, row.get('explorationId'), project)).project()
                except (OSError, ValueError, TypeError, KeyError):
                    continue
                candidates.append((identity, row, metadata))
            # A reader never repairs an in-progress registration or guesses its
            # committed identity from a directory name or metadata descriptor.
            if any(reader.safe_path(name).exists() for name in pending) or reader.identity_state() != state:
                return []
            discovered = []
            with self.store.transaction() as tx:
                current_anchor = tx.get('sources', anchor['sourceId'])
                if not current_anchor or current_anchor.get('detached') or current_anchor.get('root') != anchor['root']:
                    return []
                for identity, row, metadata in candidates:
                    if any(entry.get('productId') == identity for entry in tx.list('entries')):
                        continue  # Includes tombstones: rediscovery is not consent.
                    entry_id, source_id = uid('entry'), uid('source')
                    entry = {'entryId': entry_id, 'kind': 'product', 'productId': identity, 'explorationId': row.get('explorationId'),
                             'displayName': metadata['displayName'], 'description': metadata['description'],
                             'preferredSourceId': source_id, 'archived': False, 'detached': False, 'createdAt': now(), 'revision': 1}
                    source = {'sourceId': source_id, 'entryId': entry_id, 'runtimeId': None, 'root': anchor['root'], 'project': row['project'],
                              'productId': identity, 'explorationId': row.get('explorationId'), 'kind': 'product',
                              'identityFingerprint': digest({'id': identity, 'kind': 'product'}), 'fingerprint': digest(state),
                              'cycleEvidence': {key: digest(value) for key, value in state['cycles'].items() if value['identityId'] == identity},
                              'registeredDocuments': [], 'sourceRevision': 1, 'revision': 1, 'availability': 'available', 'warnings': [],
                              'capabilities': {'readJournal': True, 'readMedia': True, 'execute': False, 'preview': False, 'capture': False},
                              'lastVerifiedAt': now(), 'discoveredFromSourceId': anchor['sourceId']}
                    tx.put('entries', entry_id, entry)
                    tx.put('sources', source_id, source)
                    event_id = uid('event')
                    tx.put('events', event_id, {'eventId': event_id, 'entryId': entry_id, 'sourceId': source_id,
                                               'action': 'product_discovered', 'actorKind': 'center', 'createdAt': now()})
                    discovered.append(source_id)
            return discovered
        except (CenterError, OSError, ValueError, TypeError, KeyError, RecursionError):
            return []  # Discovery failure never invalidates a readable existing scope.
