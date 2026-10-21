# AGENTS.md

ZapMate — bun/Turbo monorepo. `apps/` = hook ingress, poller, API, worker, web; `packages/` = db, types, ai, runs, ingress, placeholders, email, redis, kafka.

## Commands

```bash
npm install --ignore-scripts   # no bun in this sandbox; skip-scripts avoids a bcrypt node-gyp failure
npm test                       # all suites (server, worker, hooks, processor, web, packages/placeholders, packages/ingress)
npm run typecheck              # ratchet: fails only on NEW tsc errors vs tsc-baseline.json
npm run generate               # Prisma client (needed for @repo/db; postinstall does it when online)
npm run lint
```

`npm test` wraps each app's (and package's) own runner — never run bare `npx jest` from the root (no preset; use `--config apps/<app>/jest.config.js --rootDir apps/<app>`).

## Before you edit

`edit_file` fails on guessed context. `grep -n "exact text" <file>` first, then anchor the edit on a line you have actually read. Prefer `sed -n 'A,Bp'` to confirm boundaries for multi-line edits.

## Map

- `docs/ask-matt/` — per-integration specs and grilled decisions (start at `03-grill-log.md`)
- `docs/adr/` — architecture decisions
- `.github/workflows/deploy.yml` — lint + every test suite (apps and packages) + typecheck ratchet; deploy jobs per service
- `tsc-baseline.json` — frozen known-bad typecheck signatures (shrink it with `npm run typecheck:update`)
