# Critical Bug: @repo/kafka Module Not Found in Docker

## Overview
**Date:** January 15, 2026  
**Services Affected:** `processor`, `worker`, `hooks`  
**Error:** `Cannot find module '/app/node_modules/@repo/kafka/dist/index.js'`

This document details the debugging journey for a critical Docker deployment bug that took multiple iterations to resolve.

---

## 🔴 The Error

```
Error: Cannot find module '/app/node_modules/@repo/kafka/dist/index.js'
    at Module._resolveFilename (node:internal/modules/cjs/loader:1207:15)
    at Module._load (node:internal/modules/cjs/loader:1038:27)
    ...
  code: 'MODULE_NOT_FOUND',
  path: '/app/node_modules/@repo/kafka/package.json'
```

---

## 🔍 Root Cause Analysis

### Understanding the Bug Path

1. **Bun workspaces use symlinks**
   ```
   node_modules/@repo/kafka → ../../packages/kafka (symlink)
   ```

2. **Docker COPY breaks symlinks**
   - When copying `node_modules` from builder to runner, symlinks are copied as-is
   - These point to relative paths that work in builder but break in runner

3. **package.json path mismatch**
   - Kafka's `package.json` said: `"main": "./dist/index.js"`
   - SWC output structure: `dist/src/index.js`
   - **The file was in `dist/src/index.js`, not `dist/index.js`!**

---

## 🔬 Debugging Steps

### Step 1: Initial Hypothesis - Symlink Issue
We tried copying `packages/kafka/dist` to the runner, but it still failed.

### Step 2: Compare Working vs Failing Services
```
| Service   | Uses @repo/kafka?                | Works? |
|-----------|----------------------------------|--------|
| server    | ❌ No (uses @repo/email, types) | ✅     |
| hooks     | ❌ In package.json but not code | ✅     |
| processor | ✅ Yes - imports it on line 2   | ❌     |
```

**Key Insight:** Hooks has `@repo/kafka` in package.json but **never imports it**! That's why it worked.

### Step 3: Add Debug Steps to Dockerfile
```dockerfile
RUN echo "=== Step 1: List @repo/kafka ===" && ls -la ./node_modules/@repo/kafka/
RUN echo "=== Step 2: List @repo/kafka/dist ===" && ls -la ./node_modules/@repo/kafka/dist/
RUN echo "=== Step 3: Cat package.json ===" && cat ./node_modules/@repo/kafka/package.json
```

### Step 4: Find the Real Issue
Debug output revealed:
```
total 12
drwxr-sr-x    3 root     root          4096 Jan 15 05:39 .
drwxr-sr-x    1 root     root          4096 Jan 15 05:40 ..
drwxr-sr-x    2 root     root          4096 Jan 15 05:39 src   ← NO index.js here!
```

**The file was at `dist/src/index.js`, not `dist/index.js`!**

SWC command `swc src -d dist` creates `dist/src/index.js` (preserves source structure).

---

## ✅ The Fix

### Fix 1: Update Kafka package.json
```json
{
  "main": "./dist/src/index.js",  // Changed from ./dist/index.js
  "exports": {
    ".": {
      "default": "./dist/src/index.js"  // Changed here too
    }
  }
}
```

### Fix 2: Replace Broken Symlinks in Dockerfile
```dockerfile
# ⚠️ FIX: Replace broken symlinks with actual files
RUN rm -rf ./node_modules/@repo/kafka 2>/dev/null || true
RUN mkdir -p ./node_modules/@repo/kafka
COPY --from=builder /app/packages/kafka/dist ./node_modules/@repo/kafka/dist
COPY --from=builder /app/packages/kafka/package.json ./node_modules/@repo/kafka/package.json
```

---

## 📋 Checklist for Docker Monorepo Deployments

When deploying a service that uses workspace packages:

- [ ] **Build each workspace package** before the service
- [ ] **Check `main` field** matches SWC/tsc output path
- [ ] **Replace symlinks** in runner stage with actual files
- [ ] **Add debug steps** to verify files exist during build
- [ ] **Clear cache** on Render after Dockerfile changes

---

## 🧪 Debug Template

Add this to any Dockerfile to debug workspace package issues:

```dockerfile
# Builder stage - verify package builds
RUN node -e "require('/app/packages/YOUR_PACKAGE/dist/src/index.js')" && echo "✅ OK"

# Runner stage - verify files copied
RUN ls -la ./node_modules/@repo/YOUR_PACKAGE/
RUN ls -la ./node_modules/@repo/YOUR_PACKAGE/dist/
RUN node -e "require('./node_modules/@repo/YOUR_PACKAGE/dist/src/index.js'); console.log('✅ Works');"
```

---

## 📁 Files Modified

| File | Change |
|------|--------|
| `packages/kafka/package.json` | Changed `main` to `./dist/src/index.js` |
| `apps/processor/Dockerfile` | Added symlink replacement + debug steps |
| `apps/worker/Dockerfile` | Created with proper structure |
| `apps/hooks/Dockerfile` | Added symlink replacement + debug steps |
