# T6 — WhatsApp Inbound (Trigger Spec)

Status: 🟢 `grilled` — answers in `03-grill-log.md` §T6 · Phase: `/to-tickets` ✓ · `/implement` ⛔ blocked

## 1. Summary & user story

Start a Zap when a WhatsApp message arrives for a connected business number.

> **As a** Zap builder, **I want** my Zap to fire when a customer messages my WhatsApp
> Business number, **so that** support, CRM, or AI steps can react instantly.

## 2. Trigger events — ✅ grilled (Q-WA-T-01)

| # | Event | v1 verdict |
|---|---|---|
| E1 | New Incoming Message | ✅ **IN SCOPE** — the only v1 event |
| E2 | Message Status Update (sent/delivered/read/failed) | ❌ backlog |
| E3 | New Conversation Started | ❌ backlog |

**Provider (✅ Q-WA-T-02):** Meta **WhatsApp Cloud API** webhook model confirmed.

## 3. Configuration & auth (✅ grilled)

- **Connection:** shared per-provider Meta connection (Q-X-03) — Meta app credentials:
  WABA **phone number id(s)**, **verify token**, **app secret**. Reused by send action A5.
- **Signature (✅ Q-WA-T-04):** **mandatory** `X-Hub-Signature-256` validation with app
  secret — unsigned/invalid payloads **always rejected** (non-2xx per Meta retry semantics;
  no run created).
- **Per-Zap config (✅ Q-WA-T-05):** **phone number id filter** — multi-number WABA
  connections route each number to the Zap(s) that watch it; no message-level filters in v1.
- **Webhook wiring:** GET challenge (`hub.challenge` echo) for verification; POST →
  `messages` subscription only (status/template callbacks ignored in v1, E2 backlog).
- House rules: test mode = instant sample data (Q-X-05); retry-with-backoff-then-stop (Q-X-06).

## 4. Data contract

```json
{
  "event": "message",
  "messageId": "wamid.HBgLM…",
  "from": "919876543210",
  "fromProfileName": "Ada",
  "chatId": "919876543210",
  "phoneNumberId": "1098…",
  "timestamp": "2026-10-21T09:14:02Z",
  "type": "text",
  "text": { "body": "Hi, where is my order?" },
  "media": null,
  "caption": null,
  "raw": { }
}
```

- `type` ∈ `text | image | audio | video | document | sticker | location | contacts |
  interactive | button | unknown`.
- **Media (✅ Q-WA-T-03):** **metadata only** — `media: { id, mimeType, filename, sha256,
  caption }`; content fetch is explicitly out of v1 (short-lived media URLs documented as
  limitation; a "Get Media" action sits in backlog).
- `raw` = original webhook payload; agreed fields lifted to top level.

## 5. Behavior & edge cases

- **Signature validation mandatory:** invalid → reject + security log; never a run.
- GET verification challenge echoes `hub.challenge`; connection tester proves the whole path.
- Meta **retries deliveries** → dedupe on `messageId` (non-negotiable): second delivery
  ack'd appropriately, zero extra runs.
- **Phone number id filter:** payload's destination number id must match the Zap's filter
  (multi-number connections); mismatch → ack, no run.
- High-burst inbound → queue, don't drop; honor Meta inbound throttling guidance.
- Unknown `type` → forward with `type: "unknown"` + `raw` (never drop silently).
- Media metadata surfaced even though content isn't fetched (v1 documented scope).

## 6. Acceptance criteria (v1)

- Given a signed inbound message for the watched number id, exactly one run with contract
  fields populated.
- Given identical redelivered webhook, **no** second run.
- Given invalid/missing signature, payload rejected; no run; security log entry.
- Given GET verification challenge, correct echo → Meta marks webhook verified.
- Given message for a different number id on the connection, ack only, no run.
- Given unknown message type, run still fires with `raw` intact.
- Connection tester validates verify-token + signature end-to-end.

## 7. Open questions — ✅ all answered (round 8)

| ID | Question | Answer |
|---|---|---|
| Q-WA-T-01 | Events in v1? | ✅ **Inbound messages only (E1)** |
| Q-WA-T-02 | Provider confirmed? | ✅ **Meta WhatsApp Cloud API** |
| Q-WA-T-03 | Media handling? | ✅ **Metadata only** |
| Q-WA-T-04 | Signature validation? | ✅ **Mandatory** |
| Q-WA-T-05 | Filters? | ✅ **By phone number id** |

## 8. Tickets (⛔ blocked until final confirmation)

- **T-WA-T-01** `/implement` + `/tdd` — verify challenge, mandatory signature check,
  messageId dedupe, number-id filter, contract.
- **T-WA-T-02** fixtures: text, each media type, redelivery, bad signature, wrong number id,
  unknown type.
- **T-WA-T-03** `/code-review` against acceptance criteria (secrets + PII handling).
- **T-WA-T-04** `/pr` referencing this file.
