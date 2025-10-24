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
    throw new Error('Invalid refresh token');
  }
  
  // Detect token reuse (potential theft)
  const familyTokens = await RefreshToken.find({ familyId: storedToken.familyId });
  if (familyTokens.some(t => t.id !== storedToken.id && t.createdAt > storedToken.createdAt)) {
    // Token reuse detected - invalidate entire family
    await RefreshToken.deleteMany({ familyId: storedToken.familyId });
    throw new Error('Token reuse detected');
  }
  
  // Rotate: invalidate old, create new
  await RefreshToken.delete({ id: storedToken.id });
  
  const newRefreshToken = await createRefreshToken(storedToken.userId, storedToken.familyId);
  const newAccessToken = generateAccessToken(await User.findById(storedToken.userId));
  
  return { accessToken: newAccessToken, refreshToken: newRefreshToken };
}
```

---

### Session-Based Authentication

#### Secure Session Configuration

```typescript
import session from 'express-session';
import RedisStore from 'connect-redis';
import { createClient } from 'redis';

const redisClient = createClient({ url: process.env.REDIS_URL });

app.use(session({
  store: new RedisStore({ client: redisClient }),
  secret: process.env.SESSION_SECRET!,
  name: '__Host-session',  // Cookie prefix for additional security
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: true,          // HTTPS only
    httpOnly: true,        // No JS access
    sameSite: 'strict',    // CSRF protection
    maxAge: 24 * 60 * 60 * 1000,  // 24 hours
    domain: undefined,     // Current domain only
    path: '/'
  }
}));
```

#### Session Regeneration

```typescript
// Always regenerate session on login
app.post('/login', async (req, res) => {
  const user = await authenticateUser(req.body);
  
  req.session.regenerate((err) => {
    if (err) return res.status(500).json({ error: 'Session error' });
    
    req.session.userId = user.id;
    req.session.loginTime = Date.now();
    req.session.ip = req.ip;
    
    res.json({ success: true });
  });
});

// Validate session consistency
function validateSession(req: Request, res: Response, next: NextFunction) {
  if (req.session.ip && req.session.ip !== req.ip) {
    // IP changed - potential session hijacking
    req.session.destroy(() => {});
    return res.status(401).json({ error: 'Session invalid' });
  }
  next();
}
```

---

## Authorization Patterns

### Role-Based Access Control (RBAC)

```typescript
enum Role {
  USER = 'user',
  ADMIN = 'admin',
  SUPER_ADMIN = 'super_admin'
}

interface User {
  id: string;
  roles: Role[];
}

function requireRole(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = req.user as User;
    
    if (!user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    
    const hasRole = roles.some(role => user.roles.includes(role));
    
    if (!hasRole) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    
    next();
  };
}

// Usage
app.delete('/api/users/:id', authenticate, requireRole(Role.ADMIN), deleteUser);
```

### Permission-Based Access Control

```typescript
enum Permission {
  READ_USERS = 'users:read',
  WRITE_USERS = 'users:write',
  DELETE_USERS = 'users:delete',
  READ_ORDERS = 'orders:read',
  WRITE_ORDERS = 'orders:write'
}

const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  [Role.USER]: [Permission.READ_USERS, Permission.READ_ORDERS],
  [Role.ADMIN]: [Permission.READ_USERS, Permission.WRITE_USERS, Permission.READ_ORDERS, Permission.WRITE_ORDERS],
  [Role.SUPER_ADMIN]: Object.values(Permission)
};

function requirePermission(...permissions: Permission[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = req.user as User;
    const userPermissions = user.roles.flatMap(role => ROLE_PERMISSIONS[role]);
    
    const hasPermissions = permissions.every(p => userPermissions.includes(p));
    
    if (!hasPermissions) {
