# SWC vs TSC Output Structure

## Overview

When building TypeScript packages, SWC and TSC produce **different output structures**. This difference caused the `@repo/kafka` module not found bug.

---

## SWC Output Structure

**Command:** `npx swc src -d dist --copy-files`

**Input:**
```
src/
  index.ts
  helper.ts
```

**Output:**
```
dist/
  src/           ← SWC preserves the 'src' folder!
    index.js
    helper.js
```

**Entry point:** `dist/src/index.js`

---

## TSC Output Structure

**Command:** `tsc` (with `outDir: "dist"`)

**Input:**
```
src/
  index.ts
  helper.ts
```

**Output:**
```
dist/
  index.js       ← TSC flattens (no 'src' folder)
  helper.js
```

**Entry point:** `dist/index.js`

---

## Impact on package.json

### For SWC-built packages:
```json
{
  "main": "./dist/src/index.js",
  "exports": {
    ".": {
      "default": "./dist/src/index.js"
    }
  }
}
```

### For TSC-built packages:
```json
{
  "main": "./dist/index.js",
  "exports": {
    ".": {
      "default": "./dist/index.js"
    }
  }
}
```

---

## Packages in This Repo

| Package | Build Tool | Entry Point |
|---------|------------|-------------|
| `@repo/kafka` | SWC | `./dist/src/index.js` |
| `@repo/email` | TSC | `./dist/index.js` |
| `@repo/types` | TSC | `./dist/index.js` |

---

## Quick Check

To verify the output structure of any package:

```bash
cd packages/YOUR_PACKAGE
bun run build
ls -la dist/
```

If you see a `src` folder inside `dist`, use `./dist/src/index.js`.
If you see `index.js` directly in `dist`, use `./dist/index.js`.
