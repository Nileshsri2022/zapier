# Specification: Gmail Trigger (`Gmail New Email`, `Gmail Labeled`, `Gmail Starred`, `Gmail From Sender`)

**Status**: Ready for Agent (`ready-for-agent`)  
**Context**: ZapMate Automation Platform  
**Domain Term**: Gmail Trigger (`GLOSSARY.md`)  
**Governing ADRs**: ADR-0002 (Unified Run Intake and Transactional Outbox) and ADR-0003 (Hybrid Push and Stateful Polling Trigger Ingress)  

---

## Problem Statement

Users receive critical operational emails (invoices, support inquiries, lead notifications, starred follow-ups) in Gmail and need to trigger automated Zaps without manually forwarding messages or polling raw IMAP sockets.

---

## Solution

Provide a native Gmail Trigger supporting four catalog events (`Gmail New Email`, `Gmail Labeled`, `Gmail Starred`, `Gmail From Sender`). Users connect their Gmail account via OAuth2, configure optional sender, subject, or watched-label filters in the editor, and the platform hydrates mailbox history deltas via Google Pub/Sub push notifications or webhook ingress and hands matching messages to Run intake (`@repo/runs`).

---

## User Stories

1. As a Zap creator, I want to select Gmail from the trigger catalog and choose between `Gmail New Email`, `Gmail Labeled`, `Gmail Starred`, and `Gmail From Sender`, so that my automation fires on the exact mailbox activity I care about.
2. As a Zap creator, I want to connect my Google account via OAuth2 inside the modal, so that ZapMate can read mailbox metadata without sharing raw passwords.
3. As a Zap creator, I want to filter `Gmail New Email` by sender substring, subject keyword, and watched labels (`INBOX`, `IMPORTANT`), so that noisy newsletters do not trigger runs.
4. As a Zap creator, I want `Gmail Labeled` to trigger when a message carries one of my configured watched labels, so that tagging an email in Gmail kicks off downstream workflows.
5. As a Zap creator, I want `Gmail Starred` to trigger when a message has the `STARRED` label without extra form friction, so that starring an email acts as a one-click automation trigger.
6. As a Zap creator, I want `Gmail From Sender` to trigger only when the `From` header matches my configured sender filter, so that VIP or vendor emails route reliably.
7. As a Zap creator, I want publishing a Zap with a Gmail Trigger to persist the `GmailTrigger` configuration linked to my connected `GmailServer`, so that incoming mailbox events match my Zap.
8. As a downstream action author, I want hydrated Gmail metadata (`id`, `messageId`, `threadId`, `from`, `to`, `subject`, `snippet`, `body`, `labels`, `date`, `hasAttachments`, `isRead`) in `ZapRun.metadata`, so that I can interpolate `{subject}`, `{from}`, and `{body}` into actions.
9. As a platform operator, I want Gmail Pub/Sub push notifications to advance `lastHistoryId` only after all history delta events are enqueued via Run intake, so that transient failures can be safely redelivered.
10. As a platform operator, I want duplicate Gmail notifications for the same `(zapId, messageId, eventType)` to be deduplicated via Redis `SET NX PX`, so that downstream actions execute at most once per mailbox event.
11. As a platform operator, I want expiring 7-day Gmail watches to be renewed automatically via `/api/cron/renew-gmail-watches` without resetting `lastHistoryId`, so that mailbox push ingress never goes dark.

---

## Implementation Decisions

- **Glossary & ADR Alignment**: Uses `Gmail Trigger`, `Trigger ingress`, `Run intake`, and `Outbox` per `GLOSSARY.md`, `ADR-0002`, and `ADR-0003`.
- **Four Catalog Event Types**: Registered in `AvailableTriggers` as `Gmail New Email`, `Gmail Labeled`, `Gmail Starred`, and `Gmail From Sender`.
- **Zap Creation Persistence**: When a Zap is created with any `Gmail *` trigger and a connected `serverId`, `ZapController.createZap` verifies `GmailServer` ownership for the authenticated user and creates the corresponding `GmailTrigger` row in the same database transaction.
- **Hydration & Filter Evaluation (`GmailDispatch`)**: `dispatchGmailEvent` hydrates message metadata and plain-text body once per message, evaluates `shouldTrigger` (`new_email`, `labeled` checking `watchedLabels` and `metadata.targetLabels`, `starred` checking `STARRED`, `from_sender` checking `senderFilter`), and calls `enqueueRun` with dedup scope `gmail` and key `${zap.id}:${messageId}:${eventType}`.
- **Web Metadata Form (`GmailMetaData`)**: Collects trigger-specific filters (`senderFilter`, `subjectFilter`, `watchedLabels`) and forwards `serverId` so the editor persists a complete trigger payload.

---

## Testing Decisions

### What Makes a Good Test
- **External Behavior Over Implementation Details**: Tests exercise public module interfaces and seams (inputs, return values, database/queue state transitions, and mocked external HTTP boundaries) rather than private helpers.
- **Deterministic Mocking**: External network calls (Google APIs, Meta Graph API, Telegram Bot API, Solana RPC, Resend, LLM providers) are mocked at the boundary.

### Primary Testing Seams
1. **Gmail Dispatch & History Seam (`dispatchGmailEvent`, `processHistoryDelta`, `shouldTrigger`)**: Tests message hydration, history record mapping, filter matching (`new_email`, `labeled`, `starred`, `from_sender`), cursor advancement/reset on 404/410, and `enqueueRun` deduplication.
2. **Webhook & Renewal Ingress Seam (`GmailWebhookController`, `CronRoutes /renew-gmail-watches`)**: Tests Pub/Sub envelope decoding, JWT bearer verification, and watch renewal.
3. **Zap Creation & Metadata Form Seam (`createZap`, `GmailMetaData`)**: Tests ownership-checked `GmailTrigger` persistence during Zap creation and UI filter configuration.

### Prior Art in Codebase
- `apps/server/tests/gmail/dispatch.test.ts`
- `apps/server/tests/gmail/webhook-ingress.test.ts`
- `apps/server/tests/gmail/gmail-body.test.ts`

---

## Out of Scope

- Outbound Gmail actions (`Gmail Send Email`, `Gmail Reply`, etc.), which were explicitly pruned from `SEEDED_ACTIONS` in favor of the transactional `Email` action.
- Full attachment binary storage in `ZapRun.metadata` (only `hasAttachments` boolean and text/HTML body hydration are included).

---

## Further Notes

- Gmail watch channels expire every 7 days on Google Cloud Pub/Sub; external cron hits `GET /api/cron/renew-gmail-watches` daily with `x-cron-secret`.
