# Bun Workspace Symlinks in Docker

## The Problem

Bun workspaces create symlinks in `node_modules`:

```
node_modules/
  @repo/
    kafka → ../../packages/kafka  (symlink)
    email → ../../packages/email  (symlink)
    db → ../../packages/db        (symlink)
```

When you `COPY --from=builder /app/node_modules ./node_modules`:
- The **symlinks are copied as-is**
- They point to `../../packages/kafka` which **doesn't exist** in runner

---

## Why It Fails

```
Builder:                          Runner:
/app/                             /app/
  node_modules/                     node_modules/
    @repo/kafka → ../../packages/     @repo/kafka → ../../packages/
  packages/                         (NO packages folder!)
    kafka/                      
      dist/
        src/index.js
```

Node follows the symlink → `../../packages/kafka` → **nothing there** → 💥

---

## The Solution

Replace symlinks with actual files in the runner stage:

```dockerfile
# 1. Copy node_modules (with broken symlinks)
COPY --from=builder /app/node_modules ./node_modules

# 2. Remove the broken symlink
RUN rm -rf ./node_modules/@repo/kafka 2>/dev/null || true

# 3. Create a real directory
RUN mkdir -p ./node_modules/@repo/kafka

# 4. Copy the actual built files
COPY --from=builder /app/packages/kafka/dist ./node_modules/@repo/kafka/dist
COPY --from=builder /app/packages/kafka/package.json ./node_modules/@repo/kafka/package.json
```

---

## Complete Fix for All @repo Packages

```dockerfile
# Kafka
RUN rm -rf ./node_modules/@repo/kafka 2>/dev/null || true
RUN mkdir -p ./node_modules/@repo/kafka
COPY --from=builder /app/packages/kafka/dist ./node_modules/@repo/kafka/dist
COPY --from=builder /app/packages/kafka/package.json ./node_modules/@repo/kafka/package.json

# Email
RUN rm -rf ./node_modules/@repo/email 2>/dev/null || true
RUN mkdir -p ./node_modules/@repo/email
COPY --from=builder /app/packages/email/dist ./node_modules/@repo/email/dist
COPY --from=builder /app/packages/email/package.json ./node_modules/@repo/email/package.json

# DB
RUN rm -rf ./node_modules/@repo/db 2>/dev/null || true
RUN mkdir -p ./node_modules/@repo/db
COPY --from=builder /app/packages/db/src ./node_modules/@repo/db/src
COPY --from=builder /app/packages/db/package.json ./node_modules/@repo/db/package.json
```

---

## Alternative: Copy Entire packages Folder

A simpler (but larger image) approach:

```dockerfile
# Copy all packages so symlinks resolve
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/node_modules ./node_modules
```

This works but increases image size significantly.

---

## Debugging Symlinks

```dockerfile
# Check if symlink or real directory
RUN ls -la ./node_modules/@repo/

# Should show:
# lrwxrwxrwx   kafka -> ../../packages/kafka  (before fix - symlink)
# drwxr-sr-x   kafka                           (after fix - real dir)
```

---

## Key Takeaway

> **Symlinks are fine in build stage, but NOT in production runtime.**
> 
> Always replace workspace symlinks with real files in the runner stage.
