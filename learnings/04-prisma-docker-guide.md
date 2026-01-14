# Prisma Docker Deployment Guide

This document covers Prisma-specific issues when deploying with Docker on Alpine Linux.

---

## Common Prisma Docker Errors

### 1. OpenSSL Version Mismatch

**Error:**
```
Error loading shared library libssl.so.1.1: No such file or directory
```

**Cause:** Alpine Linux doesn't have OpenSSL 1.1 by default.

**Fix:** Install OpenSSL in runner stage:
```dockerfile
FROM node:20-alpine AS runner
RUN apk add --no-cache openssl
```

---

### 2. Binary Target Not Found

**Error:**
```
Prisma Client could not locate the Query Engine for runtime "linux-musl-openssl-3.0.x"
```

**Cause:** Prisma generated binaries for different platform than runtime.

**Fix:** Add binary targets in `schema.prisma`:
```prisma
generator client {
  provider      = "prisma-client-js"
  binaryTargets = ["native", "linux-musl-openssl-3.0.x"]
}
```

**Common Binary Targets:**
| Target | When to Use |
|--------|-------------|
| `native` | Local development |
| `linux-musl-openssl-3.0.x` | Alpine Linux (modern) |
| `linux-musl-openssl-1.1.x` | Alpine Linux (older) |
| `debian-openssl-3.0.x` | Debian/Ubuntu |
| `rhel-openssl-3.0.x` | RHEL/CentOS |

---

### 3. Prisma Client Not Generated

**Error:**
```
Error: @prisma/client did not initialize yet
```

**Fix:** Ensure Prisma generate runs in Dockerfile:
```dockerfile
RUN bunx prisma generate --schema=packages/db/prisma/schema.prisma
```

---

## Complete Prisma Schema for Docker

```prisma
generator client {
  provider      = "prisma-client-js"
  binaryTargets = ["native", "linux-musl-openssl-3.0.x"]
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}
```

---

## Dockerfile Order for Prisma

```dockerfile
# 1. Copy prisma schema
COPY packages/db/prisma ./packages/db/prisma

# 2. Install deps (includes @prisma/client)
RUN bun install

# 3. Generate Prisma client
RUN bunx prisma generate --schema=packages/db/prisma/schema.prisma

# 4. Copy rest of source
COPY packages ./packages
COPY apps/server ./apps/server
```

---

## Migrations in Production

### Option 1: Run migrations in Dockerfile (Not Recommended)
```dockerfile
RUN npx prisma migrate deploy
```
⚠️ Requires DATABASE_URL at build time (security risk)

### Option 2: Run migrations at startup (Recommended)
```bash
# start.sh
#!/bin/sh
npx prisma migrate deploy
node dist/src/index.js
```

### Option 3: Run migrations separately
```bash
# Run before deploying new version
npx prisma migrate deploy --schema=packages/db/prisma/schema.prisma
```

---

## Seeding in Production

**Use `skipDuplicates` for idempotent seeding:**
```typescript
await client.availableTriggers.createMany({
    data: [...],
    skipDuplicates: true  // Safe to run multiple times
});
```

**Add to startup script:**
```bash
#!/bin/sh
echo "🌱 Seeding..."
node dist/src/seed.js 2>/dev/null || echo "Already seeded"
echo "🚀 Starting..."
exec node dist/src/index.js
```

---

## Debugging Prisma in Docker

### Check which binary is being used:
```typescript
console.log(process.platform, process.arch);
// Should show: linux arm64 (or x64)
```

### Check OpenSSL version:
```bash
docker exec <container> openssl version
# OpenSSL 3.x.x ...
```

### Check Prisma binary location:
```bash
docker exec <container> ls -la /app/node_modules/.prisma/client/
```

---

*Created: 2026-01-14*
