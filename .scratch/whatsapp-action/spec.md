# Specification: WhatsApp Action (`AvailableActions.type = "WhatsApp Send Message"`)

**Status**: Ready for Agent (`ready-for-agent`)  
**Context**: ZapMate Automation Platform  
**Domain Term**: WhatsApp Action (`GLOSSARY.md`)  
**Governing ADRs**: ADR-0004 (Single Worker Action Engine for Provider-Backed and Stateless Actions)  

---

## Problem Statement

Users want their Zaps to send automated WhatsApp messages (order confirmations, customer replies, lead alerts) to dynamic recipient phone numbers via the Meta WhatsApp Cloud API.

---

## Solution

Provide the `WhatsApp Send Message` action configured via `WhatsAppMetaData` in the web editor (selecting a connected `WhatsAppServer` or entering `phoneNumberId`, `accessToken`, recipient `to`, and `message` template with variable pills) and executed in `apps/worker` (`sendWhatsAppMessage` in `apps/worker/src/sendWhatsApp.ts`) with phone number normalization, 10-second timeout, and `{placeholder}` interpolation.

---

## User Stories

1. As a Zap creator, I want selecting `WhatsApp Send Message` in `Modal.tsx` to advance to Step 3 (`WhatsAppMetaData`) where I can enter the recipient phone number (`to`, e.g. `+14155552671` or `{from}`) and `message` text with placeholder pills.
2. As a Zap creator, I want `WhatsAppMetaData` to use my connected `WhatsAppServer` account (or allow entering `phoneNumberId` and `accessToken` directly) so the worker has the credentials required to call Meta Graph API v18.0.
3. As a developer running `apps/worker`, I want `sendWhatsAppMessage` to normalize recipient phone numbers by stripping non-digits (`to.replace(/[^0-9]/g, "")`), interpolate `{placeholder}` variables in `to` and `message`, and POST to `https://graph.facebook.com/v18.0/${phoneNumberId}/messages` with a 10-second timeout.
4. As a developer running `apps/worker`, I want Meta API errors (`error.response.data.error.message`) to fail the action attempt so `withRetry` retries transient failures and marks the `ZapRun` failed if delivery cannot succeed.

---

## Implementation Decisions

- **Glossary & ADR Alignment**: Uses `WhatsApp Action` and `ZapRun` per `GLOSSARY.md` and `ADR-0004`.
- **Dedicated `WhatsAppMetaData` Form**: Added to `apps/web/components/metadata/WhatsAppMetaData.tsx` and wired into `Modal.tsx` (`renderStep3` and `needsMetadata`) so users can configure `to`, `message`, `phoneNumberId`, and `accessToken` using semantic `.meta-form__*` design-system classes.
- **Server Credential Hydration in `ZapController`**: When `actionMetaData.serverId` is provided for a `WhatsApp Send Message` action without explicit `phoneNumberId`/`accessToken`, `ZapController` (or the form/worker) resolves the user-owned `WhatsAppServer` credentials so masked browser tokens never break worker execution.

---

## Testing Decisions

### What Makes a Good Test
- **External Behavior Over Implementation Details**: Tests exercise public module interfaces and seams (inputs, return values, database/queue state transitions, and mocked external HTTP boundaries) rather than private helpers.
- **Deterministic Mocking**: External network calls (Google APIs, Meta Graph API, Telegram Bot API, Solana RPC, Resend, LLM providers) are mocked at the boundary.

### Primary Testing Seams
1. **Worker WhatsApp Execution Seam (`sendWhatsAppMessage`, `sendWhatsAppTemplateMessage`, `executeActionWithRetry`)**: Tests phone number digit normalization, placeholder interpolation in `to` and `message`, Meta Graph API v18.0 request payload & Bearer header, 10s timeout, and error propagation.
2. **Web Metadata Form Seam (`WhatsAppMetaData`, `Modal.tsx`)**: Tests recipient `to` and `message` validation, placeholder insertion, initialData rehydration, and `handleClick` payload emission.

### Prior Art in Codebase
- `apps/worker/src/sendWhatsApp.ts`
- `apps/worker/tests/outboundTimeouts.test.ts`
- `apps/web/components/metadata/DiscordMetaData.tsx`

---

## Out of Scope

- Interactive WhatsApp list messages or product catalog carousels.
- Voice call initiation over WhatsApp.

---

## Further Notes

- Outbound requests to `https://graph.facebook.com/v18.0` enforce `REQUEST_TIMEOUT_MS = 10_000`.
