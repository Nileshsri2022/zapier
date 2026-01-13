# Deployment Best Practices Implementation Plan

## Problem Summary
Recurring deployment issues:
- ❌ Missing dependencies at runtime
- ❌ Build config differences (local vs production)
- ❌ Environment variable misconfigurations
- ❌ Memory/timeout issues on free tier

---

## Phase 1: Build & Dependency Fixes (Immediate)

### 1.1 Lock SWC Configuration
- [ ] Move `@swc/cli` and `@swc/core` to production dependencies (not devDependencies)
- [ ] Create `.swcrc` with `externalHelpers: false` to inline helpers

### 1.2 Create Dockerfile for Render
- [ ] Use Docker for consistent builds (same environment locally and production)
- [ ] Pre-install all dependencies in image

### 1.3 Add Health Check Endpoint
- [ ] Create `/health` endpoint that verifies DB connection
- [ ] Configure Render to use health check

---

## Phase 2: Environment Management

### 2.1 Environment Variable Validation
- [ ] Create `env.ts` with Zod schema validation
- [ ] Fail fast on startup if required vars missing

### 2.2 Create `.env.production.template`
- [ ] Document all required production variables
- [ ] Add validation in CI/CD

---

## Phase 3: CI/CD Pipeline Improvements

### 3.1 Pre-deploy Checks
- [ ] Run `bun run build` in CI before deploy
- [ ] Run `bun run test` in CI
- [ ] Run `prisma migrate deploy` in CI

### 3.2 Deploy Verification
- [ ] Add post-deploy smoke test
- [ ] Verify `/health` endpoint returns 200

---

## Phase 4: Monitoring & Error Handling

### 4.1 Add Error Logging
- [ ] Integrate Sentry or similar
- [ ] Log all unhandled promise rejections

### 4.2 Add Graceful Shutdown
- [ ] Handle SIGTERM properly
- [ ] Close DB connections before exit

---

## Recommended Render Configuration

```yaml
Build Command:
bun install && bun run build

Start Command:
node apps/server/dist/index.js

Environment Variables:
- DATABASE_URL (required)
- JWT_SECRET (required)
- PORT (set to 10000)
- NODE_ENV=production
```

---

## Priority Order
1. **Phase 1** - Critical (do now)
2. **Phase 4** - Add SIGTERM handler (quick fix)
3. **Phase 2** - Environment validation
4. **Phase 3** - CI/CD improvements
