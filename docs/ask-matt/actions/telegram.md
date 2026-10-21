# A6 — Telegram Send (Action Spec)

Status: 🟢 `grilled` — answers in `03-grill-log.md` §A6 · Phase: `/to-tickets` ✓ · `/implement` ⛔ blocked

## 1. Summary & user story

Send a Telegram message from a Zap step.

> **As a** Zap builder, **I want** my bot to post a (mapped) message into a chat, channel,
> or user DM, **so that** workflow outcomes show up in Telegram instantly.

## 2. Capability surface — ✅ grilled

| # | Aspect | v1 verdict |
|---|---|---|
| O1 | Send Text | ✅ **IN SCOPE** (`sendMessage`) |
| O2 | Send media | ✅ **Photo + document with caption** (`sendPhoto`, `sendDocument`) — other media ❌ backlog |
| O3 | Formatting | ✅ **Parse mode off by default; HTML & MarkdownV2 selectable per step** (Q-TG-A-02) |
| O4 | Chat targeting | ✅ **Numeric chat/user IDs + @usernames** (forum thread ids ❌ backlog) |
| O5 | Options | ✅ **Full set**: link-preview toggle (default **off**), silent toggle, reply-to field (Q-TG-A-05) |

## 3. Configuration & auth (✅ grilled)

- **Connection:** Bot token — **shared per provider** with trigger T7 (Q-X-03).
- **Per-run config:** chat target (templated — numeric id or @username, validated),
  text (required for text sends) or media (URL or `file_id`) + caption, parse mode,
  preview/silent toggles, reply-to message id.
- **Permissions copy (UI):** bot must be member/admin of target group/channel; users must
  have started the bot for DMs — Telegram 403s mapped to actionable errors.
- House rules: instant sample data in test mode (Q-X-05); bounded backoff on 429 (Q-X-06).

## 4. Data contract

Inputs:

```json
{
  "chatId": "-1001234567890",
  "text": "Order 42 shipped 📦",
  "media": { "kind": "photo", "source": "https://…/label.png", "caption": "Label preview" },
  "parseMode": "HTML",
  "linkPreview": false,
  "silent": false,
  "replyToMessageId": null
}
```

Output:

```json
{
  "sent": true,
  "messageId": 12099,
  "chat": { "id": -1001234567890, "type": "channel", "title": "Ops" },
  "date": 1761012842,
  "text": "Order 42 shipped 📦",
  "apiResponse": { "ok": true },
  "error": null
}
```

- Exactly one of `text` / `media` required (media may carry caption; caption limit mirrors
  Telegram's 1024 with same fail-loud policy as Q-TG-A-04).

## 5. Behavior & edge cases

- **4096-char limit (✅ Q-TG-A-04):** pre-send validation ⇒ `message_too_long` error with
  current/max lengths — **no truncation, no auto-split**.
- **Parse mode (✅ Q-TG-A-02):** default none (templated data can never break parsing);
  when HTML/MarkdownV2 selected and Telegram rejects markup ⇒ `parse_error` with offset
  detail from API response.
- Chat targeting: numeric id (group/channel/user) or @username resolved by API; unknown
  target ⇒ classified `chat_not_found`.
- 409 (bot conflict — another webhook/process) ⇒ clear operational error; 401 bad token ⇒
  auth-class; 429 ⇒ honor `retry_after` (bounded, Q-X-06).
- Media: URL fetch (source) or stable `file_id`; fetch failure ⇒ `media_fetch_failed`,
  run fails (no silent text substitute).
- Empty text with no media ⇒ validation error; token never logged.
- Rate limit ~30 msg/sec/bot → queue bursts.

## 6. Acceptance criteria (v1)

- Given valid chat + text, message posted; contract carries real `messageId` + chat info.
- Given parse mode set and invalid markup, `parse_error` with helpful detail — no send.
- Given text > 4096 chars, pre-send `message_too_long` — nothing sent.
- Given photo/document send with reachable source, media posted with caption.
- Given bot lacking permission / user never started bot, actionable 403-class error.
- Given 429, `retry_after` honored; final errors classified; token redacted.

## 7. Open questions — ✅ all answered (round 16)

| ID | Question | Answer |
|---|---|---|
| Q-TG-A-01 | Scope? | ✅ **Text + photo/document** |
| Q-TG-A-02 | Parse mode? | ✅ **None default; HTML/MarkdownV2 selectable** |
| Q-TG-A-03 | Chat target? | ✅ **IDs + @usernames** |
| Q-TG-A-04 | Over-limit policy? | ✅ **Fail loudly** |
| Q-TG-A-05 | Extras? | ✅ **Full options (previews off default, silent, reply-to)** |

## 8. Tickets (⛔ blocked until final confirmation)

- **T-TG-A-01** `/implement` + `/tdd` — three send methods, parse-mode handling, validation
  (length/chat/media), options plumbing, error classes.
- **T-TG-A-02** fixtures: happy path text/photo/document, parse error, over-limit,
  chat-not-found, media 404, 403, 429.
- **T-TG-A-03** `/code-review` against acceptance criteria.
- **T-TG-A-04** `/pr` referencing this file.
