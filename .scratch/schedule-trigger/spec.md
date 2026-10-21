# Specification: Schedule Trigger (`Every Minute`, `Every Hour`, `Every Day`, `Every Week`, `Every Month`)

**Status**: Ready for Agent (`ready-for-agent`)  
**Context**: ZapMate Automation Platform  
**Domain Term**: Schedule Trigger (`GLOSSARY.md`)  
**Governing ADRs**: ADR-0002 (Unified Run Intake and Transactional Outbox) and ADR-0003 (Hybrid Push and Stateful Polling Trigger Ingress)  

---

## Problem Statement

Users need recurring time-based Zaps (daily digests, hourly health checks, weekly reports, monthly billing reminders, minutely heartbeats) that fire reliably in their chosen timezone without drift or missed-slot storms when a paused Zap is resumed.

---

## Solution

Provide five Schedule Trigger catalog entries (`Schedule Every Minute`, `Schedule Every Hour`, `Schedule Every Day`, `Schedule Every Week`, `Schedule Every Month`) backed by `ScheduleMetaData` in the web editor, timezone-aware `computeNextRun` calculation (`apps/server/src/services/schedule.ts`), and `GET /api/cron/process-schedules` which enqueues due schedules through `@repo/runs` (`enqueueRun`) and advances `nextRunAt`.

---

## User Stories

1. As a Zap creator, I want to choose between Every Minute, Every Hour, Every Day, Every Week, and Every Month in the trigger catalog and configure the target hour, minute, day of week, day of month (1–28), and IANA timezone in `ScheduleMetaData`.
2. As a Zap creator, I want `ZapController.createZap` to map the catalog type to `minutely`, `hourly`, `daily`, `weekly`, or `monthly`, compute the initial `nextRunAt` in my selected timezone, and create the `ScheduledTrigger` row.
3. As a Zap creator, I want resuming a paused schedule (`PUT /api/schedule/:zapId`) to recompute `nextRunAt` from `now` rather than firing immediately for past slots missed while paused.
4. As a platform operator, I want `GET /api/cron/process-schedules` to require a valid `x-cron-secret` header (failing closed when `CRON_SECRET` is unset), enqueue due active schedules via `enqueueRun`, and advance `lastRunAt` and `nextRunAt`.

---

## Implementation Decisions

- **Glossary & ADR Alignment**: Uses `Schedule Trigger`, `Trigger ingress`, `Run intake`, and `Outbox` per `GLOSSARY.md`, `ADR-0002`, and `ADR-0003`.
- **Wall-Clock Timezone Arithmetic (`computeNextRun`)**: Uses `Intl.DateTimeFormat` part extraction against the configured IANA timezone (`UTC`, `Asia/Kolkata`, `America/New_York`, etc.) so daily/weekly/monthly schedules honour local wall-clock hours.
- **Transactional Outbox Enqueueing**: `CronRoutes` delegates to `enqueueRun({ zapId, metadata, source: "server.schedule" })` so scheduled runs write both `ZapRun` and `ZapRunOutbox`.

---

## Testing Decisions

### What Makes a Good Test
- **External Behavior Over Implementation Details**: Tests exercise public module interfaces and seams (inputs, return values, database/queue state transitions, and mocked external HTTP boundaries) rather than private helpers.
- **Deterministic Mocking**: External network calls (Google APIs, Meta Graph API, Telegram Bot API, Solana RPC, Resend, LLM providers) are mocked at the boundary.

### Primary Testing Seams
1. **Schedule Calculation Seam (`computeNextRun`)**: Tests minutely, hourly, daily, weekly, and monthly next-run calculation across timezones and month boundaries.
2. **Cron Dispatch & Zap Creation Seam (`CronRoutes /process-schedules`, `ZapController.createZap`)**: Tests `x-cron-secret` authentication, `ScheduledTrigger` creation, due-schedule enqueueing via `enqueueRun`, and `nextRunAt` advancement.
3. **Web Metadata Form Seam (`ScheduleMetaData`)**: Tests schedule summary formatting and conditional time/day/timezone pickers.

### Prior Art in Codebase
- `apps/server/tests/schedules/next-run.test.ts`
- `apps/server/tests/zaps/schedule-creation.test.ts`
- `apps/server/tests/security/webhook-security.test.ts`

---

## Out of Scope

- Arbitrary raw cron expressions (e.g. `*/7 3-5 * * 1-5`) outside the five structured cadence types.
- Sub-minute scheduling intervals.

---

## Further Notes

- Monthly schedules cap `dayOfMonth` to 1–28 in the UI so every calendar month including February has a valid trigger date.
