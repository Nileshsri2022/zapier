# ZapMate Workflow Execution — Gap Report (Triggers → Actions)

| | |
|---|---|
| **Repository** | `Nileshsri2022/zapier` (ZapMate) |
| **Branch** | `arena/cf978436-zapier` |
| **Base revision** | `5753c0a` |
| **Date** | 2026-10-19 |
| **Scope** | Trigger → action execution pipeline: `apps/hooks`, `apps/processor`, `apps/worker`, `apps/server` (schedule/cron routes), `packages/db` schema |
| **Method** | Static read of all trigger handlers, the Kafka consumer, the action dispatcher, the Prisma schema, and the seed catalog. Each finding below is reproducible from the cited file/line. |

> **Status:** §1–§3 are the **as-found audit** (as of `5753c0a`). §4's fixes **F1–F3 are landed in this branch** (commits cited in §6); §5's follow-ups (F4–F6) remain open. Verification: worker jest 28/28, server jest 135/135, `tsc --noEmit` on `apps/hooks` shows only the 6 pre-existing sandbox errors (unbuilt workspace `dist` + prisma engine download blocked), prettier clean on all touched files.

Legend — ✅ fixed in this branch, commit cited · 🟡 partly done, gap named · ⬜ not started.

---

## 0. What works — baseline (kept readable for context)

The data model and the main execution path follow Zapier's trigger/action design well:

- `Zap` = one trigger + ordered `Action[]` (`sortingOrder`); `AvailableTriggers`/`AvailableActions` are the catalog; `ZapRun` is run history with `pending → running → completed/failed` status and `errorMessage`.
- Both Zapier trigger flavors exist: **webhook/push** (`apps/hooks`: WhatsApp, Telegram, Google Calendar push, generic webhook) and **polling** (`apps/processor`: `GoogleSheetsPoller`, `GoogleCalendarPoller` with state cursors `lastPolledAt`/`syncToken`), plus **schedule** (`ScheduledTrigger` + `CronRoutes`).
- The Kafka path (`zap-events` → `apps/worker`) runs actions stage-by-stage with retries (3×), `filterConditions` on trigger data, per-step `stepConditions`, `stepOutputs` chaining (`{previousOutput.x}`), and failure notification email.
- Polling and calendar-push triggers create `ZapRun` + `ZapRunOutbox`; `processor /process` drains the outbox to Kafka (transactional outbox pattern).

The three gaps below are all **silent** — no crash, no failed run in history. That is what makes them dangerous.

---

## 1. Gap D1 — Legacy dual execution path in the hooks service

**Zapier's model:** one execution engine. Every trigger funnels into the queue → worker.

**As found:** two action executors exist, and which one runs a Zap depends on *which trigger fired it*:

| Trigger | Path | Action support | Retries | Filters/conditions | Template keys |
|---|---|---|---|---|---|
| WhatsApp, Telegram, Calendar push | A: Kafka → worker | 5 types | 3× | ✅ | nested (`{data.user.email}`) |
| Sheets/Calendar polling | A: outbox → Kafka → worker | 5 types | 3× | ✅ | nested |
| **Generic webhook** `POST /hooks/:userId/:zapId` | **B: inline in hooks** | **Email, Solana only** | none | none | flat only |
| **Schedule** `POST /api/webhooks/schedule` | **B: inline in hooks** | **Email, Solana only** | none | none | flat only |

Path B is `processZapImmediately()` in `apps/hooks/src/index.ts` (~line 97) with a local `executeAction()` switch whose only cases are `Email` and `Solana` (~line 47); everything else hits `default: console.log('Unknown action type: ...')`. It also carries its own `replaceKeys` (~line 26) that supports **flat keys only** — a divergent duplicate of the worker's.

**Concrete failure:** a Zap triggered by a plain webhook, with a "send WhatsApp message" action:

1. `POST /hooks/:userId/:zapId` → `processZapImmediately`
2. `executeAction` → no `WhatsApp` case → logs `Unknown action type: WhatsApp ...`
3. the ZapRun is then marked **`completed`** (~line 140)

The message was never sent; history shows ✅. The same Zap behaves correctly when fired by the WhatsApp trigger and silently misbehaves when fired by a webhook — non-deterministic per trigger.

**Severity: HIGH** (fake success + capability silently lost for a whole trigger class).

---

## 2. Gap D2 — Hardcoded action dispatcher that fakes success for unimplemented actions

**As found** (`apps/worker/src/index.ts`, `executeActionWithRetry`, line 59): the action dispatcher is an if/else chain over `action.type` strings:

```ts
if (actionType === 'Email') { ... }            // line 66
if (actionType === 'Solana') { ... }           // line 106
if (actionType.startsWith('WhatsApp')) { ... } // line 131
if (actionType.startsWith('Telegram')) { ... } // line 158
if (actionType === 'Webhook') { ... }          // line 180
return { success: true, message: `Unknown action: ${actionType}`, output: {} }; // line 207
```

Two problems:

1. **Unknown action ⇒ `success: true`.** `withRetry` only fails the run when the inner function *throws*; a returned `{success: true}` becomes a successful step. So any action type the dispatcher doesn't know is a **silent no-op marked completed** — and the run's failure-notification email never fires.
2. **Catalog drift.** The seed (`apps/server/src/seed.ts` lines 121–133) offers users **`Gmail Send Email`, `Gmail Reply`, `Gmail Add Label`, `Gmail Remove Label`** in the UI, the `GmailAction` Prisma model and `GmailActionsController` exist for configuring them — but the worker has **no Gmail branch**. A user-selected "Gmail Send Email" action executes as the line-207 no-op: run "completed", nothing sent.

Related silent skip in the same family: the Solana branch when `SOLANA_PRIVATE_KEY` is unset (~line 111) returns `{ success: false, message: 'SOLANA_PRIVATE_KEY not configured' }` *inside* the function — which `withRetry` reports as an overall success, so the transfer is skipped and the run completes "successfully".

Structurally: actions are **code, not data**. Zapier (and Activepieces/n8n) define an action as data (operation + input schema + credentials) executed by one generic engine. Here each new action = a code branch + a redeploy, and nothing prevents the catalog from promising what the engine can't run.

**Severity: HIGH** (silent fake success in the primary execution path; affects every future action type).

---

## 3. Gap D3 — No webhook deduplication: one event can fire a Zap N times

**Zapier's model:** webhook delivery is at-least-once; the platform dedupes by event ID, so one event = one run.

**As found:** no handler checks event IDs before creating a `ZapRun`:

| Webhook trigger | Event ID available | Dedup check |
|---|---|---|
| WhatsApp (`apps/hooks/src/whatsappHandler.ts`) | `message.id` (wamid) — stored in run metadata | **none**; `lastProcessedAt` is written (~line 145) but **never read anywhere** |
| Telegram (`apps/hooks/src/telegramHandler.ts`) | `message.message_id` — stored in metadata | **none**; same vestigial `lastProcessedAt` |
| Calendar push (`apps/hooks/src/googleCalendarHandler.ts`) | per-notification `X-Goog-Message-Number` + channel ID | **none**; ZapRuns created per listed event (~line 169) |
| Generic `POST /hooks/:userId/:zapId` | n/a (arbitrary body) | **none** |

Why duplicates arrive: WhatsApp/Meta and Google both redeliver when the consumer is slow or the ACK is missed; the handlers respond 200 immediately but process **async** (fire-and-forget `.catch`), so a retry can land while the original is still being handled.

**Concrete failures:**

- WhatsApp message "Hi" redelivered → two `ZapRun`s → if the Zap replies via WhatsApp or sends an email, **the recipient gets it twice**.
- Same, but with a **Solana** action: duplicate trigger = **duplicate token transfer — real funds lost**, not just a duplicate message.
- A single calendar push can carry several events; a redelivered notification re-fires all of them.

**Severity: HIGH for money-moving actions, MEDIUM otherwise.**

---

## 4. Fixes carried in this branch

| ID | For | Change |
|---|---|---|
| **F1** | D3 | New `apps/hooks/src/dedup.ts`: `SET NX PX` (24 h TTL) on Upstash Redis (`@repo/redis`). Keys: `whatsapp:<zapId>:<messageId>`, `telegram:<zapId>:<messageId>`, `calendar:<channelId>:<messageNumber>` (per *notification* — a legitimate event update carries a new message number, so updates are not suppressed), `webhook:<zapId>:<event_id>` for the generic webhook (opt-in `event_id`/`eventId` body field). Fails **open** with a warning if Redis is unavailable (availability over dedup; documented trade-off). |
| **F2** | D1 | `apps/hooks/src/index.ts`: generic webhook and schedule handlers now create/forward `{zapRunId, stage: 1}` to Kafka `zap-events` (same pattern as the WhatsApp handler). `processZapImmediately`, its local `executeAction`/`executeEmailAction`/`executeSolanaAction`, and the divergent duplicate `replaceKeys`/`validateEmail` are **deleted**. One execution engine remains. |
| **F3** | D2 | `apps/worker/src/index.ts`: unknown action type now **throws** (run retries, then fails loudly and the user gets the failure email). Solana with missing key also throws instead of silently skipping. Guard extracted to `apps/worker/src/utils/actionTypes.ts` (`isKnownActionType`) with a new jest test. |

**Acceptance criteria:**

- F1: the same WhatsApp/Telegram event ID (or calendar notification) submitted twice produces exactly one `ZapRun`; distinct events are unaffected; Redis outage ⇒ runs continue (with warning log).
- F2: a generic-webhook Zap with a WhatsApp action runs through the worker and actually sends; the hooks service contains no action-execution code; no duplicated `replaceKeys`.
- F3: a Zap whose action type is unimplemented ends with `status: failed` + `errorMessage`, not `completed`; Solana-without-key fails the run instead of skipping it.

---

## 5. Follow-ups — deliberately NOT included in this branch

- **⬜ F4 — Gmail action executors.** `Gmail Send Email` / `Gmail Reply` / `Gmail Add Label` / `Gmail Remove Label` are still user-selectable but unimplemented; after F3 they **fail loudly** instead of faking success. Either implement worker branches (reusing `GmailService` OAuth flow) or remove them from the seed catalog. Needs a decision.
- **⬜ F5 — Generic webhook signature verification.** `POST /hooks/:userId/:zapId` authenticates by URL secrecy only; anyone who knows the URL can fire the Zap. A shared-secret header check (like `CRON_SECRET`) belongs here.
- **⬜ F6 — Orphaned schedule runs.** `CronRoutes /process-schedules` creates a `ZapRun` **without** an outbox row, then POSTs to hooks; if that 5 s HTTP call fails the comment says "processor can pick it up" — but the processor only drains the outbox, so the run stays `pending` forever. Fix: write the `ZapRunOutbox` row (then the hooks schedule endpoint could even be dropped).
- ⬜ Cosmetic: `ScheduledTrigger.scheduleType` comment in `packages/db/prisma/schema.prisma` omits `minutely` (the route validator accepts it).

---

## 6. Completion status — marks (read this first)

| # | Item | Status | Evidence |
|---|---|---|---|
| D1 | Dual execution path removed | ✅ | `6306134` — legacy inline executors deleted; all triggers queue to Kafka → worker |
| D2 | Dispatcher fails loudly; no fake success | ✅ | `854b00a` — unknown action throws; Solana missing-key throws; 28/28 worker tests |
| D3 | Webhook event dedup (WhatsApp, Telegram, Calendar, generic) | ✅ | `134d487` — `SET NX PX` dedup wired into all four trigger paths |
| F1 | Dedup helper + wiring | ✅ | `134d487` — `apps/hooks/src/dedup.ts` + 4 handler call sites |
| F2 | Hooks → Kafka; legacy executors deleted | ✅ | `6306134` — single `enqueueZapRun` path; hooks no longer executes actions |
| F3 | Worker guard + jest test | ✅ | `854b00a` — `utils/actionTypes.ts` registry + `tests/actionTypes.test.ts` |
| F4 | Gmail action executors (or catalog removal) | ⬜ | deferred (§5) — now fails loudly instead of fake success |
| F5 | Generic webhook signature verification | ⬜ | deferred (§5) |
| F6 | Schedule runs via outbox (no orphans) | ⬜ | deferred (§5) |
