# T7 — Telegram Inbound (Trigger Spec)

Status: 🟢 `grilled` — answers in `03-grill-log.md` §T7 · Phase: `/to-tickets` ✓ · `/implement` ⛔ blocked

## 1. Summary & user story

Start a Zap when a Telegram bot receives a message.

> **As a** Zap builder, **I want** my Zap to fire when someone messages my bot,
> **so that** Telegram traffic can drive downstream workflows.

## 2. Trigger events — ✅ grilled (Q-TG-T-01)

| # | Update type | v1 verdict |
|---|---|---|
| E1 | New Message (`message`) | ✅ **IN SCOPE** |
| E2 | Edited Message (`edited_message`) | ❌ backlog |
| E3 | Channel Post (`channel_post`) | ❌ backlog |
| E4 | Callback Query (inline buttons) | ❌ backlog |

## 3. Configuration & auth (✅ grilled)

- **Connection:** Bot token (shared per provider — Q-X-03; same bot usable by send action A6).
- **Transport (✅ Q-TG-T-02):** **`setWebhook` preferred** (secret-token header validated,
  instant delivery) **+ `getUpdates` polling fallback** where a public HTTPS endpoint
  isn't viable — mirrors GitHub's delivery answer.
- **Per-Zap config (✅ Q-TG-T-03):** **chat-type filter** — multi-select
  `private / group / channel`; no chat-id list in v1.
- **Consumption (✅ Q-TG-T-05):** **at-least-once** — webhook/poll offset advances only
  after the run succeeds; bounded retry then halt (Q-X-06) ⇒ Telegram redelivers later;
  **dedupe on `update_id`** guarantees single execution across redeliveries.
- House rules: test mode = instant sample data (Q-X-05).

## 4. Data contract

```json
{
  "updateId": 8472631,
  "messageId": 12034,
  "chat": { "id": -1001234567890, "type": "group", "title": "Support", "username": null },
  "from": { "id": 4711, "isBot": false, "firstName": "Ada", "lastName": "L", "username": "ada" },
  "date": 1760990042,
  "text": "/start",
  "entities": [{ "type": "bot_command", "offset": 0, "length": 6 }],
  "media": { "type": "photo", "fileId": "AgACAgIAAx…", "uniqueId": "AQAD…", "mimeType": "image/jpeg", "caption": null },
  "replyToMessageId": null,
  "raw": { }
}
```

- **Media (✅ Q-TG-T-04):** metadata only — `media.fileId` is globally fetchable later
  while the bot token lives; `caption` carried alongside; `media: null` for text messages.
- Text messages: `text` populated; non-text (media-only) messages: `text: null`, media slice
  populated — both still fire (chat-type filter permitting).
- `raw` = full update object (future update types still visible for debugging).

## 5. Behavior & edge cases

- **Dedupe:** `update_id` — mandatory store (webhook secret path and polling path share it).
- **At-least-once:** offset/ack advances only on success; failed run → bounded retry →
  halt (user sees classified error) → redelivery on next poll/webhook retry; dedupe
  prevents double-run after recovery.
- Chat-type filter: update's chat type must match selection (mismatch → ack/drop, no run).
- Groups: bots may be privacy-restricted (only commands/replies visible) — surfaced in UI copy.
- 401 bad token → auth-class; 409 webhook conflict → clear error (another webhook set);
  429 → honor `retry_after`.
- Forwarded/sticker/empty-text messages: `text: null`, still fire.
- Bot must be reachable for chats (member/admin for groups/channels) — 403s classified.

## 6. Acceptance criteria (v1)

- Given an inbound message matching the chat-type filter, exactly one run with contract fields.
- Given the same `update_id` redelivered, **no** duplicate run.
- Given an update outside the filter (or of an excluded type), ack/drop — zero runs.
- Given a photo message, `media` metadata populated, run fires.
- Given a failed downstream step, bounded retry then halt; update redelivered later without
  double-execution post-recovery.
- Given invalid token, actionable auth error; 429 backoff honored.

## 7. Open questions — ✅ all answered (round 9)

| ID | Question | Answer |
|---|---|---|
| Q-TG-T-01 | Update types? | ✅ **Messages only (E1)** |
| Q-TG-T-02 | Transport? | ✅ **setWebhook preferred, polling fallback** |
| Q-TG-T-03 | Chat filters? | ✅ **By chat type (multi-select)** |
| Q-TG-T-04 | Media? | ✅ **Metadata only** (`file_id`) |
| Q-TG-T-05 | Dedupe/semantics? | ✅ **`update_id` + at-least-once** |

## 8. Tickets (⛔ blocked until final confirmation)

- **T-TG-T-01** `/implement` + `/tdd` — webhook + polling transports, offset/ack discipline,
  update_id dedupe, chat-type filter, contract.
- **T-TG-T-02** fixtures: private/group/channel match & mismatch, media, duplicate update,
  failure-redelivery, 401/409/429.
- **T-TG-T-03** `/code-review` against acceptance criteria.
- **T-TG-T-04** `/pr` referencing this file.
