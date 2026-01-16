# ==============================================
# OPTIMIZED DOCKERFILE FOR HOOKS SERVICE
# Monorepo-safe • Render-safe • Prisma-safe
# ==============================================

# 1️⃣ Use a small, fast base image (Alpine-based Bun)
FROM oven/bun:1-alpine AS builder

WORKDIR /app

# Copy root workspace files
COPY package.json bun.lock ./
RUN echo "=== DEBUG 1: Root files ===" && ls -la

# Copy ALL packages source code BEFORE install (workspace resolution needs them)
COPY packages ./packages
RUN echo "=== DEBUG 2: Packages copied ===" && ls -la packages/

COPY apps/hooks ./apps/hooks
RUN echo "=== DEBUG 3: Hooks copied ===" && ls -la apps/hooks/

# Show package.jsons to verify workspace packages are there
RUN echo "=== DEBUG 4: Workspace package.jsons ===" && \
    cat packages/db/package.json | head -5 && \
    cat packages/email/package.json | head -5 && \
    cat packages/kafka/package.json | head -5 && \
    cat packages/redis/package.json | head -5

# Install dependencies (now workspace packages can be found)
RUN echo "=== DEBUG 5: Running bun install ===" && bun install

RUN echo "=== DEBUG 6: node_modules/@repo check ===" && ls -la node_modules/@repo/ || echo "No @repo folder"

# Generate Prisma client
RUN bunx prisma generate --schema=packages/db/prisma/schema.prisma
RUN echo "=== DEBUG 7: Prisma generated ==="

# -------------------------------
# 🏗 Build workspace packages
# -------------------------------

# Email package
WORKDIR /app/packages/email
RUN echo "=== DEBUG 8: Building email ===" && bun run build
RUN echo "=== DEBUG 9: Email dist ===" && ls -la dist/

# Kafka package
WORKDIR /app/packages/kafka
RUN echo "=== DEBUG 10: Building kafka ===" && bun run build
RUN echo "=== DEBUG 11: Kafka dist ===" && ls -la dist/src/

# Redis package
WORKDIR /app/packages/redis
RUN echo "=== DEBUG 12: Building redis ===" && bun run build
RUN echo "=== DEBUG 13: Redis dist ===" && ls -la dist/src/

# -------------------------------
# 🚀 Build hooks service
# -------------------------------
WORKDIR /app/apps/hooks
RUN echo "=== DEBUG 14: Building hooks ===" && bunx swc src -d dist --copy-files
RUN echo "=== DEBUG 15: Hooks dist ===" && ls -la dist/

# Final verification
WORKDIR /app
RUN echo "=== DEBUG 16: All builds complete! ==="

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
RUN echo "=== RUNNER 1: Hooks dist ===" && ls -la dist/

# DB package (Prisma client)
COPY --from=builder /app/packages/db ./packages/db
RUN echo "=== RUNNER 2: DB package ===" && ls -la packages/db/

# Node modules (includes prod dependencies)
COPY --from=builder /app/node_modules ./node_modules
RUN echo "=== RUNNER 3: node_modules copied ===" && ls -la node_modules/@repo/ || echo "No @repo yet"

# ⚠️ FIX: Replace broken symlinks with actual files

# Kafka package
RUN rm -rf ./node_modules/@repo/kafka 2>/dev/null || true
RUN mkdir -p ./node_modules/@repo/kafka
COPY --from=builder /app/packages/kafka/dist ./node_modules/@repo/kafka/dist
COPY --from=builder /app/packages/kafka/package.json ./node_modules/@repo/kafka/package.json
RUN echo "=== RUNNER 4: Kafka ===" && ls -la node_modules/@repo/kafka/

# Email package
RUN rm -rf ./node_modules/@repo/email 2>/dev/null || true
RUN mkdir -p ./node_modules/@repo/email
COPY --from=builder /app/packages/email/dist ./node_modules/@repo/email/dist
COPY --from=builder /app/packages/email/package.json ./node_modules/@repo/email/package.json
RUN echo "=== RUNNER 5: Email ===" && ls -la node_modules/@repo/email/

# Redis package
RUN rm -rf ./node_modules/@repo/redis 2>/dev/null || true
RUN mkdir -p ./node_modules/@repo/redis
COPY --from=builder /app/packages/redis/dist ./node_modules/@repo/redis/dist
COPY --from=builder /app/packages/redis/package.json ./node_modules/@repo/redis/package.json
RUN echo "=== RUNNER 6: Redis ===" && ls -la node_modules/@repo/redis/

# DB package
RUN rm -rf ./node_modules/@repo/db 2>/dev/null || true
RUN mkdir -p ./node_modules/@repo/db
COPY --from=builder /app/packages/db/src ./node_modules/@repo/db/src
COPY --from=builder /app/packages/db/package.json ./node_modules/@repo/db/package.json
RUN echo "=== RUNNER 7: DB ===" && ls -la node_modules/@repo/db/

# Root workspace manifest
COPY --from=builder /app/package.json ./package.json

# Hooks manifest
COPY --from=builder /app/apps/hooks/package.json ./apps/hooks/package.json

# Start script
COPY --from=builder /app/apps/hooks/start.sh ./start.sh
RUN chmod +x ./start.sh

# Test require
RUN echo "=== RUNNER 8: Test requires ===" && \
    node -e "require('./node_modules/@repo/kafka/dist/src/index.js'); console.log('✅ Kafka OK')" && \
    node -e "require('./node_modules/@repo/redis/dist/src/index.js'); console.log('✅ Redis OK')"

# -------------------------------
# ⚙ Runtime config
# -------------------------------
ENV NODE_ENV=production
ENV PORT=10000

EXPOSE 10000

CMD ["./start.sh"]
