# ==============================================
# DOCKERFILE FOR PROCESSOR SERVICE
# ==============================================

FROM oven/bun:1-alpine AS builder

WORKDIR /app

# Copy everything needed for the build
COPY package.json bun.lock ./
COPY apps/processor/package.json ./apps/processor/
COPY packages/db/package.json ./packages/db/
COPY packages/typescript-config/package.json ./packages/typescript-config/

RUN bun install

COPY packages ./packages
COPY apps/processor ./apps/processor

# Generate Prisma client
RUN bunx prisma generate --schema=packages/db/prisma/schema.prisma

# Build processor using SWC (no more @repo/kafka dependency!)
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

# Copy node_modules
COPY --from=builder /app/node_modules ./node_modules

# Copy DB package for Prisma
COPY --from=builder /app/packages/db ./packages/db

RUN chmod +x ./start.sh

ENV NODE_ENV=production
ENV PORT=10000

EXPOSE 10000

CMD ["./start.sh"]
