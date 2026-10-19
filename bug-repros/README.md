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

| Repro file | Issue | Defect | Related |
| --- | --- | --- | --- |
| `server/gmail-token-scope.test.ts` | #38 | Gmail token refresh overwrites every tenant's access token | #39, #40 |
| `server/jwt-expiry.test.ts` | #44 | Signin JWTs never expire and cannot be revoked by logout | |
| `server/github-delivery-dedup.test.ts` | #45 | GitHub webhook ignores `x-github-delivery` -> duplicate runs | #48 |
| `server/filter-operator-validation.test.ts` | #49 | Zap-level `filterConditions` accept any operator string | #50 |
| `server/whatsapp-phone-number-id.test.ts` | #41 | WhatsApp connect accepts an empty `phoneNumberId` | #42, #56 |
| `server/cron-schedule-claim.test.ts` | #48 | Schedule cron has no atomic claim -> duplicate runs | #45 |
| `worker/email-recipient-template.test.ts` | #52 | Email action never templates its recipient | #53, #57 |
| `worker/webhook-body-templating.test.ts` | #53 | Webhook action body placeholders never resolve / break JSON | #51, #52, #42 |
| `worker/webhook-ssrf.test.ts` | #51 | Webhook action has no egress policy (SSRF) | #53, #42 |
| `worker/filter-fail-open.test.ts` | #50 | Worker filter evaluation fails open on unknown operators | #49 |
| `hooks/telegram-command-args.test.ts` | #54 | Telegram `commandArgs` keeps the `@botname` mention | #42 |
| `hooks/webhook-signature-raw-body.test.ts` | #55 | Webhook signature verified against a re-serialized body | #43, #58 |
| `hooks/whatsapp-unauthenticated-ingress.test.ts` | #56 | WhatsApp ingress accepts forged deliveries | #41, #57 |
| `processor/sheets-first-poll.test.ts` | #46 | Sheets trigger fires a run per pre-existing row on first poll | #47 |
| `processor/sheets-hash-before-enqueue.test.ts` | #47 | Sheets poller stores row hashes before enqueue -> lost rows | #46 |
| `packages/email-rate-limit.test.ts` | #57 | Email rate limit is one platform-wide bucket | #52, #56 |
| `web/gmail-accounts-not-listed.test.cjs` | #39 | Editor never lists connected Gmail accounts | #40, #38 |
| `web/gmail-trigger-step3-dead-end.test.cjs` | #40 | Gmail trigger configuration step is a dead end | #39, #43 |
| `web/im-action-metadata-missing.test.cjs` | #42 | WhatsApp/Telegram/Webhook actions cannot be configured | #43, #41, #53 |
| `web/trigger-config-unreachable.test.cjs` | #43 | Webhook/GitHub trigger forms are unreachable | #42, #55, #58 |
| `web/dashboard-hook-url-for-every-zap.test.cjs` | #58 | Dashboard shows a webhook URL for every Zap | #43, #55 |

Issues #38-#58 were filed on 2026-10-19. The GitHub token used for this sweep can
create issues but cannot comment on or edit them, so the cross-references live in
this table rather than in the issue bodies.

Grouped by theme, for triage:

* **Cross-tenant / security:** #38 (Gmail token overwrite), #51 (webhook SSRF),
  #56 (forged WhatsApp ingress), #44 (immortal JWTs), #55 (signature verification
  input), #57 (shared email budget), #41 (empty `phoneNumberId` unique collision).
* **Duplicate or lost runs:** #45 (GitHub redelivery), #48 (schedule claim),
  #46 (Sheets first-poll storm), #47 (Sheets lost rows).
* **Silent mis-execution:** #49 + #50 (filters fail open), #52 (email recipient),
  #53 (webhook body), #54 (Telegram args).
* **Editor dead ends (a Zap cannot be built):** #39, #40 (Gmail), #42 (actions),
  #43 (webhook/GitHub triggers), #58 (misleading hook URL).

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
