# ==============================================
# OPTIMIZED DOCKERFILE FOR PROCESSOR SERVICE
# ==============================================

FROM oven/bun:1-alpine AS builder

WORKDIR /app

# Copy lockfiles
COPY package.json bun.lock ./

# Copy package.jsons for workspace resolution
COPY apps/processor/package.json ./apps/processor/
COPY packages/db/package.json ./packages/db/
COPY packages/kafka/package.json ./packages/kafka/
COPY packages/typescript-config/package.json ./packages/typescript-config/

# Install dependencies
RUN bun install

# Copy source code
COPY packages ./packages
COPY apps/processor ./apps/processor

# Generate Prisma client
RUN bunx prisma generate --schema=packages/db/prisma/schema.prisma

# Build Kafka package
WORKDIR /app/packages/kafka
RUN bun run build

# Build processor service
WORKDIR /app/apps/processor
RUN bunx swc src -d dist --copy-files

# ==============================================
# Production stage
# ==============================================

FROM node:20-alpine AS runner

RUN apk add --no-cache openssl

WORKDIR /app

# Copy processor dist
COPY --from=builder /app/apps/processor/dist ./dist
COPY --from=builder /app/apps/processor/package.json ./package.json
COPY --from=builder /app/apps/processor/start.sh ./start.sh

# Copy DB package (for Prisma)
COPY --from=builder /app/packages/db ./packages/db

# Copy node_modules (external deps only, symlinks will be broken)
COPY --from=builder /app/node_modules ./node_modules

# FIX: Manually create @repo/kafka in node_modules with compiled code
# This replaces the broken symlink
RUN rm -rf ./node_modules/@repo/kafka 2>/dev/null || true
RUN mkdir -p ./node_modules/@repo/kafka
COPY --from=builder /app/packages/kafka/dist ./node_modules/@repo/kafka/dist
COPY --from=builder /app/packages/kafka/package.json ./node_modules/@repo/kafka/package.json

# FIX: Also fix @repo/db symlink
RUN rm -rf ./node_modules/@repo/db 2>/dev/null || true
RUN mkdir -p ./node_modules/@repo/db
COPY --from=builder /app/packages/db/src ./node_modules/@repo/db/src
COPY --from=builder /app/packages/db/package.json ./node_modules/@repo/db/package.json
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma

RUN chmod +x ./start.sh

ENV NODE_ENV=production
ENV PORT=10000

EXPOSE 10000

CMD ["./start.sh"]
