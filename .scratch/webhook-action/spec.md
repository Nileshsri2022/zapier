# Specification: Webhook Action (`AvailableActions.type = "Webhook"`)

**Status**: Ready for Agent (`ready-for-agent`)  
**Context**: ZapMate Automation Platform  
**Domain Term**: Webhook Action (`GLOSSARY.md`)  
**Governing ADRs**: ADR-0004 (Single Worker Action Engine for Provider-Backed and Stateless Actions)  

---

## Problem Statement

Users need to push processed Zap data to arbitrary external REST APIs, internal microservices, or third-party webhooks using custom HTTP methods, headers, and JSON payloads.

---

## Solution

Provide the outbound `Webhook` action configured via `WebhookMetaData` (`url`, `method`, `headers`, `body`) and executed in `apps/worker` (`sendWebhook` in `apps/worker/src/sendWebhook.ts`) with `{placeholder}` interpolation across URL and body, 30-second `AbortController` timeout, JSON/text response parsing, and step-output capture (`{ url, statusCode, response }`).

---

## User Stories

1. As a Zap creator, I want selecting `Webhook` as an Action (`isVisible > 1`) in `Modal.tsx` to advance to Step 3 (`WebhookMetaData`), so that I can configure the target `url`, `method` (`POST`, `GET`, `PUT`, `PATCH`, `DELETE`), custom `headers` JSON, and request `body` JSON.
2. As a developer running `apps/worker`, I want `executeActionWithRetry` to interpolate `{placeholder}` variables in both `url` and `body` before invoking `sendWebhook`.
3. As a developer running `apps/worker`, I want `sendWebhook` to validate the URL format, omit request body on `GET` requests, apply custom headers alongside default `Content-Type: application/json`, and enforce an `AbortController` timeout (default 30,000 ms).
4. As a downstream step author, I want 2xx/3xx responses parsed as JSON (when `content-type` includes `application/json`) or text and stored in `stepOutputs[stage]` as `{ url, statusCode, response }`, while 4xx/5xx or network timeouts fail and trigger `withRetry`.

---

## Implementation Decisions

- **Glossary & ADR Alignment**: Uses `Webhook Action` and `ZapRun` per `GLOSSARY.md` and `ADR-0004`.
- **Modal Step 3 Routing for Webhook Action**: `Modal.tsx` includes `selectedItem.type === "Webhook"` in `needsMetadata` and renders `WebhookMetaData` in `renderStep3` for both triggers (`isVisible === 1`) and actions (`isVisible > 1`).
- **Normalized Headers & Body Parsing in `WebhookMetaData`**: Supports JSON strings or objects for `headers` and `body`, normalizing them cleanly when saving so `executeActionWithRetry` receives valid `headers` and `body` structures.

---

## Testing Decisions

### What Makes a Good Test
- **External Behavior Over Implementation Details**: Tests exercise public module interfaces and seams (inputs, return values, database/queue state transitions, and mocked external HTTP boundaries) rather than private helpers.
- **Deterministic Mocking**: External network calls (Google APIs, Meta Graph API, Telegram Bot API, Solana RPC, Resend, LLM providers) are mocked at the boundary.

### Primary Testing Seams
1. **Worker Webhook Execution Seam (`sendWebhook` & `executeActionWithRetry`)**: Tests URL validation, `GET` vs `POST`/`PUT`/`PATCH`/`DELETE` body handling, placeholder interpolation in URL and JSON body, JSON vs plain-text response parsing, HTTP 4xx/5xx error throwing, and `AbortError` timeout handling.
2. **Web Metadata Form & Modal Seam (`WebhookMetaData`, `Modal.tsx`)**: Tests URL, method, headers, and body configuration and Step 3 action routing.

### Prior Art in Codebase
- `apps/worker/src/sendWebhook.ts`
- `apps/worker/src/index.ts`
- `apps/web/components/metadata/WebhookMetaData.tsx`

---

## Out of Scope

- Multipart file uploads or binary request bodies.
- OAuth2 token refresh management for arbitrary third-party endpoints (users supply static headers or use dedicated integrations).

---

## Further Notes

- Outbound requests default to a 30-second timeout via `AbortController` so hung external servers cannot stall worker concurrency.
