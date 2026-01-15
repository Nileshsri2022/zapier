# ==============================================
# OPTIMIZED DOCKERFILE FOR HOOKS SERVICE
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
COPY apps/hooks/package.json ./apps/hooks/
COPY packages/db/package.json ./packages/db/
COPY packages/email/package.json ./packages/email/
COPY packages/kafka/package.json ./packages/kafka/
COPY packages/typescript-config/package.json ./packages/typescript-config/

# Install deps (cached)
RUN bun install

# Copy source code
COPY packages ./packages
COPY apps/hooks ./apps/hooks

# Generate Prisma client
RUN bunx prisma generate --schema=packages/db/prisma/schema.prisma

# -------------------------------
# 🏗 Build workspace packages
# -------------------------------

# Email package
WORKDIR /app/packages/email
RUN bun run build

# Kafka package (FIXED ✅)
WORKDIR /app/packages/kafka
RUN bun run build

# -------------------------------
# 🚀 Build hooks service
# -------------------------------
WORKDIR /app/apps/hooks

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
# � Copy runtime artifacts
# -------------------------------

# Hooks dist
COPY --from=builder /app/apps/hooks/dist ./dist

# Email package
COPY --from=builder /app/packages/email/dist ./packages/email/dist
COPY --from=builder /app/packages/email/package.json ./packages/email/package.json
COPY --from=builder /app/packages/email/src/templates ./packages/email/dist/templates

# Kafka package (built dist ✅)
COPY --from=builder /app/packages/kafka/dist ./packages/kafka/dist
COPY --from=builder /app/packages/kafka/package.json ./packages/kafka/package.json

# DB package (Prisma client)
COPY --from=builder /app/packages/db ./packages/db

# Node modules (workspace symlinks intact)
COPY --from=builder /app/node_modules ./node_modules

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
