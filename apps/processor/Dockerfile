# ==============================================
# OPTIMIZED DOCKERFILE FOR PROCESSOR SERVICE
# Following all 10 Docker optimization rules
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

# 7️⃣ Build packages in order (kafka first, then processor)
WORKDIR /app/packages/kafka
RUN bun run build

# Build processor service
WORKDIR /app/apps/processor
# 9️⃣ Skip type-checking - use SWC directly (faster)
RUN bunx swc src -d dist --copy-files

# ==============================================
# 6️⃣ Multi-stage build (production stage)
# ==============================================

# 1️⃣ Use small production image
FROM node:20-alpine AS runner

# Install OpenSSL for Prisma
RUN apk add --no-cache openssl

WORKDIR /app

# 🔟 Copy production files - include all required packages with package.json

# Processor dist
COPY --from=builder /app/apps/processor/dist ./dist

# Kafka package
COPY --from=builder /app/packages/kafka/dist ./packages/kafka/dist
COPY --from=builder /app/packages/kafka/package.json ./packages/kafka/package.json

# DB package (Prisma client)
COPY --from=builder /app/packages/db ./packages/db

# Node modules (includes all deps)
COPY --from=builder /app/node_modules ./node_modules

# Root package.json for workspace resolution
COPY --from=builder /app/package.json ./package.json

# Processor package.json
COPY --from=builder /app/apps/processor/package.json ./apps/processor/package.json

# Copy start script
COPY --from=builder /app/apps/processor/start.sh ./start.sh
RUN chmod +x ./start.sh

# Set production environment
ENV NODE_ENV=production
ENV PORT=10000

# Expose port (Render uses 10000 by default)
EXPOSE 10000

# Start processor service
CMD ["./start.sh"]
