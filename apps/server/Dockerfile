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
COPY packages/types/package.json ./packages/types/
COPY packages/typescript-config/package.json ./packages/typescript-config/

# 4️⃣ Install dependencies in a separate layer (cached)
RUN bun install

# Now copy source code (changes here don't bust dep cache)
COPY packages ./packages
COPY apps/server ./apps/server

# Generate Prisma client
RUN bunx prisma generate --schema=packages/db/prisma/schema.prisma

# 7️⃣ Build email package (types exports TS directly - no build needed)
WORKDIR /app/packages/email
RUN bun run build

WORKDIR /app/apps/server
# 9️⃣ Skip type-checking - use SWC directly (faster)
RUN bunx swc src -d dist --copy-files

# ==============================================
# 6️⃣ Multi-stage build (production stage)
# ==============================================

# 1️⃣ Use small production image
FROM node:20-alpine AS runner

WORKDIR /app

# 🔟 Copy production files - include all required packages
COPY --from=builder /app/apps/server/dist ./dist
COPY --from=builder /app/packages/email/dist ./packages/email/dist
COPY --from=builder /app/packages/types/src ./packages/types/src
COPY --from=builder /app/packages/types/package.json ./packages/types/package.json
COPY --from=builder /app/packages/db ./packages/db
COPY --from=builder /app/node_modules ./node_modules

# Copy templates for email
COPY --from=builder /app/packages/email/src/templates ./packages/email/dist/templates

# Set production environment
ENV NODE_ENV=production
ENV PORT=10000

# Expose port
EXPOSE 10000

# Start server
CMD ["node", "dist/src/index.js"]
