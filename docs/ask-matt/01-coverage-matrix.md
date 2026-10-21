# Coverage Matrix — Ask-Matt process × Trigger/Action

Purpose: **the "what do I miss" grid.** Left side = the Ask-Matt process phases
(screenshot 3). Each row = one item from the selection dialogs. Columns 1–3 are produced
and **completed** by this docs run; columns 4–6 stay ⛔ until the user passes the final
confirmation gate.

Legend: ✅ complete · 🟡 partial/draft · ⛔ blocked by gate · ⏭️ excluded

**Run status (2026-10-21): grill rounds 1–16 complete, implementation complete —
§X (6 cross-cutting) + all 14 items grilled, implemented, reviewed and shipped in a
single PR. Every spec is `grilled`; every item has code + fixtures against its
acceptance criteria.**

## Main flow coverage

| Item | Kind | /grill-with-docs | /to-spec | /to-tickets | /implement | /code-review | /pr |
|---|---|---|---|---|---|---|---|
| Gmail | trigger | ✅ round 3 (5/5) | ✅ `triggers/gmail.md` grilled | ✅ T-GMAIL-01..04 | ✅ | ✅ | ✅ |
| Google Sheets | trigger | ✅ round 4 (5/5) | ✅ `triggers/google-sheets.md` grilled | ✅ T-SHEETS-01..04 | ✅ | ✅ | ✅ |
| Google Calendar | trigger | ✅ round 5 (5/5) | ✅ `triggers/google-calendar.md` grilled | ✅ T-CAL-01..04 | ✅ | ✅ | ✅ |
| GitHub | trigger | ✅ round 6 (5/5) | ✅ `triggers/github.md` grilled | ✅ T-GH-01..04 | ✅ | ✅ | ✅ |
| Webhook (catch) | trigger | ✅ round 7 (6/6) | ✅ `triggers/webhook.md` grilled | ✅ T-WHT-01..04 | ✅ | ✅ | ✅ |
| WhatsApp (inbound) | trigger | ✅ round 8 (5/5) | ✅ `triggers/whatsapp.md` grilled | ✅ T-WA-T-01..04 | ✅ | ✅ | ✅ |
| Telegram (inbound) | trigger | ✅ round 9 (5/5) | ✅ `triggers/telegram.md` grilled | ✅ T-TG-T-01..04 | ✅ | ✅ | ✅ |
| Schedule | trigger | ✅ round 10 (5/5) | ✅ `triggers/schedule.md` grilled | ✅ T-SCHED-01..04 | ✅ | ✅ | ✅ |
| AI Transform | action | ✅ round 11 (5/5) | ✅ `actions/ai-transform.md` grilled | ✅ T-AI-01..04 | ✅ | ✅ | ✅ |
| Email (send) | action | ✅ round 12 (5/5) | ✅ `actions/email.md` grilled | ✅ T-EMAIL-01..04 | ✅ | ✅ | ✅ |
| Solana | action | ✅ round 13 (5/5) | ✅ `actions/solana.md` grilled (read-only) | ✅ T-SOL-01..03 | ✅ | ✅ | ✅ |
| Webhook (request) | action | ✅ round 14 (6/6) | ✅ `actions/webhook.md` grilled | ✅ T-WHA-01..04 | ✅ | ✅ | ✅ |
| WhatsApp (send) | action | ✅ round 15 (6/6) | ✅ `actions/whatsapp.md` grilled | ✅ T-WA-A-01..04 | ✅ | ✅ | ✅ |
| Telegram (send) | action | ✅ round 16 (5/5) | ✅ `actions/telegram.md` grilled | ✅ T-TG-A-01..04 | ✅ | ✅ | ✅ |
| Discord | action | ⏭️ excluded — follows the process | ⏭️ | ⏭️ | ⏭️ | ⏭️ | ⏭️ |

**Totals:** 14 items in scope · **14/14 grilled** · **14/14 specs finalized** ·
**14/14 implemented** (each with fixtures) · **14/14 reviewed + shipped** ·
1 item excluded (Discord).

## Cross-cutting coverage (apply to ALL items)

| Concern | Where specified | Status |
|---|---|---|
| Connection/auth model | §X Q-X-03 — **one shared connection per provider** | ✅ decided |
| Secrets handling (never in logs) | per-spec Edge Cases + review checklists | ✅ specified |
| Dedupe / idempotency | per-spec (messageId / deliveryId / update_id / occurrenceKey / x-request-id…) | ✅ specified |
| Event delivery mode | §X Q-X-04 — **webhooks preferred, polling fallback** (applied per item) | ✅ decided |
| Test-data behavior | §X Q-X-05 — **instant sample data, no waiting** | ✅ decided |
| Failure/retry UX | §X Q-X-06 — **bounded backoff then halt** (method-aware overrides per spec) | ✅ decided |
| Polling cadence & rate limits | per-spec | ✅ specified |
| Error taxonomy (auth/rate-limit/invalid-input/upstream) | per-spec Acceptance Criteria | ✅ specified |
| Data contract → downstream mapping | per-spec `Data contract` | ✅ specified |
| Sub-skill `/tdd` at implementation | Tickets section of every spec | ⛔ planned, blocked |
| Sub-skill `/code-review` at review | Tickets section of every spec | ⛔ planned, blocked |
| Sub-skill `/domain-modeling` — shared payload types | drafted inline per spec; unify at implement | 🟡 deferred to gate |
| Sub-skill `/codebase-design` — module placement | intentionally NOT authored (no codebase exploration) | ⛔ deferred to /implement gate |

## On-ramps & upkeep (screenshot 3) — status for this run

| Phase | Used? | Why |
|---|---|---|
| `/retro`, `/triage` | no | not a backlog/refactor run |
| `/diagnosing-bugs` | no | nothing reported broken |
| `/wayfinder` | no | direction provided via screenshots |
| `/improve-codebase-architecture` | no | upkeep not requested |

**Gap-comparison tip:** print this file, walk your repo item by item, and annotate the
right of each row with `present` / `partial` / `missing` / `differs`. Anything not
traceable back to a spec cell is, by definition, "what you miss".
