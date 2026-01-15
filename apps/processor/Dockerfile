# ==============================================
# DOCKERFILE FOR PROCESSOR SERVICE
# Using Bun bundler to inline workspace dependencies
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

# Build processor using Bun bundler (inlines @repo/* imports)
WORKDIR /app/apps/processor
RUN bun build src/index.ts --outdir=dist --target=bun --external=@prisma/client --external=express --external=kafkajs --external=dotenv

# ==============================================
# Production stage
# ==============================================

FROM oven/bun:1-alpine AS runner

RUN apk add --no-cache openssl

WORKDIR /app

# Copy bundled output
COPY --from=builder /app/apps/processor/dist ./dist
COPY --from=builder /app/apps/processor/package.json ./package.json
COPY --from=builder /app/apps/processor/start.sh ./start.sh

# Copy node_modules for external deps (express, kafkajs, etc)
COPY --from=builder /app/node_modules ./node_modules

# Copy Prisma client
COPY --from=builder /app/packages/db/prisma ./prisma

RUN chmod +x ./start.sh

ENV NODE_ENV=production
ENV PORT=10000

EXPOSE 10000

CMD ["./start.sh"]
