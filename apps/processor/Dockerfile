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
# Production stage
# ==============================================

FROM oven/bun:1-alpine AS runner

RUN apk add --no-cache openssl

WORKDIR /app

# Copy workspace files for bun install
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/bun.lock ./bun.lock

# Copy all packages (with built dist folders)
COPY --from=builder /app/packages ./packages

# Copy processor app
COPY --from=builder /app/apps/processor ./apps/processor

# Reinstall dependencies to create proper symlinks
RUN bun install

# Regenerate Prisma client for this environment
RUN bunx prisma generate --schema=packages/db/prisma/schema.prisma

ENV NODE_ENV=production
ENV PORT=10000

WORKDIR /app/apps/processor

RUN chmod +x ./start.sh

EXPOSE 10000

CMD ["./start.sh"]
