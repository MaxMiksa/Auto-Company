"""Single-owner transactional center records; never writes imported sources."""
from contextlib import contextmanager
from pathlib import Path
import json
import os
import sqlite3
import threading
import uuid


class CenterError(Exception):
    def __init__(self, code, message, status=400, details=None):
        super().__init__(message)
        self.code, self.message, self.status, self.details = code, message, status, details or {}


class _Transaction:
    def __init__(self, connection):
        self.connection, self.changed = connection, False

    def get(self, kind, identity):
        row = self.connection.execute('SELECT body FROM records WHERE kind=? AND id=?', (kind, identity)).fetchone()
        return json.loads(row[0]) if row else None

    def list(self, kind):
        return [json.loads(row[0]) for row in self.connection.execute('SELECT body FROM records WHERE kind=? ORDER BY id', (kind,))]

    def put(self, kind, identity, record):
        body = json.dumps(record, ensure_ascii=False, sort_keys=True, allow_nan=False)
        current = self.connection.execute('SELECT body FROM records WHERE kind=? AND id=?', (kind, identity)).fetchone()
        if not current or current[0] != body:
            self.connection.execute('INSERT OR REPLACE INTO records VALUES (?,?,?)', (kind, identity, body))
            self.changed = True

    def delete(self, kind, identity):
        self.changed |= self.connection.execute('DELETE FROM records WHERE kind=? AND id=?', (kind, identity)).rowcount > 0


class CenterStore:
    def __init__(self, data_dir):
        self.data_dir = Path(data_dir).resolve()
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self._mutex = threading.RLock()
        self._active = False
        self._connection = None
        self._owner = (self.data_dir / 'center.lock').open('a+b')
        try:
            if os.name == 'nt':
                import msvcrt
                self._owner.seek(0)
                if not self._owner.read(1):
                    self._owner.write(b'0')
                    self._owner.flush()
                self._owner.seek(0)
                msvcrt.locking(self._owner.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(self._owner.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError as error:
            self._owner.close()
            raise CenterError('CENTER_BUSY', 'This center already has an owner.', 409) from error
        try:
            self._connection = sqlite3.connect(str(self.data_dir / 'center.sqlite3'), check_same_thread=False, isolation_level=None)
            metadata_exists = self._connection.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='metadata'").fetchone()
            version = self._connection.execute("SELECT value FROM metadata WHERE key='schemaVersion'").fetchone() if metadata_exists else None
            if metadata_exists and (not version or version[0] != '1'):
                raise CenterError('SCHEMA_UNSUPPORTED', 'Unsupported center database version.', 503)
            self._connection.execute('PRAGMA journal_mode=WAL')
            self._connection.execute('PRAGMA synchronous=FULL')
            self._connection.execute('CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
            version = self._connection.execute("SELECT value FROM metadata WHERE key='schemaVersion'").fetchone()
            if version and version[0] != '1':
                raise CenterError('SCHEMA_UNSUPPORTED', 'Unsupported center database version.', 503)
            self._connection.execute('CREATE TABLE IF NOT EXISTS records (kind TEXT NOT NULL, id TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY(kind,id))')
            for key, value in [('schemaVersion', '1'), ('centerId', 'center-' + uuid.uuid4().hex), ('revision', '0')]:
                self._connection.execute('INSERT OR IGNORE INTO metadata VALUES (?,?)', (key, value))
            self.center_id = self._connection.execute("SELECT value FROM metadata WHERE key='centerId'").fetchone()[0]
        except Exception:
            self.close()
            raise

    @property
    def revision(self):
        with self._mutex:
            return int(self._connection.execute("SELECT value FROM metadata WHERE key='revision'").fetchone()[0])

    @contextmanager
    def transaction(self):
        with self._mutex:
            if self._active:
                raise RuntimeError('Nested center transactions are not supported')
            self._active = True
            try:
                self._connection.execute('BEGIN IMMEDIATE')
                transaction = _Transaction(self._connection)
                yield transaction
                if transaction.changed:
                    self._connection.execute("UPDATE metadata SET value=CAST(value AS INTEGER)+1 WHERE key='revision'")
                self._connection.execute('COMMIT')
            except BaseException:
                if self._connection.in_transaction:
                    self._connection.execute('ROLLBACK')
                raise
            finally:
                self._active = False

    def close(self):
        with self._mutex:
            if self._connection is not None:
                self._connection.close()
                self._connection = None
            if not self._owner.closed:
                if os.name == 'nt':
                    import msvcrt
                    self._owner.seek(0)
                    msvcrt.locking(self._owner.fileno(), msvcrt.LK_UNLCK, 1)
                else:
                    import fcntl
                    fcntl.flock(self._owner.fileno(), fcntl.LOCK_UN)
                self._owner.close()

    def backup(self, destination=None):
        """SQLite-consistent snapshot, including committed WAL contents."""
        with self._mutex:
            if self._active:
                raise CenterError('CENTER_BUSY', 'Cannot back up inside a transaction.', 409)
            folder = self.data_dir / 'snapshots'
            folder.mkdir(exist_ok=True)
            target = Path(destination).resolve() if destination else folder / ('center-' + uuid.uuid4().hex + '.sqlite3')
            try:
                target.relative_to(folder.resolve())
            except ValueError as error:
                raise CenterError('INVALID_INPUT', 'Backups must remain in the center snapshots directory.') from error
            if target.exists():
                raise CenterError('BACKUP_EXISTS', 'Backup destination already exists.', 409)
            connection = sqlite3.connect(str(target))
            try:
                self._connection.backup(connection)
            finally:
                connection.close()
            return str(target)
