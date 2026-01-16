# ==============================================
# OPTIMIZED DOCKERFILE FOR HOOKS SERVICE
# Following all 10 Docker optimization rules
# Monorepo-safe • Render-safe • Prisma-safe
# ==============================================

# 1️⃣ Use a small, fast base image (Alpine-based Bun)
FROM oven/bun:1-alpine AS builder

WORKDIR /app

# 3️⃣ COPY lockfiles BEFORE source code (cache layer)
COPY package.json bun.lock ./

# 5️⃣ Copy ONLY what you need (monorepo package.jsons)
COPY apps/hooks/package.json ./apps/hooks/
COPY packages/db/package.json ./packages/db/
COPY packages/email/package.json ./packages/email/
COPY packages/kafka/package.json ./packages/kafka/
COPY packages/redis/package.json ./packages/redis/
COPY packages/typescript-config/package.json ./packages/typescript-config/

# 4️⃣ Install dependencies in a separate layer (cached)
RUN bun install

# Now copy source code (changes here don't bust dep cache)
COPY packages ./packages
COPY apps/hooks ./apps/hooks

# Generate Prisma client
RUN bunx prisma generate --schema=packages/db/prisma/schema.prisma

# -------------------------------
# 🏗 Build workspace packages
# -------------------------------

# 7️⃣ Build only what's needed

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

# 9️⃣ Skip type-checking - use SWC directly (faster)
RUN bunx swc src -d dist --copy-files

# 🧪 DEBUG: Verify builds in builder
WORKDIR /app
RUN echo "=== Builder: Verify Kafka ===" && ls -la /app/packages/kafka/dist/src/
RUN echo "=== Builder: Verify Email ===" && ls -la /app/packages/email/dist/
RUN echo "=== Builder: Test Kafka require ===" && node -e "require('/app/packages/kafka/dist/src/index.js')" && echo "✅ Kafka OK"


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

# Hooks dist
COPY --from=builder /app/apps/hooks/dist ./dist

# DB package (Prisma client)
COPY --from=builder /app/packages/db ./packages/db

# 🔟 Node modules (includes prod dependencies)
COPY --from=builder /app/node_modules ./node_modules

# ⚠️ FIX: Replace broken symlinks with actual files

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

# 🧪 DEBUG: Verify files in runner
RUN echo "=== Runner: List @repo/kafka ===" && ls -la ./node_modules/@repo/kafka/
RUN echo "=== Runner: List @repo/kafka/dist/src ===" && ls -la ./node_modules/@repo/kafka/dist/src/
RUN echo "=== Runner: List @repo/email ===" && ls -la ./node_modules/@repo/email/dist/
RUN echo "=== Runner: Test Kafka require ===" && node -e "const k = require('./node_modules/@repo/kafka/dist/src/index.js'); console.log('✅ Kafka Works:', typeof k);"

# -------------------------------
# ⚙ Runtime config
# -------------------------------
ENV NODE_ENV=production
ENV PORT=10000

EXPOSE 10000

CMD ["./start.sh"]
