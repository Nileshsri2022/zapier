# 01: Catalog Registration & Domain Contract for Telegram Action

**What to build:**
Ensure Telegram Action is registered in the ZapMate catalog, documented in GLOSSARY.md and ADRs, and wired into the Zap creation/persistence contract.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [x] Define Telegram Action in GLOSSARY.md and link governing ADRs
- [x] Verify catalog seeding in apps/server/src/seed.ts and APPS mapping in apps/web/components/modal/constants.ts
- [x] Ensure ZapController.createZap and updateZapWithId persist provider-specific trigger/action state with tenant ownership checks
