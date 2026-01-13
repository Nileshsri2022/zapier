# ZapMate Code Patterns & Best Practices

This document captures the coding patterns and best practices learned while building ZapMate.

---

## React/Next.js Patterns

### 1. Environment Variable Configuration

**Pattern:** Centralized config file for API URLs

```typescript
// lib/config.ts
export const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';
export const HOOKS_URL = process.env.NEXT_PUBLIC_HOOKS_URL || 'http://localhost:8000';
```

**Usage:**
```typescript
import { API_URL } from '@/lib/config';

axios.get(`${API_URL}/api/zaps`);
```

**Why:** 
- Single source of truth
- Easy to change for all components
- Default values for development

---

### 2. Hooks Before Conditionals

**Wrong:**
```typescript
function Component() {
  if (!user) return <Login />;
  const router = useRouter();  // ❌ Called conditionally
}
```

**Correct:**
```typescript
function Component() {
  const router = useRouter();  // ✅ Always called first
  
  useEffect(() => {
    if (!user) router.push('/login');
  }, [user]);
  
  if (!user) return <Loading />;
}
```

---

### 3. Suspense for Dynamic Imports

**Pattern:** Always wrap useSearchParams in Suspense

```typescript
function SearchContent() {
  const searchParams = useSearchParams();
  return <div>{searchParams.get('query')}</div>;
}

export default function Page() {
  return (
    <Suspense fallback={<Loading />}>
      <SearchContent />
    </Suspense>
  );
}
```

---

## Node.js/Express Patterns

### 1. Cron-Triggered HTTP Endpoints

**Pattern:** Convert background workers to HTTP endpoints with authentication

```typescript
import express from 'express';

const app = express();

// Middleware to verify cron secret
const verifyCronSecret = (req, res, next) => {
  const authHeader = req.headers.authorization;
  const token = authHeader?.replace('Bearer ', '');
  
  if (token !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
};

// Process endpoint
app.post('/process', verifyCronSecret, async (req, res) => {
  try {
    const result = await processQueue();
    res.json({ success: true, processed: result.count });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
```

---

### 2. Graceful Error Handling

```typescript
app.post('/api/zaps', async (req, res) => {
  try {
    const zap = await createZap(req.body);
    res.status(201).json({ success: true, data: zap });
  } catch (error) {
    console.error('Zap creation failed:', error);
    
    if (error.code === 'P2002') {
      return res.status(409).json({ error: 'Zap already exists' });
    }
    
    res.status(500).json({ 
      error: 'Internal server error',
      message: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});
```

---

## TypeScript Patterns

### 1. Explicit Event Types

**Before:**
```typescript
const handleChange = (e: any) => {  // ❌ Avoid any
  setData(e.target.value);
};
```

**After:**
```typescript
const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
  setData(e.target.value);
};

const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
  e.preventDefault();
};
```

---

### 2. Interface vs Type

Use interfaces for objects that might be extended:
```typescript
interface User {
  id: string;
  name: string;
}

interface AdminUser extends User {
  permissions: string[];
}
```

Use types for unions, primitives, or computed types:
```typescript
type Status = 'pending' | 'active' | 'completed';
type UserId = string;
```

---

## Monorepo Patterns

### 1. Shared Package Structure

```
packages/
├── db/
│   ├── prisma/schema.prisma
│   ├── src/index.ts
│   └── package.json  (name: "@repo/db")
├── email/
│   ├── src/index.ts
│   └── package.json  (name: "@repo/email")
└── types/
    ├── src/index.ts
    └── package.json  (name: "@repo/types")
```

**Usage in apps:**
```json
{
  "dependencies": {
    "@repo/db": "*",
    "@repo/email": "*"
  }
}
```

---

### 2. Prisma in Monorepo

Generate client with explicit schema path:
```bash
npx prisma generate --schema=packages/db/prisma/schema.prisma
```

In package.json:
```json
{
  "exports": {
    ".": "./src/index.ts"
  }
}
```

---

## Git Patterns

### 1. Meaningful Commit Messages

```
feat: add Gmail integration for webhook triggers
fix: resolve memory issue by switching to esbuild
chore: add .env.example files for all services
docs: update deployment documentation
refactor: extract API config to centralized file
```

---

### 2. .gitignore for Monorepos

```gitignore
# Dependencies
node_modules

# Environment files (secrets)
.env*
!.env.example  # Allow example files

# Build outputs
dist
.next
build

# Platform-specific
.vercel
.turbo
```

---

## Security Patterns

### 1. JWT Authentication

```typescript
import jwt from 'jsonwebtoken';

// Middleware
const authenticate = (req, res, next) => {
  const token = req.headers.authorization;
  
  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }
  
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Invalid token' });
  }
};
```

### 2. Input Validation with Zod

```typescript
import { z } from 'zod';

const createZapSchema = z.object({
  name: z.string().min(1).max(100),
  triggerId: z.string().uuid(),
  actions: z.array(z.object({
    actionId: z.string().uuid(),
    metadata: z.record(z.unknown())
  }))
});

app.post('/api/zaps', async (req, res) => {
  const result = createZapSchema.safeParse(req.body);
  
  if (!result.success) {
    return res.status(400).json({ errors: result.error.issues });
  }
  
  // Use result.data (typed and validated)
});
```

---

## Performance Patterns

### 1. Database Query Optimization

**Bad:**
```typescript
// N+1 query problem
const zaps = await prisma.zap.findMany();
for (const zap of zaps) {
  zap.actions = await prisma.action.findMany({ where: { zapId: zap.id } });
}
```

**Good:**
```typescript
// Single query with include
const zaps = await prisma.zap.findMany({
  include: {
    actions: true,
    trigger: true
  }
});
```

---

## Summary Checklist

- [ ] Use centralized config for environment variables
- [ ] Place React hooks before conditional returns
- [ ] Wrap useSearchParams in Suspense
- [ ] Use explicit TypeScript types (avoid `any`)
- [ ] Secure HTTP endpoints with authentication
- [ ] Use meaningful commit messages
- [ ] Keep secrets out of git with .gitignore
- [ ] Optimize database queries with includes
