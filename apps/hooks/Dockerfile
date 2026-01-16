# ==============================================
# OPTIMIZED DOCKERFILE FOR HOOKS SERVICE
# Monorepo-safe • Render-safe • Prisma-safe
# ==============================================

# 1️⃣ Use a small, fast base image (Alpine-based Bun)
FROM oven/bun:1-alpine AS builder

WORKDIR /app

# Copy root workspace files
COPY package.json bun.lock ./

# Copy ALL packages source code BEFORE install (workspace resolution needs them)
COPY packages ./packages
COPY apps/hooks ./apps/hooks

# Install dependencies (now workspace packages can be found)
RUN bun install

# Generate Prisma client
RUN bunx prisma generate --schema=packages/db/prisma/schema.prisma

# -------------------------------
# 🏗 Build workspace packages
# -------------------------------

# Email package
WORKDIR /app/packages/email
RUN bun run build

# Kafka package
WORKDIR /app/packages/kafka
RUN bun run build

# Redis package
WORKDIR /app/packages/redis
RUN bun run build

# -------------------------------
# 🚀 Build hooks service
# -------------------------------
WORKDIR /app/apps/hooks

# Skip type-checking - use SWC directly (faster)
RUN bunx swc src -d dist --copy-files

# Verify builds
WORKDIR /app
RUN echo "=== Verify builds ===" && ls -la /app/packages/kafka/dist/src/ && ls -la /app/packages/email/dist/

# ==============================================
# Multi-stage build (production stage)
# ==============================================

FROM node:20-alpine AS runner

# Prisma requires OpenSSL
RUN apk add --no-cache openssl

WORKDIR /app

# -------------------------------
# 📦 Copy runtime artifacts
# -------------------------------

# Hooks dist
COPY --from=builder /app/apps/hooks/dist ./dist

# DB package (Prisma client)
COPY --from=builder /app/packages/db ./packages/db

# Node modules (includes prod dependencies)
COPY --from=builder /app/node_modules ./node_modules

# ⚠️ FIX: Replace broken symlinks with actual file

# Kafka package
RUN rm -rf ./node_modules/@repo/kafka 2>/dev/null || true
RUN mkdir -p ./node_modules/@repo/kafka
COPY --from=builder /app/packages/kafka/dist ./node_modules/@repo/kafka/dist
COPY --from=builder /app/packages/kafka/package.json ./node_modules/@repo/kafka/package.json

# Email package
RUN rm -rf ./node_modules/@repo/email 2>/dev/null || true
RUN mkdir -p ./node_modules/@repo/email
COPY --from=builder /app/packages/email/dist ./node_modules/@repo/email/dist
COPY --from=builder /app/packages/email/package.json ./node_modules/@repo/email/package.json

# Redis package
RUN rm -rf ./node_modules/@repo/redis 2>/dev/null || true
RUN mkdir -p ./node_modules/@repo/redis
COPY --from=builder /app/packages/redis/dist ./node_modules/@repo/redis/dist
COPY --from=builder /app/packages/redis/package.json ./node_modules/@repo/redis/package.json

# DB package
RUN rm -rf ./node_modules/@repo/db 2>/dev/null || true
RUN mkdir -p ./node_modules/@repo/db
COPY --from=builder /app/packages/db/src ./node_modules/@repo/db/src
COPY --from=builder /app/packages/db/package.json ./node_modules/@repo/db/package.json

# Root workspace manifest
COPY --from=builder /app/package.json ./package.json

# Hooks manifest
COPY --from=builder /app/apps/hooks/package.json ./apps/hooks/package.json

# Start script
COPY --from=builder /app/apps/hooks/start.sh ./start.sh
RUN chmod +x ./start.sh

# -------------------------------
# ⚙ Runtime config
# -------------------------------
ENV NODE_ENV=production
ENV PORT=10000

EXPOSE 10000

CMD ["./start.sh"]
