# Build stage
FROM node:18-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY packages/db/package*.json ./packages/db/
COPY packages/kafka/package*.json ./packages/kafka/
COPY apps/processor/package*.json ./apps/processor/

# Install dependencies
RUN npm ci --workspace=packages/db --workspace=packages/kafka --workspace=apps/processor

# Copy source files
COPY packages/db ./packages/db
COPY packages/kafka ./packages/kafka
COPY apps/processor ./apps/processor
COPY tsconfig.json ./

# Generate Prisma Client
RUN cd packages/db && npx prisma generate

# Build
RUN cd apps/processor && npm run build

# Production stage
FROM node:18-alpine AS runner

WORKDIR /app

# Copy built files
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/apps/processor ./apps/processor

WORKDIR /app/apps/processor

CMD ["npm", "run", "start"]
