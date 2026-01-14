# Critical Bugs & Fixes - ZapMate Deployment Session

This document captures all critical bugs encountered and fixed during the Render deployment troubleshooting session on 2026-01-14.

---

## Table of Contents
1. [Signup Returns 404 but User Created](#1-signup-returns-404-but-user-created)
2. [SWC Build Output Path Mismatch](#2-swc-build-output-path-mismatch)
3. [Email Sending Fails on Render (SMTP Blocked)](#3-email-sending-fails-on-render-smtp-blocked)
4. [Docker: Module Not Found Errors](#4-docker-module-not-found-errors)
5. [Prisma Binary Target Missing](#5-prisma-binary-target-missing)
6. [No Triggers Available (Database Not Seeded)](#6-no-triggers-available-database-not-seeded)
7. [Webhook URL Shows Localhost in Production](#7-webhook-url-shows-localhost-in-production)
8. [My Profile Button Not Working](#8-my-profile-button-not-working)
9. [@repo/types Not Found on Vercel](#9-repotypes-not-found-on-vercel)

---

## 1. Signup Returns 404 but User Created

### Symptoms
- POST to `/api/auth/signup` returns 404
- But user record was created in database
- Very confusing behavior

### Root Cause
The `sendEmail()` call after user creation was **not wrapped in try-catch**. When email sending failed (no SMTP configured), the error was unhandled and Express returned a generic error.

### Fix
```typescript
// apps/server/src/controllers/AuthController.ts
try {
    await sendEmail(email, subject, "signup-confirmation.html");
} catch (emailError) {
    console.error("Failed to send welcome email:", emailError);
    // Continue anyway - user is already created
}
```

### Lesson
**Always wrap external service calls (email, SMS, etc.) in try-catch** to prevent them from breaking the main flow.

---

## 2. SWC Build Output Path Mismatch

### Symptoms
```
Error: Cannot find module '/opt/render/project/src/apps/server/dist/index.js'
```

### Root Cause
SWC outputs to `dist/src/index.js` not `dist/index.js`. The start script pointed to wrong path.

### Fix
```json
// apps/server/package.json
"start": "node dist/src/index.js"  // Changed from "node dist/index.js"
```

### Lesson
**Verify build tool output structure** before configuring start scripts. Different tools (tsc, esbuild, swc) have different output structures.

---

## 3. Email Sending Fails on Render (SMTP Blocked)

### Symptoms
```
Error: Connection timeout
code: 'ETIMEDOUT'
command: 'CONN'
```

### Root Cause
**Render's free tier blocks SMTP ports (587/465)**. Nodemailer cannot connect to Gmail SMTP.

### Fix
Switched from **Nodemailer (SMTP)** to **Resend (HTTP API)**:

```typescript
// packages/email/src/index.ts
import { Resend } from "resend";
const resend = new Resend(process.env.RESEND_API_KEY);

export const sendEmail = async (to, subject, templateName) => {
    const { data, error } = await resend.emails.send({
        from: fromEmail,
        to: [to],
        subject,
        html: htmlContent
    });
};
```

### Environment Variables Changed
| Old (Nodemailer) | New (Resend) |
|------------------|--------------|
| `SMTP_HOST` | ❌ Remove |
| `SMTP_USER` | ❌ Remove |
| `SMTP_PASSWORD` | ❌ Remove |
| - | `RESEND_API_KEY` |
| `SENDER_EMAIL` | `SENDER_EMAIL` |

### Lesson
**Use HTTP-based email services (Resend, SendGrid) on PaaS platforms** as they often block SMTP ports.

---

## 4. Docker: Module Not Found Errors

### Symptoms (in sequence)
1. `Cannot find module '@repo/types'`
2. `Cannot find module '@repo/email'`
3. `SyntaxError: Unexpected identifier 'TSignup'` (TypeScript in Node)

### Root Causes
1. **Types package wasn't built** - exported raw TypeScript
2. **Package.json files not copied** - Node couldn't resolve workspace packages
3. **Types had no build script** - exported `.ts` instead of `.js`

### Fixes

**Added build script to types package:**
```json
// packages/types/package.json
{
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": { "build": "tsc" },
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    }
  }
}
```

**Updated Dockerfile to copy all package.json files:**
```dockerfile
# Copy package.json for workspace resolution
COPY --from=builder /app/packages/email/package.json ./packages/email/package.json
COPY --from=builder /app/packages/types/package.json ./packages/types/package.json
COPY --from=builder /app/package.json ./package.json
```

**Added build steps in correct order:**
```dockerfile
# Build types first, then email
WORKDIR /app/packages/types
RUN bun run build

WORKDIR /app/packages/email
RUN bun run build
```

### Lesson
**Monorepo Docker builds require:**
1. All workspace packages to have build scripts
2. All package.json files copied for resolution
3. Correct build order (dependencies first)

---

## 5. Prisma Binary Target Missing

### Symptoms
```
PrismaClientInitializationError: Prisma Client could not locate the Query Engine for runtime "linux-musl-openssl-3.0.x"
```

### Root Cause
Prisma was generated for Alpine Linux in builder stage, but runner stage had different OpenSSL version.

### Fix
**Added binary target to schema.prisma:**
```prisma
generator client {
  provider      = "prisma-client-js"
  binaryTargets = ["native", "linux-musl-openssl-3.0.x"]
}
```

**Added OpenSSL to runner stage:**
```dockerfile
FROM node:20-alpine AS runner
RUN apk add --no-cache openssl
```

### Lesson
**When using Alpine Linux, always specify Prisma binary targets** and install required system dependencies.

---

## 6. No Triggers Available (Database Not Seeded)

### Symptoms
- UI shows "No triggers available"
- Database empty on production

### Root Cause
Seed script was never run on production database.

### Fix
**Added auto-seeding to Docker startup:**
```bash
# apps/server/start.sh
#!/bin/sh
set -e
echo "🌱 Checking if database needs seeding..."
node dist/src/seed.js 2>/dev/null || echo "⚠️ Already seeded"
echo "🚀 Starting server..."
exec node dist/src/index.js
```

**Updated Dockerfile:**
```dockerfile
COPY --from=builder /app/apps/server/start.sh ./start.sh
RUN chmod +x ./start.sh
CMD ["./start.sh"]
```

**Seed script uses skipDuplicates:**
```typescript
await client.availableTriggers.createMany({
    data: [...],
    skipDuplicates: true  // Safe to run multiple times
});
```

### Lesson
**Production seeding should be:**
1. Automatic (part of deploy/startup)
2. Idempotent (safe to run multiple times)
3. Use `skipDuplicates` or upsert patterns

---

## 7. Webhook URL Shows Localhost in Production

### Symptoms
Webhook URL displayed as `http://localhost:8000/hooks/...` instead of production URL.

### Root Cause
Hardcoded localhost in dashboard component:
```typescript
const url = `http://localhost:8000/hooks/${userId}/${zap.id}`;
```

### Fix
**Used config import:**
```typescript
import { API_URL, HOOKS_URL } from '@/lib/config';
// ...
const url = `${HOOKS_URL}/hooks/${userId}/${zap.id}`;
```

**Config file already had environment variable:**
```typescript
export const HOOKS_URL = process.env.NEXT_PUBLIC_HOOKS_URL || 'http://localhost:8000';
```

### Lesson
**Never hardcode URLs in components.** Always use centralized config with environment variable fallbacks.

---

## 8. My Profile Button Not Working

### Symptoms
Clicking "My Profile" in dropdown does nothing.

### Root Cause
Missing `onClick` handler on the div:
```tsx
<div className='...' >My Profile</div>  // No onClick!
```

### Fix
**Added navigation:**
```tsx
<div className='...' onClick={() => {
    setDropdownVisible(false);
    router.push("/profile");
}}>My Profile</div>
```

**Created profile page and /me endpoint:**
- `apps/web/app/profile/page.tsx`
- `GET /api/auth/me` endpoint

### Lesson
**Always verify interactive elements have handlers.** Use TypeScript to catch missing required props.

---

## 9. @repo/types Not Found on Vercel

### Symptoms
```
Type error: Cannot find module '@repo/types' or its corresponding type declarations.
```

### Root Cause
- `dist` folder is in `.gitignore`
- Turbo cache was stale and didn't rebuild types

### Fix
**Added `dist/**` to turbo outputs:**
```json
// turbo.json
{
  "tasks": {
    "build": {
      "outputs": [".next/**", "!.next/cache/**", "dist/**"]
    }
  }
}
```

### Lesson
**Turbo cache needs output configuration** for internal packages. Add `dist/**` to capture build outputs.

---

## Summary: Key Deployment Learnings

| Category | Learning |
|----------|----------|
| **Error Handling** | Wrap external services in try-catch |
| **Build Tools** | Verify output paths match start scripts |
| **Email** | Use HTTP-based services on PaaS |
| **Docker/Monorepo** | Copy all package.json, build in dependency order |
| **Prisma** | Specify binaryTargets for Alpine |
| **Database** | Auto-seed with idempotent scripts |
| **Config** | Never hardcode URLs |
| **UI** | Verify all interactive elements have handlers |
| **Turbo** | Configure outputs for internal packages |

---

*Created: 2026-01-14*
*Session: Render Deployment Troubleshooting*
