# 10 Rules for Fast Docker Builds in Monorepos

## Overview

These 10 rules ensure fast, reliable Docker builds for services in a Bun/npm monorepo.

---

## 1️⃣ Use a Small, Fast Base Image

```dockerfile
FROM oven/bun:1-alpine AS builder
FROM node:20-alpine AS runner
```

- Alpine images are ~5MB vs ~100MB+ for full images
- Bun for fast installs in builder, Node for stable runtime

---

## 2️⃣ Enable Corepack (for pnpm/yarn)

```dockerfile
RUN corepack enable
```

- Not needed for Bun (native package manager)
- Provides 2-3x speed boost for pnpm/yarn

---

## 3️⃣ COPY Lockfiles BEFORE Source Code

```dockerfile
# First: lockfiles only
COPY package.json bun.lock ./

# Then: install (CACHED if lockfile unchanged!)
RUN bun install

# Finally: source code
COPY packages ./packages
```

- Docker caches each layer
- If you copy source first, EVERY change busts the cache

---

## 4️⃣ Install Dependencies in Separate Layer

```dockerfile
COPY package.json bun.lock ./
RUN bun install                 # This layer is cached!
COPY packages ./packages        # Source changes don't bust install cache
```

---

## 5️⃣ Copy ONLY What You Need

```dockerfile
# Don't copy everything!
# ❌ COPY . .

# ✅ Copy only needed package.jsons
COPY apps/processor/package.json ./apps/processor/
COPY packages/db/package.json ./packages/db/
COPY packages/kafka/package.json ./packages/kafka/
```

---

## 6️⃣ Use Multi-Stage Builds

```dockerfile
# Stage 1: Build (with dev deps)
FROM oven/bun:1-alpine AS builder
RUN bun install
RUN bun run build

# Stage 2: Run (production only)
FROM node:20-alpine AS runner
COPY --from=builder /app/dist ./dist
```

- Builder stage has all dev dependencies
- Runner stage is minimal (no dev deps, no source)

---

## 7️⃣ Build Only the Target Service

```dockerfile
# Only build packages this service needs
WORKDIR /app/packages/kafka
RUN bun run build

WORKDIR /app/apps/processor
RUN bunx swc src -d dist --copy-files
```

---

## 8️⃣ Use .dockerignore

Create `.dockerignore` in each app:

```
node_modules
dist
.env
.git
*.md
*.log
__tests__
```

- Reduces Docker context size
- Faster builds on Render/Railway

---

## 9️⃣ Skip Type-Checking in Docker

```dockerfile
# ❌ Slow: tsc checks types
RUN tsc

# ✅ Fast: SWC just transpiles
RUN bunx swc src -d dist --copy-files
```

- Type-check in CI, not in Docker
- SWC is 10-20x faster than tsc

---

## 🔟 Fix Workspace Symlinks in Runner

```dockerfile
# Bun creates symlinks: node_modules/@repo/kafka → ../../packages/kafka
# These break after Docker COPY. Fix by replacing with actual files:

RUN rm -rf ./node_modules/@repo/kafka 2>/dev/null || true
RUN mkdir -p ./node_modules/@repo/kafka
COPY --from=builder /app/packages/kafka/dist ./node_modules/@repo/kafka/dist
COPY --from=builder /app/packages/kafka/package.json ./node_modules/@repo/kafka/package.json
```

---

## Complete Template

```dockerfile
# ==============================================
# OPTIMIZED DOCKERFILE
# ==============================================

FROM oven/bun:1-alpine AS builder
WORKDIR /app

# 3️⃣ Lockfiles first
COPY package.json bun.lock ./

# 5️⃣ Only needed package.jsons
COPY apps/SERVICE/package.json ./apps/SERVICE/
COPY packages/db/package.json ./packages/db/
COPY packages/kafka/package.json ./packages/kafka/

# 4️⃣ Install in separate layer
RUN bun install

# Copy source
COPY packages ./packages
COPY apps/SERVICE ./apps/SERVICE

# Generate Prisma
RUN bunx prisma generate --schema=packages/db/prisma/schema.prisma

# 7️⃣ Build packages
WORKDIR /app/packages/kafka
RUN bun run build

# 9️⃣ Fast SWC build
WORKDIR /app/apps/SERVICE
RUN bunx swc src -d dist --copy-files

# ==============================================
# 6️⃣ Multi-stage production
# ==============================================

FROM node:20-alpine AS runner
RUN apk add --no-cache openssl
WORKDIR /app

# Copy dist
COPY --from=builder /app/apps/SERVICE/dist ./dist

# Node modules
COPY --from=builder /app/node_modules ./node_modules

# 🔟 Fix symlinks
RUN rm -rf ./node_modules/@repo/kafka && mkdir -p ./node_modules/@repo/kafka
COPY --from=builder /app/packages/kafka/dist ./node_modules/@repo/kafka/dist
COPY --from=builder /app/packages/kafka/package.json ./node_modules/@repo/kafka/package.json

COPY --from=builder /app/apps/SERVICE/start.sh ./start.sh
RUN chmod +x ./start.sh

ENV NODE_ENV=production
ENV PORT=10000
EXPOSE 10000

CMD ["./start.sh"]
```
