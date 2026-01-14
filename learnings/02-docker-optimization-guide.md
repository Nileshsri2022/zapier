# Docker Optimization for Monorepo Deployment

This document covers Docker best practices for deploying a monorepo to Render.

---

## The 10 Docker Optimization Rules

### 1. Use Small, Fast Base Images
```dockerfile
# ✅ Good - Alpine based
FROM oven/bun:1-alpine AS builder
FROM node:20-alpine AS runner

# ❌ Bad - Full images
FROM node:20
```

### 2. Enable Corepack (for pnpm/yarn)
Not applicable for Bun, but for pnpm:
```dockerfile
RUN corepack enable
```

### 3. Copy Lockfiles BEFORE Source Code
```dockerfile
# ✅ This creates a cached layer
COPY package.json bun.lock ./
COPY apps/server/package.json ./apps/server/
COPY packages/db/package.json ./packages/db/
# ... all package.json files

RUN bun install

# THEN copy source (changes here don't bust dep cache)
COPY packages ./packages
COPY apps/server ./apps/server
```

### 4. Install Dependencies in Separate Layer
```dockerfile
# Dependencies in their own cacheable layer
RUN bun install

# Source code in next layer
COPY . .
```

### 5. Copy ONLY What You Need (Monorepo)
```dockerfile
# ✅ Specific paths
COPY apps/server ./apps/server
COPY packages/db ./packages/db
COPY packages/email ./packages/email
COPY packages/types ./packages/types

# ❌ Don't copy everything
COPY . .
```

### 6. Use Multi-Stage Builds
```dockerfile
# Stage 1: Build
FROM oven/bun:1-alpine AS builder
WORKDIR /app
# ... build steps

# Stage 2: Run (smaller image)
FROM node:20-alpine AS runner
WORKDIR /app
COPY --from=builder /app/dist ./dist
```

### 7. Build Only Target Service
```dockerfile
# Build packages in dependency order
WORKDIR /app/packages/types
RUN bun run build

WORKDIR /app/packages/email
RUN bun run build

# Only build the service you're deploying
WORKDIR /app/apps/server
RUN bunx swc src -d dist --copy-files
```

### 8. Use .dockerignore
```dockerignore
# Ignore everything
*

# Include only needed files
!package.json
!bun.lock
!apps/server/
!packages/db/
!packages/email/
!packages/types/

# Always ignore
**/.git
**/.env
**/node_modules
**/dist
```

### 9. Skip Type-Checking in Docker
```dockerfile
# ✅ Use SWC (faster, no type-check)
RUN bunx swc src -d dist --copy-files

# ❌ Slower - includes type checking
RUN npx tsc
```

### 10. Production Dependencies Only
```dockerfile
# Final stage only has runtime deps
COPY --from=builder /app/node_modules ./node_modules
# No devDependencies needed at runtime
```

---

## Complete Optimized Dockerfile

```dockerfile
# ==============================================
# OPTIMIZED DOCKERFILE FOR MONOREPO
# ==============================================

FROM oven/bun:1-alpine AS builder
WORKDIR /app

# 1. Copy lockfiles first (cache layer)
COPY package.json bun.lock ./
COPY apps/server/package.json ./apps/server/
COPY packages/db/package.json ./packages/db/
COPY packages/email/package.json ./packages/email/
COPY packages/types/package.json ./packages/types/
COPY packages/typescript-config/package.json ./packages/typescript-config/

# 2. Install deps (cached if lockfiles unchanged)
RUN bun install

# 3. Copy source
COPY packages ./packages
COPY apps/server ./apps/server

# 4. Generate Prisma
RUN bunx prisma generate --schema=packages/db/prisma/schema.prisma

# 5. Build in order
WORKDIR /app/packages/types
RUN bun run build

WORKDIR /app/packages/email
RUN bun run build

WORKDIR /app/apps/server
RUN bunx swc src -d dist --copy-files

# ==============================================
# PRODUCTION STAGE
# ==============================================
FROM node:20-alpine AS runner

RUN apk add --no-cache openssl
WORKDIR /app

# Copy only production files
COPY --from=builder /app/apps/server/dist ./dist
COPY --from=builder /app/packages/email/dist ./packages/email/dist
COPY --from=builder /app/packages/email/package.json ./packages/email/package.json
COPY --from=builder /app/packages/types/dist ./packages/types/dist
COPY --from=builder /app/packages/types/package.json ./packages/types/package.json
COPY --from=builder /app/packages/db ./packages/db
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/apps/server/start.sh ./start.sh

RUN chmod +x ./start.sh

ENV NODE_ENV=production
ENV PORT=10000
EXPOSE 10000

CMD ["./start.sh"]
```

---

## Common Monorepo Docker Errors

| Error | Cause | Fix |
|-------|-------|-----|
| `Cannot find module '@repo/xxx'` | Package not built or package.json not copied | Build package, copy its package.json |
| `SyntaxError: Unexpected token` | Trying to run TypeScript in Node | Build the package to JavaScript |
| `Prisma binary not found` | Wrong binary target | Add `binaryTargets` in schema.prisma |
| `ENOENT: template not found` | Static files not copied | Add `--copy-files` to SWC or manual copy |

---

## Expected Build Times

| Scenario | Time |
|----------|------|
| First build (no cache) | 60-90s |
| Cached build (only code changed) | 10-20s |
| Cached build (deps unchanged) | 5-10s |

---

*Created: 2026-01-14*
