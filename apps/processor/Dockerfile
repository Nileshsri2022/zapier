# ==============================================
# DOCKERFILE FOR PROCESSOR SERVICE
# ==============================================

FROM oven/bun:1-alpine AS builder

WORKDIR /app

# Copy everything needed for the build
COPY package.json bun.lock ./
COPY apps/processor/package.json ./apps/processor/
COPY packages/db/package.json ./packages/db/
COPY packages/kafka/package.json ./packages/kafka/
COPY packages/typescript-config/package.json ./packages/typescript-config/

RUN bun install

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
# Production stage - use Bun runtime to keep symlinks working
# ==============================================

FROM oven/bun:1-alpine AS runner

RUN apk add --no-cache openssl

WORKDIR /app

# Copy the entire workspace structure to preserve symlinks
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/bun.lock ./bun.lock
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/apps/processor ./apps/processor

ENV NODE_ENV=production
ENV PORT=10000

WORKDIR /app/apps/processor

RUN chmod +x ./start.sh

EXPOSE 10000

CMD ["./start.sh"]
