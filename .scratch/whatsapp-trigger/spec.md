# Specification: WhatsApp Trigger (`WhatsApp Message Received`)

**Status**: Ready for Agent (`ready-for-agent`)  
**Context**: ZapMate Automation Platform  
**Domain Term**: WhatsApp Trigger (`GLOSSARY.md`)  
**Governing ADRs**: ADR-0002 (Unified Run Intake and Transactional Outbox) and ADR-0003 (Hybrid Push and Stateful Polling Trigger Ingress)  

---

## Problem Statement

Businesses communicating with customers on WhatsApp Business need incoming customer messages to automatically trigger support, CRM, AI classification, or notification Zaps.

---

## Solution

Provide the `WhatsApp Message Received` trigger backed by connected `WhatsAppServer` accounts (`/api/whatsapp/servers`), Meta Cloud API webhook verification (`GET /api/webhooks/whatsapp`), inbound message hydration (`POST /api/webhooks/whatsapp` in `apps/hooks`), Redis deduplication by `wamid`, and Run intake queueing.

---

## User Stories

1. As a Zap creator, I want to connect my WhatsApp Business account (`displayName`, `phoneNumberId`, `accessToken`, optional `businessId` and `phoneNumber`) in the editor or via `/api/whatsapp/servers`, so that ZapMate can match incoming webhooks to my account.
2. As a Zap creator, I want selecting `WhatsApp Message Received` and clicking Continue to attach my selected `serverId` to `triggerMetaData`, and `ZapController.createZap` to verify server ownership and create a `WhatsAppTrigger` row.
3. As a platform operator configuring Meta Developer Portal, I want `GET /api/webhooks/whatsapp` to verify `hub.mode=subscribe` and `hub.verify_token` against `WHATSAPP_VERIFY_TOKEN` and echo `hub.challenge` with HTTP 200 (or 403 on mismatch).
4. As a platform operator, I want `POST /api/webhooks/whatsapp` to acknowledge receipt with HTTP 200 immediately, ignore non-message status events, match active `WhatsAppTrigger` rows by `phoneNumberId`, deduplicate by `whatsapp:<zapId>:<message.id>`, enqueue a `ZapRun`, and update `lastProcessedAt`.
5. As a downstream action author, I want `ZapRun.metadata` to include `from`, `fromName`, `messageId`, `timestamp`, `type`, `text`, `mediaId`, `caption`, and `phoneNumberId` so that downstream steps can reply to `{from}` or process `{text}`.

---

## Implementation Decisions

- **Glossary & ADR Alignment**: Uses `WhatsApp Trigger`, `Trigger ingress`, and `Run intake` per `GLOSSARY.md`, `ADR-0002`, and `ADR-0003`.
- **Tenant Ownership Verification**: Both `POST /api/whatsapp/triggers` and `ZapController.createZap` verify that `whatsAppServer.userId === authenticatedUserId` before creating a `WhatsAppTrigger` row.
- **Deduplication by Meta Message ID (`wamid`)**: Passes `dedup: { scope: "whatsapp", key: "${zap.id}:${message.id}" }` to `enqueueRun` so Meta webhook redeliveries never fire duplicate runs.

---

## Testing Decisions

### What Makes a Good Test
- **External Behavior Over Implementation Details**: Tests exercise public module interfaces and seams (inputs, return values, database/queue state transitions, and mocked external HTTP boundaries) rather than private helpers.
- **Deterministic Mocking**: External network calls (Google APIs, Meta Graph API, Telegram Bot API, Solana RPC, Resend, LLM providers) are mocked at the boundary.

### Primary Testing Seams
1. **Hooks WhatsApp Webhook Seam (`verifyWhatsAppWebhook`, `handleWhatsAppWebhook`)**: Tests GET challenge verification, non-message event skipping, active trigger matching by `phoneNumberId`, payload hydration (text, media, contact name), deduplication via `enqueueRun`, and `lastProcessedAt` update.
2. **Server Ownership & Zap Creation Seam (`createZap`, `/api/whatsapp/*`)**: Tests tenant isolation and `WhatsAppTrigger` creation.

### Prior Art in Codebase
- `apps/server/tests/zaps/im-trigger-creation.test.ts`
- `apps/server/tests/integrations/trigger-zap-ownership.test.ts`
- `apps/hooks/src/whatsappHandler.ts`

---

## Out of Scope

- Downloading binary media files from Meta Graph API during webhook ingress (only `mediaId` and `caption` are extracted).
- WhatsApp Flows interactive form responses.

---

## Further Notes

- Access tokens returned by `GET /api/whatsapp/servers` are masked as `***hidden***` to prevent credential leakage.
