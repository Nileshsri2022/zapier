# Karpathy Guidelines — Compliance Audit

**Repository:** `Nileshsri2022/zapier` (ZapMate) · branch `arena/ab5c16e4-zapier` @ `5ca89d9`
**Audit date:** 2026-10-16
**Ruleset audited:** [`karpathy-guidelines` SKILL.md](https://github.com/multica-ai/andrej-karpathy-skills/blob/main/skills/karpathy-guidelines/SKILL.md) — the four principles derived from Andrej Karpathy's observations on LLM coding pitfalls (MIT, community-published by Forrest Chang; not written by Karpathy himself).
**Scope:** 147 TypeScript/TSX files, 22,167 lines (17,390 non-comment/non-blank code lines), across `apps/{server,web,worker,processor,hooks}` and `packages/*`.

**Audited revision:** `5ca89d9`. Note for anyone reading this after `main` moved: `main` has since gained the guidelines themselves at `.agents/skills/andrej-karapathy-guidelines/readme.md` (`c114543`, not an ancestor of this branch). Its front-matter name is `karpathy-guidelines` and its text is **identical to the upstream SKILL.md this audit used as the rubric** — so the two agree. At the audited revision no such file existed anywhere in the tree, which is why §2 derives the criteria from the upstream copy rather than from the repository itself.

> **Status:** §1–§5 below are the **as-found audit** (§6 is the remediation log: what has since been fixed, with the commit and the test that proves it). The grades in §1 describe the code as it was when audited, so the original findings stay readable; §6 tracks them to done.

---

## 0. Completion status — read this first

Backlog state: **10 of 17 items in §F are done, 4 are partly done, 3 have not been started.** Each item below carries the commit that proves it, or the exact gap that remains. The same marks appear inline in §F, and §B/§D are annotated too.

Legend — ✅ frozen, verified · 🟡 partly done, gap named · ⬜ not started.

### ✅ Done (10)

- [x] **1. Gmail webhook signature fails closed** — `a0f38ce` · 4 of the 12 security tests fail on pre-fix code
- [x] **2. All cron/worker secret guards fail closed** — `a0f38ce` · server route + 5 processor guards + 1 worker guard
- [x] **3. Webhook signatures mandatory, `'default-secret'` fallback deleted** — `a0f38ce` · *one deliberate deviation, explained in §6.1*
- [x] **5. Failed Zap runs recorded instead of swallowed** — `66f931b` · 6 of 8 run-status tests fail on pre-fix code
- [x] **6. CI runs both test suites; `--forceExit` removed** — `8b05882` · Jest now exits on its own in ~2.6s
- [x] **8. Behavioural coverage for the duplicated Gmail trigger** — `66f931b` · resolved by *eliminating* the duplicate; the survivor has a failing-action test
- [x] **10. 17 unreferenced modules and 5 unused deps deleted** — `5c55d53` · 2,442 lines; `@repo/logger` deleted rather than wired in
- [x] **15. Prettier drift fixed, formatting-only commit** — `3645645` · 29 files, `prettier --check` passes repo-wide
- [x] **16. SMTP block and Railway config justified instead of removed** — documented in `env.ts` and §F item 16; the audit's "leftover" premise was wrong for both
- [x] **17. Note about the dead UI generation in `task.md`** — obsolete: the files are deleted, and no file in `artifacts/` references them (checked)

### 🟡 Partly done (4)

- [x] 🟡 **4. `SOLANA_PRIVATE_KEY` naming resolved and documented** — `0e42a38` · **gap:** the worker does *not* fail fast at boot; the guard sits at action level and returns an explicit failure instead (justified in §6.2 — the worker also serves Zaps with no Solana step)
- [x] 🟡 **7. Execute the test-suite plan** — 20 new tests landed (12 security + 8 run-status) on the Zap/webhook paths · **gap:** the plan's Gmail/Actions-controller scope is still unwritten
- [x] 🟡 **9. Worker smoke tests** — `0e42a38` · 5 `evaluateFilters` tests + 4 on the key resolver · **gap:** `replaceKeys`, the other function this item names, still has none
- [x] 🟡 **11. Integration duplication collapsed** — `66f931b` · `processGmailTrigger` unified (−49 lines) · **gap:** the Sheets/Calendar OAuth-callback skeleton is still copy-pasted (31 identical lines)

### ⬜ Not started (3)

- [ ] **12. ⬜ **NOT STARTED** —** — `createZap` (192), `Modal.tsx` (624), `GoogleCalendarPoller` (476), `GmailService` (384)
- [ ] **13. Replace ~30 `@ts-ignore`-to-pass-`req.id` with one Express augmentation**
- [ ] **14. Type the integration request bodies with the zod schemas already in `packages/types`** — `any` is 350 now, but that came from deleting code, not from typing

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
$ npx jest                               # server: 9 suites, 84 tests (as found)
$ npx jest  # no --forceExit after the leaks were fixed: 11 suites, 104 tests
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

> **Note:** §F below is the prioritized fix list this audit produced. It now carries a status mark per item (10 done, 4 partial, 3 not started) — see §0 for the roll-up and §6 for the commit and the test that proves each fix.

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

**Unreferenced modules (17)** — no importer, static or dynamic — ✅ **all 17 deleted** in `5c55d53` (2,442 lines; the list is kept as the as-found record):

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

**Declared-but-unused dependencies:** ✅ **all removed** in `5c55d53` — `lodash` (`packages/email`), `@sentry/profiling-node` (`packages/sentry`), `@google-cloud/local-auth` (`apps/server`), plus `@repo/logger`/`@repo/ui`.

⚠️ **One caveat on that deletion:** `bun.lock` still lists the three dependencies. It cannot be regenerated in this sandbox (no `bun` installed) — run `bun install` once before merging.

**Dead exports (26 → 19):** ✅ the ones listed above were deleted with their modules; the 19 that survive are inside otherwise-live files and are listed in §6.8 item 5. The `utils/retry.ts` observation in this paragraph still stands and is worth acting on — `isRetryableError` is exported and never consulted, so non-retryable errors are retried.

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

| Variable | Read in code | Documented in `.env.example` | Problem | Status |
|---|---|---|---|---|
| `SOL_PRIVATE_KEY` / `SOLANA_PRIVATE_KEY` | code reads `SOL_PRIVATE_KEY` (`worker/src/index.ts:112`, `sendSolana.ts:15`) | docs say `SOLANA_PRIVATE_KEY` | **name mismatch → feature silently disabled** | ✅ fixed `0e42a38` — both names accepted, documented name wins |
| `GMAIL_WEBHOOK_SECRET` | read at `GmailWebhookController.ts:179` | present but commented out | unset ⇒ verification **returns true** | ✅ fixed `a0f38ce` — unset now returns false; added to the examples |
| `WEBHOOK_SECRET` | read at `TriggerController.ts:80` with literal fallback | present | fallback key `'default-secret'` in source | ✅ fixed `a0f38ce` — fallback deleted; signatures mandatory when set |
| `CRON_SECRET` | `CronRoutes.ts:15`, `processor/src/index.ts:61-224` | **not documented** | unset ⇒ guard comparison is `undefined === undefined` ⇒ **fails open** | ✅ fixed `a0f38ce` — unset now rejects; documented in all three examples |
| `API_URL`, `HOOKS_URL`, `GITHUB_WEBHOOK_SECRET`, `GMAIL_REDIRECT_URI`, `WHATSAPP_VERIFY_TOKEN`, `SENTRY_DSN`, `LOG_LEVEL`, `SERVICE_NAME`, `RELEASE_VERSION`, `EMAIL_RATE_LIMIT_PER_HOUR`, `EMAIL_RECIPIENT_COOLDOWN`, `CALENDAR_WEBHOOKS_ENABLED`, `KAFKA_SASL_MECHANISM` | yes | no | undocumented — a deployer cannot know they exist (this is the same class of bug as `learnings/01` §6 "no triggers available (DB not seeded)") | 🟡 partly fixed `0e42a38` — the five vars that *broke features* are now documented, and `LOG_LEVEL`/`SERVICE_NAME` were added. A re-scan still finds **17 vars read in code but absent from the examples** (see §6.8 item 9) |
| `SMTP_PASSWORD` | code reads **`SMTP_PASS`** (`ActionsController.ts:45`) | `apps/worker/.env.example:19` says `SMTP_PASSWORD` | **name mismatch → the Email action cannot authenticate against a config built from the docs** (corrected below — see §6.3) | ✅ fixed `0e42a38` — code accepts either name |
| `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET` | code reads **`GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`** in all three Google services | root `.env.example:6-7` says `GMAIL_CLIENT_*` | **stale root doc**: anyone configuring from it sets vars nothing reads. `apps/server/.env.example:19-20` has the correct names. | ✅ fixed `0e42a38` — root example corrected |
| `DATABASE_URL` | consumed by Prisma itself, not via `process.env` | yes | expected, not a finding — Prisma reads it from the environment directly | ➖ no action |

> **Correction (found during remediation):** the first version of this table listed `SMTP_PASSWORD` as *dead config left over from the pre-Resend design*. That was **wrong**: `ActionsController.ts:40-55` genuinely reads `SMTP_HOST/PORT/USER/PASS` for the nodemailer-based Email action. The real defect is a **name mismatch**, and it is worse than dead config — following the docs produces a silently non-functional action. Corrected in §6.3.

### E. What is genuinely compliant (keep doing this)

- **Explicit assumptions where they matter most:** `apps/server/src/env.ts` fails fast and loud on missing required config; `apps/server/src/middlewares/validateRequest.ts` + `packages/types` give one validation boundary shared by client and server.
- **Verification-as-documentation:** `learnings/01-deployment-bugs-and-fixes.md` … `08-bun-workspace-symlinks-in-docker.md` and `artifacts/04-test-suite-plan.md` are exactly the artifacts Principle 4 asks for — written success criteria, root causes, and lessons. The repo's documentation habit is its strongest asset.
- **Simplicity where it counts:** `packages/types` (133 lines), `packages/db` (6), `apps/server/src/helper.ts` (10), `apps/worker/src/utils/retry.ts` (102), `middlewares/compression.ts` (24), `lib/config.ts` (5). These are 50-line solutions to 50-line problems.
- **Operational verification:** a real `/health` endpoint with a DB probe (`apps/server/src/index.ts:66-79`), graceful shutdown with a forced-exit timeout (`:97-135`), `trust proxy` set correctly for `express-rate-limit` behind Render, and rate limiters on every public surface.
- **Focused reads of dead code I did NOT delete** (per Principle 3, it gets mentioned, not removed — see §B for the full list).

### F. Prioritized action list (mapped to principles) — ✅ status as of `3645645`

Each item keeps its original instruction (so the reasoning behind it stays visible) followed by **→ now:** the outcome. Full detail in §6.

**Fix now — correctness and security, each with the test that proves it fixed (P1 + P4):**

1. ✅ **DONE** (`a0f38ce`) — `GmailWebhookController.ts:182`: change the missing-secret branch to `return false` (fail closed). *Verify:* a test asserting `verifyGmailWebhookSignature(headers, body) === false` when the secret is unset. **→ now:** that exact test exists and fails on the pre-fix code, part of a 12-test security suite (§6.1).
2. ✅ **DONE** (`a0f38ce`) — `CronRoutes.ts:15`: reject when `CRON_SECRET` is unset (`if (!process.env.CRON_SECRET || cronSecret !== process.env.CRON_SECRET)`), same pattern in `apps/processor/src/index.ts:61-224` and `apps/worker/src/index.ts:390`. *Verify:* a test per endpoint asserting 401 with no secret configured. **→ now:** all 7 guards fixed; the server route is asserted through the real handler.
3. ✅ **DONE, with one deliberate deviation** (`a0f38ce`) — `TriggerController.ts:26,79`: require the signature (don't treat absence as "unsigned is fine") and remove the `'default-secret'` fallback. *Verify:* tests for (a) missing header, (b) wrong signature, (c) correct signature. **→ now:** the fallback is gone and signatures are mandatory **whenever a secret is configured** — enforcing them unconditionally would have broken the product's primary inbound-webhook trigger type. Rationale and tests in §6.1.
4. 🟡 **PARTLY DONE** (`0e42a38`) — `SOL_PRIVATE_KEY` vs `SOLANA_PRIVATE_KEY`: pick one name, document it, and make the worker fail fast at boot rather than silently skipping the action. **→ now:** naming and documentation done (documented name wins, legacy still honoured, 4 tests). **Gap:** no boot-time failure — the guard sits at action level and returns an explicit `{ success: false, message: 'SOLANA_PRIVATE_KEY not configured' }` instead, because the worker also serves Zaps that contain no Solana step and a boot crash would take those down too. Reasoned in §6.2; open to a different call.
5. ✅ **DONE** (`66f931b`) — `ZapController.ts:296-297, 340-341`: don't swallow action failures; record per-action status on the `ZapRun` so "success" means something. *Verify:* a test where one action throws and the run is marked partial/failed. **→ now:** status/errorMessage/completedAt recorded; 6 of the 8 run-status tests fail on pre-fix code. The runner still returns 200 on purpose — §6.3.

**Then — the verification loop that makes the above repeatable (P4):**

6. ✅ **DONE** (`8b05882`) — add `jest` to `.github/workflows/deploy.yml`'s `test` job (the suite ran nowhere) and drop `--forceExit` by closing the Upstash Redis handle. **→ now:** both suites run in CI and `--forceExit` is gone — but the diagnosis in this item was wrong: the hang came from a module-level `setInterval` in `csrf.ts` plus a real SMTP socket opened by tests, not the Redis handle. §6.4.
7. 🟡 **PARTLY DONE** — execute `artifacts/04-test-suite-plan.md`; it already prioritizes Zap/Trigger/Actions controller coverage (~200 lines of tests against mocks `tests/setup.ts` provides). **→ now:** 20 new tests landed on the Zap-trigger and webhook paths (12 security, 8 run-status). **Gap:** the plan's Gmail/Actions-controller scope is still unwritten — see §6.8 item 4.
8. ✅ **DONE** (`66f931b`) — add a behavioural test layer for the two `processGmailTrigger` copies so divergent duplicates get caught instead of drifting further. **→ now:** resolved the better way — there is only **one** `processGmailTrigger` again, and it has a failing-action test. No duplicate left to test against.
9. 🟡 **PARTLY DONE** (`0e42a38`) — add smoke tests for the worker's `replaceKeys` / `evaluateFilters` (pure functions, no infra needed — cheapest coverage in the repo). **→ now:** the worker has a test runner at all, with 5 `evaluateFilters` tests and 4 on the Solana key resolver. **Gap:** `replaceKeys` still has none (§6.8 item 7).

**Then — simplify (P2), in this order of payoff:**

10. ✅ **DONE** (`5c55d53`) — delete the 17 unreferenced modules (§B) and the unused dependencies; either wire `@repo/logger` in or delete it (453 `console.*` calls suggest the intent was real). **→ now:** 17 modules and 5 packages' worth of deps removed — 2,442 lines. `@repo/logger` was **deleted**, not wired in; the `console.*` calls now say plainly that the logger was aspirational.
11. 🟡 **PARTLY DONE** (`66f931b`) — collapse the integration duplication: extract the OAuth-callback skeleton shared by the Sheets/Calendar controllers, and unify `processGmailTrigger` into one implementation. **→ now:** the second half is done (one implementation, −49 lines). **Gap:** `GoogleCalendarController.ts:32-62` ↔ `GoogleSheetsController.ts:33-63` are a 31-line block of which **29 lines are byte-identical** (verified by `diff`; only the error message and the model name differ — which is exactly why a shared helper is worth it).
12. ⬜ **NOT STARTED** — split the 11 units over 250 lines, starting with `createZap` (extract per-trigger-type creation into ~5 functions) and `Modal.tsx` (extract the three wizard steps into components). Largest now: `Modal.tsx` 624, `GoogleCalendarPoller.ts` 476, `GmailService.ts` 384, `createZap` 192.
13. ⬜ **NOT STARTED** — replace `@ts-ignore`-to-pass-`req.id` with a single declared augmentation of Express `Request`, then delete the ~30 suppressions that become unnecessary.
14. ⬜ **NOT STARTED** — reduce `any` from 392 by typing the four integration-controller request bodies with the zod schemas already in `packages/types`. `any` reads 350 today, but only because dead code was deleted — no typing work has been done.

**Finally — hygiene (P3):**

15. ✅ **DONE** (`3645645`) — run `npx prettier --write` on the 29 drifted files in a dedicated "formatting only" commit (never mixed with behaviour changes — that's the rule). **→ now:** `prettier --check` passes repo-wide. (The audit said 28 in one place and 29 in another; 29 was correct.)
16. ✅ **DONE, by documenting rather than removing** — the leftover SMTP env block in `env.ts` and the Railway remnants. **→ now:** the premise was wrong on both counts, so removal would have been the mistake. `ActionsController` really does send through nodemailer with `SMTP_*` (that's why the fix in §6.2 is a name mismatch, not a deletion), and `apps/worker/railway.json` is the live deploy config referenced by `.github/workflows/deploy.yml`. Both now carry a comment saying why they stay.
17. ✅ **OBSOLETE** — add a note to `artifacts/task.md` about the dead UI generation so the next reader doesn't wire it up by mistake. **→ now:** unnecessary — the 7 components are deleted, and a check of every file in `artifacts/` finds no reference to them or to any other deleted path.

### G. Method limits — read this before quoting the per-file verdicts

- **These rules are behavioural, not structural.** Verdicts are proxies (§2). A PASS means "no violation detectable by the proxy", not "this file was written by a disciplined agent".
- **History is squashed to one commit**, so Principle 3 could only be judged from in-tree residue (orphans, drift, superseded modules) — not from diffs.
- **The P4 column is structural, not accusatory.** 103 files FAIL because the layer they live in (web UI, background services) has no test infrastructure at all. That's one finding about the repo, repeated per file by construction.
- **The `longest unit` figure** comes from a brace-matching approximation, so it is accurate to ±a few lines and can mis-attribute a unit name for files with nested declarations (e.g. it reports `zapId` for one `ZapController` body). The line counts of the top offenders were spot-checked by hand.
- **The `any` count** in §A is ESLint's `no-explicit-any` (392) — a regex over raw text finds 402 because it also matches the word "any" in prose.
- **Not audited:** Prisma schema design, Docker images, deployment topology, README accuracy, dependency vulnerabilities (`npm audit` reports 141 advisories — a security concern, but not a Karpathy-guidelines concern), and runtime behaviour of anything requiring a live Postgres/Kafka/Redis (none available in this sandbox).
- **Environment note:** `bun` is not installed here, so npm was used; `prisma generate` cannot fetch engines from `binaries.prisma.sh`, so `tsc` on `apps/server` reports pre-existing module-resolution errors (`@repo/types`, `nodemailer` types, `PrismaClient`) that are environment artifacts, not code defects.

---

## 6. Remediation log

Work done against §F. Each entry: what changed, the commit, and the evidence that it works — for the behavioural changes, the *same test fails on the pre-fix code and passes after*. That check was done by stashing the source fix and re-running the suite, so "verified" here means reproduced, not asserted.

### 6.1 Security: authentication that could not fail — ✅ DONE (P1, items 1–3)

| # | Finding | Fix | Commit |
|---|---|---|---|
| 1 | `GmailWebhookController.ts:182` accepted any signature when `GMAIL_WEBHOOK_SECRET` was unset | missing secret now **rejects** | `a0f38ce` |
| 2 | `CronRoutes.ts:16`, `processor/src/index.ts` (5 guards), `worker/src/index.ts:393` — `undefined === undefined` passed when `CRON_SECRET` was unset | all now require the secret | `a0f38ce` |
| 3 | `TriggerController.ts` skipped verification when no signature header was sent, and fell back to the literal HMAC key `'default-secret'` in the source | signatures mandatory when `WEBHOOK_SECRET` is set; fallback key deleted | `a0f38ce` |

**Deviation from §F item 3, deliberate.** The report said "require the signature (don't treat absence as 'unsigned is fine')". Applied verbatim that would have broken the product's primary trigger type: `POST /api/triggers/webhook/:zapId` is a public endpoint that user automations post to, and `zapId` is an unguessable UUID — the capability-URL model Zapier itself uses for inbound webhooks. So the rule implemented is *"a configured secret makes signatures mandatory"* rather than *"signatures are always mandatory"*. Unsigned webhooks keep working when no secret is configured; they stop working the moment one is.

**Evidence:** `apps/server/tests/security/webhook-security.test.ts` (12 tests). Stashing the source changes and re-running gives **4 failed / 8 passed**; with the fixes, 12/12. The four that fail are exactly the fail-open behaviours.

One pre-existing test asserted the old semantics (`triggers.test.ts` passed a bogus signature and expected 401 — it only passed because of the hardcoded fallback key); it now sets a real secret and tests the intended rule.

### 6.2 Config names that silently disabled features — 🟡 naming done, boot-time fail-fast not done (P1, item 4)

| Finding | Fix | Commit |
|---|---|---|
| Code read `SOL_PRIVATE_KEY`, docs said `SOLANA_PRIVATE_KEY` → every Solana action reported "not configured" on a correctly configured deploy | one resolver, documented name first, legacy name still honoured | `0e42a38` |
| Code read `SMTP_PASS`, docs said `SMTP_PASSWORD` → Email action could not authenticate | both accepted | `0e42a38` |
| Root `.env.example` said `GMAIL_CLIENT_ID/SECRET`; code reads `GOOGLE_CLIENT_ID/SECRET` | doc corrected | `0e42a38` |

Also documents what §6.1 made mandatory (`CRON_SECRET`, `GMAIL_WEBHOOK_SECRET`, optional `WEBHOOK_SECRET`), gives the server's Email action the SMTP block it never had, and replaces the worker's stale SMTP section (it uses Resend now) with the vars it actually reads.

**Evidence:** `apps/worker/tests/helpers.test.ts` — 4 tests covering the resolver (documented name, legacy name, precedence, absent). The worker had **no test runner at all** before this; it now has one.

### 6.3 Honest run status — ✅ DONE (P1, item 5)

`processWebhookTrigger` and `processGmailTrigger` caught each action's error, logged it, then wrote a `ZapRun` with no status — so a Zap whose every step failed looked healthy in the history. `ZapRun` already had `status`, `errorMessage` and `completedAt` fields; nothing on this path used them.

Now recorded honestly, with one deliberate restraint: **the runner still does not throw**, so the webhook response stays 200. These handlers receive Google/Gmail push notifications and inbound webhooks, where a 5xx makes the provider retry and re-run the actions. The failure signal lives in the run record and the logs instead. `fetchZapRuns` returns the new fields so the history UI can show them.

While here, `GmailTriggersController` held a second, already-divergent copy of this logic (different `where` clause; a dynamic `import('./ActionsController.js')` *inside* the per-action loop, with a `.js` extension that only resolves in the SWC build output). It now delegates to the single implementation — **49 lines deleted, 3 added**. Commit `66f931b`.

**Evidence:** `tests/zaps/run-status.test.ts` — 8 tests; **6 fail pre-fix**, including one that asserts through `TriggerController.handleWebhook` that the HTTP response stays 200 while the run is recorded as failed.

### 6.4 The verification loop — ✅ CI and leaks done; the plan's full scope still open (P4, items 6, 7, 9)

- **CI now runs both suites** (`8b05882`). Until this commit, the workflow installed, generated Prisma, linted and built — and never invoked Jest. The suite existed and verified nothing.
- **`--forceExit` is gone, and it was hiding two real defects:**
  - `csrf.ts:11` started a module-level `setInterval` to prune expired tokens and never `unref()`'d it. That pinned the event loop open in Jest *and* in the deployed server — a background timer keeping the process alive at shutdown. Fixed with `.unref()`.
  - `tests/actions` dialled `smtp.gmail.com:587` for real; nodemailer's pending socket is what kept Jest hanging. `nodemailer` is now mocked in `tests/setup.ts`, so unit tests touch no network.
- Jest exits on its own in ~2.6s; CI needs no flags.
- Item 9 (cheap coverage for pure helpers) landed with the worker suite (§6.2 evidence).

### 6.5 Simplicity: deleting the dead mass — ✅ DONE (P2, item 10)

`5c55d53` removed **17 unreferenced modules and 3 unused dependencies — 2,442 lines** (28 files). Each was verified individually first (symbol grep + import graph): the superseded Telegram/WhatsApp/Calendar UI generation, the duplicate Google Sheets poller, the `packages/logger` and `packages/ui` packages (zero consumers — hence 453 `console.*` calls while pino sat unused), an 8-line `AuthProvider` placeholder, `lib/auth.ts` whose every export was dead, and three unused barrels/stubs.

Verified: server 104/104 and worker 14/14 still pass; the web typecheck reports the *same* 3 pre-existing errors before and after; the processor typecheck is byte-identical with and without the deleted poller restored.

### 6.6 Style drift — ✅ DONE (P3, item 15)

`3645645` — 29 files reformatted to the repo's own Prettier config, **formatting only, in its own commit**. Mixing a whitespace pass into a behavioural fix makes the real change unreviewable, which is the failure mode the "surgical changes" rule warns about. `prettier --check` now passes repo-wide (was 29 failures).

### 6.7 Before / after

| Metric | As found | Now |
|---|---|---|
| Source files (TS/TSX) | 147 | 133 |
| Code lines | 17,390 | 15,854 |
| ESLint warnings | 426 | **381** |
| — `no-explicit-any` | 392 | 350 |
| — `no-unused-vars` | 34 | 31 |
| Prettier drift | 29 files | **0** |
| Unreferenced modules | 17 | **0** |
| Dead exports | 26 | 19 |
| Duplication (jscpd) | 3.49% / 46 clones | 2.99% / 35 clones |
| Tests (server + worker) | 84 (server only) | **118** (104 + 14) |
| Files reachable from tests | 22% | 29% |
| CI runs tests | **no** | yes, both suites |
| `--forceExit` needed | yes | no |
| Fail-open auth paths | 3 subsystems | **0** |

### 6.8 Still open — the live backlog

Tick these off in order; items 1–3 are the ones the audit graded worst.

- [ ] **1. `evaluateFilters` fails open on an unknown operator** (`apps/worker/src/evaluateFilters.ts:67` returns `true` with a warning). A typo'd operator silently passes everything — same class as the bugs in §6.1, lower impact since the conditions are user-authored. Needs a product decision: reject the filter, or treat an unknown operator as "no filter". *Verify:* one test per unknown-operator case.
- [ ] **2. Split the units over 250 lines** (§F item 12) — `Modal.tsx` 624, `GoogleCalendarPoller.ts` 476, `GmailService.ts` 384, `createZap` 192.
- [ ] **3. De-duplicate the integration controllers** (§F item 11) — extract the OAuth-callback/server-CRUD skeleton shared by Gmail/Sheets/Calendar (`GoogleCalendarController.ts:32-62` ↔ `GoogleSheetsController.ts:33-63`, 31 identical lines).
- [ ] **4. Finish the test-suite plan** (§F items 7 and 8) — the plan's Gmail/Sheets/Actions controller suites are unwritten; `apps/server/tests/zaps/run-status.test.ts` is the pattern to copy (real handler, mocked models).
- [ ] **5. The 19 remaining dead exports** — `packages/kafka` → `TOPICS`/`createConsumer`/`createProducer`; `apps/worker/src/sendTelegram.ts` → `replyToMessage`/`sendTelegramDocument`/`sendTelegramPhoto`; `sendWhatsAppTemplateMessage`; `packages/email` → `sendEmailWithHtmlBody`; `GmailWebhookController` → `renewGmailWatch`; `apps/hooks` → `setupCalendarWatch`/`stopCalendarWatch`. Several are "the feature is stubbed, not wired" — decide wire-or-delete rather than leaving them.
- [ ] **6. `isRetryableError` is exported but never consulted** — verified: the only references to `apps/worker/src/utils/retry.ts:87` are its own definition and the tests written in §6.2, so `withRetry` still retries errors its own classifier calls non-retryable. Use it in `withRetry` or delete it.
- [ ] **7. Worker `replaceKeys` has no test** (§F item 9 gap) — pure function, no infra needed; the cheapest remaining coverage in the repo.
- [ ] **8. `@ts-ignore`-to-pass-`req.id`** (§F item 13, 90 occurrences repo-wide) and **typing the integration request bodies** (§F item 14, `any` = 350).
- [ ] **9. Infra env vars are still undocumented** — a re-scan finds 17 read in code but absent from the three `.env.example` files: `API_URL`, `HOOKS_URL`, `GITHUB_WEBHOOK_SECRET`, `GMAIL_REDIRECT_URI`, `GOOGLE_CALENDAR_WEBHOOK_URL`, `WHATSAPP_VERIFY_TOKEN`, `SENTRY_DSN`, `RELEASE_VERSION`, `EMAIL_RATE_LIMIT_PER_HOUR`, `EMAIL_RECIPIENT_COOLDOWN`, `CALENDAR_WEBHOOKS_ENABLED`, `KAFKA_SASL_MECHANISM`, `KAFKA_SSL_CA`, `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_HOOKS_URL`, plus the two legacy aliases `SMTP_PASS`/`SOL_PRIVATE_KEY` (named in comments rather than as keys). Note the audit's original count was 14 because its scan included test files.
- [ ] **10. `bun.lock` is stale** — run `bun install` once (no `bun` in this sandbox) to drop the three removed dependencies from the lockfile.
- [ ] **11. Web, `apps/hooks` and `apps/processor` have no tests at all** — the largest remaining P4 gap. For the web app, start with the components that were just deleted's replacements (`components/metadata/*`) and `evaluateFilters`-style pure logic in `lib/`.
- [ ] **12. The run status is recorded but never shown** — `apps/web/components/ZapRunHistory.tsx` is mounted on the dashboard (`app/dashboard/page.tsx:478`) but does not read `status`/`errorMessage`/`completedAt`, so runs fixed in §6.3 still render as plain history. `artifacts/walkthrough1.md:195,226` also still calls the execution history UI a missing feature.
- [ ] **13. Deferred refactors from `artifacts/task.md`** — Slack/Discord/generic-HTTP actions, email verification, password reset, Docker Compose for local dev.
