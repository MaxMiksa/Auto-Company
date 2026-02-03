# OWASP Top 10 Reference

The OWASP Top 10 represents the most critical web application security risks.

## A01:2021 – Broken Access Control

### Description
Access control enforces policy such that users cannot act outside their intended permissions.

### Detection Patterns

```bash
# Missing authorization checks
grep -rn "router\.\(get\|post\|put\|delete\)" --include="*.ts" | \
  xargs -I{} sh -c 'grep -L "auth\|authorize\|permission" "{}"'

# Direct object references without ownership check
grep -rn "params\.id\|params\.userId" --include="*.ts" | grep -v "owner\|author"

# Horizontal privilege escalation
grep -rn "findById\|findOne" --include="*.ts" | grep -v "where.*userId"
```

### Vulnerable Code

```typescript
// IDOR: Any user can access any order
app.get('/api/orders/:id', async (req, res) => {
  const order = await Order.findById(req.params.id);
  res.json(order); // ❌ No ownership check
});

// Missing function-level access control
app.delete('/api/users/:id', async (req, res) => {
  await User.delete(req.params.id); // ❌ No admin check
});
```

### Fixed Code

```typescript
// IDOR prevention
app.get('/api/orders/:id', authenticate, async (req, res) => {
  const order = await Order.findOne({
    where: { id: req.params.id, userId: req.user.id } // ✅ Ownership check
  });
  if (!order) return res.status(404).json({ error: 'Not found' });
  res.json(order);
});

// Function-level access control
app.delete('/api/users/:id', authenticate, requireRole('admin'), async (req, res) => {
  await User.delete(req.params.id);
  res.status(204).send();
});
```

---

## A02:2021 – Cryptographic Failures

### Description
Failures related to cryptography which often leads to sensitive data exposure.

### Detection Patterns

```bash
# Weak hashing
grep -rn "md5\|sha1\|crypto\.createHash" --include="*.ts" --include="*.js"

# Hardcoded secrets
grep -rn "password\s*=\s*['\"]" --include="*.ts" --include="*.js"
grep -rn "apiKey\s*=\s*['\"]" --include="*.ts" --include="*.js"

# Insecure random
grep -rn "Math\.random" --include="*.ts" --include="*.js"
```

### Vulnerable Code

```typescript
// Weak password hashing
const hash = crypto.createHash('md5').update(password).digest('hex');

// Insecure random for tokens
const token = Math.random().toString(36).substring(2);

// Sensitive data in logs
console.log(`User ${email} logged in with token ${token}`);
```

### Fixed Code

```typescript
// Strong password hashing
import bcrypt from 'bcrypt';
const hash = await bcrypt.hash(password, 12);

// Cryptographically secure random
import crypto from 'crypto';
const token = crypto.randomBytes(32).toString('hex');

// Sanitized logging
console.log(`User ${email.substring(0, 3)}*** logged in`);
```

---

## A03:2021 – Injection

### Description
User-supplied data is not validated, filtered, or sanitized by the application.

### Detection Patterns

```bash
# SQL Injection
grep -rn "query\s*(\s*['\`].*\$\|+" --include="*.ts"
grep -rn "execute\s*(\s*['\`].*\$\|+" --include="*.ts"

# Command Injection
grep -rn "exec\s*(\|spawn\s*(\|execSync" --include="*.ts"
grep -rn "child_process" --include="*.ts"

# NoSQL Injection
grep -rn "find\s*(\s*{.*req\." --include="*.ts"
grep -rn "\$where\|\$regex" --include="*.ts"
```

### Vulnerable Code

```typescript
// SQL Injection
const user = await db.query(`SELECT * FROM users WHERE email = '${email}'`);

// Command Injection
const output = execSync(`ping ${hostname}`);

// NoSQL Injection
const user = await User.findOne({ 
  email: req.body.email,
  password: req.body.password // ❌ Could be { $gt: '' }
});
```

### Fixed Code

```typescript
// Parameterized queries
const user = await db.query('SELECT * FROM users WHERE email = $1', [email]);

// Input validation for commands
const validHostname = /^[a-zA-Z0-9.-]+$/.test(hostname);
if (!validHostname) throw new Error('Invalid hostname');
const output = execSync(`ping ${hostname}`);

// NoSQL with type checking
const email = String(req.body.email);
const user = await User.findOne({ email });
const isValid = await bcrypt.compare(req.body.password, user.passwordHash);
```

---

## A04:2021 – Insecure Design

### Description
Risks related to design flaws. Cannot be fixed by a perfect implementation.

### Detection Patterns

- Business logic flaws (manual review required)
- Missing rate limiting on sensitive operations
- No account lockout mechanism
- Password reset without verification

### Common Flaws

```typescript
// No rate limiting on login
app.post('/login', async (req, res) => {
  // ❌ Unlimited attempts
});

// Predictable password reset
app.post('/reset-password', async (req, res) => {
  const token = Date.now().toString(); // ❌ Predictable
});

// Business logic bypass
app.post('/checkout', async (req, res) => {
  const total = req.body.total; // ❌ Trust client-provided total
});
```

### Fixed Design

```typescript
// Rate limiting
import rateLimit from 'express-rate-limit';
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 5 });
app.post('/login', loginLimiter, async (req, res) => { /* ... */ });

// Secure password reset
const token = crypto.randomBytes(32).toString('hex');
const expiry = Date.now() + 3600000; // 1 hour

// Server-side calculation
const items = await Cart.findByUserId(req.user.id);
const total = items.reduce((sum, item) => sum + item.price * item.qty, 0);
```

---

## A05:2021 – Security Misconfiguration

### Description
Missing security hardening, default configurations, verbose errors.

### Detection Patterns

```bash
# Debug mode
grep -rn "debug\s*:\s*true\|DEBUG=true" --include="*.ts" --include="*.env*"

# Stack traces exposed
grep -rn "res\.send.*err\.\(stack\|message\)" --include="*.ts"

# Default credentials
grep -rn "admin:admin\|root:root\|password123" --include="*"
```

### Vulnerable Configuration

```typescript
// Express error handler exposing stack
app.use((err, req, res, next) => {
  res.status(500).json({ 
    error: err.message,
    stack: err.stack // ❌ Exposes internals
  });
});

// CORS too permissive
app.use(cors({ origin: '*' })); // ❌
```

### Fixed Configuration

```typescript
// Production error handler
app.use((err, req, res, next) => {
  console.error(err); // Log internally
  res.status(500).json({ 
    error: 'Internal server error',
    requestId: req.id
  });
});

// Restrictive CORS
app.use(cors({ 
  origin: ['https://app.example.com'],
  credentials: true
}));

// Security headers
app.use(helmet());
```

---

## A06:2021 – Vulnerable Components

### Description
Using components with known vulnerabilities.

### Detection

```bash
# npm
npm audit
npm audit --json | jq '.vulnerabilities | keys[]'

# Python
pip-audit
safety check

# General
snyk test
```

### Common Issues

| Package | Vulnerability | Fix |
|---------|---------------|-----|
| lodash <4.17.21 | Prototype pollution | Update |
| express <4.17.3 | ReDoS | Update |
| axios <0.21.1 | SSRF | Update |
| jsonwebtoken <9.0.0 | Algorithm confusion | Update |

---

## A07:2021 – Auth Failures

### Description
Confirmation of user identity, authentication, and session management.

### Detection Patterns

```bash
# Weak JWT verification
grep -rn "verify.*algorithms\|algorithm.*none" --include="*.ts"

# Session fixation
grep -rn "req\.session\s*=" --include="*.ts"

# No logout invalidation
grep -rn "logout" -A5 --include="*.ts" | grep -v "destroy\|invalidate"
```

### Vulnerable Code

```typescript
// JWT without algorithm restriction
jwt.verify(token, secret); // ❌ Accepts 'none' algorithm

// No session regeneration
app.post('/login', async (req, res) => {
  req.session.userId = user.id; // ❌ Session fixation
});

// Logout without invalidation
app.post('/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ success: true }); // ❌ Token still valid
});
```

### Fixed Code

```typescript
// Explicit algorithm
jwt.verify(token, secret, { algorithms: ['HS256'] });

// Session regeneration
app.post('/login', async (req, res) => {
  req.session.regenerate((err) => {
    req.session.userId = user.id;
    res.json({ success: true });
  });
});

// Token invalidation
app.post('/logout', async (req, res) => {
  await TokenBlacklist.add(req.token, req.user.tokenExp);
  res.json({ success: true });
});
```

---

## A08:2021 – Software and Data Integrity

### Description
Code and infrastructure that does not protect against integrity violations.

### Detection

```bash
# No integrity checks on external resources
grep -rn "<script src=" --include="*.html" | grep -v "integrity="

# Unsafe deserialization
grep -rn "JSON\.parse\|unserialize\|pickle\.load" --include="*.ts" --include="*.py"

# CI/CD pipeline vulnerabilities (manual review)
```

### Vulnerable Code

```html
<!-- No subresource integrity -->
<script src="https://cdn.example.com/lib.js"></script>
```

### Fixed Code

```html
<!-- With SRI -->
<script src="https://cdn.example.com/lib.js" 
        integrity="sha384-abc123..." 
        crossorigin="anonymous"></script>
```

---

## A09:2021 – Logging Failures

### Description
Insufficient logging, detection, monitoring, and active response.

### Detection

```bash
# Missing security logging
grep -rn "login\|logout\|password" --include="*.ts" | grep -v "log\|audit"

# Sensitive data in logs
grep -rn "console\.log.*password\|token\|secret" --include="*.ts"
```

### Requirements

```typescript
// Security events to log
const securityEvents = [
  'login_success',
  'login_failure',
  'logout',
  'password_change',
  'mfa_enabled',
  'mfa_disabled',
  'permission_change',
  'data_export',
  'admin_action'
];

// Audit log entry
interface AuditLog {
  timestamp: Date;
  event: string;
  userId: string;
  ip: string;
  userAgent: string;
  details: Record<string, unknown>;
  success: boolean;
}
```

---

## A10:2021 – SSRF

### Description
Server-Side Request Forgery occurs when fetching a remote resource without validating user-supplied URL.

### Detection Patterns

```bash
# URL from user input
grep -rn "fetch\|axios\|request\|http\.get" --include="*.ts" | \
  grep "req\.\(body\|query\|params\)"

# DNS rebinding potential
grep -rn "url\s*=.*req\." --include="*.ts"
```

### Vulnerable Code

```typescript
// SSRF vulnerability
app.get('/fetch', async (req, res) => {
  const response = await fetch(req.query.url); // ❌
  res.json(await response.json());
});
```

### Fixed Code

```typescript
import { URL } from 'url';

const ALLOWED_HOSTS = ['api.example.com', 'cdn.example.com'];

app.get('/fetch', async (req, res) => {
  const url = new URL(req.query.url);
  
  // Validate host
  if (!ALLOWED_HOSTS.includes(url.hostname)) {
    return res.status(400).json({ error: 'Host not allowed' });
  }
  
  // Block internal IPs
  const ip = await dns.resolve(url.hostname);
  if (isPrivateIP(ip)) {
    return res.status(400).json({ error: 'Internal hosts not allowed' });
  }
  
  const response = await fetch(url.toString());
  res.json(await response.json());
});
```

---

## Quick Reference Table

| ID | Name | Key Mitigation |
|----|------|----------------|
| A01 | Broken Access Control | Authorization checks on every endpoint |
| A02 | Cryptographic Failures | Strong algorithms, no hardcoded secrets |
| A03 | Injection | Parameterized queries, input validation |
| A04 | Insecure Design | Threat modeling, rate limiting |
| A05 | Security Misconfiguration | Security headers, minimal error info |
| A06 | Vulnerable Components | Regular dependency updates |
| A07 | Auth Failures | Strong auth, session management |
| A08 | Integrity Failures | SRI, signed updates |
| A09 | Logging Failures | Audit logs, monitoring |
| A10 | SSRF | URL validation, allowlists |
