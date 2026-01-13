# ZapMate Deployment Architecture & Decisions

This document explains the deployment architecture decisions made during ZapMate development, particularly how we adapted to cloud platform limitations.

---

## Platform Selection

### Original Architecture
The original plan was:
- **Vercel** for Next.js frontend
- **Railway** for all backend services (Server, Hooks, Processor, Worker)

### Challenge: Free Tier Limitations
Railway's free tier didn't support all four services. We needed to find alternatives.

### Final Architecture
| Service | Platform | Reason |
|---------|----------|--------|
| Web (Next.js) | Vercel | Best for Next.js, generous free tier |
| Server | Render | Free web service tier |
| Hooks | Render | Free web service tier |
| Processor | Render | Converted from cron to HTTP endpoint |
| Worker | Render | Converted from Kafka consumer to HTTP endpoint |

---

## Key Architectural Changes

### 1. Converting Background Workers to HTTP Endpoints

**Original Design:**
```
Processor: while(true) { pollQueue(); sleep(5000); }
Worker: kafkaConsumer.on('message', process);
```

**Problem:** This requires always-running containers (expensive).

**New Design:**
```
Processor: app.post('/process', authenticate, processOnce);
Worker: app.post('/process', authenticate, processBatch);
```

**Benefits:**
- Can use free web service tier
- Triggered via GitHub Actions cron
- Only runs when needed (cost efficient)

### 2. GitHub Actions as Cron Scheduler

Since Render's free tier doesn't include cron jobs, we use GitHub Actions:

```yaml
# .github/workflows/scheduled-jobs.yml
on:
  schedule:
    - cron: '*/5 * * * *'  # Every 5 minutes

jobs:
  trigger-processor:
    runs-on: ubuntu-latest
    steps:
      - name: Trigger Processor
        run: |
          curl -X POST "${{ secrets.PROCESSOR_URL }}/process" \
            -H "Authorization: Bearer ${{ secrets.CRON_SECRET }}"
```

**Security:** CRON_SECRET prevents unauthorized triggers.

---

## Memory Optimization

### The 512MB Challenge

Render's free tier has 512MB RAM. TypeScript compiler (`tsc`) uses 600MB+.

### Solution: esbuild

| Tool | Memory | Speed | Output Quality |
|------|--------|-------|----------------|
| tsc | 600MB+ | Slow | Type-checked |
| esbuild | 50MB | 100x faster | No type-check |

Since CI/CD already runs type-checking in the lint step, we use esbuild for production builds:

```json
{
  "build": "npx esbuild src/index.ts --bundle --platform=node --outfile=dist/index.js --packages=external"
}
```

The `--packages=external` flag keeps node_modules external (smaller bundle).

---

## Monorepo Deployment Tips

### Problem: Nested Root Directories

Monorepo structure:
```
ZapMate/
├── apps/
│   ├── server/
│   ├── hooks/
│   └── web/
└── packages/
    ├── db/
    └── email/
```

When deploying `apps/server`, it needs access to `packages/db`.

### Wrong Approach
```
Render Root Directory: apps/server
Build Command: bun install && bun run build
→ Error: Cannot find module '@repo/db'
```

### Correct Approach
```
Render Root Directory: (empty - use repo root)
Build Command: bun install && npx prisma generate && cd apps/server && bun run build
Start Command: cd apps/server && bun run start
```

**Lesson:** Always build from repo root for monorepos.

---

## Environment Variable Strategy

### Three Layers of Configuration

1. **GitHub Secrets** - For CI/CD workflows
   - Deploy triggers
   - API keys
   - Service URLs for cron jobs

2. **Platform Environment Variables** - For runtime
   - Vercel: Frontend public vars
   - Render: Backend secrets

3. **Local .env files** - For development
   - Never committed (in .gitignore)
   - Use .env.example as template

### Frontend Variables

Next.js requires `NEXT_PUBLIC_` prefix for browser-exposed variables:

```typescript
// ✅ Works in browser
const API_URL = process.env.NEXT_PUBLIC_API_URL;

// ❌ undefined in browser (only server)
const SECRET = process.env.SECRET_KEY;
```

---

## Deployment Checklist

### Before First Deploy

- [ ] All .env files in .gitignore
- [ ] Created .env.example templates
- [ ] GitHub secrets configured
- [ ] Vercel environment variables set
- [ ] Render environment variables set
- [ ] Database migrated (`prisma migrate deploy`)

### For Each Deploy

- [ ] Push to main branch
- [ ] CI/CD runs automatically
- [ ] Check all jobs pass
- [ ] Verify services are healthy

### After Deploy

- [ ] Test frontend loads
- [ ] Test authentication works
- [ ] Verify scheduled jobs trigger
- [ ] Check logs for errors

---

## Cost Optimization Summary

| Strategy | Savings |
|----------|---------|
| Render free tier (4 services) | ~$28/month |
| GitHub Actions cron (vs dedicated scheduler) | ~$5/month |
| esbuild (faster builds = less minutes) | Build time |
| Neon free tier (vs dedicated Postgres) | ~$10/month |

**Total Monthly Cost: $0** (within free tiers)

---

## Future Considerations

1. **Scaling Up:** When traffic grows, consider:
   - Moving Processor/Worker back to background workers
   - Adding Redis for caching
   - Using dedicated Kafka hosting

2. **Alternative Platforms:**
   - Fly.io (good for always-on workers)
   - Railway (if budget allows)
   - AWS Lambda (for true serverless)

3. **Monitoring:**
   - Add health check endpoints
   - Set up Render notifications
   - Consider LogDNA or similar for centralized logging
