# Specification: Telegram Trigger (`Telegram New Message`)

**Status**: Ready for Agent (`ready-for-agent`)  
**Context**: ZapMate Automation Platform  
**Domain Term**: Telegram Trigger (`GLOSSARY.md`)  
**Governing ADRs**: ADR-0002 (Unified Run Intake and Transactional Outbox) and ADR-0003 (Hybrid Push and Stateful Polling Trigger Ingress)  

---

## Problem Statement

Users and communities running Telegram bots want incoming messages and slash commands (`/start`, `/alert`, `/ask`) in private or group chats to trigger automated Zaps without cross-tenant webhook collisions.

---

## Solution

Provide the `Telegram New Message` trigger backed by connected `TelegramBot` records (`/api/telegram/bots` verified via BotFather `getMe`), per-bot webhook registration (`/api/webhooks/telegram/:botId`), optional `filterCommand` matching, deduplication via `@repo/runs`, and hydrated sender/chat/command metadata.

---

## User Stories

1. As a Zap creator, I want to connect my Telegram bot token in the editor, have ZapMate verify it via Telegram `getMe`, and automatically register the bot-scoped webhook URL `/api/webhooks/telegram/:botId`.
2. As a Zap creator, I want `ZapController.createZap` to verify that the selected `botId` belongs to my user account and create a `TelegramTrigger` record linked to my Zap.
3. As a security-conscious operator, I want `handleTelegramWebhook` (`POST /api/webhooks/telegram/:botId`) to scope trigger lookup strictly to `bot: { id: botId, isActive: true }` and ignore requests without a `botId`, preventing cross-tenant message fan-out.
4. As a Zap creator, I want slash commands like `/ summarize@MyBot hello world` to be parsed into `isCommand: true`, `command: "/summarize"`, and `commandArgs: "hello world"`, and matched against optional `filterCommand` rules.
5. As a platform operator, I want Telegram updates deduplicated by `telegram:${botId}:${zap.id}:${message.message_id}` via `enqueueRun` and `lastProcessedAt` updated only when a run is queued.

---

## Implementation Decisions

- **Glossary & ADR Alignment**: Uses `Telegram Trigger`, `Trigger ingress`, and `Run intake` per `GLOSSARY.md`, `ADR-0002`, and `ADR-0003`.
- **Bot-Scoped Webhook URLs**: Every bot registers `/api/webhooks/telegram/:botId` so incoming updates are attributed deterministically to one `TelegramBot`.
- **Slash Command Parsing**: Strips `@BotUsername` suffixes from commands (`/cmd@Bot arg` → `command: "/cmd"`, `commandArgs: "arg"`) and matches triggers where `filterCommand` is null, empty, or equal to `command`.

---

## Testing Decisions

### What Makes a Good Test
- **External Behavior Over Implementation Details**: Tests exercise public module interfaces and seams (inputs, return values, database/queue state transitions, and mocked external HTTP boundaries) rather than private helpers.
- **Deterministic Mocking**: External network calls (Google APIs, Meta Graph API, Telegram Bot API, Solana RPC, Resend, LLM providers) are mocked at the boundary.

### Primary Testing Seams
1. **Hooks Telegram Webhook Seam (`handleTelegramWebhook`, `processMessage`)**: Tests botId scoping, missing botId rejection, slash command & argument parsing, `filterCommand` filtering, `enqueueRun` deduplication, and `lastProcessedAt` updates.
2. **Server Bot & Trigger Creation Seam (`TelegramRoutes`, `ZapController.createZap`)**: Tests ownership verification, token masking, and `TelegramTrigger` creation.

### Prior Art in Codebase
- `apps/hooks/tests/telegramHandler.test.ts`
- `apps/server/tests/zaps/im-trigger-creation.test.ts`
- `apps/server/tests/integrations/trigger-zap-ownership.test.ts`

---

## Out of Scope

- Inline query (`inline_query`) bot responses.
- Telegram voice/video call handling.

---

## Further Notes

- Bot tokens returned by `GET /api/telegram/bots` are masked as `***hidden***`.
