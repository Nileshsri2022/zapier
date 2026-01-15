# ==============================================
# OPTIMIZED DOCKERFILE FOR FAST BUILDS
# ==============================================

# 1️⃣ Use a small, fast base image (Alpine-based Bun)
FROM oven/bun:1-alpine AS builder

WORKDIR /app

# 3️⃣ COPY lockfiles BEFORE source code (cache layer)
COPY package.json bun.lock ./

# 5️⃣ Copy ONLY what you need (monorepo package.jsons)
COPY apps/server/package.json ./apps/server/
COPY packages/db/package.json ./packages/db/
COPY packages/email/package.json ./packages/email/
COPY packages/redis/package.json ./packages/redis/
COPY packages/types/package.json ./packages/types/
COPY packages/typescript-config/package.json ./packages/typescript-config/

# 4️⃣ Install dependencies in a separate layer (cached)
RUN bun install

# Now copy source code (changes here don't bust dep cache)
COPY packages ./packages
COPY apps/server ./apps/server

# Generate Prisma client
RUN bunx prisma generate --schema=packages/db/prisma/schema.prisma

# 7️⃣ Build packages in order (types first, then email)
WORKDIR /app/packages/types
RUN bun run build

WORKDIR /app/packages/email
RUN bun run build

WORKDIR /app/packages/redis
RUN bun run build

WORKDIR /app/apps/server
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
# Server dist
COPY --from=builder /app/apps/server/dist ./dist

# Email package
COPY --from=builder /app/packages/email/dist ./packages/email/dist
COPY --from=builder /app/packages/email/package.json ./packages/email/package.json
COPY --from=builder /app/packages/email/src/templates ./packages/email/dist/templates

# Types package
COPY --from=builder /app/packages/types/dist ./packages/types/dist
COPY --from=builder /app/packages/types/package.json ./packages/types/package.json

# Redis package
COPY --from=builder /app/packages/redis/dist ./packages/redis/dist
COPY --from=builder /app/packages/redis/package.json ./packages/redis/package.json

# DB package
COPY --from=builder /app/packages/db ./packages/db

# Node modules (includes all deps)
COPY --from=builder /app/node_modules ./node_modules

# Root package.json for workspace resolution
COPY --from=builder /app/package.json ./package.json

# Copy start script and server package.json (for seed script)
COPY --from=builder /app/apps/server/start.sh ./start.sh
COPY --from=builder /app/apps/server/package.json ./apps/server/package.json
RUN chmod +x ./start.sh

# Set production environment
ENV NODE_ENV=production
ENV PORT=10000

# Expose port
EXPOSE 10000

# Start server with seeding
CMD ["./start.sh"]
