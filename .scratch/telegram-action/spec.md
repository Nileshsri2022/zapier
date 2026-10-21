# Specification: Telegram Action (`AvailableActions.type = "Telegram Send Message"`)

**Status**: Ready for Agent (`ready-for-agent`)  
**Context**: ZapMate Automation Platform  
**Domain Term**: Telegram Action (`GLOSSARY.md`)  
**Governing ADRs**: ADR-0004 (Single Worker Action Engine for Provider-Backed and Stateless Actions)  

---

## Problem Statement

Users want their Zaps to send instant messages or replies to Telegram users, groups, or channels via their connected Telegram bot using dynamic data from triggers and prior steps.

---

## Solution

Provide the `Telegram Send Message` action configured via `TelegramMetaData` in the web editor (configuring `chatId` such as `{chatId}` or `@channel`, `message` text with placeholder pills, and `botId`/`botToken`) and executed in `apps/worker` (`sendTelegramMessage` in `apps/worker/src/sendTelegram.ts`) with `{placeholder}` interpolation, HTML/Markdown parse mode, and a 10-second timeout.

---

## User Stories

1. As a Zap creator, I want selecting `Telegram Send Message` in `Modal.tsx` to advance to Step 3 (`TelegramMetaData`) where I can enter the target `chatId` (e.g. `123456789` or `{chatId}`) and `message` template.
2. As a Zap creator, I want `TelegramMetaData` to support selecting a connected `TelegramBot` (`botId`) or providing a `botToken`, and inserting common placeholders like `{text}`, `{firstName}`, `{chatId}`, or `{previousOutput.result}`.
3. As a developer running `apps/worker`, I want `executeActionWithRetry` to interpolate `{placeholder}` tokens in `chatId` and `message` and call `sendTelegramMessage` (`POST https://api.telegram.org/bot${botToken}/sendMessage`) with a 10-second timeout.
4. As a developer running `apps/worker`, I want Telegram API error descriptions (`error.response.data.description`) to propagate so `withRetry` retries transient errors and records a clear failure diagnostic on permanent errors.

---

## Implementation Decisions

- **Glossary & ADR Alignment**: Uses `Telegram Action` and `ZapRun` per `GLOSSARY.md` and `ADR-0004`.
- **Dedicated `TelegramMetaData` Form**: Added to `apps/web/components/metadata/TelegramMetaData.tsx` and wired into `Modal.tsx` (`renderStep3` and `needsMetadata`) using semantic `.meta-form__*` classes.
- **Bot Token Resolution**: When a user selects a connected `TelegramBot` (`botId`) in the modal (where `GET /api/telegram/bots` masks `botToken` as `***hidden***`), `ZapController` resolves the owned `TelegramBot.botToken` into action metadata (or `executeActionWithRetry` resolves `botId` via Prisma when `botToken` is absent/masked) so outbound Telegram delivery works seamlessly.

---

## Testing Decisions

### What Makes a Good Test
- **External Behavior Over Implementation Details**: Tests exercise public module interfaces and seams (inputs, return values, database/queue state transitions, and mocked external HTTP boundaries) rather than private helpers.
- **Deterministic Mocking**: External network calls (Google APIs, Meta Graph API, Telegram Bot API, Solana RPC, Resend, LLM providers) are mocked at the boundary.

### Primary Testing Seams
1. **Worker Telegram Execution Seam (`sendTelegramMessage`, `sendTelegramPhoto`, `sendTelegramDocument`, `replyToMessage`, `executeActionWithRetry`)**: Tests placeholder interpolation in `chatId` and `message`, Bot API endpoint & payload formatting, `botId` token resolution, 10s timeout, and error propagation.
2. **Web Metadata Form Seam (`TelegramMetaData`, `Modal.tsx`)**: Tests `chatId` and `message` validation, placeholder insertion, initialData rehydration, and `handleClick` emission.

### Prior Art in Codebase
- `apps/worker/src/sendTelegram.ts`
- `apps/worker/tests/outboundTimeouts.test.ts`
- `apps/web/components/metadata/DiscordMetaData.tsx`

---

## Out of Scope

- Telegram payments/invoices API.
- Managing chat administrator permissions or banning chat members.

---

## Further Notes

- Outbound requests to `https://api.telegram.org/bot` enforce `REQUEST_TIMEOUT_MS = 10_000`.
