# ZapMate Project Learnings & Troubleshooting Guide

This document captures the major errors encountered during the development and deployment of ZapMate, along with their solutions. It serves as a learning resource for future developers.

## Table of Contents

1. [CI/CD Pipeline Errors](#1-cicd-pipeline-errors)
2. [ESLint & TypeScript Errors](#2-eslint--typescript-errors)
3. [Next.js Build Errors](#3-nextjs-build-errors)
4. [Deployment Errors](#4-deployment-errors)
5. [Environment Configuration](#5-environment-configuration)

---

## 1. CI/CD Pipeline Errors

### 1.1 Branch Name Mismatch

**Error:**
```
GitHub Actions workflow not triggering on push
```

**Cause:**
The workflow was configured to trigger on `master` branch, but the repository used `main` as the default branch.

**Solution:**
Updated `.github/workflows/deploy.yml`:
```yaml
# Before
on:
  push:
    branches: [master]

# After
on:
  push:
    branches: [main]
```

**Lesson:** Always verify the default branch name when setting up CI/CD.

---

### 1.2 Package Manager Mismatch (npm vs Bun)

**Error:**
```
npm ci
npm ERR! The `npm ci` command can only install with an existing package-lock.json
```

**Cause:**
The project uses Bun (with `bun.lock`) but the CI was configured to use npm.

**Solution:**
Replaced npm setup with Bun:
```yaml
# Before
- uses: actions/setup-node@v4
  with:
    cache: 'npm'
- run: npm ci

# After
- uses: oven-sh/setup-bun@v1
- run: bun install
```

**Lesson:** Match CI package manager with project package manager.

---

## 2. ESLint & TypeScript Errors

### 2.1 React Hooks Order Violation

**Error:**
```
React Hook "useRouter" is called conditionally. React Hooks must be called in 
the exact same order in every component render.
```

**Cause:**
Hooks were placed after conditional return statements:
```tsx
// Wrong
function Page() {
  const session = getSession();
  if (!session) return <Login />;  // Early return BEFORE hooks
  const router = useRouter();      // Hook called conditionally
}
```

**Solution:**
Move all hooks to the top of the component:
```tsx
// Correct
function Page() {
  const router = useRouter();      // Hooks first
  const session = getSession();
  
  useEffect(() => {
    if (!session) router.push('/login');
  }, [session]);
}
```

**Lesson:** Hooks must be called unconditionally at the top of components.

---

### 2.2 ESLint 8 vs ESLint 9 Compatibility

**Error:**
```
TypeError: Converting circular structure to JSON
```

**Cause:**
Next.js 16 requires ESLint 9 with flat config, but the project was using ESLint 8 with `.eslintrc.json`.

**Initial Attempt (Failed):**
Used `FlatCompat` to bridge old config to new format - caused circular reference errors.

**Solution:**
Created new `eslint.config.mjs` with proper flat config:
```javascript
import nextConfig from "@next/eslint-plugin-next";
import tseslint from "@typescript-eslint/eslint-plugin";

export default [
  {
    ignores: [".next/**", "node_modules/**"],
  },
  {
    files: ["**/*.{js,jsx,ts,tsx}"],
    plugins: {
      "@next/next": nextConfig,
      "@typescript-eslint": tseslint,
    },
    // ... rules
  },
];
```

**Lesson:** Major ESLint version upgrades require config format migration.

---

### 2.3 Missing Type Definitions

**Error:**
```
Cannot find module 'minimatch' or its corresponding type declarations
```

**Solution:**
```bash
bun add -D @types/minimatch
```

**Lesson:** TypeScript projects need `@types/*` packages for untyped dependencies.

---

## 3. Next.js Build Errors

### 3.1 useSearchParams Requires Suspense

**Error:**
```
useSearchParams() should be wrapped in a suspense boundary at page "/editor"
```

**Cause:**
Next.js 15+ requires components using `useSearchParams()` to be wrapped in `<Suspense>`.

**Solution:**
```tsx
// Before
export default function Page() {
  const searchParams = useSearchParams();  // Error!
}

// After
function EditorContent() {
  const searchParams = useSearchParams();
  return <div>...</div>;
}

export default function Page() {
  return (
    <Suspense fallback={<Loading />}>
      <EditorContent />
    </Suspense>
  );
}
```

**Lesson:** Streaming features in Next.js require Suspense boundaries.

---

### 3.2 not-found.tsx Component Naming

**Error:**
```
Build error: Component must be a valid React component
```

**Cause:**
The component was named `error` (lowercase) instead of `NotFound` (PascalCase).

**Solution:**
```tsx
// Before
export default function error() { ... }  // Wrong

// After
export default function NotFound() { ... }  // Correct
```

**Lesson:** React components must use PascalCase naming.

---

## 4. Deployment Errors

### 4.1 Vercel Root Directory Not Found

**Error:**
```
The specified Root Directory "apps/web" does not exist
```

**Cause:**
Vercel project settings had `apps/web` as root, AND the workflow used `working-directory: ./apps/web`, causing path doubling.

**Solution:**
Either:
1. Remove `working-directory` from workflow (if Vercel settings already have root)
2. OR set Vercel root directory to empty and use workflow's `working-directory`

Choose one approach, not both.

---

### 4.2 Bun Not Found in Vercel Build

**Error:**
```
Error: spawn bun ENOENT
```

**Cause:**
Vercel detected `bun.lock` and tried to use Bun, but Bun wasn't installed in the workflow.

**Solution:**
Added Bun setup step:
```yaml
- name: Setup Bun
  uses: oven-sh/setup-bun@v1
  with:
    bun-version: latest
```

---

### 4.3 Render Memory Limit (OOM)

**Error:**
```
FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory
```

**Cause:**
TypeScript compiler (`tsc`) consumes too much memory for Render's free tier (512MB).

**Solution:**
Replaced `tsc` with `esbuild` (100x faster, much less memory):
```json
{
  "scripts": {
    "build": "npx esbuild src/index.ts --bundle --platform=node --outfile=dist/index.js --packages=external"
  }
}
```

**Lesson:** esbuild is better for memory-constrained environments.

---

### 4.4 Prisma Client Not Generated

**Error:**
```
@prisma/client did not initialize yet. Please run "prisma generate"
```

**Cause:**
Prisma client needs to be generated during build, not at runtime.

**Solution:**
Added prisma generate to build command:
```bash
bun install && npx prisma generate --schema=packages/db/prisma/schema.prisma
```

---

### 4.5 Monorepo Package Resolution on Render

**Error:**
```
Cannot find module '@repo/email'
```

**Cause:**
When Render's root directory was set to `apps/worker`, it couldn't access sibling packages.

**Solution:**
1. Set Render Root Directory to empty (repo root)
2. Build all packages before the app:
```bash
bun install && cd packages/email && npx tsc && cd ../.. && cd apps/worker && bun run build
```

**Lesson:** Monorepos need whole-repo context for proper package resolution.

---

## 5. Environment Configuration

### 5.1 Frontend Using Hardcoded localhost

**Error:**
```
API calls failing in production - CORS errors, connection refused
```

**Cause:**
Frontend code had hardcoded `http://localhost:5000` instead of environment variables.

**Solution:**
Created centralized config:
```typescript
// lib/config.ts
export const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';
```

Updated all API calls:
```typescript
// Before
axios.get('http://localhost:5000/api/zaps')

// After
axios.get(`${API_URL}/api/zaps`)
```

**Lesson:** Always use environment variables for URLs.

---

## Quick Reference: Common Fixes

| Error | Quick Fix |
|-------|-----------|
| Hooks called conditionally | Move hooks to top of component |
| Missing types | `bun add -D @types/[package]` |
| ESLint 9 circular error | Use native flat config, not FlatCompat |
| Vercel path doubled | Don't use both Vercel settings AND working-directory |
| Render OOM | Use esbuild instead of tsc |
| Prisma not found | Add `prisma generate` to build command |
| Module not found | Check Render root directory setting |

---

## Contributing

If you encounter new errors, please document them following this format:

1. **Error:** The exact error message
2. **Cause:** Why the error occurred
3. **Solution:** How to fix it
4. **Lesson:** What to remember for next time
