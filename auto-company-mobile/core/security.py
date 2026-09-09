"""
Security Manager — Command validation, secret detection, audit logging.
"""
import hashlib
import json
import os
import re
import sqlite3
import time
from typing import Dict, List, Optional, Tuple, Any, Set


class SecurityManager:
    """Security validation and audit for agent command execution."""

    BLOCKED_PATTERNS = [
        r'rm\s+-rf\s+/(?:\s|$)',
        r'rm\s+-rf\s+~/.*',
        r'sudo\s+',
        r'git\s+push\s+.*--force',
        r'mkfs\.',
        r'dd\s+if=',
        r':\(\)\s*\{.*\}\;',
        r'chmod\s+777\s+/',
        r'>\s*/dev/sd[a-z][0-9]?',
        r'wget\s+.*\|\s*sh',
        r'curl\s+.*\|\s*sh',
        r'eval\s+\$\(',
        r'`[^`]*`',
        r'\$\([^)]+\)',
    ]

    ALLOWED_COMMANDS = {
        'cat', 'ls', 'grep', 'rg', 'find', 'echo', 'python3', 'python', 'pip',
        'git', 'cd', 'pwd', 'mkdir', 'touch', 'vi', 'vim', 'nano',
        'curl', 'wget', 'gh', 'npm', 'node', 'make', 'bash', 'sh',
        'sqlite3', 'jq', 'tar', 'gzip', 'unzip', 'head', 'tail',
        'wc', 'sort', 'uniq', 'diff', 'rsync', 'cp', 'mv'
    }

    SECRET_PATTERNS = [
        re.compile(r'(?i)(?:api[_-]?key|secret|password|token|passwd|pwd)\s*[=:]\s*["\'][^"\']+["\']'),
        re.compile(r'(?i)(?:api[_-]?key|secret|password|token|passwd|pwd)\s*[=:]\s*\S{8,}'),
        re.compile(r'(?i)(?:github|gitlab)[-_]?(?:pat|token|key)[_\w]*\s*[=:]\s*["\'][^"\']+["\']'),
        re.compile(r'(?i)(?:aws[_-]?(?:access[_-]?key|secret[_-]?key))\s*[=:]\s*["\'][^"\']+["\']'),
        re.compile(r'gh[pousr]_[A-Za-z0-9]+'),
        re.compile(r'eyJ[A-Za-z0-9_-]+'),
        re.compile(r'sk-[A-Za-z0-9]{20,}'),
    ]

    def __init__(self, db_path: str = "state/security_audit.db"):
        self.db_path = db_path
        self._init_db()
        self._whitelist: Set[str] = set()
        self._blacklist: Set[str] = set()

    def _init_db(self):
        os.makedirs(os.path.dirname(self.db_path) or ".", exist_ok=True)
        conn = sqlite3.connect(self.db_path)
        c = conn.cursor()
        c.execute('''
            CREATE TABLE IF NOT EXISTS audit_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                command_hash TEXT NOT NULL,
                command TEXT NOT NULL,
                agent_name TEXT,
                status TEXT,
                risk_level TEXT,
                triggered_rules TEXT,
                secrets_found INTEGER DEFAULT 0,
                response TEXT,
                timestamp REAL NOT NULL,
                duration_ms REAL
            )
        ''')
        c.execute('CREATE INDEX IF NOT EXISTS idx_timestamp ON audit_log(timestamp)')
        c.execute('CREATE INDEX IF NOT EXISTS idx_agent ON audit_log(agent_name)')
        conn.commit()
        conn.close()

    def add_to_whitelist(self, command: str):
        """Add a command to whitelist."""
        self._whitelist.add(command)

    def add_to_blacklist(self, command: str):
        """Add a command to blacklist."""
        self._blacklist.add(command)

    def validate_command(self, command: str, agent_name: str = "unknown") -> Tuple[bool, str, List[str]]:
        """Validate a command against security rules."""
        triggered_rules = []
        risk_level = 'low'

        # Check blacklist
        if command in self._blacklist:
            return False, "Command is blacklisted", ['blacklist']

        # Check blocked patterns
        for pattern in self.BLOCKED_PATTERNS:
            if re.search(pattern, command):
                triggered_rules.append('blocked_pattern')
                risk_level = 'critical'

        # Check allowed commands
        first_word = command.split()[0] if command.split() else ''
        if first_word and first_word not in self.ALLOWED_COMMANDS and first_word not in self._whitelist:
            triggered_rules.append('unallowed_command')
            if risk_level == 'low':
                risk_level = 'high'

        # Check for secrets in command
        secrets_found = self._detect_secrets(command)
        if secrets_found > 0:
            triggered_rules.append('secrets_in_command')
            risk_level = 'critical'

        # Determine final verdict
        if risk_level in ('critical', 'high') or triggered_rules:
            return False, f"Command rejected: risk level {risk_level}", triggered_rules

        return True, "Command approved", []

    def validate_output(self, output: str, agent_name: str = "unknown") -> Tuple[bool, str, List[str]]:
        """Check command output for leaked secrets."""
        secrets = []
        for pattern in self.SECRET_PATTERNS:
            secrets.extend(pattern.findall(output))
        return len(secrets) == 0, "Clean output" if not secrets else f"Found {len(secrets)} secrets", secrets

    def _detect_secrets(self, text: str) -> int:
        """Count potential secrets in text."""
        count = 0
        for pattern in self.SECRET_PATTERNS:
            count += len(pattern.findall(text))
        return count

    def scan_response(self, response: str) -> Tuple[str, int, List[str]]:
        """Scan LLM response for command suggestions and secrets."""
        commands_found = []
        secrets_found = []

        # Extract potential commands from response
        command_pattern = re.compile(r'```(?:bash|sh)\n([^\n][\s\S]*?)```')
        for match in command_pattern.finditer(response):
            cmd = match.group(1).strip()
            commands_found.append(cmd)

        # Check for secrets
        for pattern in self.SECRET_PATTERNS:
            found = pattern.findall(response)
            secrets_found.extend(found)

        return 'flagged' if secrets_found else 'clean', len(secrets_found), commands_found

    def audit_command(self, command: str, agent_name: str, response: str,
                      duration_ms: float, status: str,
                      triggered_rules: Optional[List[str]] = None) -> int:
        """Log command execution to audit trail."""
        cmd_hash = hashlib.sha256(command.encode()).hexdigest()[:16]
        secrets_detected = self._detect_secrets(command)

        conn = sqlite3.connect(self.db_path)
        c = conn.cursor()
        c.execute('''
            INSERT INTO audit_log (command_hash, command, agent_name, status,
                                   risk_level, triggered_rules, secrets_found,
                                   response, timestamp, duration_ms)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''', (cmd_hash, command, agent_name, status,
              'critical' if 'blocked_pattern' in (triggered_rules or []) else 'low',
              json.dumps(triggered_rules or []),
              secrets_detected, response[:500], time.time(), duration_ms))
        log_id = c.lastrowid
        conn.commit()
        conn.close()
        return log_id

    def get_audit_history(self, agent_name: Optional[str] = None,
                          hours: int = 24) -> List[Dict]:
        """Get audit log history."""
        cutoff = time.time() - (hours * 3600)
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        c = conn.cursor()

        if agent_name:
            c.execute('SELECT * FROM audit_log WHERE agent_name = ? AND timestamp > ? ORDER BY timestamp DESC',
                      (agent_name, cutoff))
        else:
            c.execute('SELECT * FROM audit_log WHERE timestamp > ? ORDER BY timestamp DESC', (cutoff,))

        results = [dict(row) for row in c.fetchall()]
        conn.close()
        return results

    def get_security_summary(self) -> Dict[str, Any]:
        """Get security statistics."""
        conn = sqlite3.connect(self.db_path)
        c = conn.cursor()

        c.execute('SELECT COUNT(*) FROM audit_log')
        total = c.fetchone()[0]

        c.execute('SELECT COUNT(*) FROM audit_log WHERE status = ?', ('rejected',))
        rejected = c.fetchone()[0]

        c.execute('SELECT COUNT(*) FROM audit_log WHERE secrets_found > 0')
        secret_leaks = c.fetchone()[0]

        c.execute('SELECT risk_level, COUNT(*) FROM audit_log GROUP BY risk_level')
        by_risk = dict(c.fetchall())

        conn.close()

        return {
            'total_commands': total,
            'rejected_commands': rejected,
            'approval_rate': (total - rejected) / total if total > 0 else 0.0,
            'secret_leaks_prevented': secret_leaks,
            'by_risk_level': by_risk
        }
