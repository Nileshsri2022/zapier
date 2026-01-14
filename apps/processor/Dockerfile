# ==============================================
# OPTIMIZED DOCKERFILE FOR PROCESSOR SERVICE
# ==============================================

# 1️⃣ Use a small, fast base image (Alpine-based Bun)
FROM oven/bun:1-alpine AS builder

WORKDIR /app

# 3️⃣ COPY lockfiles BEFORE source code (cache layer)
COPY package.json bun.lock ./

# 5️⃣ Copy ONLY what you need (monorepo package.jsons)
COPY apps/processor/package.json ./apps/processor/
COPY packages/db/package.json ./packages/db/
COPY packages/kafka/package.json ./packages/kafka/
COPY packages/typescript-config/package.json ./packages/typescript-config/

# 4️⃣ Install dependencies in a separate layer (cached)
RUN bun install

# Now copy source code (changes here don't bust dep cache)
COPY packages ./packages
COPY apps/processor ./apps/processor

# Generate Prisma client
RUN bunx prisma generate --schema=packages/db/prisma/schema.prisma

# 7️⃣ Build Kafka package first
WORKDIR /app/packages/kafka
RUN bun run build

# Build processor service
WORKDIR /app/apps/processor
RUN bunx swc src -d dist --copy-files

# ==============================================
# 6️⃣ Multi-stage build (production stage)
# ==============================================

FROM node:20-alpine AS runner

# Install OpenSSL for Prisma
RUN apk add --no-cache openssl

WORKDIR /app

# Copy everything from builder (simpler approach)
COPY --from=builder /app/apps/processor/dist ./apps/processor/dist
COPY --from=builder /app/apps/processor/package.json ./apps/processor/package.json
COPY --from=builder /app/apps/processor/start.sh ./apps/processor/start.sh

# Kafka package with dist
COPY --from=builder /app/packages/kafka ./packages/kafka

# DB package (Prisma client)
COPY --from=builder /app/packages/db ./packages/db

# Typescript config
COPY --from=builder /app/packages/typescript-config ./packages/typescript-config

# Node modules (includes all deps)
COPY --from=builder /app/node_modules ./node_modules

# Root package.json
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/bun.lock ./bun.lock

# Make start script executable
RUN chmod +x ./apps/processor/start.sh

# Set production environment
ENV NODE_ENV=production
ENV PORT=10000

WORKDIR /app/apps/processor

EXPOSE 10000

CMD ["./start.sh"]
