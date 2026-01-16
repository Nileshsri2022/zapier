# ==============================================
# OPTIMIZED DOCKERFILE FOR PROCESSOR SERVICE
# Bun runtime • Multi-stage • Production-ready
# ==============================================

FROM oven/bun:1-alpine AS builder

WORKDIR /app

# Copy lockfiles first (cache layer)
COPY package.json bun.lock ./

# Copy workspace package.jsons
COPY apps/processor/package.json ./apps/processor/
COPY packages/db/package.json ./packages/db/
COPY packages/kafka/package.json ./packages/kafka/
COPY packages/redis/package.json ./packages/redis/
COPY packages/typescript-config/package.json ./packages/typescript-config/

# Install dependencies
RUN bun install

# Copy source code
COPY packages ./packages
COPY apps/processor ./apps/processor

# Generate Prisma client
RUN bunx prisma generate --schema=packages/db/prisma/schema.prisma

# Build workspace packages
WORKDIR /app/packages/kafka
RUN bun run build

WORKDIR /app/packages/redis
RUN bun run build

# Build processor service
WORKDIR /app/apps/processor
RUN bunx swc src -d dist --copy-files

# ==============================================
# Production runner (Bun for faster startup)
# ==============================================
FROM oven/bun:1-alpine AS runner

# Prisma requires OpenSSL
RUN apk add --no-cache openssl

WORKDIR /app

# Copy runtime artifacts
COPY --from=builder /app/apps/processor/dist ./dist
COPY --from=builder /app/packages/db ./packages/db
COPY --from=builder /app/node_modules ./node_modules

# Fix workspace symlinks
RUN rm -rf ./node_modules/@repo/kafka 2>/dev/null || true
RUN mkdir -p ./node_modules/@repo/kafka
COPY --from=builder /app/packages/kafka/dist ./node_modules/@repo/kafka/dist
COPY --from=builder /app/packages/kafka/package.json ./node_modules/@repo/kafka/package.json

RUN rm -rf ./node_modules/@repo/redis 2>/dev/null || true
RUN mkdir -p ./node_modules/@repo/redis
COPY --from=builder /app/packages/redis/dist ./node_modules/@repo/redis/dist
COPY --from=builder /app/packages/redis/package.json ./node_modules/@repo/redis/package.json

RUN rm -rf ./node_modules/@repo/db 2>/dev/null || true
RUN mkdir -p ./node_modules/@repo/db
COPY --from=builder /app/packages/db/src ./node_modules/@repo/db/src
COPY --from=builder /app/packages/db/package.json ./node_modules/@repo/db/package.json

# Copy manifests
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/apps/processor/package.json ./apps/processor/package.json

# Copy start script
COPY --from=builder /app/apps/processor/start.sh ./start.sh
RUN chmod +x ./start.sh

# Runtime config
ENV NODE_ENV=production
ENV PORT=10000

EXPOSE 10000

CMD ["./start.sh"]
