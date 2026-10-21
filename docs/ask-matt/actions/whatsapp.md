# A5 — WhatsApp Send (Action Spec)

Status: 🟢 `grilled` — answers in `03-grill-log.md` §A5 · Phase: `/to-tickets` ✓ · `/implement` ⛔ blocked

## 1. Summary & user story

Send a WhatsApp message from a Zap step.

> **As a** Zap builder, **I want** to send templated or in-session WhatsApp messages to a
> mapped recipient from a chosen sender number, **so that** alerts and conversations reach
> customers where they are.

## 2. Capability surface — ✅ grilled

| # | Aspect | v1 verdict |
|---|---|---|
| F1 | Message kinds | ✅ **Templates + freeform** with **24h window enforced** (Q-WA-A-01) |
| F2 | Content types | ✅ text; **media via link (URL) + caption** (Q-WA-A-03) — uploaded media-id ❌ backlog |
| F3 | Template params | ✅ **positional `{{1}}..{{n}}`**, template chosen from **approved-template dropdown** fetched from Meta (Q-WA-A-02) |
| F4 | Recipient | ✅ **strict country-coded phone**, validated pre-send (Q-WA-A-04) |
| F5 | Result | ✅ **API-accepted = success** (Q-WA-A-05) |
| F6 | Sender | ✅ **per-step picker of connection's phone number ids** (Q-WA-A-06) |

## 3. Configuration & auth (✅ grilled)

- **Connection:** shared per-provider **Meta connection** (Q-X-03, same as trigger T6) —
  WABA **phone number id(s)**, permanent access token, business id.
- **Per-run config:**
  - **Sender (✅ Q-WHA… Q-WA-A-06):** pick from the connection's number ids at step level.
  - **Recipient:** templated phone, strict validation (Q-WA-A-04).
  - **Kind:** `template` (name from dropdown incl. language code, positional params from
    mapped fields) **or** `freeform` (text, optional media link + caption).
  - **24h rule (✅ Q-WA-A-01):** freeform outside the customer session window ⇒
    `outside_session_window` classified error with guidance to use a template (no
    auto-fallback — that was not chosen).
- House rules: instant sample data in test mode (Q-X-05); bounded backoff on transient
  Meta errors (Q-X-06).

## 4. Data contract

Inputs:

```json
{
  "fromPhoneNumberId": "1098…",
  "to": "919876543210",
  "kind": "template",
  "template": { "name": "order_update", "language": "en", "params": ["Ada", "OUT-42", "Out for delivery"] },
  "freeform": { "text": "Your order shipped 📦", "mediaUrl": null, "caption": null, "previewUrl": false }
}
```

Output:

```json
{
  "sent": true,
  "messageId": "wamid.HBgLM…",
  "to": "919876543210",
  "fromPhoneNumberId": "1098…",
  "kind": "template",
  "acceptedAt": "2026-10-21T09:14:02Z",
  "error": null
}
```

## 5. Behavior & edge cases

- **Phone validation (✅ strict):** must include country code (`+` optional, digits only
  after normalization); otherwise pre-send `invalid_recipient` naming the raw value.
- **Template errors surfaced:** `template_not_approved`, `template_not_found` (dropdown
  staleness), `param_count_mismatch` (params vs template variables) — validated client-side
  where possible (param count known from dropdown metadata).
- **24h window:** server rejects freeform outside window → classified
  `outside_session_window` (also pre-checked when session-start info exists).
- **Media URL fetch failures** → `media_fetch_failed`, run fails (no silent text-only send).
- Rate tiers (msg/sec) → bounded backoff (Q-X-06); bursts queued not dropped.
- Success = Meta 200 + messageId (✅ Q-WA-A-05) — async delivery statuses are T6-E2
  backlog, explicitly not awaited.
- Token/credentials never logged.

## 6. Acceptance criteria (v1)

- Given approved template + correct positional params, accepted ⇒ `sent: true` + messageId.
- Given freeform **inside** 24h window, accepted; **outside** ⇒ `outside_session_window`
  classified error (no auto-fallback).
- Given phone without country code, pre-send `invalid_recipient` — nothing sent.
- Given param-count mismatch, pre-send validation error when metadata allows.
- Given unreachable media URL, `media_fetch_failed` — run fails.
- Given rate-limit response, bounded backoff honored; token redacted.
- Sender picker only offers number ids present on the connection.

## 7. Open questions — ✅ all answered (round 15)

| ID | Question | Answer |
|---|---|---|
| Q-WA-A-01 | Message kinds? | ✅ **Templates + freeform, 24h enforced** |
| Q-WA-A-02 | Template UX/params? | ✅ **Dropdown + positional params** |
| Q-WA-A-03 | Media? | ✅ **Link-based + caption** |
| Q-WA-A-04 | Phone rules? | ✅ **Strict country-coded validation** |
| Q-WA-A-05 | Success? | ✅ **API-accepted** |
| Q-WA-A-06 | Sender? | ✅ **Per-step number-id picker** |

## 8. Tickets (⛔ blocked until final confirmation)

- **T-WA-A-01** `/implement` + `/tdd` — kinds + 24h enforcement, template dropdown fetch,
  positional param mapping, strict phone validation, media-link send, sender picker,
  error classes.
- **T-WA-A-02** fixtures: template ok, param mismatch, window violation, invalid phone,
  media 404, rate-limit, wrong number id.
- **T-WA-A-03** `/code-review` against acceptance criteria (token redaction).
- **T-WA-A-04** `/pr` referencing this file.
