---
name: security-audit
agents: [yokay-security-scanner]
description: Use when reviewing code security, auditing dependencies for CVEs, checking configuration or secret security, assessing authentication and authorization patterns, identifying OWASP vulnerabilities (injection, XSS, CSRF), or addressing security concerns about implementations.
---

# Security Audit

Systematic security review for application code, dependencies, and configuration.

**Not a replacement for professional penetration testing.** Identifies common vulnerabilities within scope of code review.

## Audit Types

| Type | Focus | When to Use |
|------|-------|-------------|
| Code Review | OWASP Top 10, injection, auth | New features, PRs, suspicious code |
| Dependency | CVEs, outdated packages | Before deploy, periodic, CI/CD |
| Configuration | Secrets, permissions, hardening | Infrastructure changes, new envs |
| Architecture | Attack surface, data flow | Design phase, major refactors |
| API Security | Auth, authz, rate limiting | New endpoints, public APIs |

## When NOT to Use

- **Designing new auth flows** — Use `api-design` for designing OAuth2/JWT endpoints from scratch
- **Performance issues** — Use `performance-optimization` even if caused by auth overhead
- **CI/CD pipeline security** — Use `ci-cd` for pipeline hardening (secret management, permissions)

## Key Principles

- **Scope first** — Define audit area, depth, and constraints before scanning
- **Classify severity** — Critical (24-48h), High (1 week), Medium (2-4 weeks), Low (backlog)
- **Remediate or track** — Fix critical issues immediately, create ohno tasks for the rest
- **No secrets in code** — Scan for hardcoded credentials, API keys, connection strings

## Quick Start Checklist

1. Define audit scope and type (code, dependency, config, architecture, API)
2. Run automated scans (npm audit, grep patterns, secret detection)
3. Review findings and classify severity using decision tree in references
4. Remediate critical/high findings immediately
5. Create ohno tasks for medium/low findings with appropriate priority
6. Document findings in audit report

## References

| Reference | Description |
|-----------|-------------|
| [owasp-top-10.md](references/owasp-top-10.md) | OWASP vulnerabilities with detection and fixes |
| [dependency-security.md](references/dependency-security.md) | npm audit, pip-audit, Snyk, CI/CD integration |
| [auth-patterns.md](references/auth-patterns.md) | Secure authentication and authorization patterns |
| [api-security.md](references/api-security.md) | API-specific security concerns |
| [secrets-management.md](references/secrets-management.md) | Handling sensitive configuration |
