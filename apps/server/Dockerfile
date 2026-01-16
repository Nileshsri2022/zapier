# ==============================================
# OPTIMIZED DOCKERFILE FOR SERVER SERVICE
# Bun runtime • Multi-stage • Production-ready
# ==============================================

FROM oven/bun:1-alpine AS builder

WORKDIR /app

# Copy lockfiles first (cache layer)
COPY package.json bun.lock ./

# Copy workspace package.jsons
COPY apps/server/package.json ./apps/server/
COPY packages/db/package.json ./packages/db/
COPY packages/email/package.json ./packages/email/
COPY packages/redis/package.json ./packages/redis/
COPY packages/types/package.json ./packages/types/
COPY packages/typescript-config/package.json ./packages/typescript-config/

# Install dependencies
RUN bun install

# Copy source code
COPY packages ./packages
COPY apps/server ./apps/server

# Generate Prisma client
RUN bunx prisma generate --schema=packages/db/prisma/schema.prisma

# Build workspace packages
WORKDIR /app/packages/types
RUN bun run build

WORKDIR /app/packages/email
RUN bun run build

WORKDIR /app/packages/redis
RUN bun run build

# Build server service
WORKDIR /app/apps/server
RUN bunx swc src -d dist --copy-files

# ==============================================
# Production runner (Bun for faster startup)
# ==============================================
FROM oven/bun:1-alpine AS runner

# Prisma requires OpenSSL
RUN apk add --no-cache openssl

WORKDIR /app

# Copy runtime artifacts
COPY --from=builder /app/apps/server/dist ./dist
COPY --from=builder /app/packages/db ./packages/db
COPY --from=builder /app/node_modules ./node_modules

# Fix workspace symlinks
RUN rm -rf ./node_modules/@repo/types 2>/dev/null || true
RUN mkdir -p ./node_modules/@repo/types
COPY --from=builder /app/packages/types/dist ./node_modules/@repo/types/dist
COPY --from=builder /app/packages/types/package.json ./node_modules/@repo/types/package.json

RUN rm -rf ./node_modules/@repo/email 2>/dev/null || true
RUN mkdir -p ./node_modules/@repo/email
COPY --from=builder /app/packages/email/dist ./node_modules/@repo/email/dist
COPY --from=builder /app/packages/email/package.json ./node_modules/@repo/email/package.json

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
COPY --from=builder /app/apps/server/package.json ./apps/server/package.json

# Copy start script
COPY --from=builder /app/apps/server/start.sh ./start.sh
RUN chmod +x ./start.sh

# Runtime config
ENV NODE_ENV=production
ENV PORT=10000

EXPOSE 10000

CMD ["./start.sh"]
