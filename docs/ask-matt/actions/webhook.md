# A4 — Webhook Action / HTTP Request (Action Spec)

Status: 🟢 `grilled` — answers in `03-grill-log.md` §A4 · Phase: `/to-tickets` ✓ · `/implement` ⛔ blocked

> Distinct from **T5** (incoming catch hook). This is the **outbound** generic HTTP-call
> step — the escape hatch that integrates everything else.

## 1. Summary & user story

Call any HTTP endpoint from a Zap step.

> **As a** Zap builder, **I want** to make an authenticated, templated HTTP request with
> mapped fields, **so that** any API not natively integrated still works.

## 2. Capability surface — ✅ grilled

| # | Aspect | v1 verdict |
|---|---|---|
| C1 | Methods | ✅ **GET, POST, PUT, PATCH, DELETE** (Q-WHA-01) |
| C2 | Auth | ✅ **None / Basic / Bearer / API key** (Q-WHA-02) — OAuth2 ❌ backlog |
| C3 | Body | ✅ **JSON + x-www-form-urlencoded + raw text** (Q-WHA-03) — multipart ❌ backlog |
| C4 | Headers/query | ✅ static + `{{mapped}}` templating, sane default Content-Type |
| C5 | Response use | ✅ **status + parsed body + headers** (Q-WHA-04) — JSON-path ❌ backlog |
| C6 | Hardening | ✅ timeouts, redirects, TLS verify, status policy + retry per below |

## 3. Configuration & auth (✅ grilled)

- **Connections (✅ Q-WHA-02):** lean auth set — `none | basic | bearer | api_key`;
  credentials stored per connection (header or query placement for api-key), reusable
  across Zaps (Q-X-03), never echoed in logs/runs.
- **Per-request config:** method, URL (templated), query params, headers, auth ref,
  body mode (JSON / form / raw) + template, timeout (default 30s), follow-redirects
  (default on, cap 5, **never forward Authorization cross-host**), TLS verify (default on,
  disable = explicit ack), **status policy** (✅ Q-WHA-06), **retry policy** (✅ Q-WHA-05).
- **Status policy (✅ Q-WHA-06):** non-2xx ⇒ run error **by default**, with **per-step
  override toggle** (allow specific or any statuses — e.g. 404 is a valid answer).
- **Retry (✅ Q-WHA-05):** **idempotent-only** — GET/PUT/DELETE retry with bounded
  exponential backoff on 5xx/timeout (house Q-X-06 budgets); **POST/PATCH fail fast**
  (no duplicate side effects). 4xx never retried.

## 4. Data contract

Inputs (per run):

```json
{
  "method": "POST",
  "url": "https://api.example.com/v1/orders",
  "headers": { "X-Custom": "{{orderId}}" },
  "query": { "dry": "false" },
  "auth": { "type": "bearer", "tokenRef": "conn:api/cred1" },
  "bodyMode": "json",
  "body": { "sku": "{{sku}}", "qty": 3 },
  "timeoutMs": 30000
}
```

Output:

```json
{
  "status": 201,
  "ok": true,
  "responseBody": { "id": "ord_9", "state": "created" },
  "responseText": "{…}",
  "responseHeaders": { "content-type": "application/json" },
  "durationMs": 412,
  "url": "https://api.example.com/v1/orders?dry=false",
  "retries": 0,
  "error": null
}
```

- `responseBody` parsed when JSON; otherwise `null` + `responseText` carries bytes
  (never crash on parse).
- Error runs include status + first N chars of body, **secrets redacted**.

## 5. Behavior & edge cases

- **Non-2xx:** error by default (with `status`, redacted excerpt); override toggle per step.
- Timeouts/DNS ⇒ `network` error; retries only for idempotent verbs (above).
- Redirects: max 5; Authorization header stripped on cross-host hop.
- Response size cap 10 MB → truncated flag.
- SSRF guardrail: block link-local/metadata targets by default (allowlist toggle for
  advanced users) — reviewed in `/code-review`.
- Secrets: auth values redacted in logs and stored request echoes.
- Binary/streaming responses: out of scope (use prior-step file support later).

## 6. Acceptance criteria (v1)

- Given POST + JSON body + bearer auth, endpoint receives templated payload; response
  parsed per contract (`retries: 0`).
- Given 500 on GET, bounded backoff retries then classified failure (house budget).
- Given 500 on POST, **no retry** — immediate classified failure (idempotent-only rule).
- Given status covered by the override toggle, run succeeds with `ok: true/false` + fields.
- Given timeout, classified `network` error after method-appropriate retry policy.
- Given non-JSON response, `responseText` usable downstream.
- Auth secrets never appear in logs or echoes.

## 7. Open questions — ✅ all answered (round 14)

| ID | Question | Answer |
|---|---|---|
| Q-WHA-01 | Methods? | ✅ **Five REST verbs** |
| Q-WHA-02 | Auth? | ✅ **None/Basic/Bearer/API key** (OAuth2 backlog) |
| Q-WHA-03 | Body modes? | ✅ **JSON + form + raw** |
| Q-WHA-04 | Response surface? | ✅ **Base (status + body + headers)**; JSON-path backlog |
| Q-WHA-05 | Retries? | ✅ **Idempotent-only**; POST/PATCH fail fast |
| Q-WHA-06 | Non-2xx? | ✅ **Error by default + per-step override** |

## 8. Tickets (⛔ blocked until final confirmation)

- **T-WHA-01** `/implement` + `/tdd` — request builder, four auth types, three body modes,
  status policy + override, method-aware retry, response contract.
- **T-WHA-02** fixtures: 2xx JSON, 4xx, 5xx GET-with-retry vs POST-fail-fast, timeout,
  redirect w/ auth-strip, non-JSON, secret redaction.
- **T-WHA-03** SSRF/redirect-security review folded into `/code-review`.
- **T-WHA-04** `/pr` referencing this file.
