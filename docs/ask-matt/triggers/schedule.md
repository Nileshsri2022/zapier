# T8 — Schedule (Trigger Spec)

Status: 🟢 `grilled` — answers in `03-grill-log.md` §T8 · Phase: `/to-tickets` ✓ · `/implement` ⛔ blocked

## 1. Summary & user story

Start a Zap on a time cadence.

> **As a** Zap builder, **I want** my Zap to fire at chosen times (interval or calendar
> schedule), **so that** recurring jobs — digests, syncs, reports — run unattended.

## 2. Schedule modes — ✅ grilled (Q-SCHED-01)

| # | Mode | v1 verdict |
|---|---|---|
| M1 | Every N minutes/hours | ✅ **IN SCOPE** (preset) |
| M2 | Every day at HH:MM | ✅ **IN SCOPE** (preset) |
| M3 | Every week on D at HH:MM | ✅ **IN SCOPE** (preset) |
| M4 | Every month on day D at HH:MM | ✅ **IN SCOPE** (preset) |
| M5 | Custom cron (5-field) | ✅ **IN SCOPE** — validated at setup with next-fires preview |
| M6 | One-time at datetime | ❌ backlog |

The event itself: **scheduled occurrence reached** — one run per occurrence.

## 3. Configuration & auth (✅ grilled)

- **Connection:** none.
- **Per-Zap config:** mode/preset or cron, **timezone selectable per Zap, default from
  user profile** (✅ Q-SCHED-02), start date, minimum granularity = 1 minute (no seconds).
- **DST (✅ Q-SCHED-03):** **local wall-clock** semantics — spring-forward nonexistent
  local times shift to the valid instant; fall-back repeated times **fire once** (first
  occurrence); `date.*` parts always reflect local wall time.
- **Downtime (✅ Q-SCHED-04):** **skip missed windows** — resume at the next occurrence;
  no catch-up burst on restart.
- **Engine:** durable cron/interval registry; transactional uniqueness on
  `occurrenceKey` so duplicate schedulers can't double-fire; jitter option to avoid
  thundering-herd at :00.
- No user credentials; house rules: instant sample data in test mode (Q-X-05) — test run
  emits a synthetic occurrence immediately.

## 4. Data contract (✅ Q-SCHED-05: as drafted)

```json
{
  "firedAt": "2026-10-21T09:00:00+05:30",
  "firedAtIso": "2026-10-21T03:30:00.000Z",
  "timezone": "Asia/Kolkata",
  "mode": "daily",
  "cron": "0 9 * * *",
  "date": {
    "year": 2026, "month": 10, "monthName": "October", "week": 43,
    "day": 21, "dayOfWeek": "Wednesday", "dayOfYear": 294,
    "hour": 9, "minute": 0, "second": 0,
    "ampm": "AM", "isoWeek": 43
  },
  "occurrenceKey": "daily|2026-10-21T09:00:00+05:30"
}
```

- `occurrenceKey` = dedupe/idempotency token (format: `<mode>|<localISO>`).
- `date.*` parts derive from **local wall-clock** in the Zap's timezone (DST-consistent).

## 5. Behavior & edge cases

- **DST spring-forward:** target local time doesn't exist → fire at the shifted valid
  instant (policy confirmed via wall-clock choice); **fall-back:** fire once (first hit).
- **Skip-on-downtime:** if the process was down over an occurrence, that occurrenceKey is
  never emitted; next scheduled one fires normally.
- Mode change mid-Zap: old schedule cancelled atomically; no orphan fires.
- Cron validation: 5-field only; `@daily`-style aliases normalized to cron for storage;
  preview shows next 5 fires in chosen tz before save.
- Clock skew: scheduler server time authoritative; occurrenceKey stable across workers.
- Every-minute floor; two workers racing → transactional unique key prevents double-run.

## 6. Acceptance criteria (v1)

- Given daily 09:00 IST, exactly one run/day at 09:00 local with correct `date.*` parts.
- Given duplicate delivery of an occurrence (two schedulers), `occurrenceKey` dedupes —
  one effective run.
- Given DST spring-forward with a 02:30 target, one run at the shifted instant (no skip,
  no double).
- Given DST fall-back with a 02:30 target, **exactly one** run.
- Given downtime across an occurrence, **no** catch-up run (skip policy).
- Given cron `*/15 9-17 * * 1-5`, preview + fires match in selected tz.
- Given mode change, prior occurrences fully cancelled.

## 7. Open questions — ✅ all answered (round 10)

| ID | Question | Answer |
|---|---|---|
| Q-SCHED-01 | Modes? | ✅ **Presets + custom cron** |
| Q-SCHED-02 | Timezone? | ✅ **Per-Zap, default user tz** |
| Q-SCHED-03 | DST policy? | ✅ **Local wall-clock** (fire-once on repeats) |
| Q-SCHED-04 | Missed windows? | ✅ **Skip** |
| Q-SCHED-05 | Output? | ✅ **As drafted** |

## 8. Tickets (⛔ blocked until final confirmation)

- **T-SCHED-01** `/implement` + `/tdd` — mode parsing, cron preview, tz/DST engine,
  occurrence idempotency, skip-on-downtime.
- **T-SCHED-02** fixtures: both DST directions, downtime window, mode change, cron preview,
  multi-worker double-fire attempt.
- **T-SCHED-03** `/code-review` against acceptance criteria.
- **T-SCHED-04** `/pr` referencing this file.
