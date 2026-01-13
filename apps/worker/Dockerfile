# Build stage
FROM node:18-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY packages/db/package*.json ./packages/db/
COPY packages/kafka/package*.json ./packages/kafka/
COPY packages/email/package*.json ./packages/email/
COPY apps/worker/package*.json ./apps/worker/

# Install dependencies
RUN npm ci --workspace=packages/db --workspace=packages/kafka --workspace=packages/email --workspace=apps/worker

# Copy source files
COPY packages/db ./packages/db
COPY packages/kafka ./packages/kafka
COPY packages/email ./packages/email
COPY apps/worker ./apps/worker
COPY tsconfig.json ./

# Generate Prisma Client
RUN cd packages/db && npx prisma generate

# Build
RUN cd apps/worker && npm run build

# Production stage
FROM node:18-alpine AS runner

WORKDIR /app

# Copy built files
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/apps/worker ./apps/worker

WORKDIR /app/apps/worker

CMD ["npm", "run", "start"]
