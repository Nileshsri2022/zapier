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

# -------------------------------
# 🚀 Build processor service
# -------------------------------
WORKDIR /app/apps/processor

# Fast build using SWC (no typecheck)
RUN bunx swc src -d dist --copy-files


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

# Node modules (workspace symlinks will be broken after copy)
COPY --from=builder /app/node_modules ./node_modules

# ⚠️ FIX: Replace broken @repo/kafka symlink with actual built files
# Bun creates symlink: node_modules/@repo/kafka -> ../../packages/kafka
# After Docker COPY, this symlink is broken. We need to replace it with actual files.
RUN rm -rf ./node_modules/@repo/kafka
COPY --from=builder /app/packages/kafka/dist ./node_modules/@repo/kafka/dist
COPY --from=builder /app/packages/kafka/package.json ./node_modules/@repo/kafka/package.json

# Root workspace manifest
COPY --from=builder /app/package.json ./package.json

# Processor manifest
COPY --from=builder /app/apps/processor/package.json ./apps/processor/package.json

# Start script
COPY --from=builder /app/apps/processor/start.sh ./start.sh
RUN chmod +x ./start.sh

# -------------------------------
# ⚙ Runtime config
# -------------------------------
ENV NODE_ENV=production
ENV PORT=10000

EXPOSE 10000

CMD ["./start.sh"]
