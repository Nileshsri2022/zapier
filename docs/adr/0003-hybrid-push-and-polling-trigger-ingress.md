# Hybrid Push and Stateful Polling Trigger Ingress

## Context
ZapMate integrates with third-party providers that offer different change-notification capabilities:
1. **Webhook-native providers** (Webhook, GitHub, WhatsApp Cloud API, Telegram Bot API) push events directly over HTTP.
2. **Watch + History providers** (Gmail, Google Calendar) emit lightweight push notifications carrying a cursor (`historyId` or `X-Goog-Channel-ID`) that must be hydrated against the Google API, and whose watch channels expire every 7 days.
3. **Polling-only or local-fallback providers** (Google Sheets, Google Calendar without public webhook reachability, and Schedule triggers) require periodic inspection.

## Decision
We separate trigger ingress into three specialized adapters that all converge on `@repo/runs`:
- **Push Ingress (`apps/hooks` & `apps/server`)**: Authenticates provider signatures/tokens (`X-Hub-Signature-256`, `X-Webhook-Signature`, bot-scoped URLs `/api/webhooks/telegram/:botId`, Meta `hub.verify_token`), hydrates deltas (`GmailDispatch.processHistoryDelta`, Calendar `syncToken`), and calls `enqueueRun`.
- **Stateful Poller Orchestrator (`apps/processor`)**: Runs `GoogleSheetsPoller` (per-row SHA-1 content hashes in Redis `sheets:trigger:<id>:rowhash` with 30-day TTL) and `GoogleCalendarPoller` (windowed queries + Redis event-level dedup keys and `syncToken` cursor) on a cron schedule.
- **Wall-Clock Schedule Evaluator (`apps/server` `/api/cron/process-schedules`)**: Computes timezone-aware `nextRunAt` slots (`computeNextRun`) and enqueues due `ScheduledTrigger` rows.

## Consequences
- Google Sheets detects both appended rows and in-place cell edits without requiring Google Drive push channels.
- Google Calendar supports instant push notifications in production (`CALENDAR_WEBHOOKS_ENABLED=true`) and automatically falls back to polling all triggers in local/non-webhook environments.
