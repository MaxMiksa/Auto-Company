# Authentication & Authorization Patterns

Secure patterns for identity verification and access control.

## Authentication Methods

### Password-Based

#### Password Storage

```typescript
// ✅ Correct: bcrypt with cost factor
import bcrypt from 'bcrypt';
const SALT_ROUNDS = 12;

async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}
```

```typescript
// ✅ Alternative: Argon2id (recommended for new systems)
import argon2 from 'argon2';

async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 4
  });
}

async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return argon2.verify(hash, password);
}
```

#### Password Requirements

```typescript
interface PasswordPolicy {
  minLength: 12;           // NIST recommends 8+, 12+ is better
  maxLength: 128;          // Prevent DoS on hashing
  requireUppercase: false; // NIST discourages complexity rules
  requireLowercase: false;
  requireNumbers: false;
  requireSpecial: false;
  checkCommonPasswords: true;  // Block common passwords
  checkBreached: true;         // Check Have I Been Pwned
}
```

```typescript
// Check against breached passwords
import crypto from 'crypto';

async function isPasswordBreached(password: string): Promise<boolean> {
  const sha1 = crypto.createHash('sha1').update(password).digest('hex').toUpperCase();
  const prefix = sha1.substring(0, 5);
  const suffix = sha1.substring(5);
  
  const response = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`);
  const text = await response.text();
  
  return text.includes(suffix);
}
```

---

### JWT Authentication

#### Token Structure

```typescript
interface JWTPayload {
  sub: string;      // User ID (subject)
  iat: number;      // Issued at
  exp: number;      // Expiration
  jti: string;      // JWT ID (for revocation)
  iss: string;      // Issuer
  aud: string;      // Audience
  scope?: string;   // Permissions
}
```

#### Secure JWT Implementation

```typescript
import jwt from 'jsonwebtoken';
import crypto from 'crypto';

const JWT_SECRET = process.env.JWT_SECRET!; // Strong secret, 256+ bits
const ACCESS_TOKEN_TTL = '15m';
const REFRESH_TOKEN_TTL = '7d';

function generateAccessToken(user: User): string {
  return jwt.sign(
    {
      sub: user.id,
      scope: user.permissions.join(' '),
      jti: crypto.randomUUID()
    },
    JWT_SECRET,
    {
      algorithm: 'HS256',  // Or RS256 for asymmetric
      expiresIn: ACCESS_TOKEN_TTL,
      issuer: 'api.example.com',
      audience: 'example.com'
    }
  );
}

function verifyAccessToken(token: string): JWTPayload {
  return jwt.verify(token, JWT_SECRET, {
    algorithms: ['HS256'],  // Explicitly specify allowed algorithms
    issuer: 'api.example.com',
    audience: 'example.com',
    complete: false
  }) as JWTPayload;
}
```

#### Refresh Token Rotation

```typescript
interface RefreshToken {
  id: string;
  userId: string;
  tokenHash: string;
  familyId: string;  // Detect token reuse
  expiresAt: Date;
  createdAt: Date;
}

async function refreshTokens(refreshToken: string): Promise<TokenPair> {
  const tokenHash = hashToken(refreshToken);
  const storedToken = await RefreshToken.findOne({ tokenHash });
  
  if (!storedToken || storedToken.expiresAt < new Date()) {
