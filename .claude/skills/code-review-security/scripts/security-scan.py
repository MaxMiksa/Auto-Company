#!/usr/bin/env python3
"""
security-scan.py — AST-based security scanner for common Python vulnerability patterns.

Scans Python source files for:
  - eval() / exec() / compile() calls
  - subprocess with shell=True
  - pickle.loads() on potentially untrusted data
  - Raw SQL string construction (f-strings with SELECT/INSERT/UPDATE/DELETE)
  - yaml.load() without SafeLoader
  - Hardcoded secret patterns (API keys, passwords in source)
  - Weak hash functions (MD5, SHA1 for passwords)
  - os.system() calls

Usage:
  python security-scan.py --path ./app --output-dir ./security-results
  python security-scan.py --path ./app --output-dir ./results --severity high

Options:
  --path         Directory or file to scan (required)
  --output-dir   Directory to write JSON results (default: ./security-results)
  --severity     Minimum severity to report: critical, high, medium, low (default: low)
"""

import argparse
import ast
import json
import os
import re
import sys
from dataclasses import dataclass, asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional


# ─── Data Structures ─────────────────────────────────────────────────────────────

SEVERITY_ORDER = {"critical": 0, "high": 1, "medium": 2, "low": 3, "info": 4}


@dataclass
class Finding:
    """A single security finding."""
    rule_id: str
    severity: str
    category: str
    message: str
    file: str
    line: int
    col: int
    snippet: str
    cwe: Optional[str] = None


# ─── AST-Based Rules ─────────────────────────────────────────────────────────────

class SecurityVisitor(ast.NodeVisitor):
    """AST visitor that checks for common security anti-patterns."""

    def __init__(self, filepath: str, source_lines: list[str]):
        self.filepath = filepath
        self.source_lines = source_lines
        self.findings: list[Finding] = []

    def _get_snippet(self, lineno: int) -> str:
        """Get the source line for a finding."""
        if 1 <= lineno <= len(self.source_lines):
            return self.source_lines[lineno - 1].strip()
        return ""

    def _add_finding(
        self,
        rule_id: str,
        severity: str,
        category: str,
        message: str,
        node: ast.AST,
        cwe: Optional[str] = None,
    ):
        self.findings.append(Finding(
            rule_id=rule_id,
            severity=severity,
            category=category,
            message=message,
            file=self.filepath,
            line=getattr(node, "lineno", 0),
            col=getattr(node, "col_offset", 0),
            snippet=self._get_snippet(getattr(node, "lineno", 0)),
            cwe=cwe,
        ))

    def visit_Call(self, node: ast.Call):
        """Check function calls for dangerous patterns."""
        func_name = self._get_func_name(node)

        # Rule: eval / exec / compile
        if func_name in ("eval", "exec", "compile"):
            self._add_finding(
                rule_id="SEC001",
                severity="critical",
                category="OWASP A03: Injection",
                message=f"Use of {func_name}() can lead to code execution. "
                        f"Remove or use ast.literal_eval() for safe parsing.",
                node=node,
                cwe="CWE-95",
            )

        # Rule: pickle.loads / pickle.load
        if func_name in ("pickle.loads", "pickle.load"):
            self._add_finding(
                rule_id="SEC002",
                severity="critical",
                category="OWASP A08: Software and Data Integrity",
                message="pickle.loads() can execute arbitrary code on untrusted data. "
                        "Use JSON or msgpack for deserialization.",
                node=node,
                cwe="CWE-502",
            )

        # Rule: os.system
        if func_name == "os.system":
            self._add_finding(
                rule_id="SEC003",
                severity="high",
                category="OWASP A03: Injection",
                message="os.system() is vulnerable to command injection. "
                        "Use subprocess.run([...], shell=False) instead.",
                node=node,
                cwe="CWE-78",
            )

        # Rule: subprocess with shell=True
        if func_name in ("subprocess.run", "subprocess.call", "subprocess.Popen",
                         "subprocess.check_output", "subprocess.check_call"):
            for kw in node.keywords:
                if kw.arg == "shell" and isinstance(kw.value, ast.Constant) and kw.value.value is True:
                    self._add_finding(
                        rule_id="SEC004",
                        severity="high",
                        category="OWASP A03: Injection",
                        message=f"{func_name}() with shell=True is vulnerable to "
                                f"command injection. Use shell=False and pass args as a list.",
                        node=node,
                        cwe="CWE-78",
                    )

        # Rule: yaml.load without SafeLoader
        if func_name == "yaml.load":
            has_safe_loader = False
            for kw in node.keywords:
                if kw.arg == "Loader":
                    if isinstance(kw.value, ast.Attribute) and "Safe" in kw.value.attr:
                        has_safe_loader = True
                    elif isinstance(kw.value, ast.Name) and "Safe" in kw.value.id:
                        has_safe_loader = True
            if not has_safe_loader:
                self._add_finding(
                    rule_id="SEC005",
                    severity="high",
                    category="OWASP A08: Software and Data Integrity",
                    message="yaml.load() without SafeLoader can execute arbitrary code. "
                            "Use yaml.safe_load() or yaml.load(data, Loader=yaml.SafeLoader).",
                    node=node,
                    cwe="CWE-502",
                )

        # Rule: hashlib.md5 / hashlib.sha1 (potential password hashing)
        if func_name in ("hashlib.md5", "hashlib.sha1"):
            self._add_finding(
                rule_id="SEC006",
                severity="medium",
                category="OWASP A02: Cryptographic Failures",
                message=f"{func_name}() is a weak hash function. "
                        f"If used for passwords, switch to bcrypt via passlib.",
                node=node,
                cwe="CWE-328",
            )

        self.generic_visit(node)

    def visit_JoinedStr(self, node: ast.JoinedStr):
        """Check f-strings for potential SQL injection."""
        # Reconstruct the f-string content to check for SQL keywords
        string_parts = []
        for value in node.values:
            if isinstance(value, ast.Constant):
                string_parts.append(str(value.value))

        full_text = " ".join(string_parts).upper()
        sql_keywords = ["SELECT ", "INSERT ", "UPDATE ", "DELETE ", "DROP ", "ALTER "]

        if any(kw in full_text for kw in sql_keywords):
            self._add_finding(
                rule_id="SEC007",
                severity="critical",
                category="OWASP A03: Injection",
                message="SQL query constructed with f-string interpolation. "
                        "This is vulnerable to SQL injection. Use parameterized queries.",
                node=node,
                cwe="CWE-89",
            )

        self.generic_visit(node)

    def _get_func_name(self, node: ast.Call) -> str:
        """Extract the function name from a Call node."""
        if isinstance(node.func, ast.Name):
            return node.func.id
        elif isinstance(node.func, ast.Attribute):
            parts = []
            current = node.func
            while isinstance(current, ast.Attribute):
                parts.append(current.attr)
                current = current.value
            if isinstance(current, ast.Name):
                parts.append(current.id)
            return ".".join(reversed(parts))
        return ""


# ─── Regex-Based Rules (for patterns AST cannot catch) ────────────────────────

REGEX_RULES = [
    {
        "rule_id": "SEC008",
        "severity": "high",
        "category": "OWASP A02: Cryptographic Failures",
        "message": "Potential hardcoded secret detected. Move secrets to environment variables.",
        "cwe": "CWE-798",
        "pattern": re.compile(
            r"""(?:SECRET_KEY|API_KEY|PASSWORD|TOKEN|PRIVATE_KEY)\s*=\s*['"][^'"]{8,}['"]""",
            re.IGNORECASE,
        ),
    },
    {
        "rule_id": "SEC009",
        "severity": "medium",
        "category": "OWASP A09: Security Logging and Monitoring",
        "message": "Potential sensitive data in log statement. Ensure passwords, tokens, "
                   "and PII are not logged.",
        "cwe": "CWE-532",
        "pattern": re.compile(
            r"""(?:logger?\.|logging\.)(?:info|debug|warning|error)\(.*(?:password|token|secret|api_key)""",
            re.IGNORECASE,
        ),
    },
    {
        "rule_id": "SEC010",
        "severity": "medium",
        "category": "OWASP A07: Identification and Authentication",
        "message": "JWT decode with signature verification disabled. Always verify JWT signatures.",
        "cwe": "CWE-347",
        "pattern": re.compile(
            r"""jwt\.decode\(.*verify_signature.*False""",
            re.IGNORECASE,
        ),
    },
]


def regex_scan(filepath: str, source: str) -> list[Finding]:
    """Apply regex-based rules to source code."""
    findings = []
    lines = source.split("\n")
    for rule in REGEX_RULES:
        for i, line in enumerate(lines, start=1):
            if rule["pattern"].search(line):
                findings.append(Finding(
                    rule_id=rule["rule_id"],
                    severity=rule["severity"],
                    category=rule["category"],
                    message=rule["message"],
                    file=filepath,
                    line=i,
                    col=0,
                    snippet=line.strip(),
                    cwe=rule.get("cwe"),
                ))
    return findings


# ─── Scanner ──────────────────────────────────────────────────────────────────

def scan_file(filepath: str) -> list[Finding]:
    """Scan a single Python file for security issues."""
    try:
        source = Path(filepath).read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError) as e:
        print(f"WARNING: Could not read {filepath}: {e}", file=sys.stderr)
        return []

    findings = []

    # AST-based scan
    try:
        tree = ast.parse(source, filename=filepath)
        visitor = SecurityVisitor(filepath, source.split("\n"))
        visitor.visit(tree)
        findings.extend(visitor.findings)
    except SyntaxError as e:
        print(f"WARNING: Syntax error in {filepath}: {e}", file=sys.stderr)

    # Regex-based scan
    findings.extend(regex_scan(filepath, source))

    return findings


def scan_directory(path: str) -> list[Finding]:
    """Recursively scan a directory for Python files."""
    findings = []
    scan_path = Path(path)

    if scan_path.is_file():
        if scan_path.suffix == ".py":
            return scan_file(str(scan_path))
        return []

    for py_file in scan_path.rglob("*.py"):
        # Skip common non-application directories
        skip_dirs = {"__pycache__", ".venv", "venv", "node_modules", ".git", "migrations"}
        if any(part in skip_dirs for part in py_file.parts):
            continue
        findings.extend(scan_file(str(py_file)))

    return findings


# ─── Main ─────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="AST-based security scanner for Python code.",
    )
    parser.add_argument(
        "--path",
        required=True,
        help="Directory or file to scan",
    )
    parser.add_argument(
        "--output-dir",
        default="./security-results",
        help="Directory to write JSON results (default: ./security-results)",
    )
    parser.add_argument(
        "--severity",
        default="low",
        choices=["critical", "high", "medium", "low", "info"],
        help="Minimum severity to report (default: low)",
    )
    args = parser.parse_args()

    # Validate path
    if not Path(args.path).exists():
        print(f"ERROR: Path does not exist: {args.path}", file=sys.stderr)
        sys.exit(1)

    # Scan
    print(f"Scanning: {args.path}")
    all_findings = scan_directory(args.path)

    # Filter by severity
    min_severity = SEVERITY_ORDER.get(args.severity, 3)
    findings = [f for f in all_findings if SEVERITY_ORDER.get(f.severity, 4) <= min_severity]

    # Sort by severity (critical first), then by file and line
    findings.sort(key=lambda f: (SEVERITY_ORDER.get(f.severity, 4), f.file, f.line))

    # Write results
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    output_file = output_dir / f"security-scan-{timestamp}.json"

    report = {
        "scan_timestamp": datetime.now(timezone.utc).isoformat(),
        "scanned_path": str(Path(args.path).resolve()),
        "min_severity": args.severity,
        "total_findings": len(findings),
        "by_severity": {
            sev: len([f for f in findings if f.severity == sev])
            for sev in ["critical", "high", "medium", "low", "info"]
        },
        "findings": [asdict(f) for f in findings],
    }

    output_file.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(f"Results written to: {output_file}")

    # Console summary
    print(f"\n{'='*60}")
    print(f"Security Scan Results")
    print(f"{'='*60}")
    print(f"Files scanned:    {args.path}")
    print(f"Total findings:   {len(findings)}")
    for sev in ["critical", "high", "medium", "low"]:
        count = report["by_severity"][sev]
        if count > 0:
            print(f"  {sev.upper():12s}  {count}")
    print(f"{'='*60}")

    if findings:
        print("\nFindings:\n")
        for f in findings:
            print(f"  [{f.severity.upper()}] {f.rule_id}: {f.message}")
            print(f"    File: {f.file}:{f.line}")
            print(f"    Code: {f.snippet}")
            if f.cwe:
                print(f"    CWE:  {f.cwe}")
            print()

    # Exit code: non-zero if critical or high findings exist
    critical_high = report["by_severity"]["critical"] + report["by_severity"]["high"]
    if critical_high > 0:
        print(f"FAIL: {critical_high} critical/high severity findings detected.")
        sys.exit(1)
    else:
        print("PASS: No critical or high severity findings.")
        sys.exit(0)


if __name__ == "__main__":
    main()
