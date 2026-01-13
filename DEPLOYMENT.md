# ZapMate Deployment Guide

Deploy all ZapMate services using Render.com, Railway, and supporting infrastructure.

## 🚀 CI/CD Pipeline

This project uses **GitHub Actions** for automated deployments. On push to `main`:

| Service | Platform | Trigger |
|---------|----------|---------|
| Web | Vercel | Auto (Vercel integration) |
| Server | Render | GitHub Action |
| Hooks | Render | GitHub Action |
| Processor | Railway | GitHub Action |
| Worker | Railway | GitHub Action |

### Required GitHub Secrets

Add these in: Settings → Secrets → Actions

```
# Vercel
VERCEL_TOKEN=xxx
VERCEL_ORG_ID=xxx
VERCEL_PROJECT_ID=xxx

# Render
RENDER_API_KEY=xxx
RENDER_SERVER_SERVICE_ID=srv-xxx
RENDER_HOOKS_SERVICE_ID=srv-xxx

# Railway
RAILWAY_TOKEN=xxx
```

---

## 🗺️ Deployment Architecture

```mermaid
graph TB
    subgraph "Vercel (Free)"
        Web[Next.js Frontend]
    end
    
    subgraph "Render.com"
        Server[API Server :5000]
        Hooks[Webhook Handler :8000]
        Processor[Event Processor]
        Worker[Action Worker]
    end
    
    subgraph "External Services"
        DB[(Neon PostgreSQL)]
        Kafka[Upstash Kafka]
    end
    
    Web --> Server
    ExternalServices[External Webhooks] --> Hooks
    Hooks --> DB
    Server --> DB
    Hooks --> Kafka
    Processor --> DB
    Processor --> Kafka
    Worker --> DB
    Worker --> Kafka
```

---

## 📋 Prerequisites

1. GitHub account (to connect repos)
2. Render account: [render.com](https://render.com)
3. Vercel account: [vercel.com](https://vercel.com) 
4. Neon account: [neon.tech](https://neon.tech) (for PostgreSQL)
5. Upstash account: [upstash.com](https://upstash.com) (for Kafka)

---

## Step 1: Database Setup (Neon)

1. Go to [neon.tech](https://neon.tech) and create a project
2. Create a database named `zapmate`
3. Copy the connection string:
   ```
   postgresql://user:password@ep-xxx.us-east-1.aws.neon.tech/zapmate?sslmode=require
   ```
4. Run migrations:
   ```bash
   # Locally, set DATABASE_URL and run:
   cd packages/db
   npx prisma migrate deploy
   ```

---

## Step 2: Kafka Setup (Upstash)

1. Go to [console.upstash.com](https://console.upstash.com)
2. Create a Kafka cluster
3. Create a topic named `zap-events`
4. Copy your credentials:
   - `KAFKA_BROKER` (e.g., `xxx.upstash.io:9092`)
   - `KAFKA_USERNAME`
   - `KAFKA_PASSWORD`

---

## Step 3: Deploy Frontend (Vercel)

1. Go to [vercel.com](https://vercel.com) → New Project
2. Import your GitHub repo
3. Configure:
   - **Root Directory**: `apps/web`
   - **Framework Preset**: Next.js
4. Add environment variables:
   ```
   NEXT_PUBLIC_API_URL=https://your-server.onrender.com
   ```
5. Deploy!

---

## Step 4: Deploy Backend Services (Render)

### 4.1 API Server

1. Render Dashboard → New → Web Service
2. Connect your GitHub repo
3. Configure:

| Setting | Value |
|---------|-------|
| **Name** | `zapmate-server` |
| **Root Directory** | (leave empty - use root) |
| **Build Command** | `npm install && cd packages/db && npx prisma generate && cd ../../apps/server && npm run build` |
| **Start Command** | `cd apps/server && npm run start` |
| **Environment** | Node |

4. Add environment variables:
   ```
   DATABASE_URL=postgresql://...
   JWT_SECRET=your-secret-key
   SMTP_HOST=smtp.gmail.com
   SMTP_USER=your-email
   SMTP_PASSWORD=your-app-password
   SENDER_EMAIL=your-email
   GMAIL_CLIENT_ID=...
   GMAIL_CLIENT_SECRET=...
   FRONTEND_URL=https://your-app.vercel.app
   ```

---

### 4.2 Hooks Service

1. Render Dashboard → New → Web Service
2. Configure:

| Setting | Value |
|---------|-------|
| **Name** | `zapmate-hooks` |
| **Root Directory** | (leave empty) |
| **Build Command** | `npm install && cd packages/db && npx prisma generate` |
| **Start Command** | `cd apps/hooks && npm run start` |

3. Environment variables:
   ```
   DATABASE_URL=postgresql://...
   ```

> **Your webhook URL**: `https://zapmate-hooks.onrender.com/hooks/{userId}/{zapId}`

---

### 4.3 Processor Service (Background Worker)

1. Render Dashboard → New → **Background Worker**
2. Configure:

| Setting | Value |
|---------|-------|
| **Name** | `zapmate-processor` |
| **Build Command** | `npm install && cd packages/db && npx prisma generate` |
| **Start Command** | `cd apps/processor && npm run start` |

3. Environment variables:
   ```
   DATABASE_URL=postgresql://...
   KAFKA_BROKER=xxx.upstash.io:9092
   KAFKA_USERNAME=...
   KAFKA_PASSWORD=...
   ```

---

### 4.4 Worker Service (Background Worker)

1. Render Dashboard → New → **Background Worker**
2. Configure:

| Setting | Value |
|---------|-------|
| **Name** | `zapmate-worker` |
| **Build Command** | `npm install && cd packages/db && npx prisma generate && cd ../../packages/email && npm install` |
| **Start Command** | `cd apps/worker && npm run start` |

3. Environment variables:
   ```
   DATABASE_URL=postgresql://...
   KAFKA_BROKER=xxx.upstash.io:9092
   KAFKA_USERNAME=...
   KAFKA_PASSWORD=...
   SMTP_HOST=smtp.gmail.com
   SMTP_USER=your-email
   SMTP_PASSWORD=your-app-password
   SENDER_EMAIL=your-email
   ```

---

## Step 5: Update Kafka Configuration

The current Kafka config uses local connection. Update `packages/kafka/src/index.ts` for Upstash:

```typescript
import { Kafka } from 'kafkajs';

const kafka = new Kafka({
  brokers: [process.env.KAFKA_BROKER!],
  sasl: {
    mechanism: 'scram-sha-256',
    username: process.env.KAFKA_USERNAME!,
    password: process.env.KAFKA_PASSWORD!,
  },
  ssl: true,
});

export default kafka;
```

---

## 📊 Cost Estimate

| Service | Provider | Cost |
|---------|----------|------|
| Frontend | Vercel | **Free** |
| Database | Neon | **Free** (0.5GB) |
| Kafka | Upstash | **Free** (10K msgs/day) |
| API Server | Render | **Free** (sleeps) / $7/mo |
| Hooks | Render | **Free** (sleeps) / $7/mo |
| Processor | Render | $7/mo (background worker) |
| Worker | Render | $7/mo (background worker) |

**Total**: ~$14-28/month for always-on services

---

## 🔗 Final URLs

After deployment, update your frontend with:

```env
# apps/web/.env.production
NEXT_PUBLIC_API_URL=https://zapmate-server.onrender.com
NEXT_PUBLIC_HOOKS_URL=https://zapmate-hooks.onrender.com
```

---

## ✅ Deployment Checklist

- [ ] Database created on Neon
- [ ] Migrations run successfully
- [ ] Kafka cluster created on Upstash
- [ ] Topic `zap-events` created
- [ ] Frontend deployed to Vercel
- [ ] Server deployed to Render
- [ ] Hooks service deployed to Render
- [ ] Processor deployed as background worker
- [ ] Worker deployed as background worker
- [ ] All environment variables configured
- [ ] Test webhook URL works
- [ ] Test login/signup works
