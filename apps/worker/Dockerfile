# ==============================================
# OPTIMIZED DOCKERFILE FOR WORKER SERVICE
# Following all 10 Docker optimization rules
# Monorepo-safe • Render-safe • Prisma-safe
# ==============================================

# 1️⃣ Use a small, fast base image (Alpine-based Bun)
FROM oven/bun:1-alpine AS builder

WORKDIR /app

# 3️⃣ COPY lockfiles BEFORE source code (cache layer)
COPY package.json bun.lock ./
RUN echo "=== DEBUG 1: Root files ===" && ls -la

# 5️⃣ Copy ONLY what you need (monorepo package.jsons)
COPY apps/worker/package.json ./apps/worker/
COPY packages/db/package.json ./packages/db/
COPY packages/email/package.json ./packages/email/
COPY packages/kafka/package.json ./packages/kafka/
COPY packages/redis/package.json ./packages/redis/
COPY packages/typescript-config/package.json ./packages/typescript-config/
RUN echo "=== DEBUG 2: Package.jsons copied ===" && ls -la packages/

# 4️⃣ Install dependencies in a separate layer (cached)
RUN echo "=== DEBUG 3: Running bun install ===" && bun install

RUN echo "=== DEBUG 4: node_modules/@repo check ===" && ls -la node_modules/@repo/ || echo "No @repo folder yet"

# Now copy source code (changes here don't bust dep cache)
COPY packages ./packages
COPY apps/worker ./apps/worker
RUN echo "=== DEBUG 5: Source copied ===" && ls -la packages/ && ls -la apps/worker/

# Generate Prisma client
RUN bunx prisma generate --schema=packages/db/prisma/schema.prisma
RUN echo "=== DEBUG 6: Prisma generated ==="

# -------------------------------
# 🏗 Build workspace packages
# -------------------------------

# 7️⃣ Build only what's needed

# Email package
WORKDIR /app/packages/email
RUN echo "=== DEBUG 7: Building email ===" && bun run build
RUN echo "=== DEBUG 8: Email dist ===" && ls -la dist/

# Kafka package
WORKDIR /app/packages/kafka
RUN echo "=== DEBUG 9: Building kafka ===" && bun run build
RUN echo "=== DEBUG 10: Kafka dist ===" && ls -la dist/src/

# Redis package
WORKDIR /app/packages/redis
RUN echo "=== DEBUG 11: Building redis ===" && bun run build
RUN echo "=== DEBUG 12: Redis dist ===" && ls -la dist/src/

# -------------------------------
# 🚀 Build worker service
# -------------------------------
WORKDIR /app/apps/worker

# 9️⃣ Skip type-checking - use SWC directly (faster)
RUN echo "=== DEBUG 13: Building worker ===" && bunx swc src -d dist --copy-files
RUN echo "=== DEBUG 14: Worker dist ===" && ls -la dist/

# Final verification
WORKDIR /app
RUN echo "=== DEBUG 15: All builds complete! ==="


# ==============================================
# 6️⃣ Multi-stage build (production stage)
# ==============================================

# 1️⃣ Use small production image
FROM node:20-alpine AS runner

# Prisma requires OpenSSL
RUN apk add --no-cache openssl

WORKDIR /app

# -------------------------------
# 📦 Copy runtime artifacts
# -------------------------------

# Worker dist
COPY --from=builder /app/apps/worker/dist ./dist
RUN echo "=== RUNNER 1: Worker dist ===" && ls -la dist/

# DB package (Prisma client)
COPY --from=builder /app/packages/db ./packages/db
RUN echo "=== RUNNER 2: DB package ===" && ls -la packages/db/

# 🔟 Node modules (includes prod dependencies)
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

# Worker manifest
COPY --from=builder /app/apps/worker/package.json ./apps/worker/package.json

# Start script
COPY --from=builder /app/apps/worker/start.sh ./start.sh
RUN chmod +x ./start.sh

# Test requires
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
