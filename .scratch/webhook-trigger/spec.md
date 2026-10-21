# Specification: Webhook Trigger (`AvailableTriggers.type = "Webhook"`)

**Status**: Ready for Agent (`ready-for-agent`)  
**Context**: ZapMate Automation Platform  
**Domain Term**: Webhook Trigger (`GLOSSARY.md`)  
**Governing ADRs**: ADR-0002 (Unified Run Intake and Transactional Outbox) and ADR-0003 (Hybrid Push and Stateful Polling Trigger Ingress)  

---

## Problem Statement

Developers and external SaaS tools (Stripe, custom backends, CI pipelines, forms) need a universal inbound HTTP endpoint to trigger a Zap with any JSON payload while optionally authenticating requests and deduplicating retries.

---

## Solution

Provide a universal `Webhook` trigger (`POST /hooks/:userId/:zapId` in `apps/hooks` and `POST /api/triggers/webhook` in `apps/server`) with optional HMAC-SHA256 / shared-secret verification (`webhookAuth.ts`), opt-in `event_id`/`eventId` deduplication via `@repo/runs`, and a `WebhookTriggerMetaData` configuration view in the web editor.

---

## User Stories

1. As a Zap creator, I want to select `Webhook` as my trigger in the editor and optionally configure a per-trigger signing secret (`metadata.secret`), so that only authorized callers can fire my Zap.
2. As a developer calling `POST /hooks/:userId/:zapId`, I want to authenticate using `X-Webhook-Signature: sha256=<hmac>`, `X-Webhook-Secret`, or `Authorization: Bearer <secret>` when a secret is configured, with unauthorized requests rejected with HTTP 401 before touching Redis or Postgres.
3. As a developer sending webhooks over an unreliable network, I want to include `event_id` or `eventId` in my JSON payload so that duplicate deliveries within 24 hours return HTTP 200 (`Duplicate event skipped`) without creating a second `ZapRun`.
4. As a downstream action author, I want the entire arbitrary JSON body sent to the webhook endpoint to be stored in `ZapRun.metadata`, so that nested keys like `{customer.email}` or `{data.amount}` interpolate in subsequent steps.
5. As a platform operator, I want webhook triggers for inactive or missing Zaps to return cleanly without creating orphan `ZapRun` or `ZapRunOutbox` rows.

---

## Implementation Decisions

- **Glossary & ADR Alignment**: Uses `Webhook Trigger`, `Trigger ingress`, `Run intake`, and `Outbox` per `GLOSSARY.md`, `ADR-0002`, and `ADR-0003`.
- **Pre-Intake Authentication (`verifyWebhookRequest`)**: Resolves the expected secret from `trigger.metadata.secret` (falling back to `process.env.WEBHOOK_SECRET`). When set, requires either a constant-time HMAC-SHA256 match on `x-webhook-signature` or a constant-time token match on `x-webhook-secret` / `Authorization: Bearer`.
- **Event-ID Deduplication**: Extracts `payload.event_id || payload.eventId` and passes `{ scope: "webhook", key: "${zapId}:${eventId}" }` to `enqueueRun`.
- **Distinct Trigger vs Action Metadata UI**: When configuring a `Webhook` Trigger (`isVisible === 1`), the user configures optional inbound authentication (`secret`) and sees how to post JSON events; when configuring a `Webhook` Action (`isVisible > 1`), the user configures outbound `url`, `method`, `headers`, and `body`.

---

## Testing Decisions

### What Makes a Good Test
- **External Behavior Over Implementation Details**: Tests exercise public module interfaces and seams (inputs, return values, database/queue state transitions, and mocked external HTTP boundaries) rather than private helpers.
- **Deterministic Mocking**: External network calls (Google APIs, Meta Graph API, Telegram Bot API, Solana RPC, Resend, LLM providers) are mocked at the boundary.

### Primary Testing Seams
1. **Hooks Webhook Ingress Seam (`POST /hooks/:userId/:zapId` & `verifyWebhookRequest`)**: Tests capability-URL mode (no secret), HMAC-SHA256 signature verification, shared-secret header verification, `event_id` deduplication, inactive/missing Zap handling, and `enqueueRun` delegation.
2. **Web Metadata Form Seam (`WebhookMetaData`)**: Tests inbound trigger secret configuration and outbound webhook action configuration.

### Prior Art in Codebase
- `apps/server/tests/security/webhook-security.test.ts`
- `apps/hooks/src/webhookAuth.ts`
- `apps/hooks/src/index.ts`

---

## Out of Scope

- XML or multipart/form-data webhook bodies (ingress expects `application/json`).
- Custom synchronous response bodies from worker actions (webhook ingress responds immediately upon queueing).

---

## Further Notes

- Dashboard rows also expose a one-click copy button for the Zap webhook URL (`/hooks/:userId/:zapId`).
