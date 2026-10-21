# T1 — Gmail (Trigger Spec)

Status: 🟢 `grilled` — answers in `03-grill-log.md` §T1 · Phase: `/to-tickets` ✓ · `/implement` ⛔ blocked

## 1. Summary & user story

Start a Zap when mail arrives in a Gmail mailbox.

> **As a** Zap builder, **I want** to fire my Zap when a new email arrives (optionally
> matching a query), **so that** downstream actions can react to real inbox activity.

## 2. Candidate trigger events (grill surface)

| # | Event | Definition (to confirm) |
|---|---|---|
| E1 | New Email | Any new message landing in the watched label/mailbox |
| E2 | New Email Matching Search | New message matching a Gmail search query (`from:`, `subject:`, `has:attachment`…) |
| E3 | New Labeled Email | Message newly given a specific label |
| E4 | New Attachment | New message carrying at least one attachment |
| E5 | New Thread / Reply in Thread | New message in an existing watched thread |

**✅ Grilled (Q-GMAIL-01):** **E1, E2, E3 in scope.** E4 (New Attachment) and E5
(Reply in Thread) **dropped for v1** — not built, not half-built.
Any event not confirmed above moves to backlog, not to spec.

## 3. Configuration & auth

- **Connection:** Google OAuth — **single mailbox per connection, `gmail.modify` scopes**
  (✅ Q-GMAIL-05; `modify` reserved for future label/archive reuse).
- **Per-Zap config:** label (default `INBOX`), search query (for E2), max results per poll,
  dedupe cursor storage (history id / last-seen message id).
- **Delivery mode (✅ Q-GMAIL-02):** **Pub/Sub push primary (near-instant) + API polling
  as fallback/catch-up.** Infra: GCP project, Pub/Sub topic, push endpoint with push-auth
  verification — becomes implementation tickets T-GMAIL-01a/b.

## 4. Data contract

Output fields (one Zap run per message):

```json
{
  "messageId": "18f2a…",
  "threadId": "18f2a…",
  "from": "Ada <ada@example.com>",
  "to": ["me@example.com"],
  "cc": [],
  "subject": "Invoice #42",
  "snippet": "Please find the invoice…",
  "bodyPlain": "…",
  "bodyHtml": null,
  "labels": ["INBOX", "INBOX"],
  "attachments": [{ "filename": "inv.pdf", "mimeType": "application/pdf", "size": 12345, "attachmentId": "…" }],
  "date": "2026-10-21T09:14:02Z",
  "permalink": "https://mail.google.com/mail/u/0/#all/18f2a…"
}
```

- `bodyPlain` **and** `bodyHtml` both populated (✅ Q-GMAIL-03); plain capped ~100 KB with
  truncation flag.
- `attachments[]`: filename/mime/size/id always; **content fetched ≤ 5 MB** (✅ Q-GMAIL-04),
  larger → metadata only + `contentTruncated: true`.
- Downstream mapping: every field above must be selectable in action field-pickers.

## 5. Behavior & edge cases

- **Dedupe:** key `messageId` + history cursor; a message must never fire twice across polls.
- Spam/Trash excluded by default; promotions category behavior to confirm.
- Large bodies: truncation strategy + flag field if truncated.
- Attachments: metadata-only vs fetched bytes changes size limits (Q-GMAIL-04).
- OAuth token refresh & revocation → distinct `auth` error class, Zap paused with reason.
- Gmail API rate limits: batch politely; backoff, never tight-loop.
- Multiple simultaneous Zaps on one mailbox must not steal each other's cursor state.

## 6. Acceptance criteria

- Given a new matching email, the Zap fires within one poll interval, exactly once.
- Given a non-matching email (when query set), no run is produced.
- Given revoked OAuth, the run fails with an actionable auth error, not a generic crash.
- Given a message with attachment and Q-GMAIL-04 = content, downstream can read bytes;
  if metadata-only, `attachments[]` still populated.
- All agreed output fields appear in the field mapper.

## 7. Open questions — ✅ all answered (round 3)

| ID | Question | Answer |
|---|---|---|
| Q-GMAIL-01 | Which of E1–E5 are in scope for v1? | ✅ **E1 New Email + E2 Matching Search + E3 New Labeled Email** (E4/E5 backlog) |
| Q-GMAIL-02 | Polling only, or also Gmail push (Pub/Sub) for lower latency? | ✅ **Both** — push primary, polling fallback |
| Q-GMAIL-03 | Body output: plain text, HTML, or both? Truncation limit? | ✅ **Both** (`bodyPlain` ~100 KB cap + `bodyHtml`) |
| Q-GMAIL-04 | Attachments: metadata only, or fetch content up to a size cap? | ✅ **Fetch ≤ 5 MB**, else metadata + `contentTruncated` |
| Q-GMAIL-05 | Account scope: single mailbox per connection? Which OAuth scopes minimally? | ✅ **Single mailbox, `gmail.modify`** |

## 8. Tickets (⛔ blocked until final confirmation)

- **T-GMAIL-01** `/implement` + `/tdd` — event selection, polling/cursor, data contract,
  error classes; tests written red-first per `/tdd`.
- **T-GMAIL-02** fixtures for dedupe/rate-limit/auth-failure paths.
- **T-GMAIL-03** `/code-review` against this spec's acceptance criteria.
- **T-GMAIL-04** `/pr` referencing this file in description.
