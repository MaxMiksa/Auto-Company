---
name: code-review-security
description: >-
  Security-focused code review checklist and automated scanning patterns. Use when
  reviewing pull requests for security issues, auditing authentication/authorization
  code, checking for OWASP Top 10 vulnerabilities, or validating input sanitization.
  Covers SQL injection prevention, XSS protection, CSRF tokens, authentication flow
  review, secrets detection, dependency vulnerability scanning, and secure coding
  patterns for Python (FastAPI) and React. Does NOT cover deployment security (use
  docker-best-practices) or incident handling (use incident-response).
license: MIT
compatibility: 'Python 3.12+, FastAPI, React, TypeScript'
metadata:
  author: security-team
  version: '1.0.0'
  sdlc-phase: code-review
allowed-tools: Read Grep Glob Write Bash(python:*) Bash(npm:*)
context: fork
---

# Code Review Security

## When to Use

Activate this skill when:
- Reviewing pull requests for security vulnerabilities
- Auditing authentication or authorization code changes
- Reviewing code that handles user input, file uploads, or external data
- Checking for OWASP Top 10 vulnerabilities in new features
- Validating that secrets are not committed to the repository
- Scanning dependencies for known vulnerabilities
- Reviewing API endpoints that expose sensitive data

**Output:** Write findings to `security-review.md` with severity, file:line, description, and recommendations.

Do NOT use this skill for:
- Deployment infrastructure security (use `docker-best-practices`)
- Incident response procedures (use `incident-response`)
- General code quality review without security focus (use `pre-merge-checklist`)
- Writing implementation code (use `python-backend-expert` or `react-frontend-expert`)

## Instructions

### OWASP Top 10 Checklist

Review every PR against the OWASP Top 10 (2021 edition). Each category below includes specific checks for Python/FastAPI and React codebases.

---

#### A01: Broken Access Control

**What to look for:**
- Missing authorization checks on endpoints
- Direct object reference without ownership verification
- Endpoints that expose data without role-based filtering
- Missing `Depends()` for auth on new routes

**Python/FastAPI checks:**
```python
# BAD: No authorization check -- any authenticated user can access any user
@router.get("/users/{user_id}")
async def get_user(user_id: int, db: Session = Depends(get_db)):
    return await user_repo.get(user_id)

# GOOD: Verify the requesting user owns the resource or is admin
@router.get("/users/{user_id}")
async def get_user(
    user_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if current_user.id != user_id and current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Forbidden")
    return await user_repo.get(user_id)
```

**Review checklist:**
- [ ] Every route has authentication (`Depends(get_current_user)`)
- [ ] Resource access is verified against the requesting user
- [ ] Admin-only endpoints check `role == "admin"`
- [ ] List endpoints filter by user ownership (unless admin)
- [ ] No IDOR (Insecure Direct Object Reference) vulnerabilities

---

#### A02: Cryptographic Failures

**What to look for:**
- Passwords stored in plaintext or with weak hashing
- Sensitive data in logs or error messages
- Hardcoded secrets, API keys, or tokens
- Weak JWT configuration

**Python checks:**
```python
# BAD: Weak password hashing
import hashlib
password_hash = hashlib.md5(password.encode()).hexdigest()

# GOOD: Use bcrypt via passlib
from passlib.context import CryptContext
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
password_hash = pwd_context.hash(password)

# BAD: Secret in code
SECRET_KEY = "my-super-secret-key-123"

# GOOD: Secret from environment
SECRET_KEY = os.environ["SECRET_KEY"]
```

**Review checklist:**
- [ ] Passwords hashed with bcrypt (never MD5, SHA1, or plaintext)
- [ ] JWT secret loaded from environment, not hardcoded
- [ ] Sensitive data excluded from logs (passwords, tokens, PII)
- [ ] HTTPS enforced for all external communication
- [ ] No secrets in source code (check `.env.example` has placeholders only)

---

#### A03: Injection

**What to look for:**
- Raw SQL queries with string interpolation
- `eval()`, `exec()`, `compile()` with user input
- `subprocess` calls with `shell=True`
- Template injection

**Python checks:**
```python
# BAD: SQL injection via string formatting
query = f"SELECT * FROM users WHERE email = '{email}'"
db.execute(text(query))

# GOOD: Parameterized query
db.execute(text("SELECT * FROM users WHERE email = :email"), {"email": email})

# GOOD: SQLAlchemy ORM (always parameterized)
user = db.query(User).filter(User.email == email).first()

# BAD: Command injection
subprocess.run(f"convert {filename}", shell=True)

# GOOD: Pass arguments as a list
subprocess.run(["convert", filename], shell=False)

# BAD: Code execution with user input
result = eval(user_input)

# GOOD: Never eval user input. Use ast.literal_eval for safe parsing.
result = ast.literal_eval(user_input)  # Only for literal structures
```

**Review checklist:**
- [ ] No raw SQL with string interpolation (use ORM or parameterized queries)
- [ ] No `eval()`, `exec()`, or `compile()` with external input
- [ ] No `subprocess.run(..., shell=True)` with dynamic arguments
- [ ] No `pickle.loads()` on untrusted data
- [ ] All user input validated by Pydantic schemas before use

---

