"""离线采集往返结果验收：只读比较，所有结果均为本地证据。"""
import base64
import binascii
import hashlib
import json
import math
import sqlite3
import tempfile
import time
from pathlib import Path, PurePosixPath

MAX_BYTES = 100 * 1024 * 1024
MAX_ROWS = 100000
MAX_TABLES = 50
MAX_COLUMNS = 200
MAX_ITEMS = 100000
LABELS = {"passed": "验收通过", "review": "发现差异，需处理", "deferred": "附件待补", "unconfirmed": "证据不足，未确认"}


def _hash(data):
    return hashlib.sha256(data).hexdigest()


def _display(value):
    # 数据值保留 SQLite 存储类型；浏览器不经由 Number 接收整数。
    if type(value) is int:
        return {"type": "integer", "value": str(value)}
    if isinstance(value, bytes):
        return {"type": "blob", "bytes": len(value), "sha256": _hash(value)}
    if isinstance(value, dict):
        if set(value) == {'type', 'bytes', 'sha256'} and value.get('type') == 'blob' and type(value['bytes']) is int:
            return dict(value)
        return {name: _display(item) for name, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_display(item) for item in value]
    if isinstance(value, float) and not math.isfinite(value):
        return str(value)
    return value


def _identity(value):
    return type(value).__name__, value


def _equal(left, right):
    return type(left) is type(right) and left == right


def _quote(name):
    return '"' + name.replace('"', '""') + '"'


def _safe_path(value):
    if not isinstance(value, str) or not value or '\\' in value or '\x00' in value or ':' in value:
        raise ValueError("附件路径必须是相对路径，不可包含反斜杠、冒号或空字符。")
    if value.startswith('/') or any(part in ('', '.', '..') for part in value.split('/')):
        raise ValueError("附件路径不可使用绝对路径、空目录、. 或 ..。")
    if str(PurePosixPath(value)) != value:
        raise ValueError("附件路径格式无效。")
    return value


def _decode(value, budget):
    if not isinstance(value, str):
        raise ValueError("文件内容必须使用 Base64 编码。")
    if len(value) > (MAX_BYTES * 4 // 3 + 8):
        raise ValueError("上传内容超过 100 MB，请缩小验收批次。")
    try:
        data = base64.b64decode(value, validate=True)
    except (ValueError, binascii.Error):
        raise ValueError("文件 Base64 编码无效，请重新选择原始文件。") from None
    budget[0] += len(data)
    if budget[0] > MAX_BYTES:
        raise ValueError("上传文件合计超过 100 MB，请缩小验收批次。")
    return data


def _database(spec, role, directory, budget):
    if spec is None:
        return None, None
    if not isinstance(spec, dict) or not isinstance(spec.get('name'), str) or not spec['name'].strip():
        raise ValueError(f"{role}文件需要有效的名称和内容。")
    data = _decode(spec.get('data'), budget)
    if not data.startswith(b'SQLite format 3\x00'):
        raise ValueError(f"{role}不是 SQLite / GeoPackage 数据库，请选择 .sqlite、.db 或 .gpkg 文件。")
    location = Path(directory) / (role + '.sqlite')
    location.write_bytes(data)
    try:
        db = sqlite3.connect(location.as_uri() + '?mode=ro&immutable=1', uri=True)
        db.execute('PRAGMA query_only=ON')
        db.execute('PRAGMA trusted_schema=OFF')
        deadline = time.monotonic() + 12
        db.set_progress_handler(lambda: int(time.monotonic() > deadline), 10000)
        db.execute('SELECT count(*) FROM sqlite_master').fetchone()
    except sqlite3.Error:
        if 'db' in locals():
            db.close()
        raise ValueError(f"{role}数据库损坏或不受支持，无法读取。") from None
    return db, {'name': spec['name'], 'bytes': len(data), 'sha256': _hash(data)}


def _uploads(items, budget):
    if not isinstance(items, list) or len(items) > MAX_ITEMS:
        raise ValueError("附件清单无效或数量过多。")
    result = {}
    for item in items:
        if not isinstance(item, dict):
            raise ValueError("附件必须包含相对路径和内容。")
        path = _safe_path(item.get('path'))
        if path in result:
            raise ValueError(f"附件路径重复：{path}。请消除同名歧义。")
        content = _decode(item.get('data'), budget)
        result[path] = {'bytes': len(content), 'sha256': _hash(content)}
    return result


def _tables(db):
    names = [row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")]
    return [n for n in names if not n.startswith(('sqlite_', 'gpkg_', 'rtree_'))]


def _schema(db, table):
    # 包含隐藏列，避免把不可完整比较的虚拟/生成列误判为成功。
    return [tuple(row) for row in db.execute('PRAGMA table_xinfo(' + _quote(table) + ')')]


def _definition(db, table):
    return [tuple(row) for row in db.execute(
        "SELECT type,name,sql FROM sqlite_master WHERE tbl_name=? AND type IN ('table','index','trigger') ORDER BY type,name", (table,))]


def _spatial_metadata(dbs, selected, issue, evidence):
    """检查几何解释所需的元数据，不执行空间函数。"""
    selected_names = {item['name'] for item in selected}
    metadata = {}
    has_spatial = False
    for role, db in dbs.items():
        names = {row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        features = set()
        if 'gpkg_contents' in names:
            contents_columns = [s[1] for s in _schema(db, 'gpkg_contents')]
            if 'table_name' in contents_columns and 'data_type' in contents_columns:
                features = {row[0] for row in db.execute("SELECT table_name FROM gpkg_contents WHERE data_type='features'") if row[0] in selected_names}
            else:
                issue('spatial_metadata_unconfirmed', 'GeoPackage 内容清单结构不完整。', '重新导出完整 GeoPackage。', actual=role, state='unconfirmed')
        if 'gpkg_geometry_columns' not in names:
            if features:
                issue('spatial_metadata_unconfirmed', 'GeoPackage 要素表缺少几何字段元数据。', '重新导出完整 GeoPackage 并核对几何字段及坐标系。', actual=role, state='unconfirmed')
            metadata[role] = None
            continue
        has_spatial = True
        columns = [s[1] for s in _schema(db, 'gpkg_geometry_columns')]
        if not {'table_name', 'column_name', 'geometry_type_name', 'srs_id', 'z', 'm'}.issubset(columns):
            issue('spatial_metadata_unconfirmed', 'GeoPackage 几何字段元数据结构不完整。', '重新导出完整 GeoPackage。', actual=role, state='unconfirmed')
            metadata[role] = None
            continue
        raw_geometry = db.execute('SELECT * FROM gpkg_geometry_columns LIMIT 100001').fetchall()
        if len(raw_geometry) > MAX_ROWS:
            raise ValueError('GeoPackage 几何元数据数量过多，请缩小批次。')
        geometry = [tuple(row) for row in raw_geometry if row[columns.index('table_name')] in selected_names]
        geometry_tables = {row[columns.index('table_name')] for row in geometry}
        if features - geometry_tables:
            issue('spatial_metadata_unconfirmed', '选定 GeoPackage 要素表没有对应的几何字段声明。', '补齐要素表的几何元数据后重新验收。', actual=role, state='unconfirmed')
        if geometry_tables and ('gpkg_contents' not in names or geometry_tables - features):
            issue('spatial_metadata_unconfirmed', '几何字段声明与 GeoPackage 要素内容清单不完整或不对应。', '核对内容清单和几何字段声明。', actual=role, state='unconfirmed')
        identities = set()
        for row in geometry:
            table_name, column_name = row[columns.index('table_name')], row[columns.index('column_name')]
            identity = (table_name, column_name)
            if (identity in identities or table_name not in names
                    or column_name not in [s[1] for s in _schema(db, table_name)]):
                issue('spatial_metadata_unconfirmed', '几何字段声明重复或引用了不存在的业务字段。', '核对实际几何字段和元数据。', table=table_name, field=column_name, actual=role, state='unconfirmed')
            identities.add(identity)
        srs_ids = {row[columns.index('srs_id')] for row in geometry}
        srs = []
        if srs_ids:
            if 'gpkg_spatial_ref_sys' not in names:
                issue('spatial_metadata_unconfirmed', 'GeoPackage 缺少引用的坐标系定义。', '补齐原始坐标系元数据后重新验收。', actual=role, state='unconfirmed')
            else:
                srs_columns = [s[1] for s in _schema(db, 'gpkg_spatial_ref_sys')]
                if 'srs_id' not in srs_columns or 'definition' not in srs_columns:
                    issue('spatial_metadata_unconfirmed', 'GeoPackage 坐标系定义结构不完整。', '重新导出完整 GeoPackage。', actual=role, state='unconfirmed')
                else:
                    srs = [tuple(row) for row in db.execute('SELECT * FROM gpkg_spatial_ref_sys LIMIT 100001') if row[srs_columns.index('srs_id')] in srs_ids]
                    found = {row[srs_columns.index('srs_id')] for row in srs}
                    if found != srs_ids:
                        issue('spatial_metadata_unconfirmed', '几何字段引用的坐标系未全部提供。', '补齐对应坐标系定义。', actual=role, state='unconfirmed')
                    srs = [srs_columns, sorted(srs, key=repr)]
        metadata[role] = [columns, sorted(geometry, key=repr), srs]
    if has_spatial:
        evidence['spatial_metadata_checked'] = True
        if metadata.get('baseline') != metadata.get('field') or metadata.get('field') != metadata.get('target'):
            issue('spatial_metadata_changed', '几何字段或引用坐标系定义在三份快照之间不同，相同几何字节不能证明相同位置。', '核对几何字段、坐标系和导出方式后重新验收。', state='unconfirmed')


def _index(db, table, schema, keys, counter):
    names = [s[1] for s in schema]
    if len(names) > MAX_COLUMNS:
        raise ValueError("表字段超过 200 个，请缩小验收范围。")
    if any(s[6] for s in schema):
        return None, "表包含隐藏列或生成列，当前无法完整确认。"
    if not keys or any(k not in names for k in keys) or len(set(keys)) != len(keys):
        return None, "缺少有效唯一标识，请配置该表的主键字段。"
    rows = {}
    positions = [names.index(k) for k in keys]
    for row in db.execute('SELECT ' + ','.join(_quote(n) for n in names) + ' FROM ' + _quote(table)):
        counter[0] += 1
        if counter[0] > MAX_ROWS:
            raise ValueError("三个数据库合计超过 100,000 条记录，请缩小验收批次。")
        key = tuple(_identity(row[i]) for i in positions)
        if any(value is None for _, value in key):
            return None, "唯一标识包含空值，无法确认记录对应关系。"
        if key in rows:
            return None, "唯一标识重复，无法确认记录对应关系。"
        rows[key] = dict(zip(names, row))
    return rows, None


def _validate_config(config):
    if not isinstance(config, dict):
        raise ValueError("验收配置必须是对象。")
    if config.get('attachment_policy', 'required') not in ('required', 'deferred'):
        raise ValueError("附件策略只能为 required（必须齐全）或 deferred（允许待补）。")
    for name in ('tables', 'relations', 'attachment_columns'):
        limit = MAX_TABLES if name == 'tables' else MAX_COLUMNS
        if name in config and (not isinstance(config[name], list) or len(config[name]) > limit):
            raise ValueError(f"{name} 配置必须为列表，且数量不可过多。")
    seen = set()
    for table in config.get('tables', []):
        if not isinstance(table, dict) or not isinstance(table.get('name'), str) or not table['name']:
            raise ValueError("每个业务表配置需要表名。")
        if table['name'] in seen:
            raise ValueError("业务表配置不可重复。")
        seen.add(table['name'])
        if 'key' in table and (not isinstance(table['key'], list) or not all(isinstance(k, str) and k for k in table['key'])):
            raise ValueError("唯一标识配置必须是字段名列表。")
    for relation in config.get('relations', []):
        if not isinstance(relation, dict) or not all(isinstance(relation.get(n), str) and relation[n] for n in ('table', 'column', 'parent_table', 'parent_column')):
            raise ValueError("关联配置需要子表、子字段、父表及父字段。")
    for column in config.get('attachment_columns', []):
        if not isinstance(column, dict) or not all(isinstance(column.get(n), str) and column[n] for n in ('table', 'column')):
            raise ValueError("附件字段配置需要表名和字段名。")
    if 'evidence_complete' in config and not isinstance(config['evidence_complete'], bool):
        raise ValueError("完整证据声明必须为 true 或 false。")
    if not isinstance(config.get('job_name', ''), str) or len(config.get('job_name', '')) > 200:
        raise ValueError("任务名称必须是 200 字以内的文本。")


def audit(payload):
    """验收 API。缺证据返回未确认；格式错误抛出中文 ValueError。"""
    if not isinstance(payload, dict):
        raise ValueError("请求必须是 JSON 对象。")
    config = payload.get('config', {})
    _validate_config(config)
    budget = [0]
    changes, issues, deferred = [], [], []
    flags = set()
    evidence = {'databases': {}, 'field_attachments': {}, 'target_attachments': {},
                'complete_declared': config.get('evidence_complete') is True, 'tables': [],
                'configuration': {'tables': [], 'relations': config.get('relations', []),
                                  'attachment_columns': config.get('attachment_columns'),
                                  'attachment_policy': config.get('attachment_policy', 'required'),
                                  'evidence_complete': config.get('evidence_complete', False)}}

    def issue(kind, message, action, table=None, key=None, field=None, expected=None, actual=None, state='review', values_are_metadata=False):
        if len(issues) + len(changes) + len(deferred) >= MAX_ITEMS:
            raise ValueError("验收差异数量过多，请拆分批次。")
        flags.add(state)
        issues.append({'kind': kind, 'table': table, 'key': _display(key), 'field': field,
                       'expected': expected if values_are_metadata else _display(expected),
                       'actual': actual if values_are_metadata else _display(actual), 'message': message, 'action': action})

    field_files = _uploads(payload.get('field_attachments', []), budget)
    target_files = _uploads(payload.get('target_attachments', []), budget)
    evidence['field_attachments'] = field_files
    evidence['target_attachments'] = target_files
    with tempfile.TemporaryDirectory(prefix='field-return-audit-') as directory:
        dbs = {}
        try:
            for name, role in (('baseline', '出发基线'), ('field', '现场副本'), ('target', '目标库')):
                db, meta = _database(payload.get(name), role, directory, budget)
                dbs[name] = db
                if meta:
                    evidence['databases'][name] = meta
                else:
                    issue('missing_database', f"缺少{role}，无法完成三方验收。", f"补充{role}后重新验收。", state='unconfirmed')
            if not evidence['complete_declared']:
                issue('incomplete_evidence', "尚未声明文件为完整且一致的导出快照，未确认附件、关联或未提交变更是否遗漏。", "提交完整快照，并确认所有业务表、附件字段及关联规则均已涵盖；存在 WAL 时先从原软件导出完整副本。", state='unconfirmed')
            if 'attachment_columns' not in config:
                issue('attachment_scope_unknown', "未配置附件引用字段，空附件清单不能证明没有附件。", "配置附件字段；明确没有附件时使用空列表并声明证据完整。", state='unconfirmed')
            if all(dbs.values()):
                _compare(dbs, config, changes, issues, issue, deferred, flags, evidence, field_files, target_files)
        except sqlite3.Error:
            raise ValueError("数据库查询失败：文件可能损坏、结构不支持或处理超时，请缩小范围后重新导出。") from None
        finally:
            for db in dbs.values():
                if db:
                    db.close()
    status = next((s for s in ('review', 'unconfirmed', 'deferred') if s in flags), 'passed')
    counts = {op: sum(c['operation'] == op for c in changes) for op in ('insert', 'update', 'delete')}
    return {'status': status, 'status_label': LABELS[status], 'job_name': config.get('job_name') or '离线采集往返验收',
            'config': evidence['configuration'],
            'generated_at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), 'changes': changes,
            'issues': issues, 'deferred': deferred, 'summary': {'changes': len(changes), 'issues': len(issues),
            'attachments': len(evidence.get('attachment_references', [])), 'deferred': len(deferred),
            'tables': len(evidence['tables']), 'inserted': counts['insert'], 'updated': counts['update'],
            'deleted': counts['delete']}, 'evidence': evidence,
            'limitations': ['仅比较提交的本地快照，不执行同步，也不修改原件。',
                            '二进制字段（含几何）按字节和 SHA-256 比较，不判断空间位置、拓扑或几何语义是否等价。',
                            '完整性声明由操作者提供；无法发现未提交的 WAL、未列入范围的业务表、未声明的附件字段或关联规则。',
                            '附件路径必须为数据库中的相对路径；不推断文件名、绝对路径或隐含附件规则。',
                            'SQLite 整数以 type=integer、value=精确十进制字符串表示；文本保持字符串。记录键、字段及显式关联按存储类型核对，整数、实数与同字符文本分别处理。']}


def _compare(dbs, config, changes, issues, issue, deferred, flags, evidence, field_files, target_files):
    lists = {name: _tables(db) for name, db in dbs.items()}
    selected = config.get('tables') or [{'name': n} for n in sorted(set().union(*lists.values()))]
    if not selected:
        issue('no_tables', "没有发现可验收的业务表。", "选择包含业务记录的 SQLite / GeoPackage 文件。", state='unconfirmed')
    if len(selected) > MAX_TABLES:
        raise ValueError("业务表超过 50 个，请缩小验收范围。")
    if config.get('tables'):
        omitted = sorted(set().union(*lists.values()) - {t['name'] for t in selected})
        evidence['excluded_tables'] = omitted
        if omitted:
            issue('partial_scope', "部分业务表未列入本次验收范围：" + '、'.join(omitted), "补充这些表；当前结果只覆盖已选择范围，不能确认整个返回包。", state='unconfirmed')
    cache, counter = {}, [0]
    _spatial_metadata(dbs, selected, issue, evidence)
    for item in selected:
        table = item['name']
        evidence['tables'].append(table)
        effective = {'name': table, 'key': item.get('key'),
                     'key_source': 'configured' if 'key' in item else 'native'}
        evidence['configuration']['tables'].append(effective)
        if any(table not in names for names in lists.values()):
            issue('schema_changed', f"业务表 {table} 未在三个文件中同时存在。", "核对导出范围及表结构后重新验收。", table=table, state='unconfirmed')
            continue
        schemas = {name: _schema(db, table) for name, db in dbs.items()}
        keys = item.get('key') if 'key' in item else [s[1] for s in sorted(schemas['field'], key=lambda s: s[5]) if s[5]]
        effective['key'] = keys
        definitions = {name: _definition(db, table) for name, db in dbs.items()}
        if (schemas['baseline'] != schemas['field'] or schemas['field'] != schemas['target']
                or definitions['baseline'] != definitions['field'] or definitions['field'] != definitions['target']):
            issue('schema_changed', "表结构发生变化，无法安全对应字段。", "先核对结构变化，统一结构后重新验收。", table=table, state='unconfirmed')
            continue
        schema = schemas['field']
        snapshots = {}
        for name, db in dbs.items():
            rows, problem = _index(db, table, schema, keys, counter)
            if problem:
                issue('identity_unconfirmed', problem, "配置稳定且非空的唯一标识，排除重复后重新验收。", table=table, actual=name, state='unconfirmed')
                break
            snapshots[name] = rows
        if len(snapshots) != 3:
            continue
        cache[table] = snapshots
        base, field, target = (snapshots[n] for n in ('baseline', 'field', 'target'))
        for key in sorted(set(base) | set(field), key=repr):
            before, after, actual = base.get(key), field.get(key), target.get(key)
            display_key = {name: _display(value) for name, (_, value) in zip(keys, key)}
            if before is None:
                operation, fields = 'insert', list(after)
            elif after is None:
                operation, fields = 'delete', list(before)
            else:
                fields = [name for name in after if not _equal(before[name], after[name])]
                if not fields:
                    continue
                operation = 'update'
            if len(changes) + len(deferred) + len(issues) >= MAX_ITEMS:
                raise ValueError("现场变更数量过多，请拆分批次。")
            entry = {'table': table, 'key': display_key, 'operation': operation,
                     'operation_label': {'insert': '新增', 'update': '修改', 'delete': '删除'}[operation],
                     'fields': fields, 'before': {f: _display(before[f]) for f in fields} if before else None,
                     'expected': {f: _display(after[f]) for f in fields} if after else None,
                     'actual': {f: _display(actual[f]) for f in fields} if actual else None, 'matched': True}
            changes.append(entry)
            if operation == 'delete':
                if actual is not None:
                    entry['matched'] = False
                    issue('delete_not_applied', "现场已删除的记录仍在目标库。", "核对同步删除规则和记录对应关系。", table, display_key)
            elif actual is None:
                entry['matched'] = False
                issue('record_missing', "现场变更的记录在目标库缺失。", "核对该记录是否已正确导回目标库。", table, display_key)
            else:
                for name in fields:
                    if not _equal(actual[name], after[name]):
                        entry['matched'] = False
                        issue('value_mismatch', "目标字段与现场返回结果不一致。", "对照现场原件处理冲突，修复后重新验收。", table, display_key, name, after[name], actual[name])
    # 数据库完整性覆盖三方，目标库的关联检查覆盖整个库。
    for name, db in dbs.items():
        for row in db.execute('PRAGMA integrity_check(100)'):
            if row[0] != 'ok':
                issue('database_integrity', "数据库完整性检查发现问题。", "使用原软件修复或重新导出完整快照。", actual={'database': name, 'detail': row[0]})
    for row in dbs['target'].execute('PRAGMA foreign_key_check'):
        issue('foreign_key', "目标库存在外键悬空记录。", "补齐父记录或修复对应关系。", table=row[0], key={'rowid': row[1]}, actual={'parent_table': row[2], 'constraint': row[3]}, values_are_metadata=True)
    for relation in config.get('relations', []):
        child, column, parent, parent_column = (relation[n] for n in ('table', 'column', 'parent_table', 'parent_column'))
        if child not in lists['target'] or parent not in lists['target'] or column not in [s[1] for s in _schema(dbs['target'], child)] or parent_column not in [s[1] for s in _schema(dbs['target'], parent)]:
            issue('relation_unconfirmed', "关联配置中的表或字段不存在。", "核对关联字段设置。", table=child, field=column, state='unconfirmed')
            continue
        sql = ('SELECT c.' + _quote(column) + ' FROM ' + _quote(child) + ' AS c WHERE c.' + _quote(column) +
               ' IS NOT NULL AND NOT EXISTS (SELECT 1 FROM ' + _quote(parent) + ' AS p WHERE typeof(p.' + _quote(parent_column) + ')=typeof(c.' + _quote(column) + ') AND p.' + _quote(parent_column) + '=c.' + _quote(column) + ') LIMIT 100001')
        for row in dbs['target'].execute(sql):
            issue('relation_orphan', "目标库关联记录缺少父记录。", "补齐父记录或修复关联标识。", table=child, field=column, actual=row[0])
    refs, inspected_references = {}, 0
    for spec in config.get('attachment_columns', []):
        table, column = spec['table'], spec['column']
        if table not in cache or column not in [s[1] for s in _schema(dbs['field'], table)]:
            issue('attachment_scope_unconfirmed', "附件表或字段未能完成可靠读取。", "将附件所属表加入范围并核对字段名。", table=table, field=column, state='unconfirmed')
            continue
        for row in cache[table]['field'].values():
            inspected_references += 1
            if inspected_references > MAX_ROWS:
                raise ValueError('附件字段累计检查超过 100,000 项，请缩小验收批次。')
            value = row[column]
            if value is None or value == '':
                continue
            try:
                path = _safe_path(value)
            except ValueError:
                issue('attachment_path', "附件字段包含不安全或不支持的路径。", "将附件引用改为明确的相对路径，禁止绝对路径和 ..。", table=table, field=column, actual=value)
                continue
            refs.setdefault(path, []).append({'table': table, 'field': column})
    evidence['attachment_references'] = [{'path': p, 'references': refs[p]} for p in sorted(refs)]
    for path, origins in sorted(refs.items()):
        source, destination = field_files.get(path), target_files.get(path)
        origin = origins[0]
        if source is None:
            issue('field_attachment_missing', "现场引用附件没有提供，缺少预期内容的哈希证据。", "补充现场原附件后重新验收。", origin['table'], field=origin['field'], actual=path, state='unconfirmed')
        elif destination is None:
            if config.get('attachment_policy', 'required') == 'deferred':
                if len(changes) + len(deferred) + len(issues) >= MAX_ITEMS:
                    raise ValueError('验收差异数量过多，请拆分批次。')
                flags.add('deferred')
                deferred.append({'kind': 'attachment_missing', 'path': path, 'table': origin['table'], 'field': origin['field'], 'expected': source,
                                 'message': '目标附件缺失，已列为待补；本次不能判定完全通过。', 'action': '补齐目标附件后重新验收。'})
            else:
                issue('target_attachment_missing', "目标附件缺失。", "补齐目标附件后重新验收。", origin['table'], field=origin['field'], expected=source, actual=path, values_are_metadata=True)
        elif source['sha256'] != destination['sha256']:
            issue('attachment_hash_mismatch', "同名附件内容不同，不能列为待补。", "核对现场原件，替换错误内容后重新验收。", origin['table'], field=origin['field'], expected=source, actual=destination, values_are_metadata=True)


run_audit = audit


def demo_request():
    """完全合成的中文案例；真实 SQLite 文件，不代表真实用户证据。"""
    with tempfile.TemporaryDirectory(prefix='field-return-demo-') as directory:
        files = {}
        for role in ('baseline', 'field', 'target'):
            path = Path(directory) / (role + '.sqlite')
            db = sqlite3.connect(path)
            db.executescript('CREATE TABLE sites(uid TEXT PRIMARY KEY, name TEXT NOT NULL); CREATE TABLE inspections(uid TEXT PRIMARY KEY, site_uid TEXT REFERENCES sites(uid), note TEXT, photo TEXT, geometry BLOB);')
            db.execute('INSERT INTO sites VALUES (?,?)', ('点位-01', '北侧巡检点'))
            db.executemany('INSERT INTO inspections VALUES (?,?,?,?,?)', [('记录-01', '点位-01', '出发前待复查', 'photos/北侧.txt', b'\x01\x02'), ('记录-02', '点位-01', '误建记录', None, None)])
            if role != 'baseline':
                db.execute('UPDATE inspections SET note=?,geometry=? WHERE uid=?', ('现场复查：标牌已修复', b'\x01\x03', '记录-01'))
                db.execute('DELETE FROM inspections WHERE uid=?', ('记录-02',))
                db.execute('INSERT INTO inspections VALUES (?,?,?,?,?)', ('记录-03', '点位-01', '新增现场照片', 'photos/新增.txt', b'\x05'))
            db.commit()
            db.close()
            files[role] = {'name': {'baseline': '出发基线.sqlite', 'field': '现场返回.sqlite', 'target': '导回目标.sqlite'}[role], 'data': base64.b64encode(path.read_bytes()).decode('ascii')}
        attachments = [{'path': name, 'data': base64.b64encode(content.encode()).decode('ascii')} for name, content in [('photos/北侧.txt', '合成附件：北侧标牌'), ('photos/新增.txt', '合成附件：新增点位')]]
        return {**files, 'field_attachments': attachments, 'target_attachments': [dict(a) for a in attachments],
                'config': {'job_name': '合成演示：北侧点位巡检返回验收', 'tables': [{'name': 'sites', 'key': ['uid']}, {'name': 'inspections', 'key': ['uid']}],
                           'relations': [{'table': 'inspections', 'column': 'site_uid', 'parent_table': 'sites', 'parent_column': 'uid'}],
                           'attachment_columns': [{'table': 'inspections', 'column': 'photo'}], 'attachment_policy': 'required', 'evidence_complete': True}}
