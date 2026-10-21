# A2 — Email / Send Email (Action Spec)

Status: 🟢 `grilled` — answers in `03-grill-log.md` §A2 · Phase: `/to-tickets` ✓ · `/implement` ⛔ blocked

## 1. Summary & user story

Send an email from a Zap step.

> **As a** Zap builder, **I want** to send a (possibly templated) email with mapped fields
> as recipients and content, **so that** notifications and digests leave automatically.

## 2. Operation & fields — ✅ grilled

Single operation **Send Email** with the **full field set (✅ Q-EMAIL-02):**
`to` (1..n), `cc`, `bcc`, `subject`, `bodyPlain`, `bodyHtml`, `replyTo`, `fromName`,
`fromEmail` — all templatable with `{{mapped}}` inputs.

## 3. Configuration & auth (✅ grilled)

- **Mechanism (✅ Q-EMAIL-01):** **Gmail API** — reuses the **shared Google connection**
  from trigger T1 (Q-X-03); no new connection type. Requires the Google OAuth scopes on
  that connection to include Gmail send capability (`gmail.modify` already covers
  `gmail.send` — consistent with T1's grilled scope choice).
- **From-address (✅ Q-EMAIL-05):** user-configured per step (defaulted from the connected
  mailbox), **constrained to identities the Gmail account actually owns** (mailbox address
  + verified aliases); provider rejection on send ⇒ classified `from_not_allowed` error.
- **Body (✅ Q-EMAIL-03):** `bodyPlain` **and** `bodyHtml` per run → multipart alternative
  (Gmail API sets both; plain required — if only HTML given, derive plain fallback? **No**:
  plain is required field, HTML optional — see validation below).
- **Attachments (✅ Q-EMAIL-04):** URL-based, fetched **≤ 5 MB**; unreachable/oversize ⇒
  **fail the run** (`attachment_fetch_failed`) — never silently omit.

## 4. Data contract

Inputs (per run):

```json
{
  "to": ["ada@example.com", "bob@example.com"],
  "cc": ["lead@example.com"],
  "bcc": [],
  "subject": "Weekly digest — wk 43",
  "bodyPlain": "Hi Ada, …",
  "bodyHtml": "<p>Hi Ada…</p>",
  "fromName": "ZapMate Digests",
  "fromEmail": "digests@example.com",
  "replyTo": "support@example.com",
  "attachments": [{ "url": "https://…/report.pdf", "filename": "report.pdf" }]
}
```

Output:

```json
{
  "sent": true,
  "messageId": "CAQR7…",
  "accepted": ["ada@example.com", "bob@example.com"],
  "rejected": [],
  "provider": "gmail-api",
  "sentAt": "2026-10-21T09:14:02Z"
}
```

- Validation: ≥1 recipient, syntactically valid addresses, **bodyPlain required**,
  bodyHtml optional, subject required (empty allowed only if attachment-only — no: subject
  required outright, lean).

## 5. Behavior & edge cases

- **Address validation** pre-send: invalid recipient ⇒ validation error naming the value;
  no partial mystery sends.
- **Attachment fetch failure / >5 MB ⇒ fail run** (✅ Q-EMAIL-04) with URL + reason.
- Multipart: both bodies sent; Gmail renders per recipient client.
- Unicode subjects/bodies (UTF-8 native via Gmail API).
- **Idempotency:** timeout after Gmail accepted ⇒ possible duplicate; carry run-id in
  `X-MCP-Run-Id`-style header if supported, else document at-least-once (bounded retry per
  Q-X-06).
- Quota: Gmail API user quotas (250/user/day send-ish — actual value verified at
  implementation) ⇒ quota-class error with clear message.
- Connected-mailbox revocation ⇒ auth-class error.
- Secrets: OAuth tokens never in logs.

## 6. Acceptance criteria (v1)

- Given valid recipients + plain body (+optional HTML/attachments), mail accepted by Gmail
  API; `sent: true` + messageId.
- Given invalid address or missing bodyPlain, pre-send validation error; nothing sent.
- Given unreachable/oversize attachment URL, run fails with `attachment_fetch_failed`.
- Given from-address the account doesn't own, `from_not_allowed` classified error.
- Given quota exhaustion, quota-class error; tokens redacted everywhere.

## 7. Open questions — ✅ all answered (round 12)

| ID | Question | Answer |
|---|---|---|
| Q-EMAIL-01 | Mechanism? | ✅ **Gmail API, shared Google connection** |
| Q-EMAIL-02 | Fields? | ✅ **Full set** |
| Q-EMAIL-03 | Body? | ✅ **Plain + HTML** |
| Q-EMAIL-04 | Attachments? | ✅ **URL ≤ 5 MB, fail if unreachable** |
| Q-EMAIL-05 | From policy? | ✅ **User-configured within owned identities** |

## 8. Tickets (⛔ blocked until final confirmation)

- **T-EMAIL-01** `/implement` + `/tdd` — field parsing/validation, multipart build, URL
  attachment fetch with caps, from-identity check, error classes.
- **T-EMAIL-02** fixtures: multi-recipient, invalid address, missing body, attachment
  failure/oversize, foreign from-address, quota error.
- **T-EMAIL-03** `/code-review` against acceptance criteria (secret redaction).
- **T-EMAIL-04** `/pr` referencing this file.
