# Specification: Google Calendar Trigger (7 Lifecycle & Window Events)

**Status**: Ready for Agent (`ready-for-agent`)  
**Context**: ZapMate Automation Platform  
**Domain Term**: Google Calendar Trigger (`GLOSSARY.md`)  
**Governing ADRs**: ADR-0002 (Unified Run Intake and Transactional Outbox) and ADR-0003 (Hybrid Push and Stateful Polling Trigger Ingress)  

---

## Problem Statement

Users schedule meetings, customer calls, and deadlines in Google Calendar and need automations to fire when events are created, updated, about to start, ended, cancelled, matched by search keyword, or when a new calendar is added.

---

## Solution

Provide seven Google Calendar Trigger types (`Google Calendar New Event`, `Event Updated`, `Event Start`, `Event Ended`, `Event Cancelled`, `New Calendar`, `Event Matching Search`) backed by Google OAuth2, supporting both instant Google Calendar push webhooks (`apps/hooks/src/googleCalendarHandler.ts`) and stateful polling (`GoogleCalendarPoller` in `apps/processor`), funneling into Run intake.

---

## User Stories

1. As a Zap creator, I want to select from seven Google Calendar trigger events in the modal so that I can automate any stage of the meeting lifecycle.
2. As a Zap creator, I want to pick a specific calendar (or `primary`) from my connected Google account in `GoogleCalendarMetaData`, so that my Zap only watches the relevant calendar.
3. As a Zap creator, I want to configure `reminderMinutes` (1–1440, default 15) for `Google Calendar Event Start`, so that my Zap fires N minutes before a meeting begins.
4. As a Zap creator, I want to configure `searchQuery` for `Google Calendar Event Matching Search`, so that only events matching keywords like `standup` or `demo` trigger runs.
5. As a platform operator, I want instant push notifications at `POST /api/webhooks/google-calendar` to acknowledge `sync` handshakes, deduplicate notifications by `X-Goog-Channel-ID:X-Goog-Message-Number`, fetch incremental changes via `syncToken`, reset on HTTP 410, and enqueue runs via `@repo/runs`.
6. As a platform operator, I want `GoogleCalendarPoller` in `apps/processor` to poll all active triggers when `CALENDAR_WEBHOOKS_ENABLED` is not `true` (and non-instant triggers when `true`), deduplicating fired events in Redis (`calendar:<type>:<triggerId>:<eventId>`) so each event triggers once.

---

## Implementation Decisions

- **Glossary & ADR Alignment**: Uses `Google Calendar Trigger`, `Trigger ingress`, and `Run intake` per `GLOSSARY.md`, `ADR-0002`, and `ADR-0003`.
- **Seven Canonical Trigger Types**: Mapped in `ZapController.createZap` and `GoogleCalendarMetaData` to `new_event`, `event_updated`, `event_start`, `event_ended`, `event_cancelled`, `new_calendar`, and `event_matching_search`.
- **Hybrid Instant Push + Polling Fallback**: `new_event` and `event_updated` are marked `isInstant = true`. When `CALENDAR_WEBHOOKS_ENABLED=true`, push notifications handle instant triggers and `GoogleCalendarPoller` polls `isInstant: false` triggers; otherwise `GoogleCalendarPoller` polls all active triggers.
- **SyncToken Expiry Recovery**: Both the push handler and `pollEventCancelled` catch HTTP `410 Gone` from Google Calendar API and clear the stored `syncToken` so the next cycle re-initializes cleanly.

---

## Testing Decisions

### What Makes a Good Test
- **External Behavior Over Implementation Details**: Tests exercise public module interfaces and seams (inputs, return values, database/queue state transitions, and mocked external HTTP boundaries) rather than private helpers.
- **Deterministic Mocking**: External network calls (Google APIs, Meta Graph API, Telegram Bot API, Solana RPC, Resend, LLM providers) are mocked at the boundary.

### Primary Testing Seams
1. **Processor Calendar Poller Seam (`GoogleCalendarPoller.poll`)**: Tests all 7 trigger types (`new_event`, `event_updated`, `event_start`, `event_ended`, `event_cancelled`, `new_calendar`, `event_matching_search`), Redis deduplication, HTTP 410 syncToken reset, and `CALENDAR_WEBHOOKS_ENABLED` filtering.
2. **Hooks Push Notification Seam (`handleGoogleCalendarWebhook`)**: Tests header validation, `sync` state handshake, notification deduplication (`calendar:<channelId>:<messageNumber>`), incremental syncToken listing, 410 reset, and `enqueueRun`.
3. **Web Metadata Form Seam (`GoogleCalendarMetaData`)**: Tests trigger type mapping, conditional `reminderMinutes` and `searchQuery` inputs, and calendar selection.

### Prior Art in Codebase
- `apps/processor/tests/GoogleSheetsPoller.test.ts`
- `apps/hooks/src/googleCalendarHandler.ts`
- `apps/processor/src/pollers/GoogleCalendarPoller.ts`

---

## Out of Scope

- Outbound Google Calendar actions (creating or modifying calendar events from the worker).
- Modifying attendee RSVP status.

---

## Further Notes

- Watch channels created via `setupCalendarWatch` expire after 7 days maximum per Google Calendar API limits.
