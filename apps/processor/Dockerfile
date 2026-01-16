# ==============================================
# OPTIMIZED DOCKERFILE FOR PROCESSOR SERVICE
# Monorepo-safe • Render-safe • Prisma-safe
# ==============================================

# -------------------------------
# 🧱 Builder stage
# -------------------------------
FROM oven/bun:1-alpine AS builder

WORKDIR /app

# Copy root manifests first (cache)
COPY package.json bun.lock ./

# Copy workspace package.json files only
COPY apps/processor/package.json ./apps/processor/
COPY packages/db/package.json ./packages/db/
COPY packages/kafka/package.json ./packages/kafka/
COPY packages/redis/package.json ./packages/redis/
COPY packages/typescript-config/package.json ./packages/typescript-config/

# Install deps (cached)
RUN bun install

# Copy source code
COPY packages ./packages
COPY apps/processor ./apps/processor

# Generate Prisma client
RUN bunx prisma generate --schema=packages/db/prisma/schema.prisma

# -------------------------------
# 🏗 Build workspace packages
# -------------------------------

# Kafka package (REQUIRED ✅)
WORKDIR /app/packages/kafka
RUN bun run build

# Redis package (REQUIRED for Google Sheets polling ✅)
WORKDIR /app/packages/redis
RUN bun run build

# -------------------------------
# 🚀 Build processor service
# -------------------------------
WORKDIR /app/apps/processor

# Fast build using SWC (no typecheck)
RUN bunx swc src -d dist --copy-files

# 🧪 Safety net: verify Kafka package loads correctly
WORKDIR /app
RUN node -e "require('/app/packages/kafka/dist/index.js')" && echo "✅ Kafka package loads correctly"


# ==============================================
# 🚦 Production runner stage
# ==============================================
FROM node:20-alpine AS runner

# Prisma requires OpenSSL
RUN apk add --no-cache openssl

WORKDIR /app

# -------------------------------
# 📦 Copy runtime artifacts
# -------------------------------

# Processor dist
COPY --from=builder /app/apps/processor/dist ./dist

# DB package (Prisma client)
COPY --from=builder /app/packages/db ./packages/db

# Node modules (symlinks will be broken)
COPY --from=builder /app/node_modules ./node_modules

# ⚠️ FIX: The symlink node_modules/@repo/kafka -> ../../packages/kafka is BROKEN after Docker COPY
# We need to replace it with actual files
RUN rm -rf ./node_modules/@repo/kafka 2>/dev/null || true
RUN mkdir -p ./node_modules/@repo/kafka
COPY --from=builder /app/packages/kafka/dist ./node_modules/@repo/kafka/dist
COPY --from=builder /app/packages/kafka/package.json ./node_modules/@repo/kafka/package.json

# Also fix @repo/db symlink
RUN rm -rf ./node_modules/@repo/db 2>/dev/null || true
RUN mkdir -p ./node_modules/@repo/db
COPY --from=builder /app/packages/db/src ./node_modules/@repo/db/src
COPY --from=builder /app/packages/db/package.json ./node_modules/@repo/db/package.json

# Also fix @repo/redis symlink
RUN rm -rf ./node_modules/@repo/redis 2>/dev/null || true
RUN mkdir -p ./node_modules/@repo/redis
COPY --from=builder /app/packages/redis/dist ./node_modules/@repo/redis/dist
COPY --from=builder /app/packages/redis/package.json ./node_modules/@repo/redis/package.json

# Root workspace manifest
COPY --from=builder /app/package.json ./package.json

# Processor manifest
COPY --from=builder /app/apps/processor/package.json ./apps/processor/package.json

# Start script
COPY --from=builder /app/apps/processor/start.sh ./start.sh
RUN chmod +x ./start.sh

# 🧪 DEBUG: Verify Kafka files exist in runner
RUN echo "=== Step 1: List @repo/kafka ===" && ls -la ./node_modules/@repo/kafka/
RUN echo "=== Step 2: List @repo/kafka/dist ===" && ls -la ./node_modules/@repo/kafka/dist/
RUN echo "=== Step 3: Cat package.json ===" && cat ./node_modules/@repo/kafka/package.json
RUN echo "=== Step 4: Check kafkajs exists ===" && ls -la ./node_modules/kafkajs/
RUN echo "=== Step 5: Test require ===" && node -e "const k = require('./node_modules/@repo/kafka/dist/src/index.js'); console.log('✅ Works:', typeof k);"

# -------------------------------
# ⚙ Runtime config
# -------------------------------
ENV NODE_ENV=production
ENV PORT=10000

EXPOSE 10000

CMD ["./start.sh"]
