# Specification: Discord Webhook Action (`Discord Send Message`)

**Status**: Ready for Agent (`ready-for-agent`)  
**Context**: ZapMate Automation Platform  
**Target Feature**: Outbound Discord notifications via incoming channel webhooks  

---

## Problem Statement

When an automation event triggers in ZapMate (such as receiving a Solana payment, a new Gmail message, or an inbound webhook), users need an immediate, friction-free way to broadcast alerts into their team communication channels. 

Currently, users must rely on generic raw webhooks (which require manually crafting Discord-specific JSON payloads and headers) or Telegram/Email. Setting up a dedicated Discord application requires creating an application in the Discord Developer Portal, managing client credentials, requesting guild permissions, and handling OAuth token refreshes. Users want a dead-simple way to pipe dynamic trigger data into a Discord channel by simply pasting a Discord Webhook URL.

---

## Solution

Introduce a native **Discord Send Message** action (`AvailableActions.type = "Discord Send Message"`). 

Users configure their action by pasting an incoming Discord Webhook URL and drafting their message. The action supports:
1. **Standard Messages**: Plain text markdown messages (up to 2,000 characters) with dynamic template placeholders (e.g. `New transaction of {trigger.data.amount} SOL received!`).
2. **Rich Embeds**: Optional structured embed cards featuring a title, description, accent color hex, URL, and timestamp.
3. **Identity Overrides**: Optional custom sender name (`username`) and avatar URL to match the Zap's purpose.
4. **Resilient Delivery**: Automatic retry backoff respecting Discord's HTTP 429 `retry_after` response headers to prevent dropped messages under burst conditions.

---

## User Stories

1. As a Zap creator, I want to select "Discord Send Message" from the action catalog, so that I can add Discord notifications to my automation pipeline.
2. As a Zap creator, I want to paste a Discord incoming webhook URL into the action form, so that the message routes directly to my desired server and channel without OAuth complexity.
3. As a Zap creator, I want to write plain text messages with Markdown formatting (bold, italic, code blocks), so that my notifications are easy to read in Discord.
4. As a Zap creator, I want to use dynamic placeholders like `{trigger.data.txHash}` or `{trigger.data.from}` in the message content, so that real event data appears in the alert.
5. As a Zap creator, I want to configure an optional Rich Embed with a title, description, and color, so that high-priority alerts stand out visually in Discord.
6. As a Zap creator, I want to override the displayed webhook username per Zap, so that my notifications look like they come from "Solana Tracker" or "Support Desk".
7. As a Zap creator, I want to override the avatar icon with a custom image URL, so that the message visually aligns with the triggering service.
8. As a Zap creator, I want the web editor to validate that my webhook URL matches the canonical Discord format (`https://discord.com/api/webhooks/...` or `https://discordapp.com/api/webhooks/...`), so that I catch copy-paste mistakes before publishing.
9. As a Zap creator, I want a live character counter showing my progress toward the 2,000-character content limit, so that I don't craft messages that Discord will reject.
10. As a Zap creator, I want the editor to warn me if an embed description exceeds Discord's 4,096-character limit, so that my structured embeds are guaranteed to be accepted.
11. As a Zap creator, I want to test my Discord webhook with sample trigger data right from the modal, so that I can verify it posts to my channel before publishing the Zap.
12. As a developer running the background worker, I want Discord actions to execute reliably within the transactional outbox pipeline, so that no messages are lost if a service momentarily restarts.
13. As a developer running the background worker, I want HTTP 429 rate limits from Discord to be parsed for `retry_after` and safely waited out, so that the worker does not get IP-banned by Cloudflare.
14. As a developer, I want unresolvable placeholders (e.g. `{trigger.data.nonexistent}`) to fall back gracefully to the literal string placeholder rather than crashing the worker run.
15. As a developer, I want Discord API 400 (Bad Request) or 404 (Unknown Webhook) errors to immediately fail the specific action and mark the ZapRun as `failed` with a clear diagnostic message, so that users can diagnose broken webhooks in their run logs.
16. As a user reviewing run history, I want the ZapRun details to show the Discord execution output (including the Discord message ID and timestamp), so that I have an audit trail of when the message was delivered.
17. As an admin, I want the Discord action to be seeded into `AvailableActions` alongside Email and Solana during database setup, so that it is available immediately out of the box in new environments.

---

## Implementation Decisions

### Architectural Decisions
- **Stateless Webhook Integration**: Webhooks are stateless HTTP POST endpoints. We do not maintain WebSocket gateway connections or application credential state. The webhook URL is stored directly in `Action.metadata`. (Recorded in `docs/adr/0001-discord-webhook-action.md`).
- **Standard Action Catalog Entry**: Registered under `AvailableActions.type = "Discord Send Message"`. The worker registers `'Discord'` in its known action prefixes (`KNOWN_ACTION_PREFIXES`).
- **Dynamic Key Interpolation**: Reuses the core placeholder engine (`replaceKeys`) so `{key}` and `{a.b.c}` paths from trigger metadata and previous action outputs interpolate cleanly across content, username, and embed fields.

### Action Metadata Schema
Stored in `Action.metadata` JSON:
```typescript
interface DiscordActionMetadata {
  webhookUrl: string;              // Required: Discord webhook URL
  content?: string;                 // Optional if embed provided: Plain text (max 2000 chars)
  username?: string;                // Optional: Custom username override (max 80 chars)
  avatarUrl?: string;               // Optional: Custom avatar image URL
  embed?: {                         // Optional: Rich embed card
    title?: string;                 // Max 256 chars
    description?: string;           // Max 4096 chars
    color?: string | number;        // Hex string ("#5865F2") or integer
    url?: string;                   // URL linked from the embed title
    timestamp?: string;             // Optional: ISO8601 timestamp string
    fields?: Array<{                // Up to 25 fields
      name: string;                 // Max 256 chars
      value: string;                // Max 1024 chars
      inline?: boolean;
    }>;
  };
}
```

### Discord API Contract
- **Endpoint**: `POST <webhookUrl>?wait=true`
  - Query parameter `wait=true` causes Discord to return the created message object (`{ id, channel_id, ... }`), allowing ZapMate to capture the Discord `messageId` in `ZapRun` action outputs.
- **Rate-Limit Handling**:
  - Discord returns `HTTP 429` with header `Retry-After: <seconds>` or body `{"retry_after": 0.5, "global": false}`.
  - The worker captures this delay, sleeps for `Math.ceil(retry_after * 1000) + 100ms`, and retries up to 3 times before failing.
- **Timeouts**: Every outgoing call is bounded to a 10-second timeout to avoid tying up worker concurrency.

### User Interface Component
- Add a new metadata component `DiscordMetaData` under the metadata form registry.
- Features:
  - Input field for Discord Webhook URL with URL pattern validation.
  - Textarea for message content with dynamic variable pill inserter and live 2,000-character counter.
  - Collapsible "Rich Embed" toggle with fields for Title, Description, Color picker/hex input, and URL.
  - Collapsible "Sender Identity" override for custom username and avatar URL.
  - "Send Test Message" button to verify the webhook directly before saving.

---

## Testing Decisions

### What Makes a Good Test
- **External Behavior Over Implementation Details**: Tests should exercise the module boundaries through input arguments and observable outputs/side effects. Tests must never inspect internal variable state or private helper functions.
- **Deterministic Mocking**: External HTTP calls to Discord (`https://discord.com/api/webhooks/...`) must be mocked at the network boundary (e.g. Axios mock adapter or MSW). Real network calls are forbidden in unit/integration tests.

### Primary Testing Seams
1. **The Worker Action Execution Seam (`executeAction`)**:
   - The highest behavioral seam for backend execution.
   - Tests verify:
     - Correct transformation of `metadata` + `zapRunMetadata` into the Discord API payload.
     - Successful response extraction (`messageId` and `timestamp`) on HTTP 200.
     - Exponential backoff / dynamic delay on HTTP 429 `retry_after`.
     - Explicit error throwing and `ZapRun` failure transition on HTTP 400 (malformed payload) or HTTP 404 (deleted webhook).
2. **The Catalog Ingress Seam (`GET /api/v1/actions`)**:
   - Verifies that `"Discord Send Message"` is returned in the available actions list with correct icon and metadata schema.
3. **The Metadata Form Seam (`DiscordMetaData`)**:
   - Verifies user interaction: webhook URL validation, character length limits, and emitting valid metadata objects through `handleClick`.

### Prior Art in Codebase
- `apps/worker/tests/actionTypes.test.ts` (Registry validation)
- `apps/worker/src/sendTelegram.ts` & `apps/worker/src/sendWebhook.ts` (HTTP client pattern with timeout and payload mapping)
- `apps/server/tests/actions/actions.test.ts` (AvailableActions controller test)
- `apps/web/components/metadata/WebhookMetaData.tsx` and `TelegramMetaData.tsx` (Form UI pattern)

---

## Out of Scope

- **Discord Inbound Triggers**: Listening for messages posted in Discord channels (requires a persistent WebSocket gateway connection with Message Content intents).
- **Interactive Components**: Discord buttons, select menus, or modal popups inside Discord.
- **Voice/Audio Channels**: Joining voice channels or sending audio clips.
- **Channel / Guild Administration**: Creating channels, banning users, or assigning roles.

---

## Further Notes

- **Icon Asset**: Place a clean SVG icon at `apps/web/public/apps/discord.svg` matching the brand assets of Telegram and WhatsApp.
- **Database Migrations**: No schema alterations are needed for `Action` or `ZapRun` because `metadata` is already typed as `Json`. Only `AvailableActions` requires seeding `"Discord Send Message"`.
