# T3 — Google Calendar (Trigger Spec)

Status: 🟢 `grilled` — answers in `03-grill-log.md` §T3 · Phase: `/to-tickets` ✓ · `/implement` ⛔ blocked

## 1. Summary & user story

Start a Zap when events happen in a Google Calendar.

> **As a** Zap builder, **I want** my Zap to fire when a calendar event is created,
> changed, or cancelled, **so that** schedules can drive notifications, records, or
> reminders downstream.

## 2. Trigger events — ✅ grilled (Q-CAL-01)

| # | Event | v1 verdict |
|---|---|---|
| E1 | New Event | ✅ **IN SCOPE** (instances expanded — Q-CAL-02) |
| E2 | Event Updated | ✅ **IN SCOPE** |
| E3 | Event Cancelled | ✅ **IN SCOPE** |
| E4 | Event Upcoming (within window) | ❌ backlog |

## 3. Configuration & auth (✅ grilled)

- **Connection:** Google OAuth on the **shared per-provider Google connection**
  (calendar readonly; Q-X-03).
- **Per-Zap config:** **single calendar** picked at setup (✅ Q-CAL-03), include private
  properties (Y/N).
- **Recurring handling (✅ Q-CAL-02):** **expand instances** — every occurrence of a
  recurring event is its own event with key `instanceKey = recurringEventId + occurrenceStart`.
  A series of N occurrences ⇒ N `created` runs; cancellations/updates target the specific
  instance.
- **Cursor:** watermark `instanceKey/eventId → updated` timestamp (✅ Q-CAL-05). `created`
  fires once per key; `updated` fires only when `updated` advances; `cancelled` when status
  flips (fired at most once).

## 4. Data contract

Output fields (one run per event occurrence):

```json
{
  "eventId": "abc123",
  "instanceKey": "abc123@2026-10-22T15:00:00+05:30",
  "status": "confirmed",
  "event": "created",
  "summary": "Design review",
  "description": "…",
  "location": "Room 4 / https://meet…",
  "start": { "dateTime": "2026-10-22T15:00:00+05:30", "timeZone": "Asia/Kolkata" },
  "end": { "dateTime": "2026-10-22T16:00:00+05:30", "timeZone": "Asia/Kolkata" },
  "allDay": false,
  "recurringEventId": null,
  "organizer": { "email": "ada@example.com", "name": "Ada" },
  "attendees": [{ "email": "bob@example.com", "responseStatus": "accepted" }],
  "htmlLink": "https://www.google.com/calendar/event?eid=…",
  "updatedAt": "2026-10-21T09:14:02Z"
}
```

- **All-day events included (✅ Q-CAL-04):** normalized as `allDay: true` with raw
  `start.date`/`end.date` carried in the raw fields; `dateTime` slots left null.
- `event` ∈ `created | updated | cancelled` labels the run for downstream filters.

## 5. Behavior & edge cases

- **Create/update disambiguation:** watermark per key — `updated` advancing ⇒ `updated`
  run (never re-fires `created`); status → `cancelled` ⇒ one `cancelled` run.
- **Recurring expansion:** cancelled instance = that instance only; new occurrences added
  to a series fire as `created` (new instanceKey); master-only edits that change future
  instances re-evaluate those keys. Known cost: update-heavy series can generate multiple
  runs — documented, acceptable per expand choice.
- All-day events & timezone boundaries (midnight local vs UTC) — included, flagged.
- Single-calendar cursor: switching calendar resets cursor cleanly (setup-time validation).
- Calendar deleted / access revoked → auth-class error.
- Poll cadence: bounded by Calendar API quota; missed events during downtime = next poll
  catch-up via watermark (no loss, possible latency).

## 6. Acceptance criteria (v1)

- Given a new event, exactly one `created` run with full contract fields.
- Given a time change, one `updated` run — and **no** duplicate `created` run.
- Given a cancellation, one `cancelled` run with prior details where available.
- Given a daily recurring series (5 days), **5** separate `created` runs, each with correct
  instance `start`.
- Given an all-day event, run fires with `allDay: true`.
- Given a calendar without access, actionable auth error.
- All agreed fields visible in the field mapper.

## 7. Open questions — ✅ all answered (round 5)

| ID | Question | Answer |
|---|---|---|
| Q-CAL-01 | Which events in scope? | ✅ **E1 + E2 + E3** (E4 backlog) |
| Q-CAL-02 | Recurring: expand or master? | ✅ **Expand instances** |
| Q-CAL-03 | Calendar scope? | ✅ **Single calendar per Zap** |
| Q-CAL-04 | All-day events? | ✅ **Included** (`allDay` flag) |
| Q-CAL-05 | Update detection? | ✅ **`updated`-timestamp watermark** per event/instance key |

## 8. Tickets (⛔ blocked until final confirmation)

- **T-CAL-01** `/implement` + `/tdd` — polling, instance expansion, three-event lifecycle
  via watermark, contract.
- **T-CAL-02** fixtures: recurring instances, single-instance cancellation, all-day,
  tz boundary, update-without-recreate.
- **T-CAL-03** `/code-review` against acceptance criteria.
- **T-CAL-04** `/pr` referencing this file.
