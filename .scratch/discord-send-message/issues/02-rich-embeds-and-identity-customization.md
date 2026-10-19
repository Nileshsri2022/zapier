# 02: Rich Embeds and Identity Customization

**What to build:**
Enable rich embeds and custom sender identity (username and avatar URL) for the Discord action. Embed fields and title/description interpolate placeholders and adhere to Discord length limits.

**Blocked by:** 01: Core Plain-Text Discord Action (Tracer Bullet)

**Status:** ready-for-agent

- [x] Support `embed` object (title, description, color, url, fields) in Discord action metadata
- [x] Support `username` and `avatarUrl` overrides
- [x] Color normalization (convert hex strings like `#5865F2` to decimal integer for Discord API)
- [x] Character length boundary checks (2,000 text, 4,096 embed description)
- [x] Unit tests for embed serialization, variable replacement in embed fields, and validation
