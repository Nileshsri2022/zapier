# Bug reproduction harness

Failing tests for the defects reported in the GitHub issues filed on
2026-10-19 (bug sweep of the whole monorepo).

These tests are **red on purpose**. They live outside `apps/*/tests` so that

* `cd apps/server && bun run test` (and the worker/hooks/web equivalents) keep
  passing, and
* CI (`.github/workflows/deploy.yml`) is unaffected — it only runs the per-app
  test scripts,

while every issue still cites a command that reproduces the bug from a clean
checkout.

## Running the repros

All commands are run from the repository root. `npm install` must have been run
once (the harness reuses the workspace `node_modules`, jest, ts-jest, typescript
and react-test-renderer that are already installed).

| Suite | Command |
| --- | --- |
| server | `npx jest -c bug-repros/jest.server.config.js` |
| worker | `npx jest -c bug-repros/jest.worker.config.js` |
| hooks | `npx jest -c bug-repros/jest.hooks.config.js` |
| processor | `npx jest -c bug-repros/jest.processor.config.js` |
| packages | `npx jest -c bug-repros/jest.packages.config.js` |
| web editor | `node --test bug-repros/web/*.test.cjs` |

A single repro: append its path, e.g.
`npx jest -c bug-repros/jest.server.config.js bug-repros/server/gmail-token-scope.test.ts`.

Each file contains **control assertions that pass today** (marked `(control)`)
next to the assertions that fail, so a red run is attributable to the defect and
not to the harness.

## Repro → issue map

| Repro file | Defect |
| --- | --- |
| `server/gmail-token-scope.test.ts` | Gmail token refresh overwrites every tenant's access token |
| `server/jwt-expiry.test.ts` | Signin JWTs never expire and cannot be revoked by logout |
| `server/github-delivery-dedup.test.ts` | GitHub webhook ignores `x-github-delivery` → duplicate runs |
| `server/filter-operator-validation.test.ts` | Zap-level `filterConditions` accept any operator string |
| `server/whatsapp-phone-number-id.test.ts` | WhatsApp connect accepts an empty `phoneNumberId` |
| `server/cron-schedule-claim.test.ts` | Schedule cron has no atomic claim → duplicate runs |
| `worker/email-recipient-template.test.ts` | Email action never templates its recipient |
| `worker/webhook-body-templating.test.ts` | Webhook action body placeholders never resolve / break JSON |
| `worker/webhook-ssrf.test.ts` | Webhook action has no egress policy (SSRF) |
| `worker/filter-fail-open.test.ts` | Worker filter evaluation fails open on unknown operators |
| `hooks/telegram-command-args.test.ts` | Telegram `commandArgs` keeps the `@botname` mention |
| `hooks/webhook-signature-raw-body.test.ts` | Webhook signature verified against a re-serialized body |
| `hooks/whatsapp-unauthenticated-ingress.test.ts` | WhatsApp ingress accepts forged deliveries |
| `processor/sheets-first-poll.test.ts` | Sheets trigger fires a run per pre-existing row on first poll |
| `processor/sheets-hash-before-enqueue.test.ts` | Sheets poller stores row hashes before enqueue → lost rows |
| `packages/email-rate-limit.test.ts` | Email rate limit is one platform-wide bucket |
| `web/gmail-accounts-not-listed.test.cjs` | Editor never lists connected Gmail accounts |
| `web/gmail-trigger-step3-dead-end.test.cjs` | Gmail trigger configuration step is a dead end |
| `web/im-action-metadata-missing.test.cjs` | WhatsApp/Telegram/Webhook actions cannot be configured |
| `web/trigger-config-unreachable.test.cjs` | Webhook/GitHub trigger forms are unreachable |
| `web/dashboard-hook-url-for-every-zap.test.cjs` | Dashboard shows a webhook URL for every Zap |

## Harness notes

* `tsconfig.commonjs.json` — the monorepo base tsconfig uses `module: NodeNext`,
  which makes ts-jest emit real `import()` calls that Jest's CJS runtime rejects
  ("A dynamic import callback was invoked without --experimental-vm-modules").
  Several worker action branches are only reachable through
  `await import('./x.js')`, so the harness downlevels to CommonJS.
* `jest.server.config.js` / `jest.processor.config.js` pin `googleapis` to the
  copy the app itself resolves, so `jest.mock('googleapis')` inside a repro
  intercepts the module the source under test imports (npm hoists a second copy
  at the repository root).
* `web/harness.cjs` mirrors `apps/web/tests/ai-form.test.cjs`: it transpiles TSX
  with the TypeScript compiler API into a synthetic CommonJS module whose
  `require` can be overridden, then renders it with `react-test-renderer`.
* Nothing here talks to the network, a database, Kafka or Redis: provider SDKs,
  `@repo/db`, `@repo/redis`, `@repo/runs`, `resend` and `fetch` are stubbed
  in-process, so no credentials are needed and no secret appears in these files.

## When a bug is fixed

Move the corresponding assertions into the owning app's test suite
(`apps/<app>/tests/…`, `packages/<pkg>/tests/…`) as a regression test, delete the
repro file, and close the issue.
