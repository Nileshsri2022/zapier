# 01: Core Plain-Text Discord Action (Tracer Bullet)

**What to build:**
Deliver the initial vertical slice of the Discord action. Users can configure a Discord Send Message action with a webhook URL and plain text template. When a Zap runs, the worker interpolates variables, executes the webhook via HTTP POST, and records success or failure in the ZapRun.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [x] Add "Discord Send Message" to `AvailableActions` catalog and seed in `SEEDED_ACTIONS` with `/apps/discord.svg`
- [x] Register "Discord" in `KNOWN_ACTION_PREFIXES` in `apps/worker/src/utils/actionTypes.ts`
- [x] Implement `sendDiscordMessage` in `apps/worker/src/sendDiscord.ts` with Axios POST, timeout, and placeholder interpolation
- [x] Integrate into `executeAction` in `apps/worker/src/index.ts`
- [x] Unit tests in `apps/worker/tests/sendDiscord.test.ts` verifying payload formatting, `{placeholder}` replacement, and error handling
