# ==============================================
# OPTIMIZED DOCKERFILE FOR HOOKS SERVICE
# Following all 10 Docker optimization rules
# ==============================================

# 1️⃣ Use a small, fast base image (Alpine-based Bun)
FROM oven/bun:1-alpine AS builder

WORKDIR /app

# 3️⃣ COPY lockfiles BEFORE source code (cache layer)
COPY package.json bun.lock ./

# 5️⃣ Copy ONLY what you need (monorepo package.jsons)
COPY apps/hooks/package.json ./apps/hooks/
COPY packages/db/package.json ./packages/db/
COPY packages/email/package.json ./packages/email/
COPY packages/kafka/package.json ./packages/kafka/
COPY packages/typescript-config/package.json ./packages/typescript-config/

# 4️⃣ Install dependencies in a separate layer (cached)
RUN bun install

# Now copy source code (changes here don't bust dep cache)
COPY packages ./packages
COPY apps/hooks ./apps/hooks

# Generate Prisma client (hooks uses @repo/db)
RUN bunx prisma generate --schema=packages/db/prisma/schema.prisma

# 7️⃣ Build packages in order (dependencies first)
# Build email package (hooks uses @repo/email)
WORKDIR /app/packages/email
RUN bun run build

# Build hooks service
WORKDIR /app/apps/hooks
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

# Hooks dist
COPY --from=builder /app/apps/hooks/dist ./dist

# Email package (with templates)
COPY --from=builder /app/packages/email/dist ./packages/email/dist
COPY --from=builder /app/packages/email/package.json ./packages/email/package.json
COPY --from=builder /app/packages/email/src/templates ./packages/email/dist/templates

# Kafka package (for future use)
COPY --from=builder /app/packages/kafka/src ./packages/kafka/src
COPY --from=builder /app/packages/kafka/package.json ./packages/kafka/package.json

# DB package (Prisma client)
COPY --from=builder /app/packages/db ./packages/db

# Node modules (includes all deps)
COPY --from=builder /app/node_modules ./node_modules

# Root package.json for workspace resolution
COPY --from=builder /app/package.json ./package.json

# Hooks package.json
COPY --from=builder /app/apps/hooks/package.json ./apps/hooks/package.json

# Copy start script
COPY --from=builder /app/apps/hooks/start.sh ./start.sh
RUN chmod +x ./start.sh

# Set production environment
ENV NODE_ENV=production
ENV PORT=10000

# Expose port (Render uses 10000 by default)
EXPOSE 10000

# Start hooks service
CMD ["./start.sh"]
