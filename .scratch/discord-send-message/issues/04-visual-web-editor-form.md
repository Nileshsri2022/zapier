# 04: Visual Web Editor Form (DiscordMetaData.tsx)

**What to build:**
Create the interactive configuration form in the web UI for users to configure Discord Send Message actions. Validate webhook URLs, provide variable insertion pills, character counters, and embed toggles.

**Blocked by:** 01: Core Plain-Text Discord Action (Tracer Bullet), 02: Rich Embeds and Identity Customization

**Status:** ready-for-agent

- [x] Create `apps/web/components/metadata/DiscordMetaData.tsx`
- [x] Add Discord icon `/apps/discord.svg` to public assets and register in `apps/web/components/modal/constants.ts`
- [x] Wire `DiscordMetaData` into `apps/web/components/Modal.tsx`
- [x] Implement Webhook URL validation, live character counter (0/2000), dynamic placeholder inserter, and collapsible Rich Embed & Identity fields
- [x] Add "Send Test Message" button to verify connection
