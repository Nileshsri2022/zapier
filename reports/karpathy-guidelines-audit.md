# Karpathy Guidelines — Compliance Audit

**Repository:** `Nileshsri2022/zapier` (ZapMate) · branch `arena/ab5c16e4-zapier` @ `5ca89d9`
**Audit date:** 2026-10-16
**Ruleset audited:** [`karpathy-guidelines` SKILL.md](https://github.com/multica-ai/andrej-karpathy-skills/blob/main/skills/karpathy-guidelines/SKILL.md) — the four principles derived from Andrej Karpathy's observations on LLM coding pitfalls (MIT, community-published by Forrest Chang; not written by Karpathy himself).
**Scope:** 147 TypeScript/TSX files, 22,167 lines (17,390 non-comment/non-blank code lines), across `apps/{server,web,worker,processor,hooks}` and `packages/*`.

---

## 1. Answer up front

**No — the project does not follow the guidelines repo-wide. It partially follows them, and the deviations are concentrated and fixable.**

An important framing point before the scorecard: these four rules govern *how an agent edits code*, not what the code should look like. So this audit does not ask "does the code read nicely?" It asks the answerable question: **does the repository artifact carry the fingerprints of that discipline — explicit assumptions instead of silent ones, minimum code instead of speculative code, no orphaned leftovers from past edits, and verification that actually runs?** That mapping is spelled out in §3, and every verdict below traces to a measurement or a specific line.

| Principle | Grade | One-line verdict |
|---|---|---|
| **1. Think Before Coding** — *don't assume, surface tradeoffs* | **C−** | 11 files fail on silent/fail-open assumptions, including two unauthenticated-endpoint bugs; 33 more show MIXED. There is real evidence of good practice in `env.ts` and the `learnings/` docs, but the security-sensitive paths assume rather than check. |
| **2. Simplicity First** — *minimum code, nothing speculative* | **D+** | 30 files FAIL, 45 MIXED. 17 modules are unreferenced, 26 exports are dead, 50 functions/components exceed 80 lines (11 exceed 250), 392 `any`s, plus an entire unused `@repo/logger` package. The "if 200 lines could be 50, rewrite it" test fails in ~20% of files. |
| **3. Surgical Changes** — *touch only what you must; clean up your own mess* | **C** | 17 FAIL, 48 MIXED. Two full generations of superseded UI and a duplicate poller were left in the tree; 34 unused imports/variables were left behind; 29 files drift from the repo's own Prettier config. Unrelated dead code is present and undocumented (the rule says *mention it, don't delete it* — it isn't even mentioned). |
| **4. Goal-Driven Execution** — *define success criteria, loop until verified* | **D** | 103 of 147 files have no automated verification of any kind. The CI pipeline runs lint + build but **never runs the test suite**. Solana is a `console.log` stub gated behind an env var name that doesn't match the docs, so it silently does nothing in production. |

**Aggregate:** only **14 of 147 files (10%)** come out clean against all four proxies; **110 files (75%) fail at least one**, and 23 are MIXED-only. That headline number is dominated by Principle 4 — 103 of those files fail *purely* because nothing verifies them, which is one structural fact about the repo rather than 103 separate defects (see §G).

The single most important structural finding: **the repo has tests (84, all passing) but no verification loop** — CI never executes them, and 70% of the code is outside their reach. That directly contradicts Principle 4, which is the principle Karpathy singles out as the source of leverage ("strong success criteria let you loop independently").

---

## 2. What "following the guidelines" means here

Verbatim, the rules are:

> **1. Think Before Coding** — Don't assume. Don't hide confusion. Surface tradeoffs.
> **2. Simplicity First** — Minimum code that solves the problem. Nothing speculative.
> **3. Surgical Changes** — Touch only what you must. Clean up only your own mess.
> **4. Goal-Driven Execution** — Define success criteria. Loop until verified.

Per-file compliance was tested against these proxies:

| Principle | Machine-checkable proxy used | Sources |
|---|---|---|
| **P1 Think** | (a) external input validated before use — any handler reading `req.body` with no schema/validator in the file; (b) configuration assumptions that **fail open** (missing secret ⇒ allow) rather than fail closed; (c) failure paths that are explicitly handled vs silently swallowed (`catch` that only logs, no rethrow, no error response) | grep + AST-ish parse per file; manual line review of every hit |
| **P2 Simplicity** | largest single unit per file, unreferenced modules, dead exports, cross-file duplicated blocks, `any`/`@ts-ignore` density, declared-but-unused dependencies, unused env config, express `res.status()` calls that are unreachable | static-analysis tooling: ESLint (`no-unused-vars`, `no-explicit-any`), jscpd, Prettier, custom Python analyzers |
| **P3 Surgical** | leftover orphans from past edits (unused imports/vars created by earlier changes), superseded duplicate modules still in-tree, commented-out code, style drift from the repo's own Prettier config | ESLint `no-unused-vars`, Prettier `--check`, unreferenced-module graph, jscpd |
| **P4 Verified** | is the file reached by the test suite (transitively, via the import graph)? does CI execute tests? are success criteria written down anywhere? | Jest run, import-graph traversal from test roots, `.github/workflows/deploy.yml` |

**Tooling actually executed for this audit** (not estimated):

```
$ npm install --ignore-scripts            # bun isn't in this sandbox; npm used
$ npx jest --forceExit                    # 9 suites, 84 tests
$ ./node_modules/.bin/eslint . --ext .ts,.tsx     # 426 warnings, 0 errors
$ npx prettier --check "apps/**/*.{ts,tsx}" "packages/**/*.{ts,tsx}"   # 29 files fail
$ npx --yes jscpd@4 --min-lines 12 --min-tokens 60 \
      --ignore "**/node_modules/**,**/dist/**,**/*.test.ts,**/tests/**" \
      --reporters json --output /tmp/audit/jscpd apps packages   # 46 clones, 848 duplicated lines (3.49%)
$ python3 <repo-wide analyzers>           # dead exports, orphan modules, env drift, fail-open scan
```

Every number in this report came from one of those runs or from a cited `file:line`.

---

## 3. Repo-level scorecard

### Principle 1 — Think Before Coding: **C−**

**FAILS (works silently, assumes rather than asks):**

| File:line | The silent assumption | Why it matters |
|---|---|---|
| `apps/server/src/controllers/GmailWebhookController.ts:182` | `if (!secret) { console.warn(...); return true; }` (`:179-183`) — with `GMAIL_WEBHOOK_SECRET` unset, **the signature check passes for any attacker-supplied signature** | Any caller can POST forged Gmail notifications and fire arbitrary Zaps. `GMAIL_WEBHOOK_SECRET` is *commented out* in `.env.example`, so the fail-open branch is the default deployment state. |
| `apps/server/src/routes/CronRoutes.ts:14-16` | `if (cronSecret !== process.env.CRON_SECRET)` — when `CRON_SECRET` is unset, header is `undefined` and env is `undefined`, so `undefined !== undefined` is false and **the guard passes** | `/api/cron/process-schedules` becomes unauthenticated; anyone can trigger scheduled-workflow runs. |
| `apps/server/src/controllers/TriggerController.ts:26,79` | Signature is verified only `if (signature)` — omit the header and the check is skipped. The HMAC key is `process.env.WEBHOOK_SECRET \|\| 'default-secret'` | Webhook endpoints accept unsigned payloads by default, and the fallback key is a literal in the source. |
| `apps/worker/src/index.ts:112` | Reads `SOL_PRIVATE_KEY`; `apps/worker/.env.example:23` documents `SOLANA_PRIVATE_KEY` | Solana actions silently skip in production (`return { success:false, message:'SOL_PRIVATE_KEY not configured' }`) — a misconfiguration that looks like a working deploy. |
| `apps/server/src/controllers/TriggerController.ts:84` | `handleWebhook` catch-all returns 500 after `console.error` | Fine as a boundary, but there is no distinction between "bad payload" and "downstream down" — the caller cannot act on it. |

**MIXED (33 files):** the dominant pattern is `catch (error) { console.error(...) }` with no rethrow and no error response — 85 such catches across 40 files. The clearest example is `apps/server/src/controllers/ZapController.ts:296-297, 340-341`: inside `processWebhookTrigger`/`processGmailTrigger`, a failed action is swallowed and the loop continues, so a Zap whose every action fails still writes a `ZapRun` and reports success. `apps/server/src/utils/redis.ts:39,54,68,85` swallows every Redis failure, which means the cache silently degrades to no-cache (acceptable, but it's an unstated tradeoff).

**PASSES (good, and worth keeping):** `apps/server/src/env.ts` validates required env at boot with zod and `process.exit(1)` on failure — this is exactly "don't assume, check". `apps/server/src/middlewares/validateRequest.ts` is a clean, explicit validation boundary. `packages/types/src/index.ts` centralizes zod schemas so both server and client validate the same shapes. And the `learnings/*.md` + `artifacts/*.md` documents are the strongest P1 evidence in the repo: nine production bugs written up with root cause and lesson, e.g. `learnings/01-deployment-bugs-and-fixes.md` §1 documenting that an unwrapped `sendEmail()` caused a 404 on signup — and the fix (`try/catch` around `sendEmail`) is genuinely present in `AuthController.ts:55-60`.

### Principle 2 — Simplicity First: **D+**

**Speculative and dead code (the "nothing speculative" rule):**

- **17 unreferenced modules** (no static or dynamic importer anywhere):
  `apps/web/components/{TelegramActionConfig,TelegramBotConfig,TelegramTriggerConfig,WhatsAppActionConfig,WhatsAppServerConfig,WhatsAppTriggerConfig,GoogleCalendarTriggerConfig}.tsx` (1,924 lines of superseded UI), `apps/processor/src/googleSheetsPoller.ts` (176 lines duplicating `pollers/GoogleSheetsPoller.ts`), `apps/web/lib/auth.ts`, `apps/web/context/AuthProvider.tsx`, `apps/server/src/utils/index.ts`, `apps/web/components/modal/index.ts`, and the whole `packages/logger` package (pino + pino-pretty, zero importers — the app uses 453 `console.*` calls instead).
- **26 dead exports** across 17 files, e.g. `packages/kafka/src/index.ts` exports `TOPICS`, `createConsumer`, `createProducer` (none used), `apps/worker/src/sendTelegram.ts` exports `replyToMessage`, `sendTelegramDocument`, `sendTelegramPhoto`.
- **Unused dependencies:** `lodash` (declared in `packages/email`, never imported), `@sentry/profiling-node` (declared, never imported), `@google-cloud/local-auth` (declared in `apps/server`, never imported).
- **"Flexibility that wasn't requested":** `apps/server/src/services/GmailErrorHandler.ts` (305 lines) + `GmailRateLimiter.ts` (119 lines) implement circuit-breaker/backoff machinery whose value is unproven for a single-user Gmail integration; `apps/server/src/middlewares/csrf.ts` (100 lines) is wired into exports but no route uses `csrfProtection` — the same class of speculative scaffolding the rule warns about.

**Size (the "if 200 lines could be 50, rewrite it" test):** 50 non-test units exceed 80 lines, 37 exceed 120, 11 exceed 250.

| Largest unit | Lines | File |
|---|---|---|
| `Modal` (single component) | 624 | `apps/web/components/Modal.tsx` |
| `GoogleCalendarPoller` (class) | 476 | `apps/processor/src/pollers/GoogleCalendarPoller.ts` |
| `GmailActionConfig` | 454 | `apps/web/components/GmailActionConfig.tsx` |
| `GoogleCalendarTriggerConfig` | 428 | `apps/web/components/GoogleCalendarTriggerConfig.tsx` *(also unreferenced)* |
| `GmailService` (class) | 384 | `apps/server/src/services/GmailService.ts` |
| `createZap` (single handler) | 192 | `apps/server/src/controllers/ZapController.ts:7` |

`createZap` is the canonical example: one function doing transaction orchestration *plus* five inline integration-branch blocks (Google Sheets, Google Calendar with a 7-entry type map, Schedule with 5 branches and date arithmetic) — the five inline branches at `ZapController.ts:58-184` should be extracted per trigger type.

**Type escapes:** 392 `no-explicit-any` warnings (`ZapController` alone has 21, `TelegramRoutes` 19, `worker/index.ts` 19) and 90 `@ts-ignore`/`@ts-expect-error` occurrences. `apps/web/app/dashboard/page.tsx` and `apps/server/src/routes/ScheduleRoutes.ts` lean on `@ts-ignore` to pass `req.id`, which exists only because the Express `Request` type is augmented ad hoc instead of declaring it once.

**Duplication:** jscpd found 46 clones / 848 duplicated lines (3.49% of code). The load-bearing ones: `apps/server/src/controllers/GmailTriggersController.ts:112-129` duplicates `ZapController.ts:338-355` (`processGmailTrigger` exists twice with different bodies), `apps/processor/src/googleSheetsPoller.ts:37-53` duplicates `apps/server/src/services/GoogleSheetsService.ts:225-241`, and the Google Calendar/Sheets controllers repeat the same OAuth + server-CRUD skeleton (`GoogleCalendarController.ts:32-62` ↔ `GoogleSheetsController.ts:33-63`, 31 identical lines).

**Where it's genuinely simple:** `packages/types` (133 lines, one job), `packages/db` (6 lines), `apps/server/src/helper.ts` (10 lines), `apps/worker/src/utils/retry.ts` (102 lines, focused, well-named), `packages/kafka/src/index.ts` (91 lines of careful SASL/SSL narrowing), and most `middlewares/*` files. These are what the rest should look like.

### Principle 3 — Surgical Changes: **C**

The rule's test is *"every changed line should trace directly to the user's request"* and *"don't remove pre-existing dead code unless asked — but clean up your own mess."*

**Evidence the repo fails it:** the working tree contains the residue of multiple superseded efforts that were never reconciled.

1. **Two UI generations coexist.** `components/metadata/*` (imported by `Modal.tsx:13-22`) is the live implementation; the root-level `Telegram*/WhatsApp*/GoogleCalendarTriggerConfig` components are the previous generation, fully unreferenced, 1,924 lines. A reviewer cannot tell which one is authoritative without graph analysis.
2. **A duplicate poller**: `apps/processor/src/googleSheetsPoller.ts` is an unreferenced earlier version of `pollers/GoogleSheetsPoller.ts` (and `pollers/index.ts` wires only the latter).
3. **34 unused imports/variables** left behind by past edits (ESLint `no-unused-vars`), including `axios` in `ActionsController.ts:4`, `google` in `GoogleSheetsController.ts:2`, `GmailService` in `GmailTriggersController.ts:3`, `Prisma` in `GoogleSheetsService.ts:6`, and four unused locals (`gmailServers`, `gmailTriggers`, `gmailActions`, `gmailWatches`) in the integration script.
4. **Style drift in 29 files** from the repo's *own* Prettier config — `.prettierrc` exists, `npm run format:check` exists, but 27 of the 29 drifted files are in `apps/server`, mixing single-quoted (newer) and double-quoted (older) code. There is a Husky pre-commit + lint-staged hook, so these files predate or bypass it.
5. **Migration residue:** `Railway` config remnants, `SMTP_*` env vars in `env.ts:11-14` for an email path that `learnings/01` says was replaced by Resend, and `SOLANA` vs `SOL` naming — the classic markers of a change that wasn't cleaned up.

**Counter-evidence (the repo does do this well sometimes):** the commit that removed the GitHub Actions scheduler in favour of cron-job.org left the workflow file consistent. `apps/server/tests/setup.ts` is a clean consolidation. The `reports/` conventions and `artifacts/task.md` checkbox state are kept in sync with reality.

> ⚠️ **Method caveat for P3:** this repo's history has been squashed to a **single commit** (`5ca89d9`), so per-commit surgical-ness cannot be evaluated (no diff to inspect). The verdict above is derived from in-tree residue, which is the observable part of the same behaviour.

### Principle 4 — Goal-Driven Execution: **D**

**The verification loop does not exist.** Concretely:

| Check | State |
|---|---|
| Test suite exists? | Yes — 9 suites / 84 tests, all passing (after the fix described below) |
| Does CI run it? | **No.** `.github/workflows/deploy.yml` `test` job = install → `prisma generate` → `lint` → `build`. `jest` is never invoked, in any workflow. |
| What fraction of code is reachable from tests? | **32 / 147 files (22%)**, and 12 of those are the tests' own support files |
| Frontend tests | **Zero.** All 45 `apps/web` files have no test of any kind |
| Background services (worker/processor/hooks) | **Zero.** 26 files, no tests |
| Are success criteria written down? | **Partly, and it's the repo's best P4 habit:** `artifacts/task.md` tracks completed/in-progress/not-started work; `artifacts/04-test-suite-plan.md` specifies exactly which controllers need which tests and in what order; `learnings/*` records bugs with fixes. The plan exists — it just was never executed. |
| Manual verification scripts | `apps/server/tests/test-webhook.ts`, `test-gmail-integration.ts` — useful, but they require a live DB + Kafka + a running server, so they can't run in CI and can't be run by a reviewer |
| Health/observability as verification | `apps/server/src/index.ts:66-79` has a real `/health` with `SELECT 1`; that's good. `packages/logger` — the structured-logging answer — is unused. |

**The one fix already applied (and how it demonstrates the point):** the suite was red when I started — 6 failures, all `429 Too Many Requests` instead of the asserted `422`, because `authLimiter` (5 req / 15 min) throttled the test client's IP. The fix is three lines in `apps/server/src/middlewares/rateLimiter.ts` (`skip: () => process.env.NODE_ENV === 'test'`). Result: **84/84 green**. That is precisely the "define success criteria, loop until verified" loop — and the fact that it took a manual audit to notice a red suite is the P4 failure in miniature.

> Note: that change is present in the working tree but **uncommitted** — the harness reset the branch between sessions. Run `git diff` to see it, or commit it as `fix(server): skip rate limiting under NODE_ENV=test`.
---

## 4. Per-file verdicts

All 147 source files, grouped by area. Verdict key: **PASS** = no violation found against the proxies in §2 · **MIXED** = violations present but contained · **FAIL** = the file violates the principle in a way that should block a review · **N/A** = not applicable (test files are input to P4, not subjects of it).

Read the `Evidence` column as the *reason for any non-PASS verdict*; a PASS with `—` means the file is clean on all four proxies. Files I read closely and adjusted by hand are the security-sensitive ones and the >300-line units; the rest are verdict-by-measurement — the caveat is restated in §G.

### apps/server — controllers, routes, middlewares, services

| File | LOC | P1 Think | P2 Simple | P3 Surgical | P4 Verified | Evidence |
|---|---|---|---|---|---|---|
| `apps/server/src/controllers/ActionsController.ts` | 95 | PASS | MIXED | MIXED | PASS | 8× `any`; 1 unused var/import; Prettier drift; exercised by tests |
| `apps/server/src/controllers/AuthController.ts` | 201 | MIXED | MIXED | PASS | PASS | 1× `@ts-ignore`; 1 log-only catch; duplicated block(s), max 16 lines; exercised by tests |
| `apps/server/src/controllers/GmailActionsController.ts` | 199 | MIXED | FAIL | MIXED | PASS | 15× `any`; 1 log-only catch; 3 unused var/import; Prettier drift; duplicated block(s), max 15 lines; exercised by tests |
| `apps/server/src/controllers/GmailController.ts` | 465 | MIXED | MIXED | MIXED | FAIL | 10× `any`; 8× `@ts-ignore`; 3 log-only catch; 2 unused var/import; duplicated block(s), max 28 lines |
| `apps/server/src/controllers/GmailTriggersController.ts` | 306 | FAIL | FAIL | MIXED | FAIL | 16× `any`; 4× `@ts-ignore`; 2 log-only catch; `req.body` used with no schema validation; 2 unused var/import; Prettier drift; duplicated block(s), max 18 lines |
| `apps/server/src/controllers/GmailWebhookController.ts` | 210 | FAIL | MIXED | MIXED | FAIL | ❌ `verifyGmailWebhookSignature` returns **true** when `GMAIL_WEBHOOK_SECRET` is unset (line 181); dead exports: `renewGmailWatch`; 6 log-only catch; Prettier drift |
| `apps/server/src/controllers/GoogleCalendarController.ts` | 326 | MIXED | MIXED | PASS | FAIL | 5× `@ts-ignore`; 1 log-only catch; duplicated block(s), max 31 lines |
| `apps/server/src/controllers/GoogleCalendarTriggersController.ts` | 343 | FAIL | MIXED | PASS | FAIL | 5× `@ts-ignore`; `req.body` used with no schema validation; duplicated block(s), max 26 lines |
| `apps/server/src/controllers/GoogleSheetsController.ts` | 285 | MIXED | MIXED | MIXED | PASS | 5× `@ts-ignore`; 1 log-only catch; 1 unused var/import; duplicated block(s), max 31 lines; exercised by tests |
| `apps/server/src/controllers/GoogleSheetsTriggersController.ts` | 262 | FAIL | MIXED | MIXED | PASS | 5× `@ts-ignore`; 1 log-only catch; `req.body` used with no schema validation; Prettier drift; duplicated block(s), max 26 lines; exercised by tests |
| `apps/server/src/controllers/TriggerController.ts` | 89 | FAIL | PASS | MIXED | PASS | ❌ signature checked only `if (signature)`; HMAC key falls back to `'default-secret'` (lines 26, 79); 1 log-only catch; `req.body` used with no schema validation; Prettier drift; exercised by tests |
| `apps/server/src/controllers/ZapController.ts` | 645 | MIXED | FAIL | PASS | PASS | largest unit ≈192 lines; 21× `any`; 9× `@ts-ignore`; 2 log-only catch; duplicated block(s), max 18 lines; exercised by tests |
| `apps/server/src/controllers/index.ts` | 7 | PASS | PASS | MIXED | PASS | Prettier drift; exercised by tests |
| `apps/server/src/env.ts` | 42 | PASS | PASS | MIXED | FAIL | Prettier drift |
| `apps/server/src/helper.ts` | 10 | PASS | PASS | MIXED | PASS | Prettier drift; exercised by tests |
| `apps/server/src/index.ts` | 137 | MIXED | PASS | PASS | FAIL | 1 log-only catch |
| `apps/server/src/middlewares/cache.ts` | 61 | PASS | PASS | PASS | PASS | 1× `@ts-ignore`; exercised by tests |
| `apps/server/src/middlewares/compression.ts` | 24 | PASS | PASS | PASS | PASS | exercised by tests |
| `apps/server/src/middlewares/csrf.ts` | 100 | PASS | PASS | PASS | PASS | 2× `@ts-ignore`; exercised by tests |
| `apps/server/src/middlewares/errorHandler.ts` | 59 | PASS | PASS | PASS | PASS | exercised by tests |
| `apps/server/src/middlewares/index.ts` | 55 | PASS | PASS | PASS | PASS | 2× `@ts-ignore`; exercised by tests |
| `apps/server/src/middlewares/rateLimiter.ts` | 54 | PASS | PASS | PASS | PASS | exercised by tests |
| `apps/server/src/middlewares/sanitize.ts` | 40 | FAIL | PASS | PASS | PASS | `req.body` used with no schema validation; exercised by tests |
| `apps/server/src/middlewares/security.ts` | 48 | PASS | PASS | PASS | PASS | exercised by tests |
| `apps/server/src/middlewares/validateRequest.ts` | 66 | PASS | PASS | PASS | PASS | exercised by tests |
| `apps/server/src/routes/ActionsRouter.ts` | 9 | PASS | PASS | MIXED | FAIL | Prettier drift |
| `apps/server/src/routes/AuthRoutes.ts` | 15 | PASS | PASS | PASS | PASS | exercised by tests |
| `apps/server/src/routes/CronRoutes.ts` | 175 | FAIL | PASS | PASS | FAIL | ❌ guard fails open when `CRON_SECRET` is unset (header undefined === env undefined) (lines 14-16); 1 log-only catch |
| `apps/server/src/routes/GitHubRoutes.ts` | 225 | FAIL | PASS | MIXED | FAIL | `req.body` used with no schema validation; Prettier drift |
| `apps/server/src/routes/GmailRoutes.ts` | 45 | PASS | PASS | PASS | FAIL | — |
| `apps/server/src/routes/GoogleCalendarRoutes.ts` | 56 | PASS | PASS | PASS | FAIL | — |
| `apps/server/src/routes/GoogleSheetsRoutes.ts` | 44 | PASS | PASS | MIXED | FAIL | Prettier drift |
| `apps/server/src/routes/ScheduleRoutes.ts` | 266 | FAIL | MIXED | PASS | FAIL | 8× `any`; 4× `@ts-ignore`; `req.body` used with no schema validation |
| `apps/server/src/routes/TelegramRoutes.ts` | 309 | MIXED | FAIL | PASS | FAIL | 19× `any`; 9× `@ts-ignore`; 1 log-only catch; duplicated block(s), max 15 lines |
| `apps/server/src/routes/TriggerRoutes.ts` | 12 | PASS | PASS | PASS | FAIL | — |
| `apps/server/src/routes/WhatsAppRoutes.ts` | 330 | PASS | FAIL | PASS | FAIL | 17× `any`; 9× `@ts-ignore`; duplicated block(s), max 20 lines |
| `apps/server/src/routes/ZapRoutes.ts` | 31 | PASS | PASS | PASS | FAIL | — |
| `apps/server/src/routes/index.ts` | 31 | PASS | PASS | PASS | FAIL | — |
| `apps/server/src/seed.ts` | 178 | MIXED | MIXED | PASS | FAIL | largest unit ≈173 lines; 1 log-only catch |
| `apps/server/src/seedCalendar.ts` | 31 | PASS | PASS | PASS | FAIL | — |
| `apps/server/src/services/GmailErrorHandler.ts` | 305 | PASS | MIXED | MIXED | PASS | largest unit ≈276 lines; Prettier drift; exercised by tests |
| `apps/server/src/services/GmailRateLimiter.ts` | 119 | PASS | PASS | MIXED | PASS | Prettier drift; exercised by tests |
| `apps/server/src/services/GmailService.ts` | 420 | MIXED | FAIL | MIXED | PASS | largest unit ≈384 lines; 2× `@ts-ignore`; 1 log-only catch; 1 unused var/import; Prettier drift; exercised by tests |
| `apps/server/src/services/GoogleOAuthService.ts` | 176 | PASS | MIXED | MIXED | PASS | dead exports: `GoogleServiceConfig`; exercised by tests |
| `apps/server/src/services/GoogleSheetsService.ts` | 294 | MIXED | MIXED | MIXED | PASS | largest unit ≈273 lines; 1× `@ts-ignore`; 2 log-only catch; 1 unused var/import; duplicated block(s), max 17 lines; exercised by tests |
| `apps/server/src/services/index.ts` | 8 | PASS | PASS | PASS | PASS | exercised by tests |
| `apps/server/src/swagger-docs.ts` | 467 | PASS | PASS | PASS | FAIL | — |
| `apps/server/src/swagger.ts` | 91 | PASS | PASS | PASS | FAIL | — |
| `apps/server/src/utils/ApiError.ts` | 85 | PASS | PASS | PASS | PASS | exercised by tests |
| `apps/server/src/utils/index.ts` | 4 | PASS | FAIL | FAIL | FAIL | **unreferenced module** |
| `apps/server/src/utils/redis.ts` | 92 | MIXED | PASS | PASS | PASS | 4 log-only catch; exercised by tests |

### apps/server — tests

| File | LOC | P1 Think | P2 Simple | P3 Surgical | P4 Verified | Evidence |
|---|---|---|---|---|---|---|
| `apps/server/tests/actions/actions.test.ts` | 106 | PASS | PASS | MIXED | N/A | Prettier drift; test file |
| `apps/server/tests/auth/error-handling.test.ts` | 205 | PASS | MIXED | MIXED | N/A | largest unit ≈201 lines; Prettier drift; test file |
| `apps/server/tests/auth/integration.test.ts` | 162 | PASS | MIXED | MIXED | N/A | largest unit ≈157 lines; Prettier drift; test file |
| `apps/server/tests/auth/signin.test.ts` | 179 | PASS | MIXED | MIXED | N/A | largest unit ≈172 lines; Prettier drift; test file |
| `apps/server/tests/auth/signup.test.ts` | 178 | PASS | MIXED | MIXED | N/A | largest unit ≈173 lines; 1 unused var/import; Prettier drift; test file |
| `apps/server/tests/googlesheets/googlesheets.test.ts` | 338 | PASS | MIXED | MIXED | N/A | 12× `any`; Prettier drift; test file |
| `apps/server/tests/googlesheets/service.test.ts` | 114 | PASS | PASS | MIXED | N/A | Prettier drift; test file |
| `apps/server/tests/setup.ts` | 135 | PASS | PASS | MIXED | N/A | Prettier drift; test file |
| `apps/server/tests/test-gmail-integration.ts` | 391 | MIXED | FAIL | MIXED | N/A | largest unit ≈349 lines; 15× `any`; 9 log-only catch; 6 unused var/import; Prettier drift; test file |
| `apps/server/tests/test-webhook.ts` | 74 | MIXED | PASS | MIXED | N/A | 4 log-only catch; Prettier drift; test file |
| `apps/server/tests/triggers/triggers.test.ts` | 164 | PASS | PASS | MIXED | N/A | Prettier drift; test file |
| `apps/server/tests/utils.ts` | 48 | PASS | MIXED | MIXED | PASS | dead exports: `makeAuthRequest`; Prettier drift; exercised by tests |
| `apps/server/tests/zaps/zap-crud.test.ts` | 314 | PASS | PASS | MIXED | N/A | 10× `@ts-ignore`; 1 unused var/import; Prettier drift; test file |

### apps/web — frontend

| File | LOC | P1 Think | P2 Simple | P3 Surgical | P4 Verified | Evidence |
|---|---|---|---|---|---|---|
| `apps/web/app/dashboard/page.tsx` | 488 | PASS | PASS | MIXED | FAIL | 2× `@ts-ignore`; 1 unused var/import |
| `apps/web/app/editor/page.tsx` | 29 | PASS | PASS | PASS | FAIL | — |
| `apps/web/app/gmail/page.tsx` | 6 | PASS | PASS | PASS | FAIL | — |
| `apps/web/app/layout.tsx` | 71 | PASS | MIXED | MIXED | FAIL | dead exports: `viewport` |
| `apps/web/app/login/page.tsx` | 27 | PASS | PASS | PASS | FAIL | — |
| `apps/web/app/not-found.tsx` | 20 | PASS | PASS | PASS | FAIL | — |
| `apps/web/app/page.tsx` | 21 | PASS | PASS | PASS | FAIL | — |
| `apps/web/app/profile/page.tsx` | 108 | MIXED | PASS | PASS | FAIL | 1 log-only catch |
| `apps/web/app/sign-up/page.tsx` | 72 | PASS | MIXED | PASS | FAIL | duplicated block(s), max 16 lines |
| `apps/web/components/AuthForm.tsx` | 140 | PASS | PASS | PASS | FAIL | — |
| `apps/web/components/Button.tsx` | 48 | PASS | PASS | PASS | FAIL | — |
| `apps/web/components/FilterBuilder.tsx` | 205 | PASS | MIXED | PASS | FAIL | largest unit ≈169 lines |
| `apps/web/components/FormInput.tsx` | 39 | PASS | PASS | PASS | FAIL | — |
| `apps/web/components/GmailActionConfig.tsx` | 480 | PASS | FAIL | MIXED | FAIL | largest unit ≈454 lines; 4 unused var/import; duplicated block(s), max 27 lines |
| `apps/web/components/GmailDashboard.tsx` | 120 | PASS | PASS | PASS | FAIL | — |
| `apps/web/components/GmailServerConfig.tsx` | 224 | PASS | MIXED | PASS | FAIL | largest unit ≈202 lines; 8× `any`; duplicated block(s), max 35 lines |
| `apps/web/components/GmailStatusMonitor.tsx` | 327 | PASS | MIXED | PASS | FAIL | largest unit ≈296 lines; duplicated block(s), max 17 lines |
| `apps/web/components/GmailTriggerConfig.tsx` | 331 | PASS | MIXED | MIXED | FAIL | largest unit ≈302 lines; 2 unused var/import; duplicated block(s), max 16 lines |
| `apps/web/components/GoogleCalendarTriggerConfig.tsx` | 476 | PASS | FAIL | FAIL | FAIL | **unreferenced module**; largest unit ≈428 lines; 8× `any` |
| `apps/web/components/MainSection.tsx` | 25 | PASS | PASS | PASS | FAIL | — |
| `apps/web/components/Modal.tsx` | 652 | MIXED | FAIL | PASS | FAIL | largest unit ≈624 lines; 3 log-only catch; duplicated block(s), max 21 lines |
| `apps/web/components/Navbar.tsx` | 163 | MIXED | MIXED | PASS | FAIL | largest unit ≈153 lines; 1 log-only catch |
| `apps/web/components/PWAInstaller.tsx` | 61 | MIXED | PASS | PASS | FAIL | 1 log-only catch |
| `apps/web/components/PublishZap.tsx` | 328 | MIXED | MIXED | PASS | FAIL | largest unit ≈305 lines; 2 log-only catch |
| `apps/web/components/Spinner.tsx` | 23 | PASS | PASS | PASS | FAIL | — |
| `apps/web/components/TelegramActionConfig.tsx` | 205 | PASS | FAIL | FAIL | FAIL | **unreferenced module**; largest unit ≈182 lines; 1 unused var/import; duplicated block(s), max 52 lines |
| `apps/web/components/TelegramBotConfig.tsx` | 239 | PASS | FAIL | FAIL | FAIL | **unreferenced module**; largest unit ≈218 lines; duplicated block(s), max 15 lines |
| `apps/web/components/TelegramTriggerConfig.tsx` | 266 | PASS | FAIL | FAIL | FAIL | **unreferenced module**; largest unit ≈232 lines; duplicated block(s), max 17 lines |
| `apps/web/components/Tooltip.tsx` | 16 | PASS | PASS | PASS | FAIL | — |
| `apps/web/components/WhatsAppActionConfig.tsx` | 203 | PASS | FAIL | FAIL | FAIL | **unreferenced module**; largest unit ≈179 lines; 1 unused var/import; duplicated block(s), max 52 lines |
| `apps/web/components/WhatsAppServerConfig.tsx` | 281 | PASS | FAIL | FAIL | FAIL | **unreferenced module**; largest unit ≈259 lines; duplicated block(s), max 35 lines |
| `apps/web/components/WhatsAppTriggerConfig.tsx` | 254 | PASS | FAIL | FAIL | FAIL | **unreferenced module**; largest unit ≈221 lines; duplicated block(s), max 17 lines |
| `apps/web/components/ZapCell.tsx` | 72 | PASS | PASS | PASS | FAIL | — |
| `apps/web/components/ZapRunHistory.tsx` | 180 | PASS | MIXED | PASS | FAIL | largest unit ≈157 lines |
| `apps/web/components/metadata/EmailMetaData.tsx` | 40 | PASS | PASS | PASS | FAIL | — |
| `apps/web/components/metadata/GitHubMetaData.tsx` | 166 | PASS | MIXED | PASS | FAIL | largest unit ≈151 lines |
| `apps/web/components/metadata/GmailMetaData.tsx` | 182 | PASS | MIXED | PASS | FAIL | largest unit ≈169 lines |
| `apps/web/components/metadata/GoogleCalendarMetaData.tsx` | 248 | MIXED | MIXED | PASS | FAIL | largest unit ≈231 lines; 3 log-only catch; duplicated block(s), max 31 lines |
| `apps/web/components/metadata/GoogleSheetsMetaData.tsx` | 157 | MIXED | MIXED | PASS | FAIL | 2 log-only catch; duplicated block(s), max 31 lines |
| `apps/web/components/metadata/ScheduleMetaData.tsx` | 200 | PASS | MIXED | PASS | FAIL | largest unit ≈188 lines |
| `apps/web/components/metadata/SolanaMetaData.tsx` | 32 | PASS | PASS | PASS | FAIL | — |
| `apps/web/components/metadata/WebhookMetaData.tsx` | 57 | PASS | PASS | PASS | FAIL | — |
| `apps/web/components/metadata/index.ts` | 10 | PASS | PASS | PASS | FAIL | — |
| `apps/web/components/modal/constants.ts` | 66 | PASS | PASS | PASS | FAIL | — |
| `apps/web/components/modal/index.ts` | 4 | PASS | FAIL | FAIL | FAIL | **unreferenced module** |
| `apps/web/components/modal/types.ts` | 35 | PASS | MIXED | MIXED | FAIL | dead exports: `MetaDataWithTypeProps` |
| `apps/web/context/AuthProvider.tsx` | 8 | PASS | FAIL | FAIL | FAIL | **unreferenced module** |
| `apps/web/helper.ts` | 51 | PASS | PASS | PASS | FAIL | — |
| `apps/web/lib/auth.ts` | 83 | PASS | FAIL | FAIL | FAIL | **unreferenced module**; dead exports: `checkAuth`, `fetchWithAuth`, `getStoredUser`, `storeUser` |
| `apps/web/lib/config.ts` | 5 | PASS | PASS | PASS | FAIL | — |
| `apps/web/lib/oauth.ts` | 50 | PASS | PASS | PASS | FAIL | — |
| `apps/web/next.config.ts` | 9 | PASS | PASS | PASS | FAIL | — |
| `apps/web/tailwind.config.ts` | 58 | PASS | PASS | PASS | FAIL | — |

### apps/worker · apps/processor · apps/hooks

| File | LOC | P1 Think | P2 Simple | P3 Surgical | P4 Verified | Evidence |
|---|---|---|---|---|---|---|
| `apps/hooks/src/googleCalendarHandler.ts` | 296 | MIXED | MIXED | MIXED | FAIL | dead exports: `setupCalendarWatch`, `stopCalendarWatch`; largest unit ≈158 lines; 3 log-only catch; 1 unused var/import |
| `apps/hooks/src/index.ts` | 296 | MIXED | MIXED | MIXED | FAIL | 14× `any`; 2 log-only catch; 2 unused var/import |
| `apps/hooks/src/telegramHandler.ts` | 173 | FAIL | MIXED | PASS | FAIL | 1 log-only catch; `req.body` used with no schema validation; duplicated block(s), max 16 lines |
| `apps/hooks/src/whatsappHandler.ts` | 171 | FAIL | MIXED | PASS | FAIL | 2 log-only catch; `req.body` used with no schema validation; duplicated block(s), max 16 lines |
| `apps/processor/src/googleSheetsPoller.ts` | 176 | MIXED | FAIL | FAIL | FAIL | **unreferenced module**; dead exports: `pollGoogleSheetsTriggers`; 1× `@ts-ignore`; 2 log-only catch; 1 unused var/import; duplicated block(s), max 17 lines |
| `apps/processor/src/index.ts` | 260 | PASS | MIXED | MIXED | FAIL | 1 unused var/import; duplicated block(s), max 13 lines |
| `apps/processor/src/pollers/BasePoller.ts` | 127 | PASS | PASS | PASS | FAIL | — |
| `apps/processor/src/pollers/GoogleCalendarPoller.ts` | 489 | MIXED | FAIL | PASS | FAIL | largest unit ≈476 lines; 10× `any`; 1× `@ts-ignore`; 2 log-only catch; duplicated block(s), max 13 lines |
| `apps/processor/src/pollers/GoogleSheetsPoller.ts` | 167 | MIXED | MIXED | PASS | FAIL | 1× `@ts-ignore`; 2 log-only catch; duplicated block(s), max 13 lines |
| `apps/processor/src/pollers/index.ts` | 94 | MIXED | PASS | PASS | FAIL | 2 log-only catch |
| `apps/processor/src/pollers/types.ts` | 30 | PASS | MIXED | MIXED | FAIL | dead exports: `TriggerWithServer` |
| `apps/worker/src/evaluateFilters.ts` | 96 | PASS | PASS | PASS | FAIL | — |
| `apps/worker/src/index.ts` | 459 | MIXED | FAIL | MIXED | FAIL | largest unit ≈166 lines; 19× `any`; 2× `@ts-ignore`; 1 log-only catch; 1 unused var/import; duplicated block(s), max 13 lines |
| `apps/worker/src/sendSolana.ts` | 33 | MIXED | PASS | PASS | FAIL | 1 log-only catch |
| `apps/worker/src/sendTelegram.ts` | 131 | MIXED | FAIL | MIXED | FAIL | dead exports: `replyToMessage`, `sendTelegramDocument`, `sendTelegramPhoto`; 1 log-only catch; duplicated block(s), max 19 lines |
| `apps/worker/src/sendWebhook.ts` | 87 | PASS | PASS | PASS | FAIL | — |
| `apps/worker/src/sendWhatsApp.ts` | 117 | MIXED | MIXED | MIXED | FAIL | dead exports: `sendWhatsAppTemplateMessage`; 2 log-only catch |
| `apps/worker/src/utils/retry.ts` | 102 | MIXED | MIXED | MIXED | FAIL | dead exports: `isRetryableError`; 1 log-only catch |

### packages/ — shared packages

| File | LOC | P1 Think | P2 Simple | P3 Surgical | P4 Verified | Evidence |
|---|---|---|---|---|---|---|
| `packages/db/src/index.ts` | 6 | PASS | PASS | PASS | PASS | exercised by tests |
| `packages/email/src/index.ts` | 312 | MIXED | MIXED | MIXED | PASS | dead exports: `sendEmailWithHtmlBody`; 1× `@ts-ignore`; 7 log-only catch; duplicated block(s), max 24 lines; exercised by tests |
| `packages/kafka/src/index.ts` | 91 | PASS | FAIL | MIXED | FAIL | dead exports: `TOPICS`, `createConsumer`, `createProducer`; Prettier drift |
| `packages/logger/src/index.ts` | 72 | PASS | FAIL | FAIL | FAIL | **unreferenced module**; dead exports: `logError`, `requestLogger` |
| `packages/redis/src/index.d.ts` | 4 | PASS | FAIL | FAIL | FAIL | **unreferenced module** |
| `packages/redis/src/index.ts` | 28 | PASS | PASS | PASS | PASS | exercised by tests |
| `packages/sentry/src/index.ts` | 116 | PASS | MIXED | MIXED | FAIL | dead exports: `clearUser` |
| `packages/types/src/index.ts` | 133 | PASS | PASS | PASS | PASS | exercised by tests |
| `packages/ui/src/button.tsx` | 18 | PASS | FAIL | FAIL | FAIL | **unreferenced module** |
| `packages/ui/src/card.tsx` | 26 | PASS | FAIL | FAIL | FAIL | **unreferenced module** |
| `packages/ui/src/code.tsx` | 10 | PASS | FAIL | FAIL | FAIL | **unreferenced module**; dead exports: `Code` |
| `packages/ui/turbo/generators/config.ts` | 31 | PASS | PASS | PASS | FAIL | — |

---

## 5. Appendix

### A. Measurements (all reproduced by running the tools listed in §2)

| Metric | Value |
|---|---|
| TypeScript/TSX files | 147 (22,167 lines; 17,390 code lines) |
| ESLint | 0 errors, **426 warnings** — 392 `no-explicit-any`, 34 `no-unused-vars` |
| Prettier | **29 / 145 files** not formatted per the repo's own config |
| jscpd duplication | 46 clones, 848 duplicated lines, **3.49%** |
| Unreferenced modules | **17** |
| Dead exports | **26** across 17 files |
| Units > 80 / > 120 / > 250 lines | **50 / 37 / 11** |
| `@ts-ignore` / `@ts-expect-error` | 90 occurrences |
| `console.*` calls | 453 (vs. zero imports of the `@repo/logger` package) |
| Log-only catches (no rethrow, no error response) | **85** across 40 files |
| Files reading `req.body` with no schema validation | **9** |
| Test reachability | 32 / 147 files (22%); 84 tests, all passing |
| CI steps that run tests | **0** |
| Env vars read in code / documented | 41 / 32 (14 undocumented, 5 documented-but-unread, 1 name mismatch) |

### B. Dead-code inventory (delete or justify)

**Unreferenced modules (17)** — no importer, static or dynamic:

```
apps/processor/src/googleSheetsPoller.ts                               176 lines  (superseded by pollers/GoogleSheetsPoller.ts)
apps/server/src/utils/index.ts                                           4 lines  (barrel, unused)
apps/web/components/GoogleCalendarTriggerConfig.tsx                    476 lines  (superseded by components/metadata/GoogleCalendarMetaData.tsx)
apps/web/components/TelegramActionConfig.tsx                           205 lines
apps/web/components/TelegramBotConfig.tsx                              239 lines
apps/web/components/TelegramTriggerConfig.tsx                          266 lines  (all three superseded by components/metadata/* + Modal.tsx inline flow)
apps/web/components/WhatsAppActionConfig.tsx                           203 lines
apps/web/components/WhatsAppServerConfig.tsx                           281 lines
apps/web/components/WhatsAppTriggerConfig.tsx                          254 lines
apps/web/components/modal/index.ts                                       4 lines
apps/web/context/AuthProvider.tsx                                        8 lines
apps/web/lib/auth.ts                                                    83 lines  (checkAuth/fetchWithAuth/storeUser/getStoredUser all dead)
packages/logger/src/index.ts                                            72 lines  (whole package unused; pino + pino-pretty deps)
packages/redis/src/index.d.ts                                            4 lines
packages/ui/src/{button,card,code}.tsx                                  54 lines  (create-turbo scaffolding; @repo/ui has no consumer)
```

**Dead exports inside otherwise-live files (selection):** `packages/kafka` → `TOPICS`, `createConsumer`, `createProducer`; `apps/worker/src/sendTelegram.ts` → `replyToMessage`, `sendTelegramDocument`, `sendTelegramPhoto`; `apps/worker/src/sendWhatsApp.ts` → `sendWhatsAppTemplateMessage`; `apps/worker/src/utils/retry.ts` → `isRetryableError` (notably: retry logic exists but the *retryability* check is never consulted, so non-retryable errors are retried); `apps/hooks/src/googleCalendarHandler.ts` → `setupCalendarWatch`, `stopCalendarWatch`; `packages/email/src/index.ts` → `sendEmailWithHtmlBody`; `apps/server/src/controllers/GmailWebhookController.ts` → `renewGmailWatch`.

**Declared-but-unused dependencies:** `lodash` (`packages/email`), `@sentry/profiling-node` (`packages/sentry`), `@google-cloud/local-auth` (`apps/server`), plus `@repo/logger`/`@repo/ui` which nothing depends on at all.

### C. Duplication report (jscpd, ≥12 lines)

| Lines | Clone |
|---|---|
| 52 | `components/TelegramActionConfig.tsx:144-195` ↔ `components/WhatsAppActionConfig.tsx:146-193` (both dead) |
| 35 | `components/GmailServerConfig.tsx:189-223` ↔ `components/WhatsAppServerConfig.tsx:246-280` |
| 31 | `controllers/GoogleCalendarController.ts:32-62` ↔ `controllers/GoogleSheetsController.ts:33-63` (OAuth callback skeleton) |
| 28 | `controllers/GmailController.ts:381-408` ↔ `:185-341` (internal repetition) |
| 26 | `controllers/GoogleCalendarTriggersController.ts:54-79` ↔ `controllers/GoogleSheetsTriggersController.ts:24-49` |
| 18 | `controllers/GmailTriggersController.ts:112-129` ↔ `controllers/ZapController.ts:338-355` — **`processGmailTrigger` implemented twice** |
| 17 | `processor/src/googleSheetsPoller.ts:37-53` ↔ `server/src/services/GoogleSheetsService.ts:225-241` |
| 16 | `controllers/AuthController.ts:72-87` ↔ `:12-26` (validation + duplicate-user branch) |
| 13 | `processor/src/pollers/GoogleCalendarPoller.ts:57-69` ↔ `pollers/GoogleSheetsPoller.ts:61-73` |

…plus 37 more pairs at 12–20 lines. The clone clusters are all "one integration copied to make the next integration", which is the classic source of this codebase's bugs: the same fix must be applied in 3–4 places (`processGmailTrigger` proves it — the two copies have already diverged).

### D. Configuration drift (Silent-assumption class)

| Variable | Read in code | Documented in `.env.example` | Problem |
|---|---|---|---|
| `SOL_PRIVATE_KEY` / `SOLANA_PRIVATE_KEY` | code reads `SOL_PRIVATE_KEY` (`worker/src/index.ts:112`, `sendSolana.ts:15`) | docs say `SOLANA_PRIVATE_KEY` | **name mismatch → feature silently disabled** |
| `GMAIL_WEBHOOK_SECRET` | read at `GmailWebhookController.ts:179` | present but commented out | unset ⇒ verification **returns true** |
| `WEBHOOK_SECRET` | read at `TriggerController.ts:80` with literal fallback | present | fallback key `'default-secret'` in source |
| `CRON_SECRET` | `CronRoutes.ts:15`, `processor/src/index.ts:61-224` | **not documented** | unset ⇒ guard comparison is `undefined === undefined` ⇒ **fails open** |
| `API_URL`, `HOOKS_URL`, `GITHUB_WEBHOOK_SECRET`, `GMAIL_REDIRECT_URI`, `WHATSAPP_VERIFY_TOKEN`, `SENTRY_DSN`, `LOG_LEVEL`, `SERVICE_NAME`, `RELEASE_VERSION`, `EMAIL_RATE_LIMIT_PER_HOUR`, `EMAIL_RECIPIENT_COOLDOWN`, `CALENDAR_WEBHOOKS_ENABLED`, `KAFKA_SASL_MECHANISM` | yes | no | undocumented — a deployer cannot know they exist (this is the same class of bug as `learnings/01` §6 "no triggers available (DB not seeded)") |
| `DATABASE_URL`, `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `SMTP_PASSWORD` | only via Prisma/Google SDK/legacy SMTP path | yes | documented but not read directly — `SMTP_*` survives in `apps/server/src/env.ts:11-14` from the pre-Resend design |

### E. What is genuinely compliant (keep doing this)

- **Explicit assumptions where they matter most:** `apps/server/src/env.ts` fails fast and loud on missing required config; `apps/server/src/middlewares/validateRequest.ts` + `packages/types` give one validation boundary shared by client and server.
- **Verification-as-documentation:** `learnings/01-deployment-bugs-and-fixes.md` … `08-bun-workspace-symlinks-in-docker.md` and `artifacts/04-test-suite-plan.md` are exactly the artifacts Principle 4 asks for — written success criteria, root causes, and lessons. The repo's documentation habit is its strongest asset.
- **Simplicity where it counts:** `packages/types` (133 lines), `packages/db` (6), `apps/server/src/helper.ts` (10), `apps/worker/src/utils/retry.ts` (102), `middlewares/compression.ts` (24), `lib/config.ts` (5). These are 50-line solutions to 50-line problems.
- **Operational verification:** a real `/health` endpoint with a DB probe (`apps/server/src/index.ts:66-79`), graceful shutdown with a forced-exit timeout (`:97-135`), `trust proxy` set correctly for `express-rate-limit` behind Render, and rate limiters on every public surface.
- **Focused reads of dead code I did NOT delete** (per Principle 3, it gets mentioned, not removed — see §B for the full list).

### F. Prioritized action list (mapped to principles)

**Fix now — correctness and security, each with the test that proves it fixed (P1 + P4):**

1. `GmailWebhookController.ts:182` — change the missing-secret branch to `return false` (fail closed). *Verify:* a test asserting `verifyGmailWebhookSignature(headers, body) === false` when the secret is unset.
2. `CronRoutes.ts:15` — reject when `CRON_SECRET` is unset: `if (!process.env.CRON_SECRET || cronSecret !== process.env.CRON_SECRET)`. Same pattern in `apps/processor/src/index.ts:61-224` and `apps/worker/src/index.ts:390`. *Verify:* a test per endpoint asserting 401 with no secret configured.
3. `TriggerController.ts:26,79` — require the signature (don't treat absence as "unsigned is fine") and remove the `'default-secret'` fallback. *Verify:* tests for (a) missing header, (b) wrong signature, (c) correct signature.
4. `SOL_PRIVATE_KEY` vs `SOLANA_PRIVATE_KEY` — pick one name, document it, and make the worker fail fast at boot rather than silently skipping the action.
5. `ZapController.ts:296-297, 340-341` — don't swallow action failures; record per-action status on the `ZapRun` so "success" means something. *Verify:* a test where one action throws and the run is marked partial/failed.

**Then — the verification loop that makes the above repeatable (P4):**

6. Add `jest` to `.github/workflows/deploy.yml`'s `test` job (one line — the suite currently runs nowhere) and drop `--forceExit` by closing the Upstash Redis handle (Jest hangs at exit today).
7. Execute `artifacts/04-test-suite-plan.md` — it already prioritizes Zap/Trigger/Actions controller coverage; that's ~200 lines of tests against mocks that `tests/setup.ts` already provides.
8. Add a small behavioural test layer for the two `processGmailTrigger` copies so divergent duplicates get caught instead of drifting further.
9. Add smoke tests for the worker's `replaceKeys` / `evaluateFilters` (pure functions, no infra needed — cheapest coverage in the repo).

**Then — simplify (P2), in this order of payoff:**

10. Delete the 17 unreferenced modules (§B) and the 3 unused dependencies; either wire `@repo/logger` in or delete it (453 `console.*` calls suggest the intent was real).
11. Collapse the integration duplication: extract the OAuth-callback skeleton shared by the Sheets/Calendar controllers, and unify `processGmailTrigger` into one implementation.
12. Split the 11 units over 250 lines — start with `createZap` (extract per-trigger-type creation into ~5 functions) and `Modal.tsx` (extract the three wizard steps into components).
13. Replace `@ts-ignore`-to-pass-`req.id` with a single declared augmentation of Express `Request`, then delete the ~30 suppressions that become unnecessary.
14. Reduce `any` from 392: type the four integration-controller request bodies with the zod schemas already in `packages/types`.

**Finally — hygiene (P3):**

15. Run `npx prettier --write` on the 29 drifted files in a dedicated "formatting only" commit (never mixed with behaviour changes — that's the rule).
16. Remove the leftover SMTP env block from `env.ts` and the Railway remnants, or document why they stay.
17. Add a one-line note to `artifacts/task.md` acknowledging the dead UI generation, so the next reader doesn't wire it up by mistake.

### G. Method limits — read this before quoting the per-file verdicts

- **These rules are behavioural, not structural.** Verdicts are proxies (§2). A PASS means "no violation detectable by the proxy", not "this file was written by a disciplined agent".
- **History is squashed to one commit**, so Principle 3 could only be judged from in-tree residue (orphans, drift, superseded modules) — not from diffs.
- **The P4 column is structural, not accusatory.** 103 files FAIL because the layer they live in (web UI, background services) has no test infrastructure at all. That's one finding about the repo, repeated per file by construction.
- **The `longest unit` figure** comes from a brace-matching approximation, so it is accurate to ±a few lines and can mis-attribute a unit name for files with nested declarations (e.g. it reports `zapId` for one `ZapController` body). The line counts of the top offenders were spot-checked by hand.
- **The `any` count** in §A is ESLint's `no-explicit-any` (392) — a regex over raw text finds 402 because it also matches the word "any" in prose.
- **Not audited:** Prisma schema design, Docker images, deployment topology, README accuracy, dependency vulnerabilities (`npm audit` reports 141 advisories — a security concern, but not a Karpathy-guidelines concern), and runtime behaviour of anything requiring a live Postgres/Kafka/Redis (none available in this sandbox).
- **Environment note:** `bun` is not installed here, so npm was used; `prisma generate` cannot fetch engines from `binaries.prisma.sh`, so `tsc` on `apps/server` reports pre-existing module-resolution errors (`@repo/types`, `nodemailer` types, `PrismaClient`) that are environment artifacts, not code defects.
