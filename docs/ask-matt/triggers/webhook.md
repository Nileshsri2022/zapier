# T5 — Webhook Trigger / Catch Hook (Trigger Spec)

Status: 🟢 `grilled` — answers in `03-grill-log.md` §T5 · Phase: `/to-tickets` ✓ · `/implement` ⛔ blocked

## 1. Summary & user story

Start a Zap when any external system calls a URL we provision.

> **As a** Zap builder, **I want** a unique hook URL for my Zap step, **so that** any tool
> that can make an HTTP request can trigger my workflow without a native integration.

## 2. Behavior variants — ✅ grilled

| # | Variant | v1 verdict |
|---|---|---|
| V1 | Methods accepted | ✅ **POST, GET, PUT, PATCH, DELETE — all** (Q-WHT-01) |
| V2 | Test vs production hook | ✅ **Separate URLs**; test stores samples, fires nothing (Q-WHT-05) |
| V3 | Response behavior | ✅ **Fixed 200, empty body** (Q-WHT-04) |
| V4 | Incoming auth | ✅ **Per-hook selectable: none / static key / HMAC** (Q-WHT-02) |
| V5 | Payload handling | ✅ **JSON + `x-www-form-urlencoded` + query-string**; multipart ❌ (Q-WHT-03) |
| V6 | Retry dedupe | ✅ **`x-request-id` header dedupe when present** (Q-WHT-06) |

## 3. Configuration & auth

- **Connection:** none — the hook itself is the credential surface.
- **Per-Zap config:** generated URLs (separate **test** and **production** ids), method
  restrictions (default: accept all five verbs), auth mode (none/static key/HMAC) +
  secret, accepted content types (JSON, form; everything else → `bodyRaw`).
- **URL lifecycle (✅ Q-WHT-05):** rotation **immediately revokes** the old URL — no grace
  period (builds must update senders atomically; documented in rotation dialog).
- **Test URL:** stores sample payloads for field mapping, **never** triggers downstream
  (aligned with Q-X-05).

## 4. Data contract

```json
{
  "method": "POST",
  "url": "https://…/hooks/abc123",
  "pathParams": { },
  "query": { "token": "…" },
  "headers": { "content-type": "application/json", "x-request-id": "abc", "x-signature": "…" },
  "body": { "event": "payment.succeeded", "amount": 499 },
  "bodyRaw": "{\n  \"event\": \"payment.succeeded\"\n}",
  "receivedAt": "2026-10-21T09:14:02Z"
}
```

- `body` = parsed object for JSON / field map for form-encoded / query object for GET-style;
  `bodyRaw` always present as fallback (non-JSON, e.g. XML, lands here — no parsing).
- `headers`: allowlist surfaced; `authorization`/`cookie` **redacted by default**, HMAC
  signature header surfaced when HMAC mode active.
- Nested JSON/array mapping convention documented for field picker
  (`body.data.items.0.sku`).

## 5. Behavior & edge cases

- **Ack fast** (<1s), then execute downstream (never block the caller on action completion).
- Multipart (✅ not supported): respond per content-type rules — `body: null`, `bodyRaw`
  carries best-effort raw (size-capped); documented as unsupported for parsing.
- **Auth mode:** static key mismatch → 401/403, no run; HMAC invalid → 403, no run;
  auth modes off → open hook (unguessable URL is the only gate — warned in UI).
- **Dedupe (✅ Q-WHT-06):** incoming `x-request-id` seen within retention window → 200 ack
  but **no run**; absent header → always run.
- Body size cap → 413, no run. All five verbs validated (e.g. DELETE with body tolerated).
- CORS `OPTIONS` preflight answered (browsers can hit hooks).
- Secrets/auth headers never logged.

## 6. Acceptance criteria (v1)

- Given a valid JSON POST to the production hook, downstream runs exactly once, caller gets
  200 empty body within 1s.
- Given GET with query params, `query` (+ empty `body`) exposed correctly.
- Given PUT/PATCH/DELETE, hook accepts and runs (per V1).
- Given invalid static key or HMAC (when enabled), 401/403 and **no** run.
- Given duplicate `x-request-id`, 200 ack, **no** second run.
- Given a request to the test hook, sample stored, zero downstream runs.
- Given a rotated URL, old URL fails immediately with a clear error.
- Field mapper can address nested and array elements.

## 7. Open questions — ✅ all answered (round 7)

| ID | Question | Answer |
|---|---|---|
| Q-WHT-01 | Methods accepted? | ✅ **All five verbs** |
| Q-WHT-02 | Incoming auth? | ✅ **None / static key / HMAC — selectable per hook** |
| Q-WHT-03 | Multipart uploads? | ✅ **No** (JSON + form only) |
| Q-WHT-04 | Response behavior? | ✅ **Fixed 200 empty** |
| Q-WHT-05 | Test/prod URLs + rotation? | ✅ **Separate URLs; rotation = immediate revoke** |
| Q-WHT-06 | Retry dedupe? | ✅ **`x-request-id` when present** |

## 8. Tickets (⛔ blocked until final confirmation)

- **T-WHT-01** `/implement` + `/tdd` — URL provisioning (test/prod), five-verb parsing
  matrix, three auth modes, fixed-ack, `x-request-id` dedupe.
- **T-WHT-02** fixtures: JSON/form/non-JSON/oversize, each verb, bad key, bad HMAC,
  duplicate id, test-hook capture, rotation revoke.
- **T-WHT-03** `/code-review` against acceptance criteria (secret redaction focus).
- **T-WHT-04** `/pr` referencing this file.
