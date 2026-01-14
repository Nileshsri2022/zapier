# Build stage
FROM oven/bun:1 AS builder

WORKDIR /app

# Copy package files
COPY package.json bun.lock ./
COPY apps/server/package.json ./apps/server/
COPY packages/db/package.json ./packages/db/
COPY packages/email/package.json ./packages/email/
COPY packages/types/package.json ./packages/types/
COPY packages/typescript-config/package.json ./packages/typescript-config/

# Install dependencies
RUN bun install --frozen-lockfile

# Copy source code
COPY packages ./packages
COPY apps/server ./apps/server

# Generate Prisma client
RUN bunx prisma generate --schema=packages/db/prisma/schema.prisma

# Build email package
WORKDIR /app/packages/email
RUN bun run build

# Build server
WORKDIR /app/apps/server
RUN bun run build

# Production stage
FROM node:20-slim AS runner

WORKDIR /app

# Copy built files
COPY --from=builder /app/apps/server/dist ./dist
COPY --from=builder /app/packages/email/dist ./packages/email/dist
COPY --from=builder /app/packages/email/src/templates ./packages/email/dist/templates
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/db/prisma ./prisma

# Set environment
ENV NODE_ENV=production
ENV PORT=10000

EXPOSE 10000

# Start server
CMD ["node", "dist/src/index.js"]
